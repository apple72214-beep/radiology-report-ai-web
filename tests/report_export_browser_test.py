"""Synthetic-only Word workflow, no real patients/credentials/providers. BASE may be live."""
import os,io,json,zipfile,re
from pathlib import Path
from xml.etree import ElementTree as ET
from playwright.sync_api import sync_playwright
BASE=os.getenv('BASE','http://127.0.0.1:8899/standalone.html')
OUT=Path('/home/user/test-results');OUT.mkdir(exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(args=['--no-sandbox']);pg=b.new_page(viewport={'width':390,'height':1000},accept_downloads=True)
 errors=[];downloads=[];pg.on('pageerror',lambda e:errors.append(str(e)));pg.on('download',lambda d:downloads.append(d))
 pg.goto(BASE);pg.wait_for_function("!!document.getElementById('wl-clear')?.onclick&&!!document.getElementById('sign-export-word-en')?.__reportExport")
 pg.wait_for_function('!!navigator.serviceWorker.controller');pg.wait_for_timeout(1500)
 pg.click('#demo');pg.wait_for_selector('#worklist tbody tr button');pg.locator('#worklist tbody tr button').first.click();pg.wait_for_selector('#viewport',state='visible')
 pg.locator('#composer-set').evaluate('e=>e.open=true')
 for id in ['gen-report','copy-report','sign-export','sign-export-word','preview-a4','print-a4','report-ar','report-en','a4-set']:
  assert not pg.locator('#'+id).is_visible(),id
 assert pg.locator('#sign-export-word-en').is_visible()
 assert pg.locator('#rep-findings').input_value()=='' and pg.locator('#rep-impression').input_value()==''
 assert not downloads,'opening a study/composer never downloads a file'
 pg.locator('#gen-report').evaluate('e=>e.click()');pg.wait_for_timeout(200);assert not downloads
 # A stubbed provider demonstrates that generation fills the editor but never downloads.
 provider_calls=[]
 response={'exam':'Synthetic exam without IV contrast','indication':'Synthetic testing only','technique':'Synthetic acquisition without IV contrast.','findings':['Mock AI finding one.','Mock AI finding two.'],'impression':['Mock impression one.','Mock impression two.']}
 def provider(route):
  provider_calls.append(route.request.url);route.fulfill(status=200,content_type='application/json',body=json.dumps({'candidates':[{'content':{'parts':[{'text':json.dumps(response)}]}}]}))
 pg.route('https://generativelanguage.googleapis.com/**',provider)
 pg.fill('#ai-key','AIzaSYNTHETIC_NOT_A_REAL_KEY');pg.select_option('#ai-provider','gemini');pg.once('dialog',lambda d:d.accept());pg.click('#ai-gen')
 pg.wait_for_function("document.getElementById('rep-findings').value.includes('Mock AI finding one.')")
 assert provider_calls and not downloads,'AI generation must not auto-download'
 pg.click('#sign-export-word-en');pg.wait_for_timeout(150);assert not downloads,'signer required'
 pg.fill('#signer','Synthetic Reviewer');pg.click('#sign-export-word-en');pg.wait_for_timeout(150);assert not downloads,'review approval required'
 findings='Synthetic **finding A** with punctuation, unchanged.\nSecond reviewed finding.\nSecond reviewed finding.'
 impression='Synthetic impression one.\nSynthetic impression two.'
 pg.fill('#rep-findings',findings);pg.fill('#rep-impression',impression);pg.check('#signoff')
 pg.evaluate("()=>{window.revoked=[];const old=URL.revokeObjectURL;URL.revokeObjectURL=u=>{window.revoked.push(u);old.call(URL,u)}}")
 with pg.expect_download() as got:pg.click('#sign-export-word-en')
 d=got.value;assert d.suggested_filename.endswith('.docx');data=Path(d.path()).read_bytes()
 xml=zipfile.ZipFile(io.BytesIO(data)).read('word/document.xml');root=ET.fromstring(xml);ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
 paragraphs=[''.join(p.itertext()) for p in root.findall('.//w:body/w:p',ns)]
 assert 'Synthetic finding A with punctuation, unchanged.' in paragraphs
 assert paragraphs.count('Second reviewed finding.')==2
 assert '• Synthetic impression one.' in paragraphs and '• Synthetic impression two.' in paragraphs
 assert not any('Automated triage' in p or 'max quadrant' in p for p in paragraphs)
 assert 'Mock AI finding one.' not in '\n'.join(paragraphs),'export uses current edits, not stale model output'
 assert pg.locator('#report-download-result').is_visible();assert pg.locator('#report-download-name').inner_text()==d.suggested_filename
 assert pg.locator('#report-download-again').get_attribute('download')==d.suggested_filename
 archive=pg.evaluate("JSON.parse(localStorage.getItem('rrai-archive')||'[]')")
 assert len(archive)==1 and archive[0]['findings']==findings and archive[0]['impression']==impression
 assert archive[0]['status']=='signed' and archive[0]['studyUid']
 old_url=pg.locator('#report-download-again').get_attribute('href')
 with pg.expect_download() as again:pg.click('#report-download-again')
 assert Path(again.value.path()).read_bytes()==data,'same-file link reuses bytes'
 with pg.expect_download() as same:pg.click('#sign-export-word-en')
 assert Path(same.value.path()).read_bytes()==data,'unchanged button reuses bytes'
 assert len(pg.evaluate("JSON.parse(localStorage.getItem('rrai-archive')||'[]')"))==1,'no duplicate archive/signatures on same-file downloads'
 # Editing invalidates the old file and approval, without triggering downloads.
 pg.fill('#rep-findings',findings+'\nEdited final line.');assert not pg.locator('#signoff').is_checked();assert not pg.locator('#report-download-result').is_visible()
 assert pg.evaluate('(u)=>window.revoked.includes(u)',old_url)
 n=len(downloads);pg.click('#sign-export-word-en');pg.wait_for_timeout(150);assert len(downloads)==n
 pg.check('#signoff')
 with pg.expect_download() as changed:pg.click('#sign-export-word-en')
 changed_data=Path(changed.value.path()).read_bytes();assert changed_data!=data
 assert b'Edited final line.' in zipfile.ZipFile(io.BytesIO(changed_data)).read('word/document.xml')
 # Switching cases revokes the old file and rejects an archive from another patient.
 changed_url=pg.locator('#report-download-again').get_attribute('href')
 pg.locator('#worklist tbody tr').nth(1).locator('button').first.click();pg.wait_for_timeout(200)
 assert not pg.locator('#report-download-result').is_visible()
 assert pg.evaluate('(u)=>window.revoked.includes(u)',changed_url)
 pg.locator('#archive-set').evaluate('e=>e.open=true');pg.wait_for_timeout(200)
 pg.locator('#archive-list button').first.click();assert pg.locator('#rep-findings').input_value()==''
 assert len(downloads)==n+1
 pg.locator('#worklist tbody tr').first.locator('button').first.click();pg.wait_for_timeout(200)
 # Older archives stored arrays: restore with real newlines, never implicit comma joining.
 pg.evaluate("()=>{const a=JSON.parse(localStorage.getItem('rrai-archive'));a[0].findings=['Archived first.','Archived second.'];a[0].impression=['Archived point one.','Archived point two.'];localStorage.setItem('rrai-archive',JSON.stringify(a));}")
 pg.locator('#archive-set').evaluate('e=>e.open=true');pg.locator('#archive-q').evaluate("e=>e.dispatchEvent(new Event('input'))");pg.wait_for_timeout(200)
 pg.once('dialog',lambda d:d.accept());pg.locator('#archive-list button').first.click()
 assert pg.locator('#rep-findings').input_value()=='Archived first.\nArchived second.'
 assert pg.locator('#rep-impression').input_value()=='Archived point one.\nArchived point two.'
 assert len(downloads)==n+1,'opening archive never downloads'
 assert not pg.locator('#signoff').is_checked()
 assert not pg.locator('#archive-list').get_by_role('button',name=re.compile('Re-export|إعادة تصدير')).count()
 # Consistency warnings can be cancelled, and rapid double clicks create one file.
 pg.fill('#rep-technique','Synthetic acquisition with IV contrast.');pg.check('#signoff')
 count_before=len(downloads);pg.once('dialog',lambda d:d.dismiss());pg.click('#sign-export-word-en');pg.wait_for_timeout(150)
 assert len(downloads)==count_before and pg.locator('#report-review-output').is_visible()
 pg.fill('#rep-technique','Synthetic acquisition without IV contrast.');pg.check('#signoff')
 with pg.expect_download():pg.evaluate("()=>{const b=document.getElementById('sign-export-word-en');b.click();b.click();}")
 pg.wait_for_timeout(200);assert len(downloads)==count_before+1,'same-task double click makes only one file'
 # A study change while hashing must abort, not download the previous patient's file.
 pg.fill('#rep-findings','Changed during preparation.');pg.check('#signoff')
 pg.evaluate("()=>{window.savedDigest=crypto.subtle.digest.bind(crypto.subtle);crypto.subtle.digest=(...a)=>new Promise(r=>setTimeout(()=>r(window.savedDigest(...a)),250))}")
 pg.evaluate("()=>{document.getElementById('sign-export-word-en').click();document.querySelectorAll('#worklist tbody tr')[1].querySelector('button').click()}")
 pg.wait_for_timeout(500);assert len(downloads)==count_before+1,'no stale study file after asynchronous prepare'
 pg.evaluate("()=>{crypto.subtle.digest=window.savedDigest}")
 pg.locator('#worklist tbody tr').first.locator('button').first.click();pg.wait_for_timeout(200)
 # All clinical fields stay untouched while widths/language change; no PDF export.
 for width in [360,390,720,1280]:
  pg.set_viewport_size({'width':width,'height':1000});assert pg.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
 pg.click('#lang-toggle');pg.wait_for_function("document.documentElement.lang==='en'")
 pg.wait_for_function("document.getElementById('sign-export-word-en').textContent.includes('Download report')")
 assert 'Word' in pg.locator('#sign-export-word-en').inner_text()
 assert not pg.locator('#sign-export').is_visible();assert pg.locator('#default-export-sel').is_disabled()
 assert pg.locator('#default-export-sel option').count()==1
 pg.set_viewport_size({'width':390,'height':1000});pg.locator('#report-export-panel').scroll_into_view_if_needed();pg.screenshot(path='/home/user/word-report-v144.png')
 assert not errors,errors
 print('PASS one English Word path, explicit-only downloads, mocked AI no auto-download, edited composer content, review/signature gates, stable same-file bytes, invalidation, archive array line breaks, no PDF, AR/EN and widths; errors []')
 b.close()
