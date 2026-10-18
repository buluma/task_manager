/* A small markdown to HTML converter, shared by the server (task descriptions, opt-in with `descFormat: "markdown"`)
   and the app (comments, rendered when shown). The result goes into the page as HTML, so safety comes from escaping every character of input first
   and only then adding tags of our own: headings, b/i/s/code, lists, pre, blockquote, hr and http(s)/mailto links.
   Not a full CommonMark: nested lists are flattened and tables stay as preformatted text. */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => s.replace(/[&<>"']/g, c => ESC[c]);

const SAFE_URL = /^(?:https?:\/\/|mailto:)/i;
const anchor = (href, inner) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${inner}</a>`;

/* Inline markup of one line. Code spans and links are set aside as placeholders first, so what is inside them is
   never read as emphasis, and emphasis never touches a URL. */
function inline(line) {
  const stash = [];
  const hold = html => `\uE000${stash.push(html) - 1}\uE000`;
  let s = line.replace(/\uE000/g, '');
  s = s.replace(/`([^`\n]+)`/g, (m, code) => hold(`<code>${esc(code)}</code>`));
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => (SAFE_URL.test(url) ? hold(anchor(url, emphasis(text))) : m));
  s = s.replace(/https?:\/\/(?:(?!&quot;|&#39;)[^\s<>])+/g, m => {
    const url = m.replace(/[.,;:!?)\]]+$/, '');
    return hold(anchor(url, url)) + m.slice(url.length);
  });
  s = emphasis(s);
  // Placeholders can nest (a code span inside link text), so restore until none are left.
  for (let i = 0; i < 4 && s.includes('\uE000'); i++) s = s.replace(/\uE000(\d+)\uE000/g, (m, n) => stash[n]);
  return s;
}

function emphasis(s) {
  return s
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '<b>$1</b>')
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '<s>$1</s>')
    .replace(/(?<![\w*])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![\w*])/g, '<i>$1</i>')
    .replace(/(?<!\w)_(?=[^\s_])(.+?)(?<=[^\s_])_(?!\w)/g, '<i>$1</i>');
}

const FENCE = /^\s*```/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;
const BULLET = /^(\s*)(?:[*\-•])\s+(.*)$/;
const NUMBERED = /^(\s*)\d+[.)]\s+(.*)$/;
const TABLE = /^\s*\|/;

export function markdownToHtml(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null; // { tag: 'ul' | 'ol', items: [html lines per item] }
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map(i => `<li>${i.map(inline).join('<br>')}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  const flush = () => {
    flushPara();
    flushList();
  };
  const isBlock = l => FENCE.test(l) || HEADING.test(l) || RULE.test(l) || QUOTE.test(l) || BULLET.test(l) || NUMBERED.test(l) || TABLE.test(l);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if (FENCE.test(line)) {
      flush();
      const code = [];
      for (i++; i < lines.length && !FENCE.test(lines[i]); i++) code.push(lines[i]);
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
    } else if (!line.trim()) {
      flushPara();
      // A blank line inside a list does not end it when the next item continues the same list.
      const next = lines.slice(i + 1).find(l => l.trim());
      const same = list && next && (list.tag === 'ul' ? BULLET.test(next) : NUMBERED.test(next));
      if (!same) flushList();
    } else if ((m = HEADING.exec(line))) {
      flush();
      const level = Math.min(m[1].length + 2, 6);
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
    } else if (RULE.test(line)) {
      flush();
      out.push('<hr>');
    } else if (TABLE.test(line)) {
      flush();
      const rows = [];
      for (; i < lines.length && TABLE.test(lines[i]); i++) rows.push(lines[i].trim());
      i--;
      out.push(`<pre>${esc(rows.join('\n'))}</pre>`);
    } else if (QUOTE.test(line)) {
      flush();
      const quoted = [];
      for (; i < lines.length && QUOTE.test(lines[i]); i++) quoted.push(QUOTE.exec(lines[i])[1]);
      i--;
      out.push(`<blockquote>${quoted.map(inline).join('<br>')}</blockquote>`);
    } else if ((m = BULLET.exec(line) || NUMBERED.exec(line))) {
      flushPara();
      const tag = BULLET.test(line) ? 'ul' : 'ol';
      if (list && list.tag !== tag) flushList();
      (list ??= { tag, items: [] }).items.push([m[2]]);
    } else if (list && /^\s{2,}\S/.test(line) && !isBlock(line)) {
      list.items[list.items.length - 1].push(line.trim()); // wrapped text of the previous item
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flush();
  return out.join('');
}

const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* Wraps @Name in a mention chip, for each member name, in the text of `html` from markdownToHtml: never inside a tag
   or a link, so an address with an @ in it is left alone. Longest names first, so "@Ada Lovelace" beats "@Ada". */
export function markMentions(html, names) {
  if (!names.length) return html;
  const re = new RegExp(
    '@(' +
      [...names]
        .sort((a, b) => b.length - a.length)
        .map(n => reEsc(esc(n)))
        .join('|') +
      ')',
    'g',
  );
  let inLink = 0;
  return html
    .split(/(<[^>]*>)/)
    .map(part => {
      if (part.startsWith('<')) {
        if (/^<a\b/.test(part)) inLink++;
        else if (part === '</a>') inLink--;
        return part;
      }
      return inLink ? part : part.replace(re, '<span class="mention">@$1</span>');
    })
    .join('');
}
