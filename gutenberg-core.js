/* Source-preserving helpers. The preview is never serialized back to source. */
(function (root) {
  'use strict';
  const rawTags = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);
  const protectedTags = new Set([...rawTags, 'svg', 'math', 'template', 'noscript', 'select', 'option', 'button']);
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const escapeText = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function attributes(raw) {
    const attrs = [];
    const body = raw.replace(/^<\s*[^\s/>]+/, '').replace(/\/?>$/, '');
    const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let m;
    while ((m = re.exec(body))) attrs.push({name: m[1].toLowerCase(), value: m[2] ?? m[3] ?? m[4] ?? ''});
    return attrs;
  }
  function lex(source) {
    const tokens = [];
    let pos = 0;
    function add(type, end, extra = {}) {
      tokens.push({type, start: pos, end, raw: source.slice(pos, end), ...extra});
      pos = end;
    }
    while (pos < source.length) {
      if (source.startsWith('<!--', pos)) {
        const end = source.indexOf('-->', pos + 4);
        add('comment', end < 0 ? source.length : end + 3, {unclosed: end < 0});
      } else if (/^<!doctype\b/i.test(source.slice(pos, pos + 12))) {
        const end = source.indexOf('>', pos);
        add('doctype', end < 0 ? source.length : end + 1);
      } else if (/^<\/?[a-zA-Z][\w:-]*(?=[\s/>])/.test(source.slice(pos))) {
        let end = pos + 1, quote = '';
        for (; end < source.length; end++) {
          const ch = source[end];
          if (quote) { if (ch === quote) quote = ''; }
          else if (ch === '"' || ch === "'") quote = ch;
          else if (ch === '>') break;
        }
        const raw = source.slice(pos, Math.min(end + 1, source.length));
        const match = /^<(\/?)([\w:-]+)/.exec(raw);
        const tag = match[2].toLowerCase(), closing = !!match[1];
        add('tag', Math.min(end + 1, source.length), {tag, closing, attrs: closing ? [] : attributes(raw), unclosed: end >= source.length});
        if (!closing && rawTags.has(tag)) {
          const close = new RegExp('</' + tag + '\\s*>', 'ig');
          close.lastIndex = pos;
          const m = tag === 'plaintext' ? null : close.exec(source);
          if ((m?.index ?? source.length) > pos) add('raw', m?.index ?? source.length);
        }
      } else {
        const next = source.indexOf('<', pos + 1);
        add('text', next < 0 ? source.length : next);
      }
    }
    return tokens;
  }
  function analyze(source) {
    const tokens = lex(source), blocks = [], texts = [], errors = [], warnings = [];
    const stack = [], htmlStack = [], ids = new Map(), links = [], labels = [];
    const issue = (list, code, message, token) => list.push({code, message, start: token?.start ?? 0});
    for (const token of tokens) {
      if (token.unclosed) issue(errors, 'UNCLOSED_TOKEN', 'Unclosed HTML tag or comment.', token);
      if (token.type === 'comment') {
        const inner = token.raw.slice(4, token.unclosed ? undefined : -3).trim();
        if (!/^\/?wp:/.test(inner)) continue;
        const m = /^(\/?)wp:([a-z0-9-]+(?:\/[a-z0-9-]+)?)(?:\s+([\s\S]*?))?$/.exec(inner);
        if (!m) { issue(errors, 'WP_MARKER', 'Malformed Gutenberg block marker.', token); continue; }
        const name = m[2].includes('/') ? m[2] : 'core/' + m[2];
        let attr = (m[3] || '').trim(), selfClosing = !m[1] && attr.endsWith('/');
        if (selfClosing) attr = attr.slice(0, -1).trim();
        if (m[1]) {
          if (attr) issue(errors, 'WP_MARKER', 'Closing markers cannot contain attributes.', token);
          const open = stack.pop();
          if (!open) issue(errors, 'WP_UNMATCHED_CLOSE', 'Closing block has no opening marker: ' + name, token);
          else {
            if (open.name !== name) issue(errors, 'WP_MISMATCHED_BLOCK', 'Expected closing ' + open.name + ', found ' + name, token);
            open.contentEnd = token.start; open.end = token.end;
          }
        } else {
          let data = {};
          if (attr) {
            try { data = JSON.parse(attr); if (!data || Array.isArray(data) || typeof data !== 'object') throw Error(); }
            catch { issue(errors, 'WP_ATTRIBUTES', 'Block attributes must be a JSON object.', token); }
          }
          const block = {id: blocks.length, name, start: token.start, contentStart: token.end, contentEnd: token.end, end: token.end, selfClosing, data, depth: stack.length};
          blocks.push(block);
          if (!selfClosing) stack.push(block);
        }
      }
      if (token.type === 'doctype') issue(errors, 'DOCUMENT_DOCTYPE', 'This is a full HTML document. Import Gutenberg block source instead.', token);
      if (token.type === 'tag') {
        if (['html', 'head', 'body'].includes(token.tag)) issue(errors, 'DOCUMENT_WRAPPER', 'Document wrapper <' + token.tag + '> cannot be exported as Gutenberg source.', token);
        if (token.tag.includes('grammarly') || token.tag === 'scribe-shadow') issue(errors, 'EXTENSION_MARKUP', 'Browser-extension element found.', token);
        if (!token.closing) {
          for (const a of token.attrs) {
            if (/^(data-(?:gr-|new-gr-|grammarly|scribe-|ab-filters)|data-gb-editor)/i.test(a.name)) issue(errors, 'EDITOR_ATTRIBUTE', 'Browser or editor attribute found: ' + a.name, token);
            if (a.name === 'contenteditable' && a.value !== 'false') issue(errors, 'CONTENTEDITABLE', 'Editable-page attribute needs review before Gutenberg export.', token);
            if (a.name === 'id') {
              if (ids.has(a.value)) issue(errors, 'DUPLICATE_ID', 'Duplicate ID: ' + a.value, token);
              ids.set(a.value, token);
            }
            if (a.name === 'href' && a.value.startsWith('#') && a.value.length > 1) links.push({value: a.value.slice(1), token});
            if (token.tag === 'label' && a.name === 'for') labels.push({value: a.value, token});
          }
          if (token.tag === 'script') issue(warnings, 'SCRIPT_PREVIEW', 'Scripts are preserved in source but disabled in this preview.', token);
          if (!voidTags.has(token.tag) && !/\/>$/.test(token.raw)) htmlStack.push(token.tag);
        } else {
          const index = htmlStack.lastIndexOf(token.tag);
          if (index !== -1) htmlStack.length = index;
        }
      }
      if (token.type === 'text' && token.raw.trim() && stack.at(-1)?.name === 'core/html' && !htmlStack.some(tag => protectedTags.has(tag))) {
        texts.push({...token, id: texts.length, blockId: stack.at(-1).id});
      }
    }
    for (const block of stack) issue(errors, 'WP_UNCLOSED_BLOCK', 'Block has no closing marker: ' + block.name, block);
    if (!blocks.length) issue(errors, 'NO_BLOCKS', 'No Gutenberg blocks found. Paste the WordPress Code editor source.');
    for (const block of blocks) {
      if (block.name === 'core/html' && !source.slice(block.contentStart, block.contentEnd).trim()) issue(warnings, 'EMPTY_BLOCK', 'Empty Custom HTML block.', block);
    }
    for (const {value, token} of links) {
      let target = value; try { target = decodeURIComponent(value); } catch {}
      if (!ids.has(target)) issue(warnings, 'BROKEN_ANCHOR', 'Anchor #' + value + ' has no target in this dump; it may exist in the WordPress page chrome.', token);
    }
    for (const {value, token} of labels) if (!ids.has(value)) issue(warnings, 'BROKEN_LABEL', 'Label target is missing: ' + value, token);
    return {tokens, blocks, texts, errors, warnings};
  }
  function patchText(source, token, value, decode = text => text) {
    const model = analyze(source);
    if (model.errors.length) throw Error('Fix source errors before visual editing.');
    const current = model.texts.find(t => t.start === token.start && t.end === token.end && t.raw === token.raw);
    if (!current) throw Error('The selected text changed. Select it again.');
    // Map decoded characters back to source units, so an edit to one word does
    // not normalize untouched entities or CRLF line endings in the same run.
    const units = [], re = /&(?:#[xX][0-9a-fA-F]+;?|#[0-9]+;?|[a-zA-Z][a-zA-Z0-9]*;?)|\r\n?|[\s\S]/g;
    let match, decoded = '';
    while ((match = re.exec(current.raw))) {
      const text = decode(match[0]).replace(/\r\n?/g, '\n');
      units.push({rawStart: match.index, rawEnd: re.lastIndex, start: decoded.length, end: decoded.length + text.length});
      decoded += text;
    }
    if (decoded === value) return source;
    let start = 0, endA = decoded.length, endB = value.length;
    while (start < endA && start < endB && decoded[start] === value[start]) start++;
    while (endA > start && endB > start && decoded[endA - 1] === value[endB - 1]) { endA--; endB--; }
    const first = units.find(u => u.end > start);
    const last = [...units].reverse().find(u => u.start < endA);
    const from = first && first.start < start ? first.start : start;
    const to = last && last.end > endA ? last.end : endA;
    const rawStart = first ? first.rawStart : current.raw.length;
    // An insertion at a boundary does not consume either adjacent unit.
    const rawEnd = endA === start && from === start && to === endA ? rawStart : last.rawEnd;
    const replacement = value.slice(from, endB + (to - endA));
    return source.slice(0, current.start + rawStart) + escapeText(replacement) + source.slice(current.start + rawEnd);
  }
  function markedPreview(source, model, prefix) {
    let result = source;
    for (const t of [...model.texts].reverse()) result = result.slice(0, t.start) + '<!--' + prefix + ':' + t.id + '-->' + t.raw + '<!--/' + prefix + '-->' + result.slice(t.end);
    return result;
  }
  const api = {lex, analyze, patchText, markedPreview, escapeText};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GutenbergSource = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
