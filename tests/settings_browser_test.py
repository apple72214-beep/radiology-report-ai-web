"""Synthetic/fake values only: mobile settings, language/theme, privacy, offline text."""
import os
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(args=['--no-sandbox']);context=b.new_context(viewport={'width':360,'height':800});pg=context.new_page();errors=[];pg.on('pageerror',lambda e:errors.append(str(e)))
 pg.goto(os.getenv('BASE','http://127.0.0.1:8899/standalone.html'));pg.wait_for_function("!!document.getElementById('credentials-clear')?.onclick");pg.wait_for_function('!!navigator.serviceWorker.controller');pg.wait_for_timeout(1500)
 pg.click('#settings-btn');pg.fill('#pacs-relay-token','SYNTHETIC-ONLY');pg.check('#pacs-token-remember');pg.fill('#pacs-token','SYNTHETIC-PACS')
 ids=['pacs-relay-token','pacs-ae','pacs-port','pacs-token']
 for width in [360,720,1280]:
  pg.set_viewport_size({'width':width,'height':900})
  for id in ids:
   css=pg.locator('#'+id).evaluate("e=>({bg:getComputedStyle(e).backgroundColor,fg:getComputedStyle(e).color,r:e.getBoundingClientRect().toJSON()})")
   assert css['bg']!='rgb(255, 255, 255)',(id,css)
   assert css['r']['left']>=0 and css['r']['right']<=width,(width,id,css)
  assert pg.evaluate("document.getElementById('settings-modal').scrollWidth<=innerWidth")
 assert 'Remember' not in pg.locator('#text-pacs-remember').inner_text();assert 'Institution' not in pg.locator('#lbl-pacs-relay-token').inner_text()
 pg.locator('#set-about').evaluate('e=>e.open=true');assert 'لا تغادر' not in pg.locator('#about-conn').inner_text();assert 'PACS' in pg.locator('#about-privacy').inner_text()
 pg.click('#settings-close');pg.click('#lang-toggle');pg.wait_for_function("document.documentElement.lang==='en'");pg.click('#settings-btn')
 assert pg.locator('#text-pacs-remember').inner_text()=='Remember direct PACS token on this device'
 assert pg.locator('#pacs-token-remember').is_checked();assert pg.locator('#pacs-relay-token').input_value()=='SYNTHETIC-ONLY';assert pg.locator('#pacs-token').input_value()=='SYNTHETIC-PACS'
 assert 'De-identification is not automatic' in pg.locator('#about-privacy').inner_text();assert 'never leaves' not in pg.locator('#about-conn').inner_text();assert pg.locator('#about-standalone-link').inner_text()=='Open single-file edition'
 context.set_offline(True);pg.wait_for_function("document.getElementById('about-conn').textContent.includes('Browser reports offline')")
 assert 'need a connection' in pg.locator('#about-conn').inner_text();context.set_offline(False)
 pg.wait_for_function("document.getElementById('about-conn').textContent.includes('Browser reports online')")
 pg.locator('#set-ui').evaluate('e=>e.open=true');pg.select_option('#theme-sel','light')
 assert pg.evaluate("getComputedStyle(document.querySelector('#settings-modal > div')).backgroundColor")=='rgb(248, 252, 253)'
 css=pg.locator('#pacs-relay-token').evaluate("e=>({bg:getComputedStyle(e).backgroundColor,fg:getComputedStyle(e).color})");assert css['bg']!=css['fg']
 pg.click('#settings-close');pg.click('#lang-toggle');pg.click('#settings-btn');assert 'حفظ' in pg.locator('#text-pacs-remember').inner_text();assert pg.locator('#pacs-token-remember').is_checked()
 pg.click('#credentials-clear');assert pg.locator('#pacs-token').input_value()=='';assert pg.locator('#pacs-relay-token').input_value()==''
 pg.click('#settings-close');pg.locator('#composer-set').evaluate('e=>e.open=true');pg.fill('#ai-key','SYNTHETIC-AI');pg.check('#ai-key-remember')
 assert 'Remember' not in pg.locator('#text-ai-remember').inner_text()
 pg.click('#lang-toggle');assert pg.locator('#text-ai-remember').inner_text()=='Remember AI key on this device';assert pg.locator('#ai-key-remember').is_checked();assert pg.locator('#ai-key').input_value()=='SYNTHETIC-AI'
 assert pg.locator('#ai-service-token').evaluate("e=>getComputedStyle(e).backgroundColor")!='rgb(255, 255, 255)'
 pg.click('#ai-key-clear');assert not pg.locator('#ai-key').input_value()
 assert not errors,errors
 print('PASS settings widths 360/720/1280, dark fields/light contrast, AR/EN localization, retained controls/values, accurate privacy and online/offline changes; errors []')
 b.close()
