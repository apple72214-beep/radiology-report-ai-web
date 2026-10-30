"""Synthetic paired front/back slabs: test first-hit occlusion, not skull quality."""
import os
from playwright.sync_api import sync_playwright
BASE=os.getenv('BASE','http://127.0.0.1:8902/standalone.html').rsplit('/',1)[0]
with sync_playwright() as p:
 b=p.chromium.launch(args=['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--enable-webgl'])
 pg=b.new_page();errors=[];pg.on('pageerror',lambda e:errors.append(str(e)));pg.goto(BASE+'/ui.v155.html')
 result=pg.evaluate("""async()=>{
 const {createVolumeRenderer}=await import('./mpr.v155.js');const c=document.createElement('canvas');c.width=c.height=128;document.body.append(c);
 async function render(back,surface,opacity=.1,threshold=200,cut=0){
  const data=new Float32Array(32**3);for(let z=0;z<32;z++)for(let y=0;y<32;y++)for(let x=0;x<32;x++){let hu=-1000;if(x>5&&x<26&&y>5&&y<26){if(z>=24&&z<=26)hu=1200;else if(z>=5&&z<=8)hu=back;}data[z*1024+y*32+x]=(hu+1024)/5120;}
  const before=new Float32Array(data);const r=createVolumeRenderer(c,{nx:32,ny:32,nz:32,box:[1,1,1],data,encoding:'float16-normalized',quality:'high'});r.update({yaw:0,pitch:0,threshold,cut,surface,opacity});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const g=c.getContext('webgl2'),pixels=new Uint8Array(128*128*4);g.readPixels(0,0,128,128,g.RGBA,g.UNSIGNED_BYTE,pixels);const error=g.getError();r.dispose();if(error)throw Error('GL '+error);if(!data.every((v,i)=>v===before[i]))throw Error('source changed');return Array.from(pixels);
 }
 const a=await render(600,1),b=await render(1800,1),solid=await render(1800,1,3),v=await render(600,0),w=await render(1800,0),blank=await render(1800,1,.1,2000),clipped=await render(1800,1,.1,200,.9);
 const rgb=p=>p.filter((v,i)=>i%4!==3),sum=p=>rgb(p).reduce((a,b)=>a+b,0);
 return {opaqueEqual:a.every((v,i)=>v===b[i]),opacityIgnored:b.every((v,i)=>v===solid[i]),volumeDifferent:v.some((x,i)=>x!==w[i]),surfaceSum:sum(a),blank:sum(blank),clipped:sum(clipped)};
 }""")
 assert result['opaqueEqual'] and result['opacityIgnored'] and result['volumeDifferent'] and result['surfaceSum']>0 and result['blank']==0 and result['clipped']==0,result
 assert not errors,errors
 print('PASS real R16F first-hit opaque occlusion: back slab changes cannot affect surface; volume still responds, surface ignores opacity, threshold/clipping work, source unchanged, dispose/error0',result)
 b.close()
