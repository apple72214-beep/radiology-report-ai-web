"""Synthetic transport faults only. No real key, PHI, or provider calls."""
import os,json
from playwright.sync_api import sync_playwright
BASE=os.getenv('BASE','http://127.0.0.1:8899/standalone.html')
with sync_playwright() as p:
 b=p.chromium.launch(args=['--no-sandbox']);pg=b.new_page(viewport={'width':390,'height':900});errors=[];downloads=[]
 pg.on('pageerror',lambda e:errors.append(str(e)));pg.on('download',lambda d:downloads.append(d))
 pg.goto(BASE);pg.wait_for_function("!!document.getElementById('ai-cancel')?.onclick");pg.wait_for_function('!!navigator.serviceWorker.controller');pg.wait_for_timeout(1500)
 pg.click('#demo');pg.wait_for_selector('#worklist tbody tr button');pg.locator('#worklist tbody tr button').first.click();pg.locator('#composer-set').evaluate('e=>e.open=true')
 pg.fill('#ai-key','AIzaSYNTHETIC_NOT_REAL');pg.select_option('#ai-provider','gemini');pg.on('dialog',lambda d:d.accept())
 calls=[];mode='recover';held=[]
 obj={'exam':'Synthetic recovery exam','technique':'Synthetic technique','findings':['Recovered synthetic finding'],'impression':['Recovered synthetic impression']}
 def route(r):
  calls.append((r.request.url,r.request.post_data_json))
  if mode=='hold':held.append(r);return
  if mode=='network':r.abort('failed');return
  status=503 if mode=='busy' or (mode=='recover' and len(calls)<=2) else 403 if mode=='auth' else 429 if mode=='quota' else 200
  body={'error':{'message':'quota PerDay exhausted'}} if mode=='quota' else {'error':{'message':'high demand'}} if status!=200 else {'candidates':[{'content':{'parts':[{'text':json.dumps(obj)}]}}]}
  r.fulfill(status=status,content_type='application/json',body=json.dumps(body))
 pg.route('https://generativelanguage.googleapis.com/**',route)
 def start(m):
  global mode
  mode=m;calls.clear();pg.locator('#composer-set').evaluate('e=>e.open=true');pg.click('#ai-gen')
 def done():
  pg.wait_for_function("!document.getElementById('ai-gen').disabled",timeout=30000)
  assert not pg.locator('#ai-cancel').is_visible()
 start('recover');done();assert len(calls)==3;assert pg.locator('#rep-findings').input_value()=='Recovered synthetic finding'
 assert '/gemini-2.5-flash:' in calls[0][0] and '/gemini-flash-latest:' in calls[2][0]
 image_parts=[c[1]['contents'][0]['parts'][1:] for c in calls];assert image_parts[0] and all(a==image_parts[0] for a in image_parts)
 pg.fill('#rep-findings','Physician text must survive failures')
 for m,count,fragment in [('busy',4,'503'),('auth',1,'401/403'),('quota',1,'الحصة'),('network',4,'الاتصال')]:
  start(m);done();assert len(calls)==count,(m,len(calls));assert fragment in pg.locator('#ai-job-status').inner_text();assert pg.locator('#rep-findings').input_value()=='Physician text must survive failures'
 # Duplicate dispatch has no second request; explicit cancel unlocks the UI.
 start('hold');pg.wait_for_timeout(150);pg.locator('#ai-gen').evaluate('e=>e.dispatchEvent(new MouseEvent("click"))');pg.wait_for_timeout(100);assert len(calls)==1
 pg.click('#ai-cancel');done();assert 'أُلغي' in pg.locator('#ai-job-status').inner_text()
 for r in held:
  try:r.abort()
  except Exception:pass
 held.clear()
 # A late successful response cannot overwrite edits made after consent.
 start('hold');pg.wait_for_timeout(100);pg.fill('#rep-findings','New physician edit while waiting');r=held.pop();r.fulfill(status=200,content_type='application/json',body=json.dumps({'candidates':[{'content':{'parts':[{'text':json.dumps(obj)}]}}]}));done()
 assert pg.locator('#rep-findings').input_value()=='New physician edit while waiting';assert 'أُهمل' in pg.locator('#ai-job-status').inner_text()
 # Switching study aborts the old request before any response is inserted.
 start('hold');pg.wait_for_timeout(100);pg.locator('#worklist tbody tr button').nth(2).click();done()
 assert pg.locator('#rep-findings').input_value()!='Recovered synthetic finding'
 for r in held:
  try:r.abort()
  except Exception:pass
 assert not downloads and not errors,(downloads,errors)
 print('PASS live-capable synthetic 503 recovery/model fallback, same image bytes, retry ceiling, auth/quota stop, network classification, duplicate suppression, cancel, edit protection, study-switch protection; no downloads or page errors')
 b.close()
