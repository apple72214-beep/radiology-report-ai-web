"""Reimport synthetic conventional CT after simulating the old parser's errors."""
import os,struct,json
from pathlib import Path
from playwright.sync_api import sync_playwright
BASE=os.getenv('BASE','http://127.0.0.1:8899/standalone.html')
OUT=Path('/home/user/test-fixtures/ct149');OUT.mkdir(parents=True,exist_ok=True)
def el(g,e,vr,value):
 b=value if isinstance(value,bytes) else str(value).encode();b+=b'\0' if len(b)%2 else b''
 h=struct.pack('<HH',g,e)+vr.encode()
 return h+(b'\0\0'+struct.pack('<I',len(b)) if vr in ['OW','OB'] else struct.pack('<H',len(b)))+b
def us(n):return struct.pack('<H',n)
files=[]
for z in range(4):
 tags=[(8,0x16,'UI','1.2.840.10008.5.1.4.1.1.2'),(8,0x60,'CS','CT'),(8,0x20,'DA','20261030'),(0x10,0x10,'PN','SYNTHETIC PRIVATE'),(0x10,0x20,'LO','SYNTHETIC'),(0x20,0xd,'UI','1.2.3.7'),(0x20,0xe,'UI','1.2.3.9'),(0x20,0x52,'UI','1.2.3.4'),(0x20,0x11,'IS','3'),(0x20,0x32,'DS',f'0\\0\\{z}'),(0x20,0x37,'DS','1\\0\\0\\0\\1\\0'),(0x28,2,'US',us(1)),(0x28,4,'CS','MONOCHROME2'),(0x28,8,'IS','1'),(0x28,0x10,'US',us(8)),(0x28,0x11,'US',us(8)),(0x28,0x30,'DS','1\\1'),(0x28,0x100,'US',us(16)),(0x28,0x103,'US',us(0)),(0x28,0x1052,'DS','-1.024e+3'),(0x28,0x1053,'DS','1.0')]
 raw=[0 if i<8 else 2024 if i>=56 else 1054 for i in range(64)]
 data=b''.join(el(*t) for t in tags)+el(0x7fe0,0x10,'OW',struct.pack('<64H',*raw));path=OUT/f'slice-{z}.dcm';path.write_bytes(data);files.append(str(path))
with sync_playwright() as p:
 b=p.chromium.launch(args=['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']);pg=b.new_page(viewport={'width':390,'height':1000});errors=[];pg.on('pageerror',lambda e:errors.append(str(e)))
 pg.goto(BASE);pg.wait_for_function("!!document.getElementById('geometry-export')?.onclick");pg.wait_for_function('!!navigator.serviceWorker.controller');pg.wait_for_timeout(1200)
 pg.evaluate("""async()=>{const db=await new Promise(r=>{const q=indexedDB.open('rrai',2);q.onsuccess=()=>r(q.result)}),tx=db.transaction('studies','readwrite'),st=tx.objectStore('studies');st.clear();const frames=Array.from({length:4},(_,z)=>({kind:'gray',w:8,h:8,data:Float32Array.from({length:64},(_,i)=>(i<8?0:i>=56?2024:1054)-1),seriesUid:'',volumeUnit:'HU',spacing:[1,1],seq:{seriesNumber:3},info:{frames:1,bitsAllocated:16,signed:false,slope:1,intercept:-1,encapsulated:false},geometry:{frameOfReferenceUid:'1.2.3.4',ipp:[0,0,z],iop:[1,0,0,0,1,0]}}));st.put({uid:'1.2.3.7',patient:'SYNTHETIC',modality:'CT',created:1,meta:{patientName:'SYNTHETIC PRIVATE',studyDate:'20261030'},frames,triage:{score:0,priority:'routine',reasons:[]},report:{exam:'Synthetic CT',findings:'Keep physician findings',impression:'Keep physician impression'},measurementFrames:{'1:0':{test:'keep'}},signedBy:'Synthetic Reviewer'});await new Promise(r=>tx.oncomplete=r);db.close();}""")
 pg.reload();pg.wait_for_selector('#worklist tbody tr button');pg.locator('#worklist tbody tr button').first.click();pg.click('#vs-fold');pg.select_option('#preset','brain')
 def gray():return pg.locator('#frame').evaluate("c=>c.getContext('2d').getImageData(2,2,1,1).data[0]")
 assert gray()==255,'legacy truncated intercept reproduces white brain window'
 pg.set_input_files('#files',files[:3]);pg.click('#upload');pg.wait_for_function("document.getElementById('ingest-status').textContent.includes('لم تُعدّل')");assert gray()==255
 pg.locator('#composer-set').evaluate('e=>e.open=true');pg.fill('#rep-findings','Keep latest physician edit');pg.set_input_files('#files',files);pg.click('#upload');pg.wait_for_function("document.getElementById('ingest-status').textContent.includes('تم تحديث')",timeout=30000)
 assert 80<gray()<120,gray()
 result=pg.evaluate("""async()=>{const db=await new Promise(r=>{const q=indexedDB.open('rrai',2);q.onsuccess=()=>r(q.result)}),tx=db.transaction('studies');const rows=await new Promise(r=>{const q=tx.objectStore('studies').getAll();q.onsuccess=()=>r(q.result)});db.close();const s=rows[0];return {count:rows.length,uid:s.uid,series:s.frames[0].seriesUid,intercept:s.frames[0].info.intercept,value:s.frames[0].data[18],report:s.report,measurementFrames:s.measurementFrames,signedBy:s.signedBy};}""")
 assert result['count']==1 and result['uid']=='1.2.3.7' and result['series']=='1.2.3.9'
 assert result['intercept']==-1024 and result['value']==30
 assert result['report']['findings']=='Keep latest physician edit' and result['measurementFrames']=={'1:0':{'test':'keep'}} and result['signedBy']=='Synthetic Reviewer'
 pg.click('#vr-open');pg.wait_for_function("!document.getElementById('vr-controls').hidden");assert not pg.locator('#vr-diagnostic').is_visible();pg.click('#vr-close')
 assert not errors,errors
 print('PASS real synthetic DICOM reimport fixes missing UID/scientific rescale, brain white→gray, preserves one saved study/report/measurements/reviewer, and enables CT 3D; errors []')
 b.close()
