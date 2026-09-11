import { api } from './api.js';
import { state } from './state.js';
import { initPhase9B1Nav } from './phase9b1-nav.js';
import { initPhase9B1Finance,financeContextSnapshot } from './phase9b1-finance.js';
import { initPhase9CTasks,followupSnapshot } from './phase9c-tasks.js';
import { initPhase9CMailbox } from './phase9c-mailbox.js';
import { initPhase9CSignals,signalContextSnapshot } from './phase9c-signals.js';
import { initPhase9COps } from './phase9c-ops.js';
import { initPhase9CNexus } from './phase9c-nexus.js';
const $=s=>document.querySelector(s);let poll=null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function toast(msg,error=false){const el=$('#toast');if(!el){console[error?'error':'log'](msg);return;}el.textContent=(error?'ERROR // ':'')+msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),3600);}
async function waitForCore(){for(let i=0;i<180;i++){const cover=$('#bootCover'),bootReady=!cover||cover.classList.contains('off')||getComputedStyle(cover).pointerEvents==='none';if(bootReady&&state?.user&&$('#pageFinance')&&$('#taskForm'))return true;await sleep(100);}return !!state?.user;}
function context(){return{generatedAt:new Date().toISOString(),taskFollowups:followupSnapshot?.()||[],finance:financeContextSnapshot?.()||{},signals:signalContextSnapshot?.()||[],mailbox:{route:'pageMail'},phase:'9C'};}
function installContextBridge(){if(window.__p9cContextBridge)return;window.__p9cContextBridge=true;const native=window.fetch.bind(window);window.fetch=async(input,init={})=>{try{const url=typeof input==='string'?input:input?.url||'';if(/\/api\/v8\/nexus\/chat(?:\?|$)/.test(url)&&String(init.method||'GET').toUpperCase()==='POST'&&init.body){const b=typeof init.body==='string'?JSON.parse(init.body):init.body;if(b&&typeof b==='object'&&!b.phase9b1Context){b.phase9b1Context=context();init={...init,body:JSON.stringify(b)};}}}catch(e){console.warn('9C context bridge',e);}return native(input,init);};}
async function pollSources(){if(document.visibilityState==='hidden'||!state?.user)return;try{await api('/api/v8/phase9b1/sources/refresh',{method:'POST'});window.dispatchEvent(new CustomEvent('neon:phase9b1-signals-refresh'));window.dispatchEvent(new CustomEvent('neon:phase9b1-mail-refresh'));}catch(e){console.warn('9C source refresh',e.message);}}
async function boot(){if(!await waitForCore()){toast('PHASE 9C COULD NOT ATTACH // CORE REMAINS AVAILABLE',true);return;}const status={};const safe=async(name,fn)=>{try{const x=await fn();status[name]='ready';return x;}catch(e){status[name]=`error: ${e.message}`;console.error('9C',name,e);return null;}};const nav=await safe('nav',()=>initPhase9B1Nav(toast));await safe('mail',()=>initPhase9CMailbox(toast));await safe('tasks',()=>initPhase9CTasks(toast));await safe('finance',()=>initPhase9B1Finance(toast));await safe('signals',()=>initPhase9CSignals(toast));const ops=await safe('ops',()=>initPhase9COps());await safe('nexus',()=>initPhase9CNexus());installContextBridge();ops?.refresh?.();addEventListener('resize',()=>ops?.refresh?.(),{passive:true});poll=setInterval(pollSources,2*60*1000);document.documentElement.dataset.phase9c='ready';window.NeonPhase9C={version:'9C',workerTarget:'9.12.0',status,activatePage:nav?.activatePage,contextSnapshot:context,pollSources};console.info('NEON OPS // PHASE 9C READY',status);}
boot();
