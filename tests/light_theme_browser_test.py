"""Synthetic demo only. Light surfaces/contrast, image fidelity, responsive layout."""
import os,re,math
from playwright.sync_api import sync_playwright

def contrast(a,b):
 def lum(rgb):
  v=[float(x)/255 for x in re.findall(r'[\d.]+',rgb)[:3]]
  v=[x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in v]
  return sum(x*k for x,k in zip(v,[.2126,.7152,.0722]))
 x,y=lum(a),lum(b);return (max(x,y)+.05)/(min(x,y)+.05)
with sync_playwright() as p:
 b=p.chromium.launch(args=['--no-sandbox']);pg=b.new_page(viewport={'width':390,'height':900});errors=[];pg.on('pageerror',lambda e:errors.append(str(e)))
 pg.goto(os.getenv('BASE','http://127.0.0.1:8899/standalone.html'));pg.wait_for_function("!!document.getElementById('credentials-clear')?.onclick");pg.wait_for_function('!!navigator.serviceWorker.controller');pg.wait_for_timeout(1500)
 pg.click('#demo');pg.wait_for_selector('#worklist tbody tr button',timeout=30000);pg.wait_for_timeout(400)
 def crc():return pg.locator('#frame').evaluate("c=>{let d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let h=0;for(let i=0;i<d.length;i++)h=(h*31+d[i])>>>0;return h}")
 before=crc();darkbg=pg.locator('body').evaluate('e=>getComputedStyle(e).backgroundColor')
 pg.click('#settings-btn');pg.locator('#set-ui').evaluate('e=>e.open=true');pg.select_option('#theme-sel','light');pg.click('#settings-close');pg.wait_for_timeout(150)
 assert crc()==before,'Theme must not recolor DICOM image pixels'
 assert pg.locator('body').evaluate('e=>getComputedStyle(e).backgroundColor')=='rgb(234, 246, 248)'
 pg.click('#vs-fold');pg.wait_for_timeout(150)
 assert pg.locator('#viewer-settings').evaluate('e=>getComputedStyle(e).backgroundColor')=='rgb(242, 250, 251)'
 # Test text on known solid surfaces, including formerly dark sticky cells.
 samples=[('body','body'),('#viewer-settings','#viewer-settings'),('#worklist td:first-child','#worklist tbody tr:first-child'),('#worklist td:last-child','#worklist td:last-child'),('#worklist th:last-child','#worklist th:last-child'),('#ingest-status','main > section:first-child')]
 for fg,bg in samples:
  colors=pg.evaluate("([fg,bg])=>[getComputedStyle(document.querySelector(fg)).color,getComputedStyle(document.querySelector(bg)).backgroundColor]",[fg,bg]);ratio=contrast(*colors);assert ratio>=4.5,(fg,colors,ratio)
 assert pg.locator('#viewport').evaluate('e=>getComputedStyle(e).backgroundColor')=='rgb(0, 0, 0)'
 for id in ['overlay','reference-overlay']:
  assert pg.locator('#'+id).evaluate('e=>getComputedStyle(e).backgroundColor')=='rgba(0, 0, 0, 0)'
 for width in [360,390,720,1280]:
  pg.set_viewport_size({'width':width,'height':1000});pg.wait_for_timeout(100)
  assert pg.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
  assert pg.locator('#viewer-settings').evaluate('(e)=>e.getBoundingClientRect().width<=innerWidth')
 pg.set_viewport_size({'width':390,'height':900});pg.click('#settings-btn');pg.locator('#set-about').evaluate('e=>e.open=true')
 colors=pg.evaluate("()=>[getComputedStyle(document.querySelector('#about-conn')).color,getComputedStyle(document.querySelector('#settings-modal > div')).backgroundColor]");assert contrast(*colors)>=4.5,colors
 assert pg.locator('#settings-modal').evaluate('(e)=>e.scrollWidth<=innerWidth')
 pg.click('#pacs-test');assert pg.locator('#ingest-status').get_attribute('data-status')=='warning'
 colors=pg.evaluate("()=>[getComputedStyle(document.querySelector('#ingest-status')).color,getComputedStyle(document.querySelector('main > section')).backgroundColor]");assert contrast(*colors)>=4.5,colors
 pg.screenshot(path=os.getenv('SHOT','/home/user/light136-settings.png'),full_page=False)
 pg.select_option('#theme-sel','dark');pg.click('#settings-close');assert pg.locator('body').evaluate('e=>getComputedStyle(e).backgroundColor')==darkbg
 pg.click('#settings-btn');pg.select_option('#theme-sel','light');pg.click('#settings-close');pg.click('#vs-fold')
 pg.reload();pg.wait_for_function("!!document.getElementById('credentials-clear')?.onclick");pg.wait_for_selector('#worklist tbody tr button');pg.locator('#worklist tbody tr button').first.click();pg.wait_for_timeout(250)
 assert pg.evaluate("document.documentElement.getAttribute('data-theme')")=='light'
 pg.click('#fs-toggle');pg.wait_for_timeout(200);assert pg.locator('#viewer-settings').is_hidden();assert pg.locator('#series-overview').is_hidden();pg.click('#fs-exit')
 pg.click('#lang-toggle');pg.wait_for_function("document.documentElement.lang==='en'");assert pg.evaluate('document.documentElement.scrollWidth<=innerWidth')
 assert not errors,errors
 print('PASS medical cyan surfaces, sampled text contrast >=4.5, sticky cells, 360/390/720/1280 containment, canvas checksum unchanged, black image stage/transparent overlays, dark restore, light persistence, clean fullscreen, EN; errors []')
 b.close()
