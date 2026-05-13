// Minimal Markdown → DOM renderer. Supports headings (h1-h3),
// bold / italic / inline code, links, bullet & numbered lists,
// blockquotes, paragraphs. No innerHTML — every node is built
// via DOM API so the output is XSS-safe regardless of input.
//
// Skips: code blocks (```), tables, HTML pass-through, footnotes —
// all out of scope for research notes today.

export function renderMarkdownInto(parent, md) {
  while (parent.firstChild) parent.removeChild(parent.firstChild);
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // ATX heading
    const h = line.match(/^(#{1,3})\s+(.+?)\s*$/);
    if (h) {
      const el = document.createElement('h' + h[1].length);
      appendInline(el, h[2]);
      parent.appendChild(el);
      i++;
      continue;
    }
    // Blockquote
    if (/^>\s?/.test(line)) {
      const bq = document.createElement('blockquote');
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        const p = document.createElement('p');
        appendInline(p, lines[i].replace(/^>\s?/, ''));
        bq.appendChild(p);
        i++;
      }
      parent.appendChild(bq);
      continue;
    }
    // Bullet list
    if (/^\s*[-*+]\s+/.test(line)) {
      const ul = document.createElement('ul');
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const li = document.createElement('li');
        appendInline(li, lines[i].replace(/^\s*[-*+]\s+/, ''));
        ul.appendChild(li);
        i++;
      }
      parent.appendChild(ul);
      continue;
    }
    // Numbered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const ol = document.createElement('ol');
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const li = document.createElement('li');
        appendInline(li, lines[i].replace(/^\s*\d+\.\s+/, ''));
        ol.appendChild(li);
        i++;
      }
      parent.appendChild(ol);
      continue;
    }
    // Blank line — skip
    if (!line.trim()) { i++; continue; }
    // Paragraph: collect contiguous non-blank, non-block lines
    let buf = line;
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^#{1,3}\s/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      buf += ' ' + lines[i];
      i++;
    }
    const p = document.createElement('p');
    appendInline(p, buf);
    parent.appendChild(p);
  }
  return parent;
}

function appendInline(parent, text) {
  for (const tok of tokenizeInline(text)) {
    if (tok.type === 'text') {
      parent.appendChild(document.createTextNode(tok.value));
    } else if (tok.type === 'bold') {
      const el = document.createElement('strong');
      el.textContent = tok.value;
      parent.appendChild(el);
    } else if (tok.type === 'italic') {
      const el = document.createElement('em');
      el.textContent = tok.value;
      parent.appendChild(el);
    } else if (tok.type === 'code') {
      const el = document.createElement('code');
      el.textContent = tok.value;
      parent.appendChild(el);
    } else if (tok.type === 'link') {
      const el = document.createElement('a');
      // Only allow http(s) URLs for safety
      const safe = /^https?:\/\//i.test(tok.url) ? tok.url : '#';
      el.href = safe;
      el.target = '_blank';
      el.rel = 'noopener noreferrer';
      el.textContent = tok.value;
      parent.appendChild(el);
    }
  }
}

function tokenizeInline(s) {
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    // [label](url)
    const m1 = rest.match(/^\[([^\]\n]+)\]\(([^)\s]+)\)/);
    if (m1) { tokens.push({ type: 'link', value: m1[1], url: m1[2] }); i += m1[0].length; continue; }
    // **bold**
    const m2 = rest.match(/^\*\*([^*\n]+?)\*\*/);
    if (m2) { tokens.push({ type: 'bold', value: m2[1] }); i += m2[0].length; continue; }
    // *italic* (single asterisk; require non-space inner so "*" doesn't eat across spaces)
    const m3 = rest.match(/^\*([^*\n][^*\n]*?)\*/);
    if (m3) { tokens.push({ type: 'italic', value: m3[1] }); i += m3[0].length; continue; }
    // `code`
    const m4 = rest.match(/^`([^`\n]+)`/);
    if (m4) { tokens.push({ type: 'code', value: m4[1] }); i += m4[0].length; continue; }
    // Plain run up to next marker
    let j = i;
    while (j < s.length && !/[\[*`]/.test(s[j])) j++;
    if (j > i) { tokens.push({ type: 'text', value: s.slice(i, j) }); i = j; continue; }
    // Marker char that didn't match any pattern — emit as text and advance
    tokens.push({ type: 'text', value: s[i] }); i++;
  }
  return tokens;
}
