// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parsePlanBlocks, renderPlan } from '../../src/browser/plan-display.js';

describe('parsePlanBlocks', () => {
  it('returns a single block for a single paragraph', () => {
    const blocks = parsePlanBlocks('Hello world');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.offset).toBe(0);
    expect(blocks[0]!.length).toBe('Hello world'.length);
    expect(blocks[0]!.raw).toBe('Hello world');
  });

  it('returns two blocks for two paragraphs separated by blank line', () => {
    const text = 'First paragraph\n\nSecond paragraph';
    const blocks = parsePlanBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.offset).toBe(0);
    expect(blocks[0]!.raw).toBe('First paragraph');
    expect(blocks[1]!.offset).toBe('First paragraph\n\n'.length);
    expect(blocks[1]!.raw).toBe('Second paragraph');
  });

  it('preserves correct offsets and lengths to reconstruct original text', () => {
    const text = 'Block one\n\nBlock two\n\nBlock three';
    const blocks = parsePlanBlocks(text);
    expect(blocks).toHaveLength(3);
    for (const block of blocks) {
      expect(text.slice(block.offset, block.offset + block.length)).toBe(block.raw);
    }
  });

  it('handles heading + paragraph + list', () => {
    const text = '# Heading\n\nA paragraph.\n\n- item1\n- item2';
    const blocks = parsePlanBlocks(text);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]!.raw).toBe('# Heading');
    expect(blocks[1]!.raw).toBe('A paragraph.');
    expect(blocks[2]!.raw).toBe('- item1\n- item2');
  });

  it('returns empty array for empty string', () => {
    const blocks = parsePlanBlocks('');
    expect(blocks).toHaveLength(0);
  });

  it('skips whitespace-only blocks', () => {
    const blocks = parsePlanBlocks('First\n\n   \n\nSecond');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.raw).toBe('First');
    expect(blocks[1]!.raw).toBe('Second');
  });

  it('produces valid HTML output for markdown', () => {
    const blocks = parsePlanBlocks('# My Heading\n\nSome *italic* text.');
    expect(blocks[0]!.html).toContain('<h1>');
    expect(blocks[1]!.html).toContain('<em>');
  });

  it('handles multiple blank lines between blocks', () => {
    const text = 'A\n\n\n\nB';
    const blocks = parsePlanBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.raw).toBe('A');
    expect(blocks[1]!.raw).toBe('B');
  });

  it('handles code fences as a single block', () => {
    const text = 'Intro\n\n```ts\nconst x = 1;\n```';
    const blocks = parsePlanBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[1]!.raw).toBe('```ts\nconst x = 1;\n```');
  });
});

describe('renderPlan', () => {
  it('creates div.plan-block elements with data-offset and data-length', () => {
    const container = document.createElement('div');
    renderPlan(container, 'Block one\n\nBlock two');
    const blocks = container.querySelectorAll('[data-plan-block]');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.getAttribute('data-offset')).toBe('0');
    expect(blocks[0]!.getAttribute('data-length')).toBe(String('Block one'.length));
    expect(blocks[1]!.getAttribute('data-offset')).toBe(String('Block one\n\n'.length));
  });

  it('replaces container children on subsequent calls', () => {
    const container = document.createElement('div');
    renderPlan(container, 'First');
    expect(container.querySelectorAll('[data-plan-block]')).toHaveLength(1);
    renderPlan(container, 'A\n\nB\n\nC');
    expect(container.querySelectorAll('[data-plan-block]')).toHaveLength(3);
  });

  it('applies plan-block class and data-plan-block attribute', () => {
    const container = document.createElement('div');
    renderPlan(container, 'Hello');
    const block = container.querySelector('[data-plan-block]');
    expect(block).not.toBeNull();
    expect(block!.classList.contains('plan-block')).toBe(true);
  });

  it('renders innerHTML from markdown', () => {
    const container = document.createElement('div');
    renderPlan(container, '# My Title\n\nSome **bold** text.');
    const blocks = container.querySelectorAll('[data-plan-block]');
    expect(blocks[0]!.innerHTML).toContain('<h1>');
    expect(blocks[1]!.innerHTML).toContain('<strong>');
  });
});
