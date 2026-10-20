"""Synthetic worklist. Native closed-default tools, preference and active-filter notice."""
import os
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(args=['--no-sandbox']);pg=b.new_page(viewport={'width':390,'height':1000});errors=[];pg.on('pageerror',lambda e:errors.append(str(e)))
 pg.goto(os.getenv('BASE','http://127.0.0.1:8899/standalone.html'));pg.wait_for_function("!!document.getElementById('wl-clear')?.onclick");pg.wait_for_function('!!navigator.serviceWorker.controller');pg.wait_for_timeout(1500)
 fold=pg.locator('#wl-options');summary=pg.locator('#wl-options-summary')
 assert not fold.evaluate('e=>e.open');assert not pg.locator('#wl-query').is_visible();assert pg.locator('#wl-count').is_visible();assert not pg.locator('#wl-help').is_visible()
 pg.click('#demo');pg.wait_for_selector('#worklist tbody tr button',timeout=30000);assert not fold.evaluate('e=>e.open')
 rows=pg.locator('#worklist tbody tr').count();assert rows>0
 for width in [360,390,720,1280]:
  pg.set_viewport_size({'width':width,'height':1000});assert fold.bounding_box()['height']<65;assert pg.evaluate('document.documentElement.scrollWidth<=innerWidth')
 summary.click();assert pg.locator('#wl-query').is_visible();pg.wait_for_function("localStorage.getItem('rrai-worklist-options-open')==='1'")
 pg.reload();pg.wait_for_function("!!document.getElementById('wl-clear')?.onclick");assert fold.evaluate('e=>e.open')
 pg.fill('#wl-query','NO-SUCH-SYNTHETIC-STUDY');pg.wait_for_function("document.querySelectorAll('#worklist tbody tr').length===0")
 summary.click();assert not pg.locator('#wl-query').is_visible();assert pg.locator('#wl-active-filter').is_visible();assert '0' in pg.locator('#wl-count').inner_text()
 pg.click('#lang-toggle');pg.wait_for_function("document.documentElement.lang==='en'");assert summary.inner_text().startswith('Search, filter and sort');pg.wait_for_function("document.getElementById('wl-active-filter').textContent.includes('Filters active')");assert 'Filters active' in summary.inner_text();assert not fold.evaluate('e=>e.open')
 summary.click();pg.click('#wl-clear');pg.wait_for_function('(n)=>document.querySelectorAll("#worklist tbody tr").length===n',arg=rows);assert not pg.locator('#wl-active-filter').is_visible()
 summary.click();pg.wait_for_function("localStorage.getItem('rrai-worklist-options-open')==='0'")
 pg.reload();pg.wait_for_function("!!document.getElementById('wl-clear')?.onclick");pg.wait_for_selector('#worklist tbody tr button');assert not fold.evaluate('e=>e.open');assert pg.locator('#worklist tbody tr').count()==rows
 # Native summary is keyboard-operable, no custom event emulation required.
 summary.focus();pg.keyboard.press('Enter');assert fold.evaluate('e=>e.open')
 assert not errors,errors
 print('PASS worklist tools closed by default, compact at 360/390/720/1280, remembered open/closed state, hidden help, visible counts/filter notice, AR/EN, clear preserves studies, keyboard summary; errors []')
 b.close()
