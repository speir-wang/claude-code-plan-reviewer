import { renderPlan } from './plan-display.js';
import { AnnotationController } from './annotation.js';
import { FeedbackController, type CommentSource } from './feedback.js';
import { renderDiffView, renderPriorComments } from './diff-view.js';
import type { Comment } from '../types.js';

interface SessionPlanVersion {
  version: number;
  text: string;
  comments?: Comment[];
}

interface SessionResponse {
  session: {
    id: string;
    planVersions: SessionPlanVersion[];
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
  if (
    !(planContainer instanceof HTMLElement) ||
    !(commentsPanel instanceof HTMLElement) ||
    !(feedbackContainer instanceof HTMLElement)
  ) {
    return;
  }

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
}

void main();
