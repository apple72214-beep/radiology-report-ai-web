// Run with an arena Playwright CLI session already open on BASE/start.html or standalone.html:
// playwright-cli -s=arena run-code "$(cat web/tests/worklist_compact_browser_test.cjs)"
// All fixtures are synthetic. Does not upload files or use real credentials.
async (page) => {
 const assert=(ok,msg)=>{if(!ok)throw new Error(msg)};
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.setViewportSize({width:390,height:900});
 await page.waitForFunction(()=>!!document.getElementById('wl-clear')?.onclick);
 if(!await page.locator('#worklist tbody tr').count())await page.locator('#demo').click();
 await page.waitForSelector('#worklist tbody tr button');
 const expectedCount=await page.locator('#worklist tbody tr').count();
 await page.evaluate(async()=>{
  const db=await new Promise(r=>{const q=indexedDB.open('rrai',2);q.onsuccess=()=>r(q.result)});
  const tx=db.transaction('studies','readwrite'),store=tx.objectStore('studies');
  const rows=await new Promise(r=>{const q=store.getAll();q.onsuccess=()=>r(q.result)});
  rows.forEach((s,i)=>{
   s.patient='SYNTHETIC-ID-'+i;
   s.meta={...s.meta,patientName:i?'دراسة تجريبية باسم عربي طويل لاختبار المساحة':'SYNTHETIC LONG NAME FOR MOBILE COMPACT STUDY CARD',studyDate:'20261020',studyTime:'093500',studyDesc:'Synthetic description retained in optional details'};
   s.modality='MR';s.pixelBad=i?2:0;
   s.triage={...s.triage,priority:i?'routine':'urgent',reasons:['Synthetic reason retained in details']};
   const base=s.frames[0];s.frames=Array.from({length:106},(_,n)=>({...base,seq:{...base.seq,seriesNumber:n%9+1,seriesDescription:'Synthetic series '+(n%9+1)}}));
   delete s.series;store.put(s);
  });
  await new Promise(r=>tx.oncomplete=r);db.close();
 });
 await page.reload();await page.waitForSelector('#worklist tbody tr button');
 if(await page.locator('html').getAttribute('lang')!=='ar'){await page.locator('#lang-toggle').click();await page.waitForFunction(()=>document.documentElement.lang==='ar');await page.waitForFunction(()=>document.querySelector('.wl-study-details > summary')?.textContent==='التفاصيل');}
 const rows=page.locator('#worklist tbody tr');assert(await rows.count()===expectedCount,'synthetic record count retained');
 const measures=[];
 for(const width of [360,390,600,720,1280,390]){
  await page.setViewportSize({width,height:900});
  await page.waitForTimeout(120);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no page overflow at '+width);
  const first=rows.first(),details=first.locator('.wl-study-details');
  if(width<=600){
   assert(!await details.evaluate(e=>e.open),'mobile details closed at '+width);
   assert(await first.locator('.wl-card-meta').isVisible(),'visible concise metadata');
   const rect=await first.boundingBox();measures.push({width,height:rect.height});
   assert(rect.height<=190,'compact long-name card height '+JSON.stringify(measures));
   for(const button of await first.locator('button').all()){
    const r=await button.boundingBox();assert(r.height>=36&&r.width>=36,'usable touch targets');
   }
   assert(await rows.nth(1).locator('.wl-card-meta [data-status="warning"]').isVisible(),'pixel warning not hidden');
   const summary=details.locator(':scope > summary');await summary.click();
   assert(await details.evaluate(e=>e.open),'optional details expand');
   assert(await first.locator('.wl-study-info').isVisible(),'description revealed');
   assert((await first.innerText()).includes('Synthetic description retained'),'description preserved');
   assert((await first.innerText()).includes('09:35'),'full DICOM time retained');
   await summary.click();assert(!await details.evaluate(e=>e.open),'details collapse');
  }else{
   assert(await details.evaluate(e=>e.open),'desktop descriptions stay visible');
   assert(!await details.locator(':scope > summary').isVisible(),'desktop not given redundant details toggle');
   assert(await first.locator('td').nth(1).isVisible(),'desktop modality column retained');
   assert(!await first.locator('.wl-card-meta').isVisible(),'no duplicate desktop metadata');
  }
 }
 await rows.first().scrollIntoViewIfNeeded();
 await page.screenshot({path:'/home/user/worklist-v140-compact-mobile.png',fullPage:true});
 await page.locator('#lang-toggle').click();
 await page.waitForFunction(()=>document.documentElement.lang==='en');
 await page.waitForFunction(()=>document.querySelector('.wl-study-details > summary')?.textContent==='Details');
 assert((await page.locator('.wl-card-meta').first().innerText()).includes('106 images'),'English compact metadata');
 await page.locator('.wl-study-details > summary').first().focus();await page.keyboard.press('Enter');
 assert(await page.locator('.wl-study-details').first().evaluate(e=>e.open),'keyboard details toggle');
 assert(await rows.count()===expectedCount,'folding never deletes studies');
 assert(!errors.length,'no JavaScript errors: '+errors.join(';'));
 console.log('PASS compact mobile cards, long AR/EN names, preserved warnings and full details, responsive desktop, touch targets, keyboard; '+JSON.stringify(measures));
 return {passed:true,measures,errors};
}
