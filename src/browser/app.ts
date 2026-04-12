import { renderPlan } from './plan-display.js';
import { AnnotationController } from './annotation.js';
import { FeedbackController, type CommentSource } from './feedback.js';
import { renderDiffView, renderPriorComments } from './diff-view.js';
import { Sidebar } from './sidebar.js';
import { renderConversation } from './conversation.js';
import type { Comment } from '../types.js';

interface SessionPlanVersion {
  version: number;
  text: string;
  comments?: Comment[];
}

interface ConvEntry {
  role: string;
  type: string;
  content: string;
  timestamp: string;
  planVersion?: number;
}

interface SessionResponse {
  session: {
    id: string;
    status: string;
    planVersions: SessionPlanVersion[];
    conversation: ConvEntry[];
  };
}

const EMPTY_SOURCE: CommentSource = { getComments: () => [] };

function setStatus(container: HTMLElement, message: string): void {
  container.replaceChildren();
  const p = document.createElement('p');
  p.className = 'plan__status';
  p.textContent = message;
  container.appendChild(p);
}

async function main(): Promise<void> {
  const planContainer = document.getElementById('plan-container');
  const commentsPanel = document.getElementById('comments-panel');
  const feedbackContainer = document.getElementById('feedback-controls');
  const sidebarContainer = document.getElementById('sidebar');
  const conversationContainer = document.getElementById('conversation');
  if (
    !(planContainer instanceof HTMLElement) ||
    !(commentsPanel instanceof HTMLElement) ||
    !(feedbackContainer instanceof HTMLElement) ||
    !(sidebarContainer instanceof HTMLElement) ||
    !(conversationContainer instanceof HTMLElement)
  ) {
    return;
  }

  // Sidebar is always initialized (session list + polling live updates).
  const sidebar = new Sidebar(sidebarContainer);
  void sidebar.init();

  const sessionId = new URLSearchParams(window.location.search).get('session');
  if (!sessionId) {
    setStatus(planContainer, 'No session selected.');
    return;
  }

  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
  if (res.status === 404) {
    setStatus(planContainer, 'Session not found.');
    return;
  }
  if (!res.ok) {
    setStatus(planContainer, `Failed to load session (HTTP ${res.status}).`);
    return;
  }

  const data = (await res.json()) as SessionResponse;
  const versions = data.session.planVersions;
  const latest = versions.at(-1);
  if (!latest) {
    setStatus(planContainer, 'Session has no plan versions yet.');
    return;
  }

  // Conversation history.
  renderConversation(conversationContainer, data.session.conversation);

  const previous = versions.length >= 2 ? versions[versions.length - 2] : undefined;

  if (previous) {
    const segments = renderDiffView(planContainer, previous.text, latest.text);
    renderPriorComments(commentsPanel, previous.comments ?? [], segments);
    const feedback = new FeedbackController({
      container: feedbackContainer,
      sessionId,
      source: EMPTY_SOURCE,
    });
    feedback.render();
  } else {
    renderPlan(planContainer, latest.text);
    const annotation = new AnnotationController(
      planContainer,
      commentsPanel,
      latest.text,
    );
    annotation.start();
    const feedback = new FeedbackController({
      container: feedbackContainer,
      sessionId,
      source: annotation,
    });
    feedback.render();
    annotation.setOnCommentsChanged(() => feedback.render());
  }

  // Poll for new plan versions while session is active.
  if (data.session.status === 'active') {
    setInterval(async () => {
      try {
        const refreshRes = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
        if (!refreshRes.ok) return;
        const refreshData = (await refreshRes.json()) as SessionResponse;
        if (refreshData.session.planVersions.length > versions.length) {
          window.location.reload();
        }
      } catch {
        // Network error — skip this poll cycle.
      }
    }, 3000);
  }
}

void main();
