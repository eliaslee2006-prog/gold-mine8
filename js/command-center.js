import { state } from './state.js';

const $=s=>document.querySelector(s);
const STORE='neon_ops_v9_phase8b_command_center';
let toast=()=>{},navigate=()=>{};
let cfg=loadCfg();
let priorityDrag=null;

function loadCfg(){try{return {...defaults(),...JSON.parse(localStorage.getItem(STORE)||'{}')}}catch{return defaults()}}
function defaults(){return{focus:false,priorityIds:[],collapsed:{},lastVisitAt:null,lastCounts:null,morningKey:null,eveningKey:null}}
function saveCfg(){localStorage.setItem(STORE,JSON.stringify(cfg));}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const pick=(o,keys)=>{for(const k of keys){if(o?.[k]!==undefined&&o?.[k]!==null&&o?.[k]!=='')return o[k]}return null};
const parseDate=v=>{if(!v)return null;const d=v instanceof Date?v:new Date(v);return Number.isNaN(d.getTime())?null:d};
const dateKey=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
const timeFmt=d=>new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);
const dayFmt=d=>new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',weekday:'short',day:'2-digit',month:'short'}).format(d).toUpperCase();
const money=n=>`S$${Number(n||0).toFixed(2)}`;
function eventStart(e){return parseDate(pick(e,['start_at','startAt','start','starts_at','startTime','start_time']))}
function eventEnd(e){return parseDate(pick(e,['end_at','endAt','end','ends_at','endTime','end_time']))}
function taskDue(t){const v=pick(t,['due_at','dueAt','due','due_date','deadline','scheduled_at','scheduledAt']);if(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v))return new Date(`${v}T23:59:00+08:00`);return parseDate(v)}
function reminderWhen(r){return parseDate(pick(r,['effective_at','effectiveAt','remind_at','remindAt','scheduled_at','scheduledAt','due_at','dueAt','at']))}
function fitWhen(s){return parseDate(pick(s,['performed_at','performedAt','date','created_at','createdAt']))}
function labelOf(x,fallback='UNTITLED'){return String(pick(x,['title','name','label','summary','subject'])||fallback)}
function taskDone(t){const v=String(pick(t,['status','state'])||'').toLowerCase();return !!pick(t,['completed','completed_at','completedAt'])||['done','completed','closed'].includes(v)}
function taskActive(t){return !taskDone(t)&&String(pick(t,['status'])||'active').toLowerCase()!=='deleted'}

function todayItems(){
  const now=new Date(),key=dateKey(now),items=[];
  for(const e of state.events||[]){const d=eventStart(e);if(d&&dateKey(d)===key)items.push({kind:'EVENT',id:e.id,title:labelOf(e),time:d,end:eventEnd(e),priority:1,source:e});}
  for(const t of state.tasks||[]){if(!taskActive(t))continue;const d=taskDue(t);if(d&&dateKey(d)===key)items.push({kind:'TASK',id:t.id,title:labelOf(t),time:d,priority:2,source:t});}
  for(const r of state.reminders||[]){const d=reminderWhen(r);const st=String(pick(r,['status','state'])||'active').toLowerCase();if(d&&dateKey(d)===key&&!['dismissed','done','completed'].includes(st))items.push({kind:'REMINDER',id:r.id,title:labelOf(r,'Reminder'),time:d,priority:3,source:r});}
  return items.sort((a,b)=>a.time-b.time||a.priority-b.priority);
}
function activeTasks(){return (state.tasks||[]).filter(taskActive)}
function overdueTasks(){const now=Date.now();return activeTasks().filter(t=>{const d=taskDue(t);return d&&d.getTime()<now})}
function dueReminders(){const now=Date.now();return (state.reminders||[]).filter(r=>{const d=reminderWhen(r),s=String(pick(r,['status','state'])||'active').toLowerCase();return d&&d.getTime()<=now&&!['dismissed','done','completed'].includes(s)})}

function orderedPriorities(){
  const candidates=activeTasks().map(t=>({id:t.id,title:labelOf(t),due:taskDue(t),source:t}));
  const rank=new Map((cfg.priorityIds||[]).map((id,i)=>[id,i]));
  candidates.sort((a,b)=>{const ar=rank.has(a.id)?rank.get(a.id):999,br=rank.has(b.id)?rank.get(b.id):999;if(ar!==br)return ar-br;const ad=a.due?.getTime()??Infinity,bd=b.due?.getTime()??Infinity;return ad-bd;});
  const top=candidates.slice(0,5);cfg.priorityIds=top.map(x=>x.id);saveCfg();return top;
}
function nowNextLater(items){const now=Date.now();const past=items.filter(x=>x.time.getTime()<=now);const upcoming=items.filter(x=>x.time.getTime()>now);const current=past.reverse().find(x=>x.kind==='EVENT'&&x.end&&x.end.getTime()>now)||null;const next=upcoming[0]||null;const later=upcoming.slice(1,4);return{current,next,later};}
function freeWindows(items){
  const key=dateKey(new Date()),slots=[];let cursor=new Date(`${key}T06:00:00+08:00`),endDay=new Date(`${key}T23:00:00+08:00`);
  const busy=items.filter(x=>x.kind==='EVENT').map(x=>({s:x.time,e:x.end||new Date(x.time.getTime()+60*60*1000)})).sort((a,b)=>a.s-b.s);
  for(const b of busy){if(b.s>cursor&&b.s-cursor>=30*60*1000)slots.push({s:new Date(cursor),e:new Date(Math.min(b.s,endDay))});if(b.e>cursor)cursor=new Date(Math.max(cursor,b.e));if(cursor>=endDay)break;}
  if(cursor<endDay&&endDay-cursor>=30*60*1000)slots.push({s:cursor,e:endDay});return slots.slice(0,4);
}
function financePulse(){
  const key=dateKey(new Date());let spend=0,inflow=0;
  for(const x of state.finance?.transactions||[]){const d=parseDate(pick(x,['occurred_at','occurredAt','date','created_at','createdAt']));if(!d||dateKey(d)!==key)continue;const a=Math.abs(Number(pick(x,['amount','value'])||0));const dir=String(pick(x,['direction','type','kind'])||'expense').toLowerCase();if(/inflow|income|credit/.test(dir))inflow+=a;else spend+=a;}
  return{spend,inflow,net:inflow-spend};
}
function portfolioPulse(){let value=0,cost=0;for(const p of state.finance?.positions||[]){const q=Number(pick(p,['qty','quantity','shares'])||0),cur=Number(pick(p,['current','current_price','currentPrice','price'])||0),entry=Number(pick(p,['entry','entry_price','entryPrice','avg_price','avgPrice'])||cur);value+=q*cur;cost+=q*entry;}return{value,pnl:value-cost,pct:cost?((value-cost)/cost)*100:0};}
function fitnessPulse(){const key=dateKey(new Date());const sessions=(state.fitness?.sessions||[]).filter(s=>{const d=fitWhen(s);return d&&dateKey(d)===key});return{count:sessions.length,last:sessions.at(-1)||null};}
function readiness(){const overdue=overdueTasks().length,due=dueReminders().length,items=todayItems(),fin=financePulse();let score=100;score-=Math.min(35,overdue*12);score-=Math.min(18,due*6);score-=Math.min(15,Math.max(0,items.length-7)*3);if(fin.spend>150)score-=8;score=Math.max(0,Math.round(score));const reasons=[];if(overdue)reasons.push(`${overdue} overdue task${overdue===1?'':'s'}`);if(due)reasons.push(`${due} due reminder${due===1?'':'s'}`);if(items.length>7)reasons.push('dense schedule');if(!reasons.length)reasons.push('no major operational friction');return{score,reasons};}
function latestDailyReport(){return (state.ai?.reports||[]).find(r=>String(pick(r,['scope','report_scope'])||'').toUpperCase()==='DAILY')||(state.ai?.reports||[])[0]||null}

export function initCommandCenter(t,{navigate:n}={}){toast=t;navigate=n||(()=>{});bind();renderCommandCenter();}
export function refreshCommandCenter(){renderCommandCenter();}
function bind(){
  $('#ccFocusBtn')?.addEventListener('click',()=>{cfg.focus=!cfg.focus;saveCfg();renderCommandCenter();});
  $('#ccQuickForm')?.addEventListener('submit',e=>{e.preventDefault();const input=$('#ccQuickInput'),v=input.value.trim();if(!v)return;navigate('NEXUS');setTimeout(()=>{const n=$('#nexusInput');if(n){n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));n.focus();}},80);input.value='';});
  $('#ccMorningBtn')?.addEventListener('click',()=>openBrief('morning'));
  $('#ccEveningBtn')?.addEventListener('click',()=>openBrief('evening'));
  $('#ccAskPriority')?.addEventListener('click',()=>{navigate('NEXUS');setTimeout(()=>{const n=$('#nexusInput');if(n){n.value='What is the single most important thing I should prioritize today, based on my current Neon Ops data?';n.dispatchEvent(new Event('input',{bubbles:true}));n.focus();}},80);});
  $('#ccRefreshBtn')?.addEventListener('click',()=>{renderCommandCenter();toast('COMMAND CENTER REFRESHED');});
}
function openBrief(mode){const items=todayItems(),fin=financePulse(),fit=fitnessPulse(),p=orderedPriorities(),over=overdueTasks();const title=mode==='morning'?'MORNING BRIEF':'EVENING REVIEW';const lines=mode==='morning'?[`${items.length} scheduled items today`,`${activeTasks().length} active tasks · ${over.length} overdue`,`${state.reminderSummary?.active||state.reminders?.length||0} active reminders`,`Today spend ${money(fin.spend)}`,`${fit.count} fitness session${fit.count===1?'':'s'} logged`,p[0]?`Primary priority: ${p[0].title}`:'No active priority']:[`${activeTasks().length} tasks remain active`,`${over.length} overdue item${over.length===1?'':'s'}`,`${fit.count} fitness session${fit.count===1?'':'s'} today`,`Today net cashflow ${money(fin.net)}`,`${items.filter(x=>x.time<Date.now()).length}/${items.length} timed items elapsed`];
  const d=$('#ccBriefDialog');$('#ccBriefTitle').textContent=title;$('#ccBriefBody').innerHTML=lines.map(x=>`<div class="cc-brief-line">${esc(x)}</div>`).join('');const rpt=latestDailyReport();$('#ccBriefNexus').textContent=rpt?String(pick(rpt,['summary','headline'])||'Latest Daily Intelligence available.'):'No cached Gemini Daily Brief yet.';d?.showModal();
}
function renderCommandCenter(){const root=$('#commandCenter');if(!root)return;root.classList.toggle('focus-mode',!!cfg.focus);$('#ccFocusBtn').textContent=cfg.focus?'EXIT FOCUS':'FOCUS MODE';const items=todayItems(),nnl=nowNextLater(items),read=readiness(),fin=financePulse(),port=portfolioPulse(),fit=fitnessPulse(),priorities=orderedPriorities(),windows=freeWindows(items);$('#ccDate').textContent=dayFmt(new Date());$('#ccReadiness').textContent=read.score;$('#ccReadiness').dataset.band=read.score>=80?'good':read.score>=60?'warn':'bad';$('#ccReadinessReason').textContent=read.reasons.join(' // ').toUpperCase();renderNnl(nnl);renderTimeline(items);renderPriorities(priorities);renderActionCenter();renderWindows(windows);renderNexusPriority(priorities);$('#ccSpend').textContent=money(fin.spend);$('#ccCashNet').textContent=`NET ${fin.net>=0?'+':''}${money(fin.net)}`;$('#ccPortfolio').textContent=port.value?money(port.value):'—';$('#ccPortfolioPnl').textContent=port.value?`${port.pnl>=0?'+':''}${money(port.pnl)} // ${port.pct.toFixed(1)}%`:'NO POSITIONS';$('#ccFitness').textContent=fit.count?`${fit.count} SESSION${fit.count===1?'':'S'}`:'NO SESSION';$('#ccFitnessMeta').textContent=fit.last?labelOf(fit.last,'TODAY LOGGED'):'TODAY';renderSinceLast();saveVisitSnapshot();bindPriorityDnD();}
function itemHtml(x){return `<div class="cc-timeline-item" data-kind="${x.kind}"><time>${timeFmt(x.time)}</time><span><b>${esc(x.title)}</b><small>${x.kind}</small></span></div>`}
function renderTimeline(items){$('#ccTimeline').innerHTML=items.length?items.map(itemHtml).join(''):'<div class="cc-empty">NO TIMED ITEMS TODAY</div>';$('#ccTimelineCount').textContent=`${items.length} ITEMS`;}
function renderNnl({current,next,later}){const f=(x,empty)=>x?`<b>${esc(x.title)}</b><span>${timeFmt(x.time)} // ${x.kind}</span>`:`<b>${empty}</b><span>—</span>`;$('#ccNow').innerHTML=f(current,'FREE / UNCOMMITTED');$('#ccNext').innerHTML=f(next,'NO NEXT ITEM');$('#ccLater').innerHTML=later.length?later.map(x=>`<div><b>${esc(x.title)}</b><span>${timeFmt(x.time)}</span></div>`).join(''):'<div><b>CLEAR</b><span>—</span></div>';}
function renderPriorities(list){$('#ccPriorities').innerHTML=list.length?list.map((x,i)=>`<div class="cc-priority" data-priority-id="${esc(x.id)}"><button class="cc-drag-handle" type="button" aria-label="Reorder priority">⋮⋮</button><span class="cc-rank">0${i+1}</span><div><b>${esc(x.title)}</b><small>${x.due?`DUE ${dayFmt(x.due)} ${timeFmt(x.due)}`:'NO DEADLINE'}</small></div></div>`).join(''):'<div class="cc-empty">NO ACTIVE TASKS</div>';}
function renderNexusPriority(priorities){const rpt=latestDailyReport(),summary=String(pick(rpt,['summary','headline'])||'').trim(),fallback=priorities[0]?.title||'No active tasks require prioritisation.';$('#ccNexusPriority').innerHTML=`<b>${esc(fallback)}</b><p>${esc(summary||'Use ASK NEXUS for a contextual priority recommendation; cached briefs are reused to avoid unnecessary Gemini spend.')}</p>`;}
function renderActionCenter(){const rows=[];const ov=overdueTasks();if(ov.length)rows.push({level:'bad',title:`${ov.length} OVERDUE TASK${ov.length===1?'':'S'}`,meta:ov.slice(0,2).map(labelOf).join(' · '),go:'NEXUS'});const dr=dueReminders();if(dr.length)rows.push({level:'warn',title:`${dr.length} REMINDER${dr.length===1?'':'S'} DUE`,meta:'OPEN REMINDER CENTER',go:'OPS'});if(!state.integrations?.google)rows.push({level:'warn',title:'GOOGLE DISCONNECTED',meta:'CALENDAR / TASK SYNC OFFLINE',go:'OPS'});if(state.media?.quotaExceeded)rows.push({level:'warn',title:'SPOTIFY QUOTA LIMITED',meta:'CACHED MEDIA MODE ACTIVE',go:'MEDIA'});$('#ccActions').innerHTML=rows.length?rows.map((r,i)=>`<button class="cc-action" data-cc-go="${r.go}" data-level="${r.level}"><b>${esc(r.title)}</b><small>${esc(r.meta)}</small></button>`).join(''):'<div class="cc-empty good">NO CRITICAL ACTIONS</div>';document.querySelectorAll('[data-cc-go]').forEach(b=>b.onclick=()=>navigate(b.dataset.ccGo));$('#ccActionCount').textContent=`${rows.length} OPEN`;}
function renderWindows(list){$('#ccFreeWindows').innerHTML=list.length?list.map(x=>`<div class="cc-window"><b>${timeFmt(x.s)}–${timeFmt(x.e)}</b><span>${Math.round((x.e-x.s)/60000)} MIN FREE</span></div>`).join(''):'<div class="cc-empty">NO 30+ MIN FREE WINDOW</div>';}
function bindPriorityDnD(){document.querySelectorAll('.cc-drag-handle').forEach(h=>{h.onpointerdown=e=>startPriorityDrag(e,h.closest('.cc-priority'));});}
function startPriorityDrag(e,row){if(!row)return;e.preventDefault();row.setPointerCapture?.(e.pointerId);priorityDrag={row,id:row.dataset.priorityId,pointer:e.pointerId};row.classList.add('dragging');const move=ev=>{if(!priorityDrag)return;const y=ev.clientY;const rows=[...$('#ccPriorities').querySelectorAll('.cc-priority:not(.dragging)')];const target=rows.find(r=>{const q=r.getBoundingClientRect();return y<q.top+q.height/2;});if(target)$('#ccPriorities').insertBefore(row,target);else $('#ccPriorities').appendChild(row);};const up=()=>{row.classList.remove('dragging');cfg.priorityIds=[...$('#ccPriorities').querySelectorAll('.cc-priority')].map(r=>r.dataset.priorityId);saveCfg();priorityDrag=null;window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);renderCommandCenter();};window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',up,{once:true});}
function renderSinceLast(){const cur={events:state.events?.length||0,tasks:activeTasks().length,reminders:state.reminders?.length||0};const prev=cfg.lastCounts;let text='FIRST VISIT SNAPSHOT';if(prev){const parts=[];for(const [k,v] of Object.entries(cur)){const d=v-(Number(prev[k])||0);if(d)parts.push(`${d>0?'+':''}${d} ${k}`)}text=parts.length?parts.join(' // ').toUpperCase():'NO RECORD-COUNT CHANGES';}$('#ccSinceLast').textContent=text;}
function saveVisitSnapshot(){cfg.lastVisitAt=new Date().toISOString();cfg.lastCounts={events:state.events?.length||0,tasks:activeTasks().length,reminders:state.reminders?.length||0};saveCfg();}
