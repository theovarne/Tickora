import { exchanges, loadSnapshot, loadMarketData, formatVolume } from './data.js?v=17';
import { createTown } from './scene.js?v=24';
import { mountExplorer } from './explore-ui.js?v=17';
import { createAmbientAudio } from './ambient.js?v=23';
import { contractAddress } from './site-config.js?v=26';

const $ = (id) => document.getElementById(id);
const caText=contractAddress.trim();
$('ca-value').textContent=caText||'soon';
$('ca-status').classList.toggle('ca-address',Boolean(caText));
$('ca-status').setAttribute('aria-label',caText?`Contract address: ${caText}`:'CA soon');
$('ca-status').title=caText?'Contract address':'Contract address coming soon';
$('app').classList.toggle('has-ca',Boolean(caText));
const state = { index: 0, paused: window.matchMedia('(prefers-reduced-motion: reduce)').matches, speed: 8, hour: 19, cycle: true, macro: true, shutter: .22, weather: 'clear', intensity: .65, timeMode: 'auto' };
const ambient=createAmbientAudio(),soundState={enabled:false,volume:.35,townLevel:.5};
let soundDesired=false,soundBusy=false;
try{const saved=localStorage.getItem('blocktown:volume');if(saved!==null&&Number.isFinite(Number(saved)))soundState.volume=Math.max(0,Math.min(1,Number(saved)));}catch{}
ambient.setVolume(soundState.volume);
try{const saved=localStorage.getItem('blocktown:town-volume');if(saved!==null&&Number.isFinite(Number(saved)))soundState.townLevel=Math.max(0,Math.min(1,Number(saved)));}catch{}
ambient.setTownLevel(soundState.townLevel);
let town, market, hintTimer, explorer, refreshing = null, graphicsFailed = false;
const launch = new URLSearchParams(location.search);
const launchHour = launch.get('hour');
const weatherNames={clear:'Clear',sunny:'Sunny',rain:'Rain',snow:'Snow'};
try{
  const saved=JSON.parse(localStorage.getItem('blocktown:sky')||'null');
  if(saved&&typeof saved==='object'){
    if(Object.hasOwn(weatherNames,saved.weather))state.weather=saved.weather;
    if(typeof saved.intensity==='number'&&Number.isFinite(saved.intensity))state.intensity=Math.max(.2,Math.min(1,saved.intensity));
    if(launchHour===null&&['day','night','auto'].includes(saved.timeMode)){state.timeMode=saved.timeMode;state.cycle=saved.timeMode==='auto';state.hour=saved.timeMode==='day'?13:saved.timeMode==='night'?21:19;}
  }
}catch{}
if (launchHour !== null && launchHour !== '' && Number.isFinite(Number(launchHour))) state.hour = ((Number(launchHour) % 24) + 24) % 24;
if(launch.has('cycle'))state.cycle=launch.get('cycle')!=='0';
if(Object.hasOwn(weatherNames,launch.get('weather')))state.weather=launch.get('weather');
if(launch.get('intensity')!==null&&launch.get('intensity')!==''&&Number.isFinite(Number(launch.get('intensity'))))state.intensity=Math.max(.2,Math.min(1,Number(launch.get('intensity'))));
state.timeMode=state.cycle?'auto':state.hour>=6&&state.hour<18?'day':'night';
let selectedId = launch.get('exchange');
try { selectedId ||= localStorage.getItem('blocktown:exchange'); } catch {}
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const icons = [
  '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/>',
  '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="m7 15 4-5 3 3 3-4"/>',
  '<circle cx="12" cy="12" r="8"/><path d="M14.5 8.5c-4-2-6 2-2.5 3.5s1.5 5.5-2.5 3.5M12 6v12"/>',
  '<circle cx="9" cy="8" r="3"/><path d="M3 19v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M17 14c3 0 4 2 4 5"/>'
];
function hint(text, force=false) {
  if(!force&&($('app').classList.contains('controls-on')||$('app').classList.contains('ui-off')))return;
  $('ui-hint').textContent=text;$('ui-hint').classList.add('on');clearTimeout(hintTimer);
  hintTimer=setTimeout(()=>$('ui-hint').classList.remove('on'),force?1800:1200);
}
function feature(title, subtitle, n) {
  const wrap = document.createElement('span'); wrap.className='feature'; wrap.title=`${title} · ${subtitle}`;
  const icon=document.createElement('i');icon.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[n]}</svg>`;
  const copy=document.createElement('span'),b=document.createElement('b'),small=document.createElement('small');b.textContent=title;small.textContent=subtitle;copy.append(b,small);wrap.append(icon,copy);return wrap;
}
function renderTabs() {
  const restoreFocus=$('tabs').contains(document.activeElement);
  $('tabs').replaceChildren(...exchanges.map((r,i)=>{const b=document.createElement('button');b.type='button';b.role='tab';b.textContent=r.name;b.setAttribute('aria-selected',String(i===state.index));b.setAttribute('aria-controls','exchange-details');b.tabIndex=i===state.index?0:-1;b.onclick=()=>select(i);return b;}));
  if(restoreFocus)$('tabs').children[state.index]?.focus({preventScroll:true});
}
$('tabs').addEventListener('keydown',e=>{
  if(e.target.getAttribute('role')!=='tab'||e.metaKey||e.ctrlKey||e.altKey)return;
  const index=e.key==='Home'?0:e.key==='End'?exchanges.length-1:e.key==='ArrowLeft'?state.index-1:e.key==='ArrowRight'?state.index+1:null;
  if(index===null)return;e.preventDefault();e.stopPropagation();select(index);$('tabs').children[state.index]?.focus({preventScroll:true});
});
function renderCard() {
  const peakActivity=Math.max(1,...exchanges.map(record=>Number.isFinite(record.volume)?Math.max(0,record.volume):0));
  const selectedVolume=exchanges[state.index]?.volume;
  ambient.setActivity(Number.isFinite(selectedVolume) ? .2+.8*Math.sqrt(Math.max(0,selectedVolume)/peakActivity) : .35);
  const r=exchanges[state.index], total=exchanges.filter(x=>x.type===r.type).length;
  $('district-no').textContent=`${state.index+1} / ${exchanges.length}`;
  $('lab').textContent=r.name;$('lab-line').textContent=r.available?`${r.name} · ${r.type} · #${r.rank} of ${total} by 24h volume`:`${r.name} · ${r.type}`;
  $('model').textContent=r.type==='CEX'?'Centralized Exchange':'Decentralized Exchange';$('model').title=`${r.name} · source: ${r.source} · id: ${r.id}`;
  $('lab-mark').querySelector('img').src=r.logo;$('lab-mark').style.background=r.type==='CEX'?'#08090b':'#faf7f1';
  $('data-status').textContent=r.live?'LIVE':'24H';$('data-status').classList.toggle('snapshot',!r.live);
  $('data-status').title=r.updatedAt?`Reported data · ${new Date(r.updatedAt).toLocaleString()}`:'24h trading activity';
  $('volume').textContent=r.available?formatVolume(r.volume):'—';
  const change=r.changeDay;const valid=Number.isFinite(change);
  $('growth').textContent=valid?`${change<0?'↓':'↑'} ${Math.abs(change).toFixed(1)}%`:'—';
  $('growth').className=valid&&change<0?'down':!r.live?'stale':'';
  $('growth').title=valid?r.changeDayBasis||'24h volume change':'24h volume change';
  const sourceLabel=r.updatedAt?new Date(r.updatedAt).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'market data';
  const features = r.type==='CEX' ? [
    [Number.isFinite(r.trust)?`Trust ${r.trust}/10`:'Trust —','CoinGecko trust score'],[r.source,sourceLabel],[r.available?formatVolume(r.volume):'—','reported 24h volume'],[`${r.year||'—'} · ${r.country||'Unknown'}`,'established · country']
  ] : [
    [`${r.chainCount||r.chains.length} chains`,'reported chain coverage'],[r.source,sourceLabel],[r.available?formatVolume(r.volume):'—','reported 24h volume'],[r.chains.length?`${r.chains.slice(0,2).join(', ')}${r.chains.length>2?` +${r.chains.length-2}`:''}`:'—','networks reporting']
  ];
  $('features').replaceChildren(...features.map((f,i)=>feature(...f,i)));
  const values=(r.trend||[]).filter(value=>Number.isFinite(value)&&value>=0).slice(-4),max=Math.max(...values,1);
  const color=r.color?.toLowerCase()==='#202124'?'#e6e9f0':r.color;
  [...$('spark').children].forEach((bar,i)=>{const value=values[i-4+values.length];bar.hidden=value===undefined;bar.style.height=`${Math.max(4,(value||0)/max*64)}px`;bar.style.background=color;bar.style.opacity=String(.4+i*.18);});
  $('spark').title=values.length?values.map((value,i)=>`${r.trendLabels?.slice(-values.length)[i]||'Reported volume'}: ${formatVolume(value)}`).join('\n'):'Reported trading volume';
  $('tabs').querySelectorAll('button').forEach((b,i)=>{b.setAttribute('aria-selected',String(i===state.index));b.tabIndex=i===state.index?0:-1;});
}
function select(index, immediate=false) {
  const next=(index+exchanges.length)%exchanges.length, changed=next!==state.index;
  state.index=next;selectedId=exchanges[next].id;renderCard();town?.setSelection(state.index,immediate);updateTags();
  if(changed&&!immediate)ambient.playVisit();
  try{localStorage.setItem('blocktown:exchange',selectedId);}catch{}
  saveView();
  if($('explore-dialog').open)explorer?.render();
  if(graphicsFailed)renderMap();
  if(changed&&!immediate&&!reduceMotion.matches){
    ['.model-line','.usage','.features'].forEach((selector,i)=>{
      const row=document.querySelector(`.details ${selector}`);
      row.getAnimations().forEach(animation=>animation.cancel());
      row.animate([{opacity:.25,transform:'translateY(7px)'},{opacity:1,transform:'translateY(0)'}],{duration:360,delay:i*45,easing:'cubic-bezier(.2,.8,.2,1)',fill:'backwards'});
    });
  }
}
function neighborIndex(side){const start=Math.floor(state.index/4)*4,count=Math.min(4,exchanges.length-start);return start+(state.index-start+(side?1:-1)+count)%count;}
function updateTags() {
  ['left','right'].forEach((side,n)=>{const idx=neighborIndex(n),r=exchanges[idx],tag=$(`tag-${side}`);tag.querySelector('b').textContent=`${r.name} · ${r.type==='CEX'?'Centralized':'Decentralized'} Exchange`;tag.querySelector('span').textContent=`${r.available?formatVolume(r.volume):'—'} · ${r.type}`;});
}
function renderPause(){$('pause').textContent=state.paused?'▶':'Ⅱ';$('pause').setAttribute('aria-label',`${state.paused?'Resume':'Pause'} crowd (Space)`);$('pause').setAttribute('aria-pressed',String(state.paused));}
function togglePause(){state.paused=!state.paused;town?.setPaused(state.paused);renderPause();hint(state.paused?'Paused':'Playing');}
function speed(value){state.speed=value;town?.setSpeed(value);$('speed').textContent=value===1?'1× real time':`${value}× timelapse`;hint($('speed').textContent);}
function hour(value){
  state.hour=((value%24)+24)%24;town?.setTime(state.hour);$('daytime').value=state.hour;
  const minutes=Math.round(state.hour*60)%(24*60);
  $('clock').textContent=`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
  state.timeMode=state.cycle?'auto':state.hour>=6&&state.hour<18?'day':'night';renderSky();
}
function shutter(value,feedback=false){state.shutter=Math.min(.45,Math.max(0,Math.round(value*100)/100));$('shutter').value=state.shutter;town?.setShutter(state.shutter);if(feedback)hint(`Shutter ${state.shutter.toFixed(2)}`);}
function cycle(value){state.cycle=!!value;$('cycle').checked=state.cycle;state.timeMode=state.cycle?'auto':state.hour>=6&&state.hour<18?'day':'night';renderSky();persistSky();hint(state.cycle?'Day/night cycle on':'Day/night cycle off');saveView();}
function persistSky(){try{localStorage.setItem('blocktown:sky',JSON.stringify({weather:state.weather,intensity:state.intensity,timeMode:state.timeMode}));}catch{}}
function renderSky(){
  ambient.setWeather(state.weather,state.intensity);ambient.setTime(state.hour);renderSound();
  $('sky-label').textContent=`${weatherNames[state.weather]} · ${state.timeMode==='auto'?'Auto':state.timeMode==='day'?'Day':'Night'}`;
  $('sky-open').title=`${weatherNames[state.weather]} · ${$('clock').textContent}`;
  $('sky-open').setAttribute('aria-label',`Town atmosphere · ${$('sky-label').textContent}`);
  const icon=$('sky-weather').querySelector(`[data-weather="${state.weather}"] svg`);if(icon)$('sky-open').querySelector('svg').innerHTML=icon.innerHTML;
  $('sky-time').querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.time===state.timeMode)));
  $('sky-weather').querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.weather===state.weather)));
  $('sky-intensity').value=state.intensity;$('sky-strength').textContent=`${Math.round(state.intensity*100)}%`;
  $('sky-intensity').disabled=state.weather==='clear';$('sky-intensity').closest('.sky-intensity').hidden=state.weather==='clear';
  $('app').dataset.weather=state.weather;$('app').dataset.time=state.hour>=6&&state.hour<18?'day':'night';
}
function renderSound(){
  const enabled=soundState.enabled;
  $('sound-toggle').setAttribute('aria-pressed',String(enabled));
  $('sound-toggle').setAttribute('aria-label',enabled?'Mute ambient sound':'Enable ambient sound');
  $('sound-toggle').title=enabled?`Sound on · ${Math.round(soundState.volume*100)}%`:'Sound off';
  $('sky-sound-toggle').setAttribute('aria-pressed',String(enabled));$('sky-sound-toggle').textContent=enabled?'On':'Off';
  $('sound-volume').value=soundState.volume;$('sound-level').textContent=`${Math.round(soundState.volume*100)}%`;
  $('sound-town').value=soundState.townLevel;$('sound-town-level').textContent=`${Math.round(soundState.townLevel*100)}%`;
  $('sound-scene').textContent=state.weather==='rain'?'Rain & gentle drops':state.weather==='snow'?'Winter wind':state.hour>=6&&state.hour<18?'Breeze & birdsong':'Night breeze & crickets';
}
async function toggleSound(){
  if(soundBusy)return;soundBusy=true;soundDesired=!soundState.enabled;
  try{soundState.enabled=await ambient.setEnabled(soundDesired);soundDesired=soundState.enabled;}
  catch(error){soundState.enabled=false;soundDesired=false;console.warn('BlockTown audio',error);hint('Tap sound to try again');}
  finally{soundBusy=false;renderSound();}
}
function setTimeMode(mode){
  if(!['day','night','auto'].includes(mode))return;
  state.cycle=mode==='auto';$('cycle').checked=state.cycle;
  hour(mode==='day'?13:mode==='night'?21:state.hour);persistSky();saveView();
}
function setWeather(type,intensity=state.intensity){
  if(!Object.hasOwn(weatherNames,type))return;
  state.weather=type;state.intensity=Math.max(.2,Math.min(1,Number(intensity)||.65));
  town?.setWeather?.(state.weather,state.intensity);renderSky();persistSky();saveView();
}
function setControls(visible,persist=true){
  $('app').classList.toggle('controls-on',visible);$('show-controls').setAttribute('aria-expanded',String(visible));$('show-controls').setAttribute('aria-label',visible?'Hide playback controls':'Show playback controls');
  if(!visible&&document.querySelector('.playback').contains(document.activeElement))document.activeElement.blur();
  if(persist)try{localStorage.setItem('blocktown:controls',visible?'1':'0');}catch{}
}
function toggleControls(){setControls(!$('app').classList.contains('controls-on'));}
function toggleUI(){
  const hidden=$('app').classList.toggle('ui-off');
  if(hidden&&$('app').contains(document.activeElement))document.activeElement.blur();
  hint(hidden?'Interface hidden · press / to show it':'Interface visible',true);
}
$('prev').onclick=()=>select(state.index-1);$('next').onclick=()=>select(state.index+1);$('pause').onclick=togglePause;
$('speed').onclick=()=>{const all=[1,8,24,48];speed(all[(all.indexOf(state.speed)+1)%all.length]);};
$('macro').onchange=e=>{state.macro=e.target.checked;town?.setMacro(state.macro);hint(state.macro?'Macro lens on':'Macro lens off');};
$('cycle').onchange=e=>cycle(e.target.checked);
$('daytime').oninput=e=>{state.cycle=false;$('cycle').checked=false;hour(Number(e.target.value));persistSky();saveView();};
$('shutter').oninput=e=>shutter(Number(e.target.value));
$('show-controls').onclick=toggleControls;
renderPause();
try{setControls(localStorage.getItem('blocktown:controls')==='1',false);}catch{setControls(false,false);}
$('about').onclick=()=>{$('info').showModal();};$('close').onclick=()=>{$('info').close();};
$('info').addEventListener('click',e=>{if(e.target===$('info')){const b=$('info').getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)$('info').close();}});
$('sky-open').onclick=()=>{if($('info').open)$('info').close();if($('explore-dialog').open)explorer?.close();renderSky();$('sky-dialog').showModal();};
$('sky-close').onclick=()=>{$('sky-dialog').close();};
$('sky-time').addEventListener('click',event=>{const button=event.target.closest('button[data-time]');if(button)setTimeMode(button.dataset.time);});
$('sky-weather').addEventListener('click',event=>{const button=event.target.closest('button[data-weather]');if(button)setWeather(button.dataset.weather);});
$('sky-intensity').oninput=event=>setWeather(state.weather,event.target.value);
$('sound-toggle').onclick=toggleSound;$('sky-sound-toggle').onclick=toggleSound;
$('sound-volume').oninput=event=>{soundState.volume=Math.max(0,Math.min(1,Number(event.target.value)));ambient.setVolume(soundState.volume);renderSound();try{localStorage.setItem('blocktown:volume',String(soundState.volume));}catch{}};
$('sound-town').oninput=event=>{soundState.townLevel=Math.max(0,Math.min(1,Number(event.target.value)));ambient.setTownLevel(soundState.townLevel);renderSound();try{localStorage.setItem('blocktown:town-volume',String(soundState.townLevel));}catch{}};
renderSound();
document.addEventListener('visibilitychange',async()=>{
  try{soundState.enabled=await ambient.setEnabled(!document.hidden&&soundDesired);renderSound();}
  catch{soundState.enabled=false;renderSound();}
});
window.addEventListener('pagehide',()=>{ambient.setEnabled(false).catch(()=>{});});
$('sky-dialog').addEventListener('click',event=>{if(event.target===$('sky-dialog')){const rect=$('sky-dialog').getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)$('sky-dialog').close();}});
document.addEventListener('keydown',e=>{
  if((e.metaKey||e.ctrlKey)&&!e.altKey&&e.key.toLowerCase()==='k'){e.preventDefault();if(!e.repeat){if($('sky-dialog').open)$('sky-dialog').close();explorer?.open();}return;}
  if($('info').open||$('explore-dialog').open||$('sky-dialog').open)return;
  if((e.metaKey||e.ctrlKey)&&!e.altKey&&(e.key==="'"||e.code==='Quote')){e.preventDefault();if(!e.repeat)toggleControls();return;}
  const target=e.target instanceof Element?e.target:document.body,isRange=target.matches('input[type=range]'),isCheckbox=target.matches('input[type=checkbox]'),isButton=target.tagName==='BUTTON';
  if(target.isContentEditable||/TEXTAREA|SELECT/.test(target.tagName)||(target.tagName==='INPUT'&&!isRange&&!isCheckbox))return;
  if(e.metaKey||e.ctrlKey||e.altKey)return;
  if(e.key==='ArrowLeft'&&!isRange&&!isButton){e.preventDefault();select(state.index-1);}else if(e.key==='ArrowRight'&&!isRange&&!isButton){e.preventDefault();select(state.index+1);}
  else if(e.key===' '&&!isButton&&!isRange&&!isCheckbox){e.preventDefault();if(!e.repeat)togglePause();}else if('1234'.includes(e.key)&&e.key.length===1)speed([1,8,24,48][Number(e.key)-1]);
  else if(e.key==='[')shutter(state.shutter-.05,true);else if(e.key===']')shutter(state.shutter+.05,true);
  else if(e.key.toLowerCase()==='d'){if(!e.repeat)cycle(!state.cycle);}
  else if(e.key===','||e.key==='.'){state.cycle=false;$('cycle').checked=false;hour(Math.round(state.hour)+(e.key==='.'?1:-1));persistSky();saveView();hint($('clock').textContent);}
  else if(e.key==='/'){e.preventDefault();if(!e.repeat)toggleUI();}
  else if(e.key.toLowerCase()==='r'){town?.resetView();hint('Camera reset');}
});
let pointer, pinchDistance=0, multiTouch=false, scrubbingTime=false;
const activePointers=new Map();
function pointerCursor(cursor,label=''){const canvas=$('world').querySelector('canvas');if(canvas){canvas.style.cursor=cursor;canvas.title=label;}}
function touchDistance(){const [a,b]=[...activePointers.values()];return a&&b?Math.hypot(a.x-b.x,a.y-b.y):0;}
$('world').addEventListener('pointerdown',e=>{
  if(e.button!==0||!town||e.target.closest?.('.map-store'))return;
  activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(activePointers.size===1){pointer={id:e.pointerId,lastX:e.clientX,lastY:e.clientY,travel:0};multiTouch=false;}
  else{multiTouch=true;pinchDistance=touchDistance();}
  $('world').setPointerCapture(e.pointerId);pointerCursor('grabbing');
});
$('world').addEventListener('pointermove',e=>{
  if(!activePointers.has(e.pointerId)){
    if(e.pointerType==='mouse'){const hit=town?.hitTest?.(e.clientX,e.clientY);pointerCursor(hit?'pointer':'grab',hit?.label||'');}
    return;
  }
  activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(activePointers.size>1){const next=touchDistance();if(pinchDistance)town?.zoom((pinchDistance-next)*1.4);pinchDistance=next;return;}
  if(!pointer||pointer.id!==e.pointerId)return;
  const dx=e.clientX-pointer.lastX,dy=e.clientY-pointer.lastY;pointer.travel+=Math.hypot(dx,dy);
  town?.orbit(dx,dy);pointer.lastX=e.clientX;pointer.lastY=e.clientY;
});
function finishPointer(e,cancelled=false){
  const click=!cancelled&&!multiTouch&&activePointers.size===1&&pointer?.id===e.pointerId&&pointer.travel<6;
  activePointers.delete(e.pointerId);
  if($('world').hasPointerCapture(e.pointerId))$('world').releasePointerCapture(e.pointerId);
  if(activePointers.size===1){const [id,p]=[...activePointers.entries()][0];pointer={id,lastX:p.x,lastY:p.y,travel:6};pinchDistance=0;}
  else if(!activePointers.size){pointer=null;multiTouch=false;pinchDistance=0;pointerCursor('grab');}
  if(click)town?.pick?.(e.clientX,e.clientY);
}
$('world').addEventListener('pointerup',e=>finishPointer(e));
$('world').addEventListener('pointercancel',e=>finishPointer(e,true));
$('world').addEventListener('lostpointercapture',e=>{if(activePointers.has(e.pointerId))finishPointer(e,true);});
$('world').addEventListener('pointerleave',()=>{if(!activePointers.size){town?.hitTest?.(-1,-1);pointerCursor('grab');}});
$('world').addEventListener('wheel',e=>{e.preventDefault();town?.zoom(e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?innerHeight:1));},{passive:false});
$('daytime').addEventListener('pointerdown',()=>scrubbingTime=true);
window.addEventListener('pointerup',()=>scrubbingTime=false);
window.addEventListener('pointercancel',()=>scrubbingTime=false);
window.addEventListener('blur',()=>{activePointers.clear();pointer=null;multiTouch=false;scrubbingTime=false;pointerCursor('grab');});
window.addEventListener('resize',()=>town?.resize());

function layoutTags(){
  const speech=town?.projectSpeech?.();$('speech').hidden=!speech;
  if(speech){$('speech').style.left=`${speech.x}px`;$('speech').style.top=`${speech.y-9}px`;}
  if(town&&innerWidth>650){['left','right'].forEach((side,n)=>{const idx=neighborIndex(n),p=town.projectLabel(idx),tag=$(`tag-${side}`);if(p&&Number.isFinite(p.x)&&Number.isFinite(p.y)){const x=n?Math.max(innerWidth*.79,p.x):Math.min(innerWidth*.18,p.x);tag.style.left=`${Math.min(innerWidth-60,Math.max(60,x))}px`;tag.style.top=`${Math.max(innerHeight*.28,Math.min(innerHeight*.43,p.y))}px`;tag.style.opacity='.7';}else{tag.style.left=n?'77%':'20%';tag.style.top='29%';}});}
}
let last=performance.now(),clockUpdate=0;
function animate(now){const dt=Math.min((now-last)/1000,.1);last=now;if(!state.paused&&state.cycle&&!scrubbingTime){state.hour=(state.hour+dt*state.speed/30)%24;clockUpdate+=dt;if(clockUpdate>.2){hour(state.hour);clockUpdate=0;}}layoutTags();requestAnimationFrame(animate);}

function saveView(){
  const url=new URL(location.href);url.searchParams.set('exchange',exchanges[state.index].id);
  url.searchParams.set('hour',state.hour.toFixed(2));
  url.searchParams.set('cycle',state.cycle?'1':'0');
  url.searchParams.set('weather',state.weather);url.searchParams.set('intensity',state.intensity.toFixed(2));
  history.replaceState(null,'',url);updateShare();
}
function shareURL(){
  const url=new URL('https://blocktown.fun/');url.searchParams.set('exchange',exchanges[state.index].id);
  url.searchParams.set('hour',state.hour.toFixed(2));url.searchParams.set('cycle','0');url.searchParams.set('weather',state.weather);url.searchParams.set('intensity',state.intensity.toFixed(2));return url.href;
}
function updateShare(){$('share-view').href=`https://x.com/intent/post?text=${encodeURIComponent(`Explore ${exchanges[state.index].name} in BlockTown`)}&url=${encodeURIComponent(shareURL())}`;}
$('share-view').addEventListener('pointerdown',updateShare);
$('share-view').addEventListener('focus',updateShare);
$('share-view').addEventListener('click',updateShare);
window.addEventListener('popstate',()=>{
  const params=new URLSearchParams(location.search),index=exchanges.findIndex(record=>record.id===params.get('exchange'));
  if(params.has('hour')&&params.get('hour')!==''&&Number.isFinite(Number(params.get('hour'))))hour(Number(params.get('hour')));
  state.cycle=params.get('cycle')!=='0';$('cycle').checked=state.cycle;
  state.weather=Object.hasOwn(weatherNames,params.get('weather'))?params.get('weather'):'clear';
  const intensity=params.get('intensity');state.intensity=intensity!==null&&intensity!==''&&Number.isFinite(Number(intensity))?Math.max(.2,Math.min(1,Number(intensity))):.65;
  state.timeMode=state.cycle?'auto':state.hour>=6&&state.hour<18?'day':'night';town?.setWeather?.(state.weather,state.intensity);renderSky();
  if(index>=0)select(index);else updateShare();
});

function renderMap(){
  if(town)return;
  $('app').classList.add('map-view');$('world').classList.add('world-map');
  const tiles=exchanges.map((record,index)=>{
    const tile=document.createElement('button');tile.type='button';tile.className=`map-store${index===state.index?' selected':''}`;
    const logo=document.createElement('img');logo.src=record.logo;logo.alt='';
    const name=document.createElement('b');name.textContent=record.name;
    const volume=document.createElement('span');volume.textContent=record.available?`$${formatVolume(record.volume)} · ${record.type}`:record.type;
    tile.append(logo,name,volume);tile.onclick=()=>select(index);return tile;
  });
  $('world').replaceChildren(...tiles);
}

function renderFeedStatus(){
  $('feed-status').replaceChildren(...['CoinGecko','DefiLlama'].map(source=>{
    const stamp=Math.max(0,...exchanges.filter(record=>record.source===source&&record.updatedAt).map(record=>Date.parse(record.updatedAt)));
    const line=document.createElement('div');line.textContent=`${source} · ${stamp?`Reported ${new Date(stamp).toLocaleString()}`:'Market activity'}`;return line;
  }));
}
function refreshMarket(){
  if(refreshing)return refreshing;
  refreshing=(async()=>{
    market=await loadMarketData({timeoutMs:7000});renderCard();updateTags();town?.updateData?.(exchanges);
    renderFeedStatus();explorer?.render();if(graphicsFailed)renderMap();
  })().finally(()=>{refreshing=null;});
  return refreshing;
}
explorer=mountExplorer({records:exchanges,getSelectedId:()=>exchanges[state.index].id,onSelect:id=>{const index=exchanges.findIndex(record=>record.id===id);if(index>=0)select(index);},onRefresh:refreshMarket});

$('download-scene').onclick=async()=>{
  const button=$('download-scene'),label=button.innerHTML;button.disabled=true;button.textContent='Saving…';
  try{
    let blob;
    if(town)blob=await town.captureImage();
    else{
      const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=800;const ctx=canvas.getContext('2d');
      ctx.fillStyle='#202a36';ctx.fillRect(0,0,1280,800);ctx.fillStyle='#f5f7fa';ctx.font='600 42px "DM Sans",Arial';ctx.fillText('BlockTown',48,72);
      ctx.font='18px "DM Sans",Arial';ctx.fillStyle='#c1cfdb';ctx.fillText('The exchange economy, alive.',48,108);
      exchanges.forEach((record,index)=>{const x=48+(index%4)*302,y=150+Math.floor(index/4)*145;ctx.fillStyle=index===state.index?'#3d4b5b':'#293644';ctx.fillRect(x,y,280,125);ctx.fillStyle='#f5f7fa';ctx.font='600 20px "DM Sans",Arial';ctx.fillText(record.name,x+18,y+40);ctx.font='16px "DM Sans",Arial';ctx.fillStyle='#c1cfdb';ctx.fillText(`${record.type} · ${record.available?'$'+formatVolume(record.volume):'—'}`,x+18,y+80);});
      blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Image capture failed')),'image/png'));
    }
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`BlockTown-${exchanges[state.index].id}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
    button.textContent='Image saved';
  }catch(error){console.error(error);button.textContent='Save again';}
  finally{button.disabled=false;setTimeout(()=>{button.innerHTML=label;},1500);}
};

async function start(){
  market=await loadSnapshot();
  const index=exchanges.findIndex(record=>record.id===selectedId);state.index=index>=0?index:0;
  renderTabs();renderCard();updateTags();renderFeedStatus();hour(state.hour);$('cycle').checked=state.cycle;
  await document.fonts.ready;
  try{
    town=createTown($('world'),exchanges);town.setSelection(state.index,true);town.setTime(state.hour);town.setWeather?.(state.weather,state.intensity);town.setSpeed(state.speed);town.setMacro(state.macro);town.setShutter(state.shutter);town.setPaused(state.paused);town.onSelect?.(i=>select(i));
    $('loading')?.remove();
  }catch(error){console.warn('BlockTown graphics',error);graphicsFailed=true;renderMap();}
  explorer.render();saveView();requestAnimationFrame(animate);
  refreshMarket().catch(console.error);
  setInterval(()=>refreshMarket().catch(console.error),300000);
}
start().catch(error=>{console.error(error);graphicsFailed=true;renderTabs();renderCard();updateTags();renderMap();explorer.render();updateShare();});
