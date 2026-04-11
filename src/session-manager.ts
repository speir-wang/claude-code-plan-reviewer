import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { homedir } from 'node:os';
import type {
  ConversationEntry,
  PlanVersion,
  Session,
  SessionApproval,
} from './types.js';

export interface SessionManagerOptions {
  storageDir?: string;
}

export const DEFAULT_STORAGE_DIR = path.join(homedir(), '.plan-reviewer', 'sessions');

type Resolver = (xml: string) => void;
type Rejecter = (err: Error) => void;

interface PendingWaiter {
  resolve: Resolver;
  reject: Rejecter;
}

/**
 * SessionManager is the single source of truth for plan-review sessions.
 * It owns session lifecycle, disk persistence, and the blocking bridge that
 * connects an in-flight MCP tool call to the user's eventual browser response.
 */
export class SessionManager {
  private readonly storageDir: string;
  private readonly sessions = new Map<string, Session>();
  private readonly pending = new Map<string, PendingWaiter>();
  private readonly writeQueue = new Map<string, Promise<void>>();

  constructor(opts: SessionManagerOptions = {}) {
    this.storageDir = opts.storageDir ?? DEFAULT_STORAGE_DIR;
  }

  async init(): Promise<void> {
    await mkdir(this.storageDir, { recursive: true });
    const entries = await readdir(this.storageDir);
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      try {
        const raw = await readFile(path.join(this.storageDir, name), 'utf8');
        const session = JSON.parse(raw) as Session;
        // Any session found on disk in active state has no live waiter —
        // the broker must have crashed mid-review.
        if (session.status === 'active') {
          session.status = 'interrupted';
          session.updatedAt = new Date().toISOString();
          await this.persist(session);
        }
        this.sessions.set(session.id, session);
      } catch {
        // Skip malformed files silently; surface via a future error channel.
      }
    }
  }

  createSession(planText: string): Session {
    const now = new Date().toISOString();
    const id = randomUUID();
    const firstVersion: PlanVersion = {
      version: 1,
      text: planText,
      timestamp: now,
      comments: [],
    };
    const session: Session = {
      id,
      createdAt: now,
      updatedAt: now,
      status: 'active',
      planVersions: [firstVersion],
      conversation: [
        {
          role: 'claude',
          type: 'plan',
          content: planText,
          timestamp: now,
          planVersion: 1,
        },
      ],
    };
    this.sessions.set(id, session);
    this.schedulePersist(session);
    return session;
  }

  addPlanVersion(sessionId: string, planText: string): Session {
    const session = this.requireSession(sessionId);
    const now = new Date().toISOString();
    const nextVersion = session.planVersions.length + 1;
    session.planVersions.push({
      version: nextVersion,
      text: planText,
      timestamp: now,
      comments: [],
    });
    session.conversation.push({
      role: 'claude',
      type: 'plan',
      content: planText,
      timestamp: now,
      planVersion: nextVersion,
    });
    session.status = 'active';
    session.updatedAt = now;
    this.schedulePersist(session);
    return session;
  }

  addConversationEntry(
    sessionId: string,
    entry: Omit<ConversationEntry, 'timestamp'> & { timestamp?: string },
  ): Session {
    const session = this.requireSession(sessionId);
    const now = entry.timestamp ?? new Date().toISOString();
    session.conversation.push({ ...entry, timestamp: now });
    session.updatedAt = now;
    this.schedulePersist(session);
    return session;
  }

  markApproved(sessionId: string, notes?: string): Session {
    const session = this.requireSession(sessionId);
    const approval: SessionApproval = notes
      ? { type: 'approved_with_notes', notes }
      : { type: 'approved' };
    session.approval = approval;
    session.status = 'approved';
    session.updatedAt = new Date().toISOString();
    session.conversation.push({
      role: 'user',
      type: 'approval',
      content: notes ?? '',
      timestamp: session.updatedAt,
    });
    this.schedulePersist(session);
    return session;
  }

  /** Awaits any in-flight writes. Tests and shutdown should call this. */
  async flush(): Promise<void> {
    await Promise.allSettled(this.writeQueue.values());
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(): Session[] {
    return [...this.sessions.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  /**
   * Blocking bridge: the MCP process awaits this Promise while the user
   * reviews the plan in the browser. It resolves when the browser POSTs
   * feedback or approval.
   *
   * If a second waiter registers for the same session (e.g. the tool is
   * called again before the first response arrives), the earlier waiter is
   * rejected with a "superseded" error so no Promise is orphaned.
   */
  waitForUserResponse(sessionId: string): Promise<string> {
    const existing = this.pending.get(sessionId);
    if (existing) {
      existing.reject(new Error('waiter superseded by a newer submission'));
      this.pending.delete(sessionId);
    }
    return new Promise<string>((resolve, reject) => {
      this.pending.set(sessionId, { resolve, reject });
    });
  }

  resolveSession(sessionId: string, xmlResponse: string): boolean {
    const waiter = this.pending.get(sessionId);
    if (!waiter) return false;
    this.pending.delete(sessionId);
    waiter.resolve(xmlResponse);
    return true;
  }

  cancelWaiter(sessionId: string, reason: string): boolean {
    const waiter = this.pending.get(sessionId);
    if (!waiter) return false;
    this.pending.delete(sessionId);
    waiter.reject(new Error(reason));
    return true;
  }

  hasPendingWaiter(sessionId: string): boolean {
    return this.pending.has(sessionId);
  }

  private requireSession(sessionId: string): Session {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`session not found: ${sessionId}`);
    return s;
  }

  /**
   * Queue a write serialized per session. Each session's writes form a chain
   * so snapshots are never interleaved. Callers do not await individual writes
   * (those would propagate async-ness through the whole API); tests and
   * shutdown call {@link flush} to drain the queue.
   */
  private schedulePersist(session: Session): void {
    const prev = this.writeQueue.get(session.id) ?? Promise.resolve();
    // Clone inside the closure so later mutations don't race with serialization.
    const snapshot = JSON.parse(JSON.stringify(session)) as Session;
    const next = prev
      .catch(() => undefined)
      .then(() => this.persist(snapshot));
    this.writeQueue.set(session.id, next);
    // Drop from the queue once done so flush() doesn't hold references forever.
    next.finally(() => {
      if (this.writeQueue.get(session.id) === next) {
        this.writeQueue.delete(session.id);
      }
    });
  }

  private async persist(session: Session): Promise<void> {
    const file = path.join(this.storageDir, `${session.id}.json`);
    await writeFile(file, JSON.stringify(session, null, 2), 'utf8');
  }
}
