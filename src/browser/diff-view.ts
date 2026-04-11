/**
 * Diff view: when a session carries two or more plan versions, the browser
 * shows the latest version with an inline word-level diff against the
 * previous version, plus the previous version's comments annotated with
 * their auto-resolved state.
 *
 * Rendering shares `computeInlineDiff` / `resolveCommentsAgainstDiff` with
 * the server so the two surfaces agree on what counts as "changed".
 */

import {
  computeInlineDiff,
  resolveCommentsAgainstDiff,
  type DiffSegment,
} from '../diff.js';
import type { Comment } from '../types.js';

/**
 * Render the word-level inline diff of `newText` against `oldText` into
 * `container`, replacing its previous content. Unchanged segments become
 * plain `<span>`, additions become `<ins class="diff-add">`, deletions
 * become `<del class="diff-remove">`. Returns the diff segments so callers
 * can feed them to {@link renderPriorComments} without re-diffing.
 */
export function renderDiffView(
  container: HTMLElement,
  oldText: string,
  newText: string,
): DiffSegment[] {
  const segments = computeInlineDiff(oldText, newText);
  container.replaceChildren();

  const view = document.createElement('div');
  view.className = 'diff-view';
  view.setAttribute('data-diff-view', '');

  for (const seg of segments) {
    if (seg.type === 'added') {
      const ins = document.createElement('ins');
      ins.className = 'diff-add';
      ins.textContent = seg.text;
      view.appendChild(ins);
    } else if (seg.type === 'removed') {
      const del = document.createElement('del');
      del.className = 'diff-remove';
      del.textContent = seg.text;
      view.appendChild(del);
    } else {
      view.appendChild(document.createTextNode(seg.text));
    }
  }

  container.appendChild(view);
  return segments;
}

/**
 * Render a read-only list of the previous version's comments with their
 * auto-resolved state derived from the diff. Each `<li>` carries
 * `data-prior-comment`, `data-comment-id`, and `data-resolved` attributes
 * so Playwright tests and styles can target them directly.
 */
export function renderPriorComments(
  container: HTMLElement,
  priorComments: readonly Comment[],
  segments: readonly DiffSegment[],
): void {
  const resolved = resolveCommentsAgainstDiff(priorComments, segments);
  container.replaceChildren();

  const heading = document.createElement('h2');
  heading.textContent = 'Prior comments';
  container.appendChild(heading);

  if (resolved.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'comments-panel__placeholder';
    empty.setAttribute('data-prior-comments-empty', '');
    empty.textContent = 'No comments were left on the previous version.';
    container.appendChild(empty);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'prior-comments__list';
  for (const c of resolved) {
    const li = document.createElement('li');
    li.setAttribute('data-prior-comment', '');
    li.dataset['commentId'] = c.id;
    li.dataset['resolved'] = String(c.resolved);

    const anchor = document.createElement('blockquote');
    anchor.setAttribute('data-anchor', '');
    anchor.textContent = c.anchor;
    li.appendChild(anchor);

    const note = document.createElement('p');
    note.setAttribute('data-comment-note', '');
    note.textContent = c.note;
    li.appendChild(note);

    const status = document.createElement('span');
    status.className = 'prior-comment__status';
    status.textContent = c.resolved ? 'Auto-resolved' : 'Open';
    li.appendChild(status);

    list.appendChild(li);
  }
  container.appendChild(list);
}
