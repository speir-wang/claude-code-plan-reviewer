import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SessionManager } from '../../src/session-manager.js';

async function makeTempDir(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), 'plan-reviewer-test-'));
}

describe('SessionManager', () => {
  let storageDir: string;
  let sm: SessionManager;

  beforeEach(async () => {
    storageDir = await makeTempDir();
    sm = new SessionManager({ storageDir });
    await sm.init();
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true });
  });

  describe('createSession', () => {
    it('creates an active session with a plan as version 1', () => {
      const s = sm.createSession('Plan A');
      expect(s.id).toMatch(/^[a-z0-9-]+$/i);
      expect(s.status).toBe('active');
      expect(s.planVersions).toHaveLength(1);
      expect(s.planVersions[0]!.version).toBe(1);
      expect(s.planVersions[0]!.text).toBe('Plan A');
      expect(s.planVersions[0]!.comments).toEqual([]);
      expect(s.conversation).toHaveLength(1);
      expect(s.conversation[0]!.role).toBe('claude');
      expect(s.conversation[0]!.type).toBe('plan');
    });

    it('persists new session to disk', async () => {
      const s = sm.createSession('Plan A');
      await sm.flush();
      const files = await readdir(storageDir);
      expect(files).toContain(`${s.id}.json`);
      const raw = JSON.parse(await readFile(path.join(storageDir, `${s.id}.json`), 'utf8'));
      expect(raw.id).toBe(s.id);
    });
  });

  describe('addPlanVersion', () => {
    it('appends a new plan version with incremented number', () => {
      const s = sm.createSession('v1');
      const updated = sm.addPlanVersion(s.id, 'v2');
      expect(updated.planVersions).toHaveLength(2);
      expect(updated.planVersions[1]!.version).toBe(2);
      expect(updated.planVersions[1]!.text).toBe('v2');
      expect(updated.conversation).toHaveLength(2);
    });

    it('throws when session does not exist', () => {
      expect(() => sm.addPlanVersion('nope', 'v2')).toThrow();
    });
  });

  describe('markApproved', () => {
    it('marks session approved with no notes', () => {
      const s = sm.createSession('v1');
      const updated = sm.markApproved(s.id);
      expect(updated.status).toBe('approved');
      expect(updated.approval).toEqual({ type: 'approved' });
    });

    it('marks session approved_with_notes when notes provided', () => {
      const s = sm.createSession('v1');
      const updated = sm.markApproved(s.id, 'ship it but watch perf');
      expect(updated.status).toBe('approved');
      expect(updated.approval).toEqual({
        type: 'approved_with_notes',
        notes: 'ship it but watch perf',
      });
    });
  });

  describe('blocking bridge', () => {
    it('waitForUserResponse resolves when resolveSession is called', async () => {
      const s = sm.createSession('plan');
      const responsePromise = sm.waitForUserResponse(s.id);

      // Resolve on next tick
      setImmediate(() => {
        const ok = sm.resolveSession(s.id, '<plan_review type="approved" />');
        expect(ok).toBe(true);
      });

      const xml = await responsePromise;
      expect(xml).toBe('<plan_review type="approved" />');
    });

    it('resolveSession returns false when no waiter is pending', () => {
      const s = sm.createSession('plan');
      expect(sm.resolveSession(s.id, '<x/>')).toBe(false);
    });

    it('concurrent sessions do not cross-resolve', async () => {
      const a = sm.createSession('A');
      const b = sm.createSession('B');

      const pa = sm.waitForUserResponse(a.id);
      const pb = sm.waitForUserResponse(b.id);

      sm.resolveSession(a.id, 'xml-A');
      // b should still be pending; race it against a short timer
      const bResult = await Promise.race([
        pb,
        new Promise<string>((r) => setTimeout(() => r('STILL_PENDING'), 20)),
      ]);
      expect(bResult).toBe('STILL_PENDING');

      sm.resolveSession(b.id, 'xml-B');
      await expect(pa).resolves.toBe('xml-A');
      await expect(pb).resolves.toBe('xml-B');
    });

    it('waitForUserResponse rejects old waiter if a new one replaces it', async () => {
      const s = sm.createSession('plan');
      const first = sm.waitForUserResponse(s.id);
      const second = sm.waitForUserResponse(s.id);

      // The first waiter should be abandoned / rejected
      await expect(first).rejects.toThrow(/superseded/i);

      sm.resolveSession(s.id, 'xml');
      await expect(second).resolves.toBe('xml');
    });
  });

  describe('persistence and recovery', () => {
    it('loads existing sessions from disk on init', async () => {
      const s = sm.createSession('plan');
      sm.addPlanVersion(s.id, 'plan v2');
      await sm.flush();

      const sm2 = new SessionManager({ storageDir });
      await sm2.init();
      const loaded = sm2.getSession(s.id);
      expect(loaded).toBeDefined();
      expect(loaded!.planVersions).toHaveLength(2);
    });

    it('marks active-on-disk sessions as interrupted on reload (no pending waiter)', async () => {
      const s = sm.createSession('plan');
      expect(s.status).toBe('active');
      await sm.flush();

      const sm2 = new SessionManager({ storageDir });
      await sm2.init();
      const loaded = sm2.getSession(s.id);
      expect(loaded!.status).toBe('interrupted');
    });

    it('listSessions returns sessions sorted by updatedAt desc', async () => {
      const a = sm.createSession('A');
      await new Promise((r) => setTimeout(r, 5));
      const b = sm.createSession('B');
      await new Promise((r) => setTimeout(r, 5));
      sm.addPlanVersion(a.id, 'A v2');
      const list = sm.listSessions();
      expect(list[0]!.id).toBe(a.id); // most recently updated
      expect(list[1]!.id).toBe(b.id);
    });
  });

  describe('addConversationEntry', () => {
    it('appends a user entry', () => {
      const s = sm.createSession('plan');
      const updated = sm.addConversationEntry(s.id, {
        role: 'user',
        type: 'feedback',
        content: '<plan_review/>',
      });
      expect(updated.conversation).toHaveLength(2);
      expect(updated.conversation[1]!.role).toBe('user');
    });
  });

  describe('cancelWaiter', () => {
    it('rejects the pending promise with the given reason', async () => {
      const s = sm.createSession('plan');
      const waiter = sm.waitForUserResponse(s.id);
      const cancelled = sm.cancelWaiter(s.id, 'long-poll timeout');
      expect(cancelled).toBe(true);
      await expect(waiter).rejects.toThrow('long-poll timeout');
    });

    it('returns false when no waiter is pending', () => {
      const s = sm.createSession('plan');
      expect(sm.cancelWaiter(s.id, 'no one home')).toBe(false);
    });

    it('hasPendingWaiter returns false after cancellation', () => {
      const s = sm.createSession('plan');
      sm.waitForUserResponse(s.id).catch(() => {}); // prevent unhandled rejection
      sm.cancelWaiter(s.id, 'test');
      expect(sm.hasPendingWaiter(s.id)).toBe(false);
    });
  });

  describe('interrupted recovery edge cases', () => {
    it('approved sessions on disk stay approved (not marked interrupted)', async () => {
      const s = sm.createSession('plan');
      sm.markApproved(s.id);
      await sm.flush();

      const sm2 = new SessionManager({ storageDir });
      await sm2.init();
      expect(sm2.getSession(s.id)!.status).toBe('approved');
    });

    it('skips malformed JSON files on disk without crashing', async () => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(path.join(storageDir, 'bad.json'), 'not json', 'utf8');

      const sm2 = new SessionManager({ storageDir });
      // Should not throw.
      await sm2.init();
      // Good sessions should still load.
      const s = sm.createSession('plan');
      sm.markApproved(s.id);
      await sm.flush();

      const sm3 = new SessionManager({ storageDir });
      await sm3.init();
      expect(sm3.getSession(s.id)!.status).toBe('approved');
    });
  });
});
