import { api } from './api.js';
import { state } from './state.js';

const $=s=>document.querySelector(s);
const ALERT_KEY='neon_ops_reminder_browser_alerts';
let toast=()=>{},pollTimer=null,refreshTimer=null,pollBusy=false;
const pad=n=>String(n).padStart(2,'0');
function localInput(value){const d=value?new Date(value):new Date(Date.now()+30*60000);return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;}
function browserSupported(){return typeof Notification!=='undefined';}
function browserEnabled(){return browserSupported()&&Notification.permission==='granted'&&localStorage.getItem(ALERT_KEY)!=='0';}
function rel(iso){const ms=new Date(iso).getTime()-Date.now(),abs=Math.abs(ms),past=ms<0;if(abs<60000)return past?'DUE NOW':'<1M';const m=Math.round(abs/60000);if(m<60)return `${past?'T+':'T-'}${m}M`;const h=Math.round(m/60);if(h<48)return `${past?'T+':'T-'}${h}H`;const d=Math.round(h/24);return `${past?'T+':'T-'}${d}D`;}
function stamp(iso){return new Date(iso).toLocaleString('en-SG',{timeZone:'Asia/Singapore',weekday:'short',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false});}
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}

export function initReminders(t){
  toast=t;
  $('#newReminderBtn').onclick=openReminder;
  $('#reminderRefreshBtn').onclick=()=>refreshReminders(true);
  $('#reminderEnableAlerts').onclick=requestAlerts;
  $('#reminderForm').addEventListener('submit',saveReminder);
  if(!pollTimer)pollTimer=setInterval(pollDue,30000);
  if(!refreshTimer)refreshTimer=setInterval(()=>{if($('#pageOps')?.classList.contains('active'))refreshReminders(false);},60000);
  updatePermissionUi();return refreshReminders(false).then(()=>pollDue());
}
export async function refreshReminders(showToast=false){
  if(!state.user)return;const from=new Date(Date.now()-86400000).toISOString(),to=new Date(Date.now()+30*86400000).toISOString();
  try{const d=await api(`/api/v8/reminders?limit=80&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);state.reminders=d.items||[];state.reminderSummary=d.summary||{};renderReminders();if(showToast)toast('REMINDERS REFRESHED');}catch(e){if(showToast)toast(e.message,true);}
}
function renderReminders(){
  const root=$('#reminderCenterList');if(!root)return;const items=[...(state.reminders||[])].filter(x=>['scheduled','snoozed'].includes(x.status)).sort((a,b)=>new Date(a.scheduledAt)-new Date(b.scheduledAt));
  $('#reminderCenterCount').textContent=`${items.length} ACTIVE`;$('#reminderDueSoon').textContent=`${Number(state.reminderSummary?.dueSoon24h||0)} / 24H`;updatePermissionUi();root.replaceChildren();
  if(!items.length){root.innerHTML='<div class="reminder-empty">NO ACTIVE REMINDERS // NEXUS CAN CREATE ONE</div>';return;}
  for(const r of items.slice(0,8)){
    const row=document.createElement('article');row.className=`reminder-center-item ${r.virtual?'virtual':''}`;
    const actions=r.virtual?`<span class="reminder-google-chip">GOOGLE</span><button type="button" data-rem-delete="${escapeHtml(r.id)}">DELETE</button>`:`<button type="button" data-rem-snooze="${escapeHtml(r.id)}">+10M</button><button type="button" data-rem-dismiss="${escapeHtml(r.id)}">DISMISS</button><button type="button" data-rem-delete="${escapeHtml(r.id)}">DELETE</button>`;
    row.innerHTML=`<div class="reminder-timing"><b>${escapeHtml(r.timingUnknown?'DEFAULT':rel(r.scheduledAt))}</b><span>${escapeHtml(stamp(r.scheduledAt))}</span></div><div class="reminder-copy"><strong>${escapeHtml(r.title)}</strong><span>${escapeHtml(r.sourceLabel||'REMINDER')}${r.status==='snoozed'?' // SNOOZED':''}${r.googleSync?' // GOOGLE':''}</span></div><div class="reminder-actions">${actions}</div>`;
    root.append(row);
  }
  root.querySelectorAll('[data-rem-snooze]').forEach(b=>b.onclick=()=>snooze(b.dataset.remSnooze,10));root.querySelectorAll('[data-rem-dismiss]').forEach(b=>b.onclick=()=>dismiss(b.dataset.remDismiss));root.querySelectorAll('[data-rem-delete]').forEach(b=>b.onclick=()=>removeReminder(b.dataset.remDelete));
}
function openReminder(){
  $('#reminderTitleInput').value='';$('#reminderTimeInput').value=localInput();$('#reminderNotesInput').value='';$('#reminderChannelInput').value='both';$('#reminderDialog').showModal();setTimeout(()=>$('#reminderTitleInput').focus(),50);
}
async function saveReminder(e){e.preventDefault();const title=$('#reminderTitleInput').value.trim(),when=$('#reminderTimeInput').value;if(!title||!when)return toast('Reminder title and time are required',true);try{await api('/api/v8/reminders',{method:'POST',body:{title,remindAt:new Date(when).toISOString(),notes:$('#reminderNotesInput').value.trim(),channel:$('#reminderChannelInput').value}});$('#reminderDialog').close();await refreshReminders(false);toast('REMINDER ARMED');}catch(err){toast(err.message,true);}}
async function snooze(id,minutes){try{await api(`/api/v8/reminders/${encodeURIComponent(id)}/snooze`,{method:'POST',body:{minutes}});await refreshReminders(false);toast(`REMINDER SNOOZED // ${minutes}M`);}catch(e){toast(e.message,true);}}
async function dismiss(id){try{await api(`/api/v8/reminders/${encodeURIComponent(id)}/dismiss`,{method:'POST'});await refreshReminders(false);toast('REMINDER DISMISSED');}catch(e){toast(e.message,true);}}
function reminderById(id){return(state.reminders||[]).find(x=>String(x.id)===String(id))||null;}
function eventById(id){return(state.events||[]).find(x=>String(x.id)===String(id))||null;}
function parseReminderConfig(raw){if(!raw)return null;try{const x=typeof raw==='string'?JSON.parse(raw):raw;return x&&typeof x==='object'?x:null;}catch{return null;}}
async function clearGoogleEventReminder(r){
  const ev=eventById(r.sourceId);if(!r.sourceId)return;let next={useDefault:false,overrides:[]};const cfg=parseReminderConfig(ev?.reminder);
  if(cfg&&!cfg.useDefault&&Array.isArray(cfg.overrides)&&Number.isFinite(Number(r.offsetMinutes))){const target=Number(r.offsetMinutes);next={useDefault:false,overrides:cfg.overrides.filter(x=>Number(x?.minutes)!==target).slice(0,5)};}
  await api(`/api/v8/events/${encodeURIComponent(r.sourceId)}`,{method:'PATCH',body:{reminder:JSON.stringify(next)}});
}
function taskReminderCompanion(r){const marker=`NEON_TASK_ID=${r.sourceId}`,legacy=`TASK REMINDER // ${r.title}`;return(state.events||[]).find(e=>String(e.category||'').toUpperCase()==='TASK REMINDER'&&(String(e.notes||'').includes(marker)||String(e.title||'')===legacy))||null;}
async function removeReminder(id){
  const r=reminderById(id);if(!r)return toast('Reminder no longer exists.',true);if(!confirm(`Delete reminder “${r.title}”?${r.googleSync?' Its linked Google reminder will also be removed where applicable.':''}`))return;
  try{
    if(r.sourceType==='event'&&r.googleSync)await clearGoogleEventReminder(r);
    if(r.sourceType==='task'&&r.googleSync){const companion=taskReminderCompanion(r);if(companion)await api(`/api/v8/events/${encodeURIComponent(companion.id)}`,{method:'DELETE'});}
    if(!r.virtual)await api(`/api/v8/reminders/${encodeURIComponent(r.id)}`,{method:'DELETE'});
    await refreshReminders(false);toast(r.googleSync?'REMINDER DELETED // GOOGLE SYNC UPDATED':'REMINDER DELETED');
  }catch(e){toast(e.message,true);}
}
async function requestAlerts(){
  if(!browserSupported()){toast('This browser does not expose Notification API alerts. In-app reminders remain active.',true);return;}
  try{const p=await Notification.requestPermission();if(p==='granted'){localStorage.setItem(ALERT_KEY,'1');toast('BROWSER ALERTS ENABLED');}else{localStorage.setItem(ALERT_KEY,'0');toast(`Browser alerts ${p}`,true);}updatePermissionUi();}catch(e){toast(e.message,true);}
}
function updatePermissionUi(){const b=$('#reminderEnableAlerts'),s=$('#reminderAlertState');if(!b||!s)return;if(!browserSupported()){b.textContent='IN-APP ONLY';b.disabled=true;s.textContent='NOTIFICATION API UNAVAILABLE';return;}const p=Notification.permission,on=browserEnabled();b.disabled=p==='denied';b.textContent=on?'ALERTS ON':p==='denied'?'ALERTS BLOCKED':'ENABLE ALERTS';s.textContent=on?'BROWSER + IN-APP':p==='denied'?'IN-APP FALLBACK':'IN-APP ACTIVE';s.dataset.state=on?'success':p==='denied'?'danger':'warning';}
async function pollDue(){
  if(pollBusy||!state.user)return;pollBusy=true;try{const d=await api('/api/v8/reminders/due?lookbackMinutes=180');for(const r of d.items||[])await surfaceReminder(r);}catch{}finally{pollBusy=false;}
}
async function surfaceReminder(r){
  const text=`${r.title} // ${stamp(r.scheduledAt)}`;toast(`REMINDER // ${text}`);
  if(browserEnabled())try{const n=new Notification('NEON OPS // REMINDER',{body:r.title,tag:`neon-reminder-${r.id}`,renotify:false});n.onclick=()=>window.focus();}catch{}
  try{await api(`/api/v8/reminders/${encodeURIComponent(r.id)}/trigger`,{method:'POST'});}catch{}
  await refreshReminders(false);
}
