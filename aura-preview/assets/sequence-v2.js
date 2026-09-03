(()=>{
  'use strict';
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  const canvas=$('#sequence');
  if(!canvas) return;
  const ctx=canvas.getContext('2d',{alpha:false,desynchronized:true});
  const cinematic=$('.cinematic');
  const stage=$('#stage');
  const shade=$('#shade');
  const progress=$('#progress');
  const header=$('#header');
  const loader=$('#loader');
  const N=12,COLS=4,FW=360,FH=203;
  let sprite=null,ready=false,target=0,current=0,last=-999,scrollProgress=0;

  function resize(){
    const d=Math.min(window.devicePixelRatio||1,innerWidth<760?1.35:1.55);
    const w=Math.max(1,Math.round(innerWidth*d));
    const h=Math.max(1,Math.round(innerHeight*d));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;last=-999;}
  }

  function drawFrame(context,frame,w,h){
    frame=clamp(Math.round(frame),0,N-1);
    const col=frame%COLS,row=Math.floor(frame/COLS);
    const targetRatio=w/h,sourceRatio=FW/FH;
    let sx=0,sy=0,sw=FW,sh=FH;
    if(targetRatio<sourceRatio){
      sw=FH*targetRatio;
      sx=(FW-sw)*.5;
    }else{
      sh=FW/targetRatio;
      sy=(FH-sh)*.5;
    }
    context.drawImage(sprite,col*FW+sx,row*FH+sy,sw,sh,0,0,w,h);
  }

  function draw(v,force=false){
    if(!ready) return;
    v=clamp(v,0,N-1);
    if(!force&&Math.abs(v-last)<.012) return;
    const a=Math.floor(v),b=Math.min(N-1,a+1),mix=v-a;
    ctx.globalAlpha=1;
    ctx.fillStyle=a>=9?'#f4f1eb':'#080706';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    drawFrame(ctx,a,canvas.width,canvas.height);
    if(b!==a&&mix>.02){ctx.globalAlpha=mix;drawFrame(ctx,b,canvas.width,canvas.height);ctx.globalAlpha=1;}
    last=v;
  }

  function drawThumbs(){
    if(!ready) return;
    $$('.thumb').forEach(t=>{
      const r=t.getBoundingClientRect();
      const d=Math.min(devicePixelRatio||1,1.3);
      t.width=Math.max(1,Math.round(r.width*d));
      t.height=Math.max(1,Math.round(r.height*d));
      const q=t.getContext('2d',{alpha:false});
      q.fillStyle='#111';q.fillRect(0,0,t.width,t.height);
      drawFrame(q,+t.dataset.frame||0,t.width,t.height);
    });
  }

  function updateScroll(){
    if(!cinematic) return;
    const max=Math.max(1,cinematic.offsetHeight-innerHeight);
    const y=clamp(scrollY-cinematic.offsetTop,0,max);
    scrollProgress=y/max;
    target=scrollProgress*(N-1);
    if(progress) progress.style.height=`${scrollProgress*100}%`;
    document.body.classList.toggle('light',scrollProgress>.82);
    if(header) header.classList.toggle('scrolled',scrollY>18);
    const end=cinematic.offsetTop+cinematic.offsetHeight;
    const done=scrollY>=end-innerHeight*.03;
    if(stage){stage.style.opacity=done?'0':'1';stage.style.visibility=done?'hidden':'visible';}
    if(shade) shade.style.opacity=scrollProgress>.8?'.08':'.55';
    $$('.reveal').forEach(e=>{const r=e.getBoundingClientRect();e.classList.toggle('show',r.top<innerHeight*.86&&r.bottom>innerHeight*.1);});
  }

  function loop(){
    const ease=innerWidth<760?.26:.18;
    current+=(target-current)*ease;
    if(Math.abs(target-current)<.006) current=target;
    draw(current);
    requestAnimationFrame(loop);
  }

  function finishLoad(image){
    sprite=image;ready=true;resize();draw(0,true);drawThumbs();updateScroll();
    canvas.classList.add('ready');
    setTimeout(()=>loader&&loader.classList.add('done'),180);
  }

  function loadWithImage(url){
    return new Promise((resolve,reject)=>{
      const im=new Image();
      im.decoding='async';
      im.onload=()=>resolve(im);
      im.onerror=()=>reject(new Error('sprite-image-load-failed'));
      im.src=url;
    });
  }

  async function load(){
    const base64=window.__AURA_MINI||'';
    const dataUrl=window.AURA_SPRITE_URL||(base64?'data:image/webp;base64,'+base64:'');
    if(!dataUrl){console.error('AURA görüntüsü bulunamadı');loader&&loader.classList.add('done');return;}
    try{
      finishLoad(await loadWithImage(dataUrl));
    }catch(firstError){
      try{
        const raw=atob(base64),bytes=new Uint8Array(raw.length);
        for(let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
        const objectUrl=URL.createObjectURL(new Blob([bytes],{type:'image/webp'}));
        const im=await loadWithImage(objectUrl);
        URL.revokeObjectURL(objectUrl);
        finishLoad(im);
      }catch(secondError){
        console.error('AURA animasyonu yüklenemedi',firstError,secondError);
        loader&&loader.classList.add('done');
      }
    }
  }

  addEventListener('resize',()=>{resize();draw(current,true);drawThumbs();updateScroll();});
  addEventListener('scroll',updateScroll,{passive:true});
  resize();updateScroll();load();requestAnimationFrame(loop);
})();
