// NOTE: This is a build fragment. At runtime it is concatenated AFTER an
// HTML wrapper. See preview/assemble.js for the wrapper layout.
// CRITICAL: Never use literal < /script> (without space) in this file.
//
// ─────────────────────────────────────────────────────────────────────────────
//  SOURDOUGH FERMENTATION — MULTI-BUFFER MICROSCOPE ENGINE
//
//  Offscreen canvas compositing. Procedural dough matrix texture.
//  Gas cells as destination-out masks. Gluten films as translucent sheets.
//  Internally animated organisms (membrane deformation, budding, division).
//  Real occlusion via source-over films. Bloom + color grade final pass.
//  All PRNG in build phase only — deterministic render at any t.
// ─────────────────────────────────────────────────────────────────────────────

const SHEET_SRCS={};
const ATLAS={yeast:{sheet:'org',x:0.038,y:0.041,w:0.311,h:0.331}};
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

// ─────────────────────────────────────────────────────────────────────────────
//  DELAUNAY / VORONOI
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
//  OFFSCREEN BUFFER POOL
// ─────────────────────────────────────────────────────────────────────────────
const _buffers={};
function getBuffer(name,w,h){
  let b=_buffers[name];
  if(!b||b.width!==w||b.height!==h){
    b=document.createElement('canvas');
    b.width=w;b.height=h;
    _buffers[name]=b;
  }
  const c=b.getContext('2d');
  c.clearRect(0,0,w,h);
  c.globalCompositeOperation='source-over';
  c.globalAlpha=1;
  return{canvas:b,ctx:c};
}

// ─────────────────────────────────────────────────────────────────────────────
//  DEPTH LAYERS
// ─────────────────────────────────────────────────────────────────────────────
function pickDepthLayer(rng,fgFrac,embFrac){
  const r=rng();
  if(r<fgFrac)return'foreground';
  if(r<fgFrac+embFrac)return'embedded';
  return'background';
}

// ─────────────────────────────────────────────────────────────────────────────
//  PROCEDURAL MATRIX TEXTURE (baked once into an offscreen canvas)
// ─────────────────────────────────────────────────────────────────────────────
let _matrixTexture=null;
function buildMatrixTexture(W,H,rng){
  const c=document.createElement('canvas');c.width=W;c.height=H;
  const ctx=c.getContext('2d');
  // Base warm amber fill
  ctx.fillStyle='rgb(38,24,12)';
  ctx.fillRect(0,0,W,H);

  // 150 soft blobs — hydrated dough body
  for(let i=0;i<150;i++){
    const x=rng()*W,y=rng()*H;
    const r=20+rng()*90;
    const tone=rng();
    const a=0.04+rng()*0.08;
    const gr=ctx.createRadialGradient(x,y,0,x,y,r);
    if(tone>0.5){
      gr.addColorStop(0,`rgba(65,42,18,${a})`);
    } else {
      gr.addColorStop(0,`rgba(50,32,14,${a})`);
    }
    gr.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=gr;ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill();
  }

  // 800 tiny particles — granular noise
  for(let i=0;i<800;i++){
    const x=rng()*W,y=rng()*H;
    const r=0.5+rng()*2;
    const a=0.03+rng()*0.08;
    ctx.fillStyle=`rgba(80,52,22,${a})`;
    ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill();
  }

  // 400 short fibrils — gluten network texture
  ctx.lineCap='round';
  for(let i=0;i<400;i++){
    const x=rng()*W,y=rng()*H;
    const len=8+rng()*30;
    const ang=rng()*TAU;
    const a=0.02+rng()*0.06;
    ctx.strokeStyle=`rgba(90,58,26,${a})`;
    ctx.lineWidth=0.4+rng()*0.8;
    const segs=6;
    ctx.beginPath();
    for(let s=0;s<=segs;s++){
      const frac=s/segs,along=frac*len-len/2;
      const perp=Math.sin(frac*TAU*(2+rng()*3))*len*0.08;
      const px=x+Math.cos(ang)*along-Math.sin(ang)*perp;
      const py=y+Math.sin(ang)*along+Math.cos(ang)*perp;
      if(s===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
    }
    ctx.stroke();
  }

  _matrixTexture=c;
  return c;
}

// ─────────────────────────────────────────────────────────────────────────────
//  YEAST CELLS — internally animated organisms
// ─────────────────────────────────────────────────────────────────────────────
function buildYeasts(gasCells,verts,rng,rr,sugarPaths){
  const sorted=[...gasCells].sort((a,b)=>b.peakF-a.peakF);
  const picked=sorted.slice(0,7);
  return picked.map((cell,i)=>{
    const vIdx=cell.triIdx[Math.floor(rng()*Math.max(cell.triIdx.length,1))];
    const vp=verts[vIdx]||cell.site;
    const frac=rr(0.40,0.60);
    const cx=cell.site[0]+(vp[0]-cell.site[0])*frac;
    const cy=cell.site[1]+(vp[1]-cell.site[1])*frac;
    const vacAngle=rng()*TAU;
    // Membrane deformation modes (3-5 harmonics)
    const membraneModes=[];
    const nModes=3+Math.floor(rng()*3);
    for(let m=0;m<nModes;m++){
      membraneModes.push({
        freq:2+Math.floor(rng()*4),
        amp:0.015+rng()*0.04,
        phase:rng()*TAU,
        speed:0.3+rng()*1.2,
      });
    }
    // Cytoplasm granules (6-10 internal particles)
    const granules=[];
    const nGran=6+Math.floor(rng()*5);
    for(let g=0;g<nGran;g++){
      granules.push({
        rFrac:0.15+rng()*0.55,
        ang:rng()*TAU,
        r:0.8+rng()*1.8,
        driftSpeed:0.2+rng()*0.6,
        driftPhase:rng()*TAU,
        brightness:0.3+rng()*0.5,
      });
    }
    const co2Sites=[0,1,2].map(()=>({r_frac:rr(0.5,1.3),ang:rng()*TAU,ph:rng()*TAU}));
    const matchPath=sugarPaths?sugarPaths.find(sp=>sp.targetType==='yeast'&&sp.targetId===i):null;
    const depthLayer=i===0?'foreground':i<=2?'embedded':'background';
    return{
      id:i,cx,cy,
      rx:rr(9,14),ry:rr(7,11),
      ang:rng()*TAU,
      depth:rng(),
      hostCell:cell,
      budDir:rng()*TAU,
      budStartT:cell.birthT+0.12+rng()*0.15,
      vacuoleOff:[Math.cos(vacAngle)*rr(1.5,3),Math.sin(vacAngle)*rr(1.5,3)],
      vacuoleR:rr(2.5,4),
      membraneModes,granules,co2Sites,
      metabolicPulseT:matchPath?matchPath.emitT+matchPath.duration:null,
      depthLayer,
      breathPhase:rng()*TAU,
    };
  });
}

function renderYeastToBuffer(bctx,y,t,alpha){
  if(alpha<0.03)return;
  const breath=Math.sin(t*TAU*2.2+y.breathPhase);
  const baseRx=y.rx+1.5*breath;
  const baseRy=y.ry-1.0*breath;
  const pulse=y.metabolicPulseT?hump(y.metabolicPulseT,y.metabolicPulseT+0.04,t)*0.4:0;
  const a=Math.min(alpha*(1+pulse),1);

  bctx.save();
  bctx.translate(y.cx,y.cy);
  bctx.rotate(y.ang);

  // Membrane with deformation modes
  const nPts=48;
  bctx.beginPath();
  for(let k=0;k<nPts;k++){
    const theta=TAU*k/nPts;
    let rx=baseRx,ry=baseRy;
    for(const m of y.membraneModes){
      const deform=m.amp*Math.sin(m.freq*theta+m.phase+t*TAU*m.speed);
      rx*=(1+deform);
      ry*=(1+deform*0.7);
    }
    const px=Math.cos(theta)*rx,py=Math.sin(theta)*ry;
    if(k===0)bctx.moveTo(px,py);else bctx.lineTo(px,py);
  }
  bctx.closePath();

  // Cell body fill — warm translucent amber
  const bodyGrad=bctx.createRadialGradient(0,0,0,0,0,Math.max(baseRx,baseRy));
  bodyGrad.addColorStop(0,`rgba(160,105,45,${a*0.85})`);
  bodyGrad.addColorStop(0.6,`rgba(120,75,30,${a*0.65})`);
  bodyGrad.addColorStop(1,`rgba(80,48,18,${a*0.4})`);
  bctx.fillStyle=bodyGrad;
  bctx.fill();

  // Membrane edge
  bctx.strokeStyle=`rgba(190,130,55,${a*0.7})`;
  bctx.lineWidth=1.2;
  bctx.stroke();

  // Clip to cell for internal features
  bctx.save();
  bctx.beginPath();
  for(let k=0;k<nPts;k++){
    const theta=TAU*k/nPts;
    let rx=baseRx,ry=baseRy;
    for(const m of y.membraneModes){
      const deform=m.amp*Math.sin(m.freq*theta+m.phase+t*TAU*m.speed);
      rx*=(1+deform);ry*=(1+deform*0.7);
    }
    const px=Math.cos(theta)*rx,py=Math.sin(theta)*ry;
    if(k===0)bctx.moveTo(px,py);else bctx.lineTo(px,py);
  }
  bctx.closePath();
  bctx.clip();

  // Cytoplasm granules — drifting internal particles
  for(const g of y.granules){
    const driftAng=g.ang+t*TAU*g.driftSpeed+Math.sin(t*TAU*0.4+g.driftPhase)*0.3;
    const gx=Math.cos(driftAng)*baseRx*g.rFrac;
    const gy=Math.sin(driftAng)*baseRy*g.rFrac;
    const ga=a*g.brightness*0.6;
    const gg=bctx.createRadialGradient(gx,gy,0,gx,gy,g.r);
    gg.addColorStop(0,`rgba(200,155,70,${ga})`);
    gg.addColorStop(1,'rgba(200,155,70,0)');
    bctx.fillStyle=gg;
    bctx.beginPath();bctx.arc(gx,gy,g.r,0,TAU);bctx.fill();
  }

  // Vacuole — dark void inside cell
  const vx=y.vacuoleOff[0]+Math.sin(t*TAU*0.3)*0.5;
  const vy=y.vacuoleOff[1]+Math.cos(t*TAU*0.25)*0.4;
  const vr=y.vacuoleR+0.3*Math.sin(t*TAU*0.5+y.id);
  bctx.beginPath();bctx.arc(vx,vy,vr,0,TAU);
  bctx.fillStyle=`rgba(20,12,5,${a*0.8})`;bctx.fill();
  bctx.strokeStyle=`rgba(100,65,25,${a*0.3})`;
  bctx.lineWidth=0.5;bctx.stroke();

  bctx.restore(); // unclip

  bctx.restore(); // untranslate

  // Budding
  const budP=ss(y.budStartT,y.budStartT+0.16,t);
  if(budP>0.02){
    const budR=budP*baseRx*0.65;
    const budSep=ss(y.budStartT+0.22,y.budStartT+0.34,t);
    const bdx=y.cx+Math.cos(y.budDir)*(baseRx+budR*(1-budSep*0.35));
    const bdy=y.cy+Math.sin(y.budDir)*(baseRy+budR*(1-budSep*0.35));

    // Bud body
    bctx.save();
    bctx.translate(bdx,bdy);
    bctx.rotate(y.ang);
    bctx.beginPath();bctx.ellipse(0,0,budR,budR*0.85,0,0,TAU);
    const budGrad=bctx.createRadialGradient(0,0,0,0,0,budR);
    budGrad.addColorStop(0,`rgba(155,100,40,${a*0.8})`);
    budGrad.addColorStop(1,`rgba(90,55,22,${a*0.45})`);
    bctx.fillStyle=budGrad;bctx.fill();
    bctx.strokeStyle=`rgba(180,120,50,${a*0.6})`;
    bctx.lineWidth=0.8;bctx.stroke();
    bctx.restore();

    // Neck bridge
    if(budP>0.3&&budSep<0.95){
      const p0x=y.cx+Math.cos(y.budDir)*baseRx*0.85;
      const p0y=y.cy+Math.sin(y.budDir)*baseRx*0.85;
      const p1x=bdx-Math.cos(y.budDir)*budR*0.7;
      const p1y=bdy-Math.sin(y.budDir)*budR*0.7;
      const neckA=a*0.5*(1-budSep);
      bctx.beginPath();bctx.moveTo(p0x,p0y);bctx.lineTo(p1x,p1y);
      bctx.strokeStyle=`rgba(160,105,42,${neckA})`;
      bctx.lineWidth=budR*0.35*(1-budSep*0.6);bctx.lineCap='round';bctx.stroke();
    }
  }

  // CO2 nucleation — small bright dots near organism
  const co2Start=y.metabolicPulseT||y.budStartT+0.12;
  if(t>co2Start){
    for(const cs of y.co2Sites){
      const ddist=cs.r_frac*baseRx;
      const dx=y.cx+Math.cos(cs.ang)*ddist;
      const dy=y.cy+Math.sin(cs.ang)*ddist;
      const timeFac=clamp((t-co2Start)/0.08,0,1);
      const nucA=timeFac*a*0.7*clamp(0.5+0.5*Math.sin(t*TAU*4.5+cs.ph),0,1);
      if(nucA<0.02)continue;
      const ng=bctx.createRadialGradient(dx,dy,0,dx,dy,2.5);
      ng.addColorStop(0,`rgba(220,200,140,${nucA})`);
      ng.addColorStop(1,'rgba(220,200,140,0)');
      bctx.beginPath();bctx.arc(dx,dy,2.5,0,TAU);bctx.fillStyle=ng;bctx.fill();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  LAB BACTERIA — chains with internal animation
// ─────────────────────────────────────────────────────────────────────────────
function buildLAB(walls,verts,nCells,rng,rr){
  const interior=walls.filter(w=>!w.border&&w.s0<nCells&&w.s1<nCells);
  const chains=[];let chainId=0;
  for(let i=0;i<interior.length&&chains.length<16;i++){
    if(rng()<0.25)continue;
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
    const chainBendPts=[{ang:rng()*TAU,mag:rr(2,8)},{ang:rng()*TAU,mag:rr(2,8)}];
    const rods=[];
    for(let ri=0;ri<chainLen;ri++){
      const along=(ri-(chainLen-1)/2)*rodLen*1.05;
      const bendFrac=ri/(Math.max(chainLen-1,1));
      const bendX=chainBendPts[0].mag*Math.cos(chainBendPts[0].ang)*Math.sin(bendFrac*Math.PI);
      const bendY=chainBendPts[1].mag*Math.cos(chainBendPts[1].ang)*Math.sin(bendFrac*Math.PI);
      const angJit=(rng()-0.5)*0.18;
      // Internal ribosome-like granules per rod
      const nRibo=2+Math.floor(rng()*3);
      const ribosomes=[];
      for(let rb=0;rb<nRibo;rb++){
        ribosomes.push({
          along:rr(-0.35,0.35),
          across:rr(-0.3,0.3),
          r:0.4+rng()*0.6,
          ph:rng()*TAU,
        });
      }
      rods.push({
        cx:ocx+Math.cos(wallAng)*along+bendX,
        cy:ocy+Math.sin(wallAng)*along+bendY,
        ang:wallAng+angJit,len:rodLen,wid:rodW,posInChain:ri,
        ribosomes,
      });
    }
    chains.push({
      id:chainId++,rods,chainLen,
      wigPh:rng()*TAU,wigFreq:rr(1.5,2.8),
      depth:rng(),hostWall:w,
      bornT:chainBornT,depthLayer,chainBendPts,
      divisionT:chainBornT+0.20+chainId*0.07,
      acidGlowPhase:rng()*TAU,
    });
  }
  return chains;
}

function renderLABToBuffer(bctx,chain,t,alpha){
  if(alpha<0.03)return;
  const divP=ss(chain.divisionT,chain.divisionT+0.05,t);

  for(let ri=0;ri<chain.rods.length;ri++){
    const rod=chain.rods[ri];
    let rodLenMod=rod.len;
    if(divP>0&&ri===Math.floor(chain.chainLen/2)){
      rodLenMod=rod.len*(1+divP*0.4);
    }
    const rodAng=rod.ang+0.08*Math.sin(t*TAU*chain.wigFreq+chain.wigPh+rod.posInChain*0.9);
    const ex=Math.cos(rodAng)*rodLenMod/2,ey=Math.sin(rodAng)*rodLenMod/2;
    const x0=rod.cx-ex,y0=rod.cy-ey,x1=rod.cx+ex,y1=rod.cy+ey;

    // Rod body — rounded capsule shape
    bctx.save();
    bctx.translate(rod.cx,rod.cy);
    bctx.rotate(rodAng);
    const hl=rodLenMod/2,hw=rod.wid/2;
    bctx.beginPath();
    bctx.arc(-hl,0,hw,Math.PI*0.5,Math.PI*1.5);
    bctx.arc(hl,0,hw,Math.PI*1.5,Math.PI*0.5);
    bctx.closePath();

    // Rod gradient — purple-mauve
    const rodGrad=bctx.createLinearGradient(-hl,0,hl,0);
    rodGrad.addColorStop(0,`rgba(95,55,155,${alpha*0.75})`);
    rodGrad.addColorStop(0.5,`rgba(130,90,195,${alpha*0.65})`);
    rodGrad.addColorStop(1,`rgba(95,55,155,${alpha*0.75})`);
    bctx.fillStyle=rodGrad;
    bctx.fill();
    bctx.strokeStyle=`rgba(160,115,220,${alpha*0.45})`;
    bctx.lineWidth=0.6;bctx.stroke();

    // Internal ribosomes
    bctx.save();
    bctx.beginPath();
    bctx.arc(-hl,0,hw,Math.PI*0.5,Math.PI*1.5);
    bctx.arc(hl,0,hw,Math.PI*1.5,Math.PI*0.5);
    bctx.closePath();
    bctx.clip();
    for(const rb of rod.ribosomes){
      const rbx=rb.along*rodLenMod;
      const rby=rb.across*rod.wid;
      const rbA=alpha*0.35*clamp(0.5+0.5*Math.sin(t*TAU*0.7+rb.ph),0,1);
      bctx.fillStyle=`rgba(180,150,230,${rbA})`;
      bctx.beginPath();bctx.arc(rbx,rby,rb.r,0,TAU);bctx.fill();
    }
    bctx.restore();
    bctx.restore();

    // Septum between adjacent rods
    if(ri<chain.rods.length-1){
      const jx=(rod.cx+chain.rods[ri+1].cx)/2,jy=(rod.cy+chain.rods[ri+1].cy)/2;
      const sepBright=ri===Math.floor(chain.chainLen/2)-1?1+divP*1.5:1;
      const perpAng2=rodAng+Math.PI/2;
      const sepLen=rod.wid*0.6;
      bctx.beginPath();
      bctx.moveTo(jx-Math.cos(perpAng2)*sepLen,jy-Math.sin(perpAng2)*sepLen);
      bctx.lineTo(jx+Math.cos(perpAng2)*sepLen,jy+Math.sin(perpAng2)*sepLen);
      bctx.strokeStyle=`rgba(130,85,195,${alpha*0.55*sepBright})`;
      bctx.lineWidth=0.7;bctx.lineCap='butt';bctx.stroke();
    }
  }

  // Acid output glow
  if(chain.chainLen>=3){
    const firstRod=chain.rods[0],lastRod=chain.rods[chain.rods.length-1];
    const mcx=(firstRod.cx+lastRod.cx)/2,mcy=(firstRod.cy+lastRod.cy)/2;
    const glowR=chain.chainLen*firstRod.len*0.7;
    const glowPulse=0.5+0.5*Math.sin(t*TAU*0.6+chain.acidGlowPhase);
    const ag=bctx.createRadialGradient(mcx,mcy,0,mcx,mcy,glowR);
    ag.addColorStop(0,`rgba(100,50,180,${alpha*0.06*glowPulse})`);
    ag.addColorStop(1,'rgba(100,50,180,0)');
    bctx.beginPath();bctx.arc(mcx,mcy,glowR,0,TAU);bctx.fillStyle=ag;bctx.fill();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  BIOCHEM (starch, amylase, sugar, protease)
// ─────────────────────────────────────────────────────────────────────────────
function buildBiochem(W,H,walls,nCells,yeasts,labChains,rng,rr){
  const starchs=[0,1].map(i=>({
    id:i,cx:rr(0.15,0.85)*W,cy:rr(0.15,0.85)*H,
    r:rr(18,28),birthT:rr(0.0,0.08),depth:rr(0.3,0.6),angOff:rng()*TAU,
  }));
  const amylases=starchs.map((st,i)=>({
    id:i,starchId:st.id,cx:st.cx,cy:st.cy,
    r:st.r+rr(2,6),dockAng:rng()*TAU,
    bornT:st.birthT+rr(0.05,0.12),rotSpeed:rr(0.08,0.18)*(rng()<0.5?1:-1),
  }));
  const sugarPaths=[];
  for(let i=0;i<14;i++){
    const am=amylases[i%2];
    const useYeast=rng()<0.6&&yeasts.length>0;
    let targetType,targetId,p2;
    if(useYeast){
      const yi=Math.floor(rng()*yeasts.length);
      targetType='yeast';targetId=yi;p2=[yeasts[yi].cx,yeasts[yi].cy];
    } else if(labChains.length>0){
      const li=Math.floor(rng()*labChains.length);
      targetType='lab';targetId=li;
      const c=labChains[li];
      p2=[c.rods[Math.floor(c.rods.length/2)].cx,c.rods[Math.floor(c.rods.length/2)].cy];
    } else {
      targetType='yeast';targetId=0;p2=[rr(0.1,0.9)*W,rr(0.1,0.9)*H];
    }
    const p0=[am.cx+Math.cos(rng()*TAU)*am.r,am.cy+Math.sin(rng()*TAU)*am.r];
    const cp=[lerp(p0[0],p2[0],0.5)+(rng()-0.5)*80,lerp(p0[1],p2[1],0.5)+(rng()-0.5)*80];
    sugarPaths.push({id:i,sourceAmylaseId:am.id,targetType,targetId,
      emitT:am.bornT+0.03+i*0.018,p0,p1cp:cp,p2,duration:rr(0.06,0.10)});
  }
  const interiorWalls=walls.filter(w=>!w.border&&w.s0<nCells&&w.s1<nCells);
  const proteases=[];
  for(let i=0;i<2&&i<interiorWalls.length;i++){
    const w=interiorWalls[Math.floor(rng()*interiorWalls.length)];
    const actT=rr(0.55,0.68);
    proteases.push({id:i,wallId:w.id,t_along:rr(0.3,0.7),
      activateT:actT,severeT:actT+0.14});
  }
  return{starchs,amylases,sugarPaths,proteases};
}

function bezierPt(p0,cp,p2,frac){
  return[
    (1-frac)*(1-frac)*p0[0]+2*(1-frac)*frac*cp[0]+frac*frac*p2[0],
    (1-frac)*(1-frac)*p0[1]+2*(1-frac)*frac*cp[1]+frac*frac*p2[1],
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
//  FOAM BUILD
// ─────────────────────────────────────────────────────────────────────────────
function buildFoam(W,H){
  const rng=mulberry32(SEED);
  const rr=(a,b)=>a+(b-a)*rng();

  const rawSites=[
    [0.12,0.18],[0.18,0.13],[0.15,0.28],
    [0.62,0.44],[0.68,0.38],[0.72,0.50],
    [0.42,0.78],[0.48,0.72],[0.44,0.85],
    [0.30,0.50],[0.55,0.20],[0.82,0.22],
    [0.10,0.60],[0.25,0.82],[0.70,0.80],
    [0.88,0.60],[0.50,0.10],[0.36,0.35],
    [0.78,0.12],[0.05,0.40],[0.90,0.40],
    [0.58,0.62],[0.20,0.65],[0.40,0.58],
    [0.72,0.30],[0.30,0.15],[0.85,0.75],[0.12,0.88],
    [0.22,0.45],[0.38,0.25],[0.52,0.35],[0.60,0.55],
    [0.34,0.62],[0.66,0.68],[0.48,0.48],[0.26,0.32],
    [0.80,0.50],[0.16,0.72],[0.58,0.88],[0.92,0.28],
    [0.08,0.25],[0.44,0.92],
  ];

  const pts=rawSites.map(([nx,ny])=>[
    clamp((nx+(rng()-0.5)*0.08)*W,W*0.04,W*0.96),
    clamp((ny+(rng()-0.5)*0.08)*H,H*0.04,H*0.96),
  ]);

  const faintFlags=pts.map((_,i)=>i%5===2);
  const edgeClipFlags=pts.map(([x,y])=>(x<W*0.12||x>W*0.88||y<H*0.12||y>H*0.88));

  const nCells=pts.length;
  for(let i=0;i<14;i++){const a=TAU*i/14;pts.push([W/2+Math.cos(a)*W*0.92,H/2+Math.sin(a)*H*0.92]);}

  const{verts,cells,edges}=buildVoronoi(pts);

  const gasCells=cells.slice(0,nCells).map((cell,i)=>{
    const[sx,sy]=cell.site;
    const vpolar=cell.poly.map(([px,py])=>({ang:Math.atan2(py-sy,px-sx),dist:Math.hypot(px-sx,py-sy)}));
    const rad=vpolar.length?vpolar.reduce((a,v)=>a+v.dist,0)/vpolar.length:30;
    const rim=[0,1,2].map(k=>({freq:2+Math.floor(hash(i*7+k*3)*4),amp:0.07+hash(i*11+k)*0.14,phase:hash(i*5+k*2)*TAU}));
    return{
      id:i,site:cell.site,poly:cell.poly,vpolar,rad,triIdx:cell.triIdx,
      birthT:rr(0.04,0.34),peakF:rr(0.45,1.05),peakT:rr(0.40,0.60),
      ruptureT:rr(0.72,0.98),rim,depth:rng(),faint:faintFlags[i],edgeClip:edgeClipFlags[i],
    };
  });

  const walls=edges.filter(e=>e.s0<nCells||e.s1<nCells).map((e,i)=>{
    const base=rr(1.2,2.4);
    const nPts=3+Math.floor(rng()*2);
    const thickPts=Array.from({length:nPts},()=>base*rr(0.6,1.5));
    const incomplete=rng()<0.25;
    const completeFrac=incomplete?rr(0.4,0.85):1.0;
    const nFray=3+Math.floor(rng()*3);
    const frayPts=Array.from({length:nFray},()=>({
      t_along:rr(0.05,0.95),offset:(rng()-0.5)*8,mag:rr(0.8,2.5),
    }));
    return{
      id:i,s0:e.s0,s1:e.s1,v0:e.v0,v1:e.v1,
      border:(e.s0>=nCells||e.s1>=nCells),
      severT:rr(0.80,1.00),thick:base,thickPts,incomplete,completeFrac,frayPts,
      filmPh:hash(i*17)*TAU,
    };
  });
  FOAM_NCELLS=nCells;

  for(const w of walls){
    w.tearStart=w.severT-0.16;w.tearMid=w.severT-0.06;
    w.tearEnd=w.severT+0.06;w.recoilEnd=w.severT+0.18;
  }

  const jWalls=verts.map(()=>[]);
  walls.forEach(w=>{jWalls[w.v0]?.push(w.id);jWalls[w.v1]?.push(w.id);});

  const bokeh=[];
  for(let i=0;i<6;i++)bokeh.push({x:rr(0.1,0.9)*W,y:rr(0.1,0.9)*H,r:rr(60,120),birthT:rr(0.1,0.4),ph:rng()*TAU});

  const allSites=pts;

  // Build matrix texture
  buildMatrixTexture(W,H,mulberry32(SEED+99));

  // Build microbes
  const tempYeasts=buildYeasts(gasCells,verts,rng,rr,[]);
  const labChains=buildLAB(walls,verts,nCells,rng,rr);
  const{starchs,amylases,sugarPaths,proteases}=buildBiochem(W,H,walls,nCells,tempYeasts,labChains,rng,rr);
  for(let i=0;i<tempYeasts.length;i++){
    const match=sugarPaths.find(sp=>sp.targetType==='yeast'&&sp.targetId===i);
    tempYeasts[i].metabolicPulseT=match?match.emitT+match.duration:null;
  }
  const microbes={yeasts:tempYeasts,labChains};

  // Background specks
  const specks=[];
  const intWalls=walls.filter(w=>!w.border);
  for(let i=0;i<60;i++){
    let x,y;
    if(rng()<0.7&&intWalls.length>0){
      const w=intWalls[Math.floor(rng()*intWalls.length)];
      const v0=verts[w.v0],v1=verts[w.v1];
      if(v0&&v1){const f=rng();x=lerp(v0[0],v1[0],f)+(rng()-0.5)*18;y=lerp(v0[1],v1[1],f)+(rng()-0.5)*18;}
      else{x=rr(0.04,0.96)*W;y=rr(0.04,0.96)*H;}
    } else {x=rr(0.04,0.96)*W;y=rr(0.04,0.96)*H;}
    specks.push({x,y,r:rr(0.6,1.6),baseA:rr(0.05,0.16),birthT:rr(0.05,0.45),ph:rng()*TAU,hue:rng()});
  }

  return{W,H,gasCells,walls,verts,jWalls,bokeh,allSites,nCells,microbes,starchs,amylases,sugarPaths,proteases,specks};
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
    out.push([sx+Math.cos(v.ang)*f*baseR*wob,sy+Math.sin(v.ang)*f*baseR*wob]);
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
//  MULTI-BUFFER RENDER PIPELINE
// ─────────────────────────────────────────────────────────────────────────────
function render(ctx,t,mode){
  mode=mode||'full';
  const{W,H,gasCells,walls,verts,jWalls,bokeh,microbes,starchs,amylases,sugarPaths,proteases,specks}=FOAM;
  const P=peakness(t),S=structuring(t),D=decay(t);
  const inflF=gasCells.map(g=>cellInflate(g,t));
  const full=mode==='full';
  const showMicrobes=mode!=='foam';
  const showMatrix=mode!=='foam'||mode==='matrix';

  // ═══════════════════════════════════════════════════════════════════════════
  //  BUFFER 1: MATRIX LAYER — procedural dough body
  // ═══════════════════════════════════════════════════════════════════════════
  const matBuf=getBuffer('matrix',W,H);
  const mc=matBuf.ctx;

  // Draw baked matrix texture with time-varying opacity
  if(_matrixTexture){
    const matAlpha=0.6+0.3*S-0.15*D;
    mc.globalAlpha=clamp(matAlpha,0.3,0.95);
    mc.drawImage(_matrixTexture,0,0);
    mc.globalAlpha=1;
  }

  // Living fibril shimmer — subtle brightness variation over static texture
  mc.globalCompositeOperation='lighter';
  const shimmerCount=8;
  for(let i=0;i<shimmerCount;i++){
    const sx=hash(i*31)*W,sy=hash(i*47+7)*H;
    const sr=40+hash(i*13)*80;
    const shimA=0.015*P*clamp(0.5+0.5*Math.sin(t*TAU*0.4+hash(i*91)*TAU),0,1);
    if(shimA<0.003)continue;
    const sg=mc.createRadialGradient(sx,sy,0,sx,sy,sr);
    sg.addColorStop(0,`rgba(120,80,35,${shimA})`);
    sg.addColorStop(1,'rgba(0,0,0,0)');
    mc.fillStyle=sg;mc.beginPath();mc.arc(sx,sy,sr,0,TAU);mc.fill();
  }
  mc.globalCompositeOperation='source-over';

  // ═══════════════════════════════════════════════════════════════════════════
  //  BUFFER 2: GAS VOID MASK — destination-out cavities
  // ═══════════════════════════════════════════════════════════════════════════
  const gasBuf=getBuffer('gasVoid',W,H);
  const gc=gasBuf.ctx;

  // White = where gas voids are (we'll use destination-out on matrix)
  for(const g of gasCells){
    const f=inflF[g.id];if(f<0.04)continue;
    const pts=bubblePts(g,t,f);
    if(!blobPath(gc,pts))continue;
    gc.fillStyle='rgba(255,255,255,1)';
    gc.fill();
  }

  // Collapse merge bridges
  if(D>0.25){
    for(const w of walls){
      if(w.border)continue;
      const dmg=wallDamage(w,t);if(dmg<=0.80)continue;
      const s0=FOAM.allSites[w.s0],s1=FOAM.allSites[w.s1];
      if(!s0||!s1)continue;
      const bridgeA=clamp((dmg-0.80)/0.20,0,1);
      const mx2=(s0[0]+s1[0])/2,my2=(s0[1]+s1[1])/2;
      const dist=Math.hypot(s1[0]-s0[0],s1[1]-s0[1]);
      const rLong=dist*0.52;
      const if0=inflOf(w.s0,inflF),if1=inflOf(w.s1,inflF);
      const g0=gasCells[w.s0],g1=gasCells[w.s1];
      const rShort=Math.min(if0*(g0?g0.rad:20),if1*(g1?g1.rad:20))*0.55;
      const ang=Math.atan2(s1[1]-s0[1],s1[0]-s0[0]);
      gc.save();gc.translate(mx2,my2);gc.rotate(ang);
      gc.scale(1,rShort/Math.max(rLong,1));
      const bg=gc.createRadialGradient(0,0,0,0,0,Math.max(rLong,1));
      bg.addColorStop(0,`rgba(255,255,255,${bridgeA})`);bg.addColorStop(1,'rgba(255,255,255,0)');
      gc.fillStyle=bg;gc.beginPath();gc.arc(0,0,rLong,0,TAU);gc.fill();
      gc.restore();
    }
  }

  // Apply gas void mask to matrix: cut dark cavities
  mc.globalCompositeOperation='destination-out';
  mc.drawImage(gasBuf.canvas,0,0);
  mc.globalCompositeOperation='source-over';

  // Add subtle dark rim shadow INSIDE the gas voids on the matrix layer
  for(const g of gasCells){
    const f=inflF[g.id];if(f<0.04)continue;
    const pts=bubblePts(g,t,f);
    const[sx,sy]=g.site;
    const vr=g.rad*f*0.75;
    if(blobPath(mc,pts)){
      const sg=mc.createRadialGradient(sx,sy,vr*0.5,sx,sy,vr*1.1);
      sg.addColorStop(0,'rgba(0,0,0,0)');
      sg.addColorStop(0.7,'rgba(0,0,0,0)');
      sg.addColorStop(1,`rgba(25,16,6,${0.4*(1-D*0.3)})`);
      mc.fillStyle=sg;mc.fill();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  BUFFER 3: GLUTEN FILM LAYER — translucent sheets between cells
  // ═══════════════════════════════════════════════════════════════════════════
  const filmBuf=getBuffer('glutenFilm',W,H);
  const fc=filmBuf.ctx;
  const filmA=0.06*S*(1-D*0.4);

  if(filmA>0.003){
    const sites=FOAM.allSites;
    for(const w of walls){
      if(w.border)continue;
      if(wallDamage(w,t)>0.85)continue;
      const v0=verts[w.v0],v1=verts[w.v1];
      if(!v0||!v1)continue;
      const s0=sites[w.s0],s1=sites[w.s1];
      if(!s0||!s1)continue;
      const wmx=(v0[0]+v1[0])/2,wmy=(v0[1]+v1[1])/2;
      const mx2=(s0[0]+s1[0])/2,my2=(s0[1]+s1[1])/2;
      const gr=fc.createRadialGradient(wmx,wmy,0,wmx,wmy,Math.hypot(mx2-wmx,my2-wmy)+1);
      gr.addColorStop(0,`rgba(100,65,25,${filmA})`);
      gr.addColorStop(1,'rgba(100,65,25,0)');
      fc.fillStyle=gr;
      fc.beginPath();
      fc.moveTo(v0[0],v0[1]);
      fc.quadraticCurveTo(wmx,wmy,v1[0],v1[1]);
      fc.lineTo(mx2,my2);fc.closePath();fc.fill();
    }
  }

  // Wall cores on film layer
  for(const w of walls){
    const dmg=wallDamage(w,t);
    if(dmg>0.92)continue;
    const[v0,v1,bx,by]=wallBow(w,inflF);
    if(!v0||!v1)continue;
    const coreA=clamp(S*0.6*(1-dmg*0.9),0,1)*0.75;
    if(coreA<0.01)continue;

    // Structural collapse
    if(t>=w.tearStart&&t<=w.recoilEnd){
      if(t<w.tearMid){
        const tearMidP=clamp((t-w.tearStart)/(w.tearMid-w.tearStart+0.001),0,1);
        const thinFrac=1-tearMidP*0.70;
        fc.beginPath();fc.moveTo(v0[0],v0[1]);fc.quadraticCurveTo(bx,by,v1[0],v1[1]);
        fc.strokeStyle=`rgba(200,140,50,${coreA})`;
        fc.lineWidth=w.thick*thinFrac;fc.lineCap='round';fc.stroke();
      } else if(t<w.tearEnd){
        const tearEndP=clamp((t-w.tearMid)/(w.tearEnd-w.tearMid+0.001),0,1);
        const gapHalf=tearEndP*0.18;
        const numSegs=12;
        const pathPts=[];
        for(let si=0;si<=numSegs;si++){
          const frac2=si/numSegs;const bf=1-frac2;
          pathPts.push([bf*bf*v0[0]+2*bf*frac2*bx+frac2*frac2*v1[0],bf*bf*v0[1]+2*bf*frac2*by+frac2*frac2*v1[1],frac2]);
        }
        fc.strokeStyle=`rgba(200,140,50,${coreA*0.5})`;
        fc.lineWidth=w.thick*0.3;fc.lineCap='round';
        for(const seg of [[0,0.5-gapHalf],[0.5+gapHalf,1]]){
          fc.beginPath();let inSeg=false;
          for(const[px,py,fr]of pathPts){
            if(fr>=seg[0]&&fr<=seg[1]){if(!inSeg){fc.moveTo(px,py);inSeg=true;}else fc.lineTo(px,py);}
          }
          fc.stroke();
        }
      } else {
        const recoilP=clamp((t-w.tearEnd)/(w.recoilEnd-w.tearEnd+0.001),0,1);
        const frayA=clamp(S*0.35*(1-recoilP),0,1);
        fc.strokeStyle=`rgba(170,110,38,${frayA})`;
        fc.lineWidth=0.7;fc.lineCap='round';
        const wallAng=Math.atan2(v1[1]-v0[1],v1[0]-v0[0]);
        const perpA=wallAng+Math.PI/2;
        for(const fp of w.frayPts){
          if(fp.t_along>0.5)continue;
          const fx=lerp(v0[0],v1[0],fp.t_along),fy=lerp(v0[1],v1[1],fp.t_along);
          fc.beginPath();fc.moveTo(fx,fy);
          fc.lineTo(fx+Math.cos(perpA+fp.offset)*fp.mag*4,fy+Math.sin(perpA+fp.offset)*fp.mag*4);
          fc.stroke();
        }
      }
      continue;
    }
    if(t>w.recoilEnd&&dmg>0.85)continue;

    // Normal wall core
    let frayMult=1;
    if(dmg>0.6){
      let fraySum=0;for(const fp of w.frayPts)fraySum+=fp.mag*0.1;
      frayMult=Math.max(0,1-fraySum*clamp(dmg-0.6,0,1)*0.5);
    }
    fc.beginPath();fc.moveTo(v0[0],v0[1]);fc.quadraticCurveTo(bx,by,v1[0],v1[1]);
    const thickMid=lerpVal(w.thickPts,0.5);
    fc.strokeStyle=`rgba(200,140,50,${coreA*frayMult})`;
    fc.lineWidth=thickMid*(1-dmg*0.6);fc.lineCap='round';fc.stroke();

    // Windowpane sheen overlay
    const sheenA=clamp(S*0.35*(1-dmg*0.8),0,1);
    if(sheenA>0.01){
      fc.beginPath();fc.moveTo(v0[0],v0[1]);fc.quadraticCurveTo(bx,by,v1[0],v1[1]);
      fc.strokeStyle=`rgba(180,125,45,${sheenA*0.25})`;
      fc.lineWidth=thickMid*(1-dmg*0.7)*2.5;fc.stroke();
    }
  }

  // Junction glow
  for(let vi=0;vi<verts.length;vi++){
    const wIds=jWalls[vi];if(!wIds||wIds.length<3)continue;
    const vp=verts[vi];if(!vp)continue;
    let sumA=0;
    for(const wi of wIds){const w=walls[wi];if(w)sumA+=clamp(S*(1-wallDamage(w,t)),0,1);}
    const ja=clamp(sumA/wIds.length*0.5*P,0,1)*0.5;if(ja<0.01)continue;
    const jr=3+wIds.length*1.5;
    const jg=fc.createRadialGradient(vp[0],vp[1],0,vp[0],vp[1],jr);
    jg.addColorStop(0,`rgba(230,175,70,${ja})`);jg.addColorStop(1,'rgba(0,0,0,0)');
    fc.fillStyle=jg;fc.beginPath();fc.arc(vp[0],vp[1],jr,0,TAU);fc.fill();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  BUFFER 4-6: MICROBE LAYERS (back / mid / front)
  // ═══════════════════════════════════════════════════════════════════════════
  const microbeBack=getBuffer('microbeBack',W,H);
  const microbeMid=getBuffer('microbeMid',W,H);
  const microbeFront=getBuffer('microbeFront',W,H);

  if(showMicrobes){
    const depthMap={background:microbeBack.ctx,embedded:microbeMid.ctx,foreground:microbeFront.ctx};

    for(const chain of microbes.labChains){
      const rawA=ss(chain.bornT,chain.bornT+0.12,t)*(1-ss(0.82,0.96,t));
      if(rawA<0.03)continue;
      const layerA=chain.depthLayer==='background'?rawA*0.4:chain.depthLayer==='embedded'?rawA*0.75:rawA;
      const target=depthMap[chain.depthLayer];
      renderLABToBuffer(target,chain,t,layerA);
    }

    for(const y of microbes.yeasts){
      const hc=y.hostCell;
      const rawA=ss(hc.birthT+0.08,hc.birthT+0.25,t)*(1-ss(0.78,0.95,t));
      if(rawA<0.04)continue;
      const layerA=y.depthLayer==='background'?rawA*0.4:y.depthLayer==='embedded'?rawA*0.75:rawA;
      const target=depthMap[y.depthLayer];
      renderYeastToBuffer(target,y,t,layerA);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  BUFFER 7: EVENT LAYER (starch, amylase, sugar, protease, rupture)
  // ═══════════════════════════════════════════════════════════════════════════
  const evtBuf=getBuffer('events',W,H);
  const ec=evtBuf.ctx;

  if(full){
    // Starch granules
    for(const st of starchs){
      const a=ss(st.birthT,st.birthT+0.06,t)*0.5;
      if(a<0.01)continue;
      ec.save();ec.translate(st.cx,st.cy);ec.rotate(st.angOff+t*0.05);
      ec.beginPath();ec.ellipse(0,0,st.r,st.r*0.82,0,0,TAU);
      ec.fillStyle=`rgba(50,62,88,${a})`;ec.fill();
      ec.strokeStyle=`rgba(70,88,125,${a*0.6})`;ec.lineWidth=0.8;ec.stroke();
      for(let ri=1;ri<=3;ri++){
        ec.beginPath();ec.ellipse(0,0,st.r*(0.25*ri),st.r*0.82*(0.25*ri),0,0,TAU);
        ec.strokeStyle=`rgba(80,100,140,${a*0.25})`;ec.lineWidth=0.5;ec.stroke();
      }
      ec.restore();
    }

    // Amylase rings
    for(const am of amylases){
      const a=ss(am.bornT,am.bornT+0.05,t)*0.6*(1-ss(0.75,0.90,t));
      if(a<0.01)continue;
      const rot=t*TAU*am.rotSpeed;
      ec.save();ec.translate(am.cx,am.cy);ec.rotate(rot);
      ec.beginPath();ec.arc(0,0,am.r,0,TAU);
      ec.setLineDash([5,4]);
      ec.strokeStyle=`rgba(50,175,155,${a})`;ec.lineWidth=1.2;ec.stroke();
      ec.setLineDash([]);
      ec.restore();
    }

    // Sugar paths
    for(const sp of sugarPaths){
      const tStart=sp.emitT,tEnd=sp.emitT+sp.duration;
      if(t<tStart||t>tEnd+0.04)continue;
      const frac=clamp((t-tStart)/sp.duration,0,1);
      const pt=bezierPt(sp.p0,sp.p1cp,sp.p2,frac);
      const a=hump(tStart,tEnd,t)*0.8;
      if(a<0.02)continue;
      ec.beginPath();ec.arc(pt[0],pt[1],2.5,0,TAU);
      ec.fillStyle=`rgba(200,165,45,${a})`;ec.fill();
      const prevFrac=clamp(frac-0.06,0,1);
      const pt2=bezierPt(sp.p0,sp.p1cp,sp.p2,prevFrac);
      ec.beginPath();ec.moveTo(pt2[0],pt2[1]);ec.lineTo(pt[0],pt[1]);
      ec.strokeStyle=`rgba(200,165,45,${a*0.3})`;ec.lineWidth=1.2;ec.stroke();
    }

    // Protease clamps
    for(const pr of proteases){
      const a=ss(pr.activateT,pr.activateT+0.04,t)*(1-ss(pr.severeT,pr.severeT+0.08,t));
      if(a<0.01)continue;
      const w=walls[pr.wallId];if(!w)continue;
      const v0=verts[w.v0],v1=verts[w.v1];if(!v0||!v1)continue;
      const px=lerp(v0[0],v1[0],pr.t_along),py=lerp(v0[1],v1[1],pr.t_along);
      ec.save();ec.translate(px,py);
      ec.beginPath();
      ec.arc(-3,-3,3.5,Math.PI*0.8,Math.PI*2.2);
      ec.arc(3,-3,3.5,Math.PI*0.8,Math.PI*2.2);
      ec.strokeStyle=`rgba(230,85,35,${Math.min(a*1.1,1)})`;ec.lineWidth=1.5;ec.lineCap='round';ec.stroke();
      ec.restore();
    }
  }

  // Rupture flash
  for(const g of gasCells){
    const fl=hump(g.ruptureT-0.02,g.ruptureT+0.04,t)*D*0.12;if(fl<0.01)continue;
    const[sx,sy]=g.site;
    const fr=g.rad*(inflF[g.id]||0)*1.1;
    const fg=ec.createRadialGradient(sx,sy,0,sx,sy,fr);
    fg.addColorStop(0,`rgba(240,210,120,${fl*0.7})`);
    fg.addColorStop(0.4,`rgba(200,145,55,${fl*0.3})`);
    fg.addColorStop(1,'rgba(0,0,0,0)');
    ec.fillStyle=fg;ec.beginPath();ec.arc(sx,sy,fr,0,TAU);ec.fill();
  }

  // Background specks
  if(showMicrobes){
    for(const sp of specks){
      const alpha=ss(sp.birthT,sp.birthT+0.1,t)*sp.baseA*(0.6+0.4*Math.sin(t*TAU*1.5+sp.ph))*(1-D*0.4);
      if(alpha<0.01)continue;
      const target=microbeBack.ctx;
      target.fillStyle=sp.hue<0.6?`rgba(160,105,40,${alpha})`:`rgba(130,95,185,${alpha})`;
      target.beginPath();target.arc(sp.x,sp.y,sp.r,0,TAU);target.fill();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  BUFFER 8: BLOOM LAYER
  // ═══════════════════════════════════════════════════════════════════════════
  const bloomBuf=getBuffer('bloom',W,H);
  const bc=bloomBuf.ctx;

  // Bokeh circles
  for(const b of bokeh){
    const ba=hump(b.birthT,b.birthT+0.45,t)*0.035*P;if(ba<0.001)continue;
    const gr=bc.createRadialGradient(b.x,b.y,0,b.x,b.y,b.r);
    gr.addColorStop(0,`rgba(160,105,35,${ba})`);gr.addColorStop(1,'rgba(0,0,0,0)');
    bc.fillStyle=gr;bc.beginPath();bc.arc(b.x,b.y,b.r,0,TAU);bc.fill();
  }

  // Subtle global warm bloom at peak
  if(P>0.1){
    const gb=bc.createRadialGradient(W/2,H/2,0,W/2,H/2,Math.max(W,H)*0.55);
    gb.addColorStop(0,`rgba(80,50,15,${P*0.06})`);gb.addColorStop(1,'rgba(0,0,0,0)');
    bc.fillStyle=gb;bc.fillRect(0,0,W,H);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  FINAL COMPOSITE — layer by layer onto output ctx
  // ═══════════════════════════════════════════════════════════════════════════
  ctx.globalCompositeOperation='source-over';
  ctx.fillStyle='#000';
  ctx.fillRect(0,0,W,H);

  // 1. Matrix (with gas voids already cut out)
  ctx.drawImage(matBuf.canvas,0,0);

  // 2. Background microbes (behind films)
  ctx.drawImage(microbeBack.canvas,0,0);

  // 3. Gluten films + wall cores (occlude bg microbes via source-over)
  ctx.drawImage(filmBuf.canvas,0,0);

  // 4. Embedded microbes (partially occluded by films)
  ctx.drawImage(microbeMid.canvas,0,0);

  // 5. Events (starch, sugar, amylase, protease)
  ctx.drawImage(evtBuf.canvas,0,0);

  // 6. Foreground microbes (on top of everything)
  ctx.drawImage(microbeFront.canvas,0,0);

  // 7. Bloom pass (additive)
  ctx.globalCompositeOperation='lighter';
  ctx.drawImage(bloomBuf.canvas,0,0);

  // 8. Color grade vignette
  ctx.globalCompositeOperation='source-over';
  const vig=ctx.createRadialGradient(W/2,H/2,Math.min(W,H)*0.25,W/2,H/2,Math.max(W,H)*0.6);
  vig.addColorStop(0,'rgba(0,0,0,0)');
  vig.addColorStop(1,'rgba(0,0,0,0.25)');
  ctx.fillStyle=vig;
  ctx.fillRect(0,0,W,H);

  ctx.globalCompositeOperation='source-over';
}

// ─────────────────────────────────────────────────────────────────────────────
//  STATE SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
function getStateSummary(t){
  const F=FOAM;
  let stageName;
  if(t<0.15)stageName='Hydration';
  else if(t<0.30)stageName='Early enzyme';
  else if(t<0.45)stageName='Gas forming';
  else if(t<0.65)stageName='Peak activity';
  else if(t<0.80)stageName='Acid/protease';
  else stageName='Collapse';
  const inflF=F.gasCells.map(g=>cellInflate(g,t));
  let visibleYeasts=0;
  for(const y of F.microbes.yeasts){
    const rawA=ss(y.hostCell.birthT+0.08,y.hostCell.birthT+0.25,t)*(1-ss(0.78,0.95,t));
    if(rawA>=0.04)visibleYeasts++;
  }
  let visibleLABChains=0;
  for(const c of F.microbes.labChains){
    const rawA=ss(c.bornT,c.bornT+0.12,t)*(1-ss(0.82,0.96,t));
    if(rawA>=0.03)visibleLABChains++;
  }
  let visibleSugarParticles=0;
  for(const sp of F.sugarPaths){
    if(t>=sp.emitT&&t<=sp.emitT+sp.duration+0.04){
      const a=hump(sp.emitT,sp.emitT+sp.duration,t)*0.9;
      if(a>=0.02)visibleSugarParticles++;
    }
  }
  let visibleCO2Nuclei=0;
  for(const y of F.microbes.yeasts){
    const co2Start=y.metabolicPulseT||y.budStartT+0.12;
    if(t>co2Start)visibleCO2Nuclei+=y.co2Sites.length;
  }
  let visibleProteaseSites=0;
  for(const pr of F.proteases){
    const a=ss(pr.activateT,pr.activateT+0.04,t)*(1-ss(pr.severeT,pr.severeT+0.08,t));
    if(a>=0.01)visibleProteaseSites++;
  }
  let visibleSpecks=0;
  for(const sp of F.specks){
    const alpha=ss(sp.birthT,sp.birthT+0.1,t)*sp.baseA*(0.6+0.4*Math.sin(t*TAU*1.5+sp.ph))*(1-decay(t)*0.4);
    if(alpha>=0.01)visibleSpecks++;
  }
  let wallsTorn=0,gasMerges=0;
  for(const w of F.walls){
    if(w.border)continue;
    const dmg=wallDamage(w,t);
    if(dmg>0.85)wallsTorn++;
    if(dmg>0.80)gasMerges++;
  }
  return{
    t:t.toFixed(3),stageName,visibleYeasts,visibleLABChains,visibleSugarParticles,
    visibleCO2Nuclei,visibleProteaseSites,visibleSpecks,wallsTorn,gasMerges,
    peakness:peakness(t).toFixed(3),structuring:structuring(t).toFixed(3),decay:decay(t).toFixed(3),
  };
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
