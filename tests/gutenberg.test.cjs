const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../gutenberg-core.js');
const wrap = content => '<!-- wp:html -->\r\n' + content + '\r\n<!-- /wp:html -->\r\n';
const decode = s => s.replace(/&amp;/g, '&').replace(/&nbsp;/g, '\u00a0').replace(/&#169;/g, '©').replace(/&NotEqualTilde;/g, '≂̸');

test('recognizes html, nested blocks, JSON and shared references without rewriting', () => {
  const source = '\ufeff<!-- wp:block {"ref":4751} /-->\r\n<!-- wp:group {"className":"x"} -->' + wrap('<p>Text</p>') + '<!-- /wp:group -->';
  const model = G.analyze(source);
  assert.equal(model.errors.length, 0);
  assert.deepEqual(model.blocks.map(b => b.name), ['core/block', 'core/group', 'core/html']);
  assert.equal(model.blocks[0].data.ref, 4751);
  assert.equal(model.texts.length, 1);
  assert.equal(G.patchText(source, model.texts[0], 'Text'), source);
});
test('text patch changes only the requested range and escapes injected markup', () => {
  const source = wrap('<p class="lead" id="intro">Hello &amp; welcome</p><svg><text>Diagram</text></svg>');
  const model = G.analyze(source);
  assert.equal(model.texts.length, 1);
  assert.equal(G.patchText(source, model.texts[0], 'Hello & everyone <script>', decode), source.replace('welcome', 'everyone &lt;script&gt;'));
});
test('preserves entity spellings and CRLF outside an edited word', () => {
  const source = wrap('<p>© &#169; &nbsp;\r\nHello &amp; world</p>');
  const token = G.analyze(source).texts[0];
  const updated = G.patchText(source, token, '© © \u00a0\nHello & York', decode);
  assert.equal(updated, source.replace('world', 'York'));
});
test('supports insertion, deletion, empty text, and edits inside a multi-codepoint entity', () => {
  for (const [before, after] of [['abc', 'abcd'], ['abc', 'zabc'], ['abc', 'abxc'], ['abc', ''], ['abc', 'ac'], ['abc', 'xbc']]) {
    const source = wrap('<p>' + before + '</p>');
    assert.equal(G.patchText(source, G.analyze(source).texts[0], after), wrap('<p>' + after + '</p>'));
  }
  const source = wrap('<p>A&NotEqualTilde;B</p>');
  for (const after of ['A≂X̸B', 'A≂B', 'A̸B']) {
    const updated = G.patchText(source, G.analyze(source).texts[0], after, decode);
    assert.equal(updated, wrap('<p>' + after + '</p>'));
  }
});
test('blocks damaged document wrappers, extension metadata and unmatched blocks', () => {
  const source = '<!DOCTYPE html><html data-scribe-recorder-ready="true"><head><style>p{color:red}</style><!-- /wp:html --></head><body><p contenteditable="true">Hi</p><grammarly-desktop-integration></grammarly-desktop-integration></body></html>';
  const codes = new Set(G.analyze(source).errors.map(e => e.code));
  for (const code of ['DOCUMENT_DOCTYPE', 'DOCUMENT_WRAPPER', 'EDITOR_ATTRIBUTE', 'WP_UNMATCHED_CLOSE', 'CONTENTEDITABLE', 'EXTENSION_MARKUP']) assert.ok(codes.has(code), code);
});
test('detects nested mismatches, unclosed blocks and invalid attributes', () => {
  for (const source of ['<!-- wp:group --><!-- /wp:html -->', '<!-- wp:html -->', '<!-- wp:html {bad} --><!-- /wp:html -->', '<!-- wp:html [] --><!-- /wp:html -->', '<!-- wp:html --> <!-- broken']) assert.ok(G.analyze(source).errors.length);
});
test('ignores block-like strings in scripts, CSS and attributes', () => {
  const source = wrap('<style>p:after{content:"<!-- wp:fake -->"}</style><script>const s="<!-- /wp:html -->";</script><p title="<!-- wp:fake -->">Real text</p>');
  const model = G.analyze(source);
  assert.equal(model.errors.length, 0);
  assert.equal(model.blocks.length, 1);
  assert.equal(model.texts.length, 1);
  assert.ok(model.warnings.some(w => w.code === 'SCRIPT_PREVIEW'));
});
test('native, plugin and protected HTML text stays read-only', () => {
  const source = '<!-- wp:paragraph --><p>Native</p><!-- /wp:paragraph --><!-- wp:plugin/card --><div>Plugin</div><!-- /wp:plugin/card -->' + wrap('<style>p{color:red}</style><textarea>Input</textarea><svg><text>SVG</text></svg><button>Button</button><p>Editable</p>');
  assert.deepEqual(G.analyze(source).texts.map(t => t.raw), ['Editable']);
});
test('reports missing anchors and label targets, rejects duplicate IDs', () => {
  const source = wrap('<a href="#missing">Link</a><label for="absent">Label</label><p id="same">A</p><p id="same">B</p>');
  const model = G.analyze(source);
  assert.ok(model.errors.some(e => e.code === 'DUPLICATE_ID'));
  assert.deepEqual(model.warnings.map(w => w.code), ['BROKEN_ANCHOR', 'BROKEN_LABEL']);
});
test('rejects stale source ranges and edits to invalid imports', () => {
  const source = wrap('<p>Hello</p>');
  const token = G.analyze(source).texts[0];
  assert.throws(() => G.patchText(source.replace('Hello', 'Other'), token, 'Change'));
  assert.throws(() => G.patchText('<html>' + source + '</html>', token, 'Change'));
});
test('preview annotations are disposable and the source remains untouched', () => {
  const source = wrap('<p>Hello</p>');
  const preview = G.markedPreview(source, G.analyze(source), 'unique');
  assert.ok(preview.includes('<!--unique:0-->Hello<!--/unique-->'));
  assert.equal(source, wrap('<p>Hello</p>'));
});
