// Assembler: regenerates ../fermentation-preview.html from the canonical engine
// fermentation-foam.js. Strips the engine's leading comment block and trailing
// setup IIFE, wraps with the HTML page, appends the init IIFE (URL modes).
const fs=require('fs');
const path=require('path');
const dir=__dirname;
const engineSrc=fs.readFileSync(path.join(dir,'fermentation-foam.js'),'utf8');

// Strip leading comment block: start at first `const `
const firstConst=engineSrc.indexOf('const ');
if(firstConst<0)throw new Error('no const found in engine');
// Strip trailing setup IIFE: cut at the SETUP & LOOP banner comment
const cutMarker='// ───────────────────────────────────────────────────────────────────────────────\n//  SETUP & LOOP';
const cutIdx=engineSrc.indexOf(cutMarker);
if(cutIdx<0)throw new Error('SETUP & LOOP marker not found');
let body=engineSrc.slice(firstConst,cutIdx).trimEnd();

if(/<\/script>/i.test(body))throw new Error('engine body contains </'+'script> — abort');

const head=`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sourdough Fermentation - Foam Preview</title>
<style>
html,body{margin:0;padding:0;background:#000;height:100%;}
#scene{display:block;margin:0 auto;}
#controls{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:12px;background:rgba(0,0,0,0.65);padding:8px 18px;border-radius:20px;border:1px solid rgba(255,200,80,0.2);}
#controls label{color:rgba(200,160,60,0.8);font:12px monospace;}
#controls.hidden{display:none;}
#slider{width:240px;accent-color:#c89020;}
#tval{color:rgba(200,160,60,0.9);font:12px monospace;width:42px;}
#pauseBtn{color:rgba(200,160,60,0.8);background:none;border:1px solid rgba(200,160,60,0.4);border-radius:10px;padding:2px 10px;font:11px monospace;cursor:pointer;}
#pauseBtn:hover{background:rgba(200,160,60,0.12);}
#stateReadout{position:fixed;top:8px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.7);color:rgba(200,160,60,0.85);font:11px monospace;padding:5px 14px;border-radius:10px;border:1px solid rgba(255,200,80,0.15);white-space:pre;pointer-events:none;display:none;}
#reviewHeader{color:rgba(200,160,60,0.8);font:14px monospace;padding:16px;text-align:center;}
#modeSelector{margin:16px;text-align:center;}
#modeSelector label{color:rgba(200,160,60,0.8);font:11px monospace;margin-right:10px;}
#modeSelector input{margin-right:3px;}
#contactSheet{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:20px;background:#111;}
#contactSheet.large{display:block;}
#contactSheet.compare{display:block;}
#contactSheet.comparelarge{display:block;}
#contactSheet.hidden{display:none;}
.frameContainer{text-align:center;}
.frameCanvas{border:1px solid rgba(255,200,80,0.3);width:100%;}
.frameLabel{color:rgba(200,160,60,0.8);font:10px monospace;margin-top:4px;white-space:pre;}
.largeFrame{margin:0 auto 28px;max-width:880px;}
.largeFrame canvas{display:block;width:880px;height:560px;border:1px solid rgba(255,200,80,0.3);}
.largeFrameLabel{color:rgba(200,160,60,0.8);font:10px monospace;margin-top:4px;white-space:pre;text-align:center;padding-bottom:12px;}
.compareRow{display:flex;gap:12px;justify-content:center;margin-bottom:18px;}
.compareCell{text-align:center;}
.compareCell canvas{display:block;width:280px;height:180px;border:1px solid rgba(255,200,80,0.3);}
.compareLargeRow{margin-bottom:36px;}
.compareLargeRowLabel{color:rgba(200,160,60,0.9);font:12px monospace;padding:8px 20px;text-align:center;}
.compareLargePanels{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;}
.compareLargePanels canvas{display:block;border:1px solid rgba(255,200,80,0.3);}
.compareLargePanelLabel{color:rgba(200,160,60,0.7);font:10px monospace;text-align:center;margin-top:3px;}
#downloadSection{text-align:center;}
#downloadSection.hidden{display:none;}
#downloadBtn{color:rgba(200,160,60,0.8);background:none;border:1px solid rgba(200,160,60,0.4);border-radius:10px;padding:6px 12px;font:11px monospace;cursor:pointer;margin:16px;}
#downloadBtn:hover{background:rgba(200,160,60,0.12);}
#downloadStatus{color:rgba(200,160,60,0.6);font:11px monospace;}
#testHeader{color:rgba(200,160,60,0.8);font:13px monospace;padding:12px;text-align:center;}
#exportPanel{position:fixed;right:14px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:7px;z-index:99;}
.exportBtn{color:rgba(200,160,60,0.82);background:rgba(0,0,0,0.72);border:1px solid rgba(255,200,80,0.28);border-radius:9px;padding:5px 11px;font:10px monospace;cursor:pointer;white-space:nowrap;text-align:left;}
.exportBtn:hover{background:rgba(255,200,80,0.10);border-color:rgba(255,200,80,0.55);}
.exportBtn:disabled{opacity:0.38;cursor:default;}
#exportStatus{color:rgba(200,160,60,0.55);font:9px monospace;text-align:right;max-width:160px;word-break:break-word;}
</style>
</head>
<body>
<canvas id="scene" width="880" height="560"></canvas>
<div id="stateReadout"></div>
<div id="controls">
  <label>t =</label>
  <input type="range" id="slider" min="0" max="1000" value="0">
  <span id="tval">0.000</span>
  <button id="pauseBtn">pause</button>
</div>
<div id="reviewHeader" style="display:none;">
  Sourdough Fermentation Frame Review
  <div id="modeSelector">
    <label><input type="radio" name="reviewMode" value="matrix" /> Matrix</label>
    <label><input type="radio" name="reviewMode" value="gas" /> Gas</label>
    <label><input type="radio" name="reviewMode" value="films" /> Films</label>
    <label><input type="radio" name="reviewMode" value="microbes" /> Microbes</label>
    <label><input type="radio" name="reviewMode" value="events" /> Events</label>
    <label><input type="radio" name="reviewMode" value="full" checked /> Full</label>
  </div>
</div>
<div id="testHeader" style="display:none;"></div>
<div id="exportPanel" style="display:none;">
  <button class="exportBtn" id="expCompareModes">⬇ compareModes sheet</button>
  <button class="exportBtn" id="expLargeFull">⬇ large full sheet</button>
  <button class="exportBtn" id="expYeast">⬇ yeast close-up sheet</button>
  <button class="exportBtn" id="expLAB">⬇ LAB close-up sheet</button>
  <button class="exportBtn" id="expGlutenFilm">⬇ gluten film sheet</button>
  <button class="exportBtn" id="expGasCell">⬇ gas cell sheet</button>
  <div id="exportStatus"></div>
</div>
<div id="contactSheet" style="display:none;"></div>
<div id="downloadSection" style="display:none;text-align:center;">
  <button id="downloadBtn">Download Contact Sheet PNG</button>
  <p id="downloadStatus"></p>
</div>
<` + `script>
`;

const init=`

// ───────────────────────────────────────────────────────────────────────────────
//  REVIEW / INIT
// ───────────────────────────────────────────────────────────────────────────────
const REVIEW_FRAMES=[0,0.12,0.25,0.38,0.50,0.62,0.75,0.88,1.0];
const FRAME_LABELS=[
  't=0.00 Hydration',
  't=0.12 Early enzyme/starch',
  't=0.25 Early ferment',
  't=0.38 Gas forming',
  't=0.50 Peak activity',
  't=0.62 Windowpane/peak',
  't=0.75 Acid/protease risk',
  't=0.88 Collapse',
  't=1.00 Over-fermented'
];
const DIAG_MODES=['matrix','gas','films','microbes','events','full'];

function updateStateReadout(t,mode){
  const el=document.getElementById('stateReadout');
  if(!el||el.style.display==='none')return;
  const s=getStateSummary(t);
  el.textContent='t='+t.toFixed(3)+'  mode='+mode
    +'  yeasts='+s.visibleYeasts+'  LAB='+s.visibleLABChains
    +'  sugarVisible='+s.visibleSugarParticles+'  CO2='+s.visibleCO2Nuclei
    +'  protease='+s.visibleProteaseSites+'  gasCells='+(s.inflatedCells||s.totalGasCells||0)
    +'  tornWalls='+s.wallsTorn+'  specks='+s.visibleSpecks;
}

function renderAt(t,mode){
  mode=mode||'full';
  t=Math.max(0,Math.min(1,Number(t)));
  const canvas=document.getElementById('scene');
  const ctx=canvas.getContext('2d');
  render(ctx,t,mode);
  const slider=document.getElementById('slider');
  const tval=document.getElementById('tval');
  if(slider)slider.value=Math.round(t*1000);
  if(tval)tval.textContent=t.toFixed(3);
  updateStateReadout(t,mode);
  return getStateSummary(t);
}

function summaryLine(s){
  return s.stageName+'  P='+s.peakness+' S='+s.structuring+' D='+s.decay
    +'  Y='+s.visibleYeasts+' L='+s.visibleLABChains+' Sg='+s.visibleSugarParticles
    +' CO2='+s.visibleCO2Nuclei+' Prot='+s.visibleProteaseSites+' Spk='+s.visibleSpecks
    +' torn='+s.wallsTorn+' merge='+s.gasMerges
    +' cells='+(s.inflatedCells||s.totalGasCells||0);
}

// Standard 3x3 grid (thumbnails)
function renderContactSheet(mode){
  const sheet=document.getElementById('contactSheet');
  sheet.className='';sheet.innerHTML='';
  for(let i=0;i<REVIEW_FRAMES.length;i++){
    const frameT=REVIEW_FRAMES[i];
    const frameCanvas=document.createElement('canvas');
    frameCanvas.className='frameCanvas';
    frameCanvas.width=280;frameCanvas.height=180;
    render(frameCanvas.getContext('2d'),frameT,mode);
    const container=document.createElement('div');
    container.className='frameContainer';
    container.appendChild(frameCanvas);
    const summary=getStateSummary(frameT);
    const labelText=document.createElement('div');
    labelText.className='frameLabel';
    labelText.textContent=FRAME_LABELS[i]+'\\nY='+summary.visibleYeasts+' L='+summary.visibleLABChains+' S='+summary.visibleSugarParticles;
    container.appendChild(labelText);
    sheet.appendChild(container);
  }
}

// large : full 880x560 frames stacked vertically, with state summary line
function renderContactSheetLarge(mode){
  const sheet=document.getElementById('contactSheet');
  sheet.className='large';sheet.innerHTML='';
  for(let i=0;i<REVIEW_FRAMES.length;i++){
    const frameT=REVIEW_FRAMES[i];
    const wrap=document.createElement('div');
    wrap.className='largeFrame';
    const c=document.createElement('canvas');
    c.width=880;c.height=560;
    render(c.getContext('2d'),frameT,mode);
    wrap.appendChild(c);
    const lbl=document.createElement('div');
    lbl.className='largeFrameLabel';
    lbl.textContent=FRAME_LABELS[i]+'\\n'+summaryLine(getStateSummary(frameT));
    wrap.appendChild(lbl);
    sheet.appendChild(wrap);
  }
}

// compareModes: per t, a row of all diag modes at 280x180
function renderContactSheetCompare(){
  const sheet=document.getElementById('contactSheet');
  sheet.className='compare';sheet.innerHTML='';
  for(let i=0;i<REVIEW_FRAMES.length;i++){
    const frameT=REVIEW_FRAMES[i];
    const row=document.createElement('div');
    row.className='compareRow';
    for(const m of DIAG_MODES){
      const cell=document.createElement('div');
      cell.className='compareCell';
      const c=document.createElement('canvas');
      c.width=280;c.height=180;
      render(c.getContext('2d'),frameT,m);
      cell.appendChild(c);
      const lbl=document.createElement('div');
      lbl.className='frameLabel';
      lbl.textContent='t='+frameT.toFixed(2)+'  '+m;
      cell.appendChild(lbl);
      row.appendChild(cell);
    }
    sheet.appendChild(row);
  }
}

// compareModes+large: per t, full 880x560 panels for each diag mode, stacked
function renderContactSheetCompareLarge(){
  const sheet=document.getElementById('contactSheet');
  sheet.className='comparelarge';sheet.innerHTML='';
  for(let i=0;i<REVIEW_FRAMES.length;i++){
    const frameT=REVIEW_FRAMES[i];
    const block=document.createElement('div');
    block.className='compareLargeRow';
    const rowLbl=document.createElement('div');
    rowLbl.className='compareLargeRowLabel';
    rowLbl.textContent=FRAME_LABELS[i]+'    '+summaryLine(getStateSummary(frameT));
    block.appendChild(rowLbl);
    const panels=document.createElement('div');
    panels.className='compareLargePanels';
    for(const m of DIAG_MODES){
      const wrap=document.createElement('div');
      const c=document.createElement('canvas');
      c.width=880;c.height=560;
      render(c.getContext('2d'),frameT,m);
      c.style.maxWidth='880px';
      wrap.appendChild(c);
      const plbl=document.createElement('div');
      plbl.className='compareLargePanelLabel';
      plbl.textContent=m;
      wrap.appendChild(plbl);
      panels.appendChild(wrap);
    }
    block.appendChild(panels);
    sheet.appendChild(block);
  }
}

function downloadContactSheetPNG(){
  const totalW=880,totalH=540;
  const compositeCanvas=document.createElement('canvas');
  compositeCanvas.width=totalW;compositeCanvas.height=totalH;
  const cctx=compositeCanvas.getContext('2d');
  cctx.fillStyle='#000';cctx.fillRect(0,0,totalW,totalH);
  const cols=3,rows=3,fw=Math.floor(totalW/cols),fh=Math.floor(totalH/rows);
  for(let i=0;i<REVIEW_FRAMES.length;i++){
    const col=i%cols,row=Math.floor(i/cols);
    const tmp=document.createElement('canvas');tmp.width=fw;tmp.height=fh;
    render(tmp.getContext('2d'),REVIEW_FRAMES[i],window.__renderMode||'full');
    cctx.drawImage(tmp,col*fw,row*fh);
  }
  const link=document.createElement('a');
  link.download='fermentation-contact-sheet.png';
  link.href=compositeCanvas.toDataURL('image/png');
  link.click();
  document.getElementById('downloadStatus').textContent='Downloaded contact sheet.';
}

// ───────────────────────────────────────────────────────────────────────────────
//  ONE-CLICK PNG EXPORTS
// ───────────────────────────────────────────────────────────────────────────────
function downloadPNG(dataURL,filename){
  const a=document.createElement('a');a.download=filename;a.href=dataURL;a.click();
}
function setExportStatus(msg){
  const el=document.getElementById('exportStatus');if(el)el.textContent=msg;
}
function withBusy(btn,label,fn){
  btn.disabled=true;btn.textContent='rendering…';setExportStatus('');
  requestAnimationFrame(()=>{
    try{fn();}catch(e){setExportStatus('error: '+e.message);}
    btn.disabled=false;btn.textContent=label;
  });
}

// compareModes sheet: 9 time steps x 6 modes, 440x280 per panel, 6 cols x 9 rows
function exportCompareModes(){
  const CW=440,CH=280,cols=6,rows=REVIEW_FRAMES.length;
  const out=document.createElement('canvas');
  out.width=CW*cols;out.height=CH*rows;
  const oc=out.getContext('2d');oc.fillStyle='#000';oc.fillRect(0,0,out.width,out.height);
  const tmp=document.createElement('canvas');tmp.width=CW;tmp.height=CH;
  const tc=tmp.getContext('2d');
  for(let r=0;r<rows;r++){
    for(let ci=0;ci<cols;ci++){
      render(tc,REVIEW_FRAMES[r],DIAG_MODES[ci]);
      oc.drawImage(tmp,ci*CW,r*CH);
      oc.fillStyle='rgba(200,160,60,0.7)';oc.font='11px monospace';
      oc.fillText(DIAG_MODES[ci]+' t='+REVIEW_FRAMES[r].toFixed(2),ci*CW+5,r*CH+14);
    }
  }
  downloadPNG(out.toDataURL('image/png'),'fermentation-compare-modes.png');
  setExportStatus('saved compare-modes.png');
}

// large full sheet: 9 frames at 880x560, stacked vertically
function exportLargeFull(){
  const FW=880,FH=560,rows=REVIEW_FRAMES.length;
  const out=document.createElement('canvas');
  out.width=FW;out.height=FH*rows;
  const oc=out.getContext('2d');oc.fillStyle='#000';oc.fillRect(0,0,out.width,out.height);
  const tmp=document.createElement('canvas');tmp.width=FW;tmp.height=FH;
  const tc=tmp.getContext('2d');
  for(let r=0;r<rows;r++){
    render(tc,REVIEW_FRAMES[r],'full');
    oc.drawImage(tmp,0,r*FH);
    oc.fillStyle='rgba(200,160,60,0.75)';oc.font='12px monospace';
    const s=getStateSummary(REVIEW_FRAMES[r]);
    oc.fillText(FRAME_LABELS[r]+'  '+summaryLine(s),6,r*FH+16);
  }
  downloadPNG(out.toDataURL('image/png'),'fermentation-large-full.png');
  setExportStatus('saved large-full.png');
}

// close-up test sheet: 9 frames at 880x560 using one of the test render functions
function exportTestSheet(testFn,filename){
  const FW=880,FH=560,rows=REVIEW_FRAMES.length;
  const out=document.createElement('canvas');
  out.width=FW;out.height=FH*rows;
  const oc=out.getContext('2d');oc.fillStyle='#000';oc.fillRect(0,0,out.width,out.height);
  const tmp=document.createElement('canvas');tmp.width=FW;tmp.height=FH;
  const tc=tmp.getContext('2d');
  for(let r=0;r<rows;r++){
    tc.clearRect(0,0,FW,FH);
    testFn(tc,FW,FH,REVIEW_FRAMES[r]);
    oc.drawImage(tmp,0,r*FH);
    oc.fillStyle='rgba(200,160,60,0.65)';oc.font='11px monospace';
    oc.fillText(FRAME_LABELS[r],6,r*FH+14);
  }
  downloadPNG(out.toDataURL('image/png'),filename);
  setExportStatus('saved '+filename);
}

function wireExportButtons(){
  const defs=[
    ['expCompareModes','⬇ compareModes sheet',()=>exportCompareModes()],
    ['expLargeFull',   '⬇ large full sheet',  ()=>exportLargeFull()],
    ['expYeast',       '⬇ yeast close-up sheet',    ()=>exportTestSheet(renderYeastTest,'fermentation-yeast.png')],
    ['expLAB',         '⬇ LAB close-up sheet',      ()=>exportTestSheet(renderLABTest,'fermentation-lab.png')],
    ['expGlutenFilm',  '⬇ gluten film sheet',        ()=>exportTestSheet(renderGlutenFilmTest,'fermentation-glutenfilm.png')],
    ['expGasCell',     '⬇ gas cell sheet',           ()=>exportTestSheet(renderGasCellTest,'fermentation-gascell.png')],
  ];
  for(const[id,label,fn]of defs){
    const btn=document.getElementById(id);
    if(btn)btn.addEventListener('click',()=>withBusy(btn,label,fn));
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  TEST MODE RENDERERS (close-up diagnostic)
// ───────────────────────────────────────────────────────────────────────────────
function runTestMode(testName,largeMode){
  const canvas=document.getElementById('scene');
  const ctx=canvas.getContext('2d');
  const W=canvas.width,H=canvas.height;
  const hdr=document.getElementById('testHeader');
  hdr.style.display='block';
  hdr.textContent='TEST: '+testName+(largeMode?' (large)':'');

  const DURATION=90000;
  let startTime=null,paused=false;
  const pauseBtn=document.getElementById('pauseBtn');
  const slider=document.getElementById('slider');
  const tval=document.getElementById('tval');
  const readout=document.getElementById('stateReadout');
  if(readout)readout.style.display='block';

  function drawTest(t){
    ctx.clearRect(0,0,W,H);
    if(testName==='yeast')renderYeastTest(ctx,W,H,t);
    else if(testName==='lab')renderLABTest(ctx,W,H,t);
    else if(testName==='glutenFilm')renderGlutenFilmTest(ctx,W,H,t);
    else if(testName==='gasCell')renderGasCellTest(ctx,W,H,t);
    if(slider)slider.value=Math.round(t*1000);
    if(tval)tval.textContent=t.toFixed(3);
    updateStateReadout(t,'test:'+testName);
  }

  const frameParam=new URLSearchParams(window.location.search).get('frame');
  if(frameParam!==null){
    const t=Math.max(0,Math.min(1,parseFloat(frameParam)||0));
    drawTest(t);
    pauseBtn.textContent='play';
    pauseBtn.addEventListener('click',()=>{paused=!paused;pauseBtn.textContent=paused?'play':'pause';if(!paused)startTime=null;});
    slider.addEventListener('input',()=>{const t=slider.value/1000;drawTest(t);if(!paused){paused=true;pauseBtn.textContent='play';}});
    return;
  }

  pauseBtn.addEventListener('click',()=>{paused=!paused;pauseBtn.textContent=paused?'play':'pause';if(!paused)startTime=null;});
  slider.addEventListener('input',()=>{const t=slider.value/1000;drawTest(t);if(!paused){paused=true;pauseBtn.textContent='play';}});

  loadSheets(()=>{
    requestAnimationFrame(function frame(now){
      if(!paused){
        if(!startTime)startTime=now;
        drawTest(((now-startTime)%DURATION)/DURATION);
      }
      requestAnimationFrame(frame);
    });
  });
}

// ───────────────────────────────────────────────────────────────────────────────
//  SETUP & LOOP
// ───────────────────────────────────────────────────────────────────────────────
(function(){
  const canvas=document.getElementById('scene');
  const ctx=canvas.getContext('2d');
  const slider=document.getElementById('slider');
  const tval=document.getElementById('tval');
  const pauseBtn=document.getElementById('pauseBtn');

  const urlParams=new URLSearchParams(window.location.search);
  const reviewMode=urlParams.has('contactSheet')&&urlParams.get('contactSheet')!=='0';
  const largeMode=urlParams.has('large')&&urlParams.get('large')!=='0';
  const compareMode=urlParams.has('compareModes')&&urlParams.get('compareModes')!=='0';
  const testParam=urlParams.get('test');
  const frameParam=urlParams.get('frame');
  const modeParam=urlParams.get('mode')||'full';
  const validModes=['matrix','gas','films','microbes','events','full','foam'];
  let renderMode=validModes.includes(modeParam)?modeParam:'full';
  if(renderMode==='foam')renderMode='films';
  window.__renderMode=renderMode;

  FOAM=buildFoam(canvas.width,canvas.height);

  // Export panel — visible in all modes
  document.getElementById('exportPanel').style.display='flex';
  wireExportButtons();

  // expose API for external scripts
  function captureFrame(t,mode){
    mode=mode||renderMode;
    t=Math.max(0,Math.min(1,Number(t)));
    const off=document.createElement('canvas');
    off.width=canvas.width;off.height=canvas.height;
    render(off.getContext('2d'),t,mode);
    return off.toDataURL('image/png');
  }
  function captureContactSheet(mode){
    mode=mode||renderMode;
    const cols=3,fw=Math.round(canvas.width/cols),fh=Math.round(canvas.height/Math.ceil(REVIEW_FRAMES.length/cols));
    const off=document.createElement('canvas');
    off.width=fw*cols;off.height=fh*Math.ceil(REVIEW_FRAMES.length/cols);
    const octx=off.getContext('2d');
    octx.fillStyle='#000';octx.fillRect(0,0,off.width,off.height);
    REVIEW_FRAMES.forEach((ft,i)=>{
      const col=i%cols,row=Math.floor(i/cols);
      const tmp=document.createElement('canvas');tmp.width=fw;tmp.height=fh;
      render(tmp.getContext('2d'),ft,mode);
      octx.drawImage(tmp,col*fw,row*fh);
    });
    return off.toDataURL('image/png');
  }
  window.__fermentationPreview={
    renderAt:(t,mode)=>renderAt(t,mode||renderMode),
    captureFrame,
    captureContactSheet,
    getStateSummary,
    renderMode:()=>renderMode,
  };

  // ── TEST MODE ──
  if(testParam){
    document.getElementById('controls').style.display='flex';
    document.getElementById('stateReadout').style.display='block';
    runTestMode(testParam,largeMode);
    return;
  }

  // ── CONTACT SHEET (REVIEW) MODE ──
  if(reviewMode){
    document.getElementById('controls').style.display='none';
    document.getElementById('scene').style.display='none';
    document.getElementById('reviewHeader').style.display='block';
    document.getElementById('contactSheet').style.display='block';
    document.getElementById('downloadSection').style.display='block';

    function drawReview(){
      if(compareMode&&largeMode)renderContactSheetCompareLarge();
      else if(compareMode)renderContactSheetCompare();
      else if(largeMode)renderContactSheetLarge(renderMode);
      else renderContactSheet(renderMode);
    }
    drawReview();

    const radios=document.querySelectorAll('input[name="reviewMode"]');
    radios.forEach(r=>{if(r.value===renderMode)r.checked=true;});
    radios.forEach(radio=>{
      radio.addEventListener('change',(e)=>{
        renderMode=e.target.value;
        window.__renderMode=renderMode;
        drawReview();
      });
    });
    document.getElementById('downloadBtn').addEventListener('click',downloadContactSheetPNG);
    return;
  }

  // ── SINGLE FRAME MODE ──
  if(frameParam!==null){
    const t=Math.max(0,Math.min(1,parseFloat(frameParam)||0));
    if(!isNaN(t)){
      document.getElementById('stateReadout').style.display='block';
      renderAt(t,renderMode);
      pauseBtn.textContent='play';
    }
    pauseBtn.addEventListener('click',()=>{
      let paused=true,startTime=null;
      pauseBtn.addEventListener('click',function toggle(){
        paused=!paused;pauseBtn.textContent=paused?'play':'pause';
        if(!paused)startTime=null;
      });
      const DURATION=90000;
      requestAnimationFrame(function frame(now){
        if(!paused){if(!startTime)startTime=now;renderAt(((now-startTime)%DURATION)/DURATION,renderMode);}
        requestAnimationFrame(frame);
      });
      pauseBtn.removeEventListener('click',toggle);
    });
    slider.addEventListener('input',()=>{renderAt(slider.value/1000,renderMode);});
    return;
  }

  // ── LIVE ANIMATION MODE ──
  document.getElementById('stateReadout').style.display='block';
  const DURATION=90000;
  let startTime=null,paused=false;
  pauseBtn.addEventListener('click',()=>{paused=!paused;pauseBtn.textContent=paused?'play':'pause';if(!paused)startTime=null;});
  slider.addEventListener('input',()=>{const t=slider.value/1000;renderAt(t,renderMode);if(!paused){paused=true;pauseBtn.textContent='play';}});
  loadSheets(()=>{
    requestAnimationFrame(function frame(now){
      if(!paused){
        if(!startTime)startTime=now;
        renderAt(((now-startTime)%DURATION)/DURATION,renderMode);
      }
      requestAnimationFrame(frame);
    });
  });
})();

<` + `/script>
</body>
</html>
`;

const out=head+body+init;
if(/<\/script>/i.test(out.slice(head.length, head.length+body.length)))throw new Error('body has closing script tag');
fs.writeFileSync(path.join(dir,'..','fermentation-preview.html'),out,'utf8');
console.log('Wrote fermentation-preview.html ('+Buffer.byteLength(out)+' bytes)');
