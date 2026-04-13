import { describe, it, expect } from 'vitest';
import {
  escapeXml,
  buildFeedbackXml,
  buildClarificationXml,
  buildApprovalXml,
} from '../../src/xml.js';

describe('escapeXml', () => {
  it('escapes ampersand', () => {
    expect(escapeXml('a & b')).toBe('a &amp; b');
  });

  it('escapes less-than', () => {
    expect(escapeXml('a < b')).toBe('a &lt; b');
  });

  it('escapes greater-than', () => {
    expect(escapeXml('a > b')).toBe('a &gt; b');
  });

  it('escapes double-quote', () => {
    expect(escapeXml('"hello"')).toBe('&quot;hello&quot;');
  });

  it("escapes single-quote", () => {
    expect(escapeXml("it's")).toBe("it&apos;s");
  });

  it('escapes mixed special characters', () => {
    expect(escapeXml('<a href="x&y">it\'s</a>')).toBe(
      '&lt;a href=&quot;x&amp;y&quot;&gt;it&apos;s&lt;/a&gt;',
    );
  });

  it('returns empty string unchanged', () => {
    expect(escapeXml('')).toBe('');
  });

  it('passes through plain text unchanged', () => {
    expect(escapeXml('hello world')).toBe('hello world');
  });
});

describe('buildFeedbackXml', () => {
  it('builds XML for a single comment', () => {
    const xml = buildFeedbackXml([{ anchor: 'some text', note: 'my note' }]);
    expect(xml).toContain('<plan_review type="feedback">');
    expect(xml).toContain('<comment>');
    expect(xml).toContain('<anchor>some text</anchor>');
    expect(xml).toContain('<note>my note</note>');
    expect(xml).toContain('</plan_review>');
  });

  it('builds XML for multiple comments', () => {
    const xml = buildFeedbackXml([
      { anchor: 'anchor1', note: 'note1' },
      { anchor: 'anchor2', note: 'note2' },
    ]);
    expect(xml).toContain('<anchor>anchor1</anchor>');
    expect(xml).toContain('<note>note1</note>');
    expect(xml).toContain('<anchor>anchor2</anchor>');
    expect(xml).toContain('<note>note2</note>');
  });

  it('escapes special characters in anchor and note', () => {
    const xml = buildFeedbackXml([{ anchor: '<foo>', note: 'a & b' }]);
    expect(xml).toContain('<anchor>&lt;foo&gt;</anchor>');
    expect(xml).toContain('<note>a &amp; b</note>');
  });

  it('builds XML for empty comment array', () => {
    const xml = buildFeedbackXml([]);
    expect(xml).toContain('<plan_review type="feedback">');
    expect(xml).toContain('</plan_review>');
    expect(xml).not.toContain('<comment>');
  });
});

describe('buildClarificationXml', () => {
  it('wraps answer in clarification tag', () => {
    const xml = buildClarificationXml('use option B');
    expect(xml).toContain('<plan_review type="clarification">');
    expect(xml).toContain('<answer>use option B</answer>');
    expect(xml).toContain('</plan_review>');
  });

  it('escapes special characters in answer', () => {
    const xml = buildClarificationXml('use <B> & "C"');
    expect(xml).toContain('<answer>use &lt;B&gt; &amp; &quot;C&quot;</answer>');
  });
});

describe('buildApprovalXml', () => {
  it('returns self-closing tag when no notes', () => {
    expect(buildApprovalXml()).toBe('<plan_review type="approved" />');
  });

  it('returns self-closing tag when notes is undefined', () => {
    expect(buildApprovalXml(undefined)).toBe('<plan_review type="approved" />');
  });

  it('returns full tag with notes when notes are provided', () => {
    const xml = buildApprovalXml('watch perf');
    expect(xml).toContain('<plan_review type="approved_with_notes">');
    expect(xml).toContain('<note>watch perf</note>');
    expect(xml).toContain('</plan_review>');
  });

  it('escapes special characters in notes', () => {
    const xml = buildApprovalXml('use <X> & "Y"');
    expect(xml).toContain('<note>use &lt;X&gt; &amp; &quot;Y&quot;</note>');
  });

  it('returns self-closing tag when notes is empty string', () => {
    expect(buildApprovalXml('')).toBe('<plan_review type="approved" />');
  });
});
