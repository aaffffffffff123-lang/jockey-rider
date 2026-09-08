/* ============================================================================
   JOCKEY RIDER — WORLD UPGRADE / DROP-IN ADD-ON
   ---------------------------------------------------------------------------
   사용법:
   1) 이 파일을 index.html 과 같은 폴더에 world-upgrade.js 로 올리고
   2) 기존 index.html 맨 아래, 기존 게임 <script> 다음 / </body> 바로 전에
      <script src="./world-upgrade.js"></script>
      한 줄만 추가.

   기존 물리/장애물/조작 코드는 건드리지 않는다.
   window.__game 으로 노출된 P/H/cx/camera/rider 를 사용해 세계 연출만 덧씌운다.
   ============================================================================ */
(function(){
  "use strict";

  if(!window.THREE || !window.__game){
    console.warn("[world-upgrade] THREE 또는 window.__game 을 찾지 못했습니다.");
    return;
  }

  const THREE = window.THREE;
  const GAME = window.__game;
  const P = GAME.P;
  const H = GAME.H;
  const cx = GAME.cx;
  const camera = GAME.cam;
  const scene = GAME.rider && GAME.rider.parent;
  const app = document.getElementById("app");
  if(!scene || !app) return;

  /* --------------------------------------------------------------------------
     0. 작은 유틸
     -------------------------------------------------------------------------- */
  const CFG={
    warehouseExit:155,
    firstRainStart:285, firstRainEnd:445,
    tunnelStart:505, tunnelEnd:670,
    spiralStart:885, spiralEnd:1165,
    repeatWeatherStart:1180, repeatWeatherEvery:950
  };

  const clamp=(v,a,b)=>v<a?a:(v>b?b:v);
  const lerp=(a,b,t)=>a+(b-a)*t;
  function smooth(t){ t=clamp(t,0,1); return t*t*(3-2*t); }
  function smoother(t){ t=clamp(t,0,1); return t*t*t*(t*(t*6-15)+10); }
  function zone(z,a,b,fade){
    fade=fade||45;
    const on=smoother((z-a)/fade);
    const off=1-smoother((z-(b-fade))/fade);
    return clamp(Math.min(on,off),0,1);
  }
  function roadYaw(z){
    const dz=2.0;
    return Math.atan2(cx(z+dz)-cx(z-dz),dz*2);
  }
  function srgb(c){ return new THREE.Color(c).convertSRGBToLinear(); }
  function lambert(c){ return new THREE.MeshLambertMaterial({color:srgb(c),flatShading:false}); }
  function basic(c,opacity){
    return new THREE.MeshBasicMaterial({
      color:srgb(c),transparent:opacity!==undefined&&opacity<1,
      opacity:opacity===undefined?1:opacity,depthWrite:opacity===undefined||opacity>=1
    });
  }

  const GEO_BOX = new THREE.BoxGeometry(1,1,1);
  const GEO_CYL = new THREE.CylinderGeometry(1,1,1,8);
  function box(parent,mat,sx,sy,sz,x,y,z,rx,ry,rz){
    const m=new THREE.Mesh(GEO_BOX,mat);
    m.scale.set(sx,sy,sz);
    m.position.set(x||0,y||0,z||0);
    m.rotation.set(rx||0,ry||0,rz||0);
    parent.add(m);
    return m;
  }
  function cyl(parent,mat,sx,sy,sz,x,y,z,rx,ry,rz){
    const m=new THREE.Mesh(GEO_CYL,mat);
    m.scale.set(sx,sy,sz);
    m.position.set(x||0,y||0,z||0);
    m.rotation.set(rx||0,ry||0,rz||0);
    parent.add(m);
    return m;
  }
  function roadGroup(parent,z){
    const x=cx(z), g=new THREE.Group();
    g.position.set(x,H(x,z),z);
    g.rotation.y=roadYaw(z);
    parent.add(g);
    return g;
  }

  /* --------------------------------------------------------------------------
     1. 색 / 재질 — 기존 황토색 세계보다 살짝 죽은 공업색
     -------------------------------------------------------------------------- */
  const MAT={
    concrete:lambert(0x8B8984),
    concreteDark:lambert(0x5B5C5A),
    concretePale:lambert(0xA7A39A),
    asphalt:lambert(0x494B4C),
    steel:lambert(0x59636A),
    steelDark:lambert(0x30383D),
    rust:lambert(0x754332),
    rack:lambert(0xA66A2C),
    rackDark:lambert(0x4B4540),
    wall:lambert(0x777A78),
    wallDark:lambert(0x4B5150),
    roof:lambert(0x686C6A),
    dock:lambert(0x292D2F),
    dockEdge:lambert(0xB2AA8F),
    containerA:lambert(0x6A4039),
    containerB:lambert(0x485A62),
    containerC:lambert(0x6A6546),
    window:basic(0x182125,0.95),
    lamp:basic(0xFFD786,0.92),
    emergency:basic(0xD84B35,0.95),
    black:lambert(0x24282A)
  };

  const root=new THREE.Group();
  root.name="WORLD_UPGRADE";
  scene.add(root);
  const warehouseRoot=new THREE.Group(); root.add(warehouseRoot);
  const campusRoot=new THREE.Group(); root.add(campusRoot);
  const tunnelRoot=new THREE.Group(); root.add(tunnelRoot);

  /* --------------------------------------------------------------------------
     2. 시작 구간 — 폐허 물류센터 내부
     -------------------------------------------------------------------------- */
  function addRack(g,side,zOff,broken){
    const x=side*15.4;
    // 너무 정교하게 만들지 않고 실루엣만 봐도 랙으로 읽히는 정도.
    for(const px of[x-1.75,x+1.75]){
      box(g,MAT.rackDark,0.18,5.6,0.18,px,2.8,zOff-2.4,0,0,broken?0.06*side:0);
      box(g,MAT.rackDark,0.18,5.6,0.18,px,2.8,zOff+2.4,0,0,broken?0.06*side:0);
    }
    for(const y of[1.0,2.6,4.2]){
      const shelf=box(g,MAT.rack,3.8,0.15,5.1,x,y,zOff);
      if(broken && y>3) shelf.rotation.z=0.08*side;
    }
  }

  function buildWarehouseInterior(){
    // -25m ~ 145m. 20m 단위로 지형/곡선을 따라가며 내부를 만든다.
    for(let z=-20,idx=0;z<=140;z+=20,idx++){
      const g=roadGroup(warehouseRoot,z);
      // 기존 고속도로 차선 데칼을 가리는 창고 바닥.
      box(g,MAT.asphalt,26.3,0.10,20.6,0,0.055,0);
      // 좌우 외벽 + 천장. 몇 구간은 뜯겨 나간 느낌으로 일부 생략.
      if(idx!==5){
        box(g,MAT.wall,0.50,8.6,20.4,-18.2,4.30,0);
      }
      if(idx!==3){
        box(g,MAT.wallDark,0.50,8.6,20.4,18.2,4.30,0);
      }
      if(idx!==4 && idx!==6){
        box(g,MAT.roof,36.8,0.42,20.4,0,8.55,0);
      }else{
        // 무너진 천장 조각 / 틈.
        box(g,MAT.roof,15.8,0.42,20.4,-10.5,8.48,0,0,0,0.035);
        box(g,MAT.roof,11.0,0.42,20.4,12.5,8.25,0,0,0,-0.08);
      }
      // 횡보 — 큰 FC 천장 구조의 인상을 줌.
      box(g,MAT.steelDark,36.0,0.22,0.28,0,7.72,-8.2,0,0,idx%3===0?0.025:0);
      box(g,MAT.steelDark,36.0,0.22,0.28,0,7.72, 8.2,0,0,idx%4===0?-0.02:0);

      if(idx>=1 && idx<=6){
        addRack(g,-1,-4.5,idx===4);
        addRack(g, 1, 4.5,idx===3);
      }

      // 일부 켜진 천장등 — 완벽하게 균일하지 않게.
      if(idx%3!==1){
        box(g,MAT.lamp,0.22,0.10,5.8,-6.0,8.15,0);
      }
      if(idx%4===0){
        box(g,MAT.lamp,0.22,0.10,4.2,6.5,8.12,3.0);
      }
    }

    // 출고장/셔터처럼 보이는 마지막 파사드. 가운데는 완전히 열어 둔다.
    const exit=roadGroup(warehouseRoot,151);
    box(exit,MAT.concreteDark,7.0,10.2,1.4,-16.6,5.1,0);
    box(exit,MAT.concreteDark,7.0,10.2,1.4, 16.6,5.1,0);
    box(exit,MAT.concrete,26.5,1.7,1.4,0,9.35,0,0,0,0.02);
    // 뜯긴 셔터 조각 두 장.
    box(exit,MAT.steel,5.0,0.18,4.5,-9.7,3.3,0.5,0.10,0.0,0.72);
    box(exit,MAT.steelDark,4.2,0.18,3.4,9.2,2.8,-0.2,-0.12,0.0,-0.62);
    // 출고 도크 범퍼 느낌.
    for(const x of[-11.5,-8.8,8.8,11.5]) box(exit,MAT.black,0.30,1.7,0.48,x,0.85,-0.85);
  }

  /* --------------------------------------------------------------------------
     3. 물류단지 — 외부에 폐허 창고/도크/컨테이너가 계속 보이게
     -------------------------------------------------------------------------- */
  function buildWarehouseBlock(z,side,scale,broken){
    const g=roadGroup(campusRoot,z);
    const sx=23*scale, sy=8.5*scale, sz=38*scale;
    const bx=side*(31+5*scale);
    // 메인 동. 완전히 파괴하지 않고 "버려진 대형 물류센터"로 읽히는 정도.
    box(g,broken?MAT.wallDark:MAT.wall,sx,sy,sz,bx,sy*0.50,0,0,0,broken?0.025*side:0);
    const roof=box(g,MAT.roof,sx+1.0,0.45,sz+1.0,bx,sy+0.18,0);
    if(broken) roof.rotation.z=0.035*side;

    // 도크 도어: 도로 쪽 긴 면에 반복되는 검은 사각형이 물류센터 느낌을 거의 다 만들어준다.
    const innerX=bx-side*(sx*0.5+0.05);
    for(let i=-2;i<=2;i++){
      const dz=i*(sz/6);
      box(g,MAT.dock,0.22,3.2*scale,4.1*scale,innerX,1.65*scale,dz);
      box(g,MAT.dockEdge,0.28,0.22,4.5*scale,innerX-side*0.02,3.38*scale,dz);
    }

    // 창고 벽 상단의 길쭉한 띠 — 특정 회사명 대신 폐허 산업단지의 시각 언어.
    box(g,MAT.window,0.24,0.65,sz*0.52,innerX-side*0.03,sy*0.72,0);

    if(broken){
      // 기울어진 외부 철골 + 바닥 잔해.
      box(g,MAT.steelDark,0.35,7.0,0.35,bx-side*(sx*0.52+2.0),3.0,sz*0.25,0,0,0.40*side);
      for(let i=0;i<4;i++){
        const r=box(g,MAT.concreteDark,1.0+i*0.25,0.55,1.4,innerX-side*(1.5+i),0.35,-sz*0.33+i*1.7);
        r.rotation.set(0.1*i,0.4*i,0.08*i);
      }
    }
  }

  function addContainerStack(z,side){
    const g=roadGroup(campusRoot,z);
    const mats=[MAT.containerA,MAT.containerB,MAT.containerC];
    for(let i=0;i<7;i++){
      const row=i<4?0:1;
      const j=row===0?i:i-4;
      const x=side*(20.5+row*3.1);
      const zz=(j-1.5)*6.5 + row*2.0;
      const y=1.3+row*2.55;
      const c=box(g,mats[i%3],2.45,2.5,6.0,x,y,zz);
      c.rotation.y=(i%2?0.015:-0.012)*side;
      // 문짝/리브 한 줄 정도만 넣어 컨테이너로 읽히게.
      box(c,MAT.steelDark,2.0,0.08,0.09,0,0.55,0.505);
      box(c,MAT.steelDark,2.0,0.08,0.09,0,-0.25,0.505);
    }
  }

  function buildCampus(){
    buildWarehouseBlock(205,-1,1.00,true);
    buildWarehouseBlock(260, 1,0.88,false);
    buildWarehouseBlock(328,-1,0.78,true);
    buildWarehouseBlock(390, 1,1.10,true);
    buildWarehouseBlock(455,-1,0.82,false);
    addContainerStack(185,1);
    addContainerStack(305,1);
    addContainerStack(425,-1);

    // 멀리 보이는 간단한 갠트리/하역 구조. 괴물 구조물이 아니라 물류단지의 잔재 정도.
    const g=roadGroup(campusRoot,430);
    for(const s of[-1,1]){
      box(g,MAT.steelDark,0.55,13.0,0.55,s*34,6.5,0,0,0,s*0.04);
      box(g,MAT.steel,0.35,7.2,0.35,s*24,8.5,0,0,0,-s*0.55);
    }
    box(g,MAT.steelDark,69,0.65,0.65,0,12.8,0,0,0,0.018);
  }

  /* --------------------------------------------------------------------------
     4. 500~670m — 폐허 고속도로 터널
     -------------------------------------------------------------------------- */
  function buildTunnel(){
    // 입구/출구 포털
    for(const z of[505,670]){
      const p=roadGroup(tunnelRoot,z);
      box(p,MAT.concreteDark,2.6,9.1,2.0,-14.7,4.55,0);
      box(p,MAT.concreteDark,2.6,9.1,2.0, 14.7,4.55,0);
      box(p,MAT.concrete,31.8,2.0,2.0,0,8.15,0);
      box(p,MAT.black,25.8,0.65,0.25,0,7.15,-1.05);
    }

    for(let z=515,idx=0;z<=660;z+=20,idx++){
      const g=roadGroup(tunnelRoot,z);
      box(g,MAT.concreteDark,0.82,7.9,20.8,-14.4,3.95,0);
      box(g,MAT.concreteDark,0.82,7.9,20.8, 14.4,3.95,0);
      box(g,MAT.concrete,29.6,0.62,20.8,0,8.0,0);
      // 벽 하단의 오래된 밝은 띠
      box(g,MAT.concretePale,0.16,0.42,19.8,-13.92,2.15,0);
      box(g,MAT.concretePale,0.16,0.42,19.8, 13.92,2.15,0);

      // 조명은 일부만 살아있고 일부는 붉은 비상등.
      if(idx%3!==1) box(g,MAT.lamp,0.28,0.10,4.8,0,7.55,0);
      if(idx===3 || idx===6){
        box(g,MAT.emergency,0.12,0.40,0.40,-13.8,3.3,-6.0);
        box(g,MAT.emergency,0.12,0.40,0.40, 13.8,3.3, 5.0);
      }
      // 몇 구간은 천장 보가 비틀려 있음.
      if(idx===4){
        box(g,MAT.steelDark,28.0,0.28,0.36,0,6.85,3.0,0,0,0.07);
      }
    }
  }

  buildWarehouseInterior();
  buildCampus();
  buildTunnel();

  /* --------------------------------------------------------------------------
     5. 화면 위 분위기 레이어
        - 부서진 달
        - 검은 비구름 / 먼 비 장막
        - 실제 비
        - 900~1160m 나선형 꿈 구간
     -------------------------------------------------------------------------- */
  const fx=document.createElement("canvas");
  fx.id="worldFxCanvas";
  fx.setAttribute("aria-hidden","true");
  Object.assign(fx.style,{
    position:"absolute",inset:"0",width:"100%",height:"100%",
    pointerEvents:"none",zIndex:"2"
  });
  app.appendChild(fx);
  // 날씨 캔버스는 3D 위에, HUD/조작 UI 아래에 둔다.
  ["hud","stick","flash","boostfx","sound","intro","over"].forEach(id=>{
    const el=document.getElementById(id); if(el) el.style.zIndex=(id==="intro"||id==="over")?"20":"10";
  });
  const ctx=fx.getContext("2d",{alpha:true});
  let W=1,Hh=1,DPR=1;
  function resizeFx(){
    DPR=Math.min(window.devicePixelRatio||1,1.5);
    W=Math.max(1,window.innerWidth); Hh=Math.max(1,window.innerHeight);
    fx.width=Math.round(W*DPR); fx.height=Math.round(Hh*DPR);
    fx.style.width=W+"px"; fx.style.height=Hh+"px";
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }
  window.addEventListener("resize",resizeFx,{passive:true});
  window.addEventListener("orientationchange",()=>setTimeout(resizeFx,130),{passive:true});
  resizeFx();

  // 비 입자. 좌표는 0~1 정규화.
  const drops=[];
  let rainSeed=0x1234ABCD;
  function rnd(){
    rainSeed|=0; rainSeed=(rainSeed+0x6D2B79F5)|0;
    let t=rainSeed; t=Math.imul(t^t>>>15,1|t); t^=t+Math.imul(t^t>>>7,61|t);
    return ((t^t>>>14)>>>0)/4294967296;
  }
  for(let i=0;i<240;i++) drops.push({
    x:rnd(),y:rnd(),v:0.55+rnd()*1.25,l:0.010+rnd()*0.025,drift:0.02+rnd()*0.04
  });

  function drawMoon(alpha){
    if(alpha<=0.001) return;
    const r=Math.min(W,Hh)*0.105;
    const x=W*0.78, y=Hh*0.205;
    ctx.save();
    ctx.globalAlpha=alpha;
    const g=ctx.createRadialGradient(x-r*0.30,y-r*0.35,r*0.05,x,y,r);
    g.addColorStop(0,"rgba(255,245,210,0.96)");
    g.addColorStop(0.55,"rgba(224,216,190,0.94)");
    g.addColorStop(1,"rgba(160,155,148,0.86)");
    ctx.fillStyle=g;
    ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();

    // 음영 구덩이
    ctx.fillStyle="rgba(76,72,76,0.15)";
    for(const q of[[.28,-.22,.18],[-.35,.08,.13],[.12,.32,.12],[-.12,-.42,.09]]){
      ctx.beginPath(); ctx.arc(x+q[0]*r,y+q[1]*r,q[2]*r,0,Math.PI*2); ctx.fill();
    }

    // 큰 균열 — 번개처럼 갈라진 선
    ctx.strokeStyle="rgba(54,49,53,0.82)";
    ctx.lineWidth=Math.max(1.4,r*0.024);
    ctx.beginPath();
    ctx.moveTo(x-r*0.18,y-r*0.95);
    ctx.lineTo(x-r*0.05,y-r*0.46);
    ctx.lineTo(x-r*0.24,y-r*0.18);
    ctx.lineTo(x+r*0.03,y+r*0.04);
    ctx.lineTo(x-r*0.08,y+r*0.38);
    ctx.lineTo(x+r*0.19,y+r*0.90);
    ctx.stroke();
    ctx.lineWidth=Math.max(1,r*0.014);
    ctx.beginPath();
    ctx.moveTo(x-r*0.23,y-r*0.18); ctx.lineTo(x-r*0.64,y-r*0.03); ctx.lineTo(x-r*0.82,y+r*0.21);
    ctx.moveTo(x+r*0.03,y+r*0.04); ctx.lineTo(x+r*0.44,y-r*0.11); ctx.lineTo(x+r*0.63,y-r*0.36);
    ctx.moveTo(x-r*0.08,y+r*0.38); ctx.lineTo(x-r*0.43,y+r*0.63);
    ctx.stroke();

    // 떨어져 나온 파편들
    ctx.fillStyle="rgba(194,188,171,0.88)";
    ctx.beginPath();
    ctx.moveTo(x+r*1.05,y-r*0.47); ctx.lineTo(x+r*1.28,y-r*0.36); ctx.lineTo(x+r*1.18,y-r*0.13); ctx.lineTo(x+r*0.98,y-r*0.23); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x-r*1.04,y+r*0.62); ctx.lineTo(x-r*1.28,y+r*0.76); ctx.lineTo(x-r*1.15,y+r*0.95); ctx.lineTo(x-r*0.91,y+r*0.82); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(x+r*0.72,y+r*1.10,r*0.12,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }

  function drawClouds(storm,t){
    if(storm<=0.002) return;
    ctx.save();
    ctx.globalAlpha=0.10+0.38*storm;
    ctx.fillStyle="rgba(37,44,48,0.92)";
    const baseY=Hh*(0.11+0.035*Math.sin(t*0.09));
    for(let i=0;i<12;i++){
      const x=((i*0.113 + t*0.0018*(i%2?1:-1))%1.25-0.12)*W;
      const y=baseY + Math.sin(i*1.7+t*0.13)*Hh*0.06;
      const rw=W*(0.13+0.035*(i%4));
      const rh=Hh*(0.07+0.018*(i%3));
      ctx.beginPath(); ctx.ellipse(x,y,rw,rh,0,0,Math.PI*2); ctx.fill();
    }
    // 한쪽 지평선에만 박혀 있는 먼 '검은 비 기둥'. 설명 안 되는 기상현상.
    const gx=W*0.16, top=Hh*0.26, bot=Hh*0.54;
    const rg=ctx.createLinearGradient(0,top,0,bot);
    rg.addColorStop(0,"rgba(28,34,39,0.48)"); rg.addColorStop(1,"rgba(45,49,52,0)");
    ctx.fillStyle=rg;
    ctx.beginPath();
    ctx.moveTo(gx-W*0.075,top); ctx.lineTo(gx+W*0.055,top); ctx.lineTo(gx+W*0.12,bot); ctx.lineTo(gx-W*0.11,bot); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawRain(storm,dt){
    if(storm<=0.015) return;
    ctx.save();
    ctx.strokeStyle=`rgba(206,220,224,${0.18+0.48*storm})`;
    ctx.lineWidth=Math.max(0.7,1.0*DPR/DPR);
    const count=Math.floor(45+storm*190);
    for(let i=0;i<count;i++){
      const d=drops[i];
      d.y+=d.v*dt*(0.7+storm*1.4);
      d.x-=d.drift*dt;
      if(d.y>1.08){ d.y=-0.05-rnd()*0.25; d.x=rnd()*1.12; }
      if(d.x<-0.08) d.x=1.05;
      const x=d.x*W,y=d.y*Hh,len=d.l*Hh*(0.8+storm*1.8);
      ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x-len*0.20,y+len); ctx.stroke();
    }
    ctx.restore();
  }

  function drawSpiral(amount,t,z){
    if(amount<=0.002) return;
    const cx0=W*0.50, cy0=Hh*0.485;
    const R=Math.max(W,Hh)*(0.15+0.48*amount);
    const spin=t*0.42+z*0.006;
    ctx.save();
    // 전경을 덮지 않도록 지평선 부근~하늘만 제한.
    ctx.beginPath(); ctx.rect(0,0,W,Hh*0.70); ctx.clip();

    // 중심부가 살짝 꺼지는 느낌.
    const vg=ctx.createRadialGradient(cx0,cy0,4,cx0,cy0,R*0.95);
    vg.addColorStop(0,`rgba(41,26,49,${0.32*amount})`);
    vg.addColorStop(0.38,`rgba(76,45,72,${0.15*amount})`);
    vg.addColorStop(1,"rgba(0,0,0,0)");
    ctx.fillStyle=vg; ctx.fillRect(0,0,W,Hh*0.72);

    for(let arm=0;arm<5;arm++){
      ctx.beginPath();
      for(let i=0;i<=260;i++){
        const a=i/260*Math.PI*5.6;
        const rr=(i/260)*R;
        const ang=a+spin+arm*(Math.PI*2/5);
        const wob=1+0.055*Math.sin(a*3.0+t*0.7+arm);
        const x=cx0+Math.cos(ang)*rr*wob;
        const y=cy0+Math.sin(ang)*rr*0.56*wob;
        if(i===0)ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.strokeStyle=`rgba(${arm%2?58:111},${arm%2?47:68},${arm%2?70:101},${0.13+0.22*amount})`;
      ctx.lineWidth=(1.0+amount*5.5)*(arm===0?1.35:1);
      ctx.stroke();
    }

    // 비현실적으로 휘어진 얇은 원호 몇 개
    for(let k=1;k<=5;k++){
      ctx.beginPath();
      ctx.ellipse(cx0,cy0,R*(k/6),R*(k/6)*0.52,spin*0.18+k*0.2,0,Math.PI*2);
      ctx.strokeStyle=`rgba(198,153,151,${0.035+0.07*amount})`;
      ctx.lineWidth=1.0+amount*1.5; ctx.stroke();
    }
    ctx.restore();
  }

  /* --------------------------------------------------------------------------
     6. 날씨/조명/안개
     -------------------------------------------------------------------------- */
  const baseFog=scene.fog ? {
    color:scene.fog.color.clone(),near:scene.fog.near,far:scene.fog.far
  } : null;
  const stormFog=srgb(0x777C7B);
  const tunnelFog=srgb(0x42494A);
  const baseLights=[];
  scene.traverse(o=>{ if(o.isLight) baseLights.push({o:o,i:o.intensity}); });

  let weatherAudio=null;
  function ensureWeatherAudio(){
    if(weatherAudio) return weatherAudio;
    let ac=null, master=null;
    try{ ac=GAME.ctx&&GAME.ctx(); master=GAME.master&&GAME.master(); }catch(e){}
    if(!ac || !master) return null;
    try{
      const len=Math.max(1,Math.floor(ac.sampleRate));
      const buf=ac.createBuffer(1,len,ac.sampleRate), d=buf.getChannelData(0);
      for(let i=0;i<len;i++) d[i]=Math.random()*2-1;
      const src=ac.createBufferSource(); src.buffer=buf; src.loop=true;
      const bp=ac.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=5200; bp.Q.value=0.55;
      const rainG=ac.createGain(); rainG.gain.value=0;
      src.connect(bp); bp.connect(rainG); rainG.connect(master); src.start();

      const hum=ac.createOscillator(); hum.type="sine"; hum.frequency.value=43;
      const humG=ac.createGain(); humG.gain.value=0; hum.connect(humG); humG.connect(master); hum.start();
      weatherAudio={ac:ac,rain:rainG,hum:humG};
      return weatherAudio;
    }catch(e){ return null; }
  }

  let flash=0, nextFlash=4.5;
  let suppressTick=0;
  function suppressWarehouseTraffic(dt,z){
    // 원본 난이도 생성기가 60m 이후부터 차/버스를 놓기 때문에,
    // 시작 FC 내부만큼은 랜덤 차량/잔해를 감춰 물류센터 실루엣을 보존한다.
    if(z>CFG.warehouseExit+35) return;
    suppressTick-=dt; if(suppressTick>0) return; suppressTick=0.22;
    scene.traverse(o=>{
      if(!o || !o.userData || !Array.isArray(o.userData.hits)) return;
      const oz=o.position && o.position.z;
      if(typeof oz==="number" && oz>-45 && oz<CFG.warehouseExit+8) o.visible=false;
    });
  }

  let last=performance.now();
  function worldFrame(now){
    requestAnimationFrame(worldFrame);
    const dt=Math.min(0.05,Math.max(0,(now-last)/1000)); last=now;
    const t=now/1000;
    const z=P.z||0;

    // 초반 첫 소나기 + 이후 반복되는 불규칙 기상.
    let storm=zone(z,CFG.firstRainStart,CFG.firstRainEnd,55);
    if(z>CFG.repeatWeatherStart){
      const m=((z-CFG.repeatWeatherStart)%CFG.repeatWeatherEvery+CFG.repeatWeatherEvery)%CFG.repeatWeatherEvery;
      storm=Math.max(storm,zone(m,220,405,55)*0.90);
    }
    // 터널 전후에 약간의 먹구름 잔향.
    const tunnel=zone(z,CFG.tunnelStart-5,CFG.tunnelEnd+10,22);
    const spiral=zone(z,CFG.spiralStart,CFG.spiralEnd,75);
    suppressWarehouseTraffic(dt,z);

    // 창고 안에서는 달/하늘 오버레이가 지붕 위로 튀어나오지 않게 숨긴다.
    const outside=smoother((z-118)/60);
    const moonAlpha=outside*(1-0.72*storm)*(1-0.98*tunnel);

    ctx.clearRect(0,0,W,Hh);

    // 전체 색온도 변화: 비 올 때는 갑자기 세상이 싸늘해진다.
    if(storm>0.001 || tunnel>0.001 || spiral>0.001){
      const a=0.17*storm+0.22*tunnel+0.06*spiral;
      ctx.fillStyle=`rgba(28,38,43,${clamp(a,0,0.34)})`;
      ctx.fillRect(0,0,W,Hh);
    }

    drawMoon(moonAlpha);
    drawClouds(storm,t);
    drawSpiral(spiral,t,z);
    drawRain(storm,dt);

    // 번개는 자주 치지 않는다. '가끔 이상하게 밝아지는' 정도.
    if(storm>0.60){
      nextFlash-=dt*storm;
      if(nextFlash<=0){ flash=0.52+Math.random()*0.25; nextFlash=5.0+Math.random()*8.0; }
    }else nextFlash=Math.min(nextFlash,4.0);
    if(flash>0){
      ctx.fillStyle=`rgba(225,235,238,${flash*0.42})`; ctx.fillRect(0,0,W,Hh);
      flash=Math.max(0,flash-dt*3.8);
    }

    // 실제 3D 안개도 같이 바뀌어 건물/차량까지 날씨에 묻히게 한다.
    if(baseFog && scene.fog){
      const fa=clamp(storm*0.72+tunnel*0.88+spiral*0.18,0,1);
      scene.fog.color.copy(baseFog.color);
      if(tunnel>storm) scene.fog.color.lerp(tunnelFog,fa);
      else scene.fog.color.lerp(stormFog,fa);
      scene.fog.near=lerp(baseFog.near,48,storm*0.72);
      scene.fog.near=lerp(scene.fog.near,28,tunnel*0.90);
      scene.fog.far=lerp(baseFog.far,190,storm*0.78);
      scene.fog.far=lerp(scene.fog.far,115,tunnel*0.92);
    }

    const lightMul=clamp(1-storm*0.48-tunnel*0.58-spiral*0.10,0.28,1);
    for(const q of baseLights) q.o.intensity=q.i*lightMul;

    // 합성 비 소리 + 터널 저음. 원래 게임 오디오는 그대로 두고 얇게 추가만 한다.
    if((storm>0.03||tunnel>0.03) && GAME.ctx && GAME.ctx()) ensureWeatherAudio();
    if(weatherAudio){
      const at=weatherAudio.ac.currentTime;
      weatherAudio.rain.gain.setTargetAtTime(storm*0.055,at,0.18);
      weatherAudio.hum.gain.setTargetAtTime(tunnel*0.028,at,0.22);
    }
  }
  requestAnimationFrame(worldFrame);

  // 디버깅/튜닝용. 콘솔에서 window.__worldUpgrade 로 숨기거나 확인할 수 있음.
  window.__worldUpgrade={
    cfg:CFG,root:root,warehouse:warehouseRoot,campus:campusRoot,tunnel:tunnelRoot,canvas:fx,
    hide:function(){root.visible=false;fx.style.display="none";},
    show:function(){root.visible=true;fx.style.display="block";}
  };
})();
