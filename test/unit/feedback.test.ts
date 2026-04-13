// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { FeedbackController } from '../../src/browser/feedback.js';

/** Flush all pending microtask chains (mocked fetch Promises). */
async function flushPromises(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

afterEach(() => {
  vi.restoreAllMocks();
});

function makeSource(comments: { anchor: string; note: string }[] = []) {
  return {
    getComments: () => comments,
  };
}

function makeOpts(overrides: Partial<{
  comments: { anchor: string; note: string }[];
  sessionId: string;
}> = {}) {
  const container = document.createElement('div');
  const source = makeSource(overrides.comments ?? []);
  const sessionId = overrides.sessionId ?? 'session-abc';
  const ctrl = new FeedbackController({ container, sessionId, source });
  return { container, ctrl, source, sessionId };
}

function mockFetch(ok = true) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok,
    json: async () => ({}),
  } as Response);
}

describe('FeedbackController - idle state', () => {
  it('renders 3 buttons: Send Feedback, Approve, Approve with Notes', () => {
    const { container, ctrl } = makeOpts();
    ctrl.render();
    const buttons = container.querySelectorAll('button');
    const labels = Array.from(buttons).map((b) => b.textContent);
    expect(labels).toContain('Send Feedback');
    expect(labels).toContain('Approve');
    expect(labels).toContain('Approve with Notes');
  });

  it('Send Feedback is disabled when source has no comments', () => {
    const { container, ctrl } = makeOpts({ comments: [] });
    ctrl.render();
    const sendBtn = container.querySelector('[data-action="send-feedback"]') as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });

  it('Send Feedback is enabled when source has comments', () => {
    const { container, ctrl } = makeOpts({ comments: [{ anchor: 'foo', note: 'bar' }] });
    ctrl.render();
    const sendBtn = container.querySelector('[data-action="send-feedback"]') as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(false);
  });

  it('re-render updates disabled state', () => {
    const comments: { anchor: string; note: string }[] = [];
    const container = document.createElement('div');
    const source = { getComments: () => comments };
    const ctrl = new FeedbackController({ container, sessionId: 'x', source });

    ctrl.render();
    expect((container.querySelector('[data-action="send-feedback"]') as HTMLButtonElement).disabled).toBe(true);

    comments.push({ anchor: 'a', note: 'b' });
    ctrl.render();
    expect((container.querySelector('[data-action="send-feedback"]') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('FeedbackController - notes state', () => {
  it('"Approve with Notes" click transitions to notes form with textarea', () => {
    const { container, ctrl } = makeOpts();
    ctrl.render();
    const notesBtn = container.querySelector('[data-action="approve-with-notes"]') as HTMLButtonElement;
    notesBtn.click();
    expect(container.querySelector('textarea[data-notes-editor]')).not.toBeNull();
    expect(container.querySelector('[data-action="submit-notes"]')).not.toBeNull();
    expect(container.querySelector('[data-action="cancel-notes"]')).not.toBeNull();
  });

  it('Cancel in notes form goes back to idle', () => {
    const { container, ctrl } = makeOpts();
    ctrl.render();
    (container.querySelector('[data-action="approve-with-notes"]') as HTMLButtonElement).click();
    expect(container.querySelector('textarea[data-notes-editor]')).not.toBeNull();

    (container.querySelector('[data-action="cancel-notes"]') as HTMLButtonElement).click();
    expect(container.querySelector('textarea[data-notes-editor]')).toBeNull();
    expect(container.querySelector('[data-action="approve"]')).not.toBeNull();
  });

  it('empty notes (trimmed) does not submit', async () => {
    const fetchSpy = mockFetch();
    const { container, ctrl } = makeOpts();
    ctrl.render();
    (container.querySelector('[data-action="approve-with-notes"]') as HTMLButtonElement).click();

    const textarea = container.querySelector('textarea[data-notes-editor]') as HTMLTextAreaElement;
    textarea.value = '   ';
    container.querySelector('form')!.dispatchEvent(new Event('submit'));

    await flushPromises();
    expect(fetchSpy).not.toHaveBeenCalled();
    // Still in notes state
    expect(container.querySelector('textarea[data-notes-editor]')).not.toBeNull();
  });
});

describe('FeedbackController - submitted state', () => {
  it('after sendFeedback: shows status message, no buttons', async () => {
    const fetchSpy = mockFetch(true);
    const { container, ctrl } = makeOpts({ comments: [{ anchor: 'a', note: 'b' }] });
    ctrl.render();

    (container.querySelector('[data-action="send-feedback"]') as HTMLButtonElement).click();
    await flushPromises();

    expect(container.querySelector('[data-submission-status]')).not.toBeNull();
    expect(container.querySelector('[data-action="send-feedback"]')).toBeNull();
    fetchSpy.mockRestore();
  });

  it('singular: shows "Feedback sent (1 comment)."', async () => {
    const fetchSpy = mockFetch(true);
    const { container, ctrl } = makeOpts({ comments: [{ anchor: 'a', note: 'b' }] });
    ctrl.render();
    (container.querySelector('[data-action="send-feedback"]') as HTMLButtonElement).click();
    await flushPromises();

    const status = container.querySelector('[data-submission-status]');
    expect(status!.textContent).toBe('Feedback sent (1 comment).');
    fetchSpy.mockRestore();
  });

  it('plural: shows "Feedback sent (3 comments)."', async () => {
    const fetchSpy = mockFetch(true);
    const { container, ctrl } = makeOpts({
      comments: [
        { anchor: 'a', note: 'note1' },
        { anchor: 'b', note: 'note2' },
        { anchor: 'c', note: 'note3' },
      ],
    });
    ctrl.render();
    (container.querySelector('[data-action="send-feedback"]') as HTMLButtonElement).click();
    await flushPromises();

    const status = container.querySelector('[data-submission-status]');
    expect(status!.textContent).toBe('Feedback sent (3 comments).');
    fetchSpy.mockRestore();
  });
});

describe('FeedbackController - POST behavior', () => {
  it('sendFeedback POSTs to correct URL with comments payload', async () => {
    const fetchSpy = mockFetch(true);
    const { container, ctrl, sessionId } = makeOpts({
      comments: [{ anchor: 'foo', note: 'bar' }],
    });
    ctrl.render();
    (container.querySelector('[data-action="send-feedback"]') as HTMLButtonElement).click();
    await flushPromises();

    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/sessions/${encodeURIComponent(sessionId)}/feedback`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ comments: [{ anchor: 'foo', note: 'bar' }] }),
      }),
    );
    fetchSpy.mockRestore();
  });

  it('approve POSTs to approve endpoint without notes', async () => {
    const fetchSpy = mockFetch(true);
    const { container, ctrl, sessionId } = makeOpts();
    ctrl.render();
    (container.querySelector('[data-action="approve"]') as HTMLButtonElement).click();
    await flushPromises();

    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/sessions/${encodeURIComponent(sessionId)}/approve`,
      expect.objectContaining({ method: 'POST' }),
    );
    fetchSpy.mockRestore();
  });

  it('approve with notes POSTs notes to approve endpoint', async () => {
    const fetchSpy = mockFetch(true);
    const { container, ctrl, sessionId } = makeOpts();
    ctrl.render();
    (container.querySelector('[data-action="approve-with-notes"]') as HTMLButtonElement).click();

    const textarea = container.querySelector('textarea[data-notes-editor]') as HTMLTextAreaElement;
    textarea.value = 'my approval notes';
    container.querySelector('form')!.dispatchEvent(new Event('submit'));
    await flushPromises();

    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/sessions/${encodeURIComponent(sessionId)}/approve`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ notes: 'my approval notes' }),
      }),
    );
    fetchSpy.mockRestore();
  });

  it('network error does not transition to submitted state', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));
    const { container, ctrl } = makeOpts({ comments: [{ anchor: 'a', note: 'b' }] });
    ctrl.render();
    (container.querySelector('[data-action="send-feedback"]') as HTMLButtonElement).click();
    await flushPromises();

    expect(container.querySelector('[data-submission-status]')).toBeNull();
    expect(container.querySelector('[data-action="send-feedback"]')).not.toBeNull();
  });

  it('non-ok response does not transition to submitted state', async () => {
    mockFetch(false);
    const { container, ctrl } = makeOpts({ comments: [{ anchor: 'a', note: 'b' }] });
    ctrl.render();
    (container.querySelector('[data-action="send-feedback"]') as HTMLButtonElement).click();
    await flushPromises();

    expect(container.querySelector('[data-submission-status]')).toBeNull();
    expect(container.querySelector('[data-action="send-feedback"]')).not.toBeNull();
  });

  it('sendFeedback returns early when comments is empty (covers guard branch)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({}),
    } as Response);
    const { container, ctrl } = makeOpts({ comments: [] });
    ctrl.render();
    // Force-fire click via dispatchEvent to bypass disabled button restriction
    const sendBtn = container.querySelector('[data-action="send-feedback"]') as HTMLButtonElement;
    sendBtn.dispatchEvent(new MouseEvent('click'));
    await flushPromises();
    // sendFeedback returned early — fetch was never called
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('approve with non-ok response does not transition to submitted state', async () => {
    mockFetch(false);
    const { container, ctrl } = makeOpts();
    ctrl.render();
    (container.querySelector('[data-action="approve"]') as HTMLButtonElement).click();
    await flushPromises();

    expect(container.querySelector('[data-submission-status]')).toBeNull();
    expect(container.querySelector('[data-action="approve"]')).not.toBeNull();
  });
});
