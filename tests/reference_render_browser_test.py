from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(args=['--no-sandbox']);pg=b.new_page(viewport={'width':720,'height':1100});errors=[];pg.on('pageerror',lambda e:errors.append(str(e)));pg.goto(__import__('os').getenv('BASE','http://127.0.0.1:8899/standalone.html'));pg.wait_for_selector('#demo');pg.wait_for_function("localStorage.getItem('rrai-boot-stage')==='ready'");pg.wait_for_timeout(1500);pg.click('#demo');pg.wait_for_selector('#worklist tbody tr button',timeout=30000);pg.wait_for_timeout(300)
 print("errors",errors,pg.locator("#status").all_text_contents())
 pg.evaluate("""async()=>{const db=await new Promise(r=>{const q=indexedDB.open('rrai',2);q.onsuccess=()=>r(q.result)});const tx=db.transaction('studies','readwrite'),st=tx.objectStore('studies');const rows=await new Promise(r=>{const q=st.getAll();q.onsuccess=()=>r(q.result)});const s=rows[0]; for(const other of rows.slice(1))st.delete(other.uid); const base=s.frames.slice(0,4);s.frames=[];for(let i=0;i<3;i++)base.forEach((f,j)=>s.frames.push({...f,w:i===1?192:256,h:i===1?320:128,kind:'gray',data:Float32Array.from({length:i===1?192*320:256*128},(_,k)=>(k%192+Math.floor(k/192))%256),seriesUid:'test-'+i,seq:{seriesNumber:i+1,seriesDescription:'Test '+i},spacing:[1,1],geometry:{frameOfReferenceUid:'same',ipp:i===1?[20+j*2,0,0]:[0,0,50+j*20],iop:i===1?[0,1,0,0,0,1]:[1,0,0,0,1,0],spacingBetweenSlices:2}}));delete s.series;st.put(s);await new Promise(r=>tx.oncomplete=r);db.close()}""")
 pg.reload();pg.wait_for_selector('#worklist tbody tr button');pg.locator('#worklist tbody tr button').first.click();pg.wait_for_timeout(1000)




 pg.click('#dual-toggle');pg.wait_for_timeout(250)
 assert 'خط المستوى' in pg.locator('#reference-status').inner_text()
 def colored():return pg.locator('#dual-frame').evaluate("c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i]>d[i+1]&&d[i+1]>d[i+2])n++;return {n,ratio:n/(c.width*c.height),w:c.width,h:c.height}}")
 def check():
  pg.wait_for_timeout(100);d=colored();assert 0<d['ratio']<.04,d;return d
 print('fit overlay',check())
 pg.click('#vs-fold');pg.click('#select-pane-2')
 for width in [360,720,1280]:
  pg.set_viewport_size({'width':width,'height':1000})
  for turn in range(4):
   pg.click('#orient-rotate');pg.click('#orient-fliph');pg.click('#orient-flipv');check()
  pg.click('#orient-reset')
 pg.locator('#dual-slice').fill('2');pg.locator('#dual-slice').dispatch_event('input');check()
 cv=pg.locator('#dual-frame');cv.scroll_into_view_if_needed();cv.hover();pg.keyboard.down('Control');pg.mouse.wheel(0,-400);pg.keyboard.up('Control');check()
 pg.click('#zoom-reset');check()
 # Greyscale image invert must not turn the yellow line into a filled region.
 pg.click('#orient-invert');check();pg.click('#orient-invert')
 pg.click('#fs-toggle');pg.wait_for_timeout(200);check();pg.click('#fs-exit')
 assert not errors,errors
 print('PASS secondary colored area remains thin at all quarter turns/flips, non-square matrices, 360/720/1280, slice changes, zoom/fit/invert/fullscreen; page errors []')
 b.close()
