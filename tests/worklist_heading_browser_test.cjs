// Run through playwright-cli -s=arena run-code after opening the app in an isolated test session.
async (page) => {
 const check=(ok,msg)=>{if(!ok)throw Error(msg)};
 await page.waitForFunction(()=>!!document.getElementById('wl-clear')?.onclick);
 const summary=page.locator('#wl-options-summary');
 const results=[];
 for(const lang of ['ar','en']){
  if(await page.locator('html').getAttribute('lang')!==lang){await page.locator('#lang-toggle').click();await page.waitForFunction(l=>document.documentElement.lang===l,lang);}
  for(const theme of ['dark','light']){
   // Set the root attribute only to inspect both CSS palettes; no credentials or records.
   await page.locator('html').evaluate((e,t)=>e.dataset.theme=t,theme);
   for(const width of [360,390,720,1280]){
    await page.setViewportSize({width,height:900});
    const state=await summary.evaluate(e=>{
     const icon=e.querySelector('.wl-settings-icon'),s=getComputedStyle(e),c=getComputedStyle(document.getElementById('wl-count'));
     const lum=str=>{const a=str.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return a[0]*.2126+a[1]*.7152+a[2]*.0722};
     const l=[lum(s.color),lum(s.backgroundColor)].sort((a,b)=>a-b);
     return {gear:icon?.textContent,hidden:icon?.getAttribute('aria-hidden'),leading:e.firstElementChild===icon,marker:s.listStyleType,color:s.color,studyColor:c.color,contrast:(l[1]+.05)/(l[0]+.05),overflow:document.documentElement.scrollWidth>innerWidth};
    });
    check(state.gear==='⚙'&&state.hidden==='true'&&state.leading,'leading decorative gear');
    check(state.marker==='none','native arrow removed');check(state.color!==state.studyColor,'distinct title color');
    check(state.contrast>=4.5,'title contrast');check(!state.overflow,'responsive header');
    results.push({lang,theme,width,contrast:state.contrast});
   }
  }
 }
 await summary.click();const opened=await page.locator('#wl-options').evaluate(e=>e.open);
 await summary.focus();await page.keyboard.press('Enter');check(await page.locator('#wl-options').evaluate(e=>e.open)!==opened,'keyboard toggle');
 await page.locator('html').evaluate(e=>e.dataset.theme='dark');await page.setViewportSize({width:390,height:900});
 await summary.scrollIntoViewIfNeeded();await page.screenshot({path:'/home/user/worklist-v141-heading.png'});
 return {passed:true,results};
}
