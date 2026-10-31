"""Synthetic storage abort after request-success, quota failure, retry and real reload."""
import os,json
from pathlib import Path
from playwright.sync_api import sync_playwright
BASE=os.getenv('BASE','http://127.0.0.1:8903/standalone.html')
with sync_playwright() as p:
 b=p.chromium.launch(args=['--no-sandbox']);pg=b.new_page(viewport={'width':390,'height':1000},accept_downloads=True);errors=[];downloads=[]
 pg.on('pageerror',lambda e:errors.append(str(e)));pg.on('download',lambda d:downloads.append(d));pg.on('dialog',lambda d:d.accept())
 pg.goto(BASE);pg.wait_for_function("!!document.getElementById('sign-export-word-en')?.__reportExport");pg.wait_for_function('!!navigator.serviceWorker.controller');pg.wait_for_function("!location.pathname.endsWith('standalone.html') || sessionStorage.getItem('rrai-sw-reload')==='1'");pg.wait_for_load_state('load');pg.wait_for_timeout(1500)
 pg.click('#demo');pg.wait_for_selector('#worklist tbody tr button');pg.locator('#worklist tbody tr button').first.click();pg.locator('#composer-set').evaluate('e=>e.open=true')
 for id,value in {'rep-exam':'Synthetic exam','rep-technique':'Synthetic acquisition.','rep-findings':'Synthetic finding.','rep-impression':'Synthetic impression.','signer':'Synthetic Reviewer'}.items():pg.fill('#'+id,value)
 pg.check('#signoff')
 def stored():return pg.evaluate("""async()=>{const db=await new Promise(r=>{const q=indexedDB.open('rrai',2);q.onsuccess=()=>r(q.result)});const rows=await new Promise(r=>{const q=db.transaction('studies').objectStore('studies').getAll();q.onsuccess=()=>r(q.result)});db.close();return rows.find(s=>s.patient==='DEMO-0001');}""")
 baseline=stored();raw_before=[f['data'] for f in baseline['frames']]
 pg.evaluate("""()=>{window.storageFault='abort';window.abortObserved=false;const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...args){if(this.name==='studies'&&window.storageFault==='quota')throw new DOMException('Synthetic quota','QuotaExceededError');const q=put.call(this,value,...args);if(this.name==='studies'&&window.storageFault==='abort')q.addEventListener('success',()=>{window.abortObserved=true;this.transaction.abort();});return q;};}""")
 pg.click('#sign-export-word-en');pg.wait_for_function("window.abortObserved&&document.getElementById('study-save-text').textContent.includes('لم يُؤكَّد')")
 assert not downloads and not stored().get('signedBy') and not stored().get('report'),'aborted transaction cannot sign/archive/download'
 assert pg.locator('#study-save-notice').is_visible() and pg.locator('#rep-findings').input_value()=='Synthetic finding.'
 assert json.loads(pg.evaluate("localStorage.getItem('rrai-archive')||'[]'"))==[]
 pg.evaluate("window.storageFault='quota'");pg.click('#study-save-retry');pg.wait_for_timeout(150);assert pg.locator('#study-save-notice').is_visible() and not stored().get('report')
 pg.evaluate("window.storageFault=null");pg.click('#study-save-retry');pg.wait_for_function("document.getElementById('study-save-notice').hidden");saved=stored();assert saved['report']['findings']=='Synthetic finding.' and not saved.get('signedBy');assert [f['data'] for f in saved['frames']]==raw_before
 pg.reload();pg.wait_for_selector('#worklist tbody tr button');pg.locator('#worklist tbody tr button').first.click();pg.locator('#composer-set').evaluate('e=>e.open=true');assert pg.locator('#rep-findings').input_value()=='Synthetic finding.';assert pg.locator('#study-save-notice').is_hidden()
 pg.fill('#signer','Synthetic Reviewer');pg.check('#signoff')
 with pg.expect_download():pg.click('#sign-export-word-en')
 assert stored()['signedBy']=='Synthetic Reviewer';assert [f['data'] for f in stored()['frames']]==raw_before
 # Archive backup makes no promise to contain source study arrays.
 assert pg.locator('#archive-backup').text_content().find('فقط')>=0, pg.locator('#archive-backup').text_content()
 with pg.expect_download() as got:pg.locator('#archive-backup').evaluate('e=>e.click()')
 payload=json.loads(Path(got.value.path()).read_text());assert payload['app']=='rrai-archive-backup' and 'entries' in payload and 'frames' not in payload and 'studies' not in payload
 pg.click('#lang-toggle');assert 'Report archive only' in pg.locator('#archive-backup').text_content();assert 'NOT include study images' in pg.locator('#archive-backup-scope').text_content()
 for width in [360,720,1280]:pg.set_viewport_size({'width':width,'height':1000});assert pg.locator('#study-save-notice').evaluate('e=>e.scrollWidth<=innerWidth')
 assert len(downloads)==2 and not errors,(downloads,errors)
 print('PASS real request-success followed by transaction abort cannot claim saved/sign/archive/download; quota failure stays visible, edits/source retained, explicit retry commits unsigned edits, reload restores report/source, successful signing/Word, explicit report-only backup and AR/EN; errors []')
 # Block IndexedDB at boot: demo must not claim persistent success; explicit retry recovers.
 q=b.new_page(viewport={'width':360,'height':900});q.on('pageerror',lambda e:errors.append(str(e)))
 q.add_init_script("window.originalIDBOpen=IDBFactory.prototype.open;IDBFactory.prototype.open=function(name,...args){if(name==='rrai'&&!localStorage.getItem('synthetic-storage-recovered'))throw new DOMException('Synthetic blocked storage','SecurityError');return window.originalIDBOpen.call(this,name,...args)}")
 q.goto(BASE);q.wait_for_function("!!document.getElementById('sign-export-word-en')?.__reportExport");q.wait_for_function('!!navigator.serviceWorker.controller');q.wait_for_function("!location.pathname.endsWith('standalone.html') || sessionStorage.getItem('rrai-sw-reload')==='1'");q.wait_for_load_state('load');q.wait_for_timeout(1500)
 assert q.locator('#study-save-notice').is_visible();q.click('#demo');q.wait_for_timeout(150);assert 'جاهز' not in q.locator('#ingest-status').text_content()
 q.click('#lang-toggle');q.wait_for_function("document.getElementById('study-save-text').textContent.includes('NOT SAVED')");assert q.locator('#study-save-notice').is_visible()
 q.evaluate("()=>{IDBFactory.prototype.open=window.originalIDBOpen;localStorage.setItem('synthetic-storage-recovered','1')}");q.click('#study-save-retry');q.wait_for_function("document.getElementById('study-save-notice').hidden");q.wait_for_selector('#worklist tbody tr button')
 q.reload();q.wait_for_selector('#worklist tbody tr button');assert q.locator('#study-save-notice').is_hidden();assert not errors,errors
 print('PASS blocked IndexedDB boot stays explicitly session-only, no false import success, English warning, manual retry opens storage/commits, real reload retains recovered study; errors []')
 b.close()
