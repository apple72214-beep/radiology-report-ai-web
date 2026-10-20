"""Synthetic local records; never send patient data or real credentials."""
import os,csv,io
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(args=['--no-sandbox']);pg=b.new_page(viewport={'width':390,'height':1000});errors=[];pg.on('pageerror',lambda e:errors.append(str(e)))
 pg.goto(os.getenv('BASE','http://127.0.0.1:8899/standalone.html'));pg.wait_for_function("!!document.getElementById('wl-clear')?.onclick");pg.wait_for_function('!!navigator.serviceWorker.controller');pg.wait_for_timeout(1500);pg.click('#demo');pg.wait_for_selector('#worklist tbody tr button',timeout=30000)
 pg.evaluate("""async()=>{const db=await new Promise(r=>{let q=indexedDB.open('rrai',2);q.onsuccess=()=>r(q.result)});const tx=db.transaction('studies','readwrite'),store=tx.objectStore('studies');const rows=await new Promise(r=>{let q=store.getAll();q.onsuccess=()=>r(q.result)});rows.push({...structuredClone(rows[0]),uid:'synthetic-worklist-third'});rows.forEach((s,i)=>{s.patient=['ID-123','ID-456','ID-789'][i];s.meta={...s.meta,patientName:['أَحْمَد^علي','Beta Synthetic','Cedar Synthetic'][i],studyDate:['20261018','20261020',''][i],studyDesc:['MRI Lumbar spine','Chest test','Followup test'][i]};s.modality=i===1?'CT':'MR';s.created=i+1;s.triage={...s.triage,priority:i===0?'urgent':'routine',reasons:[]};s.consult=i===2?{}:null;s.signedBy=i===1?'Synthetic doctor':'';s.frames.forEach(f=>f.seq={...f.seq,seriesNumber:1,seriesDescription:i===0?'Sagittal T2 Synthetic':'Axial Synthetic'});delete s.series;store.put(s);});await new Promise(r=>tx.oncomplete=r);db.close();}""")
 pg.reload();pg.wait_for_function("!!document.getElementById('wl-clear')?.onclick");pg.wait_for_selector('#worklist tbody tr button')
 def count(n):
  pg.wait_for_timeout(220);pg.wait_for_function('(n)=>document.querySelectorAll("#worklist tbody tr").length===n',arg=n)
 def text():return pg.locator('#worklist tbody').inner_text()
 pg.locator('#wl-options').evaluate('e=>e.open=true')
 count(3);assert '3' in pg.locator('#wl-count').inner_text()
 pg.evaluate("()=>{window.wlReads=0;window.originalTransaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){if(String(args[0]).includes('studies')&&(args[1]||'readonly')==='readonly')window.wlReads++;return window.originalTransaction.apply(this,args)}}")
 pg.fill('#wl-query','احمد');count(1);assert 'أَحْمَد' in text()
 pg.locator('#worklist .wl-study-details > summary').click();pg.locator('#worklist .wl-series summary').click();assert 'Sagittal T2 Synthetic' in text()
 pg.fill('#wl-query','ID-١٢٣');count(1);assert pg.evaluate('window.wlReads')==0
 pg.evaluate("()=>{IDBDatabase.prototype.transaction=window.originalTransaction}")
 pg.fill('#wl-query','2026-10-20');count(1);assert 'Beta Synthetic' in text()
 pg.fill('#wl-query','٢٠٢٦/١٠/٢٠');count(1);assert 'Beta Synthetic' in text()
 pg.fill('#wl-query','SAGITTAL SEARCH SECRET');count(0);assert pg.locator('#empty').is_visible();assert not pg.evaluate("JSON.stringify(localStorage).includes('SAGITTAL SEARCH SECRET')")
 pg.click('#wl-clear');count(3);assert pg.locator('#wl-query').evaluate('e=>e===document.activeElement')
 pg.select_option('#wl-modality','MR');count(2);pg.select_option('#wl-state','signed');count(0);pg.click('#wl-clear');count(3)
 pg.select_option('#wl-priority','consult');count(1);assert 'Cedar' in text();pg.click('#wl-clear');count(3)
 pg.select_option('#wl-sort','study');pg.wait_for_function("document.querySelector('#worklist tbody tr').textContent.includes('Beta')")
 assert pg.evaluate("localStorage.getItem('rrai-sort')")=='study'
 pg.click('#settings-btn');assert pg.locator('#sort-sel').input_value()=='study';pg.locator('#set-wl').evaluate('e=>e.open=true') if pg.locator('#set-wl').count() else None
 pg.locator('#sort-sel').evaluate("e=>{e.value='date';e.dispatchEvent(new Event('change',{bubbles:true}))}");pg.click('#settings-close');pg.wait_for_function("document.getElementById('wl-sort').value==='date'")
 pg.click('#menu-btn');pg.click('#drawer-critical');count(2);assert pg.locator('#wl-critical-note').is_visible();pg.click('#wl-clear');count(3)
 for width in [360,390,720,1280]:
  pg.set_viewport_size({'width':width,'height':1000});pg.wait_for_timeout(100);assert pg.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
  display=pg.locator('#worklist tbody tr').first.evaluate('e=>getComputedStyle(e).display');assert display==('grid' if width<=600 else 'table-row'),(width,display)
 pg.set_viewport_size({'width':390,'height':1000});pg.click('#lang-toggle');pg.wait_for_function("document.documentElement.lang==='en'");count(3)
 assert pg.locator('#lbl-wl-query').inner_text()=='Search studies';assert pg.locator('#worklist td').nth(1).get_attribute('data-label')=='Modality'
 pg.once('dialog',lambda d:d.dismiss());pg.locator('#worklist tbody tr').first.locator('button').nth(1).click();count(3)
 pg.fill('#wl-query','احمد');count(1);pg.locator('#worklist tbody tr button').first.click();pg.wait_for_timeout(400);assert pg.locator('#viewport').is_visible(),errors
 pg.fill('#wl-query','Beta');count(1);pg.locator('#data-mgmt').evaluate('e=>e.open=true')
 with pg.expect_download() as dl:pg.click('#export-csv')
 path=dl.value.path();rows=list(csv.reader(io.StringIO(open(path,encoding='utf-8-sig').read())));assert len(rows)==4
 dialogs=[]
 def reject_all(d):dialogs.append(d.message);d.dismiss()
 pg.once('dialog',reject_all);pg.click('#clear-all');assert 'hidden by filters' in dialogs[0]
 count(1);pg.click('#wl-clear');count(3)
 pg.fill('#wl-query','Beta');count(1);pg.reload();pg.wait_for_function("!!document.getElementById('wl-clear')?.onclick");pg.wait_for_selector('#worklist tbody tr button');count(3);assert pg.locator('#wl-query').input_value()=='';assert pg.locator('#wl-sort').input_value()=='date'
 assert not errors,errors
 print('PASS Arabic/ID/date/series search, no-match counts, combined filters/clear, synchronized sort, legacy critical toggle, mobile cards/desktop table, AR/EN, safe cancel-delete, open correct study, session-only search/reload; errors []')
 b.close()
