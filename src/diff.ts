import { diffWords } from 'diff';
import type { Comment } from './types.js';

export interface DiffSegment {
  text: string;
  type: 'added' | 'removed' | 'unchanged';
}

/**
 * Compute an ordered list of word-level diff segments from `oldText` to
 * `newText`. Concatenating the non-`added` segments reproduces `oldText`;
 * concatenating the non-`removed` segments reproduces `newText`.
 */
export function computeInlineDiff(oldText: string, newText: string): DiffSegment[] {
  const changes = diffWords(oldText, newText);
  return changes.map((change) => ({
    text: change.value,
    type: change.added ? 'added' : change.removed ? 'removed' : 'unchanged',
  }));
}

/**
 * For each comment anchored to a character range `[anchorStart, anchorEnd)`
 * in the OLD text, walk the diff segments and mark the comment resolved if
 * any overlapping segment is `added` or `removed`. Already-resolved comments
 * stay resolved regardless of the diff.
 *
 * Returns a new array of comments — the input is not mutated.
 */
export function resolveCommentsAgainstDiff(
  comments: readonly Comment[],
  segments: readonly DiffSegment[],
): Comment[] {
  if (comments.length === 0) return [];

  // Build a list of intervals over the OLD text along with whether the
  // interval represents a change. Only `unchanged` and `removed` segments
  // consume old-text characters; `added` segments do not.
  interface OldInterval {
    start: number;
    end: number; // exclusive
    changed: boolean;
  }
  const oldIntervals: OldInterval[] = [];
  const insertionPoints: number[] = []; // positions in old text where inserts land
  let oldCursor = 0;
  for (const seg of segments) {
    if (seg.type === 'added') {
      // Added text has zero width in the old text, but an insertion between
      // two unchanged words still counts as a change overlapping any anchor
      // that straddles that boundary. Record the insertion point so we can
      // test strict-interior overlap below.
      insertionPoints.push(oldCursor);
      continue;
    }
    const len = seg.text.length;
    oldIntervals.push({
      start: oldCursor,
      end: oldCursor + len,
      changed: seg.type === 'removed',
    });
    oldCursor += len;
  }

  return comments.map((c) => {
    if (c.resolved) return { ...c };
    const { anchorStart, anchorEnd } = c;
    let changed = false;

    // 1) Any removed segment that overlaps the anchor range.
    for (const iv of oldIntervals) {
      if (!iv.changed) continue;
      if (iv.end <= anchorStart) continue;
      if (iv.start >= anchorEnd) break; // intervals are in order
      changed = true;
      break;
    }

    // 2) Any insertion that lands strictly inside the anchor range.
    if (!changed) {
      for (const pos of insertionPoints) {
        if (pos > anchorStart && pos < anchorEnd) {
          changed = true;
          break;
        }
      }
    }

    return { ...c, resolved: changed };
  });
}
