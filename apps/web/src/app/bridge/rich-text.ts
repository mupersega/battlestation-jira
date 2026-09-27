/**
 * Just enough of markdown to read an issue comfortably: paragraphs, bold,
 * inline code, and list items. Produces data, not HTML, so nothing from an
 * issue is ever injected into the page as markup.
 */

export interface Span {
  text: string;
  bold: boolean;
  code: boolean;
}

export interface Line {
  kind: 'text' | 'item' | 'gap';
  /** For list items: the marker as written ("1." or a bullet). */
  marker: string;
  spans: Span[];
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`)/g;
const ITEM = /^\s*(?:([-*])|(\d+)[.)])\s+(.*)$/;

export function spans(text: string): Span[] {
  return text
    .split(INLINE)
    .filter((part) => part !== '')
    .map((part) => {
      if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) return { text: part.slice(2, -2), bold: true, code: false };
      if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) return { text: part.slice(1, -1), bold: false, code: true };
      return { text: part, bold: false, code: false };
    });
}

export function richText(source: string): Line[] {
  const out: Line[] = [];
  for (const raw of source.replace(/\r\n/g, '\n').split('\n')) {
    if (raw.trim() === '') {
      if (out.length && out[out.length - 1].kind !== 'gap') out.push({ kind: 'gap', marker: '', spans: [] });
      continue;
    }
    const item = ITEM.exec(raw);
    if (item) out.push({ kind: 'item', marker: item[2] ? `${item[2]}.` : '\u2022', spans: spans(item[3]) });
    else out.push({ kind: 'text', marker: '', spans: spans(raw.trim()) });
  }
  while (out.length && out[out.length - 1].kind === 'gap') out.pop();
  return out;
}
