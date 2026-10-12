import * as THREE from './vendor/three.module.js';
import { Pass, FullScreenQuad } from './vendor/addons/postprocessing/Pass.js';

// A block stays fully colored all the way to its curb. Only the neighboring
// blocks receive the cool monochrome treatment; there is no radial color veil.
export function districtMaterial(material, center, warmLights, weather) {
  material.onBeforeCompile = shader => {
    shader.uniforms.townCenter = center;
    shader.uniforms.townPreserveColor = {value:material.userData.townColorMode==='global'?1:0};
    shader.uniforms.townStaticSaturation = {value:Number.isFinite(material.userData.townSaturation)?THREE.MathUtils.clamp(material.userData.townSaturation,0,1):-1};
    shader.uniforms.townStaticWarmLift = {value:Number.isFinite(material.userData.townWarmLift)?Math.max(0,material.userData.townWarmLift):-1};
    if(warmLights){shader.uniforms.townWarmPositions=warmLights.positions;shader.uniforms.townWarmColors=warmLights.colors;}
    if(weather){
      shader.uniforms.townWetness=weather.wetness;
      shader.uniforms.townRoofSnow=weather.roofSnow;
      shader.uniforms.townGroundSnow=weather.groundSnow;
      shader.uniforms.townSnowRoad={value:material.userData.townSnowRoad?1:0};
      shader.uniforms.townSnowRetention={value:material.userData.townSnowRetention===0?0:1};
      shader.uniforms.townSnowTracks=weather.roadTracks;
    }
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 townPosition;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 townVertex = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        townVertex = instanceMatrix * townVertex;
      #endif
      townPosition = (modelMatrix * townVertex).xyz;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      uniform vec3 townCenter; uniform float townPreserveColor,townStaticSaturation,townStaticWarmLift; varying vec3 townPosition;
      float townBlockMask(){vec2 offset=abs(townPosition.xz-townCenter.xz);return 1.0-smoothstep(5.5,5.7,max(offset.x,offset.y));}
      ${weather?`uniform float townWetness,townRoofSnow,townGroundSnow,townSnowRoad,townSnowRetention;
      uniform sampler2D townSnowTracks;
      float townSnowHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float townSnowNoise(vec2 p){
        vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(townSnowHash(i),townSnowHash(i+vec2(1.0,0.0)),f.x),
          mix(townSnowHash(i+vec2(0.0,1.0)),townSnowHash(i+vec2(1.0)),f.x),f.y);
      }`:''}
      ${warmLights?'uniform vec4 townWarmPositions[10]; uniform vec4 townWarmColors[10];':''}`);
    if(weather)shader.fragmentShader=shader.fragmentShader.replace('#include <lights_physical_fragment>', `
    if(townWetness>0.001||townRoofSnow>0.001||townGroundSnow>0.001){
      vec3 surfaceNormal=normalize(normal*mat3(viewMatrix));
      float upward=smoothstep(0.35,0.82,surfaceNormal.y);
      float nearGround=1.0-smoothstep(0.5,1.3,townPosition.y);
      float wetSurface=townWetness*upward*(0.35+0.65*nearGround);
      diffuseColor.rgb*=1.0-0.22*wetSurface;
      roughnessFactor=mix(roughnessFactor,0.14,wetSurface);
      float snowAmount=mix(townGroundSnow,townRoofSnow,smoothstep(0.45,1.5,townPosition.y));
      vec2 snowPoint=townPosition.xz;
      float snowTexture=townSnowNoise(snowPoint*1.15)*0.56
        +townSnowNoise(snowPoint*4.3)*0.29+townSnowNoise(snowPoint*17.0)*0.15;
      float snowPatches=smoothstep(1.0-snowAmount*1.15-0.075,
        1.0-snowAmount*1.15+0.075,smoothstep(0.16,0.84,snowTexture));
      float snowCover=upward*townSnowRetention*clamp(snowAmount*0.32+snowPatches*0.88,0.0,1.0)*min(1.0,snowAmount*12.5);
      // Traffic packs the snow into narrow, darker lanes; curb snow stays soft.
      float packedSnow=townSnowRoad*texture2D(townSnowTracks,(snowPoint-14.8)/256.0+0.5).r;
      snowCover*=1.0-packedSnow*0.48;
      vec3 snowColor=mix(vec3(0.91,0.95,0.98),vec3(0.98,0.99,1.0),snowTexture);
      diffuseColor.rgb=mix(diffuseColor.rgb,snowColor,snowCover);
      roughnessFactor=mix(roughnessFactor,0.96,snowCover);
    }
    #include <lights_physical_fragment>`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
    {
      float activeBlock=townBlockMask();
      float warmLift=townStaticWarmLift>=0.0?townStaticWarmLift:mix(0.13,0.20,activeBlock)*(1.0-townPreserveColor);
      reflectedLight.directDiffuse += material.diffuseContribution * vec3(1.0,0.74,0.5) * warmLift;
      ${warmLights?`vec3 townWorldNormal=normalize(normal*mat3(viewMatrix));
      for(int lightIndex=0;lightIndex<10;lightIndex++){
        vec3 lightVector=townWarmPositions[lightIndex].xyz-townPosition;
        float lightRadius=max(townWarmPositions[lightIndex].w,0.001);
        float distanceSquared=dot(lightVector,lightVector);
        float attenuation=max(0.0,1.0-distanceSquared/(lightRadius*lightRadius));
        float surfaceLight=0.2+0.8*max(dot(townWorldNormal,lightVector*inversesqrt(max(distanceSquared,0.0001))),0.0);
        reflectedLight.directDiffuse+=material.diffuseContribution*townWarmColors[lightIndex].rgb*townWarmColors[lightIndex].a*attenuation*attenuation*surfaceLight;
      }`:''}
    }`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      float districtSaturation = townStaticSaturation>=0.0?townStaticSaturation:mix(townBlockMask(),1.0,townPreserveColor);
      vec3 districtGray = vec3(dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722))) * vec3(0.93, 0.96, 1.04);
      outgoingLight = mix(districtGray, outgoingLight, districtSaturation);
      #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => `blocktown-district-v23-${warmLights?1:0}-${weather?1:0}`;
  return material;
}

// The miniature lens uses actual scene depth. Its broad foreground blur and quiet
// background blur leave the selected storefront and its queue readable.
export class MiniatureLensPass extends Pass {
  constructor(depthTexture, camera) {
    super();
    this.uniforms={
      tDiffuse:{value:null},tDepth:{value:depthTexture},tPrepared:{value:null},tBlurred:{value:null},
      resolution:{value:new THREE.Vector2(1,1)},halfResolution:{value:new THREE.Vector2(1,1)},
      cameraNear:{value:camera.near},cameraFar:{value:camera.far},focus:{value:24.7},range:{value:3.2},strength:{value:1}
    };
    const targetOptions={type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:false,stencilBuffer:false};
    this.prepared=new THREE.WebGLRenderTarget(1,1,targetOptions);
    this.blurred=new THREE.WebGLRenderTarget(1,1,targetOptions);
    this.uniforms.tPrepared.value=this.prepared.texture;this.uniforms.tBlurred.value=this.blurred.texture;
    const vertexShader='varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}';
    const common=`varying vec2 vUv; uniform sampler2D tDiffuse,tDepth,tPrepared,tBlurred;
      uniform vec2 resolution,halfResolution; uniform float cameraNear,cameraFar,focus,range,strength;
      float depthAt(vec2 uv){float z=texture2D(tDepth,uv).r;return cameraNear*cameraFar/(cameraFar-z*(cameraFar-cameraNear));}
      vec2 safeUV(vec2 uv){return clamp(uv,vec2(.001),vec2(.999));}
      float circleAt(vec2 uv){float distance=depthAt(uv)-focus;float radius=max(abs(distance)-range,0.0)*(distance<0.0?2.2:.85);return sign(distance)*min(radius*strength,13.0);}`;
    const createMaterial=fragment=>new THREE.ShaderMaterial({uniforms:this.uniforms,vertexShader,fragmentShader:common+fragment,depthTest:false,depthWrite:false});
    this.prepareMaterial=createMaterial(`void main(){
      vec2 halfPixel=.5/resolution;
      vec3 radiance=texture2D(tDiffuse,safeUV(vUv+vec2(-halfPixel.x,-halfPixel.y))).rgb;
      radiance+=texture2D(tDiffuse,safeUV(vUv+vec2(halfPixel.x,-halfPixel.y))).rgb;
      radiance+=texture2D(tDiffuse,safeUV(vUv+vec2(-halfPixel.x,halfPixel.y))).rgb;
      radiance+=texture2D(tDiffuse,safeUV(vUv+halfPixel)).rgb;
      gl_FragColor=vec4(clamp(radiance*.25,vec3(0.0),vec3(24.0)),circleAt(vUv));}`);
    // A fixed disk gathers both background bokeh and the silhouettes of nearby
    // objects. Signed coverage lets foreground blur extend across depth edges.
    this.blurMaterial=createMaterial(`void main(){
      vec4 center=texture2D(tPrepared,vUv);float centerCircle=abs(center.a);
      vec3 accumulated=center.rgb;float totalWeight=1.0;float nearCoverage=max(0.0,-center.a);
      for(int sampleIndex=0;sampleIndex<40;sampleIndex++){
        float number=float(sampleIndex)+.25;float angle=number*2.39996323;
        float sampleRadius=sqrt(number/40.0)*13.0;
        vec2 offset=vec2(cos(angle),sin(angle))*sampleRadius/halfResolution;
        vec4 sampleColor=texture2D(tPrepared,safeUV(vUv+offset));float sampleCircle=abs(sampleColor.a);
        if(center.a<0.0)sampleCircle=min(sampleCircle,centerCircle*2.0);
        float coveringCircle=sampleColor.a<0.0?sampleCircle:centerCircle;
        float coverage=1.0-smoothstep(coveringCircle-.8,coveringCircle+.8,sampleRadius);
        if(coverage>.001){accumulated+=sampleColor.rgb*coverage;totalWeight+=coverage;}
        if(sampleColor.a<0.0)nearCoverage=max(nearCoverage,sampleCircle*coverage);
      }
      gl_FragColor=vec4(accumulated/max(totalWeight,1.0),max(centerCircle,nearCoverage));}`);
    this.material=createMaterial(`void main(){
      vec3 sharp=texture2D(tDiffuse,vUv).rgb;vec4 lens=texture2D(tBlurred,vUv);
      float coverage=smoothstep(.45,1.8,lens.a);
      gl_FragColor=vec4(mix(sharp,lens.rgb,coverage),1.0);}`);
    this.quad=new FullScreenQuad(this.material);
  }
  setSize(width,height){
    this.uniforms.resolution.value.set(width,height);const w=Math.max(1,Math.ceil(width/2)),h=Math.max(1,Math.ceil(height/2));
    this.uniforms.halfResolution.value.set(w,h);this.prepared.setSize(w,h);this.blurred.setSize(w,h);
  }
  render(renderer,writeBuffer,readBuffer){
    this.uniforms.tDiffuse.value=readBuffer.texture;
    this.quad.material=this.prepareMaterial;renderer.setRenderTarget(this.prepared);this.quad.render(renderer);
    this.quad.material=this.blurMaterial;renderer.setRenderTarget(this.blurred);this.quad.render(renderer);
    this.quad.material=this.material;renderer.setRenderTarget(this.renderToScreen?null:writeBuffer);if(this.clear)renderer.clear();this.quad.render(renderer);
  }
  dispose(){this.prepared.dispose();this.blurred.dispose();this.prepareMaterial.dispose();this.blurMaterial.dispose();this.material.dispose();this.quad.dispose();}
}

const periods = [
  {hour:0,bg:'#0c111d',fog:'#141a28',sky:'#46557e',ground:'#28242c',hemi:.5,sun:'#8ea6ff',light:.32,exposure:1.22,night:1,bloom:.62,threshold:.95},
  {hour:5,bg:'#121828',fog:'#1c2234',sky:'#56648e',ground:'#302a30',hemi:.52,sun:'#9fb0ff',light:.34,exposure:1.2,night:1,bloom:.6,threshold:.95},
  {hour:6.5,bg:'#51566f',fog:'#6f6a7e',sky:'#b8a8c8',ground:'#5e5048',hemi:.78,sun:'#ffae84',light:1.1,exposure:1.1,night:.45,bloom:.45,threshold:1.1},
  {hour:8.5,bg:'#8aa3c2',fog:'#9eafc3',sky:'#c6d6ef',ground:'#7a6c5c',hemi:1.05,sun:'#ffe6c8',light:2.1,exposure:1.02,night:0,bloom:.3,threshold:1.4},
  {hour:13,bg:'#9bb4d2',fog:'#afbfd2',sky:'#d2e2ff',ground:'#857563',hemi:1.15,sun:'#fff4e4',light:2.4,exposure:1,night:0,bloom:.28,threshold:1.45},
  {hour:17,bg:'#8b98b2',fog:'#a39fa8',sky:'#cdc6d4',ground:'#7b6a58',hemi:1,sun:'#ffc890',light:2,exposure:1.04,night:.12,bloom:.35,threshold:1.3},
  {hour:19,bg:'#333b49',fog:'#454d5d',sky:'#a3b6da',ground:'#564840',hemi:.82,sun:'#ffd2a6',light:1.25,exposure:1.12,night:1,bloom:.55,threshold:.95},
  {hour:20.5,bg:'#1d2435',fog:'#2a3144',sky:'#7486b6',ground:'#3c3538',hemi:.64,sun:'#b4c2ff',light:.55,exposure:1.16,night:1,bloom:.6,threshold:.95},
  {hour:22,bg:'#0f1422',fog:'#171d2c',sky:'#4c5b84',ground:'#2a262e',hemi:.52,sun:'#94aaff',light:.34,exposure:1.2,night:1,bloom:.62,threshold:.95},
  {hour:24,bg:'#0c111d',fog:'#141a28',sky:'#46557e',ground:'#28242c',hemi:.5,sun:'#8ea6ff',light:.32,exposure:1.22,night:1,bloom:.62,threshold:.95}
];
export function lightingAt(hour) {
  const h = (hour+24)%24;
  let a=periods[0],b=periods[1];
  for(let i=0;i<periods.length-1;i++)if(h>=periods[i].hour&&h<periods[i+1].hour){a=periods[i];b=periods[i+1];break;}
  const t=THREE.MathUtils.smoothstep(h,a.hour,b.hour),result={};
  for(const k of ['bg','fog','sky','ground','sun'])result[k]=new THREE.Color(a[k]).lerp(new THREE.Color(b[k]),t);
  for(const k of ['hemi','light','exposure','night','bloom','threshold'])result[k]=THREE.MathUtils.lerp(a[k],b[k],t);
  result.fogDensity=.0165*(.78+.22*result.night);
  return result;
}

// Every look starts from the hour's baseline, so switching back to clear weather
// restores all original colors and intensities without accumulating adjustments.
export function weatherLightingAt(hour,type='clear',intensity=.65) {
  const look=lightingAt(hour),amount=THREE.MathUtils.clamp(intensity,0,1),day=1-look.night;
  look.windowBoost=1;look.shadowRadius=2;
  if(type==='sunny'){
    look.sun.lerp(new THREE.Color('#ffe0a1'),amount*.35*day);
    look.light*=1+amount*.4*day;look.hemi*=1-amount*.08*day;
    look.bg.lerp(new THREE.Color('#9cc7e9'),amount*.22*day);
    look.fogDensity*=1-amount*.14*day;look.shadowRadius=2-.9*amount*day;
  }else if(type==='rain'){
    look.bg.lerp(new THREE.Color(day>.2?'#566b82':'#182433'),amount*(.65*day+.2));
    look.fog.lerp(new THREE.Color(day>.2?'#8b9aaa':'#31465e'),amount*.65);
    look.sky.lerp(new THREE.Color('#92a9c4'),amount*(.55*day+.2));
    look.ground.lerp(new THREE.Color('#526478'),amount*.6);
    look.light*=1-amount*(.68*day+.22);look.hemi*=1-amount*.1;
    look.sun.lerp(new THREE.Color('#cbd6e7'),amount*.7);
    look.fogDensity*=1+amount*.95;look.windowBoost=1+amount*.24;look.shadowRadius=2+amount;
  }else if(type==='snow'){
    look.bg.lerp(new THREE.Color(day>.2?'#b8c8d8':'#26374e'),amount*(.42*day+.15));
    look.fog.lerp(new THREE.Color(day>.2?'#cbd8e1':'#4a6079'),amount*.58);
    look.sky.lerp(new THREE.Color('#dbe9f4'),amount*.38*day);
    look.ground.lerp(new THREE.Color('#7e8b9c'),amount*.55);
    look.sun.lerp(new THREE.Color('#e1ecfa'),amount*.62);
    look.light*=1-amount*.52;look.hemi*=1+amount*.09*day;
    look.fogDensity*=1+amount*.65;look.windowBoost=1+amount*.13;look.shadowRadius=2+amount;
  }
  return look;
}
