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
    await sm.flush();
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

    it('active sessions on disk remain active after reload', async () => {
      const s = sm.createSession('plan');
      expect(s.status).toBe('active');
      await sm.flush();

      const sm2 = new SessionManager({ storageDir });
      await sm2.init();
      const loaded = sm2.getSession(s.id);
      expect(loaded!.status).toBe('active');
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

  describe('getLatestFeedback', () => {
    it('returns null when only a plan entry exists (no user response yet)', () => {
      const s = sm.createSession('plan v1');
      expect(sm.getLatestFeedback(s.id)).toBeNull();
    });

    it('returns the user feedback entry that follows the last plan', () => {
      const s = sm.createSession('plan v1');
      sm.addConversationEntry(s.id, {
        role: 'user',
        type: 'feedback',
        content: 'looks good but needs a section on rollback',
      });
      const feedback = sm.getLatestFeedback(s.id);
      expect(feedback).not.toBeNull();
      expect(feedback!.role).toBe('user');
      expect(feedback!.type).toBe('feedback');
      expect(feedback!.content).toBe('looks good but needs a section on rollback');
    });

    it('returns null after a new plan version is added (no feedback for latest version yet)', () => {
      const s = sm.createSession('plan v1');
      sm.addConversationEntry(s.id, {
        role: 'user',
        type: 'feedback',
        content: 'needs more detail',
      });
      // Author submits a revised plan; feedback above is now "before" the latest plan
      sm.addPlanVersion(s.id, 'plan v2 with more detail');
      expect(sm.getLatestFeedback(s.id)).toBeNull();
    });

    it('returns the approval entry when the session has been approved', () => {
      const s = sm.createSession('plan v1');
      sm.markApproved(s.id, 'ship it');
      const feedback = sm.getLatestFeedback(s.id);
      expect(feedback).not.toBeNull();
      expect(feedback!.role).toBe('user');
      expect(feedback!.type).toBe('approval');
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
