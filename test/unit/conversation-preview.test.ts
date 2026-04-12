import { describe, it, expect } from 'vitest';
import { formatPreview } from '../../src/conversation-preview.js';

describe('formatPreview', () => {
  it('extracts a single comment from feedback XML', () => {
    const xml = `<plan_review type="feedback">
  <comment>
    <anchor>Create ~/reagroup/hello.txt</anchor>
    <note>Why this specific file?</note>
  </comment>
</plan_review>`;
    const result = formatPreview('feedback', xml);
    expect(result).not.toContain('<plan_review');
    expect(result).not.toContain('<comment>');
    expect(result).not.toContain('<anchor>');
    expect(result).not.toContain('<note>');
    expect(result).toContain('Create ~/reagroup/hello.txt');
    expect(result).toContain('Why this specific file?');
  });

  it('shows count when there are multiple comments', () => {
    const xml = `<plan_review type="feedback">
  <comment>
    <anchor>first anchor</anchor>
    <note>first note</note>
  </comment>
  <comment>
    <anchor>second anchor</anchor>
    <note>second note</note>
  </comment>
</plan_review>`;
    const result = formatPreview('feedback', xml);
    expect(result).not.toContain('<');
    expect(result).toMatch(/2 comments/i);
  });

  it('extracts answer from clarification XML', () => {
    const xml = `<plan_review type="clarification">
  <answer>use option B</answer>
</plan_review>`;
    const result = formatPreview('clarification', xml);
    expect(result).not.toContain('<plan_review');
    expect(result).not.toContain('<answer>');
    expect(result).toContain('use option B');
  });

  it('handles XML-escaped entities in content', () => {
    const xml = `<plan_review type="feedback">
  <comment>
    <anchor>file with &quot;quotes&quot; &amp; more</anchor>
    <note>fix &lt;this&gt;</note>
  </comment>
</plan_review>`;
    const result = formatPreview('feedback', xml);
    expect(result).toContain('file with "quotes" & more');
    expect(result).toContain('fix <this>');
  });

  it('returns plain content for approval type', () => {
    const result = formatPreview('approval', 'some notes here');
    expect(result).toBe('some notes here');
  });

  it('returns plain content for plan type', () => {
    const result = formatPreview('plan', '# My Plan\n\nDo stuff.');
    expect(result).toBe('# My Plan\n\nDo stuff.');
  });

  it('returns plain content for unknown types', () => {
    const result = formatPreview('unknown', 'whatever');
    expect(result).toBe('whatever');
  });

  it('handles empty feedback XML gracefully', () => {
    const xml = '<plan_review type="feedback">\n</plan_review>';
    const result = formatPreview('feedback', xml);
    expect(result).not.toContain('<');
  });

  it('extracts notes from approved_with_notes XML when used as feedback type', () => {
    const xml = `<plan_review type="approved_with_notes">
  <note>watch perf under heavy load</note>
</plan_review>`;
    // If someone stores this as a feedback-typed entry, strip tags
    const result = formatPreview('feedback', xml);
    expect(result).not.toContain('<plan_review');
    expect(result).not.toContain('<note>');
  });
});
