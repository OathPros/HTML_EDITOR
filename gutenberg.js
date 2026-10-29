(() => {
  'use strict';
  const G = window.GutenbergSource;
  const UI = window.EditorUI;
  const $ = id => document.getElementById(id);
  const storageKey = 'markup-studio-gutenberg-v1';
  const example = '<!-- wp:html -->\n<style>\n.demo{font-family:system-ui,sans-serif;max-width:760px;margin:auto;padding:64px 32px;color:#20232c}.demo h1{font-size:46px;letter-spacing:-2px}.demo p{font-size:19px;line-height:1.7}\n</style>\n<section class="demo">\n<h1>Your Gutenberg source, preserved.</h1>\n<p>Open a WordPress dump or paste the full page from the Code editor. Click this sentence to try a text edit.</p>\n<p>Tags, styles and Gutenberg block boundaries stay intact.</p>\n</section>\n<!-- /wp:html -->\n';
  let original = example, current = example, model, history = [example], position = 0;
  let selected = null, selectedValue = '', pending = false, view = 'visual', imported = false;
  let savedSignature = '', marker = '', renderedTexts = new Map(), mappedNodes = new WeakMap(), highlight = null;
  let inline = null, scrollPosition = null;
  const frame = $('preview');
  const message = text => { $('status').textContent = text; };
  const signature = () => JSON.stringify([original, current, $('filename').value]);
  function decodeText(text) { const decoder = document.createElement('textarea'); decoder.innerHTML = text; return decoder.value; }
  function endInline() {
    if (!inline) return;
    inline.element.replaceWith(inline.node); inline = null;
  }
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
    endInline();
    highlight?.removeAttribute('data-gb-editor-selected'); highlight = null;
    selected = null; selectedValue = ''; $('text').value = ''; $('text').disabled = true;
    $('selection').textContent = model.errors.length ? 'Editing is locked because this source has errors. Import the WordPress Code editor source and review Source checks below.' : 'Double-click preview text, or choose a text passage above.';
    $('passage').value = ''; $('editInline').disabled = true;
    checkPending();
  }
  function selectText(id, node) {
    if (pending && !confirm('Discard the pending text change?')) return false;
    discardSelection();
    node ||= {data: decodeText(model.texts[id].raw), parentElement: null};
    selected = model.texts[id]; selectedValue = node.data.replace(/\r\n?/g, '\n');
    $('text').value = selectedValue; $('text').disabled = false;
    $('selection').textContent = 'Custom HTML block ' + (selected.blockId + 1) + ' · source line ' + lineAt(selected.start);
    highlight = node.parentElement;
    highlight?.setAttribute('data-gb-editor-selected', '');
    $('passage').value = String(id); $('editInline').disabled = !renderedTexts.has(id);
    document.querySelectorAll('.block').forEach(b => b.classList.toggle('active', Number(b.dataset.block) === selected.blockId));
    checkPending();
    return true;
  }
  function beginInline(id = selected?.id) {
    if (id === undefined || model.errors.length) return message('Choose supported Custom HTML text first. Check Source checks if editing is blocked.');
    if (inline?.id === id) { inline.element.focus(); return; }
    if (selected?.id !== id && !selectText(id, renderedTexts.get(id))) return;
    const node = renderedTexts.get(id);
    if (!node?.isConnected) return message('This passage can be edited in the text panel. It cannot be mapped to the preview.');
    const element = node.ownerDocument.createElement('span');
    element.setAttribute('contenteditable', 'plaintext-only'); element.setAttribute('data-gb-inline', '');
    element.setAttribute('aria-label', 'Edit selected text'); element.style.whiteSpace = 'pre-wrap';
    element.textContent = $('text').value; node.replaceWith(element); inline = {element, node, id};
    element.addEventListener('input', () => { $('text').value = element.innerText.replace(/\r\n?/g, '\n'); checkPending(); });
    element.focus();
    const range = node.ownerDocument.createRange(); range.selectNodeContents(element);
    const selection = node.ownerDocument.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    message('Editing on canvas · Ctrl/Cmd+Enter to apply · Escape to cancel.');
  }
  function applyText() {
    if (!pending || selected === null) { endInline(); return true; }
    try { commit(G.patchText(current, selected, $('text').value, decodeText)); return true; }
    catch (e) { message(e.message); return false; }
  }
  function cancelText() {
    endInline(); $('text').value = selectedValue; checkPending(); message('Pending text change discarded.');
  }
  function textIdAt(e) {
    const doc = e.target.ownerDocument;
    if (inline?.element.contains(e.target)) return inline.id;
    const caret = doc.caretPositionFromPoint?.(e.clientX, e.clientY);
    const range = caret ? null : doc.caretRangeFromPoint?.(e.clientX, e.clientY);
    const node = caret?.offsetNode || range?.startContainer;
    const id = node && e.target.contains(node) ? mappedNodes.get(node) : undefined;
    return id ?? [...renderedTexts].find(([, text]) => e.target.contains(text))?.[0];
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
    $('passage').replaceChildren(new Option('Choose text to edit…', ''));
    $('passage').disabled = model.errors.length > 0;
    for (const text of model.texts) $('passage').append(new Option('Block ' + (text.blockId + 1) + ' · ' + decodeText(text.raw).trim().replace(/\s+/g, ' ').slice(0, 80), text.id));
    for (const block of model.blocks) {
      const button = document.createElement('button'); button.className = 'block'; button.dataset.block = block.id;
      const title = document.createElement('span'); title.textContent = (block.id + 1) + '. ' + block.name;
      const detail = document.createElement('small');
      detail.textContent = block.name === 'core/html' && !block.selfClosing ? 'Custom HTML · text edits' : block.name === 'core/block' ? 'Shared block reference · preserved' : 'Read-only · preserved';
      button.append(title, detail);
      button.addEventListener('click', () => {
        const text = model.texts.find(t => t.blockId === block.id);
        if (model.errors.length) return message('Source has errors. Export and visual editing are blocked; download the original for recovery.');
        if (text) {
          selectText(text.id, renderedTexts.get(text.id));
          if (selected?.id === text.id) renderedTexts.get(text.id)?.parentElement?.scrollIntoView({block: 'center'});
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
    UI.close();
    scrollPosition = frame.contentDocument?.scrollingElement ? {x: frame.contentWindow.scrollX, y: frame.contentWindow.scrollY} : null;
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
    const style = doc.createElement('style'); style.textContent = '[data-gb-editor-selected]{outline:2px solid #635bff!important;outline-offset:3px!important}[data-gb-inline]{outline:2px solid #0e956b!important;cursor:text!important}'; doc.head.append(style);
    if (scrollPosition) frame.contentWindow.scrollTo(scrollPosition.x, scrollPosition.y);
    doc.addEventListener('click', e => {
      if (inline?.element.contains(e.target)) return;
      if (e.target.closest('a,button,input,select,textarea,label,summary')) e.preventDefault();
      if (model.errors.length) return message('Editing is blocked by source errors. See Source checks for the affected lines.');
      const id = textIdAt(e);
      if (id !== undefined) selectText(id, renderedTexts.get(id));
      else {
        if (!pending) discardSelection();
        message('This area has no supported Custom HTML text. Its source is preserved read-only.');
      }
    }, true);
    doc.addEventListener('dblclick', e => {
      if (inline?.element.contains(e.target)) return;
      const id = textIdAt(e);
      if (id !== undefined) { e.preventDefault(); beginInline(id); }
    }, true);
    UI.bind(doc, contextMenu);
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
    if (pending) { message('Apply or discard the pending text change before saving.'); return false; }
    try {
      localStorage.setItem(storageKey, JSON.stringify({original, source: current, name: $('filename').value}));
      savedSignature = signature();
      message('Draft and original saved in this browser' + (model.errors.length ? ' · source errors remain; export blocked' : ''));
      return true;
    } catch { message('Browser save failed. Storage may be unavailable or full. Download your source or original backup.'); return false; }
  }
  function shortcut(e) {
    if (inline && e.key === 'Escape') { e.preventDefault(); cancelText(); }
    else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); applyText(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if ((!inline || applyText())) save(); }
  }
  $('apply').addEventListener('click', applyText);
  $('cancel').addEventListener('click', cancelText);
  $('text').addEventListener('input', () => { if (inline) inline.element.textContent = $('text').value; checkPending(); });
  $('editInline').addEventListener('click', () => beginInline());
  $('passage').addEventListener('change', () => {
    if ($('passage').value === '') return;
    const id = Number($('passage').value);
    if (selectText(id, renderedTexts.get(id))) { $('text').focus(); $('text').select(); }
    else $('passage').value = String(selected?.id ?? '');
  });
  function switchEditor() { if (applyText() && save()) location.href = 'index.html'; }
  $('switchEditor').addEventListener('click', switchEditor);
  function contextMenu(e) {
    if (e.target.closest('.editor-menu')) { e.preventDefault(); return; }
    const isPreview = e.target.ownerDocument === frame.contentDocument;
    const textActions = UI.textActions(e.target, message);
    if (isPreview && !textActions && !model.errors.length && !pending) {
      const id = textIdAt(e);
      if (id !== undefined) selectText(id, renderedTexts.get(id));
      else discardSelection();
    }
    const blockButton = e.target.closest('.block');
    if (blockButton && !pending && !model.errors.length) {
      const token = model.texts.find(t => t.blockId === Number(blockButton.dataset.block));
      if (token) selectText(token.id, renderedTexts.get(token.id)); else discardSelection();
    }
    const items = [
      ...(textActions ? [...textActions, null] : []),
      {label: 'Edit text on canvas', disabled: !selected || model.errors.length || !renderedTexts.has(selected.id), run: () => beginInline()},
      {label: 'Edit text in panel', disabled: !selected || model.errors.length, run: () => { $('text').scrollIntoView({block: 'center'}); $('text').focus(); $('text').select(); }},
      {label: 'Apply text change', disabled: !pending, run: applyText},
      {label: 'Discard text change', disabled: !pending && !inline, run: cancelText},
      null,
      {label: 'Undo', disabled: $('undo').disabled, run: () => $('undo').click()},
      {label: 'Redo', disabled: $('redo').disabled, run: () => $('redo').click()},
      {label: 'Review source changes', run: () => $('changes').click()},
      {label: 'Save in browser', disabled: pending && !inline, run: () => { if (!inline || applyText()) save(); }},
      {label: 'Export Gutenberg source', disabled: $('export').disabled, run: () => $('export').click()},
      null, {label: 'Switch to HTML editor', run: switchEditor}
    ];
    UI.show(e, items, selected ? 'Gutenberg text actions' : 'Gutenberg actions · text selection required');
  }
  UI.bind(document, contextMenu);
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
