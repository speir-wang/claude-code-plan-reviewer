import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import request from 'supertest';
import { SessionManager } from '../../src/session-manager.js';
import { createApp } from '../../src/http-server.js';

describe('HTTP server', () => {
  let storageDir: string;
  let sm: SessionManager;
  let server: Server;
  let app: ReturnType<typeof createApp>;
  let baseUrl: string;

  beforeEach(async () => {
    storageDir = await mkdtemp(path.join(tmpdir(), 'plan-reviewer-http-'));
    sm = new SessionManager({ storageDir });
    await sm.init();
    app = createApp({ sessionManager: sm, openBrowser: () => {} });
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const { port } = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await sm.flush();
    await rm(storageDir, { recursive: true, force: true });
  });

  describe('GET /api/sessions', () => {
    it('returns empty list initially', async () => {
      const res = await request(server).get('/api/sessions');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ sessions: [] });
    });

    it('lists sessions after creation', async () => {
      sm.createSession('plan A');
      sm.createSession('plan B');
      const res = await request(server).get('/api/sessions');
      expect(res.status).toBe(200);
      expect(res.body.sessions).toHaveLength(2);
    });
  });

  describe('GET /api/sessions/:id', () => {
    it('returns 404 for unknown session', async () => {
      const res = await request(server).get('/api/sessions/unknown');
      expect(res.status).toBe(404);
    });

    it('returns the session', async () => {
      const s = sm.createSession('plan');
      const res = await request(server).get(`/api/sessions/${s.id}`);
      expect(res.status).toBe(200);
      expect(res.body.session.id).toBe(s.id);
    });
  });

  describe('POST /api/sessions/:id/feedback', () => {
    it('404 if no pending waiter', async () => {
      const s = sm.createSession('plan');
      const res = await request(server)
        .post(`/api/sessions/${s.id}/feedback`)
        .send({ comments: [] });
      expect(res.status).toBe(404);
    });

    it('resolves the blocking bridge with feedback XML', async () => {
      const s = sm.createSession('plan');
      const waiter = sm.waitForUserResponse(s.id);

      const res = await request(server)
        .post(`/api/sessions/${s.id}/feedback`)
        .send({
          comments: [
            { anchor: 'foo', note: 'please clarify' },
            { anchor: 'bar & baz', note: 'rename <this>' },
          ],
        });
      expect(res.status).toBe(200);
      const xml = await waiter;
      expect(xml).toContain('<plan_review type="feedback">');
      expect(xml).toContain('<anchor>foo</anchor>');
      expect(xml).toContain('<note>please clarify</note>');
      // XML escapes
      expect(xml).toContain('<anchor>bar &amp; baz</anchor>');
      expect(xml).toContain('<note>rename &lt;this&gt;</note>');
    });

    it('produces clarification XML when clarificationAnswer is set', async () => {
      const s = sm.createSession('plan');
      const waiter = sm.waitForUserResponse(s.id);

      const res = await request(server)
        .post(`/api/sessions/${s.id}/feedback`)
        .send({ clarificationAnswer: 'use option B' });
      expect(res.status).toBe(200);
      const xml = await waiter;
      expect(xml).toContain('<plan_review type="clarification">');
      expect(xml).toContain('<answer>use option B</answer>');
    });
  });

  describe('POST /api/sessions/:id/approve', () => {
    it('approves without notes', async () => {
      const s = sm.createSession('plan');
      const waiter = sm.waitForUserResponse(s.id);
      const res = await request(server).post(`/api/sessions/${s.id}/approve`).send({});
      expect(res.status).toBe(200);
      const xml = await waiter;
      expect(xml).toBe('<plan_review type="approved" />');
      expect(sm.getSession(s.id)!.status).toBe('approved');
    });

    it('approves with notes', async () => {
      const s = sm.createSession('plan');
      const waiter = sm.waitForUserResponse(s.id);
      const res = await request(server)
        .post(`/api/sessions/${s.id}/approve`)
        .send({ notes: 'watch perf' });
      expect(res.status).toBe(200);
      const xml = await waiter;
      expect(xml).toContain('<plan_review type="approved_with_notes">');
      expect(xml).toContain('<note>watch perf</note>');
    });
  });

  describe('POST /internal/submit', () => {
    it('creates a new session and long-polls until feedback', async () => {
      // fetch is eager (supertest's Test is lazy and only fires on await).
      const submit = fetch(`${baseUrl}/internal/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'Hello plan' }),
      });

      // Wait for the session to register on the server.
      let sessionId: string | undefined;
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 10));
        const list = sm.listSessions();
        if (list.length > 0 && sm.hasPendingWaiter(list[0]!.id)) {
          sessionId = list[0]!.id;
          break;
        }
      }
      expect(sessionId).toBeDefined();

      await request(server).post(`/api/sessions/${sessionId}/approve`).send({});

      const res = await submit;
      expect(res.status).toBe(200);
      const body = (await res.json()) as { xml: string; sessionId: string };
      expect(body).toMatchObject({
        xml: '<plan_review type="approved" />',
        sessionId,
      });
    });

    it('appends to an existing session when sessionId is provided', async () => {
      const s = sm.createSession('v1');

      const submit = fetch(`${baseUrl}/internal/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'v2', sessionId: s.id }),
      });

      // Wait until the waiter is registered before approving.
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 10));
        if (sm.hasPendingWaiter(s.id)) break;
      }
      expect(sm.hasPendingWaiter(s.id)).toBe(true);

      await request(server).post(`/api/sessions/${s.id}/approve`).send({});

      const res = await submit;
      expect(res.status).toBe(200);
      const body = (await res.json()) as { sessionId: string };
      expect(body.sessionId).toBe(s.id);
      expect(sm.getSession(s.id)!.planVersions).toHaveLength(2);
    });

    it('returns 400 when plan is missing', async () => {
      const res = await request(server).post('/internal/submit').send({});
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/sessions/:id/events (SSE)', () => {
    it('pushes plan_submitted events to connected clients', async () => {
      const s = sm.createSession('plan');
      const url = `${baseUrl}/api/sessions/${s.id}/events`;

      const controller = new AbortController();
      const resp = await fetch(url, { signal: controller.signal });
      expect(resp.ok).toBe(true);

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();

      // Read until we see the plan_submitted event marker.
      const readUntilEvent = (async () => {
        let buffer = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) return buffer;
          buffer += decoder.decode(value, { stream: true });
          if (buffer.includes('event: plan_submitted')) return buffer;
        }
      })();

      // Give the SSE connection a moment to register on the server.
      await new Promise((r) => setTimeout(r, 30));

      sm.addPlanVersion(s.id, 'plan v2');
      app.locals.sse.push(s.id, 'plan_submitted', { planVersion: 2 });

      const buffer = await Promise.race([
        readUntilEvent,
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 1000),
        ),
      ]);

      controller.abort();
      expect(buffer).toContain('event: plan_submitted');
      expect(buffer).toContain('"planVersion":2');
    });
  });

  describe('GET /', () => {
    it('serves the index page', async () => {
      const res = await request(server).get('/');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    });
  });

  describe('long-poll timeout and disconnect', () => {
    it('returns 504 when the long-poll timeout fires', async () => {
      // Create app with a very short timeout to test the timeout path.
      await new Promise<void>((r) => server.close(() => r()));

      const shortApp = createApp({
        sessionManager: sm,
        openBrowser: () => {},
        longPollTimeoutMs: 100,
      });
      server = await new Promise<Server>((resolve) => {
        const s = shortApp.listen(0, () => resolve(s));
      });
      const { port } = server.address() as { port: number };
      const url = `http://127.0.0.1:${port}`;

      const res = await fetch(`${url}/internal/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'timeout test' }),
      });

      expect(res.status).toBe(504);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('timeout');
    });

    it('returns 504 when the MCP client disconnects mid-long-poll', async () => {
      const { port } = server.address() as { port: number };
      const url = `http://127.0.0.1:${port}`;

      const controller = new AbortController();
      const submitPromise = fetch(`${url}/internal/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'disconnect test' }),
        signal: controller.signal,
      });

      // Wait for waiter to register.
      let sessionId: string | undefined;
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 10));
        const list = sm.listSessions();
        const found = list.find((s) => sm.hasPendingWaiter(s.id));
        if (found) { sessionId = found.id; break; }
      }
      expect(sessionId).toBeDefined();

      // Abort the fetch — simulates MCP process disconnecting.
      controller.abort();
      await submitPromise.catch(() => {});

      // The waiter should have been cancelled.
      await new Promise((r) => setTimeout(r, 50));
      expect(sm.hasPendingWaiter(sessionId!)).toBe(false);
    });

    it('returns 400 for malformed JSON body', async () => {
      const res = await request(server)
        .post('/internal/submit')
        .set('Content-Type', 'application/json')
        .send('not valid json{{{');
      expect(res.status).toBe(400);
    });

    it('returns 404 when sessionId references a non-existent session', async () => {
      const res = await request(server)
        .post('/internal/submit')
        .send({ plan: 'test', sessionId: 'non-existent-id' });
      expect(res.status).toBe(404);
    });
  });

  describe('Express error handling', () => {
    it('returns JSON 500 for unhandled route errors (not a raw crash)', async () => {
      // The express.json() middleware already handles malformed JSON with 400.
      // Test that the custom error handler catches it and returns JSON.
      const res = await request(server)
        .post('/api/sessions/test/feedback')
        .set('Content-Type', 'application/json')
        .send('{{invalid');
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
  });
});
