/**
 * In-browser annotation state: pending comments a user has attached to a
 * plan before submitting them as feedback. Comments are anchored by
 * character range in the raw plan text; when a comment is saved, the
 * corresponding range inside the rendered plan is wrapped with
 * `<mark data-comment-id>` so the user sees which text they've annotated.
 */

export interface DraftComment {
  id: string;
  anchor: string;
  anchorStart: number;
  anchorEnd: number;
  note: string;
}

interface CurrentSelection {
  text: string;
  anchorStart: number;
  anchorEnd: number;
}

export class AnnotationController {
  private readonly planContainer: HTMLElement;
  private readonly commentsPanel: HTMLElement;
  private readonly planText: string;
  private comments: DraftComment[] = [];
  private selection: CurrentSelection | null = null;

  constructor(
    planContainer: HTMLElement,
    commentsPanel: HTMLElement,
    planText: string,
  ) {
    this.planContainer = planContainer;
    this.commentsPanel = commentsPanel;
    this.planText = planText;
  }

  start(): void {
    document.addEventListener('mouseup', this.handleMouseUp);
    this.renderPanel();
  }

  private readonly handleMouseUp = (evt: MouseEvent): void => {
    // Ignore mouseups that happen inside the comments panel. In Chromium,
    // mousedown on a non-editable control (like the "Add comment" button)
    // collapses the current text selection, and the subsequent mouseup
    // would otherwise wipe our pending-selection state before the click
    // handler runs.
    const target = evt.target;
    if (target instanceof Node && this.commentsPanel.contains(target)) {
      return;
    }
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      this.selection = null;
      this.renderPanel();
      return;
    }
    const range = sel.getRangeAt(0);
    const text = sel.toString();
    if (text.length === 0) {
      this.selection = null;
      this.renderPanel();
      return;
    }
    // Walk up from the selection's common ancestor to the enclosing plan block.
    const ancestor = range.commonAncestorContainer;
    const block = findEnclosingBlock(ancestor, this.planContainer);
    if (!block) {
      this.selection = null;
      this.renderPanel();
      return;
    }
    const blockOffset = Number(block.dataset['offset'] ?? '0');
    const blockLength = Number(block.dataset['length'] ?? '0');
    const raw = this.planText.slice(blockOffset, blockOffset + blockLength);
    const idx = raw.indexOf(text);
    if (idx < 0) {
      // The selected rendered text isn't a verbatim substring of the raw
      // markdown (e.g. the user selected across markdown decoration). Fall
      // back to just storing the anchor text; offsets pin to the block start.
      this.selection = {
        text,
        anchorStart: blockOffset,
        anchorEnd: blockOffset + text.length,
      };
    } else {
      this.selection = {
        text,
        anchorStart: blockOffset + idx,
        anchorEnd: blockOffset + idx + text.length,
      };
    }
    this.renderPanel();
  };

  private openEditor(): void {
    if (!this.selection) return;
    const sel = this.selection;
    this.commentsPanel.replaceChildren();
    this.renderCommentList();

    const editorForm = document.createElement('form');
    editorForm.className = 'comments-panel__editor';

    const heading = document.createElement('h3');
    heading.textContent = 'New comment';
    editorForm.appendChild(heading);

    const anchorPreview = document.createElement('blockquote');
    anchorPreview.className = 'comments-panel__anchor';
    anchorPreview.textContent = sel.text;
    editorForm.appendChild(anchorPreview);

    const textarea = document.createElement('textarea');
    textarea.setAttribute('data-comment-editor', '');
    textarea.rows = 3;
    textarea.required = true;
    editorForm.appendChild(textarea);

    const actions = document.createElement('div');
    actions.className = 'comments-panel__actions';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.textContent = 'Save';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      this.selection = null;
      this.renderPanel();
    });

    actions.append(saveBtn, cancelBtn);
    editorForm.appendChild(actions);

    editorForm.addEventListener('submit', (evt) => {
      evt.preventDefault();
      const note = textarea.value.trim();
      if (note.length === 0) return;
      this.addComment(sel, note);
    });

    this.commentsPanel.appendChild(editorForm);
    textarea.focus();
  }

  private addComment(sel: CurrentSelection, note: string): void {
    const comment: DraftComment = {
      id: randomId(),
      anchor: sel.text,
      anchorStart: sel.anchorStart,
      anchorEnd: sel.anchorEnd,
      note,
    };
    this.comments.push(comment);
    this.selection = null;
    this.highlightAnchor(comment);
    this.renderPanel();
  }

  private deleteComment(id: string): void {
    this.comments = this.comments.filter((c) => c.id !== id);
    const mark = this.planContainer.querySelector(`mark[data-comment-id="${id}"]`);
    if (mark?.parentNode) {
      // Replace <mark>…</mark> with its text content.
      mark.replaceWith(document.createTextNode(mark.textContent ?? ''));
    }
    this.renderPanel();
  }

  /**
   * Walk the rendered plan looking for the first text node that contains the
   * anchor text verbatim and wrap it in <mark data-comment-id>. This is a
   * best-effort visual marker — matches are scoped to the owning plan block.
   */
  private highlightAnchor(comment: DraftComment): void {
    const block = this.findBlockContaining(comment.anchorStart);
    if (!block) return;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const idx = node.data.indexOf(comment.anchor);
      if (idx < 0) continue;
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + comment.anchor.length);
      const mark = document.createElement('mark');
      mark.setAttribute('data-comment-id', comment.id);
      try {
        range.surroundContents(mark);
      } catch {
        // Selection spans multiple nodes — skip the visual highlight.
      }
      return;
    }
  }

  private findBlockContaining(offset: number): HTMLElement | null {
    const blocks = this.planContainer.querySelectorAll<HTMLElement>('[data-plan-block]');
    for (const block of blocks) {
      const start = Number(block.dataset['offset'] ?? '0');
      const length = Number(block.dataset['length'] ?? '0');
      if (offset >= start && offset < start + length) return block;
    }
    return null;
  }

  private renderPanel(): void {
    this.commentsPanel.replaceChildren();
    this.renderCommentList();

    const actionArea = document.createElement('div');
    actionArea.className = 'comments-panel__new';

    if (this.selection) {
      const preview = document.createElement('div');
      preview.className = 'comments-panel__selection';

      const label = document.createElement('span');
      label.textContent = 'Selected: ';
      const quoted = document.createElement('q');
      quoted.setAttribute('data-selection-preview', '');
      quoted.textContent = this.selection.text;
      preview.append(label, quoted);

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.textContent = 'Add comment';
      addBtn.addEventListener('click', () => this.openEditor());

      actionArea.append(preview, addBtn);
    } else {
      const placeholder = document.createElement('p');
      placeholder.className = 'comments-panel__placeholder';
      placeholder.setAttribute('data-new-comment-placeholder', '');
      placeholder.textContent =
        'Select text in the plan to attach a comment.';
      actionArea.appendChild(placeholder);
    }

    this.commentsPanel.appendChild(actionArea);
  }

  private renderCommentList(): void {
    const heading = document.createElement('h2');
    heading.textContent = 'Comments';
    this.commentsPanel.appendChild(heading);

    if (this.comments.length === 0) return;

    const list = document.createElement('ul');
    list.className = 'comments-panel__list';
    for (const c of this.comments) {
      const item = document.createElement('li');
      item.setAttribute('data-comment', '');
      item.dataset['commentId'] = c.id;
      item.dataset['anchorStart'] = String(c.anchorStart);
      item.dataset['anchorEnd'] = String(c.anchorEnd);

      const anchor = document.createElement('blockquote');
      anchor.setAttribute('data-anchor', '');
      anchor.textContent = c.anchor;
      item.appendChild(anchor);

      const note = document.createElement('p');
      note.setAttribute('data-comment-note', '');
      note.textContent = c.note;
      item.appendChild(note);

      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = 'Delete';
      del.setAttribute('data-delete', '');
      del.addEventListener('click', () => this.deleteComment(c.id));
      item.appendChild(del);

      list.appendChild(item);
    }
    this.commentsPanel.appendChild(list);
  }
}

function findEnclosingBlock(
  node: Node,
  container: HTMLElement,
): HTMLElement | null {
  let cur: Node | null = node;
  while (cur && cur !== container) {
    if (cur instanceof HTMLElement && cur.hasAttribute('data-plan-block')) {
      return cur;
    }
    cur = cur.parentNode;
  }
  return null;
}

function randomId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `c-${Math.random().toString(36).slice(2, 10)}`;
}
