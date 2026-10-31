"""Synthetic report revisions: actual save, edit, undo, reapprove, stale commit and failure."""
import os,json
from playwright.sync_api import sync_playwright
BASE=os.getenv('BASE','http://127.0.0.1:8905/standalone.html')
with sync_playwright() as p:
 b=p.chromium.launch(args=['--no-sandbox']);pg=b.new_page(viewport={'width':390,'height':1000},accept_downloads=True);errors=[];downloads=[];sent=[]
 pg.on('pageerror',lambda e:errors.append(str(e)));pg.on('download',lambda d:downloads.append(d));pg.on('dialog',lambda d:d.accept())
 pg.goto(BASE);pg.wait_for_function("!!document.getElementById('sign-export-word-en')?.__reportExport");pg.wait_for_function('!!navigator.serviceWorker.controller');pg.wait_for_function("!location.pathname.endsWith('standalone.html') || sessionStorage.getItem('rrai-sw-reload')==='1'");pg.wait_for_load_state('load');pg.wait_for_timeout(1500)
 pg.evaluate("""async()=>{const db=await new Promise(r=>{const q=indexedDB.open('rrai',2);q.onsuccess=()=>r(q.result)});const t=db.transaction('studies','readwrite');for(let n=0;n<2;n++)t.objectStore('studies').put({uid:'synthetic-report-'+n,patient:n?'LEGACY SYNTHETIC':'CURRENT SYNTHETIC',modality:'CT',created:n?1:2,createdAt:Date.now(),frames:[{kind:'gray',w:8,h:6,data:Int16Array.from({length:48},(_,i)=>i*20-1000)}],report:{exam:'Synthetic exam',technique:'Synthetic technique',findings:n?'Legacy text to retain.':['Original first finding.','Repeated finding.','Repeated finding.'],impression:'Synthetic impression.',notes:'Retain physician notes'},...(n?{signedBy:'Legacy Reviewer',docHash:'legacy-hash',signedHistory:[{at:'2026-10-01',signer:'Legacy Reviewer',hash:'legacy-hash'}]}:{})});await new Promise(r=>t.oncomplete=r);db.close();}""")
 pg.reload();pg.wait_for_selector('#worklist tbody tr button')
 def row(name):return pg.locator('#worklist tbody tr').filter(has_text=name)
 def open_case(name):row(name).locator('button').first.click();pg.locator('#composer-set').evaluate('e=>e.open=true')
 def stored(uid='synthetic-report-0'):return pg.evaluate("""async id=>{const db=await new Promise(r=>{const q=indexedDB.open('rrai',2);q.onsuccess=()=>r(q.result)});const s=await new Promise(r=>{const q=db.transaction('studies').objectStore('studies').get(id);q.onsuccess=()=>r(q.result)});db.close();return s;}""",uid)
 def state(value):pg.wait_for_function("v=>document.getElementById('report-workflow-status').dataset.state===v",arg=value)
 def signed(text,expect_download=True):
  pg.fill('#rep-findings',text);pg.fill('#signer','Synthetic Reviewer');pg.check('#signoff')
  if expect_download:
   with pg.expect_download():pg.click('#sign-export-word-en')
  else:pg.click('#sign-export-word-en')
 assert row('LEGACY SYNTHETIC').locator('[data-report-state="legacy"]').count()==1
 open_case('CURRENT SYNTHETIC');state('draft');before=stored();original=pg.locator('#rep-findings').input_value();sent=[];pg.on('request',lambda r:sent.append(r.url) if r.method!='GET' else None)
 signed(original);state('signed');first=stored();assert first['reportApproval']['revision']==1 and first['signedHistory'][0]['report']['findings']==original;hash1=first['docHash'];first_history=json.loads(json.dumps(first['signedHistory'][0]));assert row('CURRENT SYNTHETIC').locator('[data-report-state="signed"]').count()==1
 pg.fill('#rep-findings','Changed second finding.');state('amended');assert not pg.locator('#signoff').is_checked() and pg.locator('#report-download-result').is_hidden();pg.wait_for_timeout(750);assert stored()['signedHistory'][0]==first_history
 assert row('CURRENT SYNTHETIC').locator('[data-report-state="amended"]').count()==1
 pg.locator('#wl-options').evaluate('e=>e.open=true');pg.select_option('#wl-state','signed');pg.wait_for_function("document.querySelectorAll('#worklist tbody tr').length===0");pg.click('#wl-clear')
 pg.fill('#rep-findings',original);state('amended');pg.wait_for_timeout(750);assert stored()['reportWorkflow']['state']=='amended','undo must still require reapproval'
 signed('Reviewed second revision.');state('signed');second=stored();assert second['reportApproval']['revision']==2 and second['reportApproval']['parentHash']==hash1 and second['signedHistory'][0]==first_history
 assert second['signedHistory'][1]['report']['findings']=='Reviewed second revision.' and len(downloads)==2
 # Approval write snapshots text before a synthetic edit in the request-success callback.
 pg.evaluate("""()=>{const put=IDBObjectStore.prototype.put;window.injectReportEdit=true;IDBObjectStore.prototype.put=function(v,...args){const q=put.call(this,v,...args);if(this.name==='studies'&&v.reportApproval?.revision===3&&window.injectReportEdit){window.injectReportEdit=false;q.addEventListener('success',()=>{const f=document.getElementById('rep-findings');f.value='Edit while approval commit was pending.';f.dispatchEvent(new Event('input',{bubbles:true}));});}return q;};}""")
 signed('Third version reviewed before the injected edit.',False);pg.wait_for_function("!document.getElementById('sign-export-word-en').disabled");state('amended');pg.wait_for_timeout(750);third=stored();assert len(downloads)==2 and third['reportApproval']['revision']==3
 assert third['reportApproval']['report']['findings']=='Third version reviewed before the injected edit.' and third['report']['findings']=='Edit while approval commit was pending.'
 assert third['signedHistory'][0]==first_history and len(third['signedHistory'])==3
 # Fast case switch before debounce must save edits to the old study, not the next one.
 pg.fill('#rep-findings','Keep this edit on study A only.');open_case('LEGACY SYNTHETIC');state('legacy');assert pg.locator('#rep-findings').input_value()=='Legacy text to retain.';pg.wait_for_timeout(750)
 assert stored()['report']['findings']=='Keep this edit on study A only.' and stored('synthetic-report-1')['report']['findings']=='Legacy text to retain.'
 assert stored('synthetic-report-1')['signedHistory']==[{'at':'2026-10-01','signer':'Legacy Reviewer','hash':'legacy-hash'}]
 open_case('CURRENT SYNTHETIC');state('amended')
 # A transaction failure must not append a fourth local approval or create an archive/download.
 pg.evaluate("""()=>{window.realPut=IDBObjectStore.prototype.put;window.failReportWrite=true;IDBObjectStore.prototype.put=function(v,...args){if(this.name==='studies'&&window.failReportWrite)throw new DOMException('Synthetic quota','QuotaExceededError');return window.realPut.call(this,v,...args)}}""")
 pg.fill('#signer','Synthetic Reviewer');pg.check('#signoff');pg.click('#sign-export-word-en');pg.wait_for_function("!document.getElementById('sign-export-word-en').disabled");pg.wait_for_timeout(100);assert pg.locator('#study-save-notice').is_visible();state('amended');assert len(downloads)==2 and len(stored()['signedHistory'])==3
 pg.evaluate('window.failReportWrite=false');pg.click('#study-save-retry');pg.wait_for_function("document.getElementById('study-save-notice').hidden");assert len(stored()['signedHistory'])==3
 pg.reload();pg.wait_for_selector('#worklist tbody tr button');open_case('CURRENT SYNTHETIC');state('amended');assert pg.locator('#rep-findings').input_value()=='Keep this edit on study A only.'
 assert [(f['w'],f['h'],f['data']) for f in stored()['frames']]==[(f['w'],f['h'],f['data']) for f in before['frames']];pg.locator('#report-workflow-history-panel').evaluate('e=>e.open=true');assert pg.locator('#report-workflow-history li').count()==3
 assert first_history['report']['findings'] in pg.locator('#report-workflow-history').text_content()
 pg.click('#lang-toggle');pg.wait_for_function("document.getElementById('report-workflow-status').textContent.includes('Modified after approval')")
 for width in [360,720,1280]:pg.set_viewport_size({'width':width,'height':1000});assert pg.locator('#report-export-panel').evaluate('e=>e.scrollWidth<=innerWidth')
 archive=json.loads(pg.evaluate("localStorage.getItem('rrai-archive')||'[]'"));assert len([a for a in archive if a.get('status')=='signed'])==2;assert archive[0]['revision']==2 and archive[0]['approvalOrg']
 assert len(downloads)==2 and not sent and not errors,(downloads,sent,errors)
 print('PASS local draft/legacy/current/amended/review states; preserved exact revision snapshots/parent hashes, undo requires approval, matching-approval filters/badges, edit during commit no stale download, fast study switch preserves separate edits, failed save no new approval/archive, retry/reload, read-only history, pixels unchanged, AR/EN/responsive, no requests/extra downloads; errors []')
 b.close()
