import type { Response } from 'express';

/**
 * Tracks Server-Sent Event subscribers per session and broadcasts events to
 * them. Also owns a global subscriber channel used by the sidebar to refresh
 * its session list.
 */
export class SseManager {
  private readonly perSession = new Map<string, Set<Response>>();
  private readonly global = new Set<Response>();
  private readonly heartbeatInterval: NodeJS.Timeout;

  constructor(heartbeatMs = 30_000) {
    this.heartbeatInterval = setInterval(() => this.heartbeat(), heartbeatMs);
    // Do not keep the event loop alive just for heartbeats.
    this.heartbeatInterval.unref();
  }

  attachSession(sessionId: string, res: Response): void {
    this.initStream(res);
    let set = this.perSession.get(sessionId);
    if (!set) {
      set = new Set();
      this.perSession.set(sessionId, set);
    }
    set.add(res);
    res.on('close', () => {
      set!.delete(res);
      if (set!.size === 0) this.perSession.delete(sessionId);
    });
  }

  attachGlobal(res: Response): void {
    this.initStream(res);
    this.global.add(res);
    res.on('close', () => this.global.delete(res));
  }

  push(sessionId: string, event: string, data: unknown): void {
    const payload = this.format(event, data);
    const subs = this.perSession.get(sessionId);
    if (subs) for (const res of subs) this.safeWrite(res, payload);
    // Sidebar also wants to know about any session update.
    for (const res of this.global) this.safeWrite(res, payload);
  }

  pushGlobal(event: string, data: unknown): void {
    const payload = this.format(event, data);
    for (const res of this.global) this.safeWrite(res, payload);
  }

  close(): void {
    clearInterval(this.heartbeatInterval);
    for (const set of this.perSession.values()) {
      for (const res of set) res.end();
    }
    for (const res of this.global) res.end();
    this.perSession.clear();
    this.global.clear();
  }

  private initStream(res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(': connected\n\n');
  }

  private format(event: string, data: unknown): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  /** Write to an SSE stream, silently ignoring broken-pipe errors. */
  private safeWrite(res: Response, payload: string): void {
    try {
      if (!res.writableEnded) res.write(payload);
    } catch {
      // Client already disconnected; the 'close' handler will clean up.
    }
  }

  private heartbeat(): void {
    const ping = ': ping\n\n';
    for (const set of this.perSession.values()) {
      for (const res of set) this.safeWrite(res, ping);
    }
    for (const res of this.global) this.safeWrite(res, ping);
  }
}
