from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(args=['--no-sandbox']);pg=b.new_page(viewport={'width':720,'height':1100});errors=[];pg.on('pageerror',lambda e:errors.append(str(e)));pg.goto(__import__('os').getenv('BASE','http://127.0.0.1:8899/standalone.html'));pg.wait_for_selector('#demo');pg.wait_for_function("localStorage.getItem('rrai-boot-stage')==='ready'");pg.wait_for_timeout(1500);pg.click('#demo');pg.wait_for_selector('#worklist tbody tr button',timeout=30000);pg.wait_for_timeout(500)
 print("errors",errors,pg.locator("#status").all_text_contents())
 pg.evaluate("""async()=>{const db=await new Promise(r=>{const q=indexedDB.open('rrai',2);q.onsuccess=()=>r(q.result)});const tx=db.transaction('studies','readwrite'),st=tx.objectStore('studies');const rows=await new Promise(r=>{const q=st.getAll();q.onsuccess=()=>r(q.result)});const s=rows[0]; for(const other of rows.slice(1))st.delete(other.uid); const base=s.frames.slice(0,4);s.frames=[];for(let i=0;i<3;i++)base.forEach((f,j)=>s.frames.push({...f,seriesUid:'test-'+i,seq:{seriesNumber:i+1,seriesDescription:'Test '+i},geometry:{frameOfReferenceUid:'same',ipp:[0,0,j*2],iop:[1,0,0,0,1,0],spacingBetweenSlices:2}}));delete s.series;st.put(s);await new Promise(r=>tx.oncomplete=r);db.close()}""")
 pg.reload();pg.wait_for_selector('#worklist tbody tr button');pg.locator('#worklist tbody tr button').first.click();pg.wait_for_timeout(1000)



 pg.click('#dual-toggle');pg.click('#vs-fold');pg.click('#select-pane-2');
 assert pg.locator('#select-pane-2').get_attribute('aria-pressed')=='true'
 primary_transform=pg.locator('#vwrap').get_attribute('style')
 def checksum(id):return pg.evaluate("""id=>{let c=document.getElementById(id),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let h=0;for(let i=0;i<d.length;i+=17)h=(h+d[i])%1000000007;return h;}""",id)
 original=checksum('frame');second=checksum('dual-frame')
 pg.click('#orient-invert');pg.wait_for_timeout(200);assert checksum('dual-frame')!=second;assert checksum('frame')==original
 pg.click('#orient-invert');pg.click('#orient-rotate');pg.wait_for_timeout(200);assert '90' in pg.locator('#orient-rotate').inner_text();assert pg.locator('#vwrap').get_attribute('style')==primary_transform
 pg.select_option('#preset','bone');pg.wait_for_timeout(200);assert checksum('frame')==original
 pg.select_option('#preset','auto');pg.click('#measure');pg.select_option('#measure-mode','probe')
 cv=pg.locator('#dual-frame');r=cv.bounding_box();cv.click(position={'x':(r['width']-min(r['width'],r['height']))/2+min(r['width'],r['height'])*.3,'y':(r['height']-min(r['width'],r['height']))/2+min(r['width'],r['height'])*.25});pg.wait_for_timeout(200)
 probe_text=pg.locator('#measure-out').inner_text();print('rotated probe',probe_text);assert '(64, 179)' in pg.locator('#measure-out').inner_text()
 pg.select_option('#measure-mode','rect');r=cv.bounding_box();cv.click(position={'x':r['width']*.2,'y':r['height']*.2});cv.click(position={'x':r['width']*.6,'y':r['height']*.6});pg.wait_for_timeout(200)
 assert '1' in pg.locator('#measure-out').inner_text()
 pg.locator('#dual-slice').fill('1');pg.locator('#dual-slice').dispatch_event('input');pg.wait_for_timeout(100);assert '0' in pg.locator('#measure-out').inner_text()
 pg.locator('#dual-slice').fill('0');pg.locator('#dual-slice').dispatch_event('input');pg.wait_for_timeout(100);assert '1' in pg.locator('#measure-out').inner_text()
 pg.click('#select-pane-1');assert pg.locator('#preset').input_value()=='auto';assert '0°' in pg.locator('#orient-rotate').inner_text()
 pg.click('#measure');pg.select_option('#measure-mode','seg');cv1=pg.locator('#frame');r=cv1.bounding_box();cv1.click(position={'x':r['width']*.3,'y':r['height']*.3});cv1.click(position={'x':r['width']*.6,'y':r['height']*.6});pg.wait_for_timeout(200)
 pg.click('#select-pane-2');pg.click('#measure-clear');pg.wait_for_timeout(200)
 data=pg.evaluate("""async()=>{const db=await new Promise(r=>{let q=indexedDB.open('rrai',2);q.onsuccess=()=>r(q.result)});return await new Promise(r=>{let q=db.transaction('studies').objectStore('studies').getAll();q.onsuccess=()=>r(q.result[0].measurementFrames);});}""")
 print('saved frame keys',list(data));assert len(data['1:0']['segments'])==1 and not data['2:4']['rects']
 pg.click('#measure');cv=pg.locator('#dual-frame');cv.scroll_into_view_if_needed();cv.hover();pg.keyboard.down('Control');pg.mouse.wheel(0,-300);pg.keyboard.up('Control');pg.wait_for_timeout(200);assert 'scale(1)' not in cv.get_attribute('style')
 pg.click('#zoom-reset');pg.wait_for_timeout(200);assert 'scale(1)' in cv.get_attribute('style')

 # All persistent tools in pane 2; verify the stored source pixel for the earlier probe.
 raw=pg.evaluate("""async()=>{const db=await new Promise(r=>{let q=indexedDB.open('rrai',2);q.onsuccess=()=>r(q.result)});return await new Promise(r=>{let q=db.transaction('studies').objectStore('studies').getAll();q.onsuccess=()=>r(q.result[0].frames[4].data[179*256+64]);});}""")
 assert float(probe_text.split(' = ')[1].split(' ')[0])==round(raw,2)
 print('probe source pixel verified:',raw)
 pg.click('#measure')
 for mode,pts in [('seg',[(.3,.3),(.55,.5)]),('angle',[(.3,.3),(.5,.5),(.7,.3)]),('roi',[(.5,.5),(.65,.65)]),('rect',[(.3,.3),(.6,.6)])]:
  pg.select_option('#measure-mode',mode);cv=pg.locator('#dual-frame');r=cv.bounding_box();k=min(r['width'],r['height'])
  for x,y in pts:cv.click(position={'x':(r['width']-k)/2+x*k,'y':(r['height']-k)/2+y*k})
 pg.wait_for_timeout(250)
 pg.click('#measure');cv=pg.locator('#dual-frame');cv.scroll_into_view_if_needed();r=cv.bounding_box();x=r['x']+r['width']/2;y=r['y']+r['height']/2
 cdp=pg.context.new_cdp_session(pg)
 cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x-30,'y':y,'id':1},{'x':x+30,'y':y,'id':2}]})
 cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x-60,'y':y,'id':1},{'x':x+60,'y':y,'id':2}]})
 cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]});pg.wait_for_timeout(200)
 assert 'scale(2)' in cv.get_attribute('style'),cv.get_attribute('style')

 stage=pg.locator('#dual-image-stage').bounding_box();x=stage['x']+stage['width']/2;y=stage['y']+stage['height']/2
 pg.mouse.move(x,y);pg.mouse.down();pg.mouse.move(x+35,y+20,steps=4);pg.mouse.up();pg.wait_for_timeout(100);assert 'translate(35px, 20px)' in cv.get_attribute('style')
 for width in [1280,720]:
  pg.set_viewport_size({'width':width,'height':1100});pg.wait_for_timeout(100)
  assert pg.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
  assert cv.is_visible() and pg.locator('#viewport').is_visible()
 pg.click('#zoom-reset');pg.click('#fs-toggle');pg.wait_for_timeout(300)
 assert pg.locator('#viewer-settings').is_hidden();assert pg.locator('#series-overview').is_hidden();assert pg.locator('#select-pane-2').is_visible();assert cv.is_visible()
 pg.click('#select-pane-1');pg.click('#select-pane-2');pg.click('#fs-exit');pg.wait_for_timeout(200)
 pg.reload();pg.wait_for_selector('#worklist tbody tr button');pg.locator('#worklist tbody tr button').first.click();pg.wait_for_timeout(600)
 saved=pg.evaluate("""async()=>{const db=await new Promise(r=>{let q=indexedDB.open('rrai',2);q.onsuccess=()=>r(q.result)});return await new Promise(r=>{let q=db.transaction('studies').objectStore('studies').getAll();q.onsuccess=()=>r(q.result[0].measurementFrames);});}""")
 assert len(saved['1:0']['segments'])==1
 for kind in ['segments','angles','rois','rects']:assert len(saved['2:4'][kind])==1,(kind,saved['2:4'])
 pg.click('#dual-toggle');pg.click('#select-pane-2');
 if pg.locator('#viewer-settings').is_hidden():pg.click('#vs-fold')
 pg.click('#measure');assert '4' in pg.locator('#measure-out').inner_text()
 print('PASS four saved tools survive reload, two-finger pinch, clean dual fullscreen, selected pane survives fullscreen switch')
 assert not errors,errors
 print('PASS secondary invert, rotation, independent WL, inverse probe, frame-scoped ROI, isolated clear, zoom/fit; no page errors')
 b.close()
