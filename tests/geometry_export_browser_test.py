"""Single-pane geometry export and inline fallback, synthetic CT only."""
import os,json
from pathlib import Path
from playwright.sync_api import sync_playwright
BASE=os.getenv('BASE','http://127.0.0.1:8899/standalone.html')
with sync_playwright() as p:
 b=p.chromium.launch(args=['--no-sandbox']);pg=b.new_page(viewport={'width':390,'height':1000});errors=[];pg.on('pageerror',lambda e:errors.append(str(e)))
 pg.goto(BASE);pg.wait_for_function("!!document.getElementById('geometry-export')?.onclick");pg.wait_for_function('!!navigator.serviceWorker.controller');pg.wait_for_timeout(1200)
 pg.evaluate("""async()=>{const db=await new Promise(r=>{const q=indexedDB.open('rrai',2);q.onsuccess=()=>r(q.result)}),tx=db.transaction('studies','readwrite'),st=tx.objectStore('studies');st.clear();st.put({uid:'synthetic-ct-secret-uid',patient:'SYNTHETIC_PRIVATE_NAME',modality:'CT',created:1,meta:{patientName:'SYNTHETIC_PRIVATE_NAME'},triage:{score:0,priority:'routine',reasons:[]},frames:Array.from({length:4},(_,z)=>({kind:'gray',w:4,h:4,data:Int16Array.from({length:16},(_,i)=>i*100),seriesUid:'SYNTHETIC_SECRET_SERIES',volumeUnit:'HU',info:{frames:1},spacing:[1,1],geometry:{ipp:[0,0,z],iop:[1,0,0,0,1,0]}}))});await new Promise(r=>tx.oncomplete=r);db.close();}""")
 pg.reload();pg.wait_for_selector('#worklist tbody tr button');pg.locator('#worklist tbody tr button').first.click();pg.click('#vs-fold')
 pg.locator('#geometry-diagnostic').evaluate('e=>e.open=true')
 with pg.expect_download() as got:pg.click('#geometry-export')
 data=Path(got.value.path()).read_text();r=json.loads(data)
 assert r['volume']['missingReference']==4 and r['volume']['detail']=='missing-frame-reference'
 assert r['volume']['missingOrInvalidPositions']==0 and r['volume']['invalidOrientations']==0
 assert 'SYNTHETIC_PRIVATE_NAME' not in data and 'SECRET_SERIES' not in data and 'secret-uid' not in data
 assert pg.locator('#geometry-diagnostic-output').is_visible();assert pg.locator('#geometry-diagnostic-output').inner_text()==data
 assert not pg.locator('#dual-secondary').is_visible(),'single-pane export must not require split mode'
 # A blocked file mechanism still leaves the full report under the button.
 pg.evaluate("()=>{window.oldURL=URL.createObjectURL;URL.createObjectURL=()=>{throw new Error('synthetic blocked download')}}")
 pg.click('#geometry-export');assert 'missing-frame-reference' in pg.locator('#geometry-diagnostic-output').inner_text()
 pg.evaluate('()=>{URL.createObjectURL=window.oldURL}')
 # 3D refusal has its own safe reason details, without a misleading black volume.
 pg.click('#vr-open');pg.wait_for_selector('#vr-diagnostic',state='visible');v=json.loads(pg.locator('#vr-diagnostic').inner_text());assert v['detail']=='missing-frame-reference';assert not pg.locator('#vr-canvas').is_visible();pg.click('#vr-close')
 assert not errors,errors
 print('PASS single-pane geometry download, inline fallback on blocked file delivery, detailed CT geometry counts, private-data exclusion, inline 3D refusal with hidden blank canvas; errors []')
 b.close()
