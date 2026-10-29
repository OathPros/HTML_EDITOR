# Gutenberg editor

Open `editors.html` to choose either editor, or `gutenberg.html` for the separate
Gutenberg editor. `index.html` is the standard HTML editor. Both are static pages served by GitHub Pages or
any static server; no installation or build is required.

For local development:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory /workspace/HTML_EDITOR
```

## Workflow

1. Open a UTF-8 Gutenberg dump (`.html`, `.htm`, or `.txt`), or paste the full
   source from WordPress's Code editor. This is block source, not a published
   page's browser HTML. No automatic repairs are made on import.
2. Double-click text in a Custom HTML block to type directly on the canvas.
   Ctrl/Cmd+Enter or Apply text change commits it; Escape cancels. Alternatively,
   select a Text passage in the inspector and edit it there. Pending edits must
   be applied or discarded before export. Ctrl/Cmd+S applies active canvas edits
   and saves the browser draft.
3. Review Source checks and Changes. Export Gutenberg source and paste it back
   into WordPress's Code editor. Check the page in the target WordPress editor
   and theme before publishing.

Opening and exporting without edits returns the imported UTF-8 bytes, including
BOM and CRLF line endings. Text edits patch source character ranges; untouched
entities and line endings remain unchanged. Source is never reconstructed from
the iframe DOM. Preview annotations, editing highlights and extension mutations
therefore cannot enter the source export.

Save in browser (Ctrl/Cmd+S) retains one Gutenberg draft and its original under
a separate storage key from the standard editor. It restores on reload at the
same origin. Browser storage can be cleared or run out of space; download an
original backup for durable recovery. Undo/redo works during the session; after
reloading a saved draft, the original and current draft remain available, but the
intermediate undo history does not. Restore original is undoable.

Both editors have a Switch editor button. Switching saves the current editor's
draft and opens the other editor's separate draft; it does not convert between
HTML and Gutenberg formats. Pending Gutenberg text changes are applied before
switching. If browser storage fails, switching stops and leaves the editor open.

Right-click the preview, outline or editor panels for context actions. The HTML
editor supports editing, duplicating, moving, deleting and inserting elements.
Gutenberg offers source-preserving text actions, undo/redo, change review and
export; unsupported structural actions are omitted. Text fields have copy, cut,
paste and select-all actions. Clipboard permissions may require using the
Ctrl/Cmd+C/V keyboard shortcuts instead. Menus close on Escape, outside click,
scroll or resize, and support arrow-key navigation.

## First-version scope

- Visual **text editing only**, inside `core/html` blocks. Tags, attributes,
  CSS, scripts, SVG/math content, form controls and block markers cannot be
  changed through the inspector. The Source tab is read-only.
- Native, plugin, shared/reusable and dynamic blocks are preserved without
  reserialization and have no visual editing support. Shared references cannot
  be resolved without the WordPress installation.
- Source checks reject missing/mismatched Gutenberg markers, invalid block JSON,
  document wrappers, known extension metadata, editor attributes and duplicate
  IDs. Missing local anchors/labels are warnings: targets may be outside the
  dump. Findings include source line numbers. Invalid originals can still be
  saved as browser drafts or downloaded as backups; Gutenberg export is blocked.
- Validation is a conservative lexical check, not WordPress's registered-block
  validation, an HTML sanitizer or a complete browser HTML parser. Ambiguous or
  parser-repaired text may not be selectable. Real WordPress testing is still
  required, especially for plugin blocks and pages with dependencies outside
  the dump.
- Previews use a sandbox without scripts, forms or top navigation, plus a CSP.
  External HTTPS styles, fonts and images may load. The preview does not include
  WordPress theme styles, execute widgets or resolve dynamic blocks. CSS controls
  may differ because clicking selects text. Download HTML preview is a separate
  output for viewing, with scripts still disabled; never paste it into WordPress.
- Structural/design changes and full Gutenberg editor integration are deferred.

## Checks

```sh
node tests/gutenberg.test.cjs
python3 tests/gutenberg-browser.py
python3 tests/editor-interactions.py
```

Browser tests require Python Playwright and `/usr/bin/chromium`, available in the
prepared cloud environment, and the local server above. To also exercise the
incident files without putting page content in Git:

```sh
python3 tests/gutenberg-browser.py --valid /path/to/repaired.txt --damaged /path/to/damaged.html
```

The tests cover exact source round trips, bounded text patches, entity and line
ending preservation, markup escaping, shared/plugin/native block preservation,
blocked invalid imports, disposable-preview contamination, browser persistence,
undo/restore, separate preview exports, direct canvas edits, context actions,
clipboard controls and switching between separately saved drafts.
