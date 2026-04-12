import express, { type Request, type Response, type Express } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import type { SessionManager } from './session-manager.js';
import {
  buildClarificationXml,
  buildFeedbackXml,
  type FeedbackComment,
} from './xml.js';

export interface AppOptions {
  sessionManager: SessionManager;
  /** Called the first time a new session is created via /internal/submit. */
  openBrowser?: (url: string) => void;
  /** Override the browser bundle dir (defaults to ../browser relative to this file). */
  browserDistDir?: string;
  /** Base URL for constructing browser URLs (e.g. "http://127.0.0.1:3456"). */
  baseUrl?: string;
}

type ExpressWithLocals = Express & {
  locals: Express['locals'] & { sessions: SessionManager };
};

export function createApp(opts: AppOptions): ExpressWithLocals {
  const {
    sessionManager,
    openBrowser,
    browserDistDir,
    baseUrl = 'http://127.0.0.1:3456',
  } = opts;

  const app = express() as ExpressWithLocals;
  app.locals.sessions = sessionManager;

  app.use(express.json({ limit: '5mb' }));

  // --- Static browser assets ----------------------------------------------
  const distDir = browserDistDir ?? defaultBrowserDistDir();
  app.get('/', (_req, res) => {
    const indexPath = path.join(distDir, 'index.html');
    if (existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      // Fallback so GET / still succeeds pre-bundle (e.g. early-stage tests).
      res
        .status(200)
        .type('html')
        .send('<!doctype html><title>Plan Reviewer</title><p>Bundle missing.</p>');
    }
  });
  app.get('/app.js', (_req, res) => {
    const p = path.join(distDir, 'app.js');
    if (existsSync(p)) res.type('application/javascript').sendFile(p);
    else res.status(404).end();
  });
  app.get('/styles.css', (_req, res) => {
    const p = path.join(distDir, 'styles.css');
    if (existsSync(p)) res.type('text/css').sendFile(p);
    else res.status(404).end();
  });

  // --- Session API ---------------------------------------------------------
  app.get('/api/sessions', (_req, res) => {
    res.json({ sessions: sessionManager.listSessions() });
  });

  app.get('/api/sessions/:id', (req, res) => {
    const s = sessionManager.getSession(req.params.id);
    if (!s) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    res.json({ session: s });
  });

  app.post('/api/sessions/:id/feedback', (req, res) => {
    const sessionId = req.params.id;
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    if (session.status !== 'active') {
      res.status(409).json({ error: 'session is not active' });
      return;
    }

    const body = req.body as {
      comments?: FeedbackComment[];
      clarificationAnswer?: string;
    };

    const xml = body.clarificationAnswer
      ? buildClarificationXml(body.clarificationAnswer)
      : buildFeedbackXml(body.comments ?? []);

    sessionManager.addConversationEntry(sessionId, {
      role: 'user',
      type: body.clarificationAnswer ? 'clarification' : 'feedback',
      content: xml,
    });
    res.json({ ok: true });
  });

  app.post('/api/sessions/:id/approve', (req, res) => {
    const sessionId = req.params.id;
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    const notes = (req.body as { notes?: string }).notes;
    sessionManager.markApproved(sessionId, notes);
    res.json({ ok: true });
  });

  // --- Internal MCP bridge (non-blocking) -----------------------------------
  // Used by secondary MCP server instances (when another instance already owns
  // the HTTP port). Creates or updates a session and returns immediately.
  app.post('/internal/submit', (req: Request, res: Response) => {
    const { plan, sessionId } = (req.body ?? {}) as {
      plan?: string;
      sessionId?: string;
    };
    if (!plan || typeof plan !== 'string') {
      res.status(400).json({ error: 'plan is required' });
      return;
    }

    let session;
    try {
      if (sessionId) {
        const existing = sessionManager.getSession(sessionId);
        if (!existing) {
          res.status(404).json({ error: 'session not found' });
          return;
        }
        session = sessionManager.addPlanVersion(sessionId, plan);
      } else {
        session = sessionManager.createSession(plan);
        openBrowser?.(`${baseUrl}?session=${session.id}`);
      }
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
      return;
    }

    res.json({
      sessionId: session.id,
      url: `${baseUrl}?session=${session.id}`,
      version: session.planVersions.length,
    });
  });

  // --- Global error handler ---------------------------------------------------
  // Catches JSON parse errors from express.json() and any unexpected throws so
  // they always return structured JSON (not Express's default HTML).
  app.use(
    (
      err: Error & { status?: number; type?: string },
      _req: Request,
      res: Response,
      _next: express.NextFunction,
    ) => {
      const status = err.status ?? 500;
      res.status(status).json({ error: err.message || 'internal error' });
    },
  );

  return app;
}

function defaultBrowserDistDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, 'browser');
}
