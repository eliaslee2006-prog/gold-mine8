import { state } from './state.js';
import { initAllowanceFutures,refreshAllowanceFutures,futuresSnapshot } from './phase9a-futures.js';
import { initPhase9Calendar } from './phase9a-calendar.js';
import { initPhase9Nexus,contextSnapshot } from './phase9a-nexus.js';
import { initPhase9Integrations } from './phase9a-integrations.js';

const $=s=>document.querySelector(s);
let toastTimer;
function toast(msg,error=false){const el=$('#toast');if(!el){console[error?'error':'log']('[PHASE 9B.0]',msg);return;}el.textContent=(error?'ERROR // ':'')+msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3600);}
function waitForBoot(timeout=15000){return new Promise(resolve=>{const start=Date.now(),tick=()=>{if(state.user&&$('#eventForm')&&$('#pageFinance'))return resolve(true);if(Date.now()-start>=timeout)return resolve(false);setTimeout(tick,120);};tick();});}
async function safe(name,fn,status){try{const out=await fn();status[name]='ready';return out;}catch(e){status[name]='failed';console.error(`Phase 9B.0 ${name} failed`,e);toast(`PHASE 9B.0 ${name.toUpperCase()} PARTIAL // ${e.message}`,true);return null;}}
async function boot(){const ready=await waitForBoot(),status={calendar:'waiting',futures:'waiting',nexus:'waiting',integrations:'waiting'};if(!ready){toast('PHASE 9B.0 COULD NOT ATTACH // CORE V9 STILL AVAILABLE',true);return;}await safe('futures',()=>initAllowanceFutures(toast),status);await safe('calendar',()=>initPhase9Calendar(toast),status);await safe('nexus',()=>initPhase9Nexus(toast),status);await safe('integrations',()=>initPhase9Integrations(toast),status);window.NeonPhase9A={version:'9B.0',status,contextSnapshot,futuresSnapshot,refresh(){refreshAllowanceFutures();window.dispatchEvent(new CustomEvent('neon:phase9a-contextchange'));}};document.documentElement.dataset.phase9a='ready';console.info('NEON OPS // PHASE 9B.0 READY',status);}
boot();
