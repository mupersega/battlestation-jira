import { richText, spans } from './rich-text';

describe('richText', () => {
  it('reads bold and inline code', () => {
    expect(spans('Use **dp**, not `px`.')).toEqual([
      { text: 'Use ', bold: false, code: false },
      { text: 'dp', bold: true, code: false },
      { text: ', not ', bold: false, code: false },
      { text: 'px', bold: false, code: true },
      { text: '.', bold: false, code: false },
    ]);
  });

  it('keeps paragraphs apart and reads both kinds of list', () => {
    const lines = richText('First.\n\n\n- one\n- two\n\n1. alpha\n2) beta\n\n');
    expect(lines.map((l) => [l.kind, l.marker, l.spans.map((s) => s.text).join('')])).toEqual([
      ['text', '', 'First.'],
      ['gap', '', ''],
      ['item', '\u2022', 'one'],
      ['item', '\u2022', 'two'],
      ['gap', '', ''],
      ['item', '1.', 'alpha'],
      ['item', '2.', 'beta'],
    ]);
  });

  it('leaves markup as text', () => {
    expect(spans('<img src=x onerror=alert(1)>')).toEqual([{ text: '<img src=x onerror=alert(1)>', bold: false, code: false }]);
    expect(spans('a ** b')).toEqual([{ text: 'a ** b', bold: false, code: false }]);
  });
});
