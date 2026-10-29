"""Synthetic only: independent CT display windows, no density changes or requests."""
import os
from playwright.sync_api import sync_playwright
BASE=os.getenv('BASE','http://127.0.0.1:8899/standalone.html')
with sync_playwright() as p:
 b=p.chromium.launch(args=['--no-sandbox']);pg=b.new_page(viewport={'width':390,'height':1000});errors=[];pg.on('pageerror',lambda e:errors.append(str(e)))
 pg.goto(BASE);pg.wait_for_function("!!document.getElementById('geometry-export')?.onclick");pg.wait_for_function('!!navigator.serviceWorker.controller');pg.wait_for_timeout(1200)
 pg.evaluate("""async()=>{const db=await new Promise(r=>{const q=indexedDB.open('rrai',2);q.onsuccess=()=>r(q.result)}),tx=db.transaction('studies','readwrite'),st=tx.objectStore('studies');st.clear();for(const uid of ['1.2.3.7','1.2.3.8'])st.put({uid,patient:'SYNTHETIC',modality:'CT',created:1,meta:{studyDate:'20261030'},triage:{score:0,priority:'routine',reasons:[]},frames:Array.from({length:8},(_,z)=>({kind:'gray',w:8,h:8,data:Int16Array.from({length:64},(_,i)=>i<8?-1000:i>=56?1000:98),seriesUid:z<4?'1.2.3.9':'1.2.3.10',seq:{seriesNumber:z<4?1:2},volumeUnit:'HU',info:{slope:1,intercept:0,frames:1,bitsAllocated:16},spacing:[1,1],geometry:{frameOfReferenceUid:'1.2.3.4',ipp:[0,0,z%4],iop:[1,0,0,0,1,0]}}))});await new Promise(r=>tx.oncomplete=r);db.close();}""")
 pg.reload();pg.wait_for_selector('#worklist tbody tr button');pg.locator('#worklist tbody tr button').first.click();pg.click('#vs-fold');pg.select_option('#preset','brain')
 def gray():return pg.locator('#frame').evaluate("c=>c.getContext('2d').getImageData(2,2,1,1).data[0]")
 def checksum(id):return pg.locator('#'+id).evaluate("c=>Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data).reduce((a,v,i)=>(a+v*(i%17+1))%1000000007,0)")
 assert gray()==255;pg.locator('#display-window').evaluate('e=>e.open=true')
 requests=[];pg.on('request',lambda r:requests.append(r.url) if r.method!='GET' else None)
 pg.click('#wl-example');assert gray()==125;assert 'WL 100 / WW 200' in pg.locator('#wl-status').inner_text()
 pg.locator('#wl-range').evaluate("e=>{e.value='120';e.dispatchEvent(new Event('input',{bubbles:true}))}");assert gray()<125
 pg.fill('#wl-number','100');pg.locator('#wl-number').dispatch_event('change');assert gray()==125
 for w in [360,390,720,1280]:
  pg.set_viewport_size({'width':w,'height':1000});assert pg.locator('#display-window').evaluate('e=>e.getBoundingClientRect().right<=innerWidth+1 && e.getBoundingClientRect().left>=-1')
 pg.locator('#series-bar button').nth(1).click();assert gray()==255,'no cross-series window leakage';pg.locator('#series-bar button').first.click();assert gray()==125,'series display choice retained';
 pg.click('#dual-toggle');primary=checksum('frame');pg.click('#select-pane-2');pg.select_option('#preset','brain');second=checksum('dual-frame');pg.click('#wl-example');pg.wait_for_timeout(100);assert checksum('dual-frame')!=second;assert checksum('frame')==primary
 pg.click('#wl-reset');pg.wait_for_timeout(100);assert checksum('dual-frame')==second and checksum('frame')==primary
 pg.click('#select-pane-1');assert pg.locator('#wl-number').input_value()=='100';pg.click('#wl-reset');assert gray()==255
 pg.click('#wl-example');pg.select_option('#preset','bone');assert 'WL 100' not in pg.locator('#wl-status').inner_text();pg.select_option('#preset','brain');assert gray()==255
 pg.click('#wl-example');pg.click('#lang-toggle');assert 'Brightness' in pg.locator('#display-window-summary').inner_text();assert gray()==125
 assert not requests,requests
 stored=pg.evaluate("""async()=>{const db=await new Promise(r=>{const q=indexedDB.open('rrai',2);q.onsuccess=()=>r(q.result)}),tx=db.transaction('studies');const s=await new Promise(r=>{const q=tx.objectStore('studies').get('1.2.3.7');q.onsuccess=()=>r(q.result)});db.close();return {value:s.frames[0].data[18],slope:s.frames[0].info.slope,intercept:s.frames[0].info.intercept,hu:s.frames[0].volumeUnit};}""")
 assert stored=={'value':98,'slope':1,'intercept':0,'hu':'HU'}
 pg.locator('#worklist tbody tr button').nth(1).click();pg.select_option('#preset','brain');assert gray()==255,'manual override must not leak to another case'
 pg.reload();pg.wait_for_selector('#worklist tbody tr button');pg.locator('#worklist tbody tr button').first.click();pg.select_option('#preset','brain');assert gray()==255,'manual override is not persisted'
 assert not errors,errors
 print('PASS real canvas 98 white→125 gray, sliders/numeric input, pane independence/reset, preset switching, AR/EN, 360–1280 containment, no non-GET requests, unchanged saved pixels/calibration, session-only; errors []')
 b.close()
