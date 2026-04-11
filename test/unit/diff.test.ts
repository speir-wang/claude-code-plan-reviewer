import { describe, it, expect } from 'vitest';
import {
  computeInlineDiff,
  resolveCommentsAgainstDiff,
  type DiffSegment,
} from '../../src/diff.js';
import type { Comment } from '../../src/types.js';

function mkComment(
  id: string,
  anchor: string,
  anchorStart: number,
  anchorEnd: number,
): Comment {
  return { id, anchor, anchorStart, anchorEnd, note: 'n', resolved: false };
}

describe('computeInlineDiff', () => {
  it('returns a single unchanged segment for identical text', () => {
    const segs = computeInlineDiff('hello world', 'hello world');
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual<DiffSegment>({
      text: 'hello world',
      type: 'unchanged',
    });
  });

  it('returns a single added segment when old is empty', () => {
    const segs = computeInlineDiff('', 'hello');
    expect(segs.some((s) => s.type === 'added' && s.text.includes('hello'))).toBe(
      true,
    );
    expect(segs.every((s) => s.type !== 'removed')).toBe(true);
  });

  it('returns a single removed segment when new is empty', () => {
    const segs = computeInlineDiff('hello', '');
    expect(segs.some((s) => s.type === 'removed' && s.text.includes('hello'))).toBe(
      true,
    );
    expect(segs.every((s) => s.type !== 'added')).toBe(true);
  });

  it('produces added and removed segments around an edit', () => {
    const segs = computeInlineDiff('foo bar baz', 'foo qux baz');
    const added = segs.filter((s) => s.type === 'added').map((s) => s.text);
    const removed = segs.filter((s) => s.type === 'removed').map((s) => s.text);
    const unchanged = segs.filter((s) => s.type === 'unchanged');

    expect(removed.join('')).toContain('bar');
    expect(added.join('')).toContain('qux');
    expect(unchanged.length).toBeGreaterThan(0);
  });

  it('old-text reconstruction matches original', () => {
    const oldText = 'The quick brown fox jumps over the lazy dog';
    const newText = 'The slow brown fox leaps over the lazy cat';
    const segs = computeInlineDiff(oldText, newText);
    const reconstructedOld = segs
      .filter((s) => s.type !== 'added')
      .map((s) => s.text)
      .join('');
    expect(reconstructedOld).toBe(oldText);
  });

  it('new-text reconstruction matches new', () => {
    const oldText = 'The quick brown fox jumps over the lazy dog';
    const newText = 'The slow brown fox leaps over the lazy cat';
    const segs = computeInlineDiff(oldText, newText);
    const reconstructedNew = segs
      .filter((s) => s.type !== 'removed')
      .map((s) => s.text)
      .join('');
    expect(reconstructedNew).toBe(newText);
  });
});

describe('resolveCommentsAgainstDiff', () => {
  it('marks a comment resolved when the anchored region changes', () => {
    const oldText = 'please fix foo bar now';
    const newText = 'please fix foo baz now';
    const start = oldText.indexOf('foo bar');
    const end = start + 'foo bar'.length;
    const comment = mkComment('c1', 'foo bar', start, end);

    const segs = computeInlineDiff(oldText, newText);
    const [resolved] = resolveCommentsAgainstDiff([comment], segs);
    expect(resolved).toBeDefined();
    expect(resolved!.resolved).toBe(true);
  });

  it('leaves a comment open when the anchored region is unchanged', () => {
    const oldText = 'alpha beta gamma delta';
    const newText = 'alpha beta gamma DELTA-NEW'; // changes after the anchor
    const start = oldText.indexOf('beta');
    const end = start + 'beta'.length;
    const comment = mkComment('c1', 'beta', start, end);

    const segs = computeInlineDiff(oldText, newText);
    const [resolved] = resolveCommentsAgainstDiff([comment], segs);
    expect(resolved!.resolved).toBe(false);
  });

  it('preserves already-resolved state on unrelated changes', () => {
    const oldText = 'keep this sentence stable here';
    const newText = 'keep this sentence REALLY stable here';
    const start = oldText.indexOf('keep');
    const end = start + 'keep'.length;
    const comment: Comment = { ...mkComment('c1', 'keep', start, end), resolved: true };

    const segs = computeInlineDiff(oldText, newText);
    const [resolved] = resolveCommentsAgainstDiff([comment], segs);
    expect(resolved!.resolved).toBe(true);
  });

  it('handles multiple comments, resolving only those whose region changed', () => {
    const oldText = 'first second third fourth';
    const newText = 'first SECOND-NEW third fourth';
    const s1 = oldText.indexOf('first');
    const e1 = s1 + 'first'.length;
    const s2 = oldText.indexOf('second');
    const e2 = s2 + 'second'.length;
    const s4 = oldText.indexOf('fourth');
    const e4 = s4 + 'fourth'.length;

    const comments = [
      mkComment('c1', 'first', s1, e1),
      mkComment('c2', 'second', s2, e2),
      mkComment('c3', 'fourth', s4, e4),
    ];
    const segs = computeInlineDiff(oldText, newText);
    const result = resolveCommentsAgainstDiff(comments, segs);

    expect(result.find((c) => c.id === 'c1')!.resolved).toBe(false);
    expect(result.find((c) => c.id === 'c2')!.resolved).toBe(true);
    expect(result.find((c) => c.id === 'c3')!.resolved).toBe(false);
  });

  it('marks a comment resolved if any portion of its anchor was removed', () => {
    const oldText = 'start then the buggy part ends here';
    const newText = 'start then the part ends here'; // "buggy " removed
    const anchor = 'the buggy part';
    const start = oldText.indexOf(anchor);
    const end = start + anchor.length;
    const comment = mkComment('c1', anchor, start, end);

    const segs = computeInlineDiff(oldText, newText);
    const [resolved] = resolveCommentsAgainstDiff([comment], segs);
    expect(resolved!.resolved).toBe(true);
  });

  it('is a pure function (does not mutate input comments)', () => {
    const oldText = 'a b c';
    const newText = 'a X c';
    const start = oldText.indexOf('b');
    const end = start + 1;
    const original = mkComment('c1', 'b', start, end);
    const originalSnapshot = { ...original };

    const segs = computeInlineDiff(oldText, newText);
    resolveCommentsAgainstDiff([original], segs);
    expect(original).toEqual(originalSnapshot);
  });

  it('returns empty array for empty input', () => {
    const segs = computeInlineDiff('x', 'y');
    expect(resolveCommentsAgainstDiff([], segs)).toEqual([]);
  });
});
