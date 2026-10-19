"""Actual service-worker/app 133 -> current -> 133 -> current, same origin/DB.
Prepare BASELINE_DIR with v133 standalone.html, sw.v133.js, start.html, release.json.
Synthetic data only. Runs a private, ephemeral HTTP server for this test's lifetime.
"""
import os,json,threading,urllib.request
from pathlib import Path
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from playwright.sync_api import sync_playwright
web=Path(__file__).resolve().parents[1];baseline=Path(os.environ['BASELINE_DIR']);phase=['133']
build=json.loads((web/'release.json').read_text())['build'].lstrip('v')
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  path=self.path.split('?')[0].lstrip('/')
  if path.startswith('__phase/'):
   phase[0]=path.split('/')[-1];self.send_response(200);self.end_headers();self.wfile.write(b'OK');return
  if path=='sw.js':data=('importScripts("./sw.v'+phase[0]+'.js");').encode();typ='text/javascript'
  else:
   file=web/path
   if path=='sw.v133.js' or (phase[0]=='133' and path in ['standalone.html','start.html','release.json']):file=baseline/path
   if not file.is_file():self.send_response(404);self.end_headers();return
   data=file.read_bytes();typ='text/html' if path.endswith('.html') else 'text/javascript' if path.endswith('.js') else 'application/json' if path.endswith('.json') else 'application/octet-stream'
  self.send_response(200);self.send_header('Content-Type',typ);self.send_header('Cache-Control','no-store');self.send_header('Service-Worker-Allowed','/');self.end_headers();self.wfile.write(data)
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start();base='http://127.0.0.1:'+str(server.server_port)
fingerprint="""async()=>{const db=await new Promise(r=>{let q=indexedDB.open('rrai',2);q.onsuccess=()=>r(q.result)});const rows=await new Promise(r=>{let q=db.transaction('studies').objectStore('studies').getAll();q.onsuccess=()=>r(q.result)});const content=rows.map(s=>({uid:s.uid,meta:s.meta,frames:s.frames.map(f=>({w:f.w,h:f.h,data:Array.from(f.data)})),report:s.report,measurementFrames:s.measurementFrames}));const b=new TextEncoder().encode(JSON.stringify(content));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(v=>v.toString(16).padStart(2,'0')).join('');}"""
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(args=['--no-sandbox']);pg=browser.new_page();errors=[];pg.on('pageerror',lambda e:errors.append(str(e)))
  pg.goto(base+'/standalone.html');pg.wait_for_selector('#demo');pg.wait_for_function("!!navigator.serviceWorker.controller");pg.wait_for_timeout(1500)
  pg.click('#demo');pg.wait_for_selector('#worklist tbody tr button',timeout=30000);pg.wait_for_timeout(500)
  # Store known synthetic report and scoped measures, not patient material.
  pg.evaluate("""async()=>{const db=await new Promise(r=>{let q=indexedDB.open('rrai',2);q.onsuccess=()=>r(q.result)});const tx=db.transaction('studies','readwrite'),store=tx.objectStore('studies');let rows=await new Promise(r=>{let q=store.getAll();q.onsuccess=()=>r(q.result)});for(let s of rows){s.report={notes:'SYNTHETIC UPDATE TEST',technique:'WITHOUT AND WITH CONTRAST',findings:['Test'],impression:['Review']};s.measurementFrames={'1:0':{segments:[{a:[1,2],b:[3,4],px:2.828}],angles:[],rois:[],rects:[]}};store.put(s);}await new Promise(r=>tx.oncomplete=r);db.close();}""")
  original=pg.evaluate(fingerprint)
  for version in [build,'133',build]:
   urllib.request.urlopen(base+'/__phase/'+version).read()
   pg.goto(base+'/standalone.html');pg.wait_for_selector('#demo');pg.evaluate('async()=>{let r=await navigator.serviceWorker.getRegistration();if(r)await r.update();}')
   pg.wait_for_timeout(2200);pg.wait_for_selector('#worklist tbody tr button')
   actual=pg.locator('#about-ver').text_content().split()[-1]
   assert actual=='v'+version,(actual,version)
   assert pg.evaluate(fingerprint)==original,'Study pixels/report/measurements changed during '+version
   print('PASS actual app/SW switch to v'+version+': study pixel/report/measurement hash unchanged')
  assert not errors,errors;browser.close()
finally:server.shutdown();server.server_close()
