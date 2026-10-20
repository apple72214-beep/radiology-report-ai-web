// playwright-cli -s=arena run-code "$(cat web/tests/interface_language_browser_test.cjs)"
// Use a fresh isolated browser with synthetic/no records. Does not call PACS or cloud AI.
async (page) => {
 const check=(ok,msg)=>{if(!ok)throw Error(msg)};const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.setViewportSize({width:390,height:1000});
 await page.waitForFunction(()=>!!document.getElementById('wl-clear')?.onclick&&!!document.getElementById('mpr-link-view'));
 const refs=await page.evaluate(()=>{window.__langControls=Object.fromEntries(['preset','measure-mode','crit-alert','ov-name-chk','signoff','spatial-sync-toggle'].map(id=>[id,document.getElementById(id)]));return Object.keys(window.__langControls)});
 await page.locator('#viewer-settings').evaluate(e=>e.hidden=false);
 await page.locator('#measure-mode').selectOption('rect');await page.locator('#preset').selectOption('bone');
 await page.locator('#rep-notes').evaluate(e=>e.value='SYNTHETIC ملاحظات أصلية must remain');
 await page.locator('#signoff').evaluate(e=>e.checked=true);
 await page.locator('#mpr-link-view').click();
 const switchTo=async lang=>{if(await page.locator('html').getAttribute('lang')!==lang)await page.locator('#lang-toggle').click();await page.waitForFunction(l=>document.documentElement.lang===l&&document.getElementById('measure-mode').options[0].textContent===(l==='en'?'Segment':'قطع'),lang);};
 const audit=()=>page.evaluate(()=>{
  const hits=[],re=/[\u0600-\u06ff]/,walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;
  while(n=walk.nextNode()){
   const p=n.parentElement;if(!p||p.closest('script,style,#lang-toggle,textarea,#report-ar,#a4-prev,#bank-list,#worklist tbody'))continue;
   // Custom template names and source documents are user data, not UI translations.
   if(re.test(n.nodeValue)&&n.nodeValue.trim())hits.push({id:p.id,parent:p.parentElement?.id,text:n.nodeValue.trim().slice(0,120)});
  }
  const attrs=[];for(const el of document.querySelectorAll('[title],[aria-label],[placeholder]')){
   if(el.closest('#worklist tbody'))continue;
   for(const a of ['title','aria-label','placeholder'])if(re.test(el.getAttribute(a)||''))attrs.push({id:el.id,a,text:el.getAttribute(a)});
  }
  return {hits,attrs};
 });
 for(const lang of ['en','ar','en']){
  await switchTo(lang);
  check(await page.locator('#measure-mode').inputValue()==='rect','measurement selection preserved');
  check(await page.locator('#preset').inputValue()==='bone','window selection preserved');
  check(await page.locator('#signoff').isChecked(),'checkbox state preserved');
  check((await page.locator('#rep-notes').inputValue()).includes('ملاحظات أصلية'),'clinical/user text never translated');
  check(await page.locator('#mpr-link-view').getAttribute('aria-pressed')==='false','MPR link state preserved');
  check(await page.locator('#spatial-sync-toggle').isChecked()===false,'spatial sync remains opt-in/off');
  check(await page.evaluate(()=>Object.entries(window.__langControls).every(([id,e])=>e===document.getElementById(id))),'same control nodes retained');
  if(lang==='en'){
   const left=await audit();check(!left.hits.length&&!left.attrs.length,'untranslated built-in UI: '+JSON.stringify(left));
   check((await page.locator('#mpr-link-view').innerText()).includes('independent'),'stateful English MPR label');
  }else check((await page.locator('#geometry-diagnostic-summary').innerText()).includes('تشخيص'),'Arabic restored');
 }
 for(const width of [360,390,720,1280]){
  await page.setViewportSize({width,height:1000});
  await page.locator('#viewer-settings').evaluate(e=>{e.hidden=false;for(const d of e.querySelectorAll('details'))d.open=true});
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no UI overflow '+width);
 }
 await page.setViewportSize({width:390,height:1000});await page.locator('#viewer-settings').scrollIntoViewIfNeeded();
 await page.screenshot({path:'/home/user/interface-v143-english.png',fullPage:true});
 await page.reload();await page.waitForFunction(()=>!!document.getElementById('mpr-link-view')&&document.documentElement.lang==='en');
 await page.waitForTimeout(300);const boot=await audit();check(!boot.hits.length&&!boot.attrs.length,'English on reload, including late controls: '+JSON.stringify(boot));
 check(!errors.length,errors.join(';'));return {passed:true,controlNodesPreserved:refs,englishReload:true,errors};
}
