import { api } from './api.js';
import { state,upsert,remove } from './state.js';

const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const PAGE_SIZE=10;
const ACTIVE_KEY='noc_fit_active_movement';
const RANGE_KEY='noc_fit_range';
const MARKER_KEY='noc_fit_markers';
let chart=null,series=null,markerPlugin=null,activeMovementId=localStorage.getItem(ACTIVE_KEY)||null,page=0,toast=()=>{},chartData=[],detailMap=new Map(),needsRangeReset=true;
let activeRange=localStorage.getItem(RANGE_KEY)||'3';
let markersEnabled=localStorage.getItem(MARKER_KEY)!=='0';

const clamp=(n,a,b)=>Math.min(Math.max(Number(n)||0,a),b);
const dayKey=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(d));
const addDay=(key,n=1)=>{const d=new Date(key+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const isoDow=key=>{const d=new Date(key+'T00:00:00Z').getUTCDay();return d===0?7:d};
const today=()=>dayKey(new Date());
const hex=(v,f)=>/^#[0-9a-fA-F]{6}$/.test(String(v||''))?String(v):f;
const currentMovement=()=>state.fitness.movements.find(m=>m.id===activeMovementId)||state.fitness.movements[0]||null;
const themeColor=(name,fallback)=>getComputedStyle(document.documentElement).getPropertyValue(name).trim()||fallback;
const alpha=(hex,a)=>{const h=String(hex).replace('#','');if(!/^[0-9a-fA-F]{6}$/.test(h))return `rgba(0,217,255,${a})`;const n=parseInt(h,16);return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`};
const movementSessions=m=>state.fitness.sessions.filter(s=>s.movementId===m.id).sort((a,b)=>new Date(a.performedAt)-new Date(b.performedAt));

function metricsOf(sessions){let volume=0,e1rm=0,sets=0;for(const s of sessions)for(const x of s.sets||[]){const w=Number(x.weightKg)||0,r=Number(x.reps)||0;volume+=w*r;sets++;if(w&&r)e1rm=Math.max(e1rm,w*(1+r/30));}return{volume,e1rm,sets};}
function deriveCandles(m){
  const ss=movementSessions(m),byDay={};for(const s of ss)(byDay[dayKey(s.performedAt)]??=[]).push(s);
  const created=dayKey(m.createdAt||new Date()),first=ss[0]?dayKey(ss[0].performedAt):created,start=first<created?first:created,end=today();
  let close=100,missed=0;const out=[],detail=[];let baseVol=Number(m.baselineVolume)||0,baseE=Number(m.baselineE1rm)||0;
  if((!baseVol||!baseE)&&ss.length){const fm=metricsOf(byDay[first]||[ss[0]]);if(!baseVol)baseVol=fm.volume||1;if(!baseE)baseE=fm.e1rm||1;}
  for(let k=start;k<=end;k=addDay(k)){
    const daySessions=byDay[k]||[],scheduled=(m.scheduledDays||[]).map(Number).includes(isoDow(k)),open=close;
    if(daySessions.length){
      const met=metricsOf(daySessions),ratios=[];if(baseVol&&met.volume)ratios.push(met.volume/baseVol);if(baseE&&met.e1rm)ratios.push(met.e1rm/baseE);
      const ratio=ratios.length?ratios.reduce((a,b)=>a+b,0)/ratios.length:1,gain=clamp(.004+(ratio-1)*.03,.001,.025);
      close=open*(1+gain);missed=0;
      const candle={time:k,open:+open.toFixed(3),high:+(Math.max(open,close)*1.003).toFixed(3),low:+(Math.min(open,close)*.998).toFixed(3),close:+close.toFixed(3)};
      out.push(candle);detail.push({time:k,state:'session',open,close,gain,metrics:met,sessions:daySessions.length,candle});
    } else if(scheduled){
      missed+=1;const decay=Math.min(Number(m.decayMax)||.02,(Number(m.decayBase)||.005)+(Number(m.decayAcceleration)||.0015)*missed);close=open*(1-decay);
      const candle={time:k,open:+open.toFixed(3),high:+(open*1.001).toFixed(3),low:+(close*.997).toFixed(3),close:+close.toFixed(3)};
      out.push(candle);detail.push({time:k,state:'missed',open,close,decay,missed,candle});
    } else {
      out.push({time:k});detail.push({time:k,state:'closed',open,close});
    }
  }
  return{data:out,detail,last:close,missed,baseVol,baseE};
}
function timeKey(v){if(!v)return null;if(typeof v==='string')return v;if(typeof v==='object'&&v.year)return`${v.year}-${String(v.month).padStart(2,'0')}-${String(v.day).padStart(2,'0')}`;return String(v);}
function applyPalette(m){if(!series||!m)return;const up=hex(m.chartUpColor,'#2fd69a'),down=hex(m.chartDownColor,'#ff405c');series.applyOptions({upColor:up,downColor:down,borderUpColor:up,borderDownColor:down,wickUpColor:up,wickDownColor:down});}
function markerData(m,detail){if(!markersEnabled)return[];const down=hex(m.chartDownColor,'#ff405c');return detail.filter(d=>d.state==='missed').map(d=>({time:d.time,position:'aboveBar',color:down,shape:'circle',text:`MISS ${d.missed}`,size:.65}));}
function ensureChart(){
  const el=$('#fitnessChart');if(!el||chart)return;const L=window.LightweightCharts;if(!L){el.innerHTML='<div class="fitness-empty">CHART ENGINE FAILED TO LOAD</div>';return;}
  chart=L.createChart(el,{autoSize:true,layout:{background:{type:'solid',color:'transparent'},textColor:'#8f909a',fontFamily:'Arial, Helvetica, sans-serif'},grid:{vertLines:{color:'rgba(255,255,255,.03)'},horzLines:{color:'rgba(255,255,255,.04)'}},rightPriceScale:{borderColor:'#2b2c35',scaleMargins:{top:.14,bottom:.12}},timeScale:{borderColor:'#2b2c35',timeVisible:false,rightOffset:3,barSpacing:10,minBarSpacing:3,fixLeftEdge:false,fixRightEdge:false},crosshair:{mode:L.CrosshairMode?.Normal??0,vertLine:{color:alpha(themeColor('--accent-primary','#00d9ff'),.28),labelBackgroundColor:'#151820'},horzLine:{color:alpha(themeColor('--accent-primary','#00d9ff'),.18),labelBackgroundColor:'#151820'}},handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},handleScale:{axisPressedMouseMove:true,mouseWheel:true,pinch:true}});
  series=chart.addSeries(L.CandlestickSeries,{upColor:'#2fd69a',downColor:'#ff405c',borderUpColor:'#2fd69a',borderDownColor:'#ff405c',wickUpColor:'#2fd69a',wickDownColor:'#ff405c',priceLineVisible:false,lastValueVisible:true});
  if(typeof L.createSeriesMarkers==='function')markerPlugin=L.createSeriesMarkers(series,[],{autoScale:false});
  chart.subscribeCrosshairMove(param=>{const k=timeKey(param.time);if(!k){showReadout();return;}showReadout(k);});
}
window.addEventListener('neon:themechange',()=>{if(!chart)return;const c=themeColor('--accent-primary','#00d9ff');chart.applyOptions({crosshair:{vertLine:{color:alpha(c,.28)},horzLine:{color:alpha(c,.18)}}});});
function setRange(range){
  if(!chart||!chartData.length)return;const valid=chartData.filter(x=>x.open!==undefined);if(!valid.length)return;
  activeRange=range;localStorage.setItem(RANGE_KEY,range);$$('#fitnessRanges [data-range]').forEach(b=>b.classList.toggle('active',b.dataset.range===range));
  if(range==='ALL'){chart.timeScale().fitContent();return;}const days={1:31,3:92,6:184,12:366}[range]||92,to=valid[valid.length-1].time,from=addDay(to,-days);chart.timeScale().setVisibleRange({from,to});
}
function liveRange(){setRange(activeRange||'3');}
function valueAtOrBefore(detail,key){let val=null;for(const d of detail){if(d.time>key)break;val=d.close;}return val;}
function renderMovementSelect(){
  const sel=$('#movementSelect');if(!sel)return;
  if(activeMovementId&&!state.fitness.movements.some(m=>m.id===activeMovementId))activeMovementId=null;
  if(!activeMovementId&&state.fitness.movements[0])activeMovementId=state.fitness.movements[0].id;
  sel.innerHTML=state.fitness.movements.map(m=>`<option value="${m.id}">${escapeHtml(m.symbol||'MOV')} // ${escapeHtml(m.name)}</option>`).join('');
  if(activeMovementId){sel.value=activeMovementId;localStorage.setItem(ACTIVE_KEY,activeMovementId);}
}
function renderFitness(){
  renderMovementSelect();const m=currentMovement(),empty=$('#fitnessEmpty'),body=$('#fitnessBody');
  if(!m){empty.classList.remove('hidden');body.classList.add('hidden');renderRecords();return;}
  empty.classList.add('hidden');body.classList.remove('hidden');ensureChart();const d=deriveCandles(m);chartData=d.data;detailMap=new Map(d.detail.map(x=>[x.time,x]));
  applyPalette(m);series?.setData(chartData);markerPlugin?.setMarkers(markerData(m,d.detail));
  if(needsRangeReset){setTimeout(()=>setRange(activeRange),0);needsRangeReset=false;}
  $('#fitnessIndex').textContent=d.last.toFixed(2);$('#fitnessMissed').textContent=String(d.missed);
  const ss=movementSessions(m),weekAgo=Date.now()-7*86400000;$('#fitnessWeekSessions').textContent=ss.filter(s=>new Date(s.performedAt).getTime()>=weekAgo).length;$('#fitnessTotalSessions').textContent=String(ss.length);
  const met=metricsOf(ss);$('#fitnessBestE1rm').textContent=met.e1rm?met.e1rm.toFixed(1)+' kg':'—';
  const prior=valueAtOrBefore(d.detail,addDay(today(),-7)),change=prior?((d.last/prior)-1)*100:0;const c=$('#fitness7dChange');c.textContent=(change>=0?'+':'')+change.toFixed(2)+'%';c.classList.toggle('positive',change>0);c.classList.toggle('negative',change<0);
  $('#fitnessSymbol').textContent=m.symbol||'MOV';$('#fitnessSchedule').textContent=(m.scheduledDays||[]).length?`SCHEDULE // ${(m.scheduledDays||[]).map(x=>['','MON','TUE','WED','THU','FRI','SAT','SUN'][x]).join(' ')}`:'SCHEDULE // NONE';
  $('#fitnessMarkersToggle').classList.toggle('active',markersEnabled);$('#fitnessMarkersToggle').setAttribute('aria-pressed',String(markersEnabled));showReadout();renderRecords();
}
function showReadout(key=null){
  const m=currentMovement();if(!m)return;let d=key?detailMap.get(key):null;if(!d){const vals=[...detailMap.values()];d=vals[vals.length-1];}if(!d)return;
  $('#fitnessReadoutDate').textContent=d.time;
  if(d.state==='closed'){$('#fitnessReadoutState').textContent='MARKET CLOSED';$('#fitnessReadoutState').dataset.state='closed';$('#fitnessO').textContent='—';$('#fitnessH').textContent='—';$('#fitnessL').textContent='—';$('#fitnessC').textContent=d.close.toFixed(2);$('#fitnessReadoutMeta').textContent='UNSCHEDULED / REST // INDEX HELD';return;}
  const c=d.candle||{};$('#fitnessO').textContent=Number(c.open).toFixed(2);$('#fitnessH').textContent=Number(c.high).toFixed(2);$('#fitnessL').textContent=Number(c.low).toFixed(2);$('#fitnessC').textContent=Number(c.close).toFixed(2);
  if(d.state==='session'){$('#fitnessReadoutState').textContent='COMPLETED';$('#fitnessReadoutState').dataset.state='session';$('#fitnessReadoutMeta').textContent=`${d.sessions} SESSION${d.sessions===1?'':'S'} // ${d.metrics.sets} SETS // ${d.metrics.volume.toFixed(0)} KG·REP // ${d.metrics.e1rm?d.metrics.e1rm.toFixed(1)+' E1RM':'NO E1RM'}`;}
  else{$('#fitnessReadoutState').textContent=`MISSED // ${d.missed}`;$('#fitnessReadoutState').dataset.state='missed';$('#fitnessReadoutMeta').textContent=`DECAY ${(d.decay*100).toFixed(2)}% // CONSECUTIVE MISS ${d.missed}`;}
}
function renderRecords(){
  const m=currentMovement(),host=$('#fitnessRecords');if(!m){host.innerHTML='<div class="fitness-empty">CREATE A MOVEMENT TO BEGIN.</div>';$('#fitnessPager').textContent='0 RECORDS';return;}
  const items=movementSessions(m).slice().reverse(),pages=Math.max(1,Math.ceil(items.length/PAGE_SIZE));page=Math.min(page,pages-1);const from=page*PAGE_SIZE,to=Math.min(items.length,(page+1)*PAGE_SIZE),chunk=items.slice(from,to);
  host.innerHTML=chunk.map(s=>{const met=metricsOf([s]);return `<button class="fitness-record" data-session="${s.id}"><span><b>${dayKey(s.performedAt)}</b><small>${new Date(s.performedAt).toLocaleTimeString('en-SG',{hour:'2-digit',minute:'2-digit'})}</small></span><span>${s.sets?.length||0} SETS</span><span>${met.volume.toFixed(0)} KG·REP</span><span>${met.e1rm?met.e1rm.toFixed(1)+' E1RM':'—'}</span><i>›</i></button>`}).join('')||'<div class="fitness-empty">NO COMPLETED SESSIONS.</div>';
  $('#fitnessPager').textContent=items.length?`${from+1}–${to} OF ${items.length}`:'0 RECORDS';$('#fitnessPrevPage').disabled=page===0;$('#fitnessNextPage').disabled=page>=pages-1;host.querySelectorAll('[data-session]').forEach(b=>b.onclick=()=>openSession(b.dataset.session));
}
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function localInput(iso){if(!iso)return'';const d=new Date(iso),pad=n=>String(n).padStart(2,'0');return`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;}
function openMovement(id=null){
  const m=id?state.fitness.movements.find(x=>x.id===id):null;$('#movementId').value=m?.id||'';$('#movementModalTitle').textContent=m?'Edit Movement':'New Movement';$('#movementName').value=m?.name||'';$('#movementSymbol').value=m?.symbol||'';$('#movementBaselineVolume').value=m?.baselineVolume||'';$('#movementBaselineE1rm').value=m?.baselineE1rm||'';$('#decayBase').value=(Number(m?.decayBase??.005)*100).toFixed(2);$('#decayAcceleration').value=(Number(m?.decayAcceleration??.0015)*100).toFixed(2);$('#decayMax').value=(Number(m?.decayMax??.02)*100).toFixed(2);$('#movementUpColor').value=hex(m?.chartUpColor,'#2fd69a');$('#movementDownColor').value=hex(m?.chartDownColor,'#ff405c');$$('#movementDays button').forEach(b=>b.classList.toggle('active',(m?.scheduledDays||[]).map(Number).includes(Number(b.dataset.day))));$('#deleteMovementBtn').classList.toggle('hidden',!m);$('#movementDialog').showModal();
}
function addSetRow(s={}){const row=document.createElement('div');row.className='set-row';row.innerHTML=`<span class="set-no"></span><input class="set-weight" type="number" min="0" step="0.25" placeholder="KG" value="${s.weightKg??''}"><input class="set-reps" type="number" min="0" step="1" placeholder="REPS" value="${s.reps??''}"><input class="set-rpe" type="number" min="0" max="10" step="0.5" placeholder="RPE" value="${s.rpe??''}"><button type="button" class="set-remove">×</button>`;row.querySelector('.set-remove').onclick=()=>{row.remove();renumberSets()};$('#setRows').appendChild(row);renumberSets();}
function renumberSets(){$$('#setRows .set-row').forEach((r,i)=>r.querySelector('.set-no').textContent=String(i+1).padStart(2,'0'));}
function openSession(id=null){
  const s=id?state.fitness.sessions.find(x=>x.id===id):null,m=currentMovement();if(!m)return;$('#sessionId').value=s?.id||'';$('#sessionModalTitle').textContent=s?'Edit Session':'Log Session';$('#sessionMovementName').textContent=`${m.symbol||'MOV'} // ${m.name}`;const performed=$('#sessionPerformedAt');performed.max=localInput(new Date().toISOString());performed.value=localInput(s?.performedAt||new Date().toISOString());$('#sessionBodyWeight').value=s?.bodyWeightKg??'';$('#sessionNotes').value=s?.notes||'';$('#setRows').innerHTML='';(s?.sets?.length?s.sets:[{}, {}, {}]).forEach(addSetRow);$('#deleteSessionBtn').classList.toggle('hidden',!s);$('#copyLastSessionBtn').disabled=movementSessions(m).filter(x=>x.id!==s?.id).length===0;updateSameDayNotice();$('#sessionDialog').showModal();
}
function updateSameDayNotice(){const m=currentMovement(),id=$('#sessionId').value,v=$('#sessionPerformedAt').value,el=$('#sameDayNotice');if(!m||!v){el.classList.add('hidden');return;}const k=dayKey(new Date(v)),same=movementSessions(m).filter(s=>s.id!==id&&dayKey(s.performedAt)===k);el.textContent=same.length?`${same.length} OTHER SESSION${same.length===1?'':'S'} ALREADY LOGGED ON ${k} // SAVING WILL AGGREGATE THEM INTO ONE DAILY CANDLE.`:'';el.classList.toggle('hidden',!same.length);}
function copyLastSession(){const m=currentMovement(),id=$('#sessionId').value,selected=new Date($('#sessionPerformedAt').value).getTime();let prev=movementSessions(m).filter(s=>s.id!==id&&new Date(s.performedAt).getTime()<selected).pop();if(!prev)prev=movementSessions(m).filter(s=>s.id!==id).pop();if(!prev){toast('NO PREVIOUS SESSION TO COPY',true);return;}$('#setRows').innerHTML='';(prev.sets||[]).forEach(addSetRow);if(prev.bodyWeightKg&&!$('#sessionBodyWeight').value)$('#sessionBodyWeight').value=prev.bodyWeightKg;toast('PREVIOUS SETS COPIED');}
async function saveMovement(e){
  e.preventDefault();const id=$('#movementId').value,scheduledDays=$$('#movementDays button.active').map(b=>Number(b.dataset.day)),payload={name:$('#movementName').value,symbol:$('#movementSymbol').value,baselineVolume:Number($('#movementBaselineVolume').value)||0,baselineE1rm:Number($('#movementBaselineE1rm').value)||0,scheduledDays,decayBase:Number($('#decayBase').value)/100,decayAcceleration:Number($('#decayAcceleration').value)/100,decayMax:Number($('#decayMax').value)/100,chartUpColor:$('#movementUpColor').value,chartDownColor:$('#movementDownColor').value,exerciseType:'strength',model:'hybrid'};
  try{const r=await api(id?`/api/v8/fitness/movements/${encodeURIComponent(id)}`:'/api/v8/fitness/movements',{method:id?'PATCH':'POST',body:payload});upsert(state.fitness.movements,r.item);activeMovementId=r.item.id;localStorage.setItem(ACTIVE_KEY,activeMovementId);$('#movementDialog').close();page=0;needsRangeReset=!id;renderFitness();toast('MOVEMENT SAVED');}catch(err){toast(err.message,true)}
}
async function saveSession(e){
  e.preventDefault();const id=$('#sessionId').value,m=currentMovement(),when=new Date($('#sessionPerformedAt').value);if(!Number.isFinite(when.getTime())){toast('INVALID SESSION TIME',true);return;}if(when.getTime()>Date.now()){toast('COMPLETED SESSIONS CANNOT BE IN THE FUTURE',true);return;}
  const sets=$$('#setRows .set-row').map(r=>({weightKg:Number(r.querySelector('.set-weight').value)||0,reps:Number(r.querySelector('.set-reps').value)||0,rpe:r.querySelector('.set-rpe').value===''?null:Number(r.querySelector('.set-rpe').value)}));
  try{const r=await api(id?`/api/v8/fitness/sessions/${encodeURIComponent(id)}`:'/api/v8/fitness/sessions',{method:id?'PATCH':'POST',body:{movementId:m.id,performedAt:when.toISOString(),exerciseType:'strength',bodyWeightKg:$('#sessionBodyWeight').value,notes:$('#sessionNotes').value,sets}});upsert(state.fitness.sessions,r.item);$('#sessionDialog').close();renderFitness();toast('SESSION SAVED');}catch(err){toast(err.message,true)}
}
async function deleteSession(){const id=$('#sessionId').value;if(!id||!confirm('Delete this completed training session?'))return;const btn=$('#deleteSessionBtn');btn.disabled=true;try{await api(`/api/v8/fitness/sessions/${encodeURIComponent(id)}`,{method:'DELETE'});remove(state.fitness.sessions,id);$('#sessionDialog').close();renderFitness();toast('SESSION DELETED');}catch(err){toast(err.message,true)}finally{btn.disabled=false}}
async function deleteMovement(){const id=$('#movementId').value;if(!id||!confirm('Delete this movement and all of its sessions?'))return;const btn=$('#deleteMovementBtn');btn.disabled=true;try{await api(`/api/v8/fitness/movements/${encodeURIComponent(id)}`,{method:'DELETE'});state.fitness.movements=state.fitness.movements.filter(x=>x.id!==id);state.fitness.sessions=state.fitness.sessions.filter(x=>x.movementId!==id);activeMovementId=state.fitness.movements[0]?.id||null;if(activeMovementId)localStorage.setItem(ACTIVE_KEY,activeMovementId);else localStorage.removeItem(ACTIVE_KEY);$('#movementDialog').close();page=0;needsRangeReset=true;renderFitness();toast('MOVEMENT DELETED');}catch(err){toast(err.message,true)}finally{btn.disabled=false}}
function exportCsv(){const m=currentMovement();if(!m)return;const rows=[['movement','symbol','performed_at','date','set','weight_kg','reps','rpe','body_weight_kg','notes']];for(const s of movementSessions(m)){for(const x of s.sets||[])rows.push([m.name,m.symbol||'',s.performedAt,dayKey(s.performedAt),x.setNumber||'',x.weightKg,x.reps,x.rpe??'',s.bodyWeightKg??'',s.notes||'']);}const csv=rows.map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\n'),blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${(m.symbol||m.name||'movement').replace(/[^a-z0-9_-]/gi,'_')}-fitness-history.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}

export function initFitness(toastFn){
  toast=toastFn;$('#movementSelect').onchange=e=>{activeMovementId=e.target.value;localStorage.setItem(ACTIVE_KEY,activeMovementId);page=0;needsRangeReset=true;renderFitness()};$('#newMovementBtn').onclick=()=>openMovement();$('#editMovementBtn').onclick=()=>currentMovement()&&openMovement(currentMovement().id);$('#logSessionBtn').onclick=()=>openSession();$('#fitnessExportBtn').onclick=exportCsv;$('#movementForm').onsubmit=saveMovement;$('#sessionForm').onsubmit=saveSession;$('#deleteSessionBtn').onclick=deleteSession;$('#deleteMovementBtn').onclick=deleteMovement;$('#addSetBtn').onclick=()=>addSetRow();$('#copyLastSessionBtn').onclick=copyLastSession;$('#sessionPerformedAt').addEventListener('input',updateSameDayNotice);$$('#movementDays button').forEach(b=>b.onclick=()=>b.classList.toggle('active'));
  $$('.palette-preset').forEach(b=>b.onclick=()=>{$('#movementUpColor').value=b.dataset.up;$('#movementDownColor').value=b.dataset.down;});
  $$('#fitnessRanges [data-range]').forEach(b=>{b.classList.toggle('active',b.dataset.range===activeRange);b.onclick=()=>setRange(b.dataset.range)});$('#fitnessReset').onclick=liveRange;$('#fitnessMarkersToggle').onclick=()=>{markersEnabled=!markersEnabled;localStorage.setItem(MARKER_KEY,markersEnabled?'1':'0');const m=currentMovement(),d=m?deriveCandles(m):null;markerPlugin?.setMarkers(m&&d?markerData(m,d.detail):[]);$('#fitnessMarkersToggle').classList.toggle('active',markersEnabled);$('#fitnessMarkersToggle').setAttribute('aria-pressed',String(markersEnabled));};$('#fitnessPrevPage').onclick=()=>{if(page>0){page--;renderRecords()}};$('#fitnessNextPage').onclick=()=>{const m=currentMovement(),pages=Math.ceil(movementSessions(m).length/PAGE_SIZE);if(page+1<pages){page++;renderRecords()}};renderFitness();
}
export function refreshFitness(){renderFitness();}
