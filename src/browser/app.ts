import { renderPlan } from './plan-display.js';
import { AnnotationController } from './annotation.js';

interface SessionResponse {
  session: {
    id: string;
    planVersions: { version: number; text: string }[];
  };
}

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
  if (
    !(planContainer instanceof HTMLElement) ||
    !(commentsPanel instanceof HTMLElement)
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
  const latest = data.session.planVersions.at(-1);
  if (!latest) {
    setStatus(planContainer, 'Session has no plan versions yet.');
    return;
  }
  renderPlan(planContainer, latest.text);

  const controller = new AnnotationController(
    planContainer,
    commentsPanel,
    latest.text,
  );
  controller.start();
}

void main();
