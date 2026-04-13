// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderDiffView, renderPriorComments } from '../../src/browser/diff-view.js';
import type { Comment } from '../../src/types.js';

function makeContainer(): HTMLElement {
  return document.createElement('div');
}

describe('renderDiffView', () => {
  it('creates a container with data-diff-view attribute', () => {
    const container = makeContainer();
    renderDiffView(container, 'hello', 'hello');
    expect(container.querySelector('[data-diff-view]')).not.toBeNull();
  });

  it('identical texts produce no ins or del elements', () => {
    const container = makeContainer();
    renderDiffView(container, 'identical text', 'identical text');
    expect(container.querySelectorAll('ins')).toHaveLength(0);
    expect(container.querySelectorAll('del')).toHaveLength(0);
  });

  it('additions produce <ins class="diff-add"> elements', () => {
    const container = makeContainer();
    renderDiffView(container, 'hello', 'hello world');
    const ins = container.querySelectorAll('ins.diff-add');
    expect(ins.length).toBeGreaterThan(0);
  });

  it('removals produce <del class="diff-remove"> elements', () => {
    const container = makeContainer();
    renderDiffView(container, 'hello world', 'hello');
    const del = container.querySelectorAll('del.diff-remove');
    expect(del.length).toBeGreaterThan(0);
  });

  it('handles mixed changes with both ins and del', () => {
    const container = makeContainer();
    renderDiffView(container, 'foo bar baz', 'foo qux baz');
    expect(container.querySelector('ins')).not.toBeNull();
    expect(container.querySelector('del')).not.toBeNull();
  });

  it('returns the diff segments array', () => {
    const container = makeContainer();
    const segments = renderDiffView(container, 'old text', 'new text');
    expect(Array.isArray(segments)).toBe(true);
    expect(segments.length).toBeGreaterThan(0);
    for (const seg of segments) {
      expect(['added', 'removed', 'unchanged']).toContain(seg.type);
    }
  });

  it('replaces container children on second call', () => {
    const container = makeContainer();
    renderDiffView(container, 'first', 'first');
    const before = container.querySelectorAll('[data-diff-view]').length;
    renderDiffView(container, 'second', 'second render');
    const after = container.querySelectorAll('[data-diff-view]').length;
    expect(before).toBe(1);
    expect(after).toBe(1);
  });
});

describe('renderPriorComments', () => {
  it('shows placeholder when comments array is empty', () => {
    const container = makeContainer();
    renderPriorComments(container, [], []);
    const placeholder = container.querySelector('[data-prior-comments-empty]');
    expect(placeholder).not.toBeNull();
    expect(placeholder!.textContent).toContain('No comments');
  });

  it('open (unresolved) comment has data-resolved="false" and "Open" status', () => {
    const container = makeContainer();
    const comment: Comment = {
      id: 'c1',
      anchor: 'some text',
      anchorStart: 0,
      anchorEnd: 9,
      note: 'my note',
      resolved: false,
    };
    // Use a diff where the anchor region is unchanged
    const segments = [{ text: 'some text extra', type: 'unchanged' as const }];
    renderPriorComments(container, [comment], segments);
    const li = container.querySelector('[data-prior-comment]');
    expect(li).not.toBeNull();
    expect(li!.getAttribute('data-resolved')).toBe('false');
    const status = li!.querySelector('.prior-comment__status');
    expect(status!.textContent).toBe('Open');
  });

  it('resolved comment has data-resolved="true" and "Auto-resolved" status', () => {
    const container = makeContainer();
    const comment: Comment = {
      id: 'c2',
      anchor: 'foo',
      anchorStart: 0,
      anchorEnd: 3,
      note: 'note',
      resolved: false,
    };
    // Diff removes the anchor region
    const segments = [{ text: 'foo', type: 'removed' as const }, { text: ' bar', type: 'unchanged' as const }];
    renderPriorComments(container, [comment], segments);
    const li = container.querySelector('[data-prior-comment]');
    expect(li!.getAttribute('data-resolved')).toBe('true');
    const status = li!.querySelector('.prior-comment__status');
    expect(status!.textContent).toBe('Auto-resolved');
  });

  it('renders multiple comments', () => {
    const container = makeContainer();
    const comments: Comment[] = [
      { id: 'c1', anchor: 'one', anchorStart: 0, anchorEnd: 3, note: 'n1', resolved: false },
      { id: 'c2', anchor: 'two', anchorStart: 4, anchorEnd: 7, note: 'n2', resolved: false },
    ];
    const segments = [{ text: 'one two', type: 'unchanged' as const }];
    renderPriorComments(container, comments, segments);
    const items = container.querySelectorAll('[data-prior-comment]');
    expect(items).toHaveLength(2);
  });

  it('each comment has correct data-comment-id attribute', () => {
    const container = makeContainer();
    const comment: Comment = {
      id: 'abc123',
      anchor: 'text',
      anchorStart: 0,
      anchorEnd: 4,
      note: 'note',
      resolved: false,
    };
    const segments = [{ text: 'text here', type: 'unchanged' as const }];
    renderPriorComments(container, [comment], segments);
    const li = container.querySelector('[data-prior-comment]');
    expect(li!.getAttribute('data-comment-id')).toBe('abc123');
  });

  it('replaces container children on second call', () => {
    const container = makeContainer();
    renderPriorComments(container, [], []);
    const comment: Comment = {
      id: 'c1', anchor: 'x', anchorStart: 0, anchorEnd: 1, note: 'n', resolved: false,
    };
    renderPriorComments(container, [comment], [{ text: 'x', type: 'unchanged' as const }]);
    expect(container.querySelectorAll('[data-prior-comment]')).toHaveLength(1);
    // No placeholder since there is 1 comment
    expect(container.querySelector('[data-prior-comments-empty]')).toBeNull();
  });
});
