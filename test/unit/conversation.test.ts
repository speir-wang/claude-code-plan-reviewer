// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderConversation } from '../../src/browser/conversation.js';

function makeContainer(): HTMLElement {
  return document.createElement('div');
}

describe('renderConversation', () => {
  it('clears container when entries array is empty', () => {
    const container = makeContainer();
    container.innerHTML = '<p>old content</p>';
    renderConversation(container, []);
    expect(container.children).toHaveLength(0);
  });

  it('renders a plan entry with correct role and type attributes', () => {
    const container = makeContainer();
    renderConversation(container, [
      {
        role: 'claude',
        type: 'plan',
        content: 'some plan',
        timestamp: '2024-01-01T00:00:00Z',
        planVersion: 1,
      },
    ]);
    const entry = container.querySelector('[data-conversation-entry]');
    expect(entry).not.toBeNull();
    expect(entry!.getAttribute('data-role')).toBe('claude');
    expect(entry!.getAttribute('data-type')).toBe('plan');
  });

  it('shows label "Plan v1" when planVersion is set', () => {
    const container = makeContainer();
    renderConversation(container, [
      {
        role: 'claude',
        type: 'plan',
        content: '',
        timestamp: '2024-01-01T00:00:00Z',
        planVersion: 1,
      },
    ]);
    const typeEl = container.querySelector('.conversation__type');
    expect(typeEl!.textContent).toBe('Plan v1');
  });

  it('shows label "Plan" when planVersion is not set', () => {
    const container = makeContainer();
    renderConversation(container, [
      { role: 'claude', type: 'plan', content: '', timestamp: '2024-01-01T00:00:00Z' },
    ]);
    const typeEl = container.querySelector('.conversation__type');
    expect(typeEl!.textContent).toBe('Plan');
  });

  it('shows "Feedback" label for feedback type', () => {
    const container = makeContainer();
    renderConversation(container, [
      { role: 'user', type: 'feedback', content: '<plan_review type="feedback"></plan_review>', timestamp: '2024-01-01T00:00:00Z' },
    ]);
    const typeEl = container.querySelector('.conversation__type');
    expect(typeEl!.textContent).toBe('Feedback');
  });

  it('shows "Approved" label for approval type', () => {
    const container = makeContainer();
    renderConversation(container, [
      { role: 'user', type: 'approval', content: '<plan_review type="approved" />', timestamp: '2024-01-01T00:00:00Z' },
    ]);
    const typeEl = container.querySelector('.conversation__type');
    expect(typeEl!.textContent).toBe('Approved');
  });

  it('shows "Clarification" label for clarification type', () => {
    const container = makeContainer();
    renderConversation(container, [
      {
        role: 'user',
        type: 'clarification',
        content: '<plan_review type="clarification"><answer>yes</answer></plan_review>',
        timestamp: '2024-01-01T00:00:00Z',
      },
    ]);
    const typeEl = container.querySelector('.conversation__type');
    expect(typeEl!.textContent).toBe('Clarification');
  });

  it('falls through to raw type string for unknown types', () => {
    const container = makeContainer();
    renderConversation(container, [
      { role: 'user', type: 'unknown_type', content: 'raw', timestamp: '2024-01-01T00:00:00Z' },
    ]);
    const typeEl = container.querySelector('.conversation__type');
    expect(typeEl!.textContent).toBe('unknown_type');
  });

  it('plan entries do NOT render .conversation__preview', () => {
    const container = makeContainer();
    renderConversation(container, [
      { role: 'claude', type: 'plan', content: 'the plan text', timestamp: '2024-01-01T00:00:00Z' },
    ]);
    expect(container.querySelector('.conversation__preview')).toBeNull();
  });

  it('non-plan entries render preview with truncation at 120 chars', () => {
    // Use type 'approval' so formatPreview returns content as-is (not parsed as XML).
    const longContent = 'x'.repeat(200);
    const container = makeContainer();
    renderConversation(container, [
      { role: 'user', type: 'approval', content: longContent, timestamp: '2024-01-01T00:00:00Z' },
    ]);
    const preview = container.querySelector('.conversation__preview');
    expect(preview).not.toBeNull();
    // Should be truncated to 120 + '…' = 121 chars visible
    expect(preview!.textContent!.length).toBeLessThanOrEqual(130);
    expect(preview!.textContent).toContain('…');
  });

  it('non-plan entries shorter than 120 chars are not truncated', () => {
    const container = makeContainer();
    renderConversation(container, [
      { role: 'user', type: 'feedback', content: 'short feedback', timestamp: '2024-01-01T00:00:00Z' },
    ]);
    const preview = container.querySelector('.conversation__preview');
    expect(preview!.textContent).not.toContain('…');
  });

  it('renders time element with dateTime attribute', () => {
    const ts = '2024-06-15T10:30:00Z';
    const container = makeContainer();
    renderConversation(container, [
      { role: 'claude', type: 'plan', content: '', timestamp: ts },
    ]);
    const timeEl = container.querySelector('time');
    expect(timeEl).not.toBeNull();
    expect(timeEl!.getAttribute('dateTime')).toBe(ts);
  });

  it('renders "Claude" for claude role', () => {
    const container = makeContainer();
    renderConversation(container, [
      { role: 'claude', type: 'plan', content: '', timestamp: '2024-01-01T00:00:00Z' },
    ]);
    const roleEl = container.querySelector('.conversation__role');
    expect(roleEl!.textContent).toBe('Claude');
  });

  it('renders "You" for non-claude role', () => {
    const container = makeContainer();
    renderConversation(container, [
      { role: 'user', type: 'feedback', content: '', timestamp: '2024-01-01T00:00:00Z' },
    ]);
    const roleEl = container.querySelector('.conversation__role');
    expect(roleEl!.textContent).toBe('You');
  });

  it('renders multiple entries in order', () => {
    const container = makeContainer();
    renderConversation(container, [
      { role: 'claude', type: 'plan', content: '', timestamp: '2024-01-01T00:00:00Z' },
      { role: 'user', type: 'feedback', content: 'ok', timestamp: '2024-01-01T00:01:00Z' },
    ]);
    const entries = container.querySelectorAll('[data-conversation-entry]');
    expect(entries).toHaveLength(2);
    expect(entries[0]!.getAttribute('data-type')).toBe('plan');
    expect(entries[1]!.getAttribute('data-type')).toBe('feedback');
  });

  it('calling twice replaces previous content', () => {
    const container = makeContainer();
    renderConversation(container, [
      { role: 'claude', type: 'plan', content: '', timestamp: '2024-01-01T00:00:00Z' },
    ]);
    expect(container.querySelectorAll('[data-conversation-entry]')).toHaveLength(1);
    renderConversation(container, [
      { role: 'claude', type: 'plan', content: '', timestamp: '2024-01-01T00:00:00Z' },
      { role: 'user', type: 'feedback', content: 'ok', timestamp: '2024-01-01T00:01:00Z' },
    ]);
    expect(container.querySelectorAll('[data-conversation-entry]')).toHaveLength(2);
  });

  it('formatTime returns empty string when toLocaleTimeString throws (catch branch)', () => {
    // jsdom's toLocaleTimeString doesn't throw for Invalid Date, so we force a throw.
    vi.spyOn(Date.prototype, 'toLocaleTimeString').mockImplementation(() => {
      throw new RangeError('Invalid time value');
    });
    const container = makeContainer();
    renderConversation(container, [
      { role: 'claude', type: 'plan', content: '', timestamp: '2024-01-01T00:00:00Z' },
    ]);
    const timeEl = container.querySelector('time');
    expect(timeEl).not.toBeNull();
    expect(timeEl!.textContent).toBe('');
    vi.restoreAllMocks();
  });
});
