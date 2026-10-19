"""Synthetic-only browser checks. BASE points at a local or deployed build. No real secrets."""
import os,json
from playwright.sync_api import sync_playwright
BASE=os.getenv('BASE','http://127.0.0.1:8899/standalone.html')
with sync_playwright() as p:
 b=p.chromium.launch(args=['--no-sandbox']);pg=b.new_page(viewport={'width':720,'height':1100});errors=[];pg.on('pageerror',lambda e:errors.append(str(e)))
 pg.goto(BASE);pg.wait_for_selector('#ai-key-remember',state='attached');pg.wait_for_function("!!document.getElementById('credentials-clear')?.onclick");pg.wait_for_function('!!navigator.serviceWorker.controller');pg.wait_for_timeout(3500)
 pg.evaluate("localStorage.setItem('rrai-ai-key','synthetic-legacy-key');localStorage.setItem('rrai-pacs-token','synthetic-old-pacs')")
 pg.reload();pg.wait_for_selector('#ai-key-remember',state='attached');pg.wait_for_function("!!document.getElementById('credentials-clear')?.onclick");pg.wait_for_timeout(1200)
 assert pg.evaluate("localStorage.getItem('rrai-ai-key')===null&&localStorage.getItem('rrai-pacs-token')===null")
 pg.click('#demo');pg.wait_for_selector('#worklist tbody tr button',timeout=30000)
 pg.evaluate("document.getElementById('composer-set').open=true")
 pg.fill('#ai-key','synthetic-not-a-real-secret');assert pg.evaluate("localStorage.getItem('rrai-ai-key')===null")
 pg.check('#ai-key-remember');assert pg.evaluate("localStorage.getItem('rrai-ai-key')==='synthetic-not-a-real-secret'")
 pg.reload();pg.wait_for_function("!!document.getElementById('credentials-clear')?.onclick");pg.wait_for_selector('#worklist tbody tr button');pg.locator('#worklist tbody tr button').first.click();pg.wait_for_timeout(400)
 assert pg.locator('#ai-key').input_value()=='synthetic-not-a-real-secret';assert pg.locator('#ai-key-remember').is_checked()
 pg.evaluate("document.getElementById('composer-set').open=true");pg.uncheck('#ai-key-remember');assert pg.evaluate("localStorage.getItem('rrai-ai-key')===null")
 pg.reload();pg.wait_for_function("!!document.getElementById('credentials-clear')?.onclick");pg.wait_for_selector('#worklist tbody tr button');pg.locator('#worklist tbody tr button').first.click();pg.wait_for_timeout(400)
 assert not pg.locator('#ai-key').input_value()
 pg.evaluate("document.getElementById('composer-set').open=true")
 pg.fill('#ai-key','synthetic-delete-me');pg.check('#ai-key-remember');pg.click('#ai-key-clear');assert not pg.locator('#ai-key').input_value();assert pg.evaluate("localStorage.getItem('rrai-ai-key')===null")
 # Server mode needs its own token, not a provider API key; context must be an object.
 pg.select_option('#ai-provider','server');pg.fill('#ai-service-token','synthetic-service-token');pg.fill('#rep-notes','SYNTHETIC TEST NOTES')
 requests=[]
 def ai_route(route):
  req=route.request;requests.append((req.headers,req.post_data_json));route.fulfill(status=200,content_type='application/json',body=json.dumps({'findings':['Synthetic only'],'impression':['Review required'],'exam':'Test','indication':'Test'}))
 pg.route('**/api/report_ai',ai_route);pg.on('dialog',lambda d:d.accept());pg.click('#ai-gen');pg.wait_for_timeout(500)
 assert len(requests)==1;headers,body=requests[0];assert headers['authorization']=='Bearer synthetic-service-token';assert isinstance(body['context'],dict);assert body['notes']=='SYNTHETIC TEST NOTES';assert 'images' not in body;assert set(body['context'])=={'modality','studyDesc','bodyPart','slices'}
 assert not pg.evaluate("JSON.stringify(localStorage).includes('synthetic-service-token')")
 pg.click('#settings-btn');pg.fill('#pacs-token','synthetic-upstream-token');pg.fill('#pacs-relay-token','synthetic-relay-token');pg.check('#pacs-token-remember')
 assert pg.evaluate("localStorage.getItem('rrai-pacs-token')==='synthetic-upstream-token'")
 pg.fill('#pacs-url-s','https://pacs.example/dicom-web')
 relay=[]
 def relay_route(route):relay.append(route.request.headers);route.fulfill(status=200,content_type='application/json',body='[]')
 pg.route('**/api/dicomweb?*',relay_route);pg.click('#pacs-test');pg.wait_for_timeout(300)
 assert len(relay)==1;assert relay[0]['authorization']=='Bearer synthetic-relay-token';assert 'synthetic-upstream-token' not in str(relay)
 before=pg.evaluate("""async()=>{let db=await new Promise(r=>{let q=indexedDB.open('rrai',2);q.onsuccess=()=>r(q.result)});return await new Promise(r=>{let q=db.transaction('studies').objectStore('studies').getAll();q.onsuccess=()=>r(q.result.map(s=>({uid:s.uid,n:s.frames.length})));});}""")
 pg.click('#credentials-clear');assert pg.locator('#pacs-token').input_value()=='';assert pg.locator('#pacs-relay-token').input_value()==''
 assert pg.evaluate("localStorage.getItem('rrai-ai-key')===null&&localStorage.getItem('rrai-pacs-token')===null")
 pg.click('#settings-close');assert pg.locator('#ai-service-token').input_value()==''
 after=pg.evaluate("""async()=>{let db=await new Promise(r=>{let q=indexedDB.open('rrai',2);q.onsuccess=()=>r(q.result)});return await new Promise(r=>{let q=db.transaction('studies').objectStore('studies').getAll();q.onsuccess=()=>r(q.result.map(s=>({uid:s.uid,n:s.frames.length})));});}""")
 assert before==after and before
 # A blocked storage API must not produce a false 'saved credentials cleared' claim.
 pg.click('#settings-btn');pg.evaluate("()=>{window.originalRemove=Storage.prototype.removeItem;Storage.prototype.removeItem=function(){throw new Error('synthetic storage denial')};return true;}")
 pg.click('#credentials-clear');assert 'تعذر' in pg.locator('#ingest-status').inner_text()
 pg.evaluate("()=>{Storage.prototype.removeItem=window.originalRemove;return true;}");pg.click('#settings-close')
 assert not errors,errors
 print('PASS: legacy key migration, session default, explicit persistence/reload/opt-out, clear keys keeps studies, separate service auth, object context, no credential forwarding; page errors []')
 b.close()
