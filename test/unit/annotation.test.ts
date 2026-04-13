// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AnnotationController } from '../../src/browser/annotation.js';

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Build a minimal plan DOM setup.
 * planText is stored verbatim as a text node inside a <p> inside the block.
 */
function makeSetup(planText: string) {
  const planContainer = document.createElement('div');
  const commentsPanel = document.createElement('div');

  const block = document.createElement('div');
  block.setAttribute('data-plan-block', '');
  block.dataset['offset'] = '0';
  block.dataset['length'] = String(planText.length);

  const p = document.createElement('p');
  p.textContent = planText;
  block.appendChild(p);
  planContainer.appendChild(block);

  document.body.appendChild(planContainer);
  document.body.appendChild(commentsPanel);

  return { planContainer, commentsPanel, planText };
}

function cleanup(planContainer: HTMLElement, commentsPanel: HTMLElement) {
  planContainer.remove();
  commentsPanel.remove();
}

/** Mock window.getSelection to return a synthetic selection pointing at a text node. */
function mockSelectionOn(textNode: Node, selectedText: string) {
  vi.spyOn(window, 'getSelection').mockReturnValue({
    isCollapsed: false,
    rangeCount: 1,
    getRangeAt: () => ({ commonAncestorContainer: textNode }),
    toString: () => selectedText,
  } as unknown as Selection);
}

function mockCollapsedSelection() {
  vi.spyOn(window, 'getSelection').mockReturnValue({
    isCollapsed: true,
    rangeCount: 1,
    getRangeAt: () => ({}),
    toString: () => '',
  } as unknown as Selection);
}

function mockNullSelection() {
  vi.spyOn(window, 'getSelection').mockReturnValue(null);
}

function fireMouseUp(target: EventTarget = document) {
  const evt = new MouseEvent('mouseup', { bubbles: true });
  if (target instanceof Node) {
    target.dispatchEvent(evt);
  } else {
    document.dispatchEvent(evt);
  }
}

describe('AnnotationController', () => {
  it('start() renders placeholder text', () => {
    const { planContainer, commentsPanel, planText } = makeSetup('Hello world');
    const ctrl = new AnnotationController(planContainer, commentsPanel, planText);
    ctrl.start();
    expect(commentsPanel.querySelector('[data-new-comment-placeholder]')).not.toBeNull();
    cleanup(planContainer, commentsPanel);
  });

  it('mouseup inside commentsPanel is ignored', () => {
    const { planContainer, commentsPanel, planText } = makeSetup('Hello world');
    const ctrl = new AnnotationController(planContainer, commentsPanel, planText);
    ctrl.start();

    const textNode = planContainer.querySelector('p')!.firstChild as Node;
    mockSelectionOn(textNode, 'Hello');

    // Fire mouseup with target INSIDE commentsPanel
    const innerEl = document.createElement('button');
    commentsPanel.appendChild(innerEl);
    innerEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    // No selection preview should appear (panel not changed to show selection)
    expect(commentsPanel.querySelector('[data-selection-preview]')).toBeNull();
    cleanup(planContainer, commentsPanel);
  });

  it('collapsed selection clears state and shows placeholder', () => {
    const { planContainer, commentsPanel, planText } = makeSetup('Hello world');
    const ctrl = new AnnotationController(planContainer, commentsPanel, planText);
    ctrl.start();

    mockCollapsedSelection();
    fireMouseUp();

    expect(commentsPanel.querySelector('[data-new-comment-placeholder]')).not.toBeNull();
    expect(commentsPanel.querySelector('[data-selection-preview]')).toBeNull();
    cleanup(planContainer, commentsPanel);
  });

  it('null selection clears state', () => {
    const { planContainer, commentsPanel, planText } = makeSetup('Hello world');
    const ctrl = new AnnotationController(planContainer, commentsPanel, planText);
    ctrl.start();

    mockNullSelection();
    fireMouseUp();

    expect(commentsPanel.querySelector('[data-new-comment-placeholder]')).not.toBeNull();
    cleanup(planContainer, commentsPanel);
  });

  it('selection outside any [data-plan-block] shows placeholder', () => {
    const { planContainer, commentsPanel, planText } = makeSetup('Hello world');
    const ctrl = new AnnotationController(planContainer, commentsPanel, planText);
    ctrl.start();

    // Use a text node that is NOT inside the planContainer
    const outsideDiv = document.createElement('div');
    outsideDiv.textContent = 'outside text';
    document.body.appendChild(outsideDiv);
    const outsideTextNode = outsideDiv.firstChild!;

    mockSelectionOn(outsideTextNode, 'outside text');
    fireMouseUp();

    expect(commentsPanel.querySelector('[data-selection-preview]')).toBeNull();
    expect(commentsPanel.querySelector('[data-new-comment-placeholder]')).not.toBeNull();

    outsideDiv.remove();
    cleanup(planContainer, commentsPanel);
  });

  it('valid selection within plan block shows preview and "Add comment" button', () => {
    const { planContainer, commentsPanel, planText } = makeSetup('Hello world');
    const ctrl = new AnnotationController(planContainer, commentsPanel, planText);
    ctrl.start();

    const textNode = planContainer.querySelector('p')!.firstChild as Node;
    mockSelectionOn(textNode, 'Hello');
    fireMouseUp();

    expect(commentsPanel.querySelector('[data-selection-preview]')).not.toBeNull();
    expect(commentsPanel.querySelector('[data-selection-preview]')!.textContent).toBe('Hello');
    const addBtn = Array.from(commentsPanel.querySelectorAll('button'))
      .find((b) => b.textContent === 'Add comment');
    expect(addBtn).not.toBeUndefined();
    cleanup(planContainer, commentsPanel);
  });

  it('selection text not verbatim in raw markdown uses fallback offset', () => {
    const { planContainer, commentsPanel } = makeSetup('Hello world');
    // Use a different planText so the selected text is not verbatim in raw
    const ctrl = new AnnotationController(planContainer, commentsPanel, 'Different raw text');
    ctrl.start();

    const textNode = planContainer.querySelector('p')!.firstChild as Node;
    // 'Hello' is in the DOM but NOT in planText 'Different raw text'
    mockSelectionOn(textNode, 'Hello');
    fireMouseUp();

    // Fallback path: selection should still be stored (just with fallback offsets)
    expect(commentsPanel.querySelector('[data-selection-preview]')).not.toBeNull();
    cleanup(planContainer, commentsPanel);
  });

  it('add comment: opens editor, fill textarea, submit -> comment appears in list', () => {
    const { planContainer, commentsPanel, planText } = makeSetup('Hello world');
    const ctrl = new AnnotationController(planContainer, commentsPanel, planText);
    ctrl.start();

    // Simulate selecting 'Hello'
    const textNode = planContainer.querySelector('p')!.firstChild as Node;
    mockSelectionOn(textNode, 'Hello');
    fireMouseUp();

    // Click "Add comment"
    const addBtn = Array.from(commentsPanel.querySelectorAll('button'))
      .find((b) => b.textContent === 'Add comment')!;
    addBtn.click();

    // Fill textarea and submit
    const textarea = commentsPanel.querySelector('textarea[data-comment-editor]') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    textarea.value = 'my note';

    const form = commentsPanel.querySelector('form')!;
    form.dispatchEvent(new Event('submit'));

    // Comment should appear in list
    const comment = commentsPanel.querySelector('[data-comment]');
    expect(comment).not.toBeNull();
    expect(comment!.querySelector('[data-comment-note]')!.textContent).toBe('my note');
    cleanup(planContainer, commentsPanel);
  });

  it('empty note (whitespace only) blocks save', () => {
    const { planContainer, commentsPanel, planText } = makeSetup('Hello world');
    const ctrl = new AnnotationController(planContainer, commentsPanel, planText);
    ctrl.start();

    const textNode = planContainer.querySelector('p')!.firstChild as Node;
    mockSelectionOn(textNode, 'Hello');
    fireMouseUp();

    const addBtn = Array.from(commentsPanel.querySelectorAll('button'))
      .find((b) => b.textContent === 'Add comment')!;
    addBtn.click();

    const textarea = commentsPanel.querySelector('textarea[data-comment-editor]') as HTMLTextAreaElement;
    textarea.value = '   '; // whitespace only
    const form = commentsPanel.querySelector('form')!;
    form.dispatchEvent(new Event('submit'));

    // No comment should be added
    expect(commentsPanel.querySelector('[data-comment]')).toBeNull();
    cleanup(planContainer, commentsPanel);
  });

  it('cancel clears editor without adding comment', () => {
    const { planContainer, commentsPanel, planText } = makeSetup('Hello world');
    const ctrl = new AnnotationController(planContainer, commentsPanel, planText);
    ctrl.start();

    const textNode = planContainer.querySelector('p')!.firstChild as Node;
    mockSelectionOn(textNode, 'Hello');
    fireMouseUp();

    const addBtn = Array.from(commentsPanel.querySelectorAll('button'))
      .find((b) => b.textContent === 'Add comment')!;
    addBtn.click();

    const cancelBtn = Array.from(commentsPanel.querySelectorAll('button'))
      .find((b) => b.textContent === 'Cancel')!;
    cancelBtn.click();

    expect(commentsPanel.querySelector('[data-comment]')).toBeNull();
    expect(commentsPanel.querySelector('textarea[data-comment-editor]')).toBeNull();
    cleanup(planContainer, commentsPanel);
  });

  it('delete comment removes it from list and unwraps <mark>', () => {
    const { planContainer, commentsPanel, planText } = makeSetup('Hello world');
    const ctrl = new AnnotationController(planContainer, commentsPanel, planText);
    ctrl.start();

    const textNode = planContainer.querySelector('p')!.firstChild as Node;
    mockSelectionOn(textNode, 'Hello');
    fireMouseUp();

    const addBtn = Array.from(commentsPanel.querySelectorAll('button'))
      .find((b) => b.textContent === 'Add comment')!;
    addBtn.click();

    const textarea = commentsPanel.querySelector('textarea[data-comment-editor]') as HTMLTextAreaElement;
    textarea.value = 'note';
    commentsPanel.querySelector('form')!.dispatchEvent(new Event('submit'));

    expect(commentsPanel.querySelector('[data-comment]')).not.toBeNull();

    const deleteBtn = commentsPanel.querySelector('[data-delete]') as HTMLButtonElement;
    deleteBtn.click();

    expect(commentsPanel.querySelector('[data-comment]')).toBeNull();
    expect(planContainer.querySelector('mark[data-comment-id]')).toBeNull();
    cleanup(planContainer, commentsPanel);
  });

  it('highlightAnchor wraps text in <mark data-comment-id>', () => {
    const { planContainer, commentsPanel, planText } = makeSetup('Hello world');
    const ctrl = new AnnotationController(planContainer, commentsPanel, planText);
    ctrl.start();

    const textNode = planContainer.querySelector('p')!.firstChild as Node;
    mockSelectionOn(textNode, 'Hello');
    fireMouseUp();

    const addBtn = Array.from(commentsPanel.querySelectorAll('button'))
      .find((b) => b.textContent === 'Add comment')!;
    addBtn.click();

    const textarea = commentsPanel.querySelector('textarea[data-comment-editor]') as HTMLTextAreaElement;
    textarea.value = 'test note';
    commentsPanel.querySelector('form')!.dispatchEvent(new Event('submit'));

    const mark = planContainer.querySelector('mark[data-comment-id]');
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toBe('Hello');
    cleanup(planContainer, commentsPanel);
  });

  it('setOnCommentsChanged callback fires on add', () => {
    const { planContainer, commentsPanel, planText } = makeSetup('Hello world');
    const ctrl = new AnnotationController(planContainer, commentsPanel, planText);
    const cb = vi.fn();
    ctrl.setOnCommentsChanged(cb);
    ctrl.start();

    const textNode = planContainer.querySelector('p')!.firstChild as Node;
    mockSelectionOn(textNode, 'Hello');
    fireMouseUp();

    const addBtn = Array.from(commentsPanel.querySelectorAll('button'))
      .find((b) => b.textContent === 'Add comment')!;
    addBtn.click();

    const textarea = commentsPanel.querySelector('textarea[data-comment-editor]') as HTMLTextAreaElement;
    textarea.value = 'cb test';
    commentsPanel.querySelector('form')!.dispatchEvent(new Event('submit'));

    expect(cb).toHaveBeenCalledTimes(1);
    cleanup(planContainer, commentsPanel);
  });

  it('setOnCommentsChanged callback fires on delete', () => {
    const { planContainer, commentsPanel, planText } = makeSetup('Hello world');
    const ctrl = new AnnotationController(planContainer, commentsPanel, planText);
    const cb = vi.fn();
    ctrl.setOnCommentsChanged(cb);
    ctrl.start();

    const textNode = planContainer.querySelector('p')!.firstChild as Node;
    mockSelectionOn(textNode, 'Hello');
    fireMouseUp();

    const addBtn = Array.from(commentsPanel.querySelectorAll('button'))
      .find((b) => b.textContent === 'Add comment')!;
    addBtn.click();

    const textarea = commentsPanel.querySelector('textarea[data-comment-editor]') as HTMLTextAreaElement;
    textarea.value = 'delete me';
    commentsPanel.querySelector('form')!.dispatchEvent(new Event('submit'));
    cb.mockClear();

    const deleteBtn = commentsPanel.querySelector('[data-delete]') as HTMLButtonElement;
    deleteBtn.click();

    expect(cb).toHaveBeenCalledTimes(1);
    cleanup(planContainer, commentsPanel);
  });

  it('getComments returns current snapshot', () => {
    const { planContainer, commentsPanel, planText } = makeSetup('Hello world');
    const ctrl = new AnnotationController(planContainer, commentsPanel, planText);
    ctrl.start();
    expect(ctrl.getComments()).toHaveLength(0);

    const textNode = planContainer.querySelector('p')!.firstChild as Node;
    mockSelectionOn(textNode, 'Hello');
    fireMouseUp();

    const addBtn = Array.from(commentsPanel.querySelectorAll('button'))
      .find((b) => b.textContent === 'Add comment')!;
    addBtn.click();

    const textarea = commentsPanel.querySelector('textarea[data-comment-editor]') as HTMLTextAreaElement;
    textarea.value = 'snapshot test';
    commentsPanel.querySelector('form')!.dispatchEvent(new Event('submit'));

    const comments = ctrl.getComments();
    expect(comments).toHaveLength(1);
    expect(comments[0]!.anchor).toBe('Hello');
    expect(comments[0]!.note).toBe('snapshot test');
    cleanup(planContainer, commentsPanel);
  });

  it('each comment gets a unique id', () => {
    const planText = 'Hello world foo bar';
    const { planContainer, commentsPanel } = makeSetup(planText);
    const ctrl = new AnnotationController(planContainer, commentsPanel, planText);
    ctrl.start();

    const addComment = (text: string) => {
      const textNode = planContainer.querySelector('p')!.firstChild as Node;
      mockSelectionOn(textNode, text);
      fireMouseUp();
      const addBtn = Array.from(commentsPanel.querySelectorAll('button'))
        .find((b) => b.textContent === 'Add comment')!;
      addBtn.click();
      const textarea = commentsPanel.querySelector('textarea[data-comment-editor]') as HTMLTextAreaElement;
      textarea.value = 'note';
      commentsPanel.querySelector('form')!.dispatchEvent(new Event('submit'));
    };

    addComment('Hello');
    addComment('world');

    const comments = ctrl.getComments();
    expect(comments).toHaveLength(2);
    expect(comments[0]!.id).not.toBe(comments[1]!.id);
    cleanup(planContainer, commentsPanel);
  });

  it('block without data-offset/length uses ?? fallback in handleMouseUp and findBlockContaining', () => {
    // A block with [data-plan-block] but NO data-offset or data-length.
    // Covers the `?? '0'` fallback in handleMouseUp (lines 87-88) AND
    // findBlockContaining (lines 219-220).
    const planContainer = document.createElement('div');
    const commentsPanel = document.createElement('div');
    const block = document.createElement('div');
    block.setAttribute('data-plan-block', '');
    // No data-offset / data-length set intentionally
    const p = document.createElement('p');
    p.textContent = 'Hello world';
    block.appendChild(p);
    planContainer.appendChild(block);
    document.body.appendChild(planContainer);
    document.body.appendChild(commentsPanel);

    const ctrl = new AnnotationController(planContainer, commentsPanel, 'Hello world');
    ctrl.start();

    const textNode = p.firstChild as Node;
    mockSelectionOn(textNode, 'Hello');
    fireMouseUp();

    // With offset=0 (fallback) and length=0 (fallback), raw='' and idx=-1,
    // so fallback offsets are used. Selection should still be stored.
    expect(commentsPanel.querySelector('[data-selection-preview]')).not.toBeNull();

    // Complete the comment addition to trigger findBlockContaining (lines 219-220).
    // findBlockContaining will also use the ?? '0' fallback since block has no dataset attrs.
    const addBtn = Array.from(commentsPanel.querySelectorAll('button'))
      .find((b) => b.textContent === 'Add comment')!;
    addBtn.click();
    const textarea = commentsPanel.querySelector('textarea[data-comment-editor]') as HTMLTextAreaElement;
    textarea.value = 'no-dataset note';
    commentsPanel.querySelector('form')!.dispatchEvent(new Event('submit'));

    // Comment is saved; highlightAnchor ran but findBlockContaining returned null
    // (since offset=0 but length=0 → 0 < 0 is false), so no mark placed.
    expect(ctrl.getComments()).toHaveLength(1);
    expect(planContainer.querySelector('mark[data-comment-id]')).toBeNull();

    cleanup(planContainer, commentsPanel);
  });

  it('openEditor is a no-op if selection was cleared before click', () => {
    const { planContainer, commentsPanel, planText } = makeSetup('Hello world');
    const ctrl = new AnnotationController(planContainer, commentsPanel, planText);
    ctrl.start();

    const textNode = planContainer.querySelector('p')!.firstChild as Node;
    mockSelectionOn(textNode, 'Hello');
    fireMouseUp();

    // Grab the "Add comment" button while selection is still set.
    const addBtn = Array.from(commentsPanel.querySelectorAll('button'))
      .find((b) => b.textContent === 'Add comment')!;

    // Clear selection — renderPanel removes the button from the DOM, but
    // we still hold the old reference with its event listener.
    mockNullSelection();
    fireMouseUp();

    // Clicking the stale button calls openEditor with this.selection = null.
    addBtn.click();

    // The editor should NOT appear.
    expect(commentsPanel.querySelector('textarea[data-comment-editor]')).toBeNull();
    cleanup(planContainer, commentsPanel);
  });

  it('deleteComment else path: mark does not exist in DOM (no mark was created)', () => {
    // Force surroundContents to throw so no mark is placed.
    const origCreateRange = document.createRange.bind(document);
    vi.spyOn(document, 'createRange').mockImplementation(() => {
      const range = origCreateRange();
      range.surroundContents = () => { throw new Error('no highlight'); };
      return range;
    });

    const { planContainer, commentsPanel, planText } = makeSetup('Hello world');
    const ctrl = new AnnotationController(planContainer, commentsPanel, planText);
    ctrl.start();

    const textNode = planContainer.querySelector('p')!.firstChild as Node;
    mockSelectionOn(textNode, 'Hello');
    fireMouseUp();

    const addBtn = Array.from(commentsPanel.querySelectorAll('button'))
      .find((b) => b.textContent === 'Add comment')!;
    addBtn.click();

    const textarea = commentsPanel.querySelector('textarea[data-comment-editor]') as HTMLTextAreaElement;
    textarea.value = 'note without mark';
    commentsPanel.querySelector('form')!.dispatchEvent(new Event('submit'));

    // Comment is added but there is NO mark in the DOM.
    expect(ctrl.getComments()).toHaveLength(1);
    expect(planContainer.querySelector('mark[data-comment-id]')).toBeNull();

    // Delete the comment — deleteComment is called with mark=null (else path).
    const deleteBtn = commentsPanel.querySelector('[data-delete]') as HTMLButtonElement;
    deleteBtn.click();
    expect(ctrl.getComments()).toHaveLength(0);
    cleanup(planContainer, commentsPanel);
  });

  it('deleteComment mark.textContent null fallback: mark with null textContent', () => {
    const { planContainer, commentsPanel, planText } = makeSetup('Hello world');
    const ctrl = new AnnotationController(planContainer, commentsPanel, planText);
    ctrl.start();

    const textNode = planContainer.querySelector('p')!.firstChild as Node;
    mockSelectionOn(textNode, 'Hello');
    fireMouseUp();

    const addBtn = Array.from(commentsPanel.querySelectorAll('button'))
      .find((b) => b.textContent === 'Add comment')!;
    addBtn.click();

    const textarea = commentsPanel.querySelector('textarea[data-comment-editor]') as HTMLTextAreaElement;
    textarea.value = 'mark null test';
    commentsPanel.querySelector('form')!.dispatchEvent(new Event('submit'));

    const markEl = planContainer.querySelector('mark[data-comment-id]');
    if (markEl) {
      // Force textContent to return null to exercise the `?? ''` fallback branch.
      Object.defineProperty(markEl, 'textContent', { get: () => null, configurable: true });
    }

    const deleteBtn = commentsPanel.querySelector('[data-delete]') as HTMLButtonElement;
    deleteBtn.click();
    expect(ctrl.getComments()).toHaveLength(0);
    cleanup(planContainer, commentsPanel);
  });

  it('empty selection text (not collapsed, but toString empty) clears state', () => {
    const { planContainer, commentsPanel, planText } = makeSetup('Hello world');
    const ctrl = new AnnotationController(planContainer, commentsPanel, planText);
    ctrl.start();

    // sel.isCollapsed=false, rangeCount=1, but toString() returns ''
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => ({}),
      toString: () => '',
    } as unknown as Selection);
    fireMouseUp();

    expect(commentsPanel.querySelector('[data-selection-preview]')).toBeNull();
    expect(commentsPanel.querySelector('[data-new-comment-placeholder]')).not.toBeNull();
    cleanup(planContainer, commentsPanel);
  });

  it('highlightAnchor skips when anchorStart is outside all plan blocks', () => {
    const { planContainer, commentsPanel, planText } = makeSetup('Hello world');
    const ctrl = new AnnotationController(planContainer, commentsPanel, planText);
    ctrl.start();

    const textNode = planContainer.querySelector('p')!.firstChild as Node;
    mockSelectionOn(textNode, 'Hello');
    fireMouseUp();

    const addBtn = Array.from(commentsPanel.querySelectorAll('button'))
      .find((b) => b.textContent === 'Add comment')!;
    addBtn.click();

    // Before submitting, move the block's offset far away so anchorStart falls outside
    const block = planContainer.querySelector('[data-plan-block]') as HTMLElement;
    block.dataset['offset'] = '9999';
    block.dataset['length'] = '11';

    const textarea = commentsPanel.querySelector('textarea[data-comment-editor]') as HTMLTextAreaElement;
    textarea.value = 'no highlight note';
    commentsPanel.querySelector('form')!.dispatchEvent(new Event('submit'));

    // Comment is added but no <mark> should be placed (findBlockContaining returns null)
    expect(ctrl.getComments()).toHaveLength(1);
    expect(planContainer.querySelector('mark[data-comment-id]')).toBeNull();
    cleanup(planContainer, commentsPanel);
  });

  it('randomId uses Math.random fallback when crypto.randomUUID is not a function', () => {
    // Temporarily remove randomUUID to trigger the Math.random fallback.
    const originalUUID = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true, writable: true });

    const { planContainer, commentsPanel, planText } = makeSetup('Hello world');
    const ctrl = new AnnotationController(planContainer, commentsPanel, planText);
    ctrl.start();

    const textNode = planContainer.querySelector('p')!.firstChild as Node;
    mockSelectionOn(textNode, 'Hello');
    fireMouseUp();

    const addBtn = Array.from(commentsPanel.querySelectorAll('button'))
      .find((b) => b.textContent === 'Add comment')!;
    addBtn.click();

    const textarea = commentsPanel.querySelector('textarea[data-comment-editor]') as HTMLTextAreaElement;
    textarea.value = 'fallback id test';
    commentsPanel.querySelector('form')!.dispatchEvent(new Event('submit'));

    const comments = ctrl.getComments();
    expect(comments).toHaveLength(1);
    // Fallback id starts with 'c-'
    expect(comments[0]!.id).toMatch(/^c-/);

    // Restore
    Object.defineProperty(crypto, 'randomUUID', { value: originalUUID, configurable: true, writable: true });
    cleanup(planContainer, commentsPanel);
  });

  it('surroundContents failure skips highlighting silently', () => {
    const { planContainer, commentsPanel, planText } = makeSetup('Hello world');
    const ctrl = new AnnotationController(planContainer, commentsPanel, planText);
    ctrl.start();

    // Force Range.surroundContents to throw
    const origCreateRange = document.createRange.bind(document);
    vi.spyOn(document, 'createRange').mockImplementation(() => {
      const range = origCreateRange();
      range.surroundContents = () => { throw new Error('surround failed'); };
      return range;
    });

    const textNode = planContainer.querySelector('p')!.firstChild as Node;
    mockSelectionOn(textNode, 'Hello');
    fireMouseUp();

    const addBtn = Array.from(commentsPanel.querySelectorAll('button'))
      .find((b) => b.textContent === 'Add comment')!;
    addBtn.click();

    const textarea = commentsPanel.querySelector('textarea[data-comment-editor]') as HTMLTextAreaElement;
    textarea.value = 'surround test';
    // Should not throw
    expect(() => {
      commentsPanel.querySelector('form')!.dispatchEvent(new Event('submit'));
    }).not.toThrow();

    // Comment is still added even without highlighting
    expect(ctrl.getComments()).toHaveLength(1);
    cleanup(planContainer, commentsPanel);
  });
});
