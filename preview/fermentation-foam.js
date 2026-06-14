// NOTE: This is a build fragment. At runtime it is concatenated AFTER an
// HTML wrapper that defines `SHEET_SRCS` (base64 sprite sheets) and a
// <canvas id="scene">, producing the gitignored local preview file
// `fermentation-preview.html`. The trailing </script></body></html> close
// that wrapper. See conversation history / SPEC for the wrapper layout.
//
// ─────────────────────────────────────────────────────────────────────────────
//  SOURDOUGH FERMENTATION — FOAM + MICROBES  (Phase 1+2)
//
//  One canvas. Pure black. Deterministic t=0→1 loop.
//  Gas cells are negative-space cavities; amber gluten FILMS and walls frame
//  them; junctions glow at cross-links. Gas and gluten deform each other.
//  Phase 2: embedded yeast (amber ovoids) and LAB (violet capsule chains)
//  appear along gluten walls, never floating in open voids.
//  No Math.random() in render — all noise from seed + entity id + t.
// ─────────────────────────────────────────────────────────────────────────────

const ATLAS={
  yeast:{sheet:'org',x:0.038,y:0.041,w:0.311,h:0.331},
};
const imgs={};
function loadSheets(cb){
  const keys=Object.keys(SHEET_SRCS);let done=0,ok=true;
  if(keys.length===0){cb(true);return;}
  for(const k of keys){const img=new Image();
    const fin=()=>{if(++done===keys.length)cb(ok);};
    img.onload=()=>{imgs[k]=img;fin();};img.onerror=()=>{ok=false;fin();};
    img.src=SHEET_SRCS[k];if(img.complete&&img.naturalWidth>0){imgs[k]=img;fin();}}
}

const TAU=Math.PI*2;
const clamp=(x,a,b)=>x<a?a:x>b?b:x;
const lerp=(a,b,x)=>a+(b-a)*x;
const ss=(a,b,t)=>{const x=clamp((t-a)/(b-a),0,1);return x*x*(3-2*x);};
const hump=(a,b,t)=>{const x=clamp((t-a)/(b-a),0,1);return Math.sin(x*Math.PI);};
const d2=(ax,ay,bx,by)=>(bx-ax)**2+(by-ay)**2;

function mulberry32(s){let st=s>>>0;return()=>{st+=0x6D2B79F5;let z=st;z=(z^(z>>>15))*((z|1)>>>0);z^=z+(z^(z>>>7))*(z|61)>>>0;z^=z>>>14;return(z>>>0)/0x100000000;};}
function hash(i){let x=Math.sin(i*127.1+311.7)*43758.5453;return x-Math.floor(x);}

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
  return{verts,cells,edges};
}

let FOAM=null,FOAM_NCELLS=0;
const SEED=0xC0FFEE42;

// ── Phase 1 completion: early fibrils ──────────────────────────────────────
function buildFibrils(W,H,rng,rr){
  const fibrils=[];
  for(let i=0;i<38;i++){
    fibrils.push({
      x:rr(0.04,0.96)*W,
      y:rr(0.04,0.96)*H,
      len:rr(18,55),
      ang:rng()*TAU,
      wfreq:rr(2,5),
      wamp:rr(0.08,0.22),
      wph:rng()*TAU,
      birthT:rr(0.00,0.10),
      dep:rng(),
    });
  }
  return fibrils;
}

function drawFibrils(ctx,fibrils,t){
  ctx.globalCompositeOperation='lighter';
  for(const f of fibrils){
    const alpha=ss(f.birthT,f.birthT+0.08,t)*(1-ss(0.06,0.26,t));
    if(alpha<0.01)continue;
    ctx.strokeStyle=`rgba(145,90,32,${alpha})`;
    ctx.lineWidth=0.8+f.dep*0.9;
    ctx.lineCap='round';
    ctx.lineJoin='round';
    const segs=12;
    ctx.beginPath();
    for(let s=0;s<=segs;s++){
      const frac=s/segs;
      const along=frac*f.len-f.len/2;
      const perp=Math.sin(frac*TAU*f.wfreq+f.wph)*f.wamp*f.len*0.18;
      const px=f.x+Math.cos(f.ang)*along-Math.sin(f.ang)*perp;
      const py=f.y+Math.sin(f.ang)*along+Math.cos(f.ang)*perp;
      if(s===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
    }
    ctx.stroke();
  }
}

// ── Phase 2: Yeast cells ───────────────────────────────────────────────────
function buildYeasts(gasCells,verts,rng,rr){
  const sorted=[...gasCells].sort((a,b)=>b.peakF-a.peakF);
  const picked=sorted.slice(0,4);
  return picked.map((cell,i)=>{
    const vIdx=cell.triIdx[Math.floor(rng()*cell.triIdx.length)];
    const vp=verts[vIdx]||cell.site;
    const frac=rr(0.40,0.60);
    const cx=cell.site[0]+(vp[0]-cell.site[0])*frac;
    const cy=cell.site[1]+(vp[1]-cell.site[1])*frac;
    const vacAngle=rng()*TAU;
    const vacDist=rr(1.5,3.0);
    return{
      id:i,
      cx,cy,
      rx:rr(8,13),
      ry:rr(6,10),
      ang:rng()*TAU,
      depth:rng(),
      hostCell:cell,
      budDir:rng()*TAU,
      budStartT:cell.birthT+0.12+rng()*0.15,
      vacuoleOff:[Math.cos(vacAngle)*vacDist,Math.sin(vacAngle)*vacDist],
      vacuoleR:rr(2.5,4),
    };
  });
}

function drawYeasts(ctx,yeasts,gasCells,inflF,t){
  for(const y of yeasts){
    const hc=y.hostCell;
    const hostAlpha=ss(hc.birthT+0.08,hc.birthT+0.25,t)*(1-ss(0.78,0.95,t));
    if(hostAlpha<0.04)continue;

    // Breathing scale
    const breath=Math.sin(t*TAU*2.8+y.id*1.7);
    const rx=y.rx+1.2*breath;
    const ry=y.ry-0.8*breath;

    ctx.save();
    ctx.translate(y.cx,y.cy);
    ctx.rotate(y.ang);

    // 1. Base membrane glow
    ctx.globalCompositeOperation='lighter';
    ctx.beginPath();
    ctx.ellipse(0,0,rx,ry,0,0,TAU);
    ctx.fillStyle=`rgba(140,85,28,${hostAlpha*0.8})`;
    ctx.fill();

    // 2. Outer membrane stroke
    ctx.strokeStyle=`rgba(215,148,55,${hostAlpha*0.95})`;
    ctx.lineWidth=1.8;
    ctx.stroke();

    // 3. Inner cytoplasm gradient (clipped)
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0,0,rx,ry,0,0,TAU);
    ctx.clip();
    const cg=ctx.createRadialGradient(0,0,0,0,0,Math.max(rx,ry));
    cg.addColorStop(0,`rgba(180,115,40,${hostAlpha*0.5})`);
    cg.addColorStop(1,`rgba(0,0,0,0)`);
    ctx.fillStyle=cg;
    ctx.beginPath();
    ctx.ellipse(0,0,rx,ry,0,0,TAU);
    ctx.fill();
    ctx.restore();

    ctx.rotate(-y.ang);

    // 4. Vacuole
    const vx=y.vacuoleOff[0],vy=y.vacuoleOff[1];
    ctx.globalCompositeOperation='source-over';
    ctx.beginPath();
    ctx.arc(vx,vy,y.vacuoleR,0,TAU);
    ctx.fillStyle=`rgba(0,0,0,${hostAlpha*0.7})`;
    ctx.fill();
    ctx.strokeStyle=`rgba(100,65,20,${hostAlpha*0.4})`;
    ctx.lineWidth=0.7;
    ctx.stroke();

    ctx.restore();

    // 5. Bud
    const budP=ss(y.budStartT,y.budStartT+0.16,t);
    if(budP>0.02){
      const budR=budP*rx*0.72;
      const budSep=ss(y.budStartT+0.22,y.budStartT+0.34,t);
      const bdx=y.cx+Math.cos(y.budDir)*(rx+budR*(1-budSep*0.35));
      const bdy=y.cy+Math.sin(y.budDir)*(rx+budR*(1-budSep*0.35));

      ctx.globalCompositeOperation='lighter';
      ctx.save();
      ctx.translate(bdx,bdy);
      ctx.beginPath();
      ctx.ellipse(0,0,budR,budR*0.85,y.ang,0,TAU);
      ctx.fillStyle=`rgba(140,85,28,${hostAlpha*0.8})`;
      ctx.fill();
      ctx.strokeStyle=`rgba(215,148,55,${hostAlpha*0.95})`;
      ctx.lineWidth=1.8;
      ctx.stroke();
      ctx.restore();

      // Cytoplasmic bridge
      if(budP>0.3&&budSep<0.7){
        ctx.beginPath();
        ctx.moveTo(y.cx+Math.cos(y.budDir)*rx*0.8,y.cy+Math.sin(y.budDir)*rx*0.8);
        ctx.lineTo(bdx-Math.cos(y.budDir)*budR*0.6,bdy-Math.sin(y.budDir)*budR*0.6);
        ctx.strokeStyle=`rgba(200,130,45,${hostAlpha*0.6})`;
        ctx.lineWidth=1.5;
        ctx.stroke();
      }
    }

    // 6. CO2 nucleation dots
    if(budP>0.5){
      const numDots=3;
      for(let di=0;di<numDots;di++){
        const dang=hash(y.id*31+di)*TAU;
        const ddist=hash(y.id*17+di)*rx*1.4;
        const dx=y.cx+Math.cos(dang)*ddist;
        const dy=y.cy+Math.sin(dang)*ddist;
        const nucA=(budP-0.5)*2*hostAlpha*0.7*clamp(0.5+0.5*Math.sin(t*TAU*6+y.id*2.3+di*1.1),0,1);
        if(nucA<0.02)continue;
        const ng=ctx.createRadialGradient(dx,dy,0,dx,dy,3);
        ng.addColorStop(0,`rgba(200,185,120,${nucA})`);
        ng.addColorStop(1,`rgba(200,185,120,0)`);
        ctx.globalCompositeOperation='lighter';
        ctx.beginPath();
        ctx.arc(dx,dy,3,0,TAU);
        ctx.fillStyle=ng;
        ctx.fill();
      }
    }
  }
}

// ── Phase 2: LAB bacteria ──────────────────────────────────────────────────
function buildLAB(walls,verts,nCells,rng,rr){
  const interior=walls.filter(w=>!w.border&&w.s0<nCells&&w.s1<nCells);
  const chains=[];
  let chainId=0;
  for(let i=0;i<interior.length&&chains.length<10;i++){
    if(rng()<0.45)continue; // spread out
    const w=interior[i];
    const v0=verts[w.v0],v1=verts[w.v1];
    if(!v0||!v1)continue;
    const mx=(v0[0]+v1[0])/2,my=(v0[1]+v1[1])/2;
    const wallAng=Math.atan2(v1[1]-v0[1],v1[0]-v0[0]);
    const chainLen=2+Math.floor(rng()*4);
    const rodLen=rr(9,14),rodW=rr(3.5,5.5);
    const perpOff=(rng()-0.5)*6;
    const perpAng=wallAng+Math.PI/2;
    const ocx=mx+Math.cos(perpAng)*perpOff;
    const ocy=my+Math.sin(perpAng)*perpOff;
    const rods=[];
    for(let ri=0;ri<chainLen;ri++){
      const along=(ri-(chainLen-1)/2)*rodLen*1.05;
      const angJit=(rng()-0.5)*0.18;
      rods.push({
        cx:ocx+Math.cos(wallAng)*along,
        cy:ocy+Math.sin(wallAng)*along,
        ang:wallAng+angJit,
        len:rodLen,
        wid:rodW,
        posInChain:ri,
      });
    }
    chains.push({
      id:chainId++,
      rods,
      chainLen,
      wigPh:rng()*TAU,
      wigFreq:rr(1.5,2.8),
      depth:rng(),
      hostWall:w,
      bornT:rr(0.12,0.38),
    });
  }
  return chains;
}

function drawLAB(ctx,labChains,t){
  for(const chain of labChains){
    const labA=ss(chain.bornT,chain.bornT+0.12,t)*(1-ss(0.82,0.96,t));
    if(labA<0.03)continue;

    for(let ri=0;ri<chain.rods.length;ri++){
      const rod=chain.rods[ri];
      const rodAng=rod.ang+0.08*Math.sin(t*TAU*chain.wigFreq+chain.wigPh+rod.posInChain*0.9);
      const ex=Math.cos(rodAng)*rod.len/2;
      const ey=Math.sin(rodAng)*rod.len/2;
      const x0=rod.cx-ex,y0=rod.cy-ey;
      const x1=rod.cx+ex,y1=rod.cy+ey;

      // Outer capsule
      ctx.globalCompositeOperation='lighter';
      ctx.beginPath();
      ctx.moveTo(x0,y0);
      ctx.lineTo(x1,y1);
      ctx.strokeStyle=`rgba(110,65,185,${labA*0.85})`;
      ctx.lineWidth=rod.wid;
      ctx.lineCap='round';
      ctx.stroke();

      // Inner core
      ctx.beginPath();
      ctx.moveTo(x0,y0);
      ctx.lineTo(x1,y1);
      ctx.strokeStyle=`rgba(175,125,255,${labA*0.55})`;
      ctx.lineWidth=rod.wid*0.45;
      ctx.stroke();

      // Pole bright spots
      for(const[px,py] of [[x0,y0],[x1,y1]]){
        const pg=ctx.createRadialGradient(px,py,0,px,py,3);
        pg.addColorStop(0,`rgba(200,160,255,${labA*0.7})`);
        pg.addColorStop(1,`rgba(200,160,255,0)`);
        ctx.beginPath();
        ctx.arc(px,py,3,0,TAU);
        ctx.fillStyle=pg;
        ctx.fill();
      }

      // Septa between adjacent rods
      if(ri<chain.rods.length-1){
        const next=chain.rods[ri+1];
        const jx=(rod.cx+next.cx)/2,jy=(rod.cy+next.cy)/2;
        // Draw perpendicular line at junction
        const perpAng=rodAng+Math.PI/2;
        const sepLen=rod.wid*0.7;
        ctx.beginPath();
        ctx.moveTo(jx-Math.cos(perpAng)*sepLen,jy-Math.sin(perpAng)*sepLen);
        ctx.lineTo(jx+Math.cos(perpAng)*sepLen,jy+Math.sin(perpAng)*sepLen);
        ctx.strokeStyle=`rgba(140,90,210,${labA*0.65})`;
        ctx.lineWidth=0.9;
        ctx.lineCap='butt';
        ctx.stroke();
      }
    }

    // Local acid glow for longer chains
    if(chain.chainLen>=3){
      const firstRod=chain.rods[0];
      const lastRod=chain.rods[chain.rods.length-1];
      const mcx=(firstRod.cx+lastRod.cx)/2;
      const mcy=(firstRod.cy+lastRod.cy)/2;
      const glowR=chain.chainLen*firstRod.len*0.6;
      const ag=ctx.createRadialGradient(mcx,mcy,0,mcx,mcy,glowR);
      ag.addColorStop(0,`rgba(110,60,200,${labA*0.06})`);
      ag.addColorStop(1,`rgba(110,60,200,0)`);
      ctx.globalCompositeOperation='lighter';
      ctx.beginPath();
      ctx.arc(mcx,mcy,glowR,0,TAU);
      ctx.fillStyle=ag;
      ctx.fill();
    }
  }
}

function buildMicrobes(nCells,gasCells,walls,verts,rng,rr){
  const yeasts=buildYeasts(gasCells,verts,rng,rr);
  const labChains=buildLAB(walls,verts,nCells,rng,rr);
  return{yeasts,labChains};
}

function buildFoam(W,H){
  const rng=mulberry32(SEED);
  const rr=(a,b)=>a+(b-a)*rng();
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
    const rim=[0,1,2].map(k=>({freq:2+Math.floor(hash(i*7+k*3)*4),amp:0.05+hash(i*11+k)*0.10,phase:hash(i*5+k*2)*TAU}));
    return{
      id:i,site:cell.site,poly:cell.poly,vpolar,rad,triIdx:cell.triIdx,
      birthT:rr(0.04,0.34),
      peakF:rr(0.82,1.02),
      peakT:rr(0.40,0.60),
      ruptureT:rr(0.72,0.98),
      rim,depth:rng(),
    };
  });

  const walls=edges.filter(e=>e.s0<nCells||e.s1<nCells).map((e,i)=>({
    id:i,s0:e.s0,s1:e.s1,v0:e.v0,v1:e.v1,
    border:(e.s0>=nCells||e.s1>=nCells),
    severT:rr(0.80,1.00),thick:rr(1.2,2.4),
    frayPh:hash(i*13)*TAU,filmPh:hash(i*17)*TAU,
  }));
  FOAM_NCELLS=nCells;

  const jWalls=verts.map(()=>[]);
  walls.forEach(w=>{jWalls[w.v0]?.push(w.id);jWalls[w.v1]?.push(w.id);});

  const bokeh=[];
  for(let i=0;i<6;i++)bokeh.push({x:rr(0.1,0.9)*W,y:rr(0.1,0.9)*H,r:rr(60,120),birthT:rr(0.1,0.4),ph:rng()*TAU});

  const allSites=pts;

  const fibrils=buildFibrils(W,H,rng,rr);
  const microbes=buildMicrobes(nCells,gasCells,walls,verts,rng,rr);

  return{W,H,gasCells,walls,verts,jWalls,bokeh,allSites,nCells,fibrils,microbes};
}
function inflOf(idx,inflF){return idx<FOAM_NCELLS?(inflF[idx]||0):0;}

const structuring=t=>ss(0.16,0.42,t);
const peakness   =t=>ss(0.32,0.54,t)*(1-ss(0.70,0.96,t)*0.95);
const decay      =t=>ss(0.64,1.00,t);

function cellInflate(g,t){
  const grow=ss(g.birthT,g.peakT,t);
  const merge=ss(g.ruptureT,Math.min(g.ruptureT+0.14,1),t);
  return g.peakF*grow*(1-merge*0.35);
}
function wallDamage(w,t){return ss(w.severT-0.16,w.severT,t)*decay(t);}

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
  const v=FOAM.verts,sites=FOAM.allSites;
  const v0=v[w.v0],v1=v[w.v1];
  let bx=(v0[0]+v1[0])/2,by=(v0[1]+v1[1])/2;
  const s0=sites[w.s0],s1=sites[w.s1];
  if(s0&&s1){const ddx=s1[0]-s0[0],ddy=s1[1]-s0[1],dl=Math.hypot(ddx,ddy)||1;const bow=(inflOf(w.s0,inflF)-inflOf(w.s1,inflF))*30;bx+=ddx/dl*bow;by+=ddy/dl*bow;}
  return[v0,v1,bx,by];
}

// ─────────────────────────────────────────────────────────────────────────────
//  RENDER
// ─────────────────────────────────────────────────────────────────────────────
function render(ctx,t){
  const{W,H,gasCells,walls,verts,jWalls,bokeh,fibrils,microbes}=FOAM;
  const P=peakness(t),S=structuring(t),D=decay(t);

  // Inflation factor for each gas cell
  const inflF=gasCells.map(g=>cellInflate(g,t));

  // ── Step 1: Black background ──────────────────────────────────────────────
  ctx.globalCompositeOperation='source-over';
  ctx.fillStyle='#000';
  ctx.fillRect(0,0,W,H);

  // ── Step 1.5: Early fibrils ───────────────────────────────────────────────
  drawFibrils(ctx,fibrils,t);

  // ── Step 2: Bokeh depth-of-field haze ────────────────────────────────────
  ctx.globalCompositeOperation='lighter';
  for(const b of bokeh){
    const ba=hump(b.birthT,b.birthT+0.45,t)*0.045*P;if(ba<0.001)continue;
    const gr=ctx.createRadialGradient(b.x,b.y,0,b.x,b.y,b.r);
    gr.addColorStop(0,`rgba(180,120,40,${ba})`);gr.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=gr;ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,TAU);ctx.fill();
  }

  // ── Step 3: Gluten mass (amber film behind bubbles) ───────────────────────
  ctx.globalCompositeOperation='lighter';
  const glutA=clamp(S*0.38+P*0.18,0,1);
  if(glutA>0.01){
    const gm=ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,Math.max(W,H)*0.62);
    gm.addColorStop(0,`rgba(90,55,18,${glutA})`);gm.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=gm;ctx.fillRect(0,0,W,H);
  }

  // ── Step 3.5: Collapse merge voids ───────────────────────────────────────
  if(D>0.25){
    for(const w of walls){
      if(w.border)continue;
      const dmg=wallDamage(w,t);
      if(dmg<=0.80)continue;
      const s0=FOAM.allSites[w.s0],s1=FOAM.allSites[w.s1];
      if(!s0||!s1)continue;
      const bridgeA=clamp((dmg-0.80)/0.20,0,1);
      const mx=(s0[0]+s1[0])/2,my=(s0[1]+s1[1])/2;
      const dist=Math.hypot(s1[0]-s0[0],s1[1]-s0[1]);
      const rLong=dist*0.52;
      const if0=inflOf(w.s0,inflF),if1=inflOf(w.s1,inflF);
      const g0=gasCells[w.s0],g1=gasCells[w.s1];
      const rShort=Math.min(if0*(g0?g0.rad:20),if1*(g1?g1.rad:20))*0.55;
      const ang=Math.atan2(s1[1]-s0[1],s1[0]-s0[0]);

      ctx.save();
      ctx.globalCompositeOperation='source-over';
      ctx.translate(mx,my);
      ctx.rotate(ang);
      const bg=ctx.createRadialGradient(0,0,0,0,0,Math.max(rLong,rShort,1));
      bg.addColorStop(0,`rgba(0,0,0,${bridgeA*0.88})`);
      bg.addColorStop(1,'rgba(0,0,0,0)');
      ctx.scale(1,rShort/Math.max(rLong,1));
      ctx.beginPath();
      ctx.arc(0,0,rLong,0,TAU);
      ctx.fillStyle=bg;
      ctx.fill();
      ctx.restore();
    }
  }

  // ── Step 4: Gas cell voids (black cutouts) ────────────────────────────────
  ctx.globalCompositeOperation='source-over';
  for(const g of gasCells){
    const f=inflF[g.id];if(f<0.04)continue;
    const pts=bubblePts(g,t,f);
    if(!blobPath(ctx,pts))continue;
    // Deep void: black
    ctx.fillStyle='rgba(0,0,0,0.97)';ctx.fill();
    // Faint inner glow rim
    ctx.globalCompositeOperation='lighter';
    const[sx,sy]=g.site;
    const vr=g.rad*f*0.75;
    const vg=ctx.createRadialGradient(sx,sy,vr*0.1,sx,sy,vr);
    const ra=clamp(P*0.12+S*0.06,0,1);
    vg.addColorStop(0,'rgba(0,0,0,0)');
    vg.addColorStop(0.7,'rgba(0,0,0,0)');
    vg.addColorStop(1,`rgba(160,100,30,${ra*0.5})`);
    if(blobPath(ctx,pts)){ctx.fillStyle=vg;ctx.fill();}
    ctx.globalCompositeOperation='source-over';
  }

  // ── Step 5: Windowpane sheen on walls ────────────────────────────────────
  ctx.globalCompositeOperation='lighter';
  for(const w of walls){
    const dmg=wallDamage(w,t);if(dmg>0.92)continue;
    const[v0,v1,bx,by]=wallBow(w,inflF);
    if(!v0||!v1)continue;
    const filmA=clamp(S*0.45*(1-dmg*0.8),0,1);if(filmA<0.01)continue;
    ctx.beginPath();ctx.moveTo(v0[0],v0[1]);ctx.quadraticCurveTo(bx,by,v1[0],v1[1]);
    ctx.strokeStyle=`rgba(200,140,45,${filmA*0.35})`;
    ctx.lineWidth=w.thick*(1-dmg*0.7)*2.5;ctx.lineCap='round';ctx.stroke();
  }

  // ── Step 5.5: Microbes (LAB + Yeast) ─────────────────────────────────────
  ctx.globalCompositeOperation='lighter';
  drawLAB(ctx,microbes.labChains,t);
  drawYeasts(ctx,microbes.yeasts,gasCells,inflF,t);

  // ── Step 6: Wall strand cores ─────────────────────────────────────────────
  ctx.globalCompositeOperation='lighter';
  for(const w of walls){
    const dmg=wallDamage(w,t);if(dmg>0.92)continue;
    const[v0,v1,bx,by]=wallBow(w,inflF);
    if(!v0||!v1)continue;
    const coreA=clamp(S*0.7*(1-dmg*0.9),0,1);if(coreA<0.01)continue;
    ctx.beginPath();ctx.moveTo(v0[0],v0[1]);ctx.quadraticCurveTo(bx,by,v1[0],v1[1]);
    // Fray on damaged walls
    const fray=dmg>0.6?hash(w.id*23+Math.floor(t*40))*0.4:0;
    ctx.strokeStyle=`rgba(230,165,55,${coreA*(1-fray)})`;
    ctx.lineWidth=w.thick*(1-dmg*0.6);ctx.lineCap='round';ctx.stroke();
  }

  // ── Step 7: Junction glow ─────────────────────────────────────────────────
  ctx.globalCompositeOperation='lighter';
  for(let vi=0;vi<verts.length;vi++){
    const wIds=jWalls[vi];if(!wIds||wIds.length<2)continue;
    const vp=verts[vi];if(!vp)continue;
    let sumA=0;
    for(const wi of wIds){const w=walls[wi];if(w)sumA+=clamp(S*(1-wallDamage(w,t)),0,1);}
    const ja=clamp(sumA/wIds.length*0.6*P,0,1);if(ja<0.01)continue;
    const jr=3+wIds.length*1.5;
    const jg=ctx.createRadialGradient(vp[0],vp[1],0,vp[0],vp[1],jr);
    jg.addColorStop(0,`rgba(255,200,80,${ja})`);jg.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=jg;ctx.beginPath();ctx.arc(vp[0],vp[1],jr,0,TAU);ctx.fill();
  }

  // ── Step 8: Rupture flash ─────────────────────────────────────────────────
  ctx.globalCompositeOperation='lighter';
  for(const g of gasCells){
    const fl=hump(g.ruptureT-0.02,g.ruptureT+0.04,t)*decay(t)*0.55;if(fl<0.01)continue;
    const[sx,sy]=g.site;
    const fr=g.rad*(inflF[g.id]||0)*1.1;
    const fg=ctx.createRadialGradient(sx,sy,0,sx,sy,fr);
    fg.addColorStop(0,`rgba(255,230,130,${fl*0.8})`);
    fg.addColorStop(0.4,`rgba(220,160,60,${fl*0.35})`);
    fg.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=fg;ctx.beginPath();ctx.arc(sx,sy,fr,0,TAU);ctx.fill();
  }

  ctx.globalCompositeOperation='source-over';
}

// ─────────────────────────────────────────────────────────────────────────────
//  SETUP & LOOP
// ─────────────────────────────────────────────────────────────────────────────
(function(){
  const canvas=document.getElementById('scene');
  const ctx=canvas.getContext('2d');
  window.__ctx=ctx;
  window.__pause=false;

  FOAM=buildFoam(canvas.width,canvas.height);

  const DURATION=90000; // 90 seconds
  let startTime=null;

  function frame(now){
    if(!startTime)startTime=now;
    if(!window.__pause){
      const t=((now-startTime)%DURATION)/DURATION;
      render(ctx,t);
    }
    requestAnimationFrame(frame);
  }

  loadSheets(()=>{
    requestAnimationFrame(frame);
  });
})();
</script></body></html>
