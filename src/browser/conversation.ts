/**
 * Conversation history panel: shows the sequence of plan submissions,
 * feedback, approvals, and clarifications for the current session.
 */

import { formatPreview } from '../conversation-preview.js';

interface ConvEntry {
  role: string;
  type: string;
  content: string;
  timestamp: string;
  planVersion?: number;
}

export function renderConversation(
  container: HTMLElement,
  entries: readonly ConvEntry[],
): void {
  container.replaceChildren();

  if (entries.length === 0) return;

  for (const entry of entries) {
    const el = document.createElement('div');
    el.className = 'conversation__entry';
    el.setAttribute('data-conversation-entry', '');
    el.setAttribute('data-role', entry.role);
    el.setAttribute('data-type', entry.type);

    const header = document.createElement('div');
    header.className = 'conversation__header';

    const roleEl = document.createElement('span');
    roleEl.className = 'conversation__role';
    roleEl.textContent = entry.role === 'claude' ? 'Claude' : 'You';

    const typeEl = document.createElement('span');
    typeEl.className = 'conversation__type';
    typeEl.textContent = labelForType(entry.type, entry.planVersion);

    const timeEl = document.createElement('time');
    timeEl.className = 'conversation__time';
    timeEl.dateTime = entry.timestamp;
    timeEl.textContent = formatTime(entry.timestamp);

    header.append(roleEl, typeEl, timeEl);
    el.appendChild(header);

    // Show a short preview of the content (not the full plan).
    if (entry.type !== 'plan') {
      const preview = document.createElement('p');
      preview.className = 'conversation__preview';
      preview.textContent = truncate(formatPreview(entry.type, entry.content), 120);
      el.appendChild(preview);
    }

    container.appendChild(el);
  }
}

function labelForType(type: string, planVersion?: number): string {
  switch (type) {
    case 'plan':
      return planVersion ? `Plan v${planVersion}` : 'Plan';
    case 'feedback':
      return 'Feedback';
    case 'approval':
      return 'Approved';
    case 'clarification':
      return 'Clarification';
    default:
      return type;
  }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '…';
}
