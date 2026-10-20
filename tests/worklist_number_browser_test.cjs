// Run with playwright-cli -s=arena run-code in an isolated test browser on start.html/standalone.html.
async (page) => {
 const check=(ok,msg)=>{if(!ok)throw Error(msg)};const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.setViewportSize({width:390,height:900});
 await page.waitForFunction(()=>!!document.getElementById('wl-clear')?.onclick);
 await page.locator('#demo').click();await page.waitForSelector('#worklist .wl-number');
 const list=page.locator('#worklist tbody tr');const originalCount=await list.count();
 const ids=()=>page.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('rrai',2);q.onsuccess=()=>r(q.result)});const tx=db.transaction('studies');const rows=await new Promise(r=>{const q=tx.objectStore('studies').getAll();q.onsuccess=()=>r(q.result)});db.close();return rows.map(s=>[s.uid,s.patient,s.meta?.patientName]).sort()});
 const before=JSON.stringify(await ids());
 const numbers=async()=>{const a=await page.locator('#worklist .wl-number').allTextContents();check(a.every((n,i)=>n===String(i+1)),'sequential visible numbers');check(a.length===await list.count(),'one badge per study');};
 await page.locator('#wl-options').evaluate(e=>e.open=true);
 for(const sort of ['name','date','study','urgent']){await page.locator('#wl-sort').selectOption(sort);await page.waitForTimeout(250);await numbers();}
 const findName=await page.locator('#worklist .wl-name').first().innerText();
 await page.locator('#wl-query').fill(findName);await page.waitForTimeout(300);check(await list.count()>=1&&await list.count()<originalCount,'search narrowed demo records');await numbers();
 await page.locator('#wl-query').fill('SYNTHETIC-NO-MATCH');await page.waitForTimeout(300);check(await list.count()===0,'no phantom numbering on empty list');
 await page.locator('#wl-clear').click();await page.waitForFunction(n=>document.querySelectorAll('#worklist tbody tr').length===n,originalCount);await numbers();
 for(const width of [360,390,720,1280]){
  await page.setViewportSize({width,height:900});
  check(await page.locator('#worklist .wl-number').first().isVisible(),'visible badge at '+width);
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow at '+width);
 }
 for(const lang of ['en','ar']){
  if(await page.locator('html').getAttribute('lang')!==lang){await page.locator('#lang-toggle').click();await page.waitForFunction(l=>document.documentElement.lang===l,lang);}
  await page.waitForFunction(l=>document.querySelector('.wl-number')?.getAttribute('aria-label')===(l==='en'?'Study number 1':'رقم الدراسة 1'),lang);
  await numbers();
 }
 check(JSON.stringify(await ids())===before,'source IDs unchanged');check(!errors.length,errors.join(';'));
 await page.setViewportSize({width:390,height:900});await list.first().scrollIntoViewIfNeeded();
 await page.screenshot({path:'/home/user/worklist-v142-numbered.png',fullPage:true});
 return {passed:true,records:originalCount,errors};
}
