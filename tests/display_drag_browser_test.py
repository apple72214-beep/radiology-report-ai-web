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
 def check(id):return pg.locator('#'+id).evaluate("c=>Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data).reduce((a,v,i)=>(a+v*(i%17+1))%1000000007,0)")
 assert pg.locator('#wl-drag').count()==0,'no activation button'
 pg.click('#vs-fold');assert pg.locator('#wl-drag-hud-1').is_visible()
 requests=[];downloads=[];pg.on('request',lambda r:requests.append(r.url) if r.method!='GET' else None);pg.on('download',lambda d:downloads.append(d.suggested_filename))
 cdp=pg.context.new_cdp_session(pg)
 def drag(id,dx,dy,cancel=False):
  cv=pg.locator('#'+id);cv.scroll_into_view_if_needed();r=cv.bounding_box();x=r['x']+r['width']/2;y=r['y']+r['height']/2
  cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y,'id':1}]})
  for k in range(1,5):cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x+dx*k/4,'y':y+dy*k/4,'id':1}]})
  cdp.send('Input.dispatchTouchEvent',{'type':'touchCancel' if cancel else 'touchEnd','touchPoints':[]});pg.wait_for_timeout(120)
 def pinch(id):
  cv=pg.locator('#'+id);cv.scroll_into_view_if_needed();r=cv.bounding_box();x=r['x']+r['width']/2;y=r['y']+r['height']/2
  cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x-30,'y':y,'id':1},{'x':x+30,'y':y,'id':2}]})
  cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x-60,'y':y,'id':1},{'x':x+60,'y':y,'id':2}]})
  cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]});pg.wait_for_timeout(120)

 idx=pg.locator('#slice').input_value();assert gray()==255
 drag('frame',60,-100);assert gray()<255,'works directly without enabling or opening WL controls';assert pg.locator('#slice').input_value()==idx
 ww=float(pg.locator('#ww-number').input_value());drag('frame',50,0);assert float(pg.locator('#ww-number').input_value())>ww
 state=pg.locator('#wl-status').inner_text();pinch('frame');assert pg.locator('#wl-status').inner_text()==state;assert pg.locator('#zscale').inner_text()!='×1.00'
 pg.click('#zoom-reset');drag('frame',10,0,True);drag('frame',0,10);assert pg.locator('#slice').input_value()==idx
 pg.click('#vs-fold');pg.click('#measure');assert pg.locator('#wl-drag-hud-1').is_hidden();state=(pg.locator('#wl-number').input_value(),pg.locator('#ww-number').input_value());pg.click('#vs-fold');drag('frame',25,20);assert (pg.locator('#wl-number').input_value(),pg.locator('#ww-number').input_value())==state
 pg.click('#vs-fold');pg.click('#measure');pg.click('#vs-fold');drag('frame',20,-10);assert (pg.locator('#wl-number').input_value(),pg.locator('#ww-number').input_value())!=state,'measurement off restores direct drag'
 pg.click('#dual-toggle');primary=check('frame');before=pg.locator('#dual-slice').input_value();drag('dual-frame',40,-20);assert check('frame')==primary;assert pg.locator('#dual-slice').input_value()==before;assert pg.locator('#select-pane-2').get_attribute('aria-pressed')=='true'
 state=pg.locator('#wl-status').inner_text();pinch('dual-frame');assert pg.locator('#wl-status').inner_text()==state;assert 'scale(2)' in pg.locator('#dual-frame').get_attribute('style')
 pg.click('#zoom-reset');pg.click('#vs-fold');pg.click('#measure');assert pg.locator('#wl-drag-hud-2').is_hidden();assert pg.locator('#wl-drag-hud-1').is_visible();pg.click('#vs-fold');primary=pg.locator('#wl-drag-hud-1').text_content();drag('frame',20,-15);assert pg.locator('#wl-drag-hud-1').text_content()!=primary,'other pane measurement must not block direct dragging on primary'
 drag('dual-frame',25,-15);pg.click('#vs-fold');assert pg.locator('#measure').get_attribute('aria-pressed')=='true';pg.click('#measure');pg.click('#vs-fold');drag('dual-frame',15,-15);assert pg.locator('#dual-slice').input_value()==before
 pg.click('#fs-toggle');pg.wait_for_timeout(150);drag('frame',20,-15);assert pg.locator('#wl-drag-hud-1').is_visible();assert pg.locator('#vs-fold').get_attribute('aria-expanded')=='false';pg.click('#fs-exit')
 pg.click('#lang-toggle');assert 'no activation' in pg.locator('#wl-drag-note').inner_text();assert pg.locator('#wl-drag-hud-1').evaluate("e=>getComputedStyle(e).pointerEvents")=='none'
 pg.click('#vs-fold');pg.locator('#display-window').evaluate('e=>e.open=true')
 assert pg.locator('#wl-example').evaluate('e=>getComputedStyle(e).userSelect')=='none'
 assert pg.locator('#wl-number').evaluate('e=>getComputedStyle(e).userSelect')=='text'
 assert pg.locator('#rep-findings').evaluate('e=>getComputedStyle(e).userSelect')!='none'
 assert not pg.locator('#frame').evaluate("e=>e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))")
 assert pg.locator('#rep-findings').evaluate("e=>e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))")
 for width in [360,720,1280]:pg.set_viewport_size({'width':width,'height':1000});assert pg.evaluate('document.documentElement.scrollWidth<=innerWidth')
 assert not requests and not downloads,(requests,downloads)
 unchanged=pg.evaluate("""async()=>{const db=await new Promise(r=>{const q=indexedDB.open('rrai',2);q.onsuccess=()=>r(q.result)}),tx=db.transaction('studies');const rows=await new Promise(r=>{const q=tx.objectStore('studies').getAll();q.onsuccess=()=>r(q.result)});db.close();return rows.every(s=>s.frames.every(f=>f.info.slope===1&&f.info.intercept===0&&f.volumeUnit==='HU'&&f.data.every((v,i)=>v===(i<8?-1000:i>=56?1000:98))));}""")
 assert unchanged,'all original saved samples and HU metadata unchanged'

 pg.locator('#worklist tbody tr').nth(1).locator('button').first.click();pg.wait_for_function("!document.getElementById('wl-drag-hud-1').hidden");assert pg.locator('#wl-drag').count()==0
 pg.reload();pg.wait_for_selector('#worklist tbody tr button');pg.locator('#worklist tbody tr button').first.click();pg.wait_for_function("!document.getElementById('wl-drag-hud-1').hidden");drag('frame',20,-10);assert 'WL' in pg.locator('#wl-drag-hud-1').inner_text()
 assert not errors,errors
 print('PASS default immediate CT touch WL/WW, both panes and pinch, measurement precedence/resume, no slice jumps, cancel, fullscreen, AR/EN, case/reload direct mode, scoped selection protection, editable/copied reports, no requests/downloads and unchanged raw/HU; errors []')
 b.close()
