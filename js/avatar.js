import { api,apiBlob,apiForm } from './api.js';
import { state } from './state.js';

const $=s=>document.querySelector(s);
const STATES=['RELAXED','FOCUSED','ANXIOUS','PANIC','SUCCESS','OFFLINE','ANALYZING'];
const DEFAULT_LOGIC={dueSoonHours:24,anxiousActive:6,anxiousDueSoon:2,panicOverdue:4,panicHighOverdue:2,successCompletedToday:3};
let notify=()=>{},selectedState='RELAXED',selectedEffectIndex=-1,draft=null;
const urlCache=new Map();let DotLottieClass=null,dotLottiePromise=null;

function clone(v){return JSON.parse(JSON.stringify(v));}
function assetById(id){return state.avatar?.assets?.find(a=>a.id===id)||null;}
function stateByName(name){return state.avatar?.states?.find(s=>s.state===name)||null;}
function ext(asset){return String(asset?.metadata?.extension||asset?.originalName?.split('.').pop()||'').toLowerCase();}
function fmtBytes(n){n=Number(n)||0;if(n<1024)return `${n} B`;if(n<1024*1024)return `${(n/1024).toFixed(1)} KB`;return `${(n/1024/1024).toFixed(1)} MB`;}
function clamp(n,a,b){n=Number(n);return Number.isFinite(n)?Math.min(b,Math.max(a,n)):a;}
function sgKey(dateLike){const d=new Date(dateLike);if(Number.isNaN(d.getTime()))return '';return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
function logic(){return {...DEFAULT_LOGIC,...(state.avatar?.logic||{})};}

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

async function loadAssetUrl(asset){
  if(!asset)return null;if(urlCache.has(asset.id))return urlCache.get(asset.id);
  const blob=await apiBlob(`/api/v8/assets/${encodeURIComponent(asset.id)}`);const url=URL.createObjectURL(blob);urlCache.set(asset.id,url);return url;
}
async function getDotLottie(){
  if(DotLottieClass)return DotLottieClass;if(dotLottiePromise)return dotLottiePromise;
  dotLottiePromise=import('https://cdn.jsdelivr.net/npm/@lottiefiles/dotlottie-web@0.80.0/+esm').then(m=>{DotLottieClass=m.DotLottie;return DotLottieClass;}).catch(e=>{console.warn('dotLottie unavailable',e);return null;});return dotLottiePromise;
}
function clearStage(stage){
  for(const p of stage._players||[]){try{p.destroy?.();}catch{}}stage._players=[];
  stage.querySelectorAll('.avatar-effect-item').forEach(x=>x.remove());
}
function defaultStateRecord(name){return{state:name,imageAssetId:null,effects:[],config:{fit:'contain',positionX:50,positionY:50,scale:1}};}
function normalizeConfig(c={}){return{fit:['cover','contain'].includes(c.fit)?c.fit:'contain',positionX:clamp(c.positionX??50,0,100),positionY:clamp(c.positionY??50,0,100),scale:clamp(c.scale??1,.5,2)};}
async function renderStage(stage,stateName,recordOverride=null){
  if(!stage)return;const token={};stage._renderToken=token;clearStage(stage);stage.dataset.state=stateName;
  const rec=recordOverride||stateByName(stateName)||defaultStateRecord(stateName),cfg=normalizeConfig(rec.config);
  const img=stage.querySelector('.avatar-base-image'),fallback=stage.querySelector('.avatar-fallback');
  if(img){img.classList.add('hidden');img.removeAttribute('src');img.style.objectFit=cfg.fit;img.style.objectPosition=`${cfg.positionX}% ${cfg.positionY}%`;img.style.transform=`scale(${cfg.scale})`;}
  if(fallback){fallback.classList.remove('hidden');fallback.textContent=stateName==='ANALYZING'?'AI':stateName.slice(0,2);}
  if(rec.imageAssetId){const asset=assetById(rec.imageAssetId);if(asset){try{const url=await loadAssetUrl(asset);if(stage._renderToken!==token)return;if(img){img.src=url;img.classList.remove('hidden');fallback?.classList.add('hidden');}}catch(e){console.warn('Avatar image load failed',e);}}}
  const effects=(rec.effects||[]).filter(e=>e.enabled!==false&&assetById(e.assetId));
  for(const effect of effects){if(stage._renderToken!==token)return;const asset=assetById(effect.assetId),container=stage.querySelector(effect.layer==='back'?'.avatar-effects-back':'.avatar-effects-front');if(!container)continue;const wrap=document.createElement('div');wrap.className='avatar-effect-item';wrap.style.opacity=String(clamp(effect.opacity??.85,0,1));wrap.style.mixBlendMode=effect.blendMode||'screen';wrap.style.transform=`translate(calc(-50% + ${clamp(effect.x??0,-100,100)}%),calc(-50% + ${clamp(effect.y??0,-100,100)}%)) scale(${clamp(effect.scale??1,.25,3)})`;container.append(wrap);
    try{const url=await loadAssetUrl(asset);if(stage._renderToken!==token)return;const ex=ext(asset);if(ex==='lottie'||ex==='json'){const canvas=document.createElement('canvas');canvas.className='avatar-effect-canvas';wrap.append(canvas);const DotLottie=await getDotLottie();if(DotLottie&&stage._renderToken===token){const player=new DotLottie({canvas,src:url,autoplay:true,loop:true});stage._players.push(player);}else{wrap.textContent='FX';wrap.classList.add('effect-fallback');}}else{const fx=document.createElement('img');fx.className='avatar-effect-image';fx.alt='';fx.src=url;wrap.append(fx);}}
    catch(e){console.warn('Effect load failed',e);wrap.textContent='FX';wrap.classList.add('effect-fallback');}
  }
  const badge=stage.querySelector('.avatar-state-badge');if(badge)badge.textContent=stateName;
}

export function refreshAvatarMood(){const result=evaluateAvatarMood();renderStage($('#nexusStage'),result.mood);return result;}

async function refreshData(){const data=await api('/api/v8/avatar');state.avatar={states:data.states||[],assets:data.assets||[],logic:{...DEFAULT_LOGIC,...(data.logic||{})}};}
function loadDraft(){draft=clone(stateByName(selectedState)||defaultStateRecord(selectedState));draft.config=normalizeConfig(draft.config);selectedEffectIndex=draft.effects?.length?0:-1;syncControls();renderStage($('#avatarPreviewStage'),selectedState,draft);renderAssignedEffects();renderStateLibrary();}
function syncControls(){if(!draft)return;const c=draft.config||normalizeConfig();$('#avatarFit').value=c.fit;$('#avatarScale').value=c.scale;$('#avatarScaleValue').textContent=`${Math.round(c.scale*100)}%`;$('#avatarPositionX').value=c.positionX;$('#avatarPositionXValue').textContent=`${Math.round(c.positionX)}%`;$('#avatarPositionY').value=c.positionY;$('#avatarPositionYValue').textContent=`${Math.round(c.positionY)}%`;const e=draft.effects?.[selectedEffectIndex];$('#effectControls').classList.toggle('hidden',!e);if(e){$('#effectEnabled').checked=e.enabled!==false;$('#effectLayer').value=e.layer||'front';$('#effectBlend').value=e.blendMode||'screen';$('#effectOpacity').value=Math.round((e.opacity??.85)*100);$('#effectOpacityValue').textContent=`${Math.round((e.opacity??.85)*100)}%`;$('#effectScale').value=Math.round((e.scale??1)*100);$('#effectScaleValue').textContent=`${Math.round((e.scale??1)*100)}%`;$('#effectX').value=e.x??0;$('#effectXValue').textContent=`${Math.round(e.x??0)}%`;$('#effectY').value=e.y??0;$('#effectYValue').textContent=`${Math.round(e.y??0)}%`;}}
function renderStateLibrary(){const root=$('#avatarStateList');root.replaceChildren();for(const name of STATES){const rec=stateByName(name),btn=document.createElement('button');btn.type='button';btn.className=`avatar-state-button ${name===selectedState?'active':''}`;btn.dataset.state=name;const asset=rec?.imageAssetId?assetById(rec.imageAssetId):null;btn.innerHTML=`<span>${name}</span><b>${asset?'IMAGE READY':'NO IMAGE'}</b><i>${rec?.effects?.length||0} FX</i>`;btn.onclick=()=>{selectedState=name;loadDraft();};root.append(btn);}$('#selectedAvatarState').textContent=selectedState;const imageAsset=draft?.imageAssetId?assetById(draft.imageAssetId):null;$('#selectedAvatarImage').textContent=imageAsset?imageAsset.originalName:'NO IMAGE ASSIGNED';}
function renderEffectLibrary(){const root=$('#effectLibrary');root.replaceChildren();const items=(state.avatar.assets||[]).filter(a=>a.kind==='avatar-effect');if(!items.length){const e=document.createElement('div');e.className='avatar-empty';e.textContent='NO EFFECT ASSETS // UPLOAD .LOTTIE, JSON, GIF, WEBP OR PNG';root.append(e);return;}for(const a of items){const row=document.createElement('div');row.className='effect-library-row';row.innerHTML=`<div><b>${a.originalName}</b><span>${String(ext(a)).toUpperCase()} // ${fmtBytes(a.sizeBytes)}</span></div>`;const add=document.createElement('button');add.type='button';add.className='ghost small';add.textContent='ASSIGN';add.onclick=()=>{draft.effects=draft.effects||[];if(draft.effects.length>=6){notify('MAX 6 EFFECTS PER STATE',true);return;}draft.effects.push({assetId:a.id,enabled:true,layer:'front',opacity:.85,scale:1,x:0,y:0,blendMode:'screen'});selectedEffectIndex=draft.effects.length-1;syncControls();renderAssignedEffects();renderStage($('#avatarPreviewStage'),selectedState,draft);};const del=document.createElement('button');del.type='button';del.className='avatar-asset-delete';del.textContent='×';del.title='Delete asset';del.onclick=()=>deleteAsset(a);row.append(add,del);root.append(row);}}
function renderAssignedEffects(){const root=$('#assignedEffects');root.replaceChildren();const effects=draft?.effects||[];if(!effects.length){const e=document.createElement('div');e.className='avatar-empty';e.textContent='NO EFFECTS ASSIGNED';root.append(e);return;}effects.forEach((fx,i)=>{const a=assetById(fx.assetId),btn=document.createElement('button');btn.type='button';btn.className=`assigned-effect ${i===selectedEffectIndex?'active':''}`;btn.innerHTML=`<span>${a?.originalName||'MISSING ASSET'}</span><b>${fx.layer?.toUpperCase()||'FRONT'} // ${Math.round((fx.opacity??.85)*100)}%</b>`;btn.onclick=()=>{selectedEffectIndex=i;syncControls();renderAssignedEffects();};root.append(btn);});}
function renderLogic(){const l=logic();for(const [id,key] of [['logicDueSoonHours','dueSoonHours'],['logicAnxiousActive','anxiousActive'],['logicAnxiousDueSoon','anxiousDueSoon'],['logicPanicOverdue','panicOverdue'],['logicPanicHighOverdue','panicHighOverdue'],['logicSuccessCompleted','successCompletedToday']])$('#'+id).value=l[key];const r=evaluateAvatarMood();$('#avatarLogicPreview').textContent=`CURRENT // ${r.mood} // ${r.active} ACTIVE // ${r.dueSoon} DUE SOON // ${r.overdue} OVERDUE // ${r.completedToday} COMPLETED TODAY`;}
function renderCustomize(){loadDraft();renderEffectLibrary();renderLogic();}

async function saveDraft(){try{const out=await api(`/api/v8/avatar/states/${encodeURIComponent(selectedState)}`,{method:'PUT',body:{imageAssetId:draft.imageAssetId||null,effects:draft.effects||[],config:draft.config||{}}});const i=state.avatar.states.findIndex(x=>x.state===selectedState);if(i>=0)state.avatar.states[i]=out.state;else state.avatar.states.push(out.state);notify(`${selectedState} STATE SAVED`);loadDraft();refreshAvatarMood();}catch(e){notify(e.message,true);}}
async function upload(kind,file){const fd=new FormData();fd.append('kind',kind);fd.append('file',file);const out=await apiForm('/api/v8/avatar/assets',fd);state.avatar.assets.unshift(out.asset);return out.asset;}
async function deleteAsset(asset){if(!confirm(`Delete ${asset.originalName}? It will be removed from all avatar states.`))return;try{await api(`/api/v8/assets/${encodeURIComponent(asset.id)}`,{method:'DELETE'});if(urlCache.has(asset.id)){URL.revokeObjectURL(urlCache.get(asset.id));urlCache.delete(asset.id);}await refreshData();notify('ASSET DELETED');renderCustomize();refreshAvatarMood();}catch(e){notify(e.message,true);}}

function bindRange(id,key,display,transform=v=>v){const el=$(id);el.oninput=()=>{draft.config[key]=transform(el.value);$(display).textContent=key==='scale'?`${Math.round(draft.config[key]*100)}%`:`${Math.round(draft.config[key])}%`;renderStage($('#avatarPreviewStage'),selectedState,draft);};}
function updateSelectedEffect(){const e=draft.effects?.[selectedEffectIndex];if(!e)return;e.enabled=$('#effectEnabled').checked;e.layer=$('#effectLayer').value;e.blendMode=$('#effectBlend').value;e.opacity=Number($('#effectOpacity').value)/100;e.scale=Number($('#effectScale').value)/100;e.x=Number($('#effectX').value);e.y=Number($('#effectY').value);$('#effectOpacityValue').textContent=`${Math.round(e.opacity*100)}%`;$('#effectScaleValue').textContent=`${Math.round(e.scale*100)}%`;$('#effectXValue').textContent=`${Math.round(e.x)}%`;$('#effectYValue').textContent=`${Math.round(e.y)}%`;renderAssignedEffects();renderStage($('#avatarPreviewStage'),selectedState,draft);}

function bindUi(){
  $('#uploadAvatarImageBtn').onclick=()=>$('#avatarImageInput').click();$('#avatarImageInput').onchange=async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;const btn=$('#uploadAvatarImageBtn'),old=btn.textContent;btn.disabled=true;btn.textContent='UPLOADING…';try{const asset=await upload('avatar-image',file);draft.imageAssetId=asset.id;await saveDraft();}catch(err){notify(err.message,true);}finally{btn.disabled=false;btn.textContent=old;}};
  $('#uploadEffectBtn').onclick=()=>$('#avatarEffectInput').click();$('#avatarEffectInput').onchange=async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;const btn=$('#uploadEffectBtn'),old=btn.textContent;btn.disabled=true;btn.textContent='UPLOADING…';try{await upload('avatar-effect',file);renderEffectLibrary();notify('EFFECT ASSET UPLOADED');}catch(err){notify(err.message,true);}finally{btn.disabled=false;btn.textContent=old;}};
  $('#saveAvatarStateBtn').onclick=saveDraft;$('#resetAvatarStateBtn').onclick=async()=>{if(!confirm(`Reset ${selectedState}? This removes its image and effect assignments but keeps uploaded files.`))return;try{await api(`/api/v8/avatar/states/${encodeURIComponent(selectedState)}`,{method:'DELETE'});await refreshData();notify(`${selectedState} RESET`);renderCustomize();refreshAvatarMood();}catch(e){notify(e.message,true);}};
  $('#removeAvatarImageBtn').onclick=()=>{draft.imageAssetId=null;renderStateLibrary();renderStage($('#avatarPreviewStage'),selectedState,draft);};
  $('#avatarFit').onchange=()=>{draft.config.fit=$('#avatarFit').value;renderStage($('#avatarPreviewStage'),selectedState,draft);};bindRange('#avatarScale','scale','#avatarScaleValue',v=>Number(v));bindRange('#avatarPositionX','positionX','#avatarPositionXValue',v=>Number(v));bindRange('#avatarPositionY','positionY','#avatarPositionYValue',v=>Number(v));
  ['#effectEnabled','#effectLayer','#effectBlend','#effectOpacity','#effectScale','#effectX','#effectY'].forEach(id=>$(id).addEventListener(id==='#effectEnabled'||id==='#effectLayer'||id==='#effectBlend'?'change':'input',updateSelectedEffect));
  $('#removeEffectAssignmentBtn').onclick=()=>{if(selectedEffectIndex<0)return;draft.effects.splice(selectedEffectIndex,1);selectedEffectIndex=Math.min(selectedEffectIndex,draft.effects.length-1);syncControls();renderAssignedEffects();renderStage($('#avatarPreviewStage'),selectedState,draft);};
  $('#avatarLogicForm').onsubmit=async e=>{e.preventDefault();const body={dueSoonHours:Number($('#logicDueSoonHours').value),anxiousActive:Number($('#logicAnxiousActive').value),anxiousDueSoon:Number($('#logicAnxiousDueSoon').value),panicOverdue:Number($('#logicPanicOverdue').value),panicHighOverdue:Number($('#logicPanicHighOverdue').value),successCompletedToday:Number($('#logicSuccessCompleted').value)};try{const out=await api('/api/v8/avatar/logic',{method:'PATCH',body});state.avatar.logic=out.logic;notify('AVATAR LOGIC SAVED');renderLogic();refreshAvatarMood();}catch(err){notify(err.message,true);}};
  $('#avatarPreviewState').onchange=()=>{selectedState=$('#avatarPreviewState').value;loadDraft();};
}

export async function initAvatar(onNotify){notify=onNotify||notify;bindUi();try{await refreshData();renderCustomize();refreshAvatarMood();}catch(e){notify(e.message,true);}}
export async function refreshAvatar(){try{await refreshData();renderCustomize();refreshAvatarMood();}catch(e){notify(e.message,true);}}
