import { renderPlan } from './plan-display.js';

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
  const container = document.getElementById('plan-container');
  if (!(container instanceof HTMLElement)) return;

  const sessionId = new URLSearchParams(window.location.search).get('session');
  if (!sessionId) {
    setStatus(container, 'No session selected.');
    return;
  }

  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
  if (res.status === 404) {
    setStatus(container, 'Session not found.');
    return;
  }
  if (!res.ok) {
    setStatus(container, `Failed to load session (HTTP ${res.status}).`);
    return;
  }

  const data = (await res.json()) as SessionResponse;
  const latest = data.session.planVersions.at(-1);
  if (!latest) {
    setStatus(container, 'Session has no plan versions yet.');
    return;
  }
  renderPlan(container, latest.text);
}

void main();
