"""Browser regression checks for inline Gutenberg editing, menus and switching.
Requires the local server described in GUTENBERG.md.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p, TemporaryDirectory() as temp:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    context = browser.new_context(permissions=['clipboard-read', 'clipboard-write'], viewport={'width': 1440, 'height': 1000})
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('dialog', lambda d: d.accept())
    page.goto('http://127.0.0.1:8000/gutenberg.html')
    source = '<!-- wp:html -->\r\n<h1>Editable &#169; title</h1><p>Alpha <strong>Bold</strong> &copy; tail</p>\r\n<!-- /wp:html -->\r\n'
    fixture = Path(temp) / 'inline.html'
    fixture.write_bytes(source.encode())
    page.locator('#file').set_input_files(str(fixture))
    frame = page.frame_locator('#preview')
    frame.locator('h1').wait_for()

    def exported(button='export'):
        with page.expect_download() as event:
            page.locator('#' + button).click()
        return Path(event.value.path()).read_bytes()

    # A real double click, typing and apply must preserve all unrelated bytes.
    frame.locator('h1').dblclick()
    edit = frame.locator('[data-gb-inline]')
    expect(edit).to_be_focused()
    edit.fill('Editable © heading <safe>')
    expect(page.locator('#text')).to_have_value('Editable © heading <safe>')
    edit.press('Control+Enter')
    expected = source.replace('title', 'heading &lt;safe&gt;').encode()
    assert exported() == expected
    assert exported('backup') == source.encode()
    assert b'contenteditable' not in expected
    print('PASS: double-click editing applies bounded source patches, escapes markup and preserves entities/CRLF')

    frame.locator('h1').dblclick()
    frame.locator('[data-gb-inline]').fill('Do not keep')
    frame.locator('[data-gb-inline]').press('Escape')
    assert exported() == expected
    # Every passage is available from the selector, including nested inline text.
    page.locator('#passage').select_option('2')
    expect(page.locator('#text')).to_have_value('Bold')
    page.locator('#text').fill('Stronger')
    page.locator('#apply').click()
    expected = expected.replace(b'>Bold<', b'>Stronger<')
    assert exported() == expected
    print('PASS: Escape cancellation and passage selector edit nested text without losing inline markup')

    frame.locator('h1').click(button='right')
    menu = page.get_by_role('menu')
    expect(menu).to_be_visible()
    page.get_by_role('menuitem', name='Edit text on canvas', exact=True).click()
    frame.locator('[data-gb-inline]').fill('Menu edited heading')
    frame.locator('[data-gb-inline]').click(button='right')
    page.get_by_role('menuitem', name='Apply text change', exact=True).click()
    expect(frame.locator('h1')).to_have_text('Menu edited heading')
    assert b'data-gb-' not in exported()
    frame.locator('h1').click(button='right')
    page.keyboard.press('Escape')
    expect(menu).to_be_hidden()
    page.locator('#filename').click(button='right')
    page.get_by_role('menuitem', name='Select all text', exact=True).click()
    page.locator('#filename').click(button='right')
    page.get_by_role('menuitem', name='Copy text', exact=True).click()
    page.wait_for_function("navigator.clipboard.readText().then(text => text === 'inline.html')")
    page.locator('#filename').click(button='right')
    page.get_by_role('menuitem', name='Cut text', exact=True).click()
    expect(page.locator('#filename')).to_have_value('')
    page.locator('#filename').click(button='right')
    page.get_by_role('menuitem', name='Paste text', exact=True).click()
    expect(page.locator('#filename')).to_have_value('inline.html')
    page.locator('#source').click()
    page.locator('#sourceView').focus()
    page.locator('#sourceView').press('Shift+F10')
    expect(menu).to_be_visible()
    expect(page.get_by_role('menuitem', name='Paste text', exact=True)).to_be_disabled()
    page.keyboard.press('ArrowDown')
    page.keyboard.press('Escape')
    expect(menu).to_be_hidden()
    page.locator('#visual').click()
    print('PASS: Gutenberg preview context actions, input clipboard menu, dismissal and no leaked editor markup')

    # Switching applies pending edits, saves the separate draft and navigates.
    frame.locator('h1').dblclick()
    frame.locator('[data-gb-inline]').fill('Saved Gutenberg heading')
    page.locator('#switchEditor').click()
    page.wait_for_url('**/index.html')
    frame = page.frame_locator('#preview')
    frame.locator('h1').wait_for()
    frame.locator('h1').click(button='right')
    page.get_by_role('menuitem', name='Duplicate element', exact=True).click()
    expect(frame.locator('h1')).to_have_count(2)
    frame.locator('h1').last.click(button='right')
    page.get_by_role('menuitem', name='Delete element', exact=True).click()
    expect(frame.locator('h1')).to_have_count(1)
    frame.locator('h1').click(button='right')
    page.get_by_role('menuitem', name='Undo', exact=True).click()
    expect(frame.locator('h1')).to_have_count(2)
    frame.locator('h1').last.click(button='right')
    page.get_by_role('menuitem', name='Edit element text', exact=True).click()
    frame.locator('[data-vs-editing]').fill('Saved HTML heading')
    # Right-clicking the outline must target that row, not the previous selection.
    page.locator('.tree-row').filter(has_text='main').first.click(button='right')
    expect(page.get_by_role('menu')).to_contain_text('HTML actions · main')
    page.keyboard.press('Escape')
    page.locator('#switchEditor').click()
    page.wait_for_url('**/gutenberg.html')
    frame = page.frame_locator('#preview')
    expect(frame.locator('h1')).to_have_text('Saved Gutenberg heading')
    gb = exported()
    assert gb.startswith(b'<!-- wp:html -->\r\n')
    assert b'Saved HTML heading' not in gb
    page.locator('#switchEditor').click()
    page.wait_for_url('**/index.html')
    expect(page.frame_locator('#preview').get_by_text('Saved HTML heading', exact=True)).to_have_count(1)
    print('PASS: HTML context edit/duplicate/delete/undo, outline targeting, and switching preserves separate editor drafts')

    # A failed browser save must leave the current editor and its document open.
    page.evaluate("() => { Storage.prototype.setItem = () => { throw new Error('quota'); }; }")
    page.locator('#switchEditor').click()
    assert page.url.endswith('/index.html')
    expect(page.locator('#toast')).to_contain_text('Browser save failed')
    page.goto('http://127.0.0.1:8000/gutenberg.html')
    page.frame_locator('#preview').locator('h1').wait_for()
    page.evaluate("() => { Storage.prototype.setItem = () => { throw new Error('quota'); }; }")
    page.locator('#switchEditor').click()
    assert page.url.endswith('/gutenberg.html')
    expect(page.locator('#status')).to_contain_text('Browser save failed')
    for width in (390, 320):
        page.set_viewport_size({'width': width, 'height': 900})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.locator('#filename').click(button='right')
        rect = menu.bounding_box()
        assert rect['x'] >= 0 and rect['x'] + rect['width'] <= width
        assert rect['y'] >= 0 and rect['y'] + rect['height'] <= 900
        page.keyboard.press('Escape')
    page.goto('http://127.0.0.1:8000/index.html')
    page.frame_locator('#preview').locator('h1').first.wait_for()
    for width in (390, 320):
        page.set_viewport_size({'width': width, 'height': 900})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        expect(page.locator('#switchEditor')).to_be_visible()
    page.set_viewport_size({'width': 320, 'height': 500})
    page.frame_locator('#preview').locator('h1').first.click(button='right')
    menu.evaluate('(el) => { el.scrollTop = el.scrollHeight; }')
    expect(menu).to_be_visible()
    expect(page.get_by_role('menuitem', name='Switch to Gutenberg editor', exact=True)).to_be_in_viewport()
    assert not errors, errors
    print('PASS: switch aborts on failed storage; context menus fit narrow screens; no JavaScript errors')
    browser.close()
