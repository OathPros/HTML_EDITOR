/* Shared context-menu UI. All actions belong to the host editor, never the preview. */
window.EditorUI = (() => {
  'use strict';
  const menu = document.createElement('div');
  menu.className = 'editor-menu'; menu.hidden = true; menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Editor actions'); document.body.append(menu);
  let returnFocus = null;
  function close(restore = false) {
    menu.hidden = true;
    if (restore && returnFocus?.isConnected) returnFocus.focus();
  }
  function show(event, items, title = 'Editor actions') {
    event.preventDefault(); event.stopPropagation();
    returnFocus = event.target.ownerDocument.activeElement;
    menu.replaceChildren();
    const heading = document.createElement('div'); heading.className = 'menu-title'; heading.textContent = title; menu.append(heading);
    for (const item of items) {
      if (!item) { menu.append(document.createElement('hr')); continue; }
      const button = document.createElement('button'); button.type = 'button'; button.textContent = item.label;
      button.setAttribute('role', 'menuitem'); button.disabled = !!item.disabled;
      if (item.danger) button.className = 'danger';
      button.addEventListener('pointerdown', e => e.preventDefault());
      button.addEventListener('click', () => { close(); item.run(); }); menu.append(button);
    }
    const frame = event.target.ownerDocument.defaultView.frameElement;
    const bounds = frame?.getBoundingClientRect();
    let x = event.clientX + (bounds ? bounds.left + frame.clientLeft : 0);
    let y = event.clientY + (bounds ? bounds.top + frame.clientTop : 0);
    const keyboard = event.clientX === 0 && event.clientY === 0;
    if (keyboard) {
      const rect = event.target.getBoundingClientRect();
      x += rect.left; y += rect.bottom;
    }
    menu.hidden = false;
    menu.style.left = Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8)) + 'px';
    if (keyboard) menu.querySelector('button:not(:disabled)')?.focus();
  }
  function bind(doc, handler) {
    doc.addEventListener('contextmenu', handler, true);
    doc.addEventListener('pointerdown', e => { if (!menu.contains(e.target)) close(); }, true);
    doc.addEventListener('scroll', e => { if (!menu.contains(e.target)) close(); }, true);
    doc.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) close(true); }, true);
  }
  menu.addEventListener('keydown', e => {
    const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      let index = buttons.indexOf(document.activeElement);
      index = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[index]?.focus();
    } else if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'Tab') close();
  });
  window.addEventListener('resize', () => close());
  async function copy(text, notify) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch {
      const input = document.createElement('textarea'); input.value = text; input.style.position = 'fixed'; input.style.left = '-9999px'; document.body.append(input); input.select();
      let copied = false;
      try { copied = document.execCommand('copy'); } catch { /* Use keyboard fallback below. */ }
      input.remove();
      if (!copied) notify('Clipboard access is unavailable. Select the text and use Ctrl/Cmd+C.');
      return copied;
    }
  }
  function textActions(target, notify) {
    const input = target.closest('input,textarea');
    const editable = target.closest('[contenteditable]:not([contenteditable="false"])');
    if (!input && !editable) return null;
    if (input && input.selectionStart === null) return null;
    const field = input || editable, doc = field.ownerDocument;
    const readOnly = input && (input.readOnly || input.disabled);
    const start = input?.selectionStart, end = input?.selectionEnd;
    const initialValue = input?.value;
    const range = !input && doc.getSelection()?.rangeCount ? doc.getSelection().getRangeAt(0).cloneRange() : null;
    const text = input ? input.value.slice(start, end) : range?.toString() || '';
    function replace(value) {
      if (!field.isConnected || (input && input.value !== initialValue)) return notify('The text changed while waiting for the clipboard. Select it again.');
      field.focus();
      if (input) field.setRangeText(value, start, end, 'end');
      else if (range) {
        range.deleteContents(); const node = doc.createTextNode(value); range.insertNode(node); range.setStartAfter(node); range.collapse(true);
        doc.getSelection().removeAllRanges(); doc.getSelection().addRange(range);
      }
      field.dispatchEvent(new Event('input', {bubbles: true}));
    }
    return [
      {label: 'Copy text', disabled: !text, run: () => copy(text, notify)},
      {label: 'Cut text', disabled: readOnly || !text, run: async () => { if (await copy(text, notify)) replace(''); }},
      {label: 'Paste text', disabled: readOnly, run: async () => {
        try { replace(await navigator.clipboard.readText()); }
        catch { notify('Clipboard access was blocked. Use Ctrl/Cmd+V to paste.'); }
      }},
      {label: 'Select all text', disabled: !!input?.disabled, run: () => {
        field.focus();
        if (input) field.select();
        else { const selection = doc.getSelection(), r = doc.createRange(); r.selectNodeContents(field); selection.removeAllRanges(); selection.addRange(r); }
      }}
    ];
  }
  return {show, close, bind, copy, textActions};
})();
