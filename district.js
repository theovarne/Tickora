import * as THREE from './vendor/three.module.js';

export const step=14.8;
export const centers=[[0,0],[29.6,0],[29.6,29.6],[0,29.6]];
const corners=[[7.4,7.4],[7.4,-7.4],[-7.4,-7.4],[-7.4,7.4]];
export function lotAt(index){const c=centers[Math.floor(index/4)%centers.length],p=corners[index%4];return{x:c[0]+p[0],z:c[1]+p[1],angle:index%4*Math.PI/2};}
export function lotPoint(x,z,index){const p=lotAt(index),a=p.angle,xx=x-index*16,zz=z-1.7;return new THREE.Vector3(p.x+xx*Math.cos(a)+zz*Math.sin(a),0,p.z-xx*Math.sin(a)+zz*Math.cos(a));}
export function lotMatrix(index){const p=lotAt(index);return new THREE.Matrix4().makeTranslation(p.x,0,p.z).multiply(new THREE.Matrix4().makeRotationY(p.angle)).multiply(new THREE.Matrix4().makeTranslation(-index*16,0,-1.7));}

export function surroundingTown(api,records){
  const {box:baseBox,roundedSlab,tree,lamp,material}=api;
  const background=(color,options={})=>material(color,{townSaturation:.3,townWarmLift:0,...options});
  const box=(x,y,z,w,h,d,color,rotation=0)=>baseBox(x,y,z,w,h,d,typeof color==='string'?background(color):color,rotation);
  const occupied=records.map((_,i)=>lotAt(i));
  const asphalt=material('#40444c',{roughness:.5,metalness:.15,townColorMode:'global'}),stripe=material('#e8e3d4',{townColorMode:'global'});
  box(14.8,-.17,14.8,230,.3,230,asphalt);
  // Intersecting streets, with the four crosswalks around each junction.
  for(let i=-4;i<=5;i++){
    for(let k=-28;k<=28;k++){
      const a=k*3.4;
      if(Math.abs(a/step-Math.round(a/step))*step<3.5)continue;
      box(i*step,.007,a,.065,.012,1.05,stripe);
      box(a,.007,i*step,1.05,.012,.065,stripe);
    }
    for(let j=-4;j<=5;j++){
      const x=i*step,z=j*step;
      for(const side of [-1,1])for(let n=0;n<6;n++){
        const lane=-1.5+n*.59;
        box(x+lane,.008,z+side*4.8,.31,.015,2.05,stripe);
        box(x+side*4.8,.008,z+lane,2.05,.015,.31,stripe);
      }
    }
  }
  const wall=['#bfbfba','#c8c6bf','#acb2b3','#d1cdc2','#b9b9b2'];
  for(let ix=-3;ix<5;ix++)for(let iz=-3;iz<5;iz++){
    const x=ix*step+7.4,z=iz*step+7.4;
    if(occupied.some(p=>Math.hypot(x-p.x,z-p.z)<1))continue;
    const seed=Math.abs(ix*31+iz*19),h=2.6+seed%4*.65,w=6.2+seed%3*.3;
    roundedSlab(x,.15,z,11,11,.27,1.3,background('#c4c5c0'));
    roundedSlab(x,.32,z,10.92,10.92,.09,1.28,background('#d6d6cd'));
    for(let t=-4.6;t<5;t+=.82){box(x+t,.371,z,.014,.006,10.6,'#c4c4bc');box(x,.371,z+t,10.6,.006,.014,'#c4c4bc');}
    box(x-.45,h/2+.38,z-1.2,w,h,5.1,wall[seed%wall.length]);
    box(x-.45,h+.48,z-1.2,w+.3,.18,5.4,'#d2d0c9');
    box(x-.45,h+.69,z+1.48,w+.12,.7,.12,'#bebeb8');
    const pane=background('#b8b6a9',{emissive:'#fff0c8',emissiveIntensity:.12});
    box(x-.45,1.65,z+1.385,w-.5,2.05,.03,pane);
    for(let a=0;a<5;a++)box(x-w/2+a*w/4-.45,1.65,z+1.44,.055,2.35,.06,'#60686a');
    box(x-.45,2.94,z+1.65,w+.4,.1,.9,'#cbc9c1');
    box(x-.45,h+.82,z-1.25,1,.6,.8,'#c2c1ba');
    for(let row=0;row<Math.floor(h/2)-1;row++)for(let c=0;c<4;c++)box(x-2.4+c*1.3,3.7+row*1.7,z+1.39,.88,1.13,.04,'#959f9f');
    tree(x+4.15,z+.3,2.8+seed%3*.25);lamp(x-2.4,z+5.3);lamp(x+5.3,z+2.6);lamp(x+5.3,z-2.2);
    box(x+3.8,.63,z+2.7,.48,.5,1.6,'#9b8a74');
  }
  // The skyline is deliberately distant, so the macro lens turns it into silhouettes.
  const towerBody=material('#9ba1a9',{townColorMode:'global'}),towerRoof=material('#9ca3a6',{townColorMode:'global'}),towerWindow=material('#65737c',{townColorMode:'global'});
  for(let i=0;i<34;i++){
    const angle=i*Math.PI*2/34,r=74+(i%4)*4,x=14.8+Math.cos(angle)*r,z=14.8+Math.sin(angle)*r,h=8+(i*7%14);
    box(x,h/2,z,5+i%4,h,5+i%3,towerBody);box(x,h+.15,z,5.2+i%4,.3,5.2+i%3,towerRoof);
    for(let k=0;k<5;k++)for(let j=0;j<Math.floor(h/2);j++)box(x-2+k,1+j*2,z+3,.45,.72,.03,towerWindow);
  }
}

function squarePath(cx,cz,half,radius){
  const p=[];
  for(let i=0;i<4;i++){
    const a=i*Math.PI/2,cxCorner=cx+(i===0||i===3?1:-1)*(half-radius),czCorner=cz+(i<2?1:-1)*(half-radius);
    for(let j=0;j<=6;j++){const theta=a+j*Math.PI/12;p.push(new THREE.Vector3(cxCorner+Math.cos(theta)*radius,0,czCorner+Math.sin(theta)*radius));}
  }
  return new THREE.CatmullRomCurve3(p,true,'centripetal');
}
export const trafficPaths=[...centers.map(([x,z])=>squarePath(x,z,13.85,2.2)),squarePath(14.8,14.8,30.55,2.2)];
