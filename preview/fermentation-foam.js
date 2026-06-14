// NOTE: This is a build fragment. At runtime it is concatenated AFTER an
// HTML wrapper that defines `SHEET_SRCS` (base64 sprite sheets) and a
// <canvas id="scene">, producing the gitignored local preview file
// `fermentation-preview.html`. The trailing < /script>< /body>< /html> close
// that wrapper. See conversation history / SPEC for the wrapper layout.
//
// ─────────────────────────────────────────────────────────────────────────────
//  SOURDOUGH FERMENTATION — FOAM + MICROBES  (Phase 1+2 organic rewrite)
//
//  One canvas. Pure black. Deterministic t=0→1 loop.
//  Gas cells are negative-space cavities; amber gluten FILMS and walls frame
//  them; junctions glow at cross-links. Gas and gluten deform each other.
//  Depth layers: background / embedded / foreground microbes occlude behind film.
//  Biochemical causality: starch → amylase → sugar → yeast/LAB → CO₂ + acid.
//  No Math.random() in render — all randomness from PRNG in build phase only.
// ─────────────────────────────────────────────────────────────────────────────

const SHEET_SRCS={};
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
const lerpVal=(arr,frac)=>{
  if(arr.length===1)return arr[0];
  const sf=clamp(frac,0,1)*(arr.length-1);
  const i=Math.min(Math.floor(sf),arr.length-2);
  return lerp(arr[i],arr[i+1],sf-i);
};

function mulberry32(s){let st=s>>>0;return()=>{st+=0x6D2B79F5;let z=st;z=(z^(z>>>15))*((z|1)>>>0);z^=z+(z^(z>>>7))*(z|61)>>>0;z^=z>>>14;return(z>>>0)/0x100000000;};}
function hash(i){let x=Math.sin(i*127.1+311.7)*43758.5453;return x-Math.floor(x);}
function hash2(i,j){return hash(i*1000+j);}

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

// ── Fibrils ───────────────────────────────────────────────────────────────────
function buildFibrils(W,H,rng,rr){
  const fibrils=[];
  for(let i=0;i<38;i++){
    fibrils.push({
      x:rr(0.04,0.96)*W,y:rr(0.04,0.96)*H,
      len:rr(18,55),ang:rng()*TAU,
      wfreq:rr(2,5),wamp:rr(0.08,0.22),wph:rng()*TAU,
      birthT:rr(0.00,0.10),dep:rng(),
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
    ctx.lineWidth=0.8+f.dep*0.9;ctx.lineCap='round';ctx.lineJoin='round';
    const segs=12;ctx.beginPath();
    for(let s=0;s<=segs;s++){
      const frac=s/segs,along=frac*f.len-f.len/2;
      const perp=Math.sin(frac*TAU*f.wfreq+f.wph)*f.wamp*f.len*0.18;
      const px=f.x+Math.cos(f.ang)*along-Math.sin(f.ang)*perp;
      const py=f.y+Math.sin(f.ang)*along+Math.cos(f.ang)*perp;
      if(s===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
    }
    ctx.stroke();
  }
}

// ── Depth layer helpers ───────────────────────────────────────────────────────
function pickDepthLayer(rng,fgFrac,embFrac){
  const r=rng();
  if(r<fgFrac)return'foreground';
  if(r<fgFrac+embFrac)return'embedded';
  return'background';
}
function depthAlpha(layer,base){
  if(layer==='background')return base*0.35;
  if(layer==='embedded')return base*0.75;
  return base;
}

// ── Yeast cells ───────────────────────────────────────────────────────────────
function buildYeasts(gasCells,verts,rng,rr,sugarPaths){
  const sorted=[...gasCells].sort((a,b)=>b.peakF-a.peakF);
  const picked=sorted.slice(0,4);
  return picked.map((cell,i)=>{
    const vIdx=cell.triIdx[Math.floor(rng()*Math.max(cell.triIdx.length,1))];
    const vp=verts[vIdx]||cell.site;
    const frac=rr(0.40,0.60);
    const cx=cell.site[0]+(vp[0]-cell.site[0])*frac;
    const cy=cell.site[1]+(vp[1]-cell.site[1])*frac;
    const vacAngle=rng()*TAU;
    const shimmerPts=[0,1,2,3].map(k=>({
      frac:rr(0.15,0.65),ang:rng()*TAU,r:rr(1.5,3.5),ph:rng()*TAU,
    }));
    const co2Sites=[0,1,2].map(k=>({r_frac:rr(0.5,1.3),ang:rng()*TAU,ph:rng()*TAU}));
    // find if any sugar path targets this yeast
    const matchPath=sugarPaths?sugarPaths.find(sp=>sp.targetType==='yeast'&&sp.targetId===i):null;
    const depthLayer=i===0?'foreground':i<=2?'embedded':'background';
    return{
      id:i,cx,cy,
      rx:rr(8,13),ry:rr(6,10),
      ang:rng()*TAU,
      depth:rng(),
      hostCell:cell,
      budDir:rng()*TAU,
      budStartT:cell.birthT+0.12+rng()*0.15,
      vacuoleOff:[Math.cos(vacAngle)*rr(1.5,3),Math.sin(vacAngle)*rr(1.5,3)],
      vacuoleR:rr(2.5,4),
      shimmerPts,co2Sites,
      metabolicPulseT:matchPath?matchPath.emitT+matchPath.duration:null,
      depthLayer,
    };
  });
}

function drawYeasts(ctx,yeasts,gasCells,inflF,t){
  for(const y of yeasts){
    const hc=y.hostCell;
    const rawA=ss(hc.birthT+0.08,hc.birthT+0.25,t)*(1-ss(0.78,0.95,t));
    if(rawA<0.04)continue;
    const pulse=y.metabolicPulseT?hump(y.metabolicPulseT,y.metabolicPulseT+0.04,t)*0.5:0;
    const hostAlpha=depthAlpha(y.depthLayer,rawA);

    // simulate blur for background layer
    if(y.depthLayer==='background'){
      for(let bo=-1;bo<=1;bo++){
        _drawYeastBody(ctx,y,gasCells,inflF,t,hostAlpha*0.33,pulse,bo,0);
      }
    } else {
      _drawYeastBody(ctx,y,gasCells,inflF,t,hostAlpha,pulse,0,0);
    }
  }
}

function _drawYeastBody(ctx,y,gasCells,inflF,t,alpha,pulse,offx,offy){
  const breath=Math.sin(t*TAU*2.8+y.id*1.7);
  const rx=y.rx+1.2*breath;
  const ry=y.ry-0.8*breath;
  const boostedAlpha=Math.min(alpha*(1+pulse),1);

  ctx.save();
  ctx.translate(y.cx+offx,y.cy+offy);
  ctx.rotate(y.ang);

  ctx.globalCompositeOperation='lighter';
  ctx.beginPath();ctx.ellipse(0,0,rx,ry,0,0,TAU);
  ctx.fillStyle=`rgba(140,85,28,${boostedAlpha*0.8})`;ctx.fill();
  ctx.strokeStyle=`rgba(215,148,55,${boostedAlpha*0.95})`;
  ctx.lineWidth=1.8;ctx.stroke();

  // Inner cytoplasm
  ctx.save();
  ctx.beginPath();ctx.ellipse(0,0,rx,ry,0,0,TAU);ctx.clip();
  const cg=ctx.createRadialGradient(0,0,0,0,0,Math.max(rx,ry));
  cg.addColorStop(0,`rgba(180,115,40,${boostedAlpha*0.5})`);
  cg.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=cg;ctx.beginPath();ctx.ellipse(0,0,rx,ry,0,0,TAU);ctx.fill();

  // Shimmer
  ctx.save();
  for(const sp of y.shimmerPts){
    const sx2=Math.cos(sp.ang)*rx*sp.frac;
    const sy2=Math.sin(sp.ang)*ry*sp.frac;
    const shimA=boostedAlpha*0.45*clamp(0.5+0.5*Math.sin(t*TAU*0.8+sp.ph),0,1);
    const sg=ctx.createRadialGradient(sx2,sy2,0,sx2,sy2,sp.r);
    sg.addColorStop(0,`rgba(230,180,80,${shimA})`);
    sg.addColorStop(1,'rgba(0,0,0,0)');
    ctx.beginPath();ctx.arc(sx2,sy2,sp.r,0,TAU);ctx.fillStyle=sg;ctx.fill();
  }
  ctx.restore();
  ctx.restore();

  ctx.rotate(-y.ang);
  // Vacuole
  const vx=y.vacuoleOff[0],vy=y.vacuoleOff[1];
  ctx.globalCompositeOperation='source-over';
  ctx.beginPath();ctx.arc(vx,vy,y.vacuoleR,0,TAU);
  ctx.fillStyle=`rgba(0,0,0,${alpha*0.7})`;ctx.fill();
  ctx.strokeStyle=`rgba(100,65,20,${alpha*0.4})`;
  ctx.lineWidth=0.7;ctx.stroke();
  ctx.restore();

  // Bud
  const budP=ss(y.budStartT,y.budStartT+0.16,t);
  if(budP>0.02){
    const budR=budP*rx*0.72;
    const budSep=ss(y.budStartT+0.22,y.budStartT+0.34,t);
    const bdx=(y.cx+offx)+Math.cos(y.budDir)*(rx+budR*(1-budSep*0.35));
    const bdy=(y.cy+offy)+Math.sin(y.budDir)*(rx+budR*(1-budSep*0.35));

    ctx.globalCompositeOperation='lighter';
    ctx.save();ctx.translate(bdx,bdy);
    ctx.beginPath();ctx.ellipse(0,0,budR,budR*0.85,y.ang,0,TAU);
    ctx.fillStyle=`rgba(140,85,28,${alpha*0.8})`;ctx.fill();
    ctx.strokeStyle=`rgba(215,148,55,${alpha*0.95})`;
    ctx.lineWidth=1.8;ctx.stroke();
    ctx.restore();

    // Bud neck constriction
    if(budP>0.3&&budSep<0.85){
      const neckFrac=clamp(budSep*1.2,0,1);
      const neckNarrow=1-neckFrac*0.7;
      const p0x=(y.cx+offx)+Math.cos(y.budDir)*rx*0.85;
      const p0y=(y.cy+offy)+Math.sin(y.budDir)*rx*0.85;
      const p1x=bdx-Math.cos(y.budDir)*budR*0.7;
      const p1y=bdy-Math.sin(y.budDir)*budR*0.7;
      // Draw two lines flanking the neck
      const perp=y.budDir+Math.PI/2;
      const hw=budR*0.22*neckNarrow;
      ctx.beginPath();
      ctx.moveTo(p0x+Math.cos(perp)*hw,p0y+Math.sin(perp)*hw);
      ctx.lineTo(p1x+Math.cos(perp)*hw,p1y+Math.sin(perp)*hw);
      ctx.moveTo(p0x-Math.cos(perp)*hw,p0y-Math.sin(perp)*hw);
      ctx.lineTo(p1x-Math.cos(perp)*hw,p1y-Math.sin(perp)*hw);
      ctx.strokeStyle=`rgba(200,130,45,${alpha*0.55})`;
      ctx.lineWidth=1.0;ctx.lineCap='round';ctx.stroke();
    } else if(budP>0.3){
      // Bridge fades as sep grows
      ctx.beginPath();
      ctx.moveTo((y.cx+offx)+Math.cos(y.budDir)*rx*0.8,(y.cy+offy)+Math.sin(y.budDir)*rx*0.8);
      ctx.lineTo(bdx-Math.cos(y.budDir)*budR*0.6,bdy-Math.sin(y.budDir)*budR*0.6);
      ctx.strokeStyle=`rgba(200,130,45,${alpha*0.4*(1-budSep)})`;
      ctx.lineWidth=1.2;ctx.stroke();
    }
  }

  // CO₂ nucleation dots — only after metabolicPulseT
  const co2Start=y.metabolicPulseT||y.budStartT+0.12;
  if(budP>0.5||t>co2Start){
    for(const cs of y.co2Sites){
      const dang=cs.ang;
      const ddist=cs.r_frac*rx;
      const dx=(y.cx+offx)+Math.cos(dang)*ddist;
      const dy=(y.cy+offy)+Math.sin(dang)*ddist;
      const timeFac=t>co2Start?clamp((t-co2Start)/0.08,0,1):clamp((budP-0.5)*2,0,1);
      const nucA=timeFac*alpha*0.7*clamp(0.5+0.5*Math.sin(t*TAU*5.2+cs.ph),0,1);
      if(nucA<0.02)continue;
      const ng=ctx.createRadialGradient(dx,dy,0,dx,dy,3);
      ng.addColorStop(0,`rgba(200,185,120,${nucA})`);
      ng.addColorStop(1,'rgba(200,185,120,0)');
      ctx.globalCompositeOperation='lighter';
      ctx.beginPath();ctx.arc(dx,dy,3,0,TAU);ctx.fillStyle=ng;ctx.fill();
    }
  }
}

// ── LAB bacteria ──────────────────────────────────────────────────────────────
function buildLAB(walls,verts,nCells,rng,rr){
  const interior=walls.filter(w=>!w.border&&w.s0<nCells&&w.s1<nCells);
  const chains=[];let chainId=0;
  for(let i=0;i<interior.length&&chains.length<10;i++){
    if(rng()<0.45)continue;
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
    const chainBornT=rr(0.12,0.38);
    const depthLayer=pickDepthLayer(rng,0.30,0.50);
    // Chain-level bend control points
    const chainBendPts=[
      {ang:rng()*TAU,mag:rr(2,8)},
      {ang:rng()*TAU,mag:rr(2,8)},
    ];
    const rods=[];
    for(let ri=0;ri<chainLen;ri++){
      // Apply chain-level bend offset to each rod center
      const along=(ri-(chainLen-1)/2)*rodLen*1.05;
      const bendFrac=ri/(Math.max(chainLen-1,1));
      const bendX=chainBendPts[0].mag*Math.cos(chainBendPts[0].ang)*Math.sin(bendFrac*Math.PI);
      const bendY=chainBendPts[1].mag*Math.cos(chainBendPts[1].ang)*Math.sin(bendFrac*Math.PI);
      const angJit=(rng()-0.5)*0.18;
      rods.push({
        cx:ocx+Math.cos(wallAng)*along+bendX,
        cy:ocy+Math.sin(wallAng)*along+bendY,
        ang:wallAng+angJit,len:rodLen,wid:rodW,posInChain:ri,
      });
    }
    chains.push({
      id:chainId++,rods,chainLen,
      wigPh:rng()*TAU,wigFreq:rr(1.5,2.8),
      depth:rng(),hostWall:w,
      bornT:chainBornT,
      depthLayer,
      chainBendPts,
      divisionT:chainBornT+0.20+chainId*0.07,
    });
  }
  return chains;
}

function drawLABChain(ctx,chain,t,overrideAlpha){
  const rawA=ss(chain.bornT,chain.bornT+0.12,t)*(1-ss(0.82,0.96,t));
  if(rawA<0.03)return;
  const labA=overrideAlpha!==undefined?overrideAlpha:depthAlpha(chain.depthLayer,rawA);
  if(labA<0.02)return;

  for(let ri=0;ri<chain.rods.length;ri++){
    const rod=chain.rods[ri];
    // Division elongation
    let rodLenMod=rod.len;
    const divP=ss(chain.divisionT,chain.divisionT+0.05,t);
    if(divP>0&&ri===Math.floor(chain.chainLen/2)){
      rodLenMod=rod.len*(1+divP*0.4);
    }
    const rodAng=rod.ang+0.08*Math.sin(t*TAU*chain.wigFreq+chain.wigPh+rod.posInChain*0.9);
    const ex=Math.cos(rodAng)*rodLenMod/2,ey=Math.sin(rodAng)*rodLenMod/2;
    const x0=rod.cx-ex,y0=rod.cy-ey,x1=rod.cx+ex,y1=rod.cy+ey;

    ctx.globalCompositeOperation='lighter';
    ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);
    ctx.strokeStyle=`rgba(110,65,185,${labA*0.85})`;
    ctx.lineWidth=rod.wid;ctx.lineCap='round';ctx.stroke();

    ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);
    ctx.strokeStyle=`rgba(175,125,255,${labA*0.55})`;
    ctx.lineWidth=rod.wid*0.45;ctx.stroke();

    for(const[px,py] of [[x0,y0],[x1,y1]]){
      const pg=ctx.createRadialGradient(px,py,0,px,py,3);
      pg.addColorStop(0,`rgba(200,160,255,${labA*0.7})`);
      pg.addColorStop(1,'rgba(200,160,255,0)');
      ctx.beginPath();ctx.arc(px,py,3,0,TAU);ctx.fillStyle=pg;ctx.fill();
    }

    // Division septum brightens then splits
    if(ri<chain.rods.length-1){
      const perpAng2=rodAng+Math.PI/2;
      const sepLen=rod.wid*0.7;
      const jx=(rod.cx+chain.rods[ri+1].cx)/2,jy=(rod.cy+chain.rods[ri+1].cy)/2;
      const sepBright=ri===Math.floor(chain.chainLen/2)-1?1+divP*1.5:1;
      ctx.beginPath();
      ctx.moveTo(jx-Math.cos(perpAng2)*sepLen,jy-Math.sin(perpAng2)*sepLen);
      ctx.lineTo(jx+Math.cos(perpAng2)*sepLen,jy+Math.sin(perpAng2)*sepLen);
      ctx.strokeStyle=`rgba(140,90,210,${labA*0.65*sepBright})`;
      ctx.lineWidth=0.9;ctx.lineCap='butt';ctx.stroke();
    }
  }

  // Acid glow for longer chains
  if(chain.chainLen>=3){
    const firstRod=chain.rods[0],lastRod=chain.rods[chain.rods.length-1];
    const mcx=(firstRod.cx+lastRod.cx)/2,mcy=(firstRod.cy+lastRod.cy)/2;
    const glowR=chain.chainLen*firstRod.len*0.6;
    const ag=ctx.createRadialGradient(mcx,mcy,0,mcx,mcy,glowR);
    ag.addColorStop(0,`rgba(110,60,200,${labA*0.06})`);
    ag.addColorStop(1,'rgba(110,60,200,0)');
    ctx.globalCompositeOperation='lighter';
    ctx.beginPath();ctx.arc(mcx,mcy,glowR,0,TAU);ctx.fillStyle=ag;ctx.fill();
  }
}

function buildMicrobes(nCells,gasCells,walls,verts,rng,rr,sugarPaths){
  const yeasts=buildYeasts(gasCells,verts,rng,rr,sugarPaths);
  const labChains=buildLAB(walls,verts,nCells,rng,rr);
  return{yeasts,labChains};
}

// ── Starch / Amylase / Sugar / Protease ───────────────────────────────────────
function buildBiochem(W,H,walls,nCells,yeasts,labChains,rng,rr){
  // 2 starch granules
  const starchs=[0,1].map(i=>({
    id:i,
    cx:rr(0.15,0.85)*W,cy:rr(0.15,0.85)*H,
    r:rr(18,28),
    birthT:rr(0.0,0.08),
    depth:rr(0.3,0.6),
    angOff:rng()*TAU,
  }));

  // 2 amylase rings
  const amylases=starchs.map((st,i)=>({
    id:i,starchId:st.id,
    cx:st.cx,cy:st.cy,
    r:st.r+rr(2,6),
    dockAng:rng()*TAU,
    bornT:st.birthT+rr(0.05,0.12),
    rotSpeed:rr(0.08,0.18)*(rng()<0.5?1:-1),
  }));

  // 14 sugar paths
  const sugarPaths=[];
  for(let i=0;i<14;i++){
    const am=amylases[i%2];
    const useYeast=rng()<0.6&&yeasts.length>0;
    let targetType,targetId,p2;
    if(useYeast){
      const yi=Math.floor(rng()*yeasts.length);
      targetType='yeast';targetId=yi;
      p2=[yeasts[yi].cx,yeasts[yi].cy];
    } else if(labChains.length>0){
      const li=Math.floor(rng()*labChains.length);
      targetType='lab';targetId=li;
      const c=labChains[li];
      p2=[c.rods[Math.floor(c.rods.length/2)].cx,c.rods[Math.floor(c.rods.length/2)].cy];
    } else {
      targetType='yeast';targetId=0;
      p2=[rr(0.1,0.9)*W,rr(0.1,0.9)*H];
    }
    const p0=[am.cx+Math.cos(rng()*TAU)*am.r,am.cy+Math.sin(rng()*TAU)*am.r];
    const cp=[lerp(p0[0],p2[0],0.5)+(rng()-0.5)*80,lerp(p0[1],p2[1],0.5)+(rng()-0.5)*80];
    sugarPaths.push({
      id:i,sourceAmylaseId:am.id,
      targetType,targetId,
      emitT:am.bornT+0.03+i*0.018,
      p0,p1cp:cp,p2,
      duration:rr(0.06,0.10),
    });
  }

  // 2 protease sites
  const interiorWalls=walls.filter(w=>!w.border&&w.s0<nCells&&w.s1<nCells);
  const proteases=[];
  for(let i=0;i<2&&i<interiorWalls.length;i++){
    const w=interiorWalls[Math.floor(rng()*interiorWalls.length)];
    const labSrc=labChains.length>0?labChains[Math.floor(rng()*labChains.length)]:null;
    const actT=rr(0.55,0.68);
    proteases.push({
      id:i,wallId:w.id,
      t_along:rr(0.3,0.7),
      labSourceId:labSrc?labSrc.id:-1,
      activateT:actT,
      severeT:actT+0.14,
    });
  }

  return{starchs,amylases,sugarPaths,proteases};
}

// ── Draw biochem ──────────────────────────────────────────────────────────────
function drawStarchs(ctx,starchs,t){
  ctx.globalCompositeOperation='source-over';
  for(const st of starchs){
    const a=ss(st.birthT,st.birthT+0.06,t)*0.55;
    if(a<0.01)continue;
    ctx.save();ctx.translate(st.cx,st.cy);ctx.rotate(st.angOff+t*0.05);
    // outer oval
    ctx.beginPath();ctx.ellipse(0,0,st.r,st.r*0.82,0,0,TAU);
    ctx.fillStyle=`rgba(58,72,100,${a})`;ctx.fill();
    ctx.strokeStyle=`rgba(80,100,140,${a*0.7})`;ctx.lineWidth=1;ctx.stroke();
    // concentric inner grain
    for(let ri=1;ri<=3;ri++){
      ctx.beginPath();ctx.ellipse(0,0,st.r*(0.25*ri),st.r*0.82*(0.25*ri),0,0,TAU);
      ctx.strokeStyle=`rgba(90,110,155,${a*0.3})`;ctx.lineWidth=0.6;ctx.stroke();
    }
    ctx.restore();
  }
}

function drawAmylases(ctx,amylases,t){
  ctx.globalCompositeOperation='lighter';
  for(const am of amylases){
    const a=ss(am.bornT,am.bornT+0.05,t)*0.7*(1-ss(0.75,0.90,t));
    if(a<0.01)continue;
    const rot=t*TAU*am.rotSpeed;
    ctx.save();ctx.translate(am.cx,am.cy);ctx.rotate(rot);
    // dashed ring
    ctx.beginPath();ctx.arc(0,0,am.r,0,TAU);
    ctx.setLineDash([5,4]);
    ctx.strokeStyle=`rgba(60,200,180,${a})`;ctx.lineWidth=1.5;ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

function bezierPt(p0,cp,p2,frac){
  const t2=frac;
  return[
    (1-t2)*(1-t2)*p0[0]+2*(1-t2)*t2*cp[0]+t2*t2*p2[0],
    (1-t2)*(1-t2)*p0[1]+2*(1-t2)*t2*cp[1]+t2*t2*p2[1],
  ];
}

function drawSugarPaths(ctx,sugarPaths,t){
  ctx.globalCompositeOperation='lighter';
  for(const sp of sugarPaths){
    const tStart=sp.emitT,tEnd=sp.emitT+sp.duration;
    if(t<tStart||t>tEnd+0.04)continue;
    const frac=clamp((t-tStart)/sp.duration,0,1);
    const pt=bezierPt(sp.p0,sp.p1cp,sp.p2,frac);
    const a=hump(tStart,tEnd,t)*0.9;
    if(a<0.02)continue;
    ctx.beginPath();ctx.arc(pt[0],pt[1],2,0,TAU);
    ctx.fillStyle=`rgba(220,180,50,${a})`;ctx.fill();
    // tail
    const prevFrac=clamp(frac-0.06,0,1);
    const pt2=bezierPt(sp.p0,sp.p1cp,sp.p2,prevFrac);
    ctx.beginPath();ctx.moveTo(pt2[0],pt2[1]);ctx.lineTo(pt[0],pt[1]);
    ctx.strokeStyle=`rgba(220,180,50,${a*0.35})`;ctx.lineWidth=1;ctx.stroke();
  }
}

function drawProteases(ctx,proteases,walls,verts,t,FOAM_DATA){
  ctx.globalCompositeOperation='lighter';
  for(const pr of proteases){
    const a=ss(pr.activateT,pr.activateT+0.04,t)*(1-ss(pr.severeT,pr.severeT+0.08,t));
    if(a<0.01)continue;
    const w=walls[pr.wallId];if(!w)continue;
    const v0=verts[w.v0],v1=verts[w.v1];if(!v0||!v1)continue;
    const px=lerp(v0[0],v1[0],pr.t_along),py=lerp(v0[1],v1[1],pr.t_along);
    // Clamp shape: two arcs
    ctx.save();ctx.translate(px,py);
    ctx.beginPath();
    ctx.arc(-3,-3,4,Math.PI*0.8,Math.PI*2.2);
    ctx.arc(3,-3,4,Math.PI*0.8,Math.PI*2.2);
    ctx.strokeStyle=`rgba(255,100,40,${a*0.9})`;ctx.lineWidth=1.5;ctx.lineCap='round';ctx.stroke();
    ctx.restore();
  }
}

// ── Foam build ────────────────────────────────────────────────────────────────
function buildFoam(W,H){
  const rng=mulberry32(SEED);
  const rr=(a,b)=>a+(b-a)*rng();

  // ~28 interior sites — varied clusters and sparse zones
  const rawSites=[
    // cluster A (upper-left area)
    [0.12,0.18],[0.18,0.13],[0.15,0.28],
    // cluster B (center-right)
    [0.62,0.44],[0.68,0.38],[0.72,0.50],
    // cluster C (lower center)
    [0.42,0.78],[0.48,0.72],[0.44,0.85],
    // sparse singles
    [0.30,0.50],[0.55,0.20],[0.82,0.22],
    [0.10,0.60],[0.25,0.82],[0.70,0.80],
    [0.88,0.60],[0.50,0.10],[0.36,0.35],
    [0.78,0.12],[0.05,0.40],[0.90,0.40],
    [0.58,0.62],[0.20,0.65],[0.40,0.58],
    [0.72,0.30],[0.30,0.15],[0.85,0.75],[0.12,0.88],
  ];

  // Jitter each site
  const pts=rawSites.map(([nx,ny])=>[
    clamp((nx+(rng()-0.5)*0.08)*W,W*0.04,W*0.96),
    clamp((ny+(rng()-0.5)*0.08)*H,H*0.04,H*0.96),
  ]);

  // Mark faint and edgeClip sites at build time
  const faintFlags=pts.map((_,i)=>i%5===2); // ~20% faint
  const edgeClipFlags=pts.map(([x,y])=>(x<W*0.12||x>W*0.88||y<H*0.12||y>H*0.88));

  const nCells=pts.length;
  // 14 ghost ring sites for boundary
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
      peakF:rr(0.55,1.35),
      peakT:rr(0.40,0.60),
      ruptureT:rr(0.72,0.98),
      rim,depth:rng(),
      faint:faintFlags[i],
      edgeClip:edgeClipFlags[i],
    };
  });

  const walls=edges.filter(e=>e.s0<nCells||e.s1<nCells).map((e,i)=>{
    const base=rr(1.2,2.4);
    // precompute 3-4 thickness control points that vary along the wall
    const nPts=3+Math.floor(rng()*2);
    const thickPts=Array.from({length:nPts},()=>base*rr(0.6,1.5));
    const incomplete=rng()<0.25;
    const completeFrac=incomplete?rr(0.4,0.85):1.0;
    // fray points: 3-5 precomputed
    const nFray=3+Math.floor(rng()*3);
    const frayPts=Array.from({length:nFray},(_,fi)=>({
      t_along:rr(0.05,0.95),
      offset:(rng()-0.5)*8,
      mag:rr(0.8,2.5),
    }));
    return{
      id:i,s0:e.s0,s1:e.s1,v0:e.v0,v1:e.v1,
      border:(e.s0>=nCells||e.s1>=nCells),
      severT:rr(0.80,1.00),
      thick:base,
      thickPts,
      incomplete,completeFrac,
      frayPts,
      filmPh:hash(i*17)*TAU,
    };
  });
  FOAM_NCELLS=nCells;

  // Compute structural collapse timing per wall
  for(const w of walls){
    w.tearStart=w.severT-0.16;
    w.tearMid=w.severT-0.06;
    w.tearEnd=w.severT+0.06;
    w.recoilEnd=w.severT+0.18;
  }

  const jWalls=verts.map(()=>[]);
  walls.forEach(w=>{jWalls[w.v0]?.push(w.id);jWalls[w.v1]?.push(w.id);});

  const bokeh=[];
  for(let i=0;i<6;i++)bokeh.push({x:rr(0.1,0.9)*W,y:rr(0.1,0.9)*H,r:rr(60,120),birthT:rr(0.1,0.4),ph:rng()*TAU});

  const allSites=pts;
  const fibrils=buildFibrils(W,H,rng,rr);

  // Build microbes and biochem
  // Pass empty arrays first, then build biochem after having yeasts
  const tempYeasts=buildYeasts(gasCells,verts,rng,rr,[]);
  const labChains=buildLAB(walls,verts,nCells,rng,rr);
  const {starchs,amylases,sugarPaths,proteases}=buildBiochem(W,H,walls,nCells,tempYeasts,labChains,rng,rr);
  // Use tempYeasts since rng state already consumed; just link pulseT
  for(let i=0;i<tempYeasts.length;i++){
    const match=sugarPaths.find(sp=>sp.targetType==='yeast'&&sp.targetId===i);
    tempYeasts[i].metabolicPulseT=match?match.emitT+match.duration:null;
  }
  const microbes={yeasts:tempYeasts,labChains};

  return{W,H,gasCells,walls,verts,jWalls,bokeh,allSites,nCells,fibrils,microbes,starchs,amylases,sugarPaths,proteases};
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
    const baseR=lerp(g.rad,v.dist,m);
    let nz=0;for(const c of g.rim)nz+=c.amp*Math.sin(c.freq*v.ang+c.phase);
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

// Draw a wall with collapse geometry
function drawWallCore(ctx,w,inflF,t,filmMode){
  const dmg=wallDamage(w,t);
  if(dmg>0.92&&t<w.tearEnd)return; // completely gone except fray
  const[v0,v1,bx,by]=wallBow(w,inflF);
  if(!v0||!v1)return;

  // Thickness along path using precomputed thickPts
  const baseThick=w.thick;

  // Structural collapse phases
  if(t>=w.tearStart&&t<=w.recoilEnd){
    const tearMidP=clamp((t-w.tearStart)/(w.tearMid-w.tearStart+0.001),0,1);
    const tearEndP=clamp((t-w.tearMid)/(w.tearEnd-w.tearMid+0.001),0,1);
    const recoilP=clamp((t-w.tearEnd)/(w.recoilEnd-w.tearEnd+0.001),0,1);

    if(t>=w.tearStart&&t<w.tearMid){
      // Thinning phase
      const thinFrac=1-tearMidP*0.70;
      const coreA=clamp(structuring(t)*0.7*(1-dmg*0.9),0,1);
      ctx.globalCompositeOperation='lighter';
      ctx.beginPath();ctx.moveTo(v0[0],v0[1]);ctx.quadraticCurveTo(bx,by,v1[0],v1[1]);
      ctx.strokeStyle=`rgba(230,165,55,${coreA})`;
      ctx.lineWidth=baseThick*thinFrac;ctx.lineCap='round';ctx.stroke();

    } else if(t>=w.tearMid&&t<w.tearEnd){
      // Gap phase: draw two segments with widening gap
      const gapFrac=tearEndP;
      const gapHalf=gapFrac*0.18; // fraction from center
      const numSegs=12;

      const pathPts=[];
      for(let si=0;si<=numSegs;si++){
        const frac=si/numSegs;
        const bfrac=1-frac;
        const px=bfrac*bfrac*v0[0]+2*bfrac*frac*bx+frac*frac*v1[0];
        const py=bfrac*bfrac*v0[1]+2*bfrac*frac*by+frac*frac*v1[1];
        pathPts.push([px,py,frac]);
      }

      const coreA=clamp(structuring(t)*0.7*(1-dmg*0.9),0,1)*0.5;
      ctx.globalCompositeOperation='lighter';
      ctx.strokeStyle=`rgba(230,165,55,${coreA})`;
      ctx.lineWidth=baseThick*0.3;ctx.lineCap='round';

      // First segment: 0..0.5-gapHalf
      ctx.beginPath();
      let inSeg=false;
      for(const[px,py,frac] of pathPts){
        if(frac<=0.5-gapHalf){if(!inSeg){ctx.moveTo(px,py);inSeg=true;}else ctx.lineTo(px,py);}
      }
      ctx.stroke();
      // Second segment: 0.5+gapHalf..1
      ctx.beginPath();inSeg=false;
      for(const[px,py,frac] of pathPts){
        if(frac>=0.5+gapHalf){if(!inSeg){ctx.moveTo(px,py);inSeg=true;}else ctx.lineTo(px,py);}
      }
      ctx.stroke();

    } else if(t>=w.tearEnd&&t<=w.recoilEnd){
      // Fray phase using precomputed frayPts
      const frayA=clamp(structuring(t)*0.4*(1-recoilP),0,1);
      ctx.globalCompositeOperation='lighter';
      ctx.strokeStyle=`rgba(200,130,40,${frayA})`;
      ctx.lineWidth=0.9;ctx.lineCap='round';
      const wallLen=Math.hypot(v1[0]-v0[0],v1[1]-v0[1]);
      const wallAng=Math.atan2(v1[1]-v0[1],v1[0]-v0[0]);
      const perpA=wallAng+Math.PI/2;
      for(const fp of w.frayPts){
        if(fp.t_along>0.5)continue; // only near break ends
        const fx=lerp(v0[0],v1[0],fp.t_along);
        const fy=lerp(v0[1],v1[1],fp.t_along);
        ctx.beginPath();
        ctx.moveTo(fx,fy);
        ctx.lineTo(fx+Math.cos(perpA+fp.offset)*fp.mag*4,fy+Math.sin(perpA+fp.offset)*fp.mag*4);
        ctx.stroke();
      }
    }
    return;
  }

  if(t>w.recoilEnd&&dmg>0.85)return; // wall gone

  // Normal wall rendering
  const coreA=clamp(structuring(t)*0.7*(1-dmg*0.9),0,1);
  if(coreA<0.01)return;

  // Fray on damaged walls using precomputed frayPts
  let frayMult=1;
  if(dmg>0.6){
    // Evaluate fray at current position using precomputed pts
    let fraySum=0;
    for(const fp of w.frayPts)fraySum+=fp.mag*0.1;
    frayMult=Math.max(0,1-fraySum*clamp(dmg-0.6,0,1)*0.5);
  }

  if(filmMode){
    // Windowpane sheen
    ctx.beginPath();ctx.moveTo(v0[0],v0[1]);ctx.quadraticCurveTo(bx,by,v1[0],v1[1]);
    const filmA=clamp(structuring(t)*0.45*(1-dmg*0.8),0,1);
    if(filmA>0.01){
      ctx.strokeStyle=`rgba(200,140,45,${filmA*0.35})`;
      const thickAtMid=lerpVal(w.thickPts,0.5);
      ctx.lineWidth=thickAtMid*(1-dmg*0.7)*2.5;ctx.lineCap='round';ctx.stroke();
    }
  } else {
    // Core strand — draw in segments using thickPts for variable width
    const numSegs=Math.max(4,w.thickPts.length-1);
    // First path for overall shape
    ctx.beginPath();ctx.moveTo(v0[0],v0[1]);ctx.quadraticCurveTo(bx,by,v1[0],v1[1]);
    // Incomplete walls: only draw completeFrac of path
    if(w.incomplete&&w.completeFrac<1.0){
      // Draw only to completeFrac
      const pathPts=[];
      for(let si=0;si<=20;si++){
        const frac=si/20*w.completeFrac;
        const bfrac=1-frac;
        pathPts.push([bfrac*bfrac*v0[0]+2*bfrac*frac*bx+frac*frac*v1[0],
                      bfrac*bfrac*v0[1]+2*bfrac*frac*by+frac*frac*v1[1]]);
      }
      ctx.beginPath();ctx.moveTo(pathPts[0][0],pathPts[0][1]);
      for(let si=1;si<pathPts.length;si++)ctx.lineTo(pathPts[si][0],pathPts[si][1]);
    }
    const thickMid=lerpVal(w.thickPts,0.5);
    ctx.strokeStyle=`rgba(230,165,55,${coreA*frayMult})`;
    ctx.lineWidth=thickMid*(1-dmg*0.6);ctx.lineCap='round';ctx.stroke();
  }
}

// Film occlusion pass
function drawFilmOcclusion(ctx,walls,verts,inflF,t,opacity){
  ctx.globalCompositeOperation='lighter';
  for(const w of walls){
    const dmg=wallDamage(w,t);if(dmg>0.85)continue;
    const[v0,v1,bx,by]=wallBow(w,inflF);
    if(!v0||!v1)continue;
    const thickMid=lerpVal(w.thickPts,0.5);
    ctx.beginPath();ctx.moveTo(v0[0],v0[1]);ctx.quadraticCurveTo(bx,by,v1[0],v1[1]);
    ctx.strokeStyle=`rgba(200,160,80,${opacity})`;
    ctx.lineWidth=thickMid*8;ctx.lineCap='round';ctx.stroke();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  RENDER
// ─────────────────────────────────────────────────────────────────────────────
function render(ctx,t){
  const{W,H,gasCells,walls,verts,jWalls,bokeh,fibrils,microbes,starchs,amylases,sugarPaths,proteases}=FOAM;
  const P=peakness(t),S=structuring(t),D=decay(t);
  const inflF=gasCells.map(g=>cellInflate(g,t));

  // ── 1. Black background ──────────────────────────────────────────────────
  ctx.globalCompositeOperation='source-over';
  ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);

  // ── 2. Starch granules ───────────────────────────────────────────────────
  drawStarchs(ctx,starchs,t);

  // ── 3. Background bokeh ──────────────────────────────────────────────────
  ctx.globalCompositeOperation='lighter';
  for(const b of bokeh){
    const ba=hump(b.birthT,b.birthT+0.45,t)*0.045*P;if(ba<0.001)continue;
    const gr=ctx.createRadialGradient(b.x,b.y,0,b.x,b.y,b.r);
    gr.addColorStop(0,`rgba(180,120,40,${ba})`);gr.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=gr;ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,TAU);ctx.fill();
  }

  // ── 4. Gluten mass ───────────────────────────────────────────────────────
  ctx.globalCompositeOperation='lighter';
  const glutA=clamp(S*0.38+P*0.18,0,1);
  if(glutA>0.01){
    const gm=ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,Math.max(W,H)*0.62);
    gm.addColorStop(0,`rgba(90,55,18,${glutA})`);gm.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=gm;ctx.fillRect(0,0,W,H);
  }

  // ── 5. Collapse merge voids ──────────────────────────────────────────────
  if(D>0.25){
    for(const w of walls){
      if(w.border)continue;
      const dmg=wallDamage(w,t);if(dmg<=0.80)continue;
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
      ctx.save();ctx.globalCompositeOperation='source-over';
      ctx.translate(mx,my);ctx.rotate(ang);
      const bg=ctx.createRadialGradient(0,0,0,0,0,Math.max(rLong,rShort,1));
      bg.addColorStop(0,`rgba(0,0,0,${bridgeA*0.88})`);bg.addColorStop(1,'rgba(0,0,0,0)');
      ctx.scale(1,rShort/Math.max(rLong,1));
      ctx.beginPath();ctx.arc(0,0,rLong,0,TAU);ctx.fillStyle=bg;ctx.fill();
      ctx.restore();
    }
  }

  // ── 6. Gas cell voids + rim glow ────────────────────────────────────────
  ctx.globalCompositeOperation='source-over';
  for(const g of gasCells){
    const f=inflF[g.id];if(f<0.04)continue;
    const pts=bubblePts(g,t,f);
    if(!blobPath(ctx,pts))continue;
    ctx.fillStyle='rgba(0,0,0,0.97)';ctx.fill();
    // Rim glow (faint cells get reduced rim)
    ctx.globalCompositeOperation='lighter';
    const[sx,sy]=g.site;
    const vr=g.rad*f*0.75;
    const vg=ctx.createRadialGradient(sx,sy,vr*0.1,sx,sy,vr);
    const ra=clamp(P*0.12+S*0.06,0,1)*(g.faint?0.3:1.0);
    vg.addColorStop(0,'rgba(0,0,0,0)');
    vg.addColorStop(0.7,'rgba(0,0,0,0)');
    vg.addColorStop(1,`rgba(160,100,30,${ra*0.5})`);
    if(blobPath(ctx,pts)){ctx.fillStyle=vg;ctx.fill();}
    ctx.globalCompositeOperation='source-over';
  }

  // ── 7. Background microbes ───────────────────────────────────────────────
  ctx.globalCompositeOperation='lighter';
  for(const chain of microbes.labChains){
    if(chain.depthLayer!=='background')continue;
    // Simulate blur: draw 3x offset +-1px
    for(let bo=-1;bo<=1;bo++){
      ctx.save();ctx.translate(bo,0);
      drawLABChain(ctx,chain,t,undefined);
      ctx.restore();
    }
  }
  for(const y of microbes.yeasts){
    if(y.depthLayer!=='background')continue;
    drawYeasts(ctx,[y],gasCells,inflF,t);
  }

  // ── 8. Film occlusion pass (occludes bg microbes) ───────────────────────
  drawFilmOcclusion(ctx,walls,verts,inflF,t,0.06);

  // ── 9. Amylase rings ─────────────────────────────────────────────────────
  drawAmylases(ctx,amylases,t);

  // ── 10. Sugar paths ───────────────────────────────────────────────────────
  drawSugarPaths(ctx,sugarPaths,t);

  // ── 11. Windowpane sheen ──────────────────────────────────────────────────
  ctx.globalCompositeOperation='lighter';
  for(const w of walls){
    drawWallCore(ctx,w,inflF,t,true);
  }

  // ── 12. Embedded microbes ─────────────────────────────────────────────────
  ctx.globalCompositeOperation='lighter';
  for(const chain of microbes.labChains){
    if(chain.depthLayer!=='embedded')continue;
    drawLABChain(ctx,chain,t,undefined);
  }
  for(const y of microbes.yeasts){
    if(y.depthLayer!=='embedded')continue;
    drawYeasts(ctx,[y],gasCells,inflF,t);
  }

  // ── 13. Film occlusion pass again (occludes embedded) ────────────────────
  drawFilmOcclusion(ctx,walls,verts,inflF,t,0.04);

  // ── 14. Early fibrils ─────────────────────────────────────────────────────
  drawFibrils(ctx,fibrils,t);

  // ── 15. Wall strand cores + structural collapse ───────────────────────────
  ctx.globalCompositeOperation='lighter';
  for(const w of walls){
    drawWallCore(ctx,w,inflF,t,false);
  }

  // ── 16. Junction glow ─────────────────────────────────────────────────────
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

  // ── 17. Foreground microbes ───────────────────────────────────────────────
  ctx.globalCompositeOperation='lighter';
  for(const chain of microbes.labChains){
    if(chain.depthLayer!=='foreground')continue;
    drawLABChain(ctx,chain,t,undefined);
  }
  for(const y of microbes.yeasts){
    if(y.depthLayer!=='foreground')continue;
    drawYeasts(ctx,[y],gasCells,inflF,t);
  }

  // ── 18. Protease clamps ───────────────────────────────────────────────────
  drawProteases(ctx,proteases,walls,verts,t,FOAM);

  // ── 19. Rupture flash (max 15% alpha) ────────────────────────────────────
  ctx.globalCompositeOperation='lighter';
  for(const g of gasCells){
    const fl=hump(g.ruptureT-0.02,g.ruptureT+0.04,t)*decay(t)*0.15;if(fl<0.01)continue;
    const[sx,sy]=g.site;
    const fr=g.rad*(inflF[g.id]||0)*1.1;
    const fg=ctx.createRadialGradient(sx,sy,0,sx,sy,fr);
    fg.addColorStop(0,`rgba(255,230,130,${fl*0.8})`);
    fg.addColorStop(0.4,`rgba(220,160,60,${fl*0.35})`);
    fg.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=fg;ctx.beginPath();ctx.arc(sx,sy,fr,0,TAU);ctx.fill();
  }

  // ── 20. Acid glow zones ───────────────────────────────────────────────────
  ctx.globalCompositeOperation='lighter';
  for(const chain of microbes.labChains){
    if(chain.chainLen<3)continue;
    const rawA=ss(chain.bornT,chain.bornT+0.12,t)*(1-ss(0.82,0.96,t));
    if(rawA<0.03)continue;
    const labA=depthAlpha(chain.depthLayer,rawA);
    const firstRod=chain.rods[0],lastRod=chain.rods[chain.rods.length-1];
    const mcx=(firstRod.cx+lastRod.cx)/2,mcy=(firstRod.cy+lastRod.cy)/2;
    const glowR=chain.chainLen*firstRod.len*0.9;
    const ag=ctx.createRadialGradient(mcx,mcy,0,mcx,mcy,glowR);
    ag.addColorStop(0,`rgba(110,60,200,${labA*0.08})`);
    ag.addColorStop(1,'rgba(110,60,200,0)');
    ctx.beginPath();ctx.arc(mcx,mcy,glowR,0,TAU);ctx.fillStyle=ag;ctx.fill();
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

  const DURATION=90000;
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
