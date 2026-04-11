/**
 * Submission controls for the Plan Reviewer browser app.
 *
 * Once the user is satisfied with their draft comments they have three ways
 * to resolve the blocking plan-review bridge:
 *   - **Send Feedback** — POSTs the current draft comments to
 *     `/api/sessions/:id/feedback`, which the daemon serializes into the
 *     `<plan_review type="feedback">` XML the MCP tool call returns.
 *   - **Approve** — POSTs to `/api/sessions/:id/approve` with no body,
 *     returning `<plan_review type="approved" />`.
 *   - **Approve with Notes** — opens an inline notes editor and POSTs the
 *     notes, returning `<plan_review type="approved_with_notes">…`.
 *
 * All three actions are terminal for this plan version: after a successful
 * submission the controls collapse to a status line so the user can't
 * accidentally resolve the same waiter twice.
 */

export interface CommentSource {
  getComments(): ReadonlyArray<{ anchor: string; note: string }>;
}

interface FeedbackControllerOpts {
  container: HTMLElement;
  sessionId: string;
  source: CommentSource;
}

type ViewState = 'idle' | 'notes' | 'submitted';

export class FeedbackController {
  private readonly container: HTMLElement;
  private readonly sessionId: string;
  private readonly source: CommentSource;
  private state: ViewState = 'idle';
  private statusMessage = '';

  constructor(opts: FeedbackControllerOpts) {
    this.container = opts.container;
    this.sessionId = opts.sessionId;
    this.source = opts.source;
  }

  /** Render the controls and return. Call again on external state changes. */
  render(): void {
    this.container.replaceChildren();
    if (this.state === 'submitted') {
      this.renderSubmitted();
    } else if (this.state === 'notes') {
      this.renderNotesForm();
    } else {
      this.renderIdle();
    }
  }

  private renderIdle(): void {
    const row = document.createElement('div');
    row.className = 'feedback-controls__row';

    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.setAttribute('data-action', 'send-feedback');
    sendBtn.textContent = 'Send Feedback';
    sendBtn.disabled = this.source.getComments().length === 0;
    sendBtn.addEventListener('click', () => {
      void this.sendFeedback();
    });

    const approveBtn = document.createElement('button');
    approveBtn.type = 'button';
    approveBtn.setAttribute('data-action', 'approve');
    approveBtn.textContent = 'Approve';
    approveBtn.addEventListener('click', () => {
      void this.approve();
    });

    const approveNotesBtn = document.createElement('button');
    approveNotesBtn.type = 'button';
    approveNotesBtn.setAttribute('data-action', 'approve-with-notes');
    approveNotesBtn.textContent = 'Approve with Notes';
    approveNotesBtn.addEventListener('click', () => {
      this.state = 'notes';
      this.render();
    });

    row.append(sendBtn, approveBtn, approveNotesBtn);
    this.container.appendChild(row);
  }

  private renderNotesForm(): void {
    const form = document.createElement('form');
    form.className = 'feedback-controls__notes';

    const heading = document.createElement('h3');
    heading.textContent = 'Approval notes';
    form.appendChild(heading);

    const textarea = document.createElement('textarea');
    textarea.setAttribute('data-notes-editor', '');
    textarea.rows = 3;
    textarea.required = true;
    form.appendChild(textarea);

    const actions = document.createElement('div');
    actions.className = 'feedback-controls__actions';

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.setAttribute('data-action', 'submit-notes');
    submit.textContent = 'Submit approval';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.setAttribute('data-action', 'cancel-notes');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      this.state = 'idle';
      this.render();
    });

    actions.append(submit, cancel);
    form.appendChild(actions);

    form.addEventListener('submit', (evt) => {
      evt.preventDefault();
      const notes = textarea.value.trim();
      if (notes.length === 0) return;
      void this.approve(notes);
    });

    this.container.appendChild(form);
    textarea.focus();
  }

  private renderSubmitted(): void {
    const p = document.createElement('p');
    p.className = 'feedback-controls__status';
    p.setAttribute('data-submission-status', '');
    p.textContent = this.statusMessage;
    this.container.appendChild(p);
  }

  private async sendFeedback(): Promise<void> {
    const comments = this.source.getComments();
    if (comments.length === 0) return;
    const payload = {
      comments: comments.map((c) => ({ anchor: c.anchor, note: c.note })),
    };
    const ok = await this.post('feedback', payload);
    if (ok) {
      const n = comments.length;
      this.finish(`Feedback sent (${n} comment${n === 1 ? '' : 's'}).`);
    }
  }

  private async approve(notes?: string): Promise<void> {
    const body = notes ? { notes } : {};
    const ok = await this.post('approve', body);
    if (ok) {
      this.finish(notes ? 'Plan approved with notes.' : 'Plan approved.');
    }
  }

  private async post(endpoint: string, body: unknown): Promise<boolean> {
    const url = `/api/sessions/${encodeURIComponent(this.sessionId)}/${endpoint}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private finish(message: string): void {
    this.state = 'submitted';
    this.statusMessage = message;
    this.render();
  }
}
