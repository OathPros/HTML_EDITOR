"""Run against the local server. Optional incident fixtures stay outside Git.

python3 tests/gutenberg-browser.py --valid /path/to/repaired.txt --damaged /path/to/damaged.html
"""
import argparse
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:8000/gutenberg.html')
parser.add_argument('--valid', type=Path)
parser.add_argument('--damaged', type=Path)
args = parser.parse_args()

with sync_playwright() as playwright, TemporaryDirectory() as temp:
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page = browser.new_page(accept_downloads=True, viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('dialog', lambda dialog: dialog.accept())
    page.goto(args.url)
    frame = page.frame_locator('#preview')
    frame.locator('h1').wait_for()

    def export(button='export'):
        with page.expect_download() as download:
            page.locator('#' + button).click()
        return Path(download.value.path()).read_bytes()

    def open_file(path):
        page.locator('#file').set_input_files(str(path))
        expect(page.locator('#filename')).to_have_value(path.name)

    source = ('\ufeff<!-- wp:block {"ref":4751} /-->\r\n'
              '<!-- wp:paragraph --><p id="native">Native block</p><!-- /wp:paragraph -->\r\n'
              '<!-- wp:vendor/widget {"setting":true} /-->\r\n'
              '<!-- wp:html -->\r\n<style>.card{padding:20px}strong{color:#635bff}</style>\r\n'
              '<section class="card"><h1>Keep &#169; &nbsp; this title</h1>'
              '<p>Hello <strong>York &amp; friends</strong>.</p>'
              '<script>window.parent.__leaked = true;</script></section>\r\n<!-- /wp:html -->\r\n')
    fixture = Path(temp) / 'roundtrip.html'
    fixture.write_bytes(source.encode('utf-8'))
    open_file(fixture)
    frame.locator('h1').wait_for()
    assert export() == fixture.read_bytes()
    assert not page.evaluate('Boolean(window.__leaked)')
    print('PASS: no-edit export preserves UTF-8 BOM, CRLF, entities, scripts, native/plugin blocks and shared refs byte for byte')

    frame.locator('h1').click()
    expect(page.locator('#text')).to_have_value('Keep © \u00a0 this title')
    page.locator('#text').fill('Keep © \u00a0 this heading')
    expect(page.locator('#export')).to_be_disabled()
    page.locator('#apply').click()
    frame.locator('h1').filter(has_text='heading').wait_for()
    edited = source.replace('this title', 'this heading').encode('utf-8')
    assert export() == edited
    # Add extension/editor artifacts to the disposable preview. Export must ignore them.
    page.locator('#preview').evaluate("frame => {frame.contentDocument.body.setAttribute('data-gr-ext-installed',''); frame.contentDocument.body.appendChild(frame.contentDocument.createElement('grammarly-desktop-integration'));}")
    assert export() == edited
    frame.locator('#native').click()
    expect(page.locator('#text')).to_be_disabled()
    assert export('backup') == fixture.read_bytes()
    page.locator('#changes').click()
    expect(page.locator('#after')).to_contain_text('heading')
    page.locator('#visual').click()
    page.locator('#undo').click()
    assert export() == fixture.read_bytes()
    page.locator('#redo').click()
    assert export() == edited
    page.locator('#save').click()
    page.reload()
    frame.locator('h1').filter(has_text='heading').wait_for()
    assert export() == edited
    assert export('backup') == fixture.read_bytes()
    page.locator('#restore').click()
    assert export() == fixture.read_bytes()
    print('PASS: bounded edit, pending-edit gate, contamination isolation, read-only native block, diff, undo/redo, draft restore and original recovery')

    preview = export('previewExport').decode('utf-8')
    assert preview.startswith('<!doctype html>') and '<meta http-equiv="Content-Security-Policy"' in preview
    assert 'data-gb-editor-selected' not in preview and '<!--gb-' not in preview
    assert export() == fixture.read_bytes()
    print('PASS: standalone preview export uses a separate path without editor annotations')

    for width in (1440, 1024, 390, 320):
        page.set_viewport_size({'width': width, 'height': 900})
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), width
        page.locator('#size').select_option(str(width) + 'px')
        assert page.locator('#preview').evaluate('(el) => el.getBoundingClientRect().width') == width
    page.set_viewport_size({'width': 1440, 'height': 1000})
    page.locator('#size').select_option('100%')
    print('PASS: editor layout and preview width controls at 1440, 1024, 390 and 320px')

    page.locator('#paste').click()
    page.locator('#pasteText').fill('<!-- wp:html --><p>Pasted page</p><!-- /wp:html -->')
    page.locator('#importPaste').click()
    frame.get_by_text('Pasted page', exact=True).wait_for()
    assert export().decode() == '<!-- wp:html --><p>Pasted page</p><!-- /wp:html -->'
    frame.get_by_text('Pasted page', exact=True).click()
    page.locator('#text').fill('Saved by keyboard')
    page.locator('#apply').click()
    page.keyboard.press('Control+s')
    page.reload()
    frame.get_by_text('Saved by keyboard', exact=True).wait_for()
    print('PASS: paste import and keyboard browser-save shortcut')

    if args.valid:
        open_file(args.valid)
        frame.locator('h1').wait_for()
        expect(page.locator('.issue.error')).to_have_count(0)
        expect(page.locator('#validation')).to_contain_text('#kb-changes')
        assert export() == args.valid.read_bytes()
        title = frame.locator('h1').inner_text()
        frame.locator('h1').click()
        expect(page.locator('#text')).to_be_enabled()
        before_text = page.locator('#text').input_value()
        page.locator('#text').fill(before_text.replace('Knowledge', 'Shared knowledge', 1))
        page.locator('#apply').click()
        candidate = export()
        original_bytes = args.valid.read_bytes()
        assert candidate == original_bytes.replace(before_text.encode(), before_text.replace('Knowledge', 'Shared knowledge', 1).encode(), 1)
        page.locator('#restore').click()
        assert export() == original_bytes
        print('PASS: supplied repaired page round-trips byte for byte; one visual text edit changes only its intended source range')

    if args.damaged:
        open_file(args.damaged)
        expect(page.locator('#export')).to_be_disabled()
        for code in ['WP_UNMATCHED_CLOSE', 'DOCUMENT_DOCTYPE', 'EXTENSION_MARKUP', 'CONTENTEDITABLE']:
            expect(page.locator('#validation')).to_contain_text(code)
        assert export('backup') == args.damaged.read_bytes()
        print('PASS: supplied incident export is blocked with actionable findings; original remains downloadable unchanged')

    assert not errors, errors
    print('PASS: no browser JavaScript errors')
    browser.close()
