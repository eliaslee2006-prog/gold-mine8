import { api, apiForm } from './api.js';
import { state } from './state.js';
import { beginAvatarAnalyzing, endAvatarAnalyzing, setAvatarTransientState, clearAvatarTransientState } from './avatar.js';

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
let notify=()=>{};
let hooks={navigate:()=>{},refreshDomains:async()=>{}};
let busy=false;
let recorder=null,recordStream=null,recordChunks=[],recordTimer=null;let messageStickToBottom=true;
let voiceHoldActive=false,voicePointerId=null,voiceStarting=false;

function ensureState(){
  state.nexus=state.nexus||{threads:[],messages:[],currentThreadId:null,settings:{thinkingMode:'auto',voiceReply:false,voiceWriteConfirm:true,maxContextMessages:12,freeTierGuard:true,startingCreditUsd:5,creditBaselineAt:null},models:{chat:'gemini-3.8-flash',fast:'gemini-3.5-flash-lite',transcribe:'gemini-3.5-transcribe',transcribeFallback:'gemini-3.5-flash-lite'},usage:null,configured:false};
  return state.nexus;
}
function escText(v){return v==null?'':String(v);}
function fmtTime(v){if(!v)return'—';try{return new Date(v).toLocaleString('en-SG',{timeZone:'Asia/Singapore',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});}catch{return String(v);}}
function currentPage(){return document.querySelector('.page.active')?.id||'pageOps';}
function setStatus(text,mode='ready'){
  const el=$('#nexusStatus');if(el){el.textContent=text;el.dataset.state=mode;}
}
function setBusy(v,label='ANALYZING'){
  busy=!!v;
  for(const el of ['#nexusSendBtn','#nexusNewThread','#nexusClearThread','#nexusWipeHistory'])if($(el))$(el).disabled=busy;
  if(busy){setStatus(label,'busy');beginAvatarAnalyzing(`NEXUS ${label}`);}else{setStatus('READY','ready');endAvatarAnalyzing();}
}
function nearBottom(root){return !root||root.scrollHeight-root.scrollTop-root.clientHeight<90;}
function scrollMessages(force=false){const root=$('#nexusMessages');if(root&&(force||messageStickToBottom))requestAnimationFrame(()=>{root.scrollTop=root.scrollHeight;});}
function isoToSgInput(v){
  if(!v)return'';try{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(v));const get=t=>parts.find(x=>x.type===t)?.value||'';return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;}catch{return'';}
}
function sgInputToIso(v){if(!v)return null;const d=new Date(`${v}:00+08:00`);return Number.isFinite(d.getTime())?d.toISOString():null;}
function speak(text){
  const nx=ensureState();if(!nx.settings?.voiceReply||!('speechSynthesis'in window)||!text)return;
  try{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(String(text).slice(0,1800));u.lang='en-SG';u.rate=1;u.pitch=1;speechSynthesis.speak(u);}catch{}
}
function button(label,cls,fn){const b=document.createElement('button');b.type='button';b.className=cls||'ghost small';b.textContent=label;b.onclick=fn;return b;}
function renderThreads(){
  const nx=ensureState(),root=$('#nexusThreadList');if(!root)return;root.replaceChildren();
  if(!nx.threads.length){const e=document.createElement('div');e.className='nxc-empty';e.textContent='NO SAVED THREADS';root.append(e);return;}
  for(const t of nx.threads){
    const row=document.createElement('div');row.className='nxc-thread'+(t.id===nx.currentThreadId?' active':'');
    const open=document.createElement('button');open.type='button';open.className='nxc-thread-open';
    const title=document.createElement('b');title.textContent=t.title||'Conversation';const stamp=document.createElement('small');stamp.textContent=fmtTime(t.updatedAt);open.append(title,stamp);open.onclick=()=>selectThread(t.id);
    const del=button('×','nxc-thread-delete',()=>deleteThread(t.id,t.title));del.setAttribute('aria-label','Delete conversation');row.append(open,del);root.append(row);
  }
}
function actionCard(action,context='message'){
  const wrap=document.createElement('div');wrap.className=`nxc-action-card risk-${action.riskLevel||1}`;wrap.dataset.status=action.status||'unknown';
  const head=document.createElement('div');head.className='nxc-action-head';const left=document.createElement('span');left.textContent=`L${action.riskLevel||1} // ${String(action.tool||'ACTION').replaceAll('_',' ').toUpperCase()}`;const st=document.createElement('b');st.textContent=String(action.status||'').toUpperCase();head.append(left,st);
  const desc=document.createElement('p');desc.textContent=action.summary||action.tool||'Proposed action';wrap.append(head,desc);
  const editable=action.status==='pending'&&['task_create','calendar_create'].includes(action.tool);
  if(editable){
    const args=action.args||{},review=document.createElement('div');review.className='nxc-action-review';
    const grid=document.createElement('div');grid.className='review-grid';
    const typeLabel=document.createElement('label');typeLabel.textContent='LOG AS';const type=document.createElement('select');type.dataset.review='kind';type.innerHTML='<option value="event">EVENT</option><option value="task">TASK</option>';type.value=action.tool==='task_create'?'task':'event';typeLabel.append(type);
    const titleLabel=document.createElement('label');titleLabel.textContent='TITLE';const title=document.createElement('input');title.dataset.review='title';title.value=args.title||'';title.maxLength=240;titleLabel.append(title);
    const timeLabel=document.createElement('label');timeLabel.textContent='DATE / TIME (SGT)';const time=document.createElement('input');time.type='datetime-local';time.dataset.review='time';time.value=isoToSgInput(args.dueAt||args.startAt);timeLabel.append(time);
    const minsLabel=document.createElement('label');minsLabel.textContent='REMINDER MINUTES';const mins=document.createElement('input');mins.type='number';mins.min='0';mins.max='40320';mins.step='1';mins.dataset.review='minutes';mins.value=String(args.reminderMinutes??10);minsLabel.append(mins);
    const check=document.createElement('label');check.className='review-check';const cb=document.createElement('input');cb.type='checkbox';cb.dataset.review='google';cb.checked=!!args.googleReminderEnabled;check.append(cb,document.createTextNode(' GOOGLE-SYNCED REMINDER'));
    const note=document.createElement('div');note.className='review-note';note.dataset.review='note';
    const updateNote=()=>{mins.disabled=!cb.checked;note.textContent=type.value==='task'?'TASKS sync to Google Tasks. If reminder is enabled, NEXUS creates a 5-minute companion Google Calendar reminder at the task due time.':'EVENTS sync to Google Calendar with the selected popup reminder.';};
    type.onchange=updateNote;cb.onchange=updateNote;updateNote();grid.append(typeLabel,titleLabel,timeLabel,minsLabel,check,note);review.append(grid);wrap.append(review);
  }
  const controls=document.createElement('div');controls.className='nxc-action-controls';
  if(action.status==='pending'){
    controls.append(button(editable?'REVIEW + CONFIRM':'CONFIRM','primary small',()=>editable?confirmReviewed(action,wrap):actionOp(action.id,'confirm')),button('CANCEL','ghost small',()=>actionOp(action.id,'cancel')));
  }else if(action.undoAvailable){controls.append(button('UNDO','ghost small',()=>actionOp(action.id,'undo')));}
  if(controls.childElementCount)wrap.append(controls);
  if(context==='queue')wrap.classList.add('queue-card');return wrap;
}
async function confirmReviewed(action,wrap){
  if(busy)return;const kind=wrap.querySelector('[data-review="kind"]')?.value||'event',title=wrap.querySelector('[data-review="title"]')?.value?.trim()||'',local=wrap.querySelector('[data-review="time"]')?.value||'',googleReminderEnabled=!!wrap.querySelector('[data-review="google"]')?.checked,reminderMinutes=Number(wrap.querySelector('[data-review="minutes"]')?.value||0),scheduledAt=sgInputToIso(local);
  if(!title)return notify('VOICE REVIEW NEEDS A TITLE',true);if(kind==='event'&&!scheduledAt)return notify('EVENT REVIEW NEEDS A DATE AND TIME',true);if(googleReminderEnabled&&!scheduledAt)return notify('A GOOGLE REMINDER NEEDS A DATE AND TIME',true);
  setBusy(true,'REVIEWING');try{await api(`/api/v8/nexus/actions/${encodeURIComponent(action.id)}`,{method:'PATCH',body:{kind,title,scheduledAt,googleReminderEnabled,reminderMinutes}});setBusy(false);await actionOp(action.id,'confirm');}catch(e){notify(e.message,true);setBusy(false);}
}
function renderMessage(m){
  const box=document.createElement('article');box.className=`nxc-message ${m.role==='user'?'user':'assistant'}`;
  const top=document.createElement('div');top.className='nxc-message-meta';const who=document.createElement('b');who.textContent=m.role==='user'?'YOU':'NEXUS';const time=document.createElement('span');time.textContent=fmtTime(m.createdAt);top.append(who,time);box.append(top);
  const body=document.createElement('div');body.className='nxc-message-body';body.textContent=escText(m.content);box.append(body);
  const meta=m.metadata||{};
  if(m.role!=='user'&&(meta.model||meta.thinkingLevel||meta.confidence!==undefined)){
    const telemetry=document.createElement('div');telemetry.className='nxc-message-telemetry';
    if(meta.model){const x=document.createElement('span');x.textContent=String(meta.model).toUpperCase();telemetry.append(x);}if(meta.thinkingLevel){const x=document.createElement('span');x.textContent=`THINK // ${String(meta.thinkingLevel).toUpperCase()}`;telemetry.append(x);}if(meta.confidence!==undefined){const x=document.createElement('span');x.textContent=`CONF // ${Math.round(Number(meta.confidence)||0)}%`;telemetry.append(x);}box.append(telemetry);
  }
  if(Array.isArray(meta.evidence)&&meta.evidence.length){const ev=document.createElement('details');ev.className='nxc-evidence';const s=document.createElement('summary');s.textContent=`EVIDENCE // ${meta.evidence.length}`;const list=document.createElement('ul');for(const x of meta.evidence){const li=document.createElement('li');li.textContent=x;list.append(li);}ev.append(s,list);box.append(ev);}
  const actions=[...(meta.pendingActions||[]),...(meta.executedActions||[])];if(actions.length){const ar=document.createElement('div');ar.className='nxc-message-actions';for(const a of actions)ar.append(actionCard(a));box.append(ar);}
  return box;
}
function renderMessages(){
  const nx=ensureState(),root=$('#nexusMessages');if(!root)return;const stick=messageStickToBottom||nearBottom(root);root.replaceChildren();
  if(!nx.messages.length){const w=document.createElement('div');w.className='nxc-welcome';w.innerHTML='<span class="kicker">OPEN CHANNEL</span><h3>Ask, analyse or command.</h3><p>NEXUS can interrogate dashboard data and execute supported actions through the server command gate. Voice writes appear as editable Event / Task review cards before confirmation.</p>';root.append(w);}
  else for(const m of nx.messages)root.append(renderMessage(m));
  renderPending();messageStickToBottom=stick;scrollMessages();
}
function pendingActions(){
  const seen=new Map();for(const m of ensureState().messages){for(const a of [...(m.metadata?.pendingActions||[]),...(m.metadata?.executedActions||[])])seen.set(a.id,a);}return[...seen.values()].filter(a=>a.status==='pending'||a.undoAvailable).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
}
function renderPending(){
  const root=$('#nexusPendingList');if(!root)return;root.replaceChildren();const rows=pendingActions();
  if(!rows.length){const e=document.createElement('div');e.className='nxc-empty';e.textContent='NO PENDING CONFIRMATIONS';root.append(e);return;}
  if(rows.filter(x=>x.status==='pending').length>1){const all=button('CONFIRM ALL PENDING','primary small',confirmAll);all.classList.add('nxc-confirm-all');root.append(all);}
  for(const a of rows)root.append(actionCard(a,'queue'));
}
function renderRuntime(){
  const nx=ensureState(),u=nx.usage?.today||{},c=nx.usage?.cost||{},m=nx.usage?.month||{},d7=nx.usage?.sevenDays||{};const set=(id,v)=>{const e=$(id);if(e)e.textContent=v;},money=v=>`$${Number(v||0).toFixed(Number(v||0)<.1?4:2)}`;
  set('#nexusUsageRequests',Number(u.requests||0).toLocaleString());set('#nexusUsageInput',Number(u.inputTokens||0).toLocaleString());set('#nexusUsageOutput',Number(u.outputTokens||0).toLocaleString());set('#nexusUsageThinking',Number(u.thoughtTokens||0).toLocaleString());set('#nexusUsageFailures',Number((u.failures||0)+(u.empty||0)).toLocaleString());
  set('#nexusCostToday',money(u.costUsd));set('#nexusCost7d',money(d7.costUsd));set('#nexusCostMonth',money(m.costUsd));set('#nexusCreditRemaining',money(c.estimatedRemainingUsd));
  const credit=$('#nexusCreditState');if(credit){const w=String(c.warning||'NORMAL').toLowerCase();credit.dataset.state=w;credit.textContent=`CREDIT // ${String(c.warning||'NORMAL').toUpperCase()}`;}const base=$('#nexusCreditBaseline');if(base)base.textContent=c.creditBaselineAt?`BASELINE // ${fmtTime(c.creditBaselineAt)}`:'BASELINE // ALL TRACKED USAGE';
  const recent=nx.usage?.recent||[];set('#nexusUsageModel',String(recent[0]?.model||nx.models?.chat||'—').toUpperCase());set('#nexusVoiceModel',String(nx.models?.transcribe||'—').toUpperCase());
  if($('#nexusThinkingMode'))$('#nexusThinkingMode').value=nx.settings?.thinkingMode||'auto';if($('#nexusContextMessages'))$('#nexusContextMessages').value=nx.settings?.maxContextMessages||12;if($('#nexusStartingCredit'))$('#nexusStartingCredit').value=Number(nx.settings?.startingCreditUsd??5).toFixed(2);if($('#nexusVoiceReply'))$('#nexusVoiceReply').checked=!!nx.settings?.voiceReply;if($('#nexusVoiceConfirm'))$('#nexusVoiceConfirm').checked=nx.settings?.voiceWriteConfirm!==false;if($('#nexusFreeGuard'))$('#nexusFreeGuard').checked=nx.settings?.freeTierGuard!==false;
}
function renderContext(){const nx=ensureState(),t=nx.threads.find(x=>x.id===nx.currentThreadId);if($('#nexusContextThread'))$('#nexusContextThread').textContent=t?String(t.title||'THREAD').toUpperCase():'NO THREAD';if($('#nexusContextPage'))$('#nexusContextPage').textContent=`CONTEXT // ${currentPage().replace(/^page/,'').toUpperCase()}`;}

async function loadSettings(){const nx=ensureState();const d=await api('/api/v8/nexus/settings');nx.settings={...nx.settings,...(d.settings||{})};nx.models={...nx.models,...(d.models||{})};nx.configured=!!d.configured;renderRuntime();}
async function loadUsage(){try{ensureState().usage=await api('/api/v8/nexus/usage');renderRuntime();}catch(e){console.warn('NEXUS usage unavailable',e);}}
async function loadThreads(select=true){const nx=ensureState(),d=await api('/api/v8/nexus/threads?limit=40');nx.threads=d.threads||[];if(select&&!nx.currentThreadId&&nx.threads[0])nx.currentThreadId=nx.threads[0].id;if(nx.currentThreadId&&!nx.threads.some(x=>x.id===nx.currentThreadId))nx.currentThreadId=nx.threads[0]?.id||null;renderThreads();renderContext();if(select&&nx.currentThreadId)await loadMessages(nx.currentThreadId);else{nx.messages=[];renderMessages();}}
async function loadMessages(threadId){const nx=ensureState();if(!threadId){nx.messages=[];renderMessages();return;}const d=await api(`/api/v8/nexus/threads/${encodeURIComponent(threadId)}/messages?limit=180`);nx.messages=d.messages||[];renderMessages();}
async function selectThread(id){if(busy)return;ensureState().currentThreadId=id;renderThreads();renderContext();setStatus('LOADING','busy');try{await loadMessages(id);}catch(e){notify(e.message,true);}finally{setStatus('READY','ready');}}
async function newThread(){if(busy)return;try{const d=await api('/api/v8/nexus/threads',{method:'POST',body:{title:'New conversation'}});ensureState().currentThreadId=d.thread.id;ensureState().messages=[];await loadThreads(false);renderMessages();$('#nexusInput')?.focus();}catch(e){notify(e.message,true);}}
async function deleteThread(id,title){if(!confirm(`Delete NEXUS thread “${title||'Conversation'}”? This removes its messages and action history.`))return;try{await api(`/api/v8/nexus/threads/${encodeURIComponent(id)}`,{method:'DELETE'});const nx=ensureState();if(nx.currentThreadId===id)nx.currentThreadId=null;await loadThreads(true);notify('NEXUS THREAD DELETED');}catch(e){notify(e.message,true);}}

async function clearCurrentThread(){
  const nx=ensureState();if(!nx.currentThreadId)return notify('NO ACTIVE NEXUS THREAD',true);if(!confirm('Clear every message and action in the current NEXUS thread? Gemini usage/cost history will be preserved.'))return;
  try{await api(`/api/v8/nexus/threads/${encodeURIComponent(nx.currentThreadId)}/messages`,{method:'DELETE'});nx.messages=[];renderMessages();await loadThreads(false);notify('CURRENT NEXUS THREAD CLEARED');}catch(e){notify(e.message,true);}
}
async function wipeHistory(){
  if(!confirm('WIPE ALL NEXUS CHAT HISTORY? This deletes every NEXUS thread, message and action. Calendar, Tasks, Finance, Fitness and Gemini usage telemetry are preserved.'))return;
  if(!confirm('Final confirmation: permanently wipe all NEXUS chat history?'))return;
  try{const d=await api('/api/v8/nexus/threads',{method:'DELETE'});const nx=ensureState();nx.threads=[];nx.messages=[];nx.currentThreadId=null;renderThreads();renderMessages();renderContext();notify(`NEXUS HISTORY WIPED // ${d.wiped?.messages||0} MESSAGES`);}catch(e){notify(e.message,true);}
}

async function refreshAfter(domains){if(Array.isArray(domains)&&domains.length)await hooks.refreshDomains([...new Set(domains)]);}
async function submitMessage(raw,source='text',{fromPalette=false}={}){
  const text=String(raw||'').trim();if(!text||busy)return null;const nx=ensureState();setBusy(true,source==='voice'?'VOICE COMMAND':'ANALYZING');
  try{
    const d=await api('/api/v8/nexus/chat',{method:'POST',body:{threadId:nx.currentThreadId||null,message:text,source,currentPage:currentPage()}});nx.currentThreadId=d.thread?.id||nx.currentThreadId;
    await loadThreads(false);await loadMessages(nx.currentThreadId);await refreshAfter(d.changedDomains);await loadUsage();renderContext();
    if(d.navigation&&d.navigation!=='NONE')hooks.navigate(d.navigation);const response=d.assistant?.content||'';speak(response);
    if(fromPalette&&(!d.navigation||d.navigation==='NONE')){const intent=d.assistant?.metadata?.intent||'';const commandOnly=intent==='COMMAND'&&(d.pendingActions?.length||d.executedActions?.length);if(!commandOnly)hooks.navigate('NEXUS');}
    return d;
  }catch(e){notify(e.message,true);return null;}finally{setBusy(false);}
}
async function actionOp(id,op){if(busy)return;setBusy(true,op==='confirm'?'EXECUTING':op==='undo'?'UNDOING':'CANCELLING');try{const d=await api(`/api/v8/nexus/actions/${encodeURIComponent(id)}/${op}`,{method:'POST',body:{}});if(ensureState().currentThreadId)await loadMessages(ensureState().currentThreadId);await refreshAfter(d.changedDomains);await loadUsage();notify(op==='confirm'?'NEXUS ACTION CONFIRMED':op==='undo'?'NEXUS ACTION UNDONE':'NEXUS ACTION CANCELLED');}catch(e){notify(e.message,true);}finally{setBusy(false);}}
async function confirmAll(){const ids=pendingActions().filter(x=>x.status==='pending').map(x=>x.id);if(!ids.length)return;if(!confirm(`Confirm ${ids.length} pending NEXUS actions? They will execute sequentially.`))return;for(const id of ids){await actionOp(id,'confirm');if(busy)break;}}

function bestRecorderMime(){const choices=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus'];return choices.find(x=>window.MediaRecorder?.isTypeSupported?.(x))||'';}
function micIcon(){return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 1 0-7 0v6a3.5 3.5 0 0 0 3.5 3.5Zm-1-9.5a1 1 0 1 1 2 0v6a1 1 0 1 1-2 0V6Zm-5 5a1 1 0 0 1 1 1 5 5 0 0 0 10 0 1 1 0 1 1 2 0 7.01 7.01 0 0 1-6 6.92V21h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.08A7.01 7.01 0 0 1 5 12a1 1 0 0 1 1-1Z" fill="currentColor"/></svg>';}
async function startVoiceHold(){
  if(voiceStarting||recorder?.state==='recording'||busy)return;if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){notify('VOICE INPUT IS NOT SUPPORTED BY THIS BROWSER',true);return;}
  voiceHoldActive=true;voiceStarting=true;setVoiceUi(true,'arming');
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}});
    if(!voiceHoldActive){stream.getTracks().forEach(t=>t.stop());setVoiceUi(false);return;}
    recordStream=stream;recordChunks=[];const mime=bestRecorderMime(),recorderOptions={audioBitsPerSecond:48000,...(mime?{mimeType:mime}:{})};recorder=new MediaRecorder(recordStream,recorderOptions);
    recorder.ondataavailable=e=>{if(e.data?.size)recordChunks.push(e.data);};recorder.onerror=()=>stopVoiceUi();recorder.onstop=finishVoice;recorder.start();setVoiceUi(true,'recording');recordTimer=setTimeout(()=>stopVoiceHold(),25000);
  }catch(e){voiceHoldActive=false;stopVoiceUi();notify(e?.name==='NotAllowedError'?'MICROPHONE PERMISSION WAS DENIED':'MICROPHONE COULD NOT START',true);}
  finally{voiceStarting=false;}
}
function stopVoiceHold(){voiceHoldActive=false;clearTimeout(recordTimer);recordTimer=null;if(recorder?.state==='recording'){recorder.stop();return;}if(!voiceStarting)setVoiceUi(false);}
function setVoiceUi(active,phase='recording'){const e=$('#nexusVoiceBtn');if(e){e.classList.toggle('recording',active);e.classList.toggle('arming',active&&phase==='arming');e.innerHTML=micIcon();e.setAttribute('aria-label',active?(phase==='arming'?'Preparing microphone':'Release to send voice command'):'Hold to talk');e.title=active?'RELEASE TO SEND':'HOLD TO TALK';}setStatus(active?(phase==='arming'?'MIC READY':'LISTENING'):'READY',active?'listening':'ready');if(active)setAvatarTransientState('FOCUSED',0,'NEXUS LISTENING');else if(!busy)clearAvatarTransientState();}
function stopVoiceUi(){voiceHoldActive=false;voiceStarting=false;clearTimeout(recordTimer);recordTimer=null;setVoiceUi(false);try{recordStream?.getTracks().forEach(t=>t.stop());}catch{}recordStream=null;recorder=null;}
function bindHoldToTalk(){
  const mic=$('#nexusVoiceBtn');if(!mic)return;mic.classList.add('nxc-mic');mic.innerHTML=micIcon();mic.setAttribute('aria-label','Hold to talk');mic.title='HOLD TO TALK';
  mic.addEventListener('pointerdown',e=>{if(e.button!==undefined&&e.button!==0)return;e.preventDefault();voicePointerId=e.pointerId;try{mic.setPointerCapture(e.pointerId);}catch{}startVoiceHold();});
  const release=e=>{if(voicePointerId!==null&&e.pointerId!==undefined&&e.pointerId!==voicePointerId)return;e.preventDefault();voicePointerId=null;stopVoiceHold();};
  mic.addEventListener('pointerup',release);mic.addEventListener('pointercancel',release);mic.addEventListener('lostpointercapture',()=>{voicePointerId=null;stopVoiceHold();});
  mic.addEventListener('contextmenu',e=>e.preventDefault());
  mic.addEventListener('keydown',e=>{if((e.key===' '||e.key==='Enter')&&!e.repeat){e.preventDefault();startVoiceHold();}});
  mic.addEventListener('keyup',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();stopVoiceHold();}});
}
async function finishVoice(){
  clearTimeout(recordTimer);recordTimer=null;const chunks=recordChunks.slice(),mime=recorder?.mimeType||chunks[0]?.type||'audio/webm';try{recordStream?.getTracks().forEach(t=>t.stop());}catch{}recordStream=null;recorder=null;setVoiceUi(false);if(!chunks.length){notify('NO VOICE AUDIO CAPTURED',true);return;}
  setBusy(true,'TRANSCRIBING');try{const blob=new Blob(chunks,{type:mime});const form=new FormData();const ext=mime.includes('mp4')?'m4a':mime.includes('ogg')?'ogg':'webm';form.append('audio',blob,`nexus-command.${ext}`);const d=await apiForm('/api/v8/nexus/transcribe',form);const transcript=String(d.transcript||'').trim();if(!transcript)throw new Error('No speech was detected.');if($('#nexusInput'))$('#nexusInput').value=transcript;if(Number.isFinite(Number(d.latencyMs)))notify(`VOICE TRANSCRIBED // ${(Number(d.latencyMs)/1000).toFixed(1)}S`);setBusy(false);messageStickToBottom=true;await submitMessage(transcript,'voice');}catch(e){notify(e.message,true);setBusy(false);}}

async function saveSettings(e){e?.preventDefault();const body={settings:{thinkingMode:$('#nexusThinkingMode')?.value||'auto',maxContextMessages:Number($('#nexusContextMessages')?.value)||12,startingCreditUsd:Number($('#nexusStartingCredit')?.value)||0,voiceReply:!!$('#nexusVoiceReply')?.checked,voiceWriteConfirm:!!$('#nexusVoiceConfirm')?.checked,freeTierGuard:!!$('#nexusFreeGuard')?.checked}};try{const d=await api('/api/v8/nexus/settings',{method:'PATCH',body});ensureState().settings=d.settings||body.settings;await loadUsage();renderRuntime();notify('NEXUS SETTINGS SAVED');}catch(err){notify(err.message,true);}}

async function resetCreditBaseline(){
  if(!confirm('Set the Gemini credit baseline to now? Estimated remaining credit will subtract only usage recorded after this moment.'))return;
  try{const nx=ensureState(),settings={...nx.settings,creditBaselineAt:new Date().toISOString()};const d=await api('/api/v8/nexus/settings',{method:'PATCH',body:{settings}});nx.settings={...nx.settings,...(d.settings||settings)};await loadUsage();renderRuntime();notify('GEMINI CREDIT BASELINE SET');}catch(e){notify(e.message,true);}
}
function openPrivacy(){const d=$('#aiDialog');if(d&&!d.open)d.showModal();const details=d?.querySelector('.ai-privacy');if(details)details.open=true;}
function openPalette(){const p=$('#nexusCommandPalette');if(!p)return;p.classList.remove('hidden');setTimeout(()=>$('#nexusCommandInput')?.focus(),0);}
function closePalette(){const p=$('#nexusCommandPalette');if(p)p.classList.add('hidden');}
function bind(){
  $('#nexusComposer')?.addEventListener('submit',e=>{e.preventDefault();const input=$('#nexusInput'),v=input?.value||'';if(input)input.value='';messageStickToBottom=true;submitMessage(v,'text');});
  $('#nexusInput')?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('#nexusComposer')?.requestSubmit();}});
  $('#nexusMessages')?.addEventListener('scroll',e=>{messageStickToBottom=nearBottom(e.currentTarget);},{passive:true});
  $('#nexusNewThread')?.addEventListener('click',newThread);bindHoldToTalk();$('#nexusClearThread')?.addEventListener('click',clearCurrentThread);$('#nexusWipeHistory')?.addEventListener('click',wipeHistory);$('#nexusResetCreditBaseline')?.addEventListener('click',resetCreditBaseline);
  $('#aiAskNexusBtn')?.addEventListener('click',()=>hooks.navigate('NEXUS'));
  $$('#nexusSuggestions [data-nexus-prompt]').forEach(b=>b.onclick=()=>{const input=$('#nexusInput');if(input){input.value=b.dataset.nexusPrompt||'';input.focus();}});
  $('#nexusSettingsForm')?.addEventListener('submit',saveSettings);$('#nexusPrivacyBtn')?.addEventListener('click',openPrivacy);
  $('#nexusCommandForm')?.addEventListener('submit',e=>{e.preventDefault();const i=$('#nexusCommandInput'),v=i?.value||'';if(i)i.value='';closePalette();submitMessage(v,'text',{fromPalette:true});});
  $('#nexusCommandPalette')?.addEventListener('click',e=>{if(e.target===e.currentTarget)closePalette();});
  window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.shiftKey&&String(e.key).toLowerCase()==='k'){e.preventDefault();openPalette();return;}if(e.key==='Escape'&&!$('#nexusCommandPalette')?.classList.contains('hidden'))closePalette();});
}

export async function initNexus(toast,callbacks={}){notify=toast||notify;hooks={...hooks,...callbacks};ensureState();bind();try{await Promise.all([loadSettings(),loadUsage()]);await loadThreads(true);renderContext();}catch(e){notify(e.message,true);}}
export async function refreshNexus(){if(!state.user)return;try{await Promise.all([loadUsage(),loadThreads(false)]);if(ensureState().currentThreadId)await loadMessages(ensureState().currentThreadId);renderContext();}catch(e){console.warn('NEXUS refresh failed',e);}}
export function updateNexusContext(){renderContext();}
