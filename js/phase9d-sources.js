import { api } from './api.js';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let timer=null,observer=null;
function when(v){if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleString('en-SG',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false});}
function ensure(){
  const root=$('#p91SourcesWorkspace');if(!root||$('#p9dSourceRuntime'))return;
  const panel=document.createElement('section');panel.id='p9dSourceRuntime';panel.className='p9d-source-runtime';
  panel.innerHTML=`<div class="p9d-runtime-head"><div><span class="kicker">9D // SOURCE ORCHESTRATOR</span><h3>Background Reader Runtime</h3></div><div class="actions"><button id="p9dBridgeRefresh" type="button" class="ghost small">CHECK BRIDGE</button><button id="p9dSourceRun" type="button" class="primary small">RUN DUE SOURCES</button></div></div><div class="p9d-runtime-grid"><article><span>TELEGRAM USER READER</span><b id="p9dTelegramState">CHECKING</b><small id="p9dTelegramMeta">NO BOT REQUIRED</small></article><article><span>SOURCE BRIDGE</span><b id="p9dBridgeState">CHECKING</b><small id="p9dBridgeMeta">—</small></article><article><span>BACKGROUND SCHEDULER</span><b id="p9dSchedulerState">CHECKING</b><small id="p9dSchedulerMeta">—</small></article><article><span>NEXT SOURCE</span><b id="p9dNextDue">—</b><small id="p9dLastRun">LAST RUN // —</small></article></div><div id="p9dSourceRuntimeNote" class="p9d-runtime-note">Telegram channels are read through your authorized user session on the private Source Reader bridge. The bot does not need to be present.</div>`;
  const head=root.firstElementChild;head?head.insertAdjacentElement('afterend',panel):root.prepend(panel);
  $('#p9dBridgeRefresh').onclick=refresh;
  $('#p9dSourceRun').onclick=runNow;
  refresh();
}
async function refresh(){
  if(!$('#p9dSourceRuntime'))return;
  try{
    const [bridge,scheduler]=await Promise.all([api('/api/v8/phase9d/bridge/status?deep=1'),api('/api/v8/phase9d/sources/status')]);
    const tg=$('#p9dTelegramState'),tm=$('#p9dTelegramMeta'),bs=$('#p9dBridgeState'),bm=$('#p9dBridgeMeta');
    if(bridge.telegram?.authorized){tg.textContent='USER SESSION READY';tg.dataset.state='ready';tm.textContent=`@${bridge.telegram.username||'ACCOUNT'} // MTProto // NO BOT`;}
    else if(bridge.bridge?.telegram){tg.textContent='SESSION NEEDS CHECK';tg.dataset.state='warn';tm.textContent=bridge.telegram?.error||'BRIDGE CONFIGURED // USER SESSION NOT VERIFIED';}
    else{tg.textContent='BRIDGE REQUIRED';tg.dataset.state='idle';tm.textContent='PAIR TELEGRAM USER SESSION TO ENABLE';}
    bs.textContent=bridge.reachable?'ONLINE':bridge.configured?'UNREACHABLE':'NOT CONFIGURED';bs.dataset.state=bridge.reachable?'ready':'warn';bm.textContent=bridge.reachable?`${bridge.version||'BRIDGE'} // WEB ${bridge.bridge?.web?'ON':'OFF'} // X ${bridge.bridge?.x?'ON':'OFF'}`:(bridge.error||'SET SOURCE_READER_BRIDGE_URL + TOKEN');
    $('#p9dSchedulerState').textContent=`${scheduler.status||'IDLE'} // ${scheduler.dueCount||0} DUE`;$('#p9dSchedulerState').dataset.state=scheduler.dueCount?'warn':'ready';
    $('#p9dSchedulerMeta').textContent=`${scheduler.enabledCount||0} ENABLED // SERVER CRON 1M`;
    $('#p9dNextDue').textContent=scheduler.dueCount?'NOW':when(scheduler.nextDueAt);
    $('#p9dLastRun').textContent=scheduler.lastRun?`LAST RUN // ${when(scheduler.lastRun.finishedAt||scheduler.lastRun.startedAt)} // ${scheduler.lastRun.success} OK / ${scheduler.lastRun.failed} ERR`:'LAST RUN // —';
  }catch(e){const n=$('#p9dSourceRuntimeNote');if(n)n.textContent=`RUNTIME STATUS ERROR // ${e.message}`;}
}
async function runNow(){const b=$('#p9dSourceRun');if(!b)return;b.disabled=true;b.textContent='RUNNING…';try{const d=await api('/api/v8/phase9d/sources/run',{method:'POST'});const n=$('#p9dSourceRuntimeNote');if(n)n.textContent=`MANUAL BACKGROUND SCAN // ${d.success||0} OK // ${d.failed||0} ERROR // ${d.skipped||0} SKIPPED`;window.dispatchEvent(new CustomEvent('neon:phase9b1-signals-refresh'));await refresh();}catch(e){const n=$('#p9dSourceRuntimeNote');if(n)n.textContent=`SOURCE SCAN FAILED // ${e.message}`;}finally{b.disabled=false;b.textContent='RUN DUE SOURCES';}}
export function initPhase9DSources(){ensure();observer=new MutationObserver(()=>ensure());observer.observe(document.body,{subtree:true,childList:true});timer=setInterval(()=>{if(document.visibilityState==='visible'&&!$('#p91SourcesWorkspace')?.classList.contains('hidden'))refresh();},60000);return{refresh,destroy(){observer?.disconnect();clearInterval(timer);}};}
