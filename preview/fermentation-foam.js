// NOTE: This is a build fragment. At runtime it is concatenated AFTER an
// HTML wrapper that defines `SHEET_SRCS` (base64 sprite sheets) and a
// <canvas id="scene">, producing the gitignored local preview file
// `fermentation-preview.html`. The trailing </script></body></html> close
// that wrapper. See conversation history / SPEC for the wrapper layout.
//
// ─────────────────────────────────────────────────────────────────────────────
//  SOURDOUGH FERMENTATION — FOAM PROOF-OF-CONCEPT  (Phase 1: foam only)
//
//  One canvas. Pure black. Deterministic t=0→1 loop. No microbes yet.
//  Gas cells are negative-space cavities; amber gluten FILMS and walls frame
//  them; junctions glow at cross-links. Gas and gluten deform each other.
//  No Math.random() in render — all noise from seed + entity id + t.
// ─────────────────────────────────────────────────────────────────────────────

const ATLAS={ // kept for Phase 2 texture accents; unused in foam-only pass
  yeast:{sheet:'org',x:0.038,y:0.041,w:0.311,h:0.331},
};
const imgs={};
function loadSheets(cb){
  const keys=Object.keys(SHEET_SRCS);let done=0,ok=true;
  for(const k of keys){const img=new Image();
    const fin=()=>{if(++done===keys.length)cb(ok);};
    img.onload=()=>{imgs[k]=img;fin();};img.onerror=()=>{ok=false;fin();};
    img.src=SHEET_SRCS[k];if(img.complete&&img.naturalWidth>0){imgs[k]=img;fin();}}
}

// ── Math ──────────────────────────────────────────────────────────────────────
const TAU=Math.PI*2;
const clamp=(x,a,b)=>x<a?a:x>b?b:x;
const lerp=(a,b,x)=>a+(b-a)*x;
const ss=(a,b,t)=>{const x=clamp((t-a)/(b-a),0,1);return x*x*(3-2*x);};
const hump=(a,b,t)=>{const x=clamp((t-a)/(b-a),0,1);return Math.sin(x*Math.PI);};
const d2=(ax,ay,bx,by)=>(bx-ax)**2+(by-ay)**2;

// ── Deterministic noise ───────────────────────────────────────────────────────
function mulberry32(s){let st=s>>>0;return()=>{st+=0x6D2B79F5;let z=st;z=(z^(z>>>15))*((z|1)>>>0);z^=z+(z^(z>>>7))*(z|61)>>>0;z^=z>>>14;return(z>>>0)/0x100000000;};}
// hash → [0,1), stable, no global state
function hash(i){let x=Math.sin(i*127.1+311.7)*43758.5453;return x-Math.floor(x);}

// ── Delaunay / Voronoi (topology only: shared walls + junctions) ──────────────
function circumcc(ax,ay,bx,by,cx,cy){
  const D=2*(ax*(by-cy)+bx*(cy-ay)+cx*(ay-by));if(Math.abs(D)<1e-10)return null;
  const a2=ax*ax+ay*ay,b2=bx*bx+by*by,c2=cx*cx+cy*cy;
  const ux=(a2*(by-cy)+b2*(cy-ay)+c2*(ay-by))/D,uy=(a2*(cx-bx)+b2*(ax-cx)+c2*(bx-ax))/D;
  return{cx:ux,cy:uy,r2:d2(ax,ay,ux,uy)};
}
function delaunay(pts){
  const n=pts.length;if(n<3)return{tris:[],allPts:[...pts]};
  let mnx=Infinity,mny=Infinity,mxx=-Infinity,mxy=-Infinity;
  for(const[x,y]of pts){mnx=Math.min(mnx,x);mny=Math.min(mny,y);mxx=Math.max(mxx,x);mxy=Math.max(mxy,y);}
  const dm=Math.max(mxx-mnx,mxy-mny)*5,mx=(mnx+mxx)/2,my=(mny+mxy)/2;
  const allPts=[...pts,[mx,my-3*dm],[mx-3*dm,my+2*dm],[mx+3*dm,my+2*dm]];
  let tris=[[n,n+1,n+2]];
  for(let i=0;i<n;i++){
    const[px,py]=allPts[i];const bad=new Set();
    for(let ti=0;ti<tris.length;ti++){const[a,b,c]=tris[ti];const cc=circumcc(...allPts[a],...allPts[b],...allPts[c]);if(cc&&d2(px,py,cc.cx,cc.cy)<=cc.r2+1e-10)bad.add(ti);}
    const edges={};
    for(const ti of bad){const[a,b,c]=tris[ti];for(const[u,v]of[[a,b],[b,c],[c,a]]){const k=u<v?`${u}_${v}`:`${v}_${u}`;edges[k]=(edges[k]||0)+1;}}
    tris=tris.filter((_,ti)=>!bad.has(ti));
    for(const[k,cnt]of Object.entries(edges))if(cnt===1){const[u,v]=k.split('_').map(Number);tris.push([u,v,i]);}
  }
  return{tris:tris.filter(([a,b,c])=>a<n&&b<n&&c<n),allPts};
}
function buildVoronoi(pts){
  const{tris,allPts}=delaunay(pts);const n=pts.length;
  const verts=tris.map(([a,b,c])=>{const cc=circumcc(...allPts[a],...allPts[b],...allPts[c]);return cc?[cc.cx,cc.cy]:[(allPts[a][0]+allPts[b][0]+allPts[c][0])/3,(allPts[a][1]+allPts[b][1]+allPts[c][1])/3];});
  const sT=pts.map(()=>[]);tris.forEach(([a,b,c],ti)=>{sT[a].push(ti);sT[b].push(ti);sT[c].push(ti);});
  const cells=pts.map(([sx,sy],si)=>{const poly=sT[si].map(ti=>verts[ti]);poly.sort((a,b)=>Math.atan2(a[1]-sy,a[0]-sx)-Math.atan2(b[1]-sy,b[0]-sx));return{site:[sx,sy],poly,triIdx:sT[si]};});
  const em={};tris.forEach(([a,b,c],ti)=>{for(const[u,v]of[[a,b],[b,c],[c,a]]){const k=u<v?`${u}_${v}`:`${v}_${u}`;if(!em[k])em[k]={u,v,ts:[]};em[k].ts.push(ti);}});
  const edges=[];for(const{u,v,ts}of Object.values(em))if(u<n&&v<n&&ts.length===2)edges.push({s0:u,s1:v,v0:ts[0],v1:ts[1]});
  // junction → connected wall list
  return{verts,cells,edges};
}

// ── Build foam (once, seeded) ─────────────────────────────────────────────────
let FOAM=null,FOAM_NCELLS=0;
const SEED=0xC0FFEE42;

function buildFoam(W,H){
  const rng=mulberry32(SEED);
  const rr=(a,b)=>a+(b-a)*rng();
  // Gas-cell sites: jittered grid. A frame ring of ghost sites OUTSIDE the
  // canvas bounds every inner cell so the foam tiles the whole frame.
  const COLS=6,ROWS=4,pts=[];
  for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++)
    pts.push([(c+0.5+rr(-0.28,0.28))/COLS*W,(r+0.5+rr(-0.24,0.24))/ROWS*H]);
  const nCells=pts.length;
  for(let i=0;i<14;i++){const a=TAU*i/14;pts.push([W/2+Math.cos(a)*W*0.92,H/2+Math.sin(a)*H*0.92]);}
  const{verts,cells,edges}=buildVoronoi(pts);

  const gasCells=cells.slice(0,nCells).map((cell,i)=>{
    const[sx,sy]=cell.site;
    const vpolar=cell.poly.map(([px,py])=>({ang:Math.atan2(py-sy,px-sx),dist:Math.hypot(px-sx,py-sy)}));
    const rad=vpolar.length?vpolar.reduce((a,v)=>a+v.dist,0)/vpolar.length:30;
    // organic rim: 3 deterministic sine components keyed to id
    const rim=[0,1,2].map(k=>({freq:2+Math.floor(hash(i*7+k*3)*4),amp:0.05+hash(i*11+k)*0.10,phase:hash(i*5+k*2)*TAU}));
    return{
      id:i,site:cell.site,poly:cell.poly,vpolar,rad,
      birthT:rr(0.04,0.34),
      peakF:rr(0.82,1.02),
      peakT:rr(0.40,0.60),
      ruptureT:rr(0.72,0.98),
      rim,
      depth:rng(),                 // 0 = far/blurred, 1 = near/crisp
    };
  });

  // Walls: keep every edge touching at least one inner gas cell (incl. the
  // outer crust between an inner cell and a ghost ring site).
  const walls=edges.filter(e=>e.s0<nCells||e.s1<nCells).map((e,i)=>({
    id:i,s0:e.s0,s1:e.s1,v0:e.v0,v1:e.v1,
    border:(e.s0>=nCells||e.s1>=nCells),
    severT:rr(0.80,1.00),thick:rr(1.2,2.4),
    frayPh:hash(i*13)*TAU,filmPh:hash(i*17)*TAU,
  }));
  FOAM_NCELLS=nCells;

  // junction → adjacent walls (for damage-aware junction glow)
  const jWalls=verts.map(()=>[]);
  walls.forEach(w=>{jWalls[w.v0]?.push(w.id);jWalls[w.v1]?.push(w.id);});

  // a few deep out-of-focus cells for background bokeh depth
  const bokeh=[];
  for(let i=0;i<6;i++)bokeh.push({x:rr(0.1,0.9)*W,y:rr(0.1,0.9)*H,r:rr(60,120),birthT:rr(0.1,0.4),ph:rng()*TAU});

  const allSites=pts;
  return{W,H,gasCells,walls,verts,jWalls,bokeh,allSites,nCells};
}
// inflation lookup that returns 0 for ghost ring cells
function inflOf(idx,inflF){return idx<FOAM_NCELLS?(inflF[idx]||0):0;}

// ── Foam timeline (drive everything from t) ───────────────────────────────────
const structuring=t=>ss(0.16,0.42,t);
const peakness   =t=>ss(0.32,0.54,t)*(1-ss(0.70,0.96,t)*0.95);
const decay      =t=>ss(0.64,1.00,t);

function cellInflate(g,t){
  const grow=ss(g.birthT,g.peakT,t);
  const merge=ss(g.ruptureT,Math.min(g.ruptureT+0.14,1),t); // keeps size, voids merge
  return g.peakF*grow*(1-merge*0.35);
}
function wallDamage(w,t){return ss(w.severT-0.16,w.severT,t)*decay(t);}

// organic bubble outline points: round nucleus → pressed polygon, + rim noise
function bubblePts(g,t,f){
  const[sx,sy]=g.site,m=ss(g.birthT,g.peakT+0.12,t),out=[];
  for(let k=0;k<g.vpolar.length;k++){
    const v=g.vpolar[k];
    let baseR=lerp(g.rad,v.dist,m);
    let nz=0;for(const c of g.rim)nz+=c.amp*Math.sin(c.freq*v.ang+c.phase+TAU*t*0);
    const wob=1+nz*Math.min(m+0.3,1);
    const r=f*baseR*wob;
    out.push([sx+Math.cos(v.ang)*r,sy+Math.sin(v.ang)*r]);
  }
  return out;
}
function blobPath(ctx,pts){
  const n=pts.length;if(n<3)return false;
  ctx.beginPath();ctx.moveTo((pts[n-1][0]+pts[0][0])/2,(pts[n-1][1]+pts[0][1])/2);
  for(let i=0;i<n;i++){const c=pts[i],nx=pts[(i+1)%n];ctx.quadraticCurveTo(c[0],c[1],(c[0]+nx[0])/2,(c[1]+nx[1])/2);}
  ctx.closePath();return true;
}
function wallBow(w,inflF){
  const verts=FOAM.verts,sites=FOAM.allSites;
  const v0=verts[w.v0],v1=verts[w.v1];
  let bx=(v0[0]+v1[0])/2,by=(v0[1]+v1[1])/2;
  const s0=sites[w.s0],s1=sites[w.s1];
  if(s0&&s1){const ddx=s1[0]-s0[0],ddy=s1[1]-s0[1],dl=Math.hypot(ddx,ddy)||1;const bow=(inflOf(w.s0,inflF)-inflOf(w.s1,inflF))*30;bx+=ddx/dl*bow;by+=ddy/dl*bow;}
  return[v0,v1,bx,by];
}

// ── Render ────────────────────────────────────────────────────────────────────
function render(ctx,t){
  const{W,H,gasCells,walls,verts,jWalls,bokeh}=FOAM;
  const P=peakness(t),S=structuring(t),D=decay(t);
  const inflF=gasCells.map(g=>cellInflate(g,t));
  // draw order back→front by depth so near cells sit on top
  const order=gasCells.map((g,i)=>i).sort((a,b)=>gasCells[a].depth-gasCells[b].depth);

  // 1. pure black
  ctx.globalCompositeOperation='source-over';
  ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);

  // 2. deep blurred background bokeh (out-of-focus foam, depth)
  ctx.save();ctx.globalCompositeOperation='lighter';ctx.filter='blur(16px)';
  for(const b of bokeh){
    const f=ss(b.birthT,b.birthT+0.3,t);if(f<0.05)continue;
    const a=0.09*f*(1-D*0.4);
    const g=ctx.createRadialGradient(b.x,b.y,b.r*0.5*f,b.x,b.y,b.r*f);
    g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(0.82,`rgba(150,95,35,${a})`);g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(b.x,b.y,b.r*f,0,TAU);ctx.fill();
  }
  ctx.restore();

  // 3. GLUTEN MASS — the luminous amber body. Each cell paints a film that is
  //    dark in the void centre and bright at the rim; overlapping rims of
  //    neighbouring cells fuse into thick glowing shared walls. This is the
  //    primary beauty: amber walls framing dark cavities.
  //    Each cell's outline is stroked with a thick glowing amber band that
  //    hugs the cavity edge; adjacent cells share an edge, so their strokes
  //    overlap into fat luminous shared walls. Void centres stay black (only a
  //    whisper of fill), so cavities read as negative space framed by amber.
  ctx.save();ctx.globalCompositeOperation='lighter';ctx.lineJoin='round';
  for(const gi of order){
    const g=gasCells[gi],f=inflF[gi];if(f<0.03)continue;
    const pts=bubblePts(g,t,f);if(!blobPath(ctx,pts))continue;
    const dep=lerp(0.5,1,g.depth);
    // Gate by this cell's own inflation: unborn/young cells barely draw walls,
    // so early fermentation reads as shaggy disconnected fragments, not a
    // faint complete diagram. Late decay dims and red-shifts the membrane.
    const born=clamp(f*1.6,0,1);
    const wallA=lerp(0.20,0.72,Math.max(S,P))*dep*(1-D*0.55)*born;
    if(wallA<0.015)continue;
    const rcr=lerp(165,150,D),rcg=lerp(105,60,D),rcb=lerp(42,24,D);
    const bcr=lerp(240,225,D),bcg=lerp(168,95,D),bcb=lerp(70,38,D);
    ctx.fillStyle=`rgba(120,75,30,${wallA*0.10})`;ctx.fill();
    ctx.strokeStyle=`rgba(${rcr|0},${rcg|0},${rcb|0},${wallA*0.34})`;ctx.lineWidth=lerp(22,8,P)*dep;ctx.stroke();
    ctx.strokeStyle=`rgba(205,135,52,${wallA*0.7})`;ctx.lineWidth=lerp(10,4,P)*dep;ctx.stroke();
    ctx.strokeStyle=`rgba(${bcr|0},${bcg|0},${bcb|0},${wallA})`;ctx.lineWidth=lerp(3.2,1.4,P)*dep;ctx.stroke();
  }
  ctx.restore();

  // 5. translucent windowpane sheen across each cavity (membrane catching light)
  ctx.save();ctx.globalCompositeOperation='lighter';
  for(const gi of order){
    const g=gasCells[gi],f=inflF[gi];if(f<0.05)continue;
    const pts=bubblePts(g,t,f);if(!blobPath(ctx,pts))continue;
    ctx.save();ctx.clip();
    const[sx,sy]=g.site,r=Math.max(f*g.rad*1.2,8);
    const sheen=lerp(0.02,0.09,P)*(1-D*0.6)*lerp(0.5,1,g.depth);
    const grd=ctx.createRadialGradient(sx-r*0.25,sy-r*0.25,r*0.2,sx,sy,r);
    grd.addColorStop(0,`rgba(210,150,70,${sheen})`);
    grd.addColorStop(0.6,`rgba(150,95,40,${sheen*0.3})`);
    grd.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=grd;ctx.fillRect(sx-r,sy-r,r*2,r*2);
    ctx.restore();
  }
  ctx.restore();

  // 6. crisp wall strand cores + bright junctions on top
  ctx.save();ctx.globalCompositeOperation='lighter';
  for(const w of walls){
    const dmg=wallDamage(w,t);if(dmg>0.92)continue;
    const[v0,v1,bx,by]=wallBow(w,inflF);
    if(Math.max(v0[0],v1[0])<-40||Math.min(v0[0],v1[0])>W+40)continue;
    if(Math.max(v0[1],v1[1])<-40||Math.min(v0[1],v1[1])>H+40)continue;
    const press=(inflOf(w.s0,inflF)+inflOf(w.s1,inflF))*0.5;
    const tens=clamp(S*0.45+press*0.55,0,1)*(1-dmg);
    // gate by neighbour inflation so early shows only born walls (shaggy)
    const coreA=lerp(0.12,0.40,tens)*(1-dmg*0.85)*(w.border?0.6:1)*clamp(press*2.2,0,1);
    if(coreA<0.02)continue;
    if(dmg>0.5){
      const segs=7;
      for(let s=0;s<segs;s++){
        const gap=0.5+0.5*Math.sin(w.frayPh+s*1.7+TAU*t);
        if(gap<dmg)continue;
        const q=(p,A,B,C)=>lerp(lerp(A,C,p),lerp(C,B,p),p);
        const a0=s/segs,a1=(s+0.7)/segs;
        ctx.strokeStyle=`rgba(225,150,60,${coreA*0.85})`;ctx.lineWidth=w.thick*0.7;
        ctx.beginPath();ctx.moveTo(q(a0,v0[0],v1[0],bx),q(a0,v0[1],v1[1],by));
        ctx.lineTo(q(a1,v0[0],v1[0],bx),q(a1,v0[1],v1[1],by));ctx.stroke();
      }
    }else{
      const grd=ctx.createLinearGradient(v0[0],v0[1],v1[0],v1[1]);
      grd.addColorStop(0,`rgba(205,140,58,${coreA*0.65})`);
      grd.addColorStop(0.5,`rgba(245,180,75,${coreA})`);
      grd.addColorStop(1,`rgba(205,140,58,${coreA*0.65})`);
      ctx.strokeStyle=grd;ctx.lineWidth=w.thick*lerp(1.5,0.9,P);ctx.lineCap='round';
      ctx.beginPath();ctx.moveTo(v0[0],v0[1]);ctx.quadraticCurveTo(bx,by,v1[0],v1[1]);ctx.stroke();
    }
  }
  // junctions
  for(let vi=0;vi<verts.length;vi++){
    const adj=jWalls[vi];if(!adj||!adj.length)continue;
    const[vx,vy]=verts[vi];if(vx<-10||vx>W+10||vy<-10||vy>H+10)continue;
    let dmg=0,allBorder=true,nInfl=0;for(const wid of adj){const ww=walls[wid];dmg=Math.max(dmg,wallDamage(ww,t));if(!ww.border)allBorder=false;nInfl=Math.max(nInfl,inflOf(ww.s0,inflF),inflOf(ww.s1,inflF));}
    if(allBorder)continue;                      // don't light pure-crust corners
    // junction only lights once its surrounding cells inflate (no early diagram)
    const glow=clamp(0.30+P*0.70,0,1)*(1-dmg*0.95)*clamp(nInfl*2.2,0,1);
    if(glow<0.05)continue;
    const cr=lerp(255,235,dmg),cg=lerp(198,92,dmg),cb=lerp(125,40,dmg);
    const r=lerp(3,7,P)*(1-dmg*0.4);
    const grd=ctx.createRadialGradient(vx,vy,0,vx,vy,r*2.4);
    grd.addColorStop(0,`rgba(${cr|0},${cg|0},${cb|0},${glow})`);
    grd.addColorStop(0.5,`rgba(${cr|0},${cg|0},${cb|0},${glow*0.4})`);
    grd.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=grd;ctx.beginPath();ctx.arc(vx,vy,r*2.4,0,TAU);ctx.fill();
  }
  // rim accents + rare cool highlight
  for(const gi of order){
    const g=gasCells[gi],f=inflF[gi];if(f<0.06)continue;
    const pts=bubblePts(g,t,f);if(!blobPath(ctx,pts))continue;
    const rimA=lerp(0.04,0.16,P)*ss(0.05,0.4,f)*(1-D*0.5)*lerp(0.5,1,g.depth);
    if(rimA<0.02)continue;
    ctx.strokeStyle=`rgba(235,165,80,${rimA})`;ctx.lineWidth=lerp(1.8,0.8,P);ctx.stroke();
    if(hash(g.id*23)>0.62){
      ctx.save();ctx.clip();
      const[sx,sy]=g.site,r=f*g.rad*1.1,hx=sx-r*0.42,hy=sy-r*0.42;
      const gg=ctx.createRadialGradient(hx,hy,0,hx,hy,r*0.7);
      gg.addColorStop(0,`rgba(150,205,225,${rimA*0.45})`);gg.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=gg;ctx.fillRect(sx-r,sy-r,r*2,r*2);
      ctx.restore();
    }
  }
  ctx.restore();

  // 7. fray sparks where walls tear
  if(D>0.1){
    ctx.save();ctx.globalCompositeOperation='lighter';
    for(const w of walls){
      const dmg=wallDamage(w,t);if(dmg<0.55)continue;
      const[v0,v1,bx,by]=wallBow(w,inflF);
      const p=0.5+0.4*Math.sin(w.frayPh+TAU*t);
      const q=(pp,A,B,C)=>lerp(lerp(A,C,pp),lerp(C,B,pp),pp);
      const tx=q(p,v0[0],v1[0],bx),ty=q(p,v0[1],v1[1],by);
      const a=(dmg-0.55)*1.4*(0.4+0.4*Math.sin(TAU*t+w.frayPh));
      const g=ctx.createRadialGradient(tx,ty,0,tx,ty,8);
      g.addColorStop(0,`rgba(255,190,90,${clamp(a,0,0.7)})`);g.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=g;ctx.beginPath();ctx.arc(tx,ty,8,0,TAU);ctx.fill();
    }
    ctx.restore();
  }
}

// ── Loop (single canvas, t=0→1) ───────────────────────────────────────────────
const LOOP_SEC=90;
let _last=null,_t=0;
function setup(){
  const c=document.getElementById('scene');if(!c)return;
  const ctx=c.getContext('2d');
  FOAM=buildFoam(c.width,c.height);
  const st=document.getElementById('status');if(st)st.style.display='none';
  window.__ctx=ctx;          // dev hook
  function loop(now){
    if(window.__pause){_last=now;requestAnimationFrame(loop);return;}
    if(_last!==null)_t=(_t+(now-_last)/1000/LOOP_SEC)%1;
    _last=now;
    render(ctx,_t);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}
window.addEventListener('DOMContentLoaded',()=>{loadSheets(()=>setup());});
</script>
</body>
</html>
