import * as THREE from './vendor/three.module.js';
import { EffectComposer } from './vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/addons/postprocessing/RenderPass.js';
import { GTAOPass } from './vendor/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from './vendor/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/addons/postprocessing/OutputPass.js';
import { districtMaterial, MiniatureLensPass, lightingAt, weatherLightingAt } from './appearance.js?v=23';
import { lotAt, lotPoint, lotMatrix, surroundingTown, trafficPaths } from './district.js?v=21';
import { createWeatherEffects } from './weather.js?v=19';
import { createSnowCoverState, advanceSnowCover } from './snow-cover.js?v=23';

// An independently built miniature exchange district. All architecture is procedural.
const SPACING = 16;
const X_PROFILE_URL = 'https://x.com/blocktown_fun';
const palettes = ['#f0ca56', '#ee6faa', '#dedbd4', '#d8b157', '#4e83cf', '#9181b8', '#c19372', '#71c897', '#66b9bd', '#8f95cb', '#56b6a2', '#8d879a', '#b8a571', '#bbc9ae'];
const skinColors = ['#f0c9a8', '#d6a27c', '#a8714c', '#f6d8bf'];
const clothingColors = ['#f1ede6', '#d0463b', '#3f6cb0', '#4f9a6a', '#e7c24a', '#e58fb0', '#8f98a3', '#2c3036', '#e3793d', '#7bb7d8', '#a4d06a'];
const pantsColors = ['#2f3a55', '#26282c', '#5d6570', '#a58e6b', '#3b4d3f'];
const hairColors = ['#3a2a20', '#1d1b1a', '#d9b36a', '#f4f2ee', '#4a3327', '#6d4a33', '#2a2422', '#9a9ea4'];
const shoeColors = ['#3f3f40', '#3b3c3d'];
const v = new THREE.Vector3();
const dummy = new THREE.Object3D();
const clamp = THREE.MathUtils.clamp;

function random(seed) {
  let value = seed >>> 0;
  return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296; };
}

function mergeGeometries(geometries) {
  let count = 0;
  const clean = geometries.map(g => g.index ? g.toNonIndexed() : g);
  for (const g of clean) count += g.getAttribute('position').count;
  const result = new THREE.BufferGeometry();
  for (const key of ['position', 'normal', 'uv']) {
    const size = key === 'uv' ? 2 : 3;
    const out = new Float32Array(count * size);
    let offset = 0;
    for (const g of clean) { const a = g.getAttribute(key); if (a) out.set(a.array, offset); offset += g.getAttribute('position').count * size; }
    result.setAttribute(key, new THREE.BufferAttribute(out, size));
  }
  result.computeBoundingSphere();
  for (let i = 0; i < geometries.length; i++) { geometries[i].dispose(); if (clean[i] !== geometries[i]) clean[i].dispose(); }
  return result;
}

function drawLogo(ctx, name, x, y, size, color, image) {
  if (image?.complete && image.naturalWidth) { ctx.drawImage(image, x - size / 2, y - size / 2, size, size); return; }
  ctx.save(); ctx.translate(x, y); ctx.fillStyle = color;
  const key = name.toLowerCase();
  if (key.includes('binance')) {
    ctx.rotate(Math.PI / 4);
    for (const [a, b, s] of [[0, 0, .18], [-.27, 0, .16], [.27, 0, .16], [0, -.27, .16], [0, .27, .16]]) ctx.fillRect((a - s / 2) * size, (b - s / 2) * size, s * size, s * size);
  } else if (key.includes('okx')) {
    for (const [a,b] of [[-1,-1],[1,-1],[0,0],[-1,1],[1,1]]) ctx.fillRect(a*size*.24-size*.11,b*size*.24-size*.11,size*.22,size*.22);
  } else if (key.includes('coinbase')) {
    ctx.beginPath();ctx.arc(0,0,size*.4,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.fillRect(-size*.17,-size*.17,size*.34,size*.34);
  } else {
    ctx.font=`700 ${size*.8}px "DM Sans", Arial`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(name[0],0,0);
  }
  ctx.restore();
}

function signTexture(record, accent, small = false) {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = small ? 256 : 256;
  const ctx = canvas.getContext('2d');
  const name = record.name || record.label || record.id || 'Exchange';
  const light = !name.toLowerCase().includes('binance');
  const draw = image => {
    ctx.clearRect(0,0,1024,256);
    ctx.fillStyle=light ? '#e8e4d9' : accent;ctx.fillRect(0,0,1024,256);
    const logoSize = 180;
    ctx.fillStyle = name.toLowerCase().includes('binance') ? '#222938' : accent;
    ctx.fillRect(36,38,logoSize,logoSize);
    drawLogo(ctx,name,126,128,logoSize,light?'#f9f5e7':accent,image);
    ctx.fillStyle = name.toLowerCase().includes('binance') ? '#fff3ca' : '#28292b';
    let fontSize = 182;
    ctx.font=`500 ${fontSize}px "DM Sans", Arial`;
    while(ctx.measureText(name).width > 740) {fontSize-=4;ctx.font=`500 ${fontSize}px "DM Sans", Arial`;}
    ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(name,260,143);
    ctx.fillStyle='rgba(0,0,0,.14)';ctx.fillRect(0,246,1024,10);
  };
  draw();
  const tex = new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;tex.userData.brandSign=true;
  const source = record.logo || record.image || record.icon;
  if (source && typeof source === 'string') {
    const image = new Image(); image.crossOrigin='anonymous';image.onload=()=>{draw(image);tex.needsUpdate=true;};image.src=source;
  }
  return tex;
}

function plaqueTexture(record, accent) {
  const canvas = document.createElement('canvas');canvas.width=512;canvas.height=768;const ctx=canvas.getContext('2d');
  ctx.fillStyle='#e5dfd1';ctx.fillRect(0,0,512,768);ctx.fillStyle='#464743';
  const rawVolume = record.volume24h ?? record.volume;
  const volume = record.volumeFormatted || record.volumeLabel || record.formattedVolume || record.volumeText || (rawVolume === null || rawVolume === undefined ? '—' : rawVolume >= 1e9 ? (rawVolume / 1e9).toFixed(1)+'B' : (rawVolume / 1e6).toFixed(0)+'M');
  ctx.font='600 91px "DM Sans", Arial';ctx.fillText(volume,36,120);ctx.font='19px "DM Sans", Arial';ctx.fillText('24H TRADING VOLUME',38,156);
  ctx.fillStyle='#7b786f';ctx.fillRect(36,195,436,2);ctx.font='23px "DM Sans", Arial';ctx.fillText('Exchange type',36,247);ctx.font='bold 23px "DM Sans", Arial';ctx.fillText(record.type === 'DEX' ? 'Decentralized Exchange' : 'Centralized Exchange',36,290);
  ctx.font='21px "DM Sans", Arial';ctx.fillText('Real activity.',36,374);ctx.fillText('One global market.',36,410);
  ctx.fillStyle=accent;ctx.fillRect(38,463,58,5);ctx.fillStyle='#858177';ctx.font='17px "DM Sans", Arial';ctx.fillText('BLOCKTOWN  ·  LIVE',38,685);
  const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;return tex;
}

export function createTown(container, records) {
  const scene = new THREE.Scene();scene.background=new THREE.Color('#68717d');scene.fog=new THREE.FogExp2('#747882',.012);
  const camera=new THREE.PerspectiveCamera(30,1,.5,160);camera.position.set(13,17,21);
  const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;
  renderer.domElement.setAttribute('aria-label','A living three-dimensional exchange town');container.appendChild(renderer.domElement);
  const hemi=new THREE.HemisphereLight('#c4d4ee','#9d8c73',2.1);scene.add(hemi);
  const sun=new THREE.DirectionalLight('#ffe1b3',2.25);sun.position.set(-14,28,16);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-25;sun.shadow.camera.right=25;sun.shadow.camera.top=25;sun.shadow.camera.bottom=-25;sun.shadow.camera.near=.1;sun.shadow.camera.far=85;sun.shadow.bias=-.0002;sun.shadow.normalBias=.03;sun.shadow.radius=2;scene.add(sun);scene.add(sun.target);
  const fill=new THREE.DirectionalLight('#becfed',.5);fill.position.set(6,12,-12);scene.add(fill);
  const batches=new Map(), materials=new Map(), lightMaterials=[], labelPositions=[], pickups=[], cars=[], pedestrians=[], dynamicGroups=[], plaques=[], crowdLimits=records.map(()=>50);
  const textureMaterials=[],linkTargets=[],metadataPanels=[];
  const warmLightPool=[],warmLighting={positions:{value:Array.from({length:10},()=>new THREE.Vector4())},colors:{value:Array.from({length:10},()=>new THREE.Vector4())}};
  // The mask follows the same curves and lane offset as the moving vehicles.
  const trackCanvas=document.createElement('canvas');trackCanvas.width=trackCanvas.height=1024;
  const trackContext=trackCanvas.getContext('2d'),trackSize=256,trackScale=1024/trackSize;
  trackContext.fillStyle='#000';trackContext.fillRect(0,0,1024,1024);
  trackContext.strokeStyle='#fff';trackContext.lineWidth=1.35;trackContext.lineCap='round';trackContext.lineJoin='round';
  for(const route of trafficPaths)for(const wheel of [-.35,.35]){
    trackContext.beginPath();
    for(let sample=0;sample<=480;sample++){
      const u=sample/480,p=route.getPointAt(u),t=route.getTangentAt(u),lane=.72+wheel;
      const px=(p.x+t.z*lane-14.8+trackSize/2)*trackScale,pz=(p.z-t.x*lane-14.8+trackSize/2)*trackScale;
      if(sample===0)trackContext.moveTo(px,pz);else trackContext.lineTo(px,pz);
    }
    trackContext.stroke();
  }
  const trackTexture=new THREE.CanvasTexture(trackCanvas);trackTexture.flipY=false;
  const surfaceWeather={wetness:{value:0},roofSnow:{value:0},groundSnow:{value:0},roadTracks:{value:trackTexture}};
  let snowCover=createSnowCoverState();
  const featuredActor=new THREE.Vector3();let featuredVisible=false;
  const focusCenter={value:new THREE.Vector3(7.4,0,7.4)};
  const lotMatrices=records.map((_,i)=>lotMatrix(i));let activeLot=-1;
  function placeInLot(object){if(activeLot>=0)object.applyMatrix4(lotMatrices[activeLot]);return object;}
  function material(color, options={}) {
    const key=color+JSON.stringify(options);if(materials.has(key))return materials.get(key);
    const {townColorMode,townSaturation,townWarmLift,townSnowRoad,townSnowRetention,...surface}=options;
    const roughness=color==='#8d8a86'?.95:records.some(record=>record.color===color)?.7:.85;
    const raw=new THREE.MeshStandardMaterial({color,roughness,metalness:0,...surface});
    raw.userData={townColorMode,townSaturation,townWarmLift,townSnowRoad,townSnowRetention};
    const m=districtMaterial(raw,focusCenter,warmLighting,surfaceWeather);materials.set(key,m);return m;
  }
  function staticGeometry(geo,mat,x,y,z,rx=0,ry=0,rz=0) {
    dummy.position.set(x,y,z);dummy.rotation.set(rx,ry,rz);dummy.scale.set(1,1,1);dummy.updateMatrix();geo.applyMatrix4(dummy.matrix);if(activeLot>=0)geo.applyMatrix4(lotMatrices[activeLot]);
    if(!batches.has(mat))batches.set(mat,[]);batches.get(mat).push(geo);
  }
  function box(x,y,z,w,h,d,color,rotation=0) {staticGeometry(new THREE.BoxGeometry(w,h,d),typeof color==='string'?material(color):color,x,y,z,0,rotation);}
  function cylinder(x,y,z,r,h,color,segments=10,top=r) {staticGeometry(new THREE.CylinderGeometry(top,r,h,segments),typeof color==='string'?material(color):color,x,y,z);}
  function orb(x,y,z,r,color) {staticGeometry(new THREE.IcosahedronGeometry(r,0),typeof color==='string'?material(color):color,x,y,z);}
  function plane(x,y,z,w,h,map,rotation=0) {
    const mat=districtMaterial(new THREE.MeshStandardMaterial({map,roughness:.86,metalness:0,side:THREE.DoubleSide,...(map.userData.brandSign?{emissive:'#ffe3c4',emissiveMap:map,emissiveIntensity:.18}:{})}),focusCenter,warmLighting,surfaceWeather);mat.userData.lotIndex=activeLot;textureMaterials.push(mat);
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat);mesh.position.set(x,y,z);mesh.rotation.y=rotation;placeInLot(mesh);scene.add(mesh);return mesh;
  }
  const sidewalkMat=material('#d2c9b9'), pavementMat=material('#b9b5ab'), roadMat=material('#515963',{townSnowRoad:true}), whiteMat=material('#dad5c7'), blackMat=material('#343b40'), metalMat=material('#777e78',{metalness:.35,roughness:.5});
  const windowMat=material('#eee2bd',{emissive:'#ffefbd',emissiveIntensity:.28,roughness:.3,metalness:.1});lightMaterials.push(windowMat);
  function warmWindow(x,y,z,w,h,rotation=0){
    const mat=districtMaterial(new THREE.MeshStandardMaterial({color:'#ffdcae',emissive:'#ffb866',emissiveIntensity:.7,roughness:.6}),focusCenter,warmLighting,surfaceWeather);mat.userData={upperWindow:true,lotIndex:activeLot};lightMaterials.push(mat);textureMaterials.push(mat);
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat);mesh.position.set(x,y,z);mesh.rotation.y=rotation;placeInLot(mesh);scene.add(mesh);
  }
  function localWarmLight(x,y,z,color,radius,intensity,street=false){const position=new THREE.Vector3(x,y,z);if(activeLot>=0)position.applyMatrix4(lotMatrices[activeLot]);warmLightPool.push({position,color:new THREE.Color(color),radius,intensity,lotIndex:street?-1:activeLot,street});}
  function roundedSlab(x,y,z,w,d,h,r,mat) {
    const shape=new THREE.Shape(),l=-w/2,b=-d/2,t=d/2,right=w/2;
    shape.moveTo(l+r,b);shape.lineTo(right-r,b);shape.quadraticCurveTo(right,b,right,b+r);
    shape.lineTo(right,t-r);shape.quadraticCurveTo(right,t,right-r,t);shape.lineTo(l+r,t);
    shape.quadraticCurveTo(l,t,l,t-r);shape.lineTo(l,b+r);shape.quadraticCurveTo(l,b,l+r,b);
    const geo=new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false,curveSegments:10});geo.rotateX(-Math.PI/2);
    const pos=geo.getAttribute('position'),uv=geo.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setXY(i,pos.getX(i)/w+.5,pos.getZ(i)/d+.5);
    staticGeometry(geo,mat,x,y-h/2,z);
  }
  function softenedBox(x,y,z,w,h,d,color,r=.04) {
    roundedSlab(x,y,z,w,d,h,Math.min(r,w*.2,d*.2),typeof color==='string'?material(color):color);
  }
  const pavingCanvas=document.createElement('canvas');pavingCanvas.width=pavingCanvas.height=512;
  const pavingContext=pavingCanvas.getContext('2d');pavingContext.fillStyle='#e8d9c8';pavingContext.fillRect(0,0,512,512);
  const tileRng=random(781);for(let yy=0;yy<512;yy+=32)for(let xx=0;xx<512;xx+=32){const tone=219+Math.round(tileRng()*13);pavingContext.fillStyle=`rgb(${tone+9},${tone},${tone-14})`;pavingContext.fillRect(xx+.6,yy+.6,30.8,30.8);}
  const pavingTexture=new THREE.CanvasTexture(pavingCanvas);pavingTexture.colorSpace=THREE.SRGBColorSpace;pavingTexture.anisotropy=8;
  const tiledPaving=material('#ffffff',{map:pavingTexture,roughness:.96});
  const clearGlass=material('#f9ead5',{transparent:true,opacity:.13,roughness:.12,metalness:.08,depthWrite:false,side:THREE.DoubleSide});
  const upperGlazing=material('#fff0d1',{transparent:true,opacity:.06,roughness:.65,metalness:0,depthWrite:false,side:THREE.DoubleSide});
  function glass(x,y,z,w,h,rotation=0,upper=false) {const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),upper?upperGlazing:clearGlass);mesh.position.set(x,y,z);mesh.rotation.y=rotation;placeInLot(mesh);scene.add(mesh);}
  function printedPanel(x,y,z,w,h,lines,{background='#f6f0e5',color='#393833',rotation=0,size=34}={}) {
    const canvas=document.createElement('canvas');canvas.width=768;canvas.height=Math.max(80,Math.round(768*h/w));const ctx=canvas.getContext('2d');
    ctx.fillStyle=background;ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='middle';
    lines.forEach((line,i)=>{let fontSize=size;ctx.font=`500 ${fontSize}px "DM Sans", Arial`;while(fontSize>8&&ctx.measureText(line).width>716){fontSize-=2;ctx.font=`500 ${fontSize}px "DM Sans", Arial`;}ctx.fillText(line,384,canvas.height*(i+.5)/lines.length);});
    const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;return plane(x,y,z,w,h,map,rotation);
  }
  function planter(x,y,z,size=1) {
    softenedBox(x,y+.18,z,size,.32,size,'#f3eee8',.065);box(x,y+.35,z,size*.76,.035,size*.76,'#796e58');
    orb(x,y+.69,z,size*.4,'#6f9a45');orb(x-.15,y+.84,z+.09,size*.31,'#6f9a45');orb(x+.15,y+.72,z-.11,size*.27,'#6f9a45');
  }
  function tree(x,z,h=3) {
    softenedBox(x,.46,z,.85,.46,.85,'#f3eee8',.065);cylinder(x,1.3,z,.075,1.35,'#8a5a3a',7);
    orb(x,h-.45,z,.67,'#6f9a45');orb(x+.17,h-.27,z-.12,.52,'#6f9a45');orb(x-.24,h-.21,z+.12,.49,'#6f9a45');orb(x+.04,h+.2,z+.03,.49,'#6f9a45');
  }
  function railing(x,z,w,depth,y) {
    for(const zz of [z-depth/2,z+depth/2]) {
      box(x,y+.72,zz,w,.045,.05,whiteMat);box(x,y+.4,zz,w,.045,.05,whiteMat);
      for(let xx=x-w/2;xx<=x+w/2+.001;xx+=.9) box(xx,y+.36,zz,.045,.72,.045,blackMat);
    }
    for(const xx of [x-w/2,x+w/2]) {
      box(xx,y+.72,z,.05,.045,depth,whiteMat);box(xx,y+.4,z,.05,.045,depth,whiteMat);
      for(let zz=z-depth/2;zz<=z+depth/2+.001;zz+=.9) box(xx,y+.36,zz,.045,.72,.045,blackMat);
    }
  }
  function umbrella(x,y,z,color) {
    cylinder(x,y+.7,z,.03,1.2,'#e9e1d5',8);cylinder(x,y+.48,z,.3,.045,'#e5dfd3',16);cylinder(x,y+.3,z,.04,.36,blackMat,8);
    staticGeometry(new THREE.ConeGeometry(.62,.26,12),material(color),x,y+1.32,z);cylinder(x,y+1.47,z,.025,.05,metalMat,7);
    for(const dx of [-.45,.45]) {softenedBox(x+dx,y+.27,z,.24,.24,.24,'#ad8460',.024);box(x+dx,y+.18,z,.035,.28,.035,blackMat);}
  }
  function roofGable(x,y,z,width,depth,rise,color,alongX=true) {
    const span=alongX?depth:width,extrusion=alongX?width:depth;
    const profile=new THREE.Shape();profile.moveTo(-span/2,0);profile.lineTo(span/2,0);profile.lineTo(0,rise);profile.closePath();
    const geometry=new THREE.ExtrudeGeometry(profile,{depth:extrusion,bevelEnabled:false});
    if(alongX){geometry.rotateY(Math.PI/2);geometry.translate(-width/2,0,0);}else geometry.translate(0,0,-depth/2);
    staticGeometry(geometry,material(color),x,y,z);
  }
  function awningMetadata(x,y,z,record) {
    const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=52;const ctx=canvas.getContext('2d');
    const paint=current=>{
    ctx.fillStyle='#f5f1ec';ctx.fillRect(0,0,1200,52);ctx.fillStyle='#d8cfc5';ctx.fillRect(0,47,1200,5);
    const volume=current.volume==null?'24H VOLUME —':current.volume>=1e9?(current.volume/1e9).toFixed(1)+'B 24H':(current.volume/1e6).toFixed(0)+'M 24H';
    const coverage=current.type==='DEX'?`${current.chainCount||current.chains?.length||0} CHAINS`:`TRUST ${current.trust==null?'—':current.trust+'/10'}`;
    ctx.fillStyle='#2e2b28';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='500 30px "DM Sans", Arial';
    [coverage,current.type||'CEX',volume].forEach((label,index)=>{ctx.fillText(label,200+index*400,27,354);if(index)ctx.fillRect(index*400-1,14,2,24);});
    };
    paint(record);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const mesh=plane(x,y,z,5.9,.26,texture);mesh.userData.refresh=current=>{paint(current);texture.needsUpdate=true;};metadataPanels.push(mesh);return mesh;
  }
  function lamp(x,z) {
    cylinder(x,.18,z,.16,.3,blackMat,8);cylinder(x,1.67,z,.048,3.05,blackMat,7);box(x,3.31,z,.32,.2,.32,'#b9bba7');
    const glowing=material('#fff2c7',{emissive:'#ffd99b',emissiveIntensity:.5,townColorMode:'global'});lightMaterials.push(glowing);box(x,3.15,z,.19,.21,.19,glowing);
    staticGeometry(new THREE.ConeGeometry(.26,.23,4),blackMat,x,3.58,z,0,Math.PI/4);
    localWarmLight(x,2.4,z,'#ffbf7a',3.8,1.9,true);
  }

  function pedestrian(x,z,rng,kind,index,order=0,facing) {
    const shirt=Math.floor(rng()*clothingColors.length),skin=Math.floor(rng()*skinColors.length),hair=hairColors[Math.floor(rng()*hairColors.length)];
    const scale=.7+rng()*.12;
    pedestrians.push({x,z,baseX:x,baseZ:z,phase:rng()*Math.PI*2,shirt,skin,hair,scale,height:scale*1.09,kind,index,order,
      pants:Math.floor(rng()*pantsColors.length),shoes:Math.floor(rng()*shoeColors.length),
      headWidth:.3,shoulders:.3,speed:.39+rng()*.065,angle:facing??rng()*Math.PI*2,seed:rng()});
  }

  const storeStyles={binance:'studio',bitget:'studio',raydium:'studio',coinbase:'pavilion',uniswap:'pavilion',hyperliquid:'pavilion',bybit:'shop',pancakeswap:'shop',fomo:'shop',okx:'brick',lighter:'brick',kraken:'gable',pumpfun:'gable',jupiter:'gable'};
  const warmBulb=material('#fff4d7',{emissive:'#ffe2a6',emissiveIntensity:.7});lightMaterials.push(warmBulb);
  function rope(x1,z1,x2,z2) {const curve=new THREE.QuadraticBezierCurve3(new THREE.Vector3(x1,1.01,z1),new THREE.Vector3((x1+x2)/2,.85,(z1+z2)/2),new THREE.Vector3(x2,1.01,z2));staticGeometry(new THREE.TubeGeometry(curve,8,.022,5,false),material('#c94036'),0,0,0);}
  function interior(x,y,z,w,h,accent,rotation=0) {
    const canvas=document.createElement('canvas');canvas.width=960;canvas.height=400;const ctx=canvas.getContext('2d');
    const wash=ctx.createLinearGradient(0,0,0,400);wash.addColorStop(0,'#ffe8b4');wash.addColorStop(.7,'#ecc494');wash.addColorStop(1,'#8a6045');ctx.fillStyle=wash;ctx.fillRect(0,0,960,400);
    for(let bay=0;bay<8;bay++){const bx=bay*120+8;ctx.fillStyle='#b7966a';ctx.fillRect(bx,92,5,240);for(let row=0;row<3;row++){const sy=130+row*70;ctx.fillStyle='#947153';ctx.fillRect(bx,sy,108,8);for(let book=0;book<6;book++){ctx.fillStyle=[accent,'#ffefd0','#cba377','#bd8256','#f7dab0'][(bay+book+row)%5];ctx.fillRect(bx+8+book*15,sy-30-(book%3)*5,11,30+(book%3)*5);}}}
    if(y>3.8){ctx.fillStyle='#f9ebcc';ctx.fillRect(0,0,960,400);ctx.fillStyle='#f2dfb8';ctx.fillRect(0,305,960,95);ctx.fillStyle='#d6c4a1';ctx.fillRect(80,270,120,58);ctx.fillRect(675,278,155,46);ctx.fillStyle='#eee2c7';ctx.fillRect(74,263,134,18);ctx.fillRect(666,270,173,16);}
    ctx.fillStyle='#91643d';ctx.fillRect(0,337,960,63);for(let light=0;light<6;light++){ctx.fillStyle='#625242';ctx.fillRect(77+light*160,0,3,31);ctx.fillStyle='#fffbd9';ctx.beginPath();ctx.ellipse(78+light*160,35,17,8,0,0,Math.PI*2);ctx.fill();}
    const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
    const mat=districtMaterial(new THREE.MeshStandardMaterial({color:'#000000',map,emissive:'#ffffff',emissiveMap:map,emissiveIntensity:1.4,roughness:1}),focusCenter,warmLighting,surfaceWeather);mat.userData.lotIndex=activeLot;lightMaterials.push(mat);textureMaterials.push(mat);
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat);mesh.position.set(x,y,z);mesh.rotation.y=rotation;placeInLot(mesh);scene.add(mesh);
  }
  records.forEach((record,index)=>{
    activeLot=index;
    const rng=random(index*8011+771),x=index*SPACING;
    const name=record.name||record.label||record.id||'Exchange';
    const key=(record.id||name).toLowerCase().replace(/[^a-z]/g,'');const style=storeStyles[key]||'pavilion';
    const originalAccent=record.color||record.accent||palettes[index%palettes.length];
    const accent=originalAccent;
    const wall=style==='brick'?'#b98770':style==='pavilion'?'#f0ebe2':'#e9e1d2';
    const wide=7.2,cx=x-.6,left=x-4.2,right=x+3,front=2.5,back=-2.6;
    const base={studio:3.6,pavilion:3.1,shop:4.45,brick:5.7,gable:3.6}[style];
    const height={studio:7.2,pavilion:4.8,shop:5.15,brick:7.3,gable:6.9}[style];
    labelPositions.push(new THREE.Vector3(cx,height+.3,-.1));
    const pickup=new THREE.Mesh(new THREE.BoxGeometry(wide,height,5.1),new THREE.MeshBasicMaterial());pickup.position.set(cx,height/2,-.05);pickup.userData.index=index;pickup.updateMatrixWorld();pickups.push(pickup);
    // Rounded island edges, raised curb and a single continuous paved surface.
    roundedSlab(x,.075,1.7,11,11,.17,1.3,pavementMat);roundedSlab(x,.155,1.7,10.64,10.64,.03,1.15,tiledPaving);

    // Hollow storefront with a genuinely recessed lit display behind the glazing.
    softenedBox(cx,.27,-.02,wide+.04,.2,5.15,'#cfc3b4',.04);
    box(cx,base/2+.17,back+.08,wide,base,.16,wall);
    box(left+.1,base/2+.17,-.05,.2,base,5.1,wall);
    box(right-.1,base/2+.17,-2.02,.2,base,1.18,wall);
    box(right-.1,base/2+.17,2.15,.2,base,.7,wall);
    box(right-.1,.62,.15,.2,.5,3.2,wall);box(right-.1,2.78,.15,.2,.65,3.25,wall);
    box(cx,(2.7+base+.17)/2,front-.22,wide,Math.max(.32,base+.17-2.7),.58,style==='studio'?accent:wall);
    box(left+.13,1.255,front-.24,.26,2.17,.57,wall);box(x+2.08,1.255,front-.24,1.84,2.17,.57,wall);
    interior(x-1.4,1.35,2.1,5.1,2.0,originalAccent);
    interior(right-.12,1.5,.77,1.65,1.67,originalAccent,Math.PI/2);
    // Display cabinets, bottles, lamps and the entry door are separate small solids.
    for(let bay=0;bay<4;bay++) {
      const bx=x-3.42+bay*1.02;softenedBox(bx,.62,2.26,.74,.5,.24,'#8a5a3a',.012);box(bx,.9,2.26,.78,.05,.28,'#f3eee8');
      for(let item=0;item<3;item++)box(bx+(item-1)*.23,1.02,2.26,.12,.2,.1,bay%2?originalAccent:'#f3eee8');
    }
    box(x-1.4,.36,2.28,5.1,.02,.45,'#8a5a3a');box(x-1.4,2.33,2.28,5.1,.02,.45,warmBulb);
    for(let bay=0;bay<5;bay++)box(x-3.93+bay*1.02,1.35,2.48,.067,2.0,.08,blackMat);
    box(x+1.13,1.35,2.48,.067,2.0,.08,blackMat);box(x-1.9,1.9,2.48,4.08,.05,.06,blackMat);
    box(x-1.4,.4,2.48,5.1,.1,.1,blackMat);glass(x-1.4,1.35,2.505,5.07,1.9);
    box(x+.64,2.3,2.49,1.02,.075,.1,blackMat);box(x+.64,.52,2.49,1.02,.075,.1,blackMat);glass(x+.64,1.41,2.515,.93,1.73);
    box(x+.95,1.34,2.57,.035,.35,.05,metalMat);box(x+.64,1.41,2.43,.94,1.68,.035,'#d0b488');
    printedPanel(x+.64,1.7,2.575,.28,.15,['OPEN'],{background:'#eadab9',size:110});
    for(const zz of [-.13,.75,1.64])box(right+.01,1.49,zz,.05,1.76,.055,blackMat);box(right+.01,2.38,.75,.055,.055,1.84,blackMat);box(right+.01,.59,.75,.055,.055,1.84,blackMat);glass(right+.04,1.49,.75,1.76,1.71,Math.PI/2);
    const mainSign=signTexture(record,accent);
    // Flat terrace canopies and broad pavilion eaves use a separate metadata fascia.
    if(style==='studio'){
      box(x-1.45,2.62,3.1,6,.1,1.2,accent);box(x-1.45,2.47,3.68,5.92,.28,.04,'#f3eee8');
      awningMetadata(x-1.45,2.47,3.705,record);
    }else if(style==='pavilion'){
      awningMetadata(x-.6,3.24,3.807,record);
    }else{
      const stripeWidth=5.9/11;
      for(let stripe=0;stripe<11;stripe++)staticGeometry(new THREE.BoxGeometry(stripeWidth+.002,.05,1.16),material(style==='brick'?accent:stripe%2?'#f3eee8':accent),x-1.45-2.95+(stripe+.5)*stripeWidth,2.34,3.05,.32,0,0);
      box(x-1.45,2.03,3.6,5.9,.28,.04,'#f3eee8');awningMetadata(x-1.45,2.03,3.63,record);
    }
    for(let light=0;light<6;light++)box(x-4+light*1.02,style==='studio'?2.565:style==='pavilion'?3.09:2.27,3.2,.13,.025,.13,warmBulb);
    const slabTop=base+.17;
    softenedBox(cx,slabTop,-.05,wide+.24,.18,5.34,'#d9cbbb',.055);
    if(style==='studio') {
      // Asymmetric upper pavilion: the left room leaves room for the terrace at right.
      const terrace=3.77,upperRoof=6.07,roomX=x-1.8,roomZ=-1.05;
      box(cx,terrace+.05,-.05,wide-.05,.07,5.06,'#b8a183');box(x+.15,terrace+.095,1.38,6.3,.045,1.87,'#b88e68');box(x+1.75,terrace+.095,-1.06,2.35,.045,3.12,'#b88e68');
      plane(x-1.2,3.22,2.585,4.2,1.0,mainSign);
      printedPanel(right+.075,3.31,-.67,3.35,.57,[name],{background:wall,color:'#353b3e',rotation:Math.PI/2,size:135});
      // Only the exposed front and right edges have railings, at 90cm intervals.
      for(let px=left+.08;px<=right;px+=.9)box(px,terrace+.4,2.39,.05,.7,.05,blackMat);
      for(let pz=back+.1;pz<=2.4;pz+=.9)box(right-.08,terrace+.4,pz,.05,.7,.05,blackMat);
      for(const ry of [terrace+.4,terrace+.72]){box(cx,ry,2.39,wide,.045,.06,whiteMat);box(right-.08,ry,-.05,.06,.045,5.1,whiteMat);}
      box(roomX,4.92,-2.53,4.8,2.3,.14,wall);box(x-4.12,4.92,roomZ,.16,2.3,3.1,wall);
      box(roomX,3.91,roomZ,4.8,.24,3.1,'#d2b994');box(roomX,5.99,roomZ,4.8,.16,3.1,'#d2c4af');
      interior(roomX,4.92,-.28,4.25,1.75,'#d0aa55');glass(roomX,4.92,.525,4.25,1.75,0,true);
      warmWindow(roomX,4.92,.477,4.25,1.75);
      box(roomX,5.87,.49,4.4,.05,.06,blackMat);box(roomX,3.97,.49,4.4,.05,.06,blackMat);
      for(let pane=0;pane<=4;pane++)box(x-4+pane*1.1,4.92,.49,.05,1.9,.04,blackMat);
      interior(x+.5,4.92,roomZ,1.75,1.75,'#d0aa55',Math.PI/2);glass(x+.635,4.92,roomZ,1.75,1.75,Math.PI/2,true);
      warmWindow(x+.58,4.92,roomZ,1.75,1.75,Math.PI/2);
      for(const pz of [roomZ-.95,roomZ-.3,roomZ+.3,roomZ+.95])box(x+.62,4.92,pz,.05,1.9,.05,blackMat);
      for(const railY of [3.97,5.87])box(x+.62,railY,roomZ,.05,.05,1.9,blackMat);
      box(roomX,upperRoof+.03,roomZ,4.7,.06,3.0,'#8d8a86');
      for(const zz of [-2.55,.45]){box(roomX,upperRoof+.13,zz,4.88,.26,.14,'#cfc3b4');box(roomX,upperRoof+.28,zz,4.9,.04,.16,'#b98a6a');}
      for(const xx of [x-4.15,x+.55]){box(xx,upperRoof+.13,roomZ,.14,.26,3.1,'#cfc3b4');box(xx,upperRoof+.28,roomZ,.16,.04,3.12,'#b98a6a');}
      softenedBox(roomX,upperRoof+.62,.29,3.7,1,.105,'#e8dfcf',.035);plane(roomX,upperRoof+.62,.352,3.55,.86,mainSign);
      for(const [dx,dz] of [[-2.8,1.35],[-.3,1.35],[1.9,-.5]])umbrella(x+dx,terrace+.03,dz,accent);
      softenedBox(x-2.525,terrace+.16,2.2,3.1,.18,.38,'#8a5a3a',.025);for(let plant=0;plant<6;plant++)orb(x-3.9+plant*.55,terrace+.3,2.2,.22,'#6f9a45');
      softenedBox(x-3.15,upperRoof+.35,-1.65,1.04,.56,.71,'#d9d6cd',.035);box(x-3.15,upperRoof+.33,-1.275,.8,.37,.015,'#929c9b');
      for(let fin=0;fin<9;fin++)box(x-3.5+fin*.087,upperRoof+.33,-1.26,.021,.35,.016,'#5c6768');
      cylinder(x-3.15,upperRoof+.643,-1.65,.21,.012,'#7c8988',16);for(let spoke=0;spoke<6;spoke++)box(x-3.15,upperRoof+.654,-1.65,.42,.007,.014,blackMat,spoke*Math.PI/6);
      printedPanel(x+2.17,terrace+.63,2.455,1,.9,['Exchange type',record.type==='DEX'?'Decentralized Exchange':'Centralized Exchange','Live public activity'],{size:36});
      for(let light=0;light<9;light++)box(x-4.05+light*.63,terrace+1.62-Math.sin(light/8*Math.PI)*.18,2.25,.058,.058,.058,warmBulb);
      for(const poleX of [x-4.05,x+1])box(poleX,terrace+.9,2.25,.035,1.6,.035,blackMat);
    } else if(style==='pavilion') {
      // Broad low roof, white sign, offset information board and four roof planters.
      box(x-.53,3.24,.4,7.94,.28,6.8,'#eee8dc');box(x-1.2,3.39,.1,4.6,.045,3.4,'#b9936b');
      softenedBox(x-1.35,4.05,3.3,5.2,1.3,.13,'#ece5d9',.035);plane(x-1.35,4.05,3.38,5.05,1.22,mainSign);
      softenedBox(x+2.25,4.05,3.3,1.46,1.42,.14,'#ded4c4',.035);printedPanel(x+2.25,4.05,3.385,1.36,1.3,['Exchange type',record.type==='DEX'?'Decentralized Exchange':'Centralized Exchange','Status Live feed','14 chains'],{size:39});
      box(right+.05,4,-.5,.1,.95,4.3,'#ece6dc');plane(right+.11,4,-.5,4.1,.82,mainSign,Math.PI/2);
      box(left-.06,4,-.5,.1,.95,4.3,'#ece6dc');box(cx,4,back-.06,4.3,.95,.1,'#ece6dc');
      for(const [dx,dz,size] of [[-3.2,1.1,.75],[-2.3,-.9,.9],[.6,-1.1,.73],[1.8,.8,.7]])planter(x+dx,3.37,dz,size);
      for(const supportX of [x-3.2,x+.5])box(supportX,3.48,3.2,.07,.5,.07,blackMat);
    } else if(style==='brick') {
      // Two floors of masonry, dark signboard, capped roof and individual upper windows.
      box(cx,3.27,2.33,wide+.04,.8,.7,'#2d3b37');plane(x-1.35,3.28,2.696,3.3,.8,mainSign);
      printedPanel(cx,4.8,2.566,7.18,1.78,[''],{background:'#a97056'});
      const brickMat=material('#b18169');for(let row=0;row<8;row++)for(let col=0;col<16;col++){const bx=left+.13+col*.445+(row%2)*.222;if(bx<right-.05)box(bx,3.84+row*.225,2.585,.415,.205,.014,brickMat);}
      for(let win=0;win<4;win++){const wx=x-3.35+win*1.55;box(wx,4.89,2.62,1.05,1.28,.09,'#d1baa0');interior(wx,4.9,2.674,.84,1.09,originalAccent);box(wx,4.9,2.69,.04,1.1,.02,'#e7ded0');box(wx,4.23,2.72,1.12,.08,.16,'#c6b295');}
      softenedBox(cx,5.90,-.05,7.5,.16,5.4,'#cfc3b4',.055);box(cx,5.99,-.05,7.1,.04,5.0,'#8d8a86');
      for(const supportX of [x-2.1,x-1.4])for(const supportZ of [-.6,-1.3])box(supportX,6.47,supportZ,.07,.9,.07,blackMat);
      box(x-1.75,6.9,-.95,1.5,.06,1.5,blackMat);cylinder(x-1.75,7.37,-.95,.62,.95,'#8a5a3a',12);
      staticGeometry(new THREE.ConeGeometry(.7,.4,12),material('#8d8a86'),x-1.75,8.04,-.95);
      softenedBox(x+1.4,6.34,.3,1,.66,.8,'#f3eee8',.05);staticGeometry(new THREE.CylinderGeometry(.25,.25,.02,12),blackMat,x+1.4,6.34,.71,Math.PI/2);
    } else if(style==='gable') {
      // A filled triangular roof volume supports two glazed dormers.
      const pitch=Math.atan(1.7/2.55),roofCenter=-.05;
      box(cx,3.235,2.2,wide,1.07,.62,wall);plane(x-1.35,3.22,2.625,3.9,.95,mainSign);
      roofGable(cx,3.77,roofCenter,wide,5.1,1.7,wall);
      for(const side of [-1,1])staticGeometry(new THREE.BoxGeometry(7.7,.12,3.415),material(accent),cx,4.625,roofCenter+side*1.439,side*pitch,0,0);
      box(cx,5.52,roofCenter,7.7,.14,.3,accent);
      for(const dormerX of [x-2.9,x-.2]){
        softenedBox(dormerX,4.72,.9,1,.8,1.1,wall,.035);interior(dormerX,4.7,1.455,.62,.52,originalAccent);box(dormerX,4.7,1.465,.04,.52,.02,'#f3eee8');
        roofGable(dormerX,5.10,.9,1.3,1.2,.42,accent,false);
      }
      box(x+1.8,5.17,-1.2,.42,1.3,.42,'#8f4f3d');box(x+1.8,5.85,-1.2,.5,.06,.5,blackMat);
    } else {
      // Traditional corner shop: upper fascia, striped canopy and compact parapet.
      box(cx,4.65,-.05,7.1,.06,5.0,'#8d8a86');
      for(const roofZ of [-2.55,2.45]){box(cx,4.75,roofZ,7.3,.34,.18,'#cfc3b4');box(cx,4.94,roofZ,7.32,.05,.2,'#b98a6a');}
      for(const roofX of [left+.05,right-.05]){box(roofX,4.75,-.05,.18,.34,5.1,'#cfc3b4');box(roofX,4.94,-.05,.2,.05,5.12,'#b98a6a');}
      plane(x-1.35,3.63,2.545,5.5,1.25,mainSign);printedPanel(x+2.26,3.63,2.546,1.36,1.3,['Exchange type',record.type==='DEX'?'Decentralized':'Centralized','Live activity'],{size:41});
      box(right+.06,3.56,-.1,.1,.95,4.25,'#eee5d7');plane(right+.12,3.56,-.1,4.1,.82,mainSign,Math.PI/2);planter(x-2.4,4.98,-1.6,.85);
      const graffiti=printedPanel(right+.035,2.61,-.67,3.6,.44,['BLOCKTOWN.FUN'],{background:wall,color:'#454b4c',rotation:Math.PI/2,size:83});
      graffiti.userData={kind:'link',index,label:'BlockTown on X',url:X_PROFILE_URL};linkTargets.push(graffiti);
    }
    // The small volume board, timber planter, bench and sidewalk A-frame carry the foreground detail.
    softenedBox(x+2.08,1.59,2.56,1.5,1.78,.11,'#d3c6b2',.024);plaques.push(plane(x+2.08,1.59,2.627,1.4,1.66,plaqueTexture(record,accent)));
    softenedBox(x+2.55,.6,3.0,1.1,.12,.5,'#98704d',.03);for(let plant=0;plant<5;plant++)orb(x+2.15+plant*.2,.8,3.0+(plant%2-.5)*.13,.15,'#7c9a55');
    for(const zleg of [-.2,1.0])box(x+3.37,.55,zleg,.44,.32,.06,blackMat);for(let slat=0;slat<4;slat++)softenedBox(x+3.37,.75,.4+(slat-1.5)*.28,.5,.065,.24,'#a47a54',.018);box(x+3.12,.96,.4,.06,.42,1.4,'#a47a54');
    const aFrameX=x+2.86,aFrameZ=5.05;softenedBox(aFrameX,.94,aFrameZ,.66,.85,.065,'#4c4a3e',.025);
    const followSign=printedPanel(aFrameX,.96,aFrameZ+.039,.56,.73,['FOLLOW','BLOCKTOWN','ON X','→'],{background:'#2e332e',color:'#e5d8b8',size:94});
    followSign.userData={kind:'link',index,label:'BlockTown on X',url:X_PROFILE_URL};linkTargets.push(followSign);
    const followProxy=new THREE.Mesh(new THREE.BoxGeometry(.9,1.1,.7),new THREE.MeshBasicMaterial());followProxy.position.set(aFrameX,.75,aFrameZ);placeInLot(followProxy);followProxy.updateMatrixWorld();followProxy.userData={...followSign.userData,highlight:followSign};linkTargets.push(followProxy);
    box(aFrameX,.57,aFrameZ-.17,.58,.06,.35,'#9d805e');
    // Tall narrow banners face down the street instead of across the shop window.
    cylinder(x+3.82,2.6,3.05,.052,4.43,blackMat,8);cylinder(x+3.82,.47,3.05,.15,.21,blackMat,10);box(x+3.82,4.77,2.48,.045,.045,1.16,blackMat);box(x+3.82,2.34,2.48,.04,.04,1.12,blackMat);
    printedPanel(x+3.855,3.56,2.46,.97,2.38,['Now','serving','exchange','activity','BlockTown'],{background:originalAccent,color:'#fbf5e9',rotation:Math.PI/2,size:86});
    tree(x+4.02,2.05,2.76);tree(x+4.02,-2.1,2.58);if(index%4===0)tree(x-4.82,-2.22,2.83);
    lamp(x-2.4,7.0);lamp(x+5.3,4.3);lamp(x+5.3,-.5);lamp(x-5.3,.2);
    // Window light reaches the shopfront, customers and paving, with a finite local falloff.
    localWarmLight(x-2.4,1.3,3.4,'#ffae5a',3.8,2.6);localWarmLight(x+.3,1.3,3.4,'#ffae5a',3.8,2.6);
    localWarmLight(x+3.9,1.4,.8,'#ffae5a',2.4,1.1);
    localWarmLight(x-2.6,2.2,3.3,'#ffe2bd',2.6,1.3);localWarmLight(x+.4,2.2,3.3,'#ffe2bd',2.6,1.3);
    if(style==='studio')localWarmLight(x-1.5,5.17,2.1,'#ffd9a6',2.4,1.2);
    // Fine red ropes sag between black posts, with three staggered switchback rows.
    const ropeRows=[[-3.2,3.65,.63],[-4.1,4.45,.65],[-3.4,5.25,.67]];
    ropeRows.forEach(([start,z,step])=>{for(let q=0;q<8;q++){const xx=x+start+q*step;cylinder(xx,.39,z,.1,.045,blackMat,10);cylinder(xx,.7,z,.027,.66,blackMat,7);orb(xx,1.04,z,.041,'#b8b9ac');if(q<7)rope(xx,z,xx+step,z);}});
    const raw=record.volume24h??record.volume??record.tradeVolume,maxVolume=Math.max(...records.map(item=>item.volume24h??item.volume??item.tradeVolume??0),1);
    const activity=raw===null||raw===undefined ? .16 : Math.pow(Math.max(0,raw)/maxVolume,.7);crowdLimits[index]=Math.round(6+52*activity);
    // One pool circulates through the queue, shop doorway and sidewalk, preserving each citizen's outfit.
    for(let q=0;q<104;q++)pedestrian(x,3.25,rng,'visitor',index,q);
    for(let q=0;q<16;q++)pedestrian(x,5.9,rng,'walk',index,q);
    const idlePlaces=[[2.55,3.85,2.08,2.5],[2.9,4.1,2.08,2.5],[2.45,5.75,2.85,5],[4,5.05,3.65,5.4],[3.65,5.4,4,5.05],[3.95,-1.05,4.05,-.6],[4.05,-.6,3.95,-1.05]];
    idlePlaces.forEach(([xx,zz,lookX,lookZ],q)=>pedestrian(x+xx,zz,rng,'idle',index,q,Math.atan2(lookX-xx,lookZ-zz)));
    for(let q=0;q<2;q++)pedestrian(x+3.38,.05+q*.65,rng,'seated',index,q);
  });

  activeLot=-1;
  labelPositions.forEach((point,index)=>point.applyMatrix4(lotMatrices[index]));
  pickups.forEach((mesh,index)=>{mesh.applyMatrix4(lotMatrices[index]);mesh.updateMatrixWorld();});
  surroundingTown({box,roundedSlab,tree,lamp,material},records);

  // Consolidate architecture into a few material batches rather than thousands of draw calls.
  for(const [mat,geometries] of batches) {
    const mesh=new THREE.Mesh(mergeGeometries(geometries),mat);mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);
  }
  batches.clear();

  // Tiny citizens use uniformly scaled parts and stable outfits throughout their shop visit.
  const peopleMeshes=new Map();
  const bodyBox=new THREE.BoxGeometry(1,1,1);
  function peopleMesh(color) {
    if(peopleMeshes.has(color))return peopleMeshes.get(color);
    const mesh=new THREE.InstancedMesh(bodyBox,material(color,{townSnowRetention:0}),pedestrians.length*6);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;mesh.castShadow=true;mesh.receiveShadow=true;mesh.count=0;scene.add(mesh);peopleMeshes.set(color,mesh);return mesh;
  }
  const peopleColors=[...new Set([...skinColors,...clothingColors,...pantsColors,...hairColors,...shoeColors,'#242425'])];
  for(const c of peopleColors)peopleMesh(c);
  function instance(mesh,x,y,z,sx,sy,sz,angle=0,lean=0) {dummy.position.set(x,y,z);dummy.rotation.set(lean,angle,0,'YXZ');dummy.scale.set(sx,sy,sz);dummy.updateMatrix();mesh.setMatrixAt(mesh.count++,dummy.matrix);}
  function makePeopleRoute(points) {
    const lengths=points.slice(1).map((point,i)=>Math.hypot(point[0]-points[i][0],point[1]-points[i][1]));
    return {points,lengths,length:lengths.reduce((sum,value)=>sum+value,0)};
  }
  function peopleRoutePoint(route,distance,out) {
    let remaining=clamp(distance,0,route.length);
    for(let i=0;i<route.lengths.length;i++){
      const length=route.lengths[i];if(remaining>length&&i<route.lengths.length-1){remaining-=length;continue;}
      const a=route.points[i],b=route.points[i+1],fraction=length?remaining/length:0;
      out.x=a[0]+(b[0]-a[0])*fraction;out.z=a[1]+(b[1]-a[1])*fraction;out.angle=Math.atan2(b[0]-a[0],b[1]-a[1]);return out;
    }
    return out;
  }
  function sidewalkCircuit(half,radius) {
    const edge=half-radius,points=[[1.9,half+1.7]];
    for(let corner=0;corner<4;corner++){
      const centerX=corner<2?edge:-edge,centerZ=corner===0||corner===3?edge:-edge;
      for(let step=0;step<=12;step++){
        const angle=Math.PI/2-corner*Math.PI/2-step*Math.PI/24;
        points.push([centerX+Math.cos(angle)*radius,centerZ+Math.sin(angle)*radius+1.7]);
      }
    }
    points.push([1.9,half+1.7]);return makePeopleRoute(points);
  }
  const queueRoute=makePeopleRoute([[.5,3.25],[-3.65,3.25],[-3.65,4.05],[.9,4.05],[.9,4.85],[-3.85,4.85],[-3.85,5.7],[1.2,5.7],[1.2,6.25]]);
  const entryRoute=makePeopleRoute([[.5,3.25],[.55,2.75],[.55,2.1]]);
  const exitRoute=makePeopleRoute([[.95,2.1],[.95,2.7],[1.9,3.45],[1.9,6.25]]);
  const visitorCircuit=sidewalkCircuit(4.55,.35),walkerCircuit=sidewalkCircuit(5,.8),citizenMetrics=new Map();
  function metricsForPeople(index) {
    const queued=clamp(crowdLimits[index],6,58),change=Number(records[index].changeDay)||0,previous=citizenMetrics.get(index);
    if(previous&&previous.queued===queued&&previous.change===change)return previous;
    const strength=(queued-6)/52,walkingSpeed=.42*clamp(1+change/120,.75,1.5);
    const perimeterLength=visitorCircuit.length-.7,tailLength=queueRoute.length-queued*.3;
    const circulationLength=entryRoute.length+12+exitRoute.length+perimeterLength+tailLength;
    const circulating=Math.max(4,Math.round(circulationLength*(.22+.5*strength)));
    const metrics={queued,change,strength,walkingSpeed,perimeterLength,tailLength,circulationLength,circulating,total:queued+circulating,
      serviceInterval:circulationLength/(circulating*walkingSpeed),walkers:Math.round(4+12*strength),idle:Math.round(2+5*strength)};
    citizenMetrics.set(index,metrics);return metrics;
  }
  function sampleCitizen(person,clock,out) {
    const metrics=metricsForPeople(person.index);out.visible=true;out.moving=false;out.y=.19;out.x=person.baseX;out.z=person.baseZ;out.angle=person.angle;out.sitting=false;
    if(person.kind==='visitor'){
      if(person.order>=metrics.total){out.visible=false;return out;}
      const cursor=THREE.MathUtils.euclideanModulo(person.order-clock/metrics.serviceInterval,metrics.total);
      if(cursor<metrics.queued){
        const slot=Math.floor(cursor),fraction=cursor-slot;
        peopleRoutePoint(queueRoute,(slot+THREE.MathUtils.smoothstep(fraction,0,.35))*.3,out);
        out.angle+=Math.PI;out.moving=fraction<.35;
        if(!out.moving)out.angle+=Math.sin(clock*.4+person.phase*6.4)*.2;
      }else{
        let distance=(metrics.total-cursor)/metrics.circulating*metrics.circulationLength;out.moving=true;
        if(distance<entryRoute.length)peopleRoutePoint(entryRoute,distance,out);
        else if((distance-=entryRoute.length)<12){out.visible=false;return out;}
        else if((distance-=12)<exitRoute.length)peopleRoutePoint(exitRoute,distance,out);
        else if((distance-=exitRoute.length)<metrics.perimeterLength)peopleRoutePoint(visitorCircuit,distance,out);
        else{distance-=metrics.perimeterLength;peopleRoutePoint(queueRoute,queueRoute.length-distance,out);out.angle+=Math.PI;}
      }
      out.x+=person.index*SPACING;
    }else if(person.kind==='walk'){
      if(person.order>=metrics.walkers){out.visible=false;return out;}
      peopleRoutePoint(walkerCircuit,THREE.MathUtils.euclideanModulo(person.order*walkerCircuit.length/metrics.walkers+person.seed*.3+clock*metrics.walkingSpeed,walkerCircuit.length),out);
      out.x+=person.index*SPACING;out.moving=true;
    }else if(person.kind==='idle'){
      if(person.order>=metrics.idle){out.visible=false;return out;}
      out.angle=person.angle+Math.sin(clock*.3+person.phase*4.8)*.25;
    }else if(person.kind==='seated'){
      if(metrics.strength<=.3){out.visible=false;return out;}
      out.angle=Math.PI/2;out.y=.36;out.sitting=true;
    }
    if(person.kind==='visitor'&&out.z<2.25&&Math.abs(out.x-person.index*SPACING-.75)<.5){out.visible=false;return out;}
    const lot=lotAt(person.index),localX=out.x-person.index*SPACING,localZ=out.z-1.7,c=Math.cos(lot.angle),s=Math.sin(lot.angle);
    out.x=lot.x+localX*c+localZ*s;out.z=lot.z-localX*s+localZ*c;out.angle+=lot.angle;return out;
  }

  // Four short translucent segments follow actual past positions, including curved sidewalk routes.
  const trailCapacity=pedestrians.length*4,trailGeometry=bodyBox.clone(),trailAlphas=new Float32Array(trailCapacity);
  trailGeometry.setAttribute('citizenTrailAlpha',new THREE.InstancedBufferAttribute(trailAlphas,1));
  const citizenTrailMaterial=new THREE.MeshBasicMaterial({color:'#fff',transparent:true,opacity:.18,depthWrite:false});
  citizenTrailMaterial.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float citizenTrailAlpha; varying float vCitizenTrailAlpha;').replace('#include <begin_vertex>','#include <begin_vertex>\nvCitizenTrailAlpha=citizenTrailAlpha;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vCitizenTrailAlpha;').replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.a*=vCitizenTrailAlpha;');
  };
  const citizenTrails=new THREE.InstancedMesh(trailGeometry,citizenTrailMaterial,trailCapacity);citizenTrails.instanceMatrix.setUsage(THREE.DynamicDrawUsage);citizenTrails.frustumCulled=false;citizenTrails.count=0;citizenTrails.renderOrder=1;scene.add(citizenTrails);
  const citizenPose={},trailPose={},trailColor=new THREE.Color();let gaitClock=0,previousPeopleTime=0;
  function renderPeople(time) {
    gaitClock+=Math.max(0,time-previousPeopleTime)*Math.min(speed,3)/Math.max(speed,.1);previousPeopleTime=time;
    for(const mesh of peopleMeshes.values())mesh.count=0;citizenTrails.count=0;featuredVisible=false;
    const exposure=!paused&&shutter>.015?Math.min(shutter*speed,3.2):0;
    for(const person of pedestrians) {
      const lot=lotAt(person.index);if(Math.hypot(lot.x-target.x,lot.z-target.z)>30)continue;
      const pose=sampleCitizen(person,time,citizenPose);if(!pose.visible)continue;
      const scale=person.scale,angle=pose.angle,c=Math.cos(angle),s=Math.sin(angle);
      const wave=pose.moving?Math.sin(gaitClock*9+person.phase)*.55:0;
      const bob=pose.moving?Math.abs(Math.cos(gaitClock*9+person.phase))*.028:0;
      if(person.index===selected&&person.kind==='visitor'&&person.order===0){featuredActor.set(pose.x,pose.y+(1.09+bob)*person.scale,pose.z);featuredVisible=true;}
      const shirt=peopleMeshes.get(clothingColors[person.shirt]),skin=peopleMeshes.get(skinColors[person.skin]),hair=peopleMeshes.get(person.hair),pants=peopleMeshes.get(pantsColors[person.pants]),shoes=peopleMeshes.get(shoeColors[person.shoes]),face=peopleMeshes.get('#242425');
      const vertical=pose.sitting?.78:1;
      const part=(mesh,lateral,y,forward,w,h,d,lean=0)=>{
        instance(mesh,pose.x+(lateral*c+forward*s)*scale,pose.y+(y*vertical+bob)*scale,pose.z+(forward*c-lateral*s)*scale,w*scale,h*scale*vertical,d*scale,angle,lean);
      };
      part(shirt,0,.56,0,person.shoulders,.36,.2);
      part(skin,0,.89,0,person.headWidth,.28,.3);
      // A shallow cap and rear strip keep faces open at the miniature viewing scale.
      part(hair,0,1.05,-.01,.32,.08,.32);
      part(hair,0,.95,-.13,.32,.2,.07);
      for(const side of [-1,1])part(face,side*.065,.9,.141,.04,.05,.02);
      for(const side of [-1,1]) {
        const swing=wave*side,hip=.4,legCenter=hip-Math.cos(swing)*.19,legForward=-Math.sin(swing)*.19;
        part(pants,side*.07,pose.sitting?.17:legCenter,pose.sitting?.13:legForward,.11,.34,.115,pose.sitting?-Math.PI/2:swing);
        part(shoes,side*.07,pose.sitting?.025:hip-Math.cos(swing)*.37,pose.sitting?.31:-Math.sin(swing)*.37+.03,.12,.06,.17,pose.sitting?0:swing);
        const armSwing=-swing,armCenter=.72-Math.cos(armSwing)*.15,armForward=-Math.sin(armSwing)*.15;
        part(shirt,side*(person.shoulders/2+.038),armCenter,armForward,.08,.3,.085,armSwing);
        part(skin,side*(person.shoulders/2+.038),.72-Math.cos(armSwing)*.33,-Math.sin(armSwing)*.33,.075,.08,.08);
      }
      if(exposure&&pose.moving){
        let lastX=pose.x,lastZ=pose.z;
        const grey=clamp(Math.hypot(lot.x-focusCenter.value.x,lot.z-focusCenter.value.z)/17,0,1);
        trailColor.set(clothingColors[person.shirt]);const luminance=trailColor.r*.3+trailColor.g*.59+trailColor.b*.11;trailColor.lerp(new THREE.Color(luminance,luminance,luminance),grey);
        for(let segment=0;segment<4;segment++){
          const prior=sampleCitizen(person,time-exposure*(segment+1)/4,trailPose);if(!prior.visible)break;
          const dx=lastX-prior.x,dz=lastZ-prior.z,length=Math.hypot(dx,dz);if(length>2.5)break;
          if(length>.015){
            const slot=citizenTrails.count;
            instance(citizenTrails,(lastX+prior.x)/2,pose.y+.52*scale,(lastZ+prior.z)/2,.16*scale,.54*scale,length+.025,Math.atan2(dx,dz));
            citizenTrails.setColorAt(slot,trailColor);trailAlphas[slot]=.38*(1-segment/5);
          }
          lastX=prior.x;lastZ=prior.z;
        }
      }
    }
    for(const mesh of peopleMeshes.values())mesh.instanceMatrix.needsUpdate=true;
    citizenTrails.instanceMatrix.needsUpdate=true;if(citizenTrails.instanceColor)citizenTrails.instanceColor.needsUpdate=true;trailGeometry.getAttribute('citizenTrailAlpha').needsUpdate=true;
  }

  const carMaterials=new Map();
  function carMaterial(color){if(!carMaterials.has(color))carMaterials.set(color,new THREE.MeshStandardMaterial({color,roughness:.85}));return carMaterials.get(color);}
  function makeCar(index) {
    const group=new THREE.Group();const color=['#b5a14d','#9c7e70','#839caf','#a7b29b','#b9b3a0'][index%5];
    function part(x,y,z,w,h,d,c){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),carMaterial(c));mesh.position.set(x,y,z);mesh.castShadow=true;group.add(mesh);return mesh;}
    part(0,.55,0,1.1,.48,2.05,color);part(0,.98,-.12,.93,.43,1.15,color);part(0,1,-.13,.96,.3,.79,'#414b4e');part(0,1.2,-.13,.96,.04,1.05,color);
    part(0,.65,1.04,.85,.16,.026,'#d5d9b7');part(-.32,.58,-1.045,.16,.11,.04,'#a24c42');part(.32,.58,-1.045,.16,.11,.04,'#a24c42');
    for(const x of [-.53,.53])for(const z of [-.65,.65]) {const mesh=new THREE.Mesh(new THREE.CylinderGeometry(.22,.22,.12,8),blackMat);mesh.rotation.z=Math.PI/2;mesh.position.set(x,.35,z);group.add(mesh);}
    if(index>=24){
      group.children.forEach(child=>child.geometry.dispose());group.clear();
      part(0,.3,0,.17,.13,.7,color);part(0,.5,-.03,.19,.1,.22,'#54595a');
      for(const zz of [-.26,.26]){const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.14,.14,.075,10),blackMat);wheel.rotation.z=Math.PI/2;wheel.position.set(0,.17,zz);group.add(wheel);}
      part(0,.75,-.08,.19,.3,.2,clothingColors[index%clothingColors.length]);part(0,1.01,-.1,.22,.22,.22,skinColors[index%skinColors.length]);part(0,1.14,-.1,.235,.06,.235,'#4c433b');
      part(-.15,.7,.08,.07,.23,.08,clothingColors[index%clothingColors.length]);part(.15,.7,.08,.07,.23,.08,clothingColors[index%clothingColors.length]);part(0,.52,.22,.35,.025,.04,'#3c4549');
    }
    const grouped=new Map();
    for(const child of [...group.children]){child.updateMatrix();const g=child.geometry.clone().applyMatrix4(child.matrix);if(!grouped.has(child.material))grouped.set(child.material,[]);grouped.get(child.material).push(g);child.geometry.dispose();}
    group.clear();for(const [mat,geometries] of grouped){const mesh=new THREE.Mesh(mergeGeometries(geometries),mat);mesh.castShadow=true;group.add(mesh);}
    const trails=new THREE.Group();const trailMaterial=new THREE.MeshBasicMaterial({color:index%2?'#edb689':'#dca253',transparent:true,opacity:.1,depthWrite:false});
    for(const x of [-.35,.35]) {const streak=new THREE.Mesh(new THREE.BoxGeometry(.055,.035,3.5),trailMaterial);streak.position.set(x,.25,-2.7);trails.add(streak);}
    group.scale.setScalar(index>=24?1:.65);group.add(trails);scene.add(group);cars.push({group,trails,trailMaterial,phase:index*.137,route:index<20?index%4:4,speed:2.4,direction:index<20?1:-1});dynamicGroups.push(group);
  }
  for(let i=0;i<36;i++)makeCar(i);

  const weatherEffects=createWeatherEffects(scene),weatherState={type:'clear',intensity:.65};let weatherLot=lotAt(0);
  const composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));
  const ao=new GTAOPass(scene,camera,512,512,undefined,{radius:.5,thickness:.9,samples:12,distanceExponent:1.5,distanceFallOff:.9,scale:1.1},{samples:12,radius:6});ao.blendIntensity=.8;
  // Exposure streaks and transparent glazing must not become solid AO/depth blockers.
  const transparentMeshes=[...weatherEffects.transparentObjects];scene.traverse(object=>{if(object.isMesh&&object.material?.transparent&&!transparentMeshes.includes(object))transparentMeshes.push(object);});
  const transparentVisibility=[],drawAO=ao.render.bind(ao);
  ao.render=(...args)=>{transparentMeshes.forEach((mesh,i)=>{transparentVisibility[i]=mesh.visible;mesh.visible=false;});try{drawAO(...args);}finally{transparentMeshes.forEach((mesh,i)=>mesh.visible=transparentVisibility[i]);}};
  composer.addPass(ao);
  const bloom=new UnrealBloomPass(new THREE.Vector2(512,512),.55,.6,.95);composer.addPass(bloom);
  const lens=new MiniatureLensPass(ao.depthTexture,camera);composer.addPass(lens);composer.addPass(new OutputPass());
  let selected=0,time=0,hour=19,paused=false,speed=8,macro=true,shutter=.22,frame=0,disposed=false,last=performance.now(),selectCallback=null,renderDirty=true;
  const startupUntil=last+3000;
  let yaw=Math.PI/4-.2,desiredYaw=yaw,pitch=.58,distance=24.693;
  const target=new THREE.Vector3(7,1.7,9),desiredTarget=target.clone(),lookTarget=target.clone();
  const offset=new THREE.Vector3(),desiredPos=new THREE.Vector3();
  let width=1,height=1;
  function desiredCamera(){const responsiveDistance=distance*Math.max(1,.86/(width/height));offset.set(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)).multiplyScalar(responsiveDistance);desiredPos.copy(target).add(offset);}
  function resize(){
    renderDirty=true;
    width=container.clientWidth||window.innerWidth;height=container.clientHeight||window.innerHeight;camera.aspect=width/height;camera.clearViewOffset();camera.updateProjectionMatrix();
    renderer.setSize(width,height);composer.setSize(width,height);const ratio=renderer.getPixelRatio();ao.setSize(Math.max(1,Math.floor(width*ratio*.5)),Math.max(1,Math.floor(height*ratio*.5)));bloom.setSize(width*ratio*.5,height*ratio*.5);
    weatherEffects.resize(width,height);
  }
  function setSelection(index,immediate=false){
    renderDirty=true;
    selected=((Math.round(index)%records.length)+records.length)%records.length;const lot=lotAt(selected);weatherLot=lot;
    const aim=lotPoint(selected*SPACING-.4,3.3,selected);desiredTarget.set(aim.x,1.7,aim.z);focusCenter.value.set(lot.x,0,lot.z);desiredYaw=lot.angle+Math.PI/4-.2;
    if(immediate){yaw=desiredYaw;target.copy(desiredTarget);desiredCamera();camera.position.copy(desiredPos);lookTarget.copy(target);lookTarget.y+=1.635;camera.lookAt(lookTarget);}
    setTime(hour);
  }
  function setTime(value){
    renderDirty=true;
    hour=((Number(value)%24)+24)%24;const look=weatherLightingAt(hour,weatherState.type,weatherState.intensity);
    container.parentElement.style.setProperty('--daylight',(1-look.night).toFixed(2));
    scene.background.copy(look.bg);scene.fog.color.copy(look.fog);scene.fog.density=look.fogDensity;
    hemi.color.copy(look.sky);hemi.groundColor.copy(look.ground);hemi.intensity=look.hemi;
    sun.color.copy(look.sun);sun.intensity=look.light;sun.shadow.radius=look.shadowRadius;fill.intensity=.12;renderer.toneMappingExposure=look.exposure;
    bloom.strength=look.bloom;bloom.threshold=look.threshold;
    for(const mat of lightMaterials){const active=mat.userData.lotIndex===selected;mat.emissiveIntensity=(mat.userData.upperWindow?(.7+.7*look.night)*(active?1:.4814):mat.emissiveMap?(1.485+1.215*look.night)*(active?1:.43778):.22+.95*look.night)*look.windowBoost;}
    for(const mat of textureMaterials)if(mat.map?.userData.brandSign)mat.emissiveIntensity=mat.userData.lotIndex===selected?.18:.1008;
    updateWarmLighting(look.night);
  }
  function setWeather(type,intensity=.65){
    if(disposed)throw new Error('This BlockTown scene has been closed.');
    const normalized=typeof type==='string'?type.trim().toLowerCase():'';
    if(!['clear','sunny','rain','snow'].includes(normalized))throw new RangeError('Weather must be clear, sunny, rain or snow.');
    const amount=Number(intensity);if(!Number.isFinite(amount))throw new TypeError('Weather intensity must be a finite number.');
    weatherState.type=normalized;weatherState.intensity=clamp(amount,0,1);
    if(normalized!=='snow'){
      snowCover=createSnowCoverState();surfaceWeather.roofSnow.value=0;surfaceWeather.groundSnow.value=0;
    }
    surfaceWeather.wetness.value=normalized==='rain'?weatherState.intensity:0;
    weatherEffects.setWeather(normalized,weatherState.intensity);weatherEffects.update(0,target,true,weatherLot);
    setTime(hour);renderDirty=true;
    return{...weatherState};
  }
  function updateWarmLighting(night){
    const weatherBoost=weatherState.type==='rain'?1+.24*weatherState.intensity:weatherState.type==='snow'?1+.13*weatherState.intensity:1;
    const ranked=warmLightPool.map(light=>{const active=light.lotIndex===selected;const intensity=light.intensity*(light.street?night:(active?1:.34)*(.45+.55*night)*weatherBoost);return{light,intensity,score:intensity/(1+.012*light.position.distanceToSquared(target))};}).sort((a,b)=>b.score-a.score);
    for(let i=0;i<10;i++){const slot=ranked[i],position=warmLighting.positions.value[i],color=warmLighting.colors.value[i];if(slot){const light=slot.light;position.set(light.position.x,light.position.y,light.position.z,light.radius);color.set(light.color.r,light.color.g,light.color.b,slot.intensity);}else{position.set(0,0,0,0);color.set(0,0,0,0);}}
  }
  function animate(now){
    if(disposed)return;frame=requestAnimationFrame(animate);const elapsed=Math.max(0,(now-last)/1000),dt=Math.min(.06,elapsed);last=now;if(!paused)time+=dt*speed;
    snowCover=advanceSnowCover(snowCover,{...weatherState,paused,dt:elapsed});
    surfaceWeather.roofSnow.value=snowCover.roofCoverage;surfaceWeather.groundSnow.value=snowCover.groundCoverage;
    target.lerp(desiredTarget,1-Math.exp(-dt*3));const angle=THREE.MathUtils.euclideanModulo(desiredYaw-yaw+Math.PI,Math.PI*2)-Math.PI;yaw+=angle*(1-Math.exp(-dt*3));
    desiredCamera();camera.position.lerp(desiredPos,1-Math.exp(-dt*5));lookTarget.copy(target);lookTarget.y+=1.635;camera.lookAt(lookTarget);
    weatherEffects.update(dt,target,paused,weatherLot);
    if(target.distanceToSquared(desiredTarget)>.0001)updateWarmLighting(lightingAt(hour).night);
    if(paused&&!renderDirty&&now>startupUntil&&target.distanceToSquared(desiredTarget)<.0001&&camera.position.distanceToSquared(desiredPos)<.0004&&Math.abs(angle)<.001)return;
    renderTownFrame();
  }
  function renderTownFrame(){
    weatherEffects.update(0,target,true,weatherLot);
    const solarAzimuth=lotAt(selected).angle+Math.PI/4-1.3-.45*Math.sin(2*Math.PI*(hour-19)/24);
    const solarElevation=.94+.3*(hour>6&&hour<19?Math.sin(Math.PI*(hour-6)/13):0);
    sun.position.set(target.x+37*Math.sin(solarAzimuth)*Math.cos(solarElevation),37*Math.sin(solarElevation),target.z+37*Math.cos(solarAzimuth)*Math.cos(solarElevation));sun.target.position.set(target.x,1.7,target.z);sun.target.updateMatrixWorld();
    renderPeople(time);
    for(const car of cars){
      const route=trafficPaths[car.route],length=route.getLength(),u=THREE.MathUtils.euclideanModulo(car.phase+time*car.speed*car.direction/length,1),p=route.getPointAt(u),t=route.getTangentAt(u).multiplyScalar(car.direction);
      const lane=car.route===4?-.72:.72;car.group.position.set(p.x+t.z*lane,0,p.z-t.x*lane);car.group.rotation.y=Math.atan2(t.x,t.z);car.group.visible=Math.hypot(p.x-target.x,p.z-target.z)<60;
      car.trails.visible=shutter>.015&&!paused;car.trails.scale.z=.05+shutter*5.2;car.trailMaterial.opacity=shutter*.4;
    }
    lens.enabled=macro;lens.uniforms.focus.value=camera.position.distanceTo(target);composer.render();renderDirty=false;
  }
  async function captureImage(){
    if(disposed)throw new Error('This BlockTown scene has been closed.');
    if(renderer.getContext().isContextLost())throw new Error('The graphics context is unavailable. Reload BlockTown and try again.');
    camera.updateMatrixWorld();scene.updateMatrixWorld();renderTownFrame();
    return new Promise((resolve,reject)=>{
      try{renderer.domElement.toBlob(blob=>{if(blob)resolve(blob);else reject(new Error('Unable to capture the BlockTown scene.'));},'image/png');}
      catch(error){reject(error);}
    });
  }
  function projectLabel(index) {const point=labelPositions[index]?.clone();if(!point)return {x:0,y:0,visible:false};point.project(camera);return {x:(point.x*.5+.5)*width,y:(-.5*point.y+.5)*height,visible:point.z<1&&Math.abs(point.x)<1.3&&Math.abs(point.y)<1.3};}
  const raycaster=new THREE.Raycaster();
  let hoveredSign=null;
  function hitTest(clientX,clientY){
    renderDirty=true;
    if(hoveredSign){hoveredSign.material.emissive.set('#000000');hoveredSign.material.emissiveIntensity=1;hoveredSign=null;}
    const rect=renderer.domElement.getBoundingClientRect();
    if(clientX<rect.left||clientX>rect.right||clientY<rect.top||clientY>rect.bottom)return null;
    camera.updateMatrixWorld();scene.updateMatrixWorld();
    raycaster.setFromCamera(new THREE.Vector2((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1),camera);
    const link=raycaster.intersectObjects(linkTargets,false)[0],building=raycaster.intersectObjects(pickups,false)[0];
    if(link&&(!building||link.distance<building.distance+.4)){
      hoveredSign=link.object.userData.highlight||link.object;hoveredSign.material.emissive.set('#f0b90b');hoveredSign.material.emissiveIntensity=.16;
      return link.object.userData;
    }
    return building?{kind:'building',index:building.object.userData.index,label:records[building.object.userData.index].name}:null;
  }
  function pick(clientX,clientY){const hit=hitTest(clientX,clientY);if(hit?.url)window.open(hit.url,'_blank','noopener,noreferrer');else if(hit&&selectCallback)selectCallback(hit.index);return hit;}
  function projectSpeech(){
    const angularError=THREE.MathUtils.euclideanModulo(desiredYaw-yaw+Math.PI,Math.PI*2)-Math.PI;
    if(!featuredVisible||target.distanceTo(desiredTarget)>.08||Math.abs(angularError)>.02)return null;
    v.copy(featuredActor).sub(camera.position);const actorDistance=v.length(),previousFar=raycaster.far;
    raycaster.set(camera.position,v.normalize());raycaster.far=Math.max(0,actorDistance-.05);
    const occluded=raycaster.intersectObjects(pickups,false).length>0;raycaster.far=previousFar;if(occluded)return null;
    const p=featuredActor.clone().project(camera);if(p.z>=1||Math.abs(p.x)>.95||Math.abs(p.y)>.95)return null;
    return{x:(p.x*.5+.5)*width,y:(-.5*p.y+.5)*height};
  }
  const observer=new ResizeObserver(resize);observer.observe(container);
  resize();setSelection(0,true);setTime(hour);frame=requestAnimationFrame(animate);
  return {
    scene,camera,renderer,setSelection,setTime,setWeather,getWeather(){return{...weatherState};},projectLabel,projectSpeech,hitTest,pick,captureImage,
    updateData(updatedRecords){renderDirty=true;updatedRecords.forEach((record,index)=>{if(!plaques[index])return;Object.assign(records[index],record);metadataPanels[index]?.userData.refresh(record);const raw=record.volume24h??record.volume;crowdLimits[index]=raw===null||raw===undefined?22:Math.round(6+52*Math.pow(Math.max(0,raw)/Math.max(...updatedRecords.map(r=>r.volume||0),1),.7));const old=plaques[index].material.map;plaques[index].material.map=plaqueTexture(record,record.color||palettes[index%palettes.length]);plaques[index].material.needsUpdate=true;old.dispose();});},
    setPaused(value){paused=!!value;renderDirty=true;},setSpeed(value){speed=clamp(Number(value)||1,.1,48);},setMacro(value){macro=!!value;renderDirty=true;},setShutter(value){shutter=clamp(Number(value)||0,0,.45);renderDirty=true;},
    orbit(dx,dy){renderDirty=true;const baseYaw=lotAt(selected).angle+Math.PI/4-.2;desiredYaw=baseYaw+clamp(desiredYaw-baseYaw-Number(dx)*.003,-.45,.45);pitch=clamp(pitch+Number(dy)*.0015,.46,.78);},
    zoom(delta){renderDirty=true;distance=clamp(distance+Number(delta)*.0123465,24.693*.75,24.693*1.3);},
    resetView(){renderDirty=true;desiredYaw=lotAt(selected).angle+Math.PI/4-.2;pitch=.58;distance=24.693;},resize,onSelect(callback){selectCallback=callback;},
    dispose(){disposed=true;cancelAnimationFrame(frame);observer.disconnect();weatherEffects.dispose();trackTexture.dispose();scene.traverse(o=>{if(o.geometry)o.geometry.dispose();});for(const mat of [...materials.values(),...textureMaterials]){if(mat.map)mat.map.dispose();mat.dispose();}ao.dispose();bloom.dispose();lens.dispose();composer.dispose();renderer.dispose();renderer.domElement.remove();},
  };
}
