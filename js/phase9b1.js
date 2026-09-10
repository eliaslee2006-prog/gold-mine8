import { api } from './api.js';
import { state } from './state.js';
import { initPhase9B1Nav } from './phase9b1-nav.js';
import { initPhase9B1Mailbox } from './phase9b1-mailbox.js';
import { initPhase9B1Tasks,followupSnapshot } from './phase9b1-tasks.js';
import { initPhase9B1Finance,financeContextSnapshot } from './phase9b1-finance.js';
import { initPhase9B1Signals,signalContextSnapshot } from './phase9b1-signals.js';

const $=s=>document.querySelector(s);
let mailRefresh=null,materializeTimer=null,sourcePollTimer=null,wrapped=false;
function toast(msg,error=false){const el=$('#toast');if(!el){console[error?'error':'log'](msg);return;}el.textContent=(error?'ERROR // ':'')+msg;el.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>el.classList.remove('show'),3200);}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function waitForCore(){for(let i=0;i<120;i++){if($('#bootCover')==null&&state?.user&&$('#pageFinance')&&$('#taskForm'))return true;await sleep(100);}return !!state?.user;}
function p91Context(){return{
  generatedAt:new Date().toISOString(),
  taskFollowups:followupSnapshot?.()||{},
  finance:financeContextSnapshot?.()||{},
  signals:signalContextSnapshot?.()||{},
  mailbox:{route:'pageMail'}
};}
function installNexusContextBridge(){if(wrapped)return;wrapped=true;const nativeFetch=window.fetch.bind(window);window.fetch=async(input,init={})=>{try{const url=typeof input==='string'?input:input?.url||'';if(/\/api\/v8\/nexus\/chat(?:\?|$)/.test(url)&&String(init?.method||'GET').toUpperCase()==='POST'&&init.body){let body=typeof init.body==='string'?JSON.parse(init.body):null;if(body&&typeof body==='object'&&!body.phase9b1Context){body.phase9b1Context=p91Context();init={...init,body:JSON.stringify(body)};}}}catch(e){console.warn('P91 context bridge skipped',e);}return nativeFetch(input,init);};}
function aiMailPayload(report){const rid=String(report?.id||report?.createdAt||report?.generatedAt||'');if(!rid)return null;const headline=report?.headline||report?.title||`${report?.scope||'AI'} Intelligence Report`,summary=report?.summary||report?.executiveSummary||'A new intelligence report is available.';return{uniqueKey:`ai-report:${rid}`,type:'REPORT',priority:String(report?.severity||'MEDIUM').toUpperCase()==='CRITICAL'?'CRITICAL':'MEDIUM',title:String(headline).slice(0,300),body:String(summary).slice(0,3000),sourceModule:'NEXUS',sourceRecordId:rid,actionRoute:'NEXUS',actionPayload:{reportId:rid}};}
function reminderMailPayload(r){if(!r||!['scheduled','snoozed'].includes(String(r.status||'').toLowerCase()))return null;const text=`${r.title||''} ${r.notes||r.description||r.body||''}`;if(!/(check\s*-?\s*in|follow\s*-?\s*up|progress\s*(check|update))/i.test(text))return null;const when=r.scheduledAt||r.remindAt||r.createdAt||'';return{uniqueKey:`reminder-checkin:${r.id}:${when}`,type:'REMINDER',priority:'MEDIUM',title:r.title||'Reminder check-in',body:r.notes||r.description||r.body||'This reminder requires a check-in.',sourceModule:'REMINDERS',sourceRecordId:String(r.id||''),actionRoute:'REMINDER',actionPayload:{reminderId:r.id}};}
async function postMail(m){if(!m)return;try{await api('/api/v8/phase9b1/mail',{method:'POST',body:m});}catch(e){if(e.status!==409)console.warn('P91 mail materializer',e.message);}}
async function pollSources(){if(!state?.user||document.visibilityState==='hidden')return;try{await api('/api/v8/phase9b1/sources/refresh',{method:'POST'});window.dispatchEvent(new CustomEvent('neon:phase9b1-signals-refresh'));window.dispatchEvent(new CustomEvent('neon:phase9b1-mail-refresh'));}catch(e){console.warn('P91 background source refresh',e.message);}}
async function materializeClientMail(){if(!state?.user)return;const reports=[...(state.ai?.reports||[])].sort((a,b)=>new Date(b.createdAt||b.generatedAt||0)-new Date(a.createdAt||a.generatedAt||0)).slice(0,12);for(const r of reports){const m=aiMailPayload(r);if(m)await postMail(m);}for(const r of (state.reminders||[]).slice(0,80)){const m=reminderMailPayload(r);if(m)await postMail(m);}window.dispatchEvent(new CustomEvent('neon:phase9b1-mail-refresh'));}
async function boot(){const ready=await waitForCore();if(!ready){toast('PHASE 9B.1 COULD NOT ATTACH // CORE V9 REMAINS AVAILABLE',true);return;}const status={nav:'waiting',mailbox:'waiting',tasks:'waiting',finance:'waiting',signals:'waiting'};const safe=async(name,fn)=>{try{const out=await fn();status[name]='ready';return out;}catch(e){status[name]=`error: ${e.message}`;console.error(`P91 ${name}`,e);return null;}};
  const nav=await safe('nav',()=>initPhase9B1Nav(toast));
  const mail=await safe('mailbox',()=>initPhase9B1Mailbox(toast));mailRefresh=mail?.refresh||null;
  await safe('tasks',()=>initPhase9B1Tasks(toast));
  await safe('finance',()=>initPhase9B1Finance(toast));
  await safe('signals',()=>initPhase9B1Signals(toast));
  installNexusContextBridge();
  await materializeClientMail();
  materializeTimer=setInterval(materializeClientMail,5*60*1000);sourcePollTimer=setInterval(pollSources,2*60*1000);
  window.NeonPhase9B1={version:'9B.1',workerTarget:'9.11.0',status,contextSnapshot:p91Context,activatePage:nav?.activatePage,refreshMailbox:()=>mailRefresh?.({materialize:true,silent:true}),refreshSignals:()=>window.dispatchEvent(new CustomEvent('neon:phase9b1-signals-refresh')),materializeMail:materializeClientMail};
  document.documentElement.dataset.phase9b1='ready';console.info('NEON OPS // PHASE 9B.1 READY',status);
}
boot();
