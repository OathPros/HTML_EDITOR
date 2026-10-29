(() => {
  'use strict';
  const G = window.GutenbergSource;
  const $ = id => document.getElementById(id);
  const storageKey = 'markup-studio-gutenberg-v1';
  const example = '<!-- wp:html -->\n<style>\n.demo{font-family:system-ui,sans-serif;max-width:760px;margin:auto;padding:64px 32px;color:#20232c}.demo h1{font-size:46px;letter-spacing:-2px}.demo p{font-size:19px;line-height:1.7}\n</style>\n<section class="demo">\n<h1>Your Gutenberg source, preserved.</h1>\n<p>Open a WordPress dump or paste the full page from the Code editor. Click this sentence to try a text edit.</p>\n<p>Tags, styles and Gutenberg block boundaries stay intact.</p>\n</section>\n<!-- /wp:html -->\n';
  let original = example, current = example, model, history = [example], position = 0;
  let selected = null, selectedValue = '', pending = false, view = 'visual', imported = false;
  let savedSignature = '', marker = '', renderedTexts = new Map(), mappedNodes = new WeakMap(), highlight = null;
  const frame = $('preview');
  const message = text => { $('status').textContent = text; };
  const signature = () => JSON.stringify([original, current, $('filename').value]);
  function filename(suffix = '') {
    const name = $('filename').value.trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '-') || 'wordpress-page.html';
    return name.replace(/\.(?:html?|txt)$/i, '') + suffix + '.html';
  }
  function download(text, name) {
    const url = URL.createObjectURL(new Blob([text], {type: 'text/html;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function lineAt(start) { return current.slice(0, start).split(/\r\n|\r|\n/).length; }
  function checkPending() {
    pending = selected !== null && $('text').value !== selectedValue;
    $('apply').disabled = !pending || model.errors.length > 0;
    $('cancel').disabled = !pending;
    $('export').disabled = pending || model.errors.length > 0;
    $('save').disabled = pending;
    $('previewExport').disabled = pending || model.errors.length > 0;
    if (pending) message('Text change pending — apply or discard it before saving or exporting.');
  }
  function discardSelection() {
    highlight?.removeAttribute('data-gb-editor-selected'); highlight = null;
    selected = null; selectedValue = ''; $('text').value = ''; $('text').disabled = true;
    $('selection').textContent = 'Click text in a Custom HTML block to select a source range.';
    checkPending();
  }
  function selectText(id, node) {
    if (pending && !confirm('Discard the pending text change?')) return;
    discardSelection();
    selected = model.texts[id]; selectedValue = node.data.replace(/\r\n?/g, '\n');
    $('text').value = selectedValue; $('text').disabled = false;
    $('selection').textContent = 'Custom HTML block ' + (selected.blockId + 1) + ' · source line ' + lineAt(selected.start);
    highlight = node.parentElement;
    highlight?.setAttribute('data-gb-editor-selected', '');
    document.querySelectorAll('.block').forEach(b => b.classList.toggle('active', Number(b.dataset.block) === selected.blockId));
    checkPending();
  }
  function renderChecks() {
    $('validation').replaceChildren();
    $('validationSummary').textContent = model.errors.length ? '· ' + model.errors.length + ' errors' : '· ' + model.warnings.length + ' warnings';
    if (!model.errors.length) {
      const p = document.createElement('p'); p.className = 'pass'; p.textContent = 'Source checks passed. WordPress validation is still required.'; $('validation').append(p);
    }
    for (const [kind, items] of [['error', model.errors], ['warning', model.warnings]]) {
      for (const item of items) {
        const p = document.createElement('div'); p.className = 'issue ' + kind;
        const title = document.createElement('strong'); title.textContent = item.code + ' · line ' + lineAt(item.start);
        p.append(title, document.createTextNode(item.message)); $('validation').append(p);
      }
    }
  }
  function renderBlocks() {
    $('blocks').replaceChildren();
    for (const block of model.blocks) {
      const button = document.createElement('button'); button.className = 'block'; button.dataset.block = block.id;
      const title = document.createElement('span'); title.textContent = (block.id + 1) + '. ' + block.name;
      const detail = document.createElement('small');
      detail.textContent = block.name === 'core/html' && !block.selfClosing ? 'Custom HTML · text edits' : block.name === 'core/block' ? 'Shared block reference · preserved' : 'Read-only · preserved';
      button.append(title, detail);
      button.addEventListener('click', () => {
        const text = model.texts.find(t => t.blockId === block.id && renderedTexts.has(t.id));
        if (model.errors.length) return message('Source has errors. Export and visual editing are blocked; download the original for recovery.');
        if (text) {
          selectText(text.id, renderedTexts.get(text.id));
          if (selected?.id === text.id) renderedTexts.get(text.id).parentElement?.scrollIntoView({block: 'center'});
        } else {
          if (!pending) discardSelection();
          message(detail.textContent + '. No editable rendered text in this block.');
        }
      });
      $('blocks').append(button);
    }
  }
  function renderDiff() {
    let start = 0, endA = original.length, endB = current.length;
    while (start < endA && start < endB && original[start] === current[start]) start++;
    while (endA > start && endB > start && original[endA - 1] === current[endB - 1]) { endA--; endB--; }
    $('changeSummary').textContent = current === original ? 'No changes. Gutenberg export is identical to the imported source.' : 'Only committed text edits are applied. This comparison spans the first through last changed character, with surrounding context.';
    const before = original.slice(Math.max(0, start - 100), Math.min(original.length, endA + 100));
    const after = current.slice(Math.max(0, start - 100), Math.min(current.length, endB + 100));
    $('before').textContent = current === original ? 'No changed range.' : before;
    $('after').textContent = current === original ? 'No changed range.' : after;
  }
  function previewDocument(source) {
    return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\' https:; img-src https: data:; font-src https: data:; script-src \'none\'; form-action \'none\'; base-uri \'none\'"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + source + '</body></html>';
  }
  function render() {
    model = G.analyze(current); discardSelection(); renderChecks(); renderBlocks(); renderDiff();
    $('sourceView').value = current;
    $('undo').disabled = position === 0; $('redo').disabled = position === history.length - 1;
    marker = 'gb-' + crypto.getRandomValues(new Uint32Array(4)).join('-');
    renderedTexts = new Map(); mappedNodes = new WeakMap();
    frame.srcdoc = previewDocument(G.markedPreview(current, model, marker));
    message(model.errors.length ? 'Source errors found — export blocked. The imported source has not been repaired or rewritten.' : (current === original ? 'Original source preserved · click preview text to edit' : 'Text edit applied · review Changes before export'));
  }
  frame.addEventListener('load', () => {
    const doc = frame.contentDocument;
    if (!doc?.body) return;
    const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_COMMENT);
    while (walker.nextNode()) {
      const comment = walker.currentNode;
      if (!comment.data.startsWith(marker + ':')) continue;
      const id = Number(comment.data.slice(marker.length + 1)), text = comment.nextSibling;
      if (model.texts[id] && text?.nodeType === Node.TEXT_NODE && text.nextSibling?.nodeType === Node.COMMENT_NODE && text.nextSibling.data === '/' + marker) {
        renderedTexts.set(id, text); mappedNodes.set(text, id);
      }
    }
    const style = doc.createElement('style'); style.textContent = '[data-gb-editor-selected]{outline:2px solid #635bff!important;outline-offset:3px!important}'; doc.head.append(style);
    doc.addEventListener('click', e => {
      if (e.target.closest('a,button,input,select,textarea,label,summary')) e.preventDefault();
      if (model.errors.length) return;
      const caret = doc.caretPositionFromPoint?.(e.clientX, e.clientY);
      const range = caret ? null : doc.caretRangeFromPoint?.(e.clientX, e.clientY);
      const node = caret?.offsetNode || range?.startContainer;
      let id = node && e.target.contains(node) ? mappedNodes.get(node) : undefined;
      if (id === undefined) {
        const match = [...renderedTexts].find(([, text]) => e.target.contains(text));
        if (match) id = match[0];
      }
      if (id !== undefined) selectText(id, renderedTexts.get(id));
      else {
        if (!pending) discardSelection();
        message('This area has no supported Custom HTML text. Its source is preserved read-only.');
      }
    }, true);
    doc.addEventListener('submit', e => e.preventDefault(), true);
    doc.addEventListener('keydown', shortcut, true);
  });
  function commit(source) {
    if (source === current) return;
    history = history.slice(0, position + 1); history.push(source); position++;
    current = source; render();
  }
  function importSource(source, name) {
    if (imported && (pending || current !== original) && !confirm('Replace this draft? Download or save it first if you need to keep it.')) return false;
    original = source; current = source; history = [source]; position = 0; imported = true;
    $('filename').value = name || 'wordpress-page.html'; render(); return true;
  }
  function save() {
    if (pending) return message('Apply or discard the pending text change before saving.');
    try {
      localStorage.setItem(storageKey, JSON.stringify({original, source: current, name: $('filename').value}));
      savedSignature = signature();
      message('Draft and original saved in this browser' + (model.errors.length ? ' · source errors remain; export blocked' : ''));
    } catch { message('Browser save failed. Storage may be unavailable or full. Download your source or original backup.'); }
  }
  function shortcut(e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  }
  $('apply').addEventListener('click', () => {
    if (!pending || selected === null) return;
    try {
      const decoder = document.createElement('textarea');
      const decode = text => { decoder.innerHTML = text; return decoder.value; };
      commit(G.patchText(current, selected, $('text').value, decode));
    } catch (e) { message(e.message); }
  });
  $('cancel').addEventListener('click', () => { $('text').value = selectedValue; checkPending(); message('Pending text change discarded.'); });
  $('text').addEventListener('input', checkPending);
  $('undo').addEventListener('click', () => {
    if (!position || (pending && !confirm('Discard the pending text change?'))) return;
    current = history[--position]; render();
  });
  $('redo').addEventListener('click', () => {
    if (position >= history.length - 1 || (pending && !confirm('Discard the pending text change?'))) return;
    current = history[++position]; render();
  });
  $('restore').addEventListener('click', () => {
    if ((pending || current !== original) && confirm('Restore the exact imported source? You can undo this action.')) {
      discardSelection(); commit(original); render();
    }
  });
  $('backup').addEventListener('click', () => download(original, filename('-original')));
  $('save').addEventListener('click', save);
  $('export').addEventListener('click', () => {
    if (pending || G.analyze(current).errors.length) return;
    download(current, filename()); message('Gutenberg source exported. Review warnings and verify it in WordPress before publishing.');
  });
  $('previewExport').addEventListener('click', () => {
    if (pending || model.errors.length) return;
    download(previewDocument(current), filename('-preview'));
    message('Standalone preview downloaded. This file is not Gutenberg source; scripts remain disabled.');
  });
  $('open').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', async e => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try {
      const source = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(await file.arrayBuffer());
      importSource(source, file.name);
    } catch { message('Could not read this file as UTF-8. Export a UTF-8 Gutenberg source file and try again.'); }
  });
  $('paste').addEventListener('click', () => $('pasteDialog').showModal());
  $('importPaste').addEventListener('click', () => {
    if (!$('pasteText').value.trim()) return;
    if (importSource($('pasteText').value, 'wordpress-page.html')) { $('pasteDialog').close(); $('pasteText').value = ''; }
  });
  for (const name of ['visual', 'source', 'changes']) $(name).addEventListener('click', () => {
    view = name;
    $('canvas').hidden = view !== 'visual'; $('sourceView').hidden = view !== 'source'; $('diff').hidden = view !== 'changes';
    $('size').hidden = view !== 'visual';
    for (const n of ['visual', 'source', 'changes']) $(n).classList.toggle('active', n === view);
  });
  $('size').addEventListener('change', () => { frame.style.width = $('size').value; });
  document.addEventListener('keydown', shortcut);
  window.addEventListener('beforeunload', e => {
    if (pending || (current !== original && signature() !== savedSignature)) { e.preventDefault(); e.returnValue = ''; }
  });
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && typeof saved.original === 'string' && typeof saved.source === 'string' && typeof saved.name === 'string') {
      original = saved.original; current = saved.source; $('filename').value = saved.name;
      history = original === current ? [original] : [original, current]; position = history.length - 1; imported = true; savedSignature = signature();
    }
  } catch { /* Storage may be disabled. Opening and exporting files still works. */ }
  render();
})();
