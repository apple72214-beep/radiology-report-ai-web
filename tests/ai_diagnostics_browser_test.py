"""Only intercepted synthetic requests; never a real provider/key/patient."""
import os,json
from playwright.sync_api import sync_playwright
BASE=os.getenv('BASE','http://127.0.0.1:8899/standalone.html')
with sync_playwright() as p:
 b=p.chromium.launch(args=['--no-sandbox']);pg=b.new_page(viewport={'width':390,'height':1000});errors=[];downloads=[]
 pg.on('pageerror',lambda e:errors.append(str(e)));pg.on('download',lambda d:downloads.append(d))
 pg.goto(BASE);pg.wait_for_function("!!document.getElementById('ai-test')?.onclick");pg.wait_for_function('!!navigator.serviceWorker.controller');pg.wait_for_timeout(1500)
 pg.click('#demo');pg.wait_for_selector('#worklist tbody tr button');pg.locator('#worklist tbody tr button').first.click();pg.locator('#composer-set').evaluate('e=>e.open=true')
 pg.fill('#ai-key','AIzaSYNTHETIC_SECRET_NEVER_SHARE');pg.select_option('#ai-provider','gemini');pg.fill('#rep-notes','SYNTHETIC_PATIENT_NOTE_NEVER_SEND');pg.fill('#rep-findings','Physician unchanged findings')
 calls=[];mode='ok'
 def route(r):
  calls.append(r.request.post_data_json)
  if mode=='network':r.abort('failed');return
  status=503 if mode=='busy' else 403 if mode=='auth' else 200
  body={'candidates':[{'content':{'parts':[{'text':json.dumps({'findings':['CONNECTION_OK'],'impression':['CONNECTION_OK']})}]}}]} if status==200 else {'error':{'message':'SYNTHETIC_SECRET_NEVER_ECHO'}}
  r.fulfill(status=status,content_type='application/json',body=json.dumps(body))
 pg.route('https://generativelanguage.googleapis.com/**',route)
 pg.once('dialog',lambda d:d.dismiss());pg.click('#ai-test');pg.wait_for_timeout(100);assert not calls
 pg.on('dialog',lambda d:d.accept())
 for m,n,code,http in [('ok',1,'ok',200),('busy',2,'unavailable',503),('auth',1,'auth',403),('network',2,'network',0)]:
  mode=m;calls.clear();pg.click('#ai-test');pg.wait_for_function("!document.getElementById('ai-test').disabled",timeout=15000)
  assert len(calls)==n,(m,len(calls))
  assert all(set(c)=={'contents','generationConfig'} for c in calls)
  for c in calls:
   parts=c['contents'][0]['parts'];assert len(parts)==1 and set(parts[0])=={'text'}
   text=json.dumps(c);assert 'SYNTHETIC_PATIENT_NOTE' not in text and 'Physician unchanged' not in text
  trace=pg.locator('#ai-trace').text_content();records=[json.loads(x) for x in trace.splitlines()[1:]]
  assert records[-1]['result']==code and records[-1]['http']==http,(m,records)
  assert all(set(r)=={'attempt','model','http','phase','result','bytes','vision','ms'} for r in records)
  assert 'AIza' not in trace and 'SYNTHETIC_SECRET' not in trace and 'SYNTHETIC_PATIENT' not in trace
  assert pg.locator('#rep-findings').input_value()=='Physician unchanged findings'
  assert pg.locator('#rep-notes').input_value()=='SYNTHETIC_PATIENT_NOTE_NEVER_SEND'
  assert not pg.locator('#ai-cancel').is_visible()
 assert not errors and not downloads,(errors,downloads)
 print('PASS patient-free consented probe, no images/study/archive/note transfer, no composer changes, one request per model, safe success/503/403/network diagnostics, no secrets, no downloads, no page errors')
 b.close()
