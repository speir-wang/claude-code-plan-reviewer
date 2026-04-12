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

  beforeEach(async () => {
    storageDir = await mkdtemp(path.join(tmpdir(), 'plan-reviewer-http-'));
    sm = new SessionManager({ storageDir });
    await sm.init();
    app = createApp({ sessionManager: sm, openBrowser: () => {} });
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
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
    it('stores feedback XML for an active session', async () => {
      const s = sm.createSession('plan');

      const res = await request(server)
        .post(`/api/sessions/${s.id}/feedback`)
        .send({
          comments: [
            { anchor: 'foo', note: 'please clarify' },
            { anchor: 'bar & baz', note: 'rename <this>' },
          ],
        });
      expect(res.status).toBe(200);

      const updated = sm.getSession(s.id)!;
      const entry = updated.conversation.at(-1)!;
      expect(entry.type).toBe('feedback');
      expect(entry.content).toContain('<plan_review type="feedback">');
      expect(entry.content).toContain('<anchor>foo</anchor>');
      expect(entry.content).toContain('<note>please clarify</note>');
      // XML escapes
      expect(entry.content).toContain('<anchor>bar &amp; baz</anchor>');
      expect(entry.content).toContain('<note>rename &lt;this&gt;</note>');
    });

    it('produces clarification XML when clarificationAnswer is set', async () => {
      const s = sm.createSession('plan');

      const res = await request(server)
        .post(`/api/sessions/${s.id}/feedback`)
        .send({ clarificationAnswer: 'use option B' });
      expect(res.status).toBe(200);

      const updated = sm.getSession(s.id)!;
      const entry = updated.conversation.at(-1)!;
      expect(entry.type).toBe('clarification');
      expect(entry.content).toContain('<plan_review type="clarification">');
      expect(entry.content).toContain('<answer>use option B</answer>');
    });

    it('returns 409 if session is not active', async () => {
      const s = sm.createSession('plan');
      sm.markApproved(s.id);

      const res = await request(server)
        .post(`/api/sessions/${s.id}/feedback`)
        .send({ comments: [] });
      expect(res.status).toBe(409);
    });
  });

  describe('POST /api/sessions/:id/approve', () => {
    it('approves without notes', async () => {
      const s = sm.createSession('plan');
      const res = await request(server).post(`/api/sessions/${s.id}/approve`).send({});
      expect(res.status).toBe(200);
      expect(sm.getSession(s.id)!.status).toBe('approved');
    });

    it('approves with notes', async () => {
      const s = sm.createSession('plan');
      const res = await request(server)
        .post(`/api/sessions/${s.id}/approve`)
        .send({ notes: 'watch perf' });
      expect(res.status).toBe(200);
      expect(sm.getSession(s.id)!.status).toBe('approved');
    });
  });

  describe('POST /internal/submit', () => {
    it('creates a new session and returns immediately with sessionId, url, version', async () => {
      const res = await request(server)
        .post('/internal/submit')
        .send({ plan: 'Hello plan' });
      expect(res.status).toBe(200);
      const body = res.body as { sessionId: string; url: string; version: number };
      expect(body.sessionId).toBeDefined();
      expect(body.url).toContain(body.sessionId);
      expect(body.version).toBe(1);

      // Session should now exist in the manager.
      expect(sm.getSession(body.sessionId)).toBeDefined();
    });

    it('appends to an existing session when sessionId is provided, returning version 2', async () => {
      const s = sm.createSession('v1');

      const res = await request(server)
        .post('/internal/submit')
        .send({ plan: 'v2', sessionId: s.id });
      expect(res.status).toBe(200);
      const body = res.body as { sessionId: string; url: string; version: number };
      expect(body.sessionId).toBe(s.id);
      expect(body.version).toBe(2);
      expect(sm.getSession(s.id)!.planVersions).toHaveLength(2);
    });

    it('returns 400 when plan is missing', async () => {
      const res = await request(server).post('/internal/submit').send({});
      expect(res.status).toBe(400);
    });

    it('returns 404 when sessionId references a non-existent session', async () => {
      const res = await request(server)
        .post('/internal/submit')
        .send({ plan: 'test', sessionId: 'non-existent-id' });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /', () => {
    it('serves the index page', async () => {
      const res = await request(server).get('/');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    });
  });

  describe('Express error handling', () => {
    it('returns JSON 400 for malformed JSON body', async () => {
      // The express.json() middleware handles malformed JSON with 400.
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
