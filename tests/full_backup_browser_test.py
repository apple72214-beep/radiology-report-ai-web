"""Synthetic full encrypted backup across isolated browser contexts; no real PHI."""
import os,json
from pathlib import Path
from playwright.sync_api import sync_playwright
BASE=os.getenv('BASE','http://127.0.0.1:8904/standalone.html');PASSWORD='Synthetic-backup-password-2026'
OUT=Path('/home/user/test-results');OUT.mkdir(exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(args=['--no-sandbox']);errors=[];downloads=[];sent=[]
 def page():
  q=b.new_page(viewport={'width':390,'height':1000},accept_downloads=True);q.on('pageerror',lambda e:errors.append(str(e)));q.on('dialog',lambda d:d.accept());q.on('download',lambda d:downloads.append(d));q.on('request',lambda r:sent.append(r.url) if r.method!='GET' else None)
  q.goto(BASE);q.wait_for_function("!!document.getElementById('full-backup-export')?.__backup");q.wait_for_function('!!navigator.serviceWorker.controller');q.wait_for_function("!location.pathname.endsWith('standalone.html') || sessionStorage.getItem('rrai-sw-reload')==='1'");q.wait_for_load_state('load');q.wait_for_timeout(1500)
  return q
 def panel(q):
  q.locator('#data-mgmt').evaluate('e=>e.open=true');q.locator('#full-backup-panel').evaluate('e=>e.open=true')
 def snapshot(q):return q.evaluate("""async()=>{const db=await new Promise(r=>{const x=indexedDB.open('rrai',2);x.onsuccess=()=>r(x.result)});const t=db.transaction(['studies','attach']),s=t.objectStore('studies').getAll(),a=t.objectStore('attach').getAll();await new Promise(r=>t.oncomplete=r);db.close();const tidy=x=>JSON.parse(JSON.stringify(x,(k,v)=>k==='_backupRestoredAt'?undefined:ArrayBuffer.isView(v)?{type:v.constructor.name,bytes:Array.from(new Uint8Array(v.buffer,v.byteOffset,v.byteLength))}:v));return tidy({studies:s.result,attachments:a.result.filter(x=>x.id!=='rrai-full-backup-recovery-v1'),archive:JSON.parse(localStorage.getItem('rrai-archive')||'[]')});}""")
 def check(q,path,password=PASSWORD):
  panel(q);q.set_input_files('#full-backup-file',str(path));q.fill('#full-backup-password',password);q.click('#full-backup-check');q.wait_for_function("!document.getElementById('full-backup-check').disabled")
 def restore(q):q.click('#full-backup-restore');q.wait_for_function("!document.getElementById('full-backup-check').disabled")
 source=page();source.evaluate("""async()=>{const db=await new Promise(r=>{const q=indexedDB.open('rrai',2);q.onsuccess=()=>r(q.result)});const t=db.transaction(['studies','attach'],'readwrite');for(let n=0;n<2;n++)t.objectStore('studies').put({uid:'SYNTHETIC-'+n,patient:'SYNTHETIC ONLY '+n,modality:'CT',created:1,createdAt:Date.now(),report:{exam:'Synthetic exam',technique:'Synthetic technique',findings:['Synthetic first finding.','Second finding.'],impression:'Synthetic impression.'},signedBy:'Synthetic Reviewer',signedHistory:[{hash:'synthetic-hash'}],measurementFrames:{'1:0':{line:[1,2,3]}},frames:Array.from({length:5},(_,z)=>({kind:'gray',w:8,h:6,data:n?Float32Array.from({length:48},(_,i)=>98.25+i+z):Int16Array.from({length:48},(_,i)=>-1000+i*50+z),seriesUid:'synthetic-series-'+n,volumeUnit:'HU',spacing:[.8,.5],geometry:{frameOfReferenceUid:'synthetic-reference',ipp:[0,0,z],iop:[1,0,0,0,1,0]}}))});t.objectStore('attach').put({id:'synthetic-attachment',thumbs:['data:image/png;base64,AA==']});await new Promise(r=>t.oncomplete=r);db.close();localStorage.setItem('rrai-archive',JSON.stringify([{id:'synthetic-report',ts:'2020-01-01',patient:'SYNTHETIC',studyUid:'SYNTHETIC-0',findings:['Archived synthetic finding.'],status:'signed'}]));localStorage.setItem('rrai-retention-days','0');localStorage.setItem('rrai-retention-signed-days','0');localStorage.setItem('rrai-ai-key','SYNTHETIC-SECRET-DO-NOT-BACKUP');}""")
 source.reload();source.wait_for_function("!!document.getElementById('full-backup-export')?.__backup");source.wait_for_selector('#worklist tbody tr button');source.wait_for_timeout(200)
 before=snapshot(source);panel(source);source.fill('#full-backup-password',PASSWORD);source.fill('#full-backup-password-confirm',PASSWORD)
 with source.expect_download() as got:source.click('#full-backup-export')
 backup=OUT/'synthetic-full-backup.rraibak';got.value.save_as(backup);envelope=json.loads(backup.read_text());assert envelope['schema']=='rrai-encrypted-backup-v1';assert 'SYNTHETIC' not in backup.read_text();assert snapshot(source)==before
 clean=page();assert snapshot(clean)=={'studies':[],'attachments':[],'archive':[]}
 check(clean,backup,'Wrong-password-at-least-twelve');assert clean.locator('#full-backup-restore').is_disabled();assert not snapshot(clean)['studies']
 broken=OUT/'synthetic-damaged-backup.rraibak';bad=dict(envelope);bad['data']=('A' if bad['data'][0]!='A' else 'B')+bad['data'][1:];broken.write_text(json.dumps(bad));check(clean,broken);assert clean.locator('#full-backup-restore').is_disabled();assert not snapshot(clean)['studies']
 check(clean,backup);assert clean.locator('#full-backup-restore').is_enabled();assert not snapshot(clean)['studies'],'verification alone must not restore'
 restore(clean);assert snapshot(clean)==before,'restored bytes/metadata differ';assert clean.evaluate("localStorage.getItem('rrai-ai-key')") is None
 clean.reload();clean.wait_for_function("!!document.getElementById('full-backup-export')?.__backup");clean.wait_for_timeout(1600);assert snapshot(clean)==before,'reload must not purge old restored report metadata'
 # Existing study, report and attachment are never overwritten on repeat restore.
 clean.evaluate("""async()=>{const db=await new Promise(r=>{const q=indexedDB.open('rrai',2);q.onsuccess=()=>r(q.result)});const t=db.transaction(['studies','attach'],'readwrite'),st=t.objectStore('studies'),q=st.get('SYNTHETIC-0');q.onsuccess=()=>{q.result.report.findings='Retain local physician edit';st.put(q.result)};t.objectStore('attach').put({id:'synthetic-attachment',thumbs:['retain-local']});await new Promise(r=>t.oncomplete=r);db.close();const a=JSON.parse(localStorage.getItem('rrai-archive'));a[0].findings='Retain local archive edit';localStorage.setItem('rrai-archive',JSON.stringify(a));}""")
 edited=snapshot(clean);check(clean,backup);restore(clean);assert snapshot(clean)==edited
 # A failure after earlier add requests must abort the whole database restore.
 failed=page();check(failed,backup);failed.evaluate("""()=>{const add=IDBObjectStore.prototype.add;window.backupAdds=0;IDBObjectStore.prototype.add=function(value,...args){if(++window.backupAdds===2)throw new DOMException('Synthetic quota','QuotaExceededError');return add.call(this,value,...args)};}""");restore(failed);assert snapshot(failed)=={'studies':[],'attachments':[],'archive':[]}
 # localStorage archive failure is not a false all-done: durable recovery journal survives.
 recover=page();check(recover,backup);recover.evaluate("""()=>{window.realStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='rrai-archive')throw new DOMException('Synthetic quota','QuotaExceededError');return window.realStorageSet.call(this,k,v)};}""");restore(recover);assert len(snapshot(recover)['studies'])==2 and snapshot(recover)['archive']==[];assert 'تنبيه' in recover.locator('#full-backup-status').text_content()
 recover.evaluate('()=>{Storage.prototype.setItem=window.realStorageSet}');recover.reload();recover.wait_for_function("!!document.getElementById('full-backup-export')?.__backup");recover.wait_for_timeout(1600);assert snapshot(recover)==before
 panel(recover);recover.click('#lang-toggle');assert 'Encrypted local study backup' in recover.locator('#full-backup-title').text_content()
 for width in [360,720,1280]:recover.set_viewport_size({'width':width,'height':1000});assert recover.locator('#full-backup-panel').evaluate('e=>e.scrollWidth<=innerWidth')
 assert len(downloads)==1 and not sent and not errors,(len(downloads),sent,errors)
 print('PASS encrypted local export and clean-profile verified restore; exact all pixel bytes/types/geometry/report/signature/measurements/attachments/archive; wrong password/tamper no writes, no restore on inspect, no overwrite on repeats, transaction quota atomic rollback, durable archive recovery/reload, original timestamps/retention grace, no secrets/network/automatic downloads, AR/EN/responsive; errors []')
 b.close()
