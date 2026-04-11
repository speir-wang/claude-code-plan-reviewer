import { marked } from 'marked';

/**
 * A top-level block in a plan, preserved with its character offset + length
 * in the original plan text so annotations can be anchored by range.
 */
export interface PlanBlock {
  offset: number;
  length: number;
  html: string;
  raw: string;
}

/**
 * Split `planText` into top-level blocks (paragraphs, headings, list groups,
 * code fences…) at blank-line boundaries, preserving each block's character
 * offset in the source text. Markdown inside each block is rendered to HTML
 * via `marked`.
 */
export function parsePlanBlocks(planText: string): PlanBlock[] {
  const blocks: PlanBlock[] = [];
  const re = /\n\s*\n+/g;
  let lastStart = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(planText)) !== null) {
    const end = match.index;
    pushBlock(blocks, planText, lastStart, end);
    lastStart = match.index + match[0].length;
  }
  pushBlock(blocks, planText, lastStart, planText.length);
  return blocks;
}

function pushBlock(
  blocks: PlanBlock[],
  source: string,
  start: number,
  end: number,
): void {
  const raw = source.slice(start, end);
  if (raw.trim().length === 0) return;
  const html = marked.parse(raw, { async: false }) as string;
  blocks.push({ offset: start, length: raw.length, html, raw });
}

/**
 * Render the plan into `container`, replacing its previous contents. Each
 * top-level block becomes a `<div data-plan-block data-offset data-length>`
 * wrapping the rendered markdown.
 */
export function renderPlan(container: HTMLElement, planText: string): void {
  const blocks = parsePlanBlocks(planText);
  container.replaceChildren();
  for (const block of blocks) {
    const el = document.createElement('div');
    el.className = 'plan-block';
    el.setAttribute('data-plan-block', '');
    el.dataset['offset'] = String(block.offset);
    el.dataset['length'] = String(block.length);
    el.innerHTML = block.html;
    container.appendChild(el);
  }
}
