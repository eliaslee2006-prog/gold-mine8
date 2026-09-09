import { api,apiBlob,apiForm } from './api.js';
import { state } from './state.js';

const $=s=>document.querySelector(s);
const STATES=['RELAXED','FOCUSED','ANXIOUS','PANIC','SUCCESS','OFFLINE','ANALYZING'];
const DEFAULT_LOGIC={dueSoonHours:24,anxiousActive:6,anxiousDueSoon:2,panicOverdue:4,panicHighOverdue:2,successCompletedToday:3};
const DEFAULT_SYSTEM={offlineEnabled:true,analyzingEnabled:true,masterEffectIntensity:1,motionMode:'system',moodHoldSeconds:1.5,transitionMs:220};
const FX_PROFILES={
  CLEAN:{enabled:false},
  SUBTLE:{enabled:true,opacity:.45,speed:.75,scale:.95,blendMode:'screen'},
  ENERGY:{enabled:true,opacity:.85,speed:1.25,scale:1,blendMode:'screen'},
  CRITICAL:{enabled:true,opacity:1,speed:1.8,scale:1.1,blendMode:'overlay'}
};
let notify=()=>{},selectedState='RELAXED',selectedEffectIndex=-1,draft=null;
let transient={state:null,until:0,reason:''},transientTimer=null;
let stableMood='RELAXED',moodInitialized=false,pendingMood=null,pendingMoodTimer=null;
const urlCache=new Map();let DotLottieClass=null,dotLottiePromise=null;

function clone(v){return JSON.parse(JSON.stringify(v));}
function assetById(id){return state.avatar?.assets?.find(a=>a.id===id)||null;}
function stateByName(name){return state.avatar?.states?.find(s=>s.state===name)||null;}
function ext(asset){return String(asset?.metadata?.extension||asset?.originalName?.split('.').pop()||'').toLowerCase();}
function fmtBytes(n){n=Number(n)||0;if(n<1024)return `${n} B`;if(n<1024*1024)return `${(n/1024).toFixed(1)} KB`;return `${(n/1024/1024).toFixed(1)} MB`;}
function clamp(n,a,b){n=Number(n);return Number.isFinite(n)?Math.min(b,Math.max(a,n)):a;}
function sgKey(dateLike){const d=new Date(dateLike);if(Number.isNaN(d.getTime()))return '';return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
function logic(){return {...DEFAULT_LOGIC,...(state.avatar?.logic||{})};}
function system(){return {...DEFAULT_SYSTEM,...(state.avatar?.system||{})};}
function motionAllowed(){const m=system().motionMode;if(m==='full')return true;if(m==='reduced')return false;return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;}

export function evaluateAvatarMood(){
  const l=logic(),now=Date.now(),active=(state.tasks||[]).filter(t=>!['completed','cancelled'].includes(t.status));
  const overdue=active.filter(t=>t.dueAt&&new Date(t.dueAt).getTime()<now);
  const highOverdue=overdue.filter(t=>['high','critical'].includes(String(t.priority||'').toLowerCase()));
  const dueSoon=active.filter(t=>{if(!t.dueAt)return false;const x=new Date(t.dueAt).getTime();return x>=now&&x<now+l.dueSoonHours*3600000;});
  const today=sgKey(new Date());const completedToday=(state.tasks||[]).filter(t=>t.status==='completed'&&t.completedAt&&sgKey(t.completedAt)===today);
  let mood='RELAXED',text='No urgent objectives detected.';
  if(overdue.length>=l.panicOverdue||highOverdue.length>=l.panicHighOverdue){mood='PANIC';text='Multiple overdue objectives require immediate action.';}
  else if(completedToday.length>=l.successCompletedToday){mood='SUCCESS';text='Completion threshold achieved. Momentum is positive.';}
  else if(dueSoon.length>=l.anxiousDueSoon||active.length>=l.anxiousActive){mood='ANXIOUS';text='Deadline pressure is rising.';}
  else if(active.length){mood='FOCUSED';text='Operational workload within normal range.';}
  return{mood,text,active:active.length,overdue:overdue.length,highOverdue:highOverdue.length,dueSoon:dueSoon.length,completedToday:completedToday.length};
}

function settleMood(next){
  const hold=Number(system().moodHoldSeconds)||0;
  if(!moodInitialized){stableMood=next;moodInitialized=true;return stableMood;}
  if(next===stableMood){pendingMood=null;clearTimeout(pendingMoodTimer);return stableMood;}
  if(hold<=0){stableMood=next;pendingMood=null;clearTimeout(pendingMoodTimer);return stableMood;}
  if(pendingMood!==next){pendingMood=next;clearTimeout(pendingMoodTimer);pendingMoodTimer=setTimeout(()=>{stableMood=next;pendingMood=null;refreshAvatarMood();},hold*1000);}
  return stableMood;
}
function effectiveMood(base){
  const s=system();
  if(s.offlineEnabled&&!navigator.onLine)return{state:'OFFLINE',reason:'NETWORK OFFLINE'};
  if(transient.state&&Date.now()<transient.until)return{state:transient.state,reason:transient.reason||'SYSTEM OVERRIDE'};
  return{state:settleMood(base.mood),reason:'TASK ENGINE'};
}
export function setAvatarTransientState(name,durationMs=8000,reason='SYSTEM OVERRIDE'){
  const next=String(name||'').toUpperCase();if(!STATES.includes(next))return false;
  if(next==='ANALYZING'&&!system().analyzingEnabled)return false;
  transient={state:next,until:durationMs>0?Date.now()+durationMs:Number.MAX_SAFE_INTEGER,reason};
  clearTimeout(transientTimer);if(durationMs>0)transientTimer=setTimeout(()=>clearAvatarTransientState(),durationMs+20);
  refreshAvatarMood();return true;
}
export function clearAvatarTransientState(){transient={state:null,until:0,reason:''};clearTimeout(transientTimer);refreshAvatarMood();}
export function beginAvatarAnalyzing(reason='AI ANALYSIS'){return setAvatarTransientState('ANALYZING',0,reason);}
export function endAvatarAnalyzing(){if(transient.state==='ANALYZING')clearAvatarTransientState();}

async function loadAssetUrl(asset){if(!asset)return null;if(urlCache.has(asset.id))return urlCache.get(asset.id);const blob=await apiBlob(`/api/v8/assets/${encodeURIComponent(asset.id)}`);const url=URL.createObjectURL(blob);urlCache.set(asset.id,url);return url;}
async function getDotLottie(){if(DotLottieClass)return DotLottieClass;if(dotLottiePromise)return dotLottiePromise;dotLottiePromise=import('https://cdn.jsdelivr.net/npm/@lottiefiles/dotlottie-web@0.80.0/+esm').then(m=>{DotLottieClass=m.DotLottie;return DotLottieClass;}).catch(e=>{console.warn('dotLottie unavailable',e);return null;});return dotLottiePromise;}
function clearStage(stage){for(const p of stage._players||[]){try{p.destroy?.();}catch{}}stage._players=[];stage.querySelectorAll('.avatar-effect-item').forEach(x=>x.remove());}
function defaultStateRecord(name){return{state:name,imageAssetId:null,effects:[],config:{fit:'contain',positionX:50,positionY:50,scale:1}};}
function normalizeConfig(c={}){return{fit:['cover','contain'].includes(c.fit)?c.fit:'contain',positionX:clamp(c.positionX??50,0,100),positionY:clamp(c.positionY??50,0,100),scale:clamp(c.scale??1,.5,2)};}
function normalizedEffect(e={}){return{assetId:String(e.assetId||''),enabled:e.enabled!==false,layer:e.layer==='back'?'back':'front',opacity:clamp(e.opacity??.85,0,1),scale:clamp(e.scale??1,.25,3),x:clamp(e.x??0,-100,100),y:clamp(e.y??0,-100,100),blendMode:e.blendMode||'screen',speed:clamp(e.speed??1,.25,3),loop:e.loop!==false,rotation:clamp(e.rotation??0,-180,180)};}
async function renderStage(stage,stateName,recordOverride=null){
  if(!stage)return;const token={};stage._renderToken=token;clearStage(stage);stage.dataset.state=stateName;stage.dataset.motion=motionAllowed()?'full':'reduced';stage.style.setProperty('--avatar-transition-ms',`${system().transitionMs}ms`);
  const rec=recordOverride||stateByName(stateName)||defaultStateRecord(stateName),cfg=normalizeConfig(rec.config),intensity=clamp(system().masterEffectIntensity,0,1.5);
  const img=stage.querySelector('.avatar-base-image'),fallback=stage.querySelector('.avatar-fallback');
  if(img){img.classList.add('hidden');img.removeAttribute('src');img.style.objectFit=cfg.fit;img.style.objectPosition=`${cfg.positionX}% ${cfg.positionY}%`;img.style.transform=`scale(${cfg.scale})`;}
  if(fallback){fallback.classList.remove('hidden');fallback.textContent=stateName==='ANALYZING'?'AI':stateName.slice(0,2);}
  if(rec.imageAssetId){const asset=assetById(rec.imageAssetId);if(asset){try{const url=await loadAssetUrl(asset);if(stage._renderToken!==token)return;if(img){img.src=url;img.classList.remove('hidden');fallback?.classList.add('hidden');}}catch(e){console.warn('Avatar image load failed',e);}}}
  const effects=(rec.effects||[]).map(normalizedEffect).filter(e=>e.enabled&&assetById(e.assetId));
  for(const effect of effects){
    if(stage._renderToken!==token)return;const asset=assetById(effect.assetId),container=stage.querySelector(effect.layer==='back'?'.avatar-effects-back':'.avatar-effects-front');if(!container)continue;
    const wrap=document.createElement('div');wrap.className='avatar-effect-item';wrap.style.opacity=String(clamp(effect.opacity*intensity,0,1));wrap.style.mixBlendMode=effect.blendMode;wrap.style.transform=`translate(calc(-50% + ${effect.x}%),calc(-50% + ${effect.y}%)) scale(${effect.scale}) rotate(${effect.rotation}deg)`;container.append(wrap);
    try{const url=await loadAssetUrl(asset);if(stage._renderToken!==token)return;const ex=ext(asset);if(ex==='lottie'||ex==='json'){const canvas=document.createElement('canvas');canvas.className='avatar-effect-canvas';wrap.append(canvas);const DotLottie=await getDotLottie();if(DotLottie&&stage._renderToken===token){const animate=motionAllowed();const player=new DotLottie({canvas,src:url,autoplay:animate,loop:effect.loop});player.setSpeed?.(effect.speed);stage._players.push(player);}else{wrap.textContent='FX';wrap.classList.add('effect-fallback');}}else{const fx=document.createElement('img');fx.className='avatar-effect-image';fx.alt='';fx.src=url;wrap.append(fx);}}
    catch(e){console.warn('Effect load failed',e);wrap.textContent='FX';wrap.classList.add('effect-fallback');}
  }
  const badge=stage.querySelector('.avatar-state-badge');if(badge)badge.textContent=stateName;
}

export function refreshAvatarMood(){const base=evaluateAvatarMood(),eff=effectiveMood(base);renderStage($('#nexusStage'),eff.state);return{...base,baseMood:base.mood,mood:eff.state,stateReason:eff.reason};}

async function refreshData(){const data=await api('/api/v8/avatar');state.avatar={states:data.states||[],assets:data.assets||[],logic:{...DEFAULT_LOGIC,...(data.logic||{})},system:{...DEFAULT_SYSTEM,...(data.system||{})}};}
function loadDraft(){draft=clone(stateByName(selectedState)||defaultStateRecord(selectedState));draft.config=normalizeConfig(draft.config);draft.effects=(draft.effects||[]).map(normalizedEffect);selectedEffectIndex=draft.effects.length?Math.min(Math.max(selectedEffectIndex,0),draft.effects.length-1):-1;syncControls();renderStage($('#avatarPreviewStage'),selectedState,draft);renderAssignedEffects();renderStateLibrary();}
function syncControls(){if(!draft)return;const c=draft.config||normalizeConfig();$('#avatarFit').value=c.fit;$('#avatarScale').value=c.scale;$('#avatarScaleValue').textContent=`${Math.round(c.scale*100)}%`;$('#avatarPositionX').value=c.positionX;$('#avatarPositionXValue').textContent=`${Math.round(c.positionX)}%`;$('#avatarPositionY').value=c.positionY;$('#avatarPositionYValue').textContent=`${Math.round(c.positionY)}%`;const e=draft.effects?.[selectedEffectIndex];$('#effectControls').classList.toggle('hidden',!e);if(e){$('#effectEnabled').checked=e.enabled!==false;$('#effectLoop').checked=e.loop!==false;$('#effectLayer').value=e.layer||'front';$('#effectBlend').value=e.blendMode||'screen';$('#effectOpacity').value=Math.round((e.opacity??.85)*100);$('#effectOpacityValue').textContent=`${Math.round((e.opacity??.85)*100)}%`;$('#effectScale').value=Math.round((e.scale??1)*100);$('#effectScaleValue').textContent=`${Math.round((e.scale??1)*100)}%`;$('#effectSpeed').value=Math.round((e.speed??1)*100);$('#effectSpeedValue').textContent=`${Math.round((e.speed??1)*100)}%`;$('#effectRotation').value=e.rotation??0;$('#effectRotationValue').textContent=`${Math.round(e.rotation??0)}°`;$('#effectX').value=e.x??0;$('#effectXValue').textContent=`${Math.round(e.x??0)}%`;$('#effectY').value=e.y??0;$('#effectYValue').textContent=`${Math.round(e.y??0)}%`;}}
function renderStateLibrary(){const root=$('#avatarStateList');root.replaceChildren();for(const name of STATES){const rec=stateByName(name),btn=document.createElement('button');btn.type='button';btn.className=`avatar-state-button ${name===selectedState?'active':''}`;btn.dataset.state=name;const asset=rec?.imageAssetId?assetById(rec.imageAssetId):null;btn.innerHTML=`<span>${name}</span><b>${asset?'IMAGE READY':'NO IMAGE'}</b><i>${rec?.effects?.length||0} FX</i>`;btn.onclick=()=>{selectedState=name;selectedEffectIndex=-1;loadDraft();};root.append(btn);}$('#selectedAvatarState').textContent=selectedState;const imageAsset=draft?.imageAssetId?assetById(draft.imageAssetId):null;$('#selectedAvatarImage').textContent=imageAsset?imageAsset.originalName:'NO IMAGE ASSIGNED';$('#avatarPreviewState').value=selectedState;}
function renderEffectLibrary(){const root=$('#effectLibrary');root.replaceChildren();const items=(state.avatar.assets||[]).filter(a=>a.kind==='avatar-effect');if(!items.length){const e=document.createElement('div');e.className='avatar-empty';e.textContent='NO EFFECT ASSETS // UPLOAD .LOTTIE, JSON, GIF, WEBP OR PNG';root.append(e);return;}for(const a of items){const row=document.createElement('div');row.className='effect-library-row';row.innerHTML=`<div><b>${a.originalName}</b><span>${String(ext(a)).toUpperCase()} // ${fmtBytes(a.sizeBytes)}</span></div>`;const add=document.createElement('button');add.type='button';add.className='ghost small';add.textContent='ASSIGN';add.onclick=()=>{draft.effects=draft.effects||[];if(draft.effects.length>=6){notify('MAX 6 EFFECTS PER STATE',true);return;}draft.effects.push(normalizedEffect({assetId:a.id}));selectedEffectIndex=draft.effects.length-1;syncControls();renderAssignedEffects();renderStage($('#avatarPreviewStage'),selectedState,draft);};const del=document.createElement('button');del.type='button';del.className='avatar-asset-delete';del.textContent='×';del.title='Delete asset';del.onclick=()=>deleteAsset(a);row.append(add,del);root.append(row);}}
function moveEffect(index,delta){const next=index+delta;if(index<0||next<0||next>=draft.effects.length)return;[draft.effects[index],draft.effects[next]]=[draft.effects[next],draft.effects[index]];selectedEffectIndex=next;renderAssignedEffects();syncControls();renderStage($('#avatarPreviewStage'),selectedState,draft);}
function duplicateEffect(index){if(draft.effects.length>=6){notify('MAX 6 EFFECTS PER STATE',true);return;}draft.effects.splice(index+1,0,clone(draft.effects[index]));selectedEffectIndex=index+1;renderAssignedEffects();syncControls();renderStage($('#avatarPreviewStage'),selectedState,draft);}
function renderAssignedEffects(){const root=$('#assignedEffects');root.replaceChildren();const effects=draft?.effects||[];if(!effects.length){const e=document.createElement('div');e.className='avatar-empty';e.textContent='NO EFFECTS ASSIGNED';root.append(e);return;}effects.forEach((fx,i)=>{const a=assetById(fx.assetId),row=document.createElement('div');row.className=`assigned-effect-row ${i===selectedEffectIndex?'active':''}`;const btn=document.createElement('button');btn.type='button';btn.className='assigned-effect';btn.innerHTML=`<span>${a?.originalName||'MISSING ASSET'}</span><b>${fx.layer?.toUpperCase()||'FRONT'} // ${Math.round((fx.opacity??.85)*100)}% // ${Math.round((fx.speed??1)*100)}%</b>`;btn.onclick=()=>{selectedEffectIndex=i;syncControls();renderAssignedEffects();};const tools=document.createElement('div');tools.className='effect-order-tools';[['↑',-1],['↓',1]].forEach(([label,d])=>{const b=document.createElement('button');b.type='button';b.className='hud-icon tiny';b.textContent=label;b.disabled=(d<0&&i===0)||(d>0&&i===effects.length-1);b.onclick=()=>moveEffect(i,d);tools.append(b);});const copy=document.createElement('button');copy.type='button';copy.className='hud-icon tiny';copy.textContent='⧉';copy.title='Duplicate assignment';copy.onclick=()=>duplicateEffect(i);tools.append(copy);row.append(btn,tools);root.append(row);});}
function renderLogic(){const l=logic();for(const [id,key] of [['logicDueSoonHours','dueSoonHours'],['logicAnxiousActive','anxiousActive'],['logicAnxiousDueSoon','anxiousDueSoon'],['logicPanicOverdue','panicOverdue'],['logicPanicHighOverdue','panicHighOverdue'],['logicSuccessCompleted','successCompletedToday']])$('#'+id).value=l[key];const r=evaluateAvatarMood();$('#avatarLogicPreview').textContent=`CURRENT // ${r.mood} // ${r.active} ACTIVE // ${r.dueSoon} DUE SOON // ${r.overdue} OVERDUE // ${r.completedToday} COMPLETED TODAY`;}
function renderSystem(){const s=system();$('#systemOfflineEnabled').checked=s.offlineEnabled;$('#systemAnalyzingEnabled').checked=s.analyzingEnabled;$('#systemFxIntensity').value=Math.round(s.masterEffectIntensity*100);$('#systemFxIntensityValue').textContent=`${Math.round(s.masterEffectIntensity*100)}%`;$('#systemMotionMode').value=s.motionMode;$('#systemMoodHold').value=s.moodHoldSeconds;$('#systemMoodHoldValue').textContent=`${Number(s.moodHoldSeconds).toFixed(1)}s`;$('#systemTransitionMs').value=s.transitionMs;$('#systemTransitionValue').textContent=`${Math.round(s.transitionMs)} ms`;renderSystemStatus();}
function renderSystemStatus(){const base=evaluateAvatarMood(),eff=effectiveMood(base),el=$('#avatarSystemStatus');if(el)el.textContent=`LIVE // ${eff.state} // BASE ${base.mood} // ${navigator.onLine?'ONLINE':'OFFLINE'} // ${eff.reason}`;}
function renderCustomize(){loadDraft();renderEffectLibrary();renderLogic();renderSystem();}

async function saveDraft(){try{const out=await api(`/api/v8/avatar/states/${encodeURIComponent(selectedState)}`,{method:'PUT',body:{imageAssetId:draft.imageAssetId||null,effects:draft.effects||[],config:draft.config||{}}});const i=state.avatar.states.findIndex(x=>x.state===selectedState);if(i>=0)state.avatar.states[i]=out.state;else state.avatar.states.push(out.state);notify(`${selectedState} STATE SAVED`);loadDraft();refreshAvatarMood();}catch(e){notify(e.message,true);}}
async function upload(kind,file){const fd=new FormData();fd.append('kind',kind);fd.append('file',file);const out=await apiForm('/api/v8/avatar/assets',fd);state.avatar.assets.unshift(out.asset);return out.asset;}
async function deleteAsset(asset){if(!confirm(`Delete ${asset.originalName}? It will be removed from all avatar states.`))return;try{await api(`/api/v8/assets/${encodeURIComponent(asset.id)}`,{method:'DELETE'});if(urlCache.has(asset.id)){URL.revokeObjectURL(urlCache.get(asset.id));urlCache.delete(asset.id);}await refreshData();notify('ASSET DELETED');renderCustomize();refreshAvatarMood();}catch(e){notify(e.message,true);}}
function bindRange(id,key,display,transform=v=>v){const el=$(id);el.oninput=()=>{draft.config[key]=transform(el.value);$(display).textContent=key==='scale'?`${Math.round(draft.config[key]*100)}%`:`${Math.round(draft.config[key])}%`;renderStage($('#avatarPreviewStage'),selectedState,draft);};}
function updateSelectedEffect(){const e=draft.effects?.[selectedEffectIndex];if(!e)return;e.enabled=$('#effectEnabled').checked;e.loop=$('#effectLoop').checked;e.layer=$('#effectLayer').value;e.blendMode=$('#effectBlend').value;e.opacity=Number($('#effectOpacity').value)/100;e.scale=Number($('#effectScale').value)/100;e.speed=Number($('#effectSpeed').value)/100;e.rotation=Number($('#effectRotation').value);e.x=Number($('#effectX').value);e.y=Number($('#effectY').value);$('#effectOpacityValue').textContent=`${Math.round(e.opacity*100)}%`;$('#effectScaleValue').textContent=`${Math.round(e.scale*100)}%`;$('#effectSpeedValue').textContent=`${Math.round(e.speed*100)}%`;$('#effectRotationValue').textContent=`${Math.round(e.rotation)}°`;$('#effectXValue').textContent=`${Math.round(e.x)}%`;$('#effectYValue').textContent=`${Math.round(e.y)}%`;renderAssignedEffects();renderStage($('#avatarPreviewStage'),selectedState,draft);}
function applyFxProfile(name){const preset=FX_PROFILES[name];if(!preset||!draft.effects.length)return;draft.effects=draft.effects.map(f=>({...f,...preset}));syncControls();renderAssignedEffects();renderStage($('#avatarPreviewStage'),selectedState,draft);notify(`${name} FX PROFILE APPLIED // SAVE TO KEEP`);}

function bindUi(){
  $('#uploadAvatarImageBtn').onclick=()=>$('#avatarImageInput').click();$('#avatarImageInput').onchange=async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;const btn=$('#uploadAvatarImageBtn'),old=btn.textContent;btn.disabled=true;btn.textContent='UPLOADING…';try{const asset=await upload('avatar-image',file);draft.imageAssetId=asset.id;await saveDraft();}catch(err){notify(err.message,true);}finally{btn.disabled=false;btn.textContent=old;}};
  $('#uploadEffectBtn').onclick=()=>$('#avatarEffectInput').click();$('#avatarEffectInput').onchange=async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;const btn=$('#uploadEffectBtn'),old=btn.textContent;btn.disabled=true;btn.textContent='UPLOADING…';try{await upload('avatar-effect',file);renderEffectLibrary();notify('EFFECT ASSET UPLOADED');}catch(err){notify(err.message,true);}finally{btn.disabled=false;btn.textContent=old;}};
  $('#saveAvatarStateBtn').onclick=saveDraft;$('#resetAvatarStateBtn').onclick=async()=>{if(!confirm(`Reset ${selectedState}? This removes its image and effect assignments but keeps uploaded files.`))return;try{await api(`/api/v8/avatar/states/${encodeURIComponent(selectedState)}`,{method:'DELETE'});await refreshData();notify(`${selectedState} RESET`);renderCustomize();refreshAvatarMood();}catch(e){notify(e.message,true);}};
  $('#removeAvatarImageBtn').onclick=()=>{draft.imageAssetId=null;renderStateLibrary();renderStage($('#avatarPreviewStage'),selectedState,draft);};
  $('#avatarFit').onchange=()=>{draft.config.fit=$('#avatarFit').value;renderStage($('#avatarPreviewStage'),selectedState,draft);};bindRange('#avatarScale','scale','#avatarScaleValue',v=>Number(v));bindRange('#avatarPositionX','positionX','#avatarPositionXValue',v=>Number(v));bindRange('#avatarPositionY','positionY','#avatarPositionYValue',v=>Number(v));
  ['#effectEnabled','#effectLoop','#effectLayer','#effectBlend','#effectOpacity','#effectScale','#effectSpeed','#effectRotation','#effectX','#effectY'].forEach(id=>$(id).addEventListener(['#effectEnabled','#effectLoop','#effectLayer','#effectBlend'].includes(id)?'change':'input',updateSelectedEffect));
  $('#removeEffectAssignmentBtn').onclick=()=>{if(selectedEffectIndex<0)return;draft.effects.splice(selectedEffectIndex,1);selectedEffectIndex=Math.min(selectedEffectIndex,draft.effects.length-1);syncControls();renderAssignedEffects();renderStage($('#avatarPreviewStage'),selectedState,draft);};
  document.querySelectorAll('[data-fx-profile]').forEach(b=>b.onclick=()=>applyFxProfile(b.dataset.fxProfile));
  $('#avatarLogicForm').onsubmit=async e=>{e.preventDefault();const body={dueSoonHours:Number($('#logicDueSoonHours').value),anxiousActive:Number($('#logicAnxiousActive').value),anxiousDueSoon:Number($('#logicAnxiousDueSoon').value),panicOverdue:Number($('#logicPanicOverdue').value),panicHighOverdue:Number($('#logicPanicHighOverdue').value),successCompletedToday:Number($('#logicSuccessCompleted').value)};try{const out=await api('/api/v8/avatar/logic',{method:'PATCH',body});state.avatar.logic=out.logic;notify('AVATAR LOGIC SAVED');renderLogic();refreshAvatarMood();}catch(err){notify(err.message,true);}};
  $('#avatarSystemForm').onsubmit=async e=>{e.preventDefault();const body={offlineEnabled:$('#systemOfflineEnabled').checked,analyzingEnabled:$('#systemAnalyzingEnabled').checked,masterEffectIntensity:Number($('#systemFxIntensity').value)/100,motionMode:$('#systemMotionMode').value,moodHoldSeconds:Number($('#systemMoodHold').value),transitionMs:Number($('#systemTransitionMs').value)};try{const out=await api('/api/v8/avatar/system',{method:'PATCH',body});state.avatar.system=out.system;notify('NEXUS SYSTEM SETTINGS SAVED');renderSystem();renderStage($('#avatarPreviewStage'),selectedState,draft);refreshAvatarMood();}catch(err){notify(err.message,true);}};
  $('#systemFxIntensity').oninput=()=>$('#systemFxIntensityValue').textContent=`${$('#systemFxIntensity').value}%`;$('#systemMoodHold').oninput=()=>$('#systemMoodHoldValue').textContent=`${Number($('#systemMoodHold').value).toFixed(1)}s`;$('#systemTransitionMs').oninput=()=>$('#systemTransitionValue').textContent=`${$('#systemTransitionMs').value} ms`;
  $('#avatarPreviewState').onchange=()=>{selectedState=$('#avatarPreviewState').value;selectedEffectIndex=-1;loadDraft();};
  $('#testAvatarStateBtn').onclick=()=>{const s=$('#avatarSystemTestState').value;setAvatarTransientState(s,8000,'CUSTOMIZE TEST');notify(`${s} LIVE TEST // 8 SECONDS`);renderSystemStatus();};
  $('#clearAvatarStateTestBtn').onclick=()=>{clearAvatarTransientState();notify('LIVE STATE TEST CLEARED');renderSystemStatus();};
  window.addEventListener('online',()=>{refreshAvatarMood();renderSystemStatus();});window.addEventListener('offline',()=>{refreshAvatarMood();renderSystemStatus();});
}

export async function initAvatar(onNotify){notify=onNotify||notify;bindUi();try{await refreshData();moodInitialized=false;renderCustomize();refreshAvatarMood();}catch(e){notify(e.message,true);}}
export async function refreshAvatar(){try{await refreshData();renderCustomize();refreshAvatarMood();}catch(e){notify(e.message,true);}}
