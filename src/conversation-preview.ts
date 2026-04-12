/**
 * Converts raw XML conversation content into a user-friendly preview string.
 * Used by the conversation panel to avoid showing raw XML tags.
 */

/** Unescape XML entities back to their plain-text characters. */
function unescapeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

interface ParsedComment {
  anchor: string;
  note: string;
}

function parseComments(xml: string): ParsedComment[] {
  const comments: ParsedComment[] = [];
  const commentRegex = /<comment>\s*<anchor>([\s\S]*?)<\/anchor>\s*<note>([\s\S]*?)<\/note>\s*<\/comment>/g;
  let match;
  while ((match = commentRegex.exec(xml)) !== null) {
    comments.push({
      anchor: unescapeXml(match[1]!.trim()),
      note: unescapeXml(match[2]!.trim()),
    });
  }
  return comments;
}

function parseTagContent(xml: string, tag: string): string | undefined {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  const match = regex.exec(xml);
  return match ? unescapeXml(match[1]!.trim()) : undefined;
}

export function formatPreview(type: string, content: string): string {
  if (type === 'feedback') {
    const comments = parseComments(content);
    if (comments.length === 0) {
      // Fallback: might be a note-only XML or empty feedback
      const note = parseTagContent(content, 'note');
      return note ?? '';
    }
    if (comments.length === 1) {
      return `"${comments[0]!.anchor}" — ${comments[0]!.note}`;
    }
    return `${comments.length} comments`;
  }

  if (type === 'clarification') {
    const answer = parseTagContent(content, 'answer');
    return answer ?? content;
  }

  // For approval, plan, and unknown types, return content as-is.
  return content;
}
