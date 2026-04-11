/** Escape a string for safe embedding inside an XML text node or attribute. */
export function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface FeedbackComment {
  anchor: string;
  note: string;
}

export function buildFeedbackXml(comments: readonly FeedbackComment[]): string {
  const body = comments
    .map(
      (c) =>
        `  <comment>\n    <anchor>${escapeXml(c.anchor)}</anchor>\n    <note>${escapeXml(c.note)}</note>\n  </comment>`,
    )
    .join('\n');
  return `<plan_review type="feedback">\n${body}\n</plan_review>`;
}

export function buildClarificationXml(answer: string): string {
  return `<plan_review type="clarification">\n  <answer>${escapeXml(answer)}</answer>\n</plan_review>`;
}

export function buildApprovalXml(notes?: string): string {
  if (notes && notes.length > 0) {
    return `<plan_review type="approved_with_notes">\n  <note>${escapeXml(notes)}</note>\n</plan_review>`;
  }
  return '<plan_review type="approved" />';
}
