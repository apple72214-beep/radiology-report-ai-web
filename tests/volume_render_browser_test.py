"""Synthetic CT phantom, no PHI / provider / PACS requests. BASE can be live."""
import os
from playwright.sync_api import sync_playwright
BASE=os.getenv('BASE','http://127.0.0.1:8899/standalone.html')
with sync_playwright() as p:
 b=p.chromium.launch(args=['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--enable-webgl']);pg=b.new_page(viewport={'width':390,'height':1000});errors=[];downloads=[];pg.on('pageerror',lambda e:errors.append(str(e)));pg.on('download',lambda d:downloads.append(d))
 pg.goto(BASE);pg.wait_for_function("!!document.getElementById('vr-open')?.onclick");pg.wait_for_function('!!navigator.serviceWorker.controller');pg.wait_for_function("!location.pathname.endsWith('standalone.html') || sessionStorage.getItem('rrai-sw-reload')==='1'");pg.wait_for_load_state('load');pg.wait_for_timeout(1200)
 pg.evaluate("""async()=>{const db=await new Promise(r=>{const q=indexedDB.open('rrai',2);q.onsuccess=()=>r(q.result)});const frames=[];for(let z=0;z<32;z++){const data=new Int16Array(64*64);for(let y=0;y<64;y++)for(let x=0;x<64;x++){const r=Math.hypot(x-30,y-32,(z-15.5)*1.4);data[y*64+x]=r>21?-1000:r>16?1200:20;}frames.push({kind:'gray',w:64,h:64,data,spacing:[.8,.8],seriesUid:'phantom-series',seq:{seriesNumber:1,seriesDescription:'Synthetic CT phantom'},volumeUnit:'HU',hu:true,info:{frames:1,bitsAllocated:16,slope:1,intercept:0},geometry:{frameOfReferenceUid:'phantom-for',ipp:[0,0,z],iop:[1,0,0,0,1,0],sliceThickness:1}});}const tx=db.transaction('studies','readwrite');tx.objectStore('studies').clear();tx.objectStore('studies').put({uid:'ct-phantom',patient:'SYNTHETIC ONLY',modality:'CT',created:1,frames,meta:{studyDesc:'Synthetic CT phantom'},triage:{score:0,priority:'routine',reasons:[]}});await new Promise(r=>tx.oncomplete=r);db.close();}""")
 pg.reload();pg.wait_for_selector('#worklist tbody tr button');pg.locator('#worklist tbody tr button').first.click();pg.wait_for_function("!document.getElementById('vr-open').hidden")
 pg.click('#vs-fold');assert pg.locator('#vr-open').is_visible();assert not pg.locator('#vr-dialog').is_visible()
 checksum=pg.locator('#frame').evaluate("c=>c.toDataURL()")
 sent=[];pg.on('request',lambda req:sent.append(req.url))
 pg.click('#vr-open');pg.wait_for_function("document.getElementById('vr-dialog').open&&!document.getElementById('vr-controls').hidden")
 pg.wait_for_timeout(200)
 def pixels():return pg.locator('#vr-canvas').evaluate("c=>{let g=c.getContext('webgl2'),p=new Uint8Array(c.width*c.height*4);g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,p);let sum=0,n=0;for(let i=0;i<p.length;i+=4){sum+=p[i]+p[i+1]+p[i+2];if(p[i]+p[i+1]+p[i+2]>30)n++;}return {sum,n,e:g.getError()};}")
 first=pixels();assert first['n']>1000 and first['e']==0,first
 box=pg.locator('#vr-canvas').bounding_box();pg.mouse.move(box['x']+box['width']*.4,box['y']+box['height']*.5);pg.mouse.down();pg.mouse.move(box['x']+box['width']*.65,box['y']+box['height']*.6,steps=4);pg.mouse.up();pg.wait_for_timeout(150);assert pixels()['sum']!=first['sum']
 pg.locator('#vr-threshold').evaluate("e=>{e.value='1800';e.dispatchEvent(new Event('input'))}");pg.wait_for_timeout(150);assert pixels()['n']==0
 pg.click('#vr-reset');pg.wait_for_timeout(150);assert pixels()['n']>1000
 pg.locator('#vr-cut').evaluate("e=>{e.value='90';e.dispatchEvent(new Event('input'))}");pg.wait_for_timeout(150);assert pixels()['sum']<first['sum']
 pg.locator('#vr-threshold').evaluate("e=>{e.value='400';e.dispatchEvent(new Event('input'))}")
 pg.locator('#vr-opacity').evaluate("e=>{e.value='1.7';e.dispatchEvent(new Event('input'))}")
 pg.select_option('#vr-quality','high');pg.wait_for_function("!document.getElementById('vr-controls').hidden&&/عالية|high/.test(document.getElementById('vr-info').textContent)");pg.wait_for_timeout(200)
 assert pg.locator('#vr-threshold').input_value()=='400' and pg.locator('#vr-opacity').input_value()=='1.7'
 assert pixels()['n']>1000 and pixels()['e']==0,'High R16F texture must really render'
 pg.select_option('#vr-quality','balanced');pg.wait_for_function("!document.getElementById('vr-controls').hidden&&/متوازنة|balanced/.test(document.getElementById('vr-info').textContent)");assert pg.locator('#vr-threshold').input_value()=='400'
 pg.click('#vr-reset');pg.wait_for_timeout(150);pg.screenshot(path='/home/user/ct-volume-v147-synthetic.png')
 for width in [360,720,1280]:
  pg.set_viewport_size({'width':width,'height':1000});assert pg.locator('#vr-dialog').evaluate('e=>e.getBoundingClientRect().width<=innerWidth')
 pg.click('#vr-close');assert not pg.locator('#vr-dialog').is_visible();assert pg.locator('#vr-canvas').evaluate('c=>c.width')==8
 assert pg.locator('#frame').evaluate('c=>c.toDataURL()')==checksum
 for _ in range(2):
  pg.click('#vr-open');pg.wait_for_function("!document.getElementById('vr-controls').hidden");pg.keyboard.press('Escape');pg.wait_for_timeout(50);assert not pg.locator('#vr-dialog').is_visible()
 # Unavailable GPU must fail locally without touching the 2D viewer.
 pg.evaluate("()=>{window.originalGetContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(this.id==='vr-canvas'&&type==='webgl2')return null;return window.originalGetContext.call(this,type,...args);};}")
 pg.click('#vr-open');pg.wait_for_function("document.getElementById('vr-status').textContent.includes('WebGL')");assert not pg.locator('#vr-controls').is_visible();pg.click('#vr-close')
 pg.evaluate("()=>{HTMLCanvasElement.prototype.getContext=window.originalGetContext;}")
 # Close while the deferred local build is pending: no late renderer appears.
 pg.locator('#vr-open').evaluate("e=>{e.click();document.getElementById('vr-close').click();}");pg.wait_for_timeout(100);assert not pg.locator('#vr-dialog').is_visible();assert pg.locator('#vr-canvas').evaluate('c=>c.width')==8
 assert not sent,sent
 # MRI must not expose the CT entry point; no automatic rendering on reload.
 pg.evaluate("""async()=>{const db=await new Promise(r=>{const q=indexedDB.open('rrai',2);q.onsuccess=()=>r(q.result)});const tx=db.transaction('studies','readwrite'),st=tx.objectStore('studies');const s=await new Promise(r=>{let q=st.get('ct-phantom');q.onsuccess=()=>r(q.result)});s.modality='MR';st.put(s);await new Promise(r=>tx.oncomplete=r);db.close();}""")
 pg.reload();pg.wait_for_selector('#worklist tbody tr button');pg.locator('#worklist tbody tr button').first.click();assert not pg.locator('#vr-open').is_visible();assert not pg.locator('#vr-dialog').is_visible()
 assert not errors and not downloads,(errors,downloads)
 print('PASS CT-only optional volume, real WebGL pixels, rotation, HU transfer, clipping/reset, repeat open/close GPU cleanup, mobile/desktop containment, unchanged 2D, no extra requests/downloads, MR hidden; errors []')
 b.close()
