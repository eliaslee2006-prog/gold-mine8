export const API_BASE='https://api.eliaslhx.com';
export async function api(path, options={}){
  const init={credentials:'include',headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})},...options};
  if(options.body && typeof options.body!=='string') init.body=JSON.stringify(options.body);
  const res=await fetch(`${API_BASE}${path}`,init);
  let data=null;try{data=await res.json();}catch{}
  if(!res.ok){const err=new Error(data?.error||`HTTP ${res.status}`);err.status=res.status;err.data=data;throw err;}
  return data;
}
export const connectGoogle=()=>location.assign(`${API_BASE}/auth/google?returnTo=${encodeURIComponent(location.href.split('?')[0])}`);

import { api,connectGoogle } from './api.js';import { state } from './state.js';import { initCalendar,refreshCalendar } from './calendar.js';import { initTasks,renderTasks } from './tasks.js';const $=s=>document.querySelector(s);let toastTimer;
function toast(msg,error=false){const el=$('#toast');el.textContent=(error?'ERROR // ':'')+msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3200);updateHud();}
function googleMeta(){return state.integrations?.google||null;}function updateHud(){const active=state.tasks.filter(t=>t.status==='active'),now=Date.now(),overdue=active.filter(t=>t.dueAt&&new Date(t.dueAt).getTime()<now),urgent=active.filter(t=>t.dueAt&&new Date(t.dueAt).getTime()>=now&&new Date(t.dueAt).getTime()<now+86400000);let mood='RELAXED',text='No urgent objectives detected.';if(overdue.filter(t=>['high','critical'].includes(t.priority)).length>=2||overdue.length>=4){mood='PANIC';text='Multiple overdue objectives require action.';}else if(urgent.length>=2||active.length>=6){mood='ANXIOUS';text='Deadline pressure is rising.';}else if(active.length){mood='FOCUSED';text='Operational workload within normal range.';}$('#nexusMood').textContent=mood;$('#taskPressure').textContent=`${active.length} ACTIVE`;$('#pressureText').textContent=text;$('#statusEvents').textContent=state.events.length;$('#statusTasks').textContent=state.tasks.length;const g=googleMeta();$('#statusGoogle').textContent=g?'CONNECTED':'DISCONNECTED';$('#statusGoogle').style.color=g?'var(--green)':'var(--amber)';const last=g?.metadata?.lastSyncAt;$('#statusSync').textContent=last?new Date(last).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'NOT YET';}
function clock(){const parts=new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(new Date());$('#clock').textContent=`${parts.filter(x=>['hour','minute','second'].includes(x.type)).map(x=>x.value).join(':')} SGT`;}
async function loadBootstrap(){const data=await api('/api/v8/bootstrap');state.user=data.user;state.events=data.events||[];state.tasks=data.tasks||[];state.integrations=data.integrations||{};return data;}
async function syncNow(){const btn=$('#syncGoogleBtn');btn.disabled=true;const old=btn.textContent;btn.textContent='SYNCING…';try{const result=await api('/api/v8/sync/google',{method:'POST'});await loadBootstrap();refreshCalendar();renderTasks(toast);updateHud();const pulled=(result.pull?.calendar?.inserted||0)+(result.pull?.calendar?.updated||0)+(result.pull?.tasks?.inserted||0)+(result.pull?.tasks?.updated||0);toast(`GOOGLE SYNC COMPLETE // ${pulled} REMOTE RECORDS`);}catch(e){toast(e.message,true);}finally{btn.disabled=false;btn.textContent=old;}}
async function boot(){clock();setInterval(clock,1000);document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.close).close());try{const health=await api('/health');$('#apiStatus').textContent=`API // ${health.version}`;$('#apiStatus').style.color='var(--green)';}catch{$('#apiStatus').textContent='API // OFFLINE';}
try{await loadBootstrap();$('#authStatus').textContent='AUTH // SECURE';$('#authStatus').style.color='var(--green)';$('#statusAuth').textContent='SECURE';initCalendar(toast);initTasks(toast);$('#syncGoogleBtn').onclick=syncNow;updateHud();}catch(e){if(e.status===401){$('#authStatus').textContent='AUTH // REQUIRED';$('#statusAuth').textContent='REQUIRED';const btn=document.createElement('button');btn.className='primary';btn.textContent='CONNECT GOOGLE';btn.onclick=connectGoogle;document.querySelector('.ops-grid').prepend(btn);}else toast(e.message,true);}$('#bootCover').classList.add('off');setTimeout(()=>$('#bootCover').remove(),300);}
window.addEventListener('resize',()=>{if(state.user){refreshCalendar();renderTasks(toast);}});boot();

import { api } from './api.js';
import { state, upsert, remove } from './state.js';

const $=s=>document.querySelector(s);
const pad=n=>String(n).padStart(2,'0');
const DAY=86400000;
const DEFAULT_PREFS={view:'week',hourHeight:64,startHour:6,endHour:24,timeFormat:'24',eventOpacity:82,eventRadius:8};
let prefs=loadPrefs(),anchor=startOfDay(new Date()),onChanged=()=>{},nowTimer=null,pointer=null;

function loadPrefs(){try{return{...DEFAULT_PREFS,...JSON.parse(localStorage.getItem('neon_v8_calendar_display')||'{}')}}catch{return{...DEFAULT_PREFS}}}
function savePrefs(){localStorage.setItem('neon_v8_calendar_display',JSON.stringify(prefs));applyPrefs();}
function applyPrefs(){const r=document.documentElement;r.style.setProperty('--hour-height',`${prefs.hourHeight}px`);r.style.setProperty('--event-opacity',String(prefs.eventOpacity/100));r.style.setProperty('--event-radius',`${prefs.eventRadius}px`);}
function startOfDay(d){const x=new Date(d);x.setHours(0,0,0,0);return x}
function monday(d){const x=startOfDay(d),n=(x.getDay()+6)%7;x.setDate(x.getDate()-n);return x}
function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x}
function addMonths(d,n){const x=new Date(d);x.setMonth(x.getMonth()+n);return x}
function isoDate(d){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
function localInput(value){if(!value)return'';const d=new Date(value);return `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`}
function parseLocalInput(value){return value?new Date(value):null}
function formatTime(d){return new Intl.DateTimeFormat('en-SG',{hour:'2-digit',minute:'2-digit',hour12:prefs.timeFormat==='12'}).format(d)}
function clamp(n,a,b){return Math.min(Math.max(n,a),b)}
function snap(n,step=15){return Math.round(n/step)*step}
function dayCode(d){return ['SU','MO','TU','WE','TH','FR','SA'][d.getDay()]}
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function categoryColor(cat){return({OPERATIONAL:'#00d9ff',DUTY:'#ff405c',FITNESS:'#6ee7a7',STUDY:'#4f8cff',FINANCE:'#ffba4a',PERSONAL:'#8b6cff',TRAVEL:'#ff3ea5',REST:'#64636d',MAINTENANCE:'#b3b0bd',GOOGLE:'#00d9ff'})[cat]||'#00d9ff'}

function parseRule(text){
  if(!text)return null;const raw=String(text).replace(/^RRULE:/i,'');const p={};
  for(const bit of raw.split(';')){const i=bit.indexOf('=');if(i>0)p[bit.slice(0,i).toUpperCase()]=bit.slice(i+1)}
  return p.FREQ?p:null;
}
function untilDate(rule){
  if(!rule?.UNTIL)return null;const s=rule.UNTIL;
  if(/^\d{8}$/.test(s))return new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T23:59:59`);
  if(/^\d{8}T\d{6}Z$/.test(s))return new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(9,11)}:${s.slice(11,13)}:${s.slice(13,15)}Z`);
  return new Date(s);
}
function expandEvent(ev,rangeStart,rangeEnd){
  const baseS=new Date(ev.startAt),baseE=new Date(ev.endAt),duration=baseE-baseS,rule=parseRule(ev.repeatRule);
  if(!rule)return baseE>rangeStart&&baseS<rangeEnd?[occ(ev,baseS,baseE,0)]:[];
  const out=[],freq=rule.FREQ,interval=Math.max(1,Number(rule.INTERVAL)||1),countLimit=Number(rule.COUNT)||Infinity,until=untilDate(rule),byday=(rule.BYDAY||'').split(',').filter(Boolean);
  let emitted=0,guard=0;
  if(freq==='DAILY'){
    for(let i=0;guard++<5000;i+=interval){const s=addDays(baseS,i);if(until&&s>until)break;if(s>=rangeEnd)break;emitted++;if(emitted>countLimit)break;const e=new Date(s.getTime()+duration);if(e>rangeStart&&s<rangeEnd)out.push(occ(ev,s,e,emitted-1));}
  }else if(freq==='WEEKLY'){
    const week0=monday(baseS),days=byday.length?byday:[dayCode(baseS)];
    for(let w=0;guard++<1000;w+=interval){
      const ws=addDays(week0,w*7);if(ws>=rangeEnd&&emitted>=countLimit)break;
      for(let di=0;di<7;di++){const d=addDays(ws,di);if(!days.includes(dayCode(d)))continue;const s=new Date(d);s.setHours(baseS.getHours(),baseS.getMinutes(),baseS.getSeconds(),baseS.getMilliseconds());if(s<baseS)continue;if(until&&s>until)return out;if(s>=rangeEnd&&w>0)return out;emitted++;if(emitted>countLimit)return out;const e=new Date(s.getTime()+duration);if(e>rangeStart&&s<rangeEnd)out.push(occ(ev,s,e,emitted-1));}
    }
  }else if(freq==='MONTHLY'){
    const dom=baseS.getDate();
    for(let m=0;guard++<1000;m+=interval){const target=new Date(baseS);target.setDate(1);target.setMonth(baseS.getMonth()+m);const max=new Date(target.getFullYear(),target.getMonth()+1,0).getDate();target.setDate(Math.min(dom,max));target.setHours(baseS.getHours(),baseS.getMinutes(),baseS.getSeconds(),baseS.getMilliseconds());if(until&&target>until)break;if(target>=rangeEnd)break;emitted++;if(emitted>countLimit)break;const e=new Date(target.getTime()+duration);if(e>rangeStart&&target<rangeEnd)out.push(occ(ev,target,e,emitted-1));}
  }else{
    if(baseE>rangeStart&&baseS<rangeEnd)out.push(occ(ev,baseS,baseE,0));
  }
  return out;
}
function occ(ev,s,e,index){return{...ev,occurrenceStart:s,occurrenceEnd:e,occurrenceIndex:index,occurrenceKey:`${ev.id}@${s.toISOString()}`}}
function occurrences(rangeStart,rangeEnd){return state.events.flatMap(e=>expandEvent(e,rangeStart,rangeEnd)).sort((a,b)=>a.occurrenceStart-b.occurrenceStart)}
function getRange(){
  if(prefs.view==='day')return[startOfDay(anchor),addDays(startOfDay(anchor),1)];
  if(prefs.view==='month'){const s=new Date(anchor.getFullYear(),anchor.getMonth(),1),grid=monday(s);return[grid,addDays(grid,42)]}
  if(prefs.view==='agenda'){const s=monday(anchor);return[s,addDays(s,14)]}
  const s=monday(anchor);return[s,addDays(s,7)]
}
function updatePeriod(){
  const [s,e]=getRange();let text='';
  if(prefs.view==='day')text=s.toLocaleDateString('en-SG',{weekday:'short',day:'2-digit',month:'short',year:'numeric'}).toUpperCase();
  else if(prefs.view==='month')text=anchor.toLocaleDateString('en-SG',{month:'long',year:'numeric'}).toUpperCase();
  else text=`${s.toLocaleDateString('en-SG',{day:'2-digit',month:'short'}).toUpperCase()} — ${addDays(e,-1).toLocaleDateString('en-SG',{day:'2-digit',month:'short',year:'numeric'}).toUpperCase()}`;
  $('#calendarPeriod').textContent=text;
  document.querySelectorAll('.calendar-view').forEach(b=>b.classList.toggle('active',b.dataset.view===prefs.view));
}
function shiftPeriod(n){
  if(prefs.view==='day')anchor=addDays(anchor,n);
  else if(prefs.view==='month')anchor=addMonths(anchor,n);
  else if(prefs.view==='agenda')anchor=addDays(anchor,n*14);
  else anchor=addDays(anchor,n*7);
  renderCalendar();
}
function columnTemplate(days){return `${getComputedStyle(document.documentElement).getPropertyValue('--axis-width')||'62px'} repeat(${days},minmax(${days===1?'320':'138'}px,1fr))`}

function renderTimeline(days){
  const root=$('#calendar'),rangeStart=days===1?startOfDay(anchor):monday(anchor),rangeEnd=addDays(rangeStart,days),items=occurrences(rangeStart,rangeEnd),startH=Number(prefs.startHour),endH=Number(prefs.endHour),minutes=(endH-startH)*60,height=((endH-startH)*prefs.hourHeight),tpl=columnTemplate(days);
  root.innerHTML='';
  const sc=document.createElement('div');sc.className='scheduler-scroll';

  const hd=document.createElement('div');hd.className='scheduler-header';hd.style.gridTemplateColumns=tpl;
  const ah=document.createElement('div');ah.className='axis-head';ah.textContent='TIME';hd.append(ah);
  for(let i=0;i<days;i++){const d=addDays(rangeStart,i),x=document.createElement('div');x.className='day-header'+(isoDate(d)===isoDate(new Date())?' today':'');x.innerHTML=`<span class="day-name">${d.toLocaleDateString('en-SG',{weekday:'short'}).toUpperCase()}</span><span class="day-number">${d.getDate()}</span>`;hd.append(x)}
  sc.append(hd);

  const all=document.createElement('div');all.className='all-day-strip';all.style.gridTemplateColumns=tpl;const ax=document.createElement('div');ax.className='all-day-axis';ax.textContent='ALL DAY';all.append(ax);
  for(let i=0;i<days;i++){const d=addDays(rangeStart,i),cell=document.createElement('div');cell.className='all-day-cell';items.filter(x=>x.allDay&&isoDate(x.occurrenceStart)===isoDate(d)).forEach(x=>{const b=document.createElement('button');b.type='button';b.className='all-day-event';b.style.setProperty('--event-color',x.color||categoryColor(x.category));b.textContent=x.title;b.onclick=()=>openEventDialog(x);cell.append(b)});all.append(cell)}
  sc.append(all);

  const body=document.createElement('div');body.className='scheduler-body';body.style.gridTemplateColumns=tpl;
  const axis=document.createElement('div');axis.className='time-axis';axis.style.height=`${height}px`;
  for(let m=0;m<=minutes;m+=30){const lab=document.createElement('div');lab.className='time-label'+(m%60?' minor':'');lab.style.top=`${m/60*prefs.hourHeight}px`;const d=new Date(rangeStart);d.setHours(startH+Math.floor(m/60),m%60,0,0);lab.textContent=formatTime(d);axis.append(lab)}
  body.append(axis);

  const lanes=[];
  for(let i=0;i<days;i++){const d=addDays(rangeStart,i),lane=document.createElement('div');lane.className='day-lane'+(isoDate(d)===isoDate(new Date())?' today':'');lane.dataset.date=isoDate(d);lane.style.height=`${height}px`;lane.addEventListener('pointerdown',e=>blankPointerDown(e,lane));lanes.push(lane);body.append(lane)}
  sc.append(body);

  for(let i=0;i<days;i++){
    const d=addDays(rangeStart,i),dayItems=items.filter(x=>!x.allDay&&isoDate(x.occurrenceStart)===isoDate(d));
    layoutOverlaps(dayItems);
    for(const ev of dayItems)renderEventBlock(lanes[i],ev,startH,endH);
  }

  const now=new Date();
  if(now>=rangeStart&&now<rangeEnd&&now.getHours()+now.getMinutes()/60>=startH&&now.getHours()+now.getMinutes()/60<=endH){
    const dayIndex=Math.floor((startOfDay(now)-rangeStart)/DAY);if(dayIndex>=0&&dayIndex<days){
      const line=document.createElement('div');line.className='now-line';line.style.top=`${((now.getHours()*60+now.getMinutes())-startH*60)/60*prefs.hourHeight}px`;line.innerHTML='<span class="now-dot"></span>';lanes[dayIndex].append(line);
    }
  }
  root.append(sc);
  requestAnimationFrame(()=>{const target=Math.max(0,((new Date().getHours()-startH)-1)*prefs.hourHeight);if(!root.dataset.initialScrolled){sc.scrollTop=target;root.dataset.initialScrolled='1';}});
}
function layoutOverlaps(items){
  const sorted=[...items].sort((a,b)=>a.occurrenceStart-b.occurrenceStart||a.occurrenceEnd-b.occurrenceEnd),active=[];
  for(const ev of sorted){for(let i=active.length-1;i>=0;i--)if(active[i].occurrenceEnd<=ev.occurrenceStart)active.splice(i,1);const used=new Set(active.map(x=>x._lane));let lane=0;while(used.has(lane))lane++;ev._lane=lane;active.push(ev);const concurrent=active.length;for(const x of active)x._cols=Math.max(x._cols||1,concurrent)}
}
function renderEventBlock(lane,ev,startH,endH){
  const s=ev.occurrenceStart,e=ev.occurrenceEnd,startM=s.getHours()*60+s.getMinutes(),endM=e.getHours()*60+e.getMinutes(),visibleStart=startH*60,visibleEnd=endH*60;
  if(endM<=visibleStart||startM>=visibleEnd)return;
  const top=(Math.max(startM,visibleStart)-visibleStart)/60*prefs.hourHeight,height=Math.max(22,(Math.min(endM,visibleEnd)-Math.max(startM,visibleStart))/60*prefs.hourHeight),cols=ev._cols||1,laneIndex=ev._lane||0,gap=4;
  const el=document.createElement('div');el.className='event-block';el.dataset.id=ev.id;el.dataset.occurrence=ev.occurrenceStart.toISOString();el.style.setProperty('--event-color',ev.color||categoryColor(ev.category));el.style.top=`${top}px`;el.style.height=`${height}px`;el.style.left=`calc(${laneIndex*100/cols}% + ${gap}px)`;el.style.width=`calc(${100/cols}% - ${gap*2}px)`;
  el.innerHTML=`<div class="event-content"><div class="event-time">${formatTime(s)} — ${formatTime(e)}</div><div class="event-title">${escapeHtml(ev.title)}</div><div class="event-type">${escapeHtml(ev.category||'EVENT')}${ev.repeatRule?' // REPEATING':''}</div></div><div class="event-resize" aria-label="Resize"></div>`;
  installEventPointer(el,ev);lane.append(el);
}
function installEventPointer(el,ev){
  el.addEventListener('pointerdown',e=>{
    if(e.button!==undefined&&e.button!==0)return;e.stopPropagation();
    const resizing=e.target.closest('.event-resize');const start={x:e.clientX,y:e.clientY,time:Date.now()},origS=new Date(ev.startAt),origE=new Date(ev.endAt),occS=ev.occurrenceStart,offset=occS-origS;
    let active=false,moved=false,timer=null;
    const activate=()=>{active=true;el.classList.add('dragging');el.setPointerCapture?.(e.pointerId)};
    if(e.pointerType==='touch')timer=setTimeout(activate,430);
    else active=true;
    const move=pe=>{
      const dist=Math.hypot(pe.clientX-start.x,pe.clientY-start.y);if(!active&&e.pointerType!=='touch'&&dist>4)activate();if(!active)return;if(dist>6)moved=true;
      if(resizing){const dy=pe.clientY-start.y,delta=snap(dy/prefs.hourHeight*60);const newDur=Math.max(15,(origE-origS)/60000+delta);el.style.height=`${Math.max(22,newDur/60*prefs.hourHeight)}px`;}
      else{el.style.transform=`translateY(${pe.clientY-start.y}px)`;}
    };
    const up=async pe=>{
      clearTimeout(timer);window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);el.classList.remove('dragging');el.style.transform='';
      if(!active||!moved){if(!resizing)openEventDialog(ev);return}
      try{
        if(ev.repeatRule&&ev.occurrenceIndex>0){onChanged('Recurring series: drag the series start or edit recurrence in the event panel.',true);renderCalendar();return}
        if(resizing){const delta=snap((pe.clientY-start.y)/prefs.hourHeight*60);const end=new Date(origE.getTime()+delta*60000);if(end<=origS)throw new Error('Event must be at least 15 minutes');await patchDates(ev.id,origS,end);}
        else{
          const laneEl=document.elementFromPoint(pe.clientX,pe.clientY)?.closest?.('.day-lane');const day=laneEl?new Date(`${laneEl.dataset.date}T00:00:00`):startOfDay(origS),deltaM=snap((pe.clientY-start.y)/prefs.hourHeight*60),newS=new Date(day);newS.setHours(origS.getHours(),origS.getMinutes()+deltaM,origS.getSeconds(),origS.getMilliseconds());const newE=new Date(newS.getTime()+(origE-origS));await patchDates(ev.id,newS,newE);
        }
      }catch(err){onChanged(err.message,true);renderCalendar()}
    };
    window.addEventListener('pointermove',move,{passive:true});window.addEventListener('pointerup',up,{once:true});
  });
}
async function patchDates(id,s,e){const out=await api(`/api/v8/events/${encodeURIComponent(id)}`,{method:'PATCH',body:{startAt:s.toISOString(),endAt:e.toISOString(),allDay:false}});upsert(state.events,out.item);renderCalendar();onChanged(out.syncWarning?`Event saved // ${out.syncWarning}`:'Event synced')}
function blankPointerDown(e,lane){
  if(e.target!==lane)return;const start={x:e.clientX,y:e.clientY,scrollTop:lane.closest('.scheduler-scroll')?.scrollTop||0,time:Date.now()};
  const up=pe=>{window.removeEventListener('pointerup',up);const dist=Math.hypot(pe.clientX-start.x,pe.clientY-start.y);if(dist>9||Date.now()-start.time>600)return;const r=lane.getBoundingClientRect(),m=snap((pe.clientY-r.top)/prefs.hourHeight*60)+Number(prefs.startHour)*60;const d=new Date(`${lane.dataset.date}T00:00:00`);d.setHours(Math.floor(m/60),m%60,0,0);openEventDialog(null,d,new Date(d.getTime()+3600000));};window.addEventListener('pointerup',up,{once:true});
}

function renderMonth(){
  const root=$('#calendar'),first=new Date(anchor.getFullYear(),anchor.getMonth(),1),start=monday(first),end=addDays(start,42),items=occurrences(start,end);root.innerHTML='';
  const scroll=document.createElement('div');scroll.className='scheduler-scroll';const grid=document.createElement('div');grid.className='month-grid';
  for(const name of ['MON','TUE','WED','THU','FRI','SAT','SUN']){const h=document.createElement('div');h.className='month-head';h.textContent=name;grid.append(h)}
  for(let i=0;i<42;i++){const d=addDays(start,i),cell=document.createElement('div');cell.className='month-cell'+(d.getMonth()!==anchor.getMonth()?' outside':'')+(isoDate(d)===isoDate(new Date())?' today':'');cell.innerHTML=`<div class="month-date">${d.getDate()}</div>`;cell.onclick=e=>{if(e.target===cell||e.target.classList.contains('month-date')){anchor=d;prefs.view='day';savePrefs();renderCalendar()}};items.filter(x=>isoDate(x.occurrenceStart)===isoDate(d)).slice(0,5).forEach(ev=>{const b=document.createElement('button');b.className='month-event';b.style.setProperty('--event-color',ev.color||categoryColor(ev.category));b.textContent=`${ev.allDay?'ALL DAY':formatTime(ev.occurrenceStart)}  ${ev.title}`;b.onclick=e=>{e.stopPropagation();openEventDialog(ev)};cell.append(b)});grid.append(cell)}
  scroll.append(grid);root.append(scroll);
}
function renderAgenda(){
  const root=$('#calendar'),[s,e]=getRange(),items=occurrences(s,e);root.innerHTML='';const wrap=document.createElement('div');wrap.className='agenda';
  const by={};for(const x of items)(by[isoDate(x.occurrenceStart)]??=[]).push(x);
  if(!Object.keys(by).length){wrap.innerHTML='<div class="task-meta">NO EVENTS IN THIS WINDOW</div>';root.append(wrap);return}
  for(const key of Object.keys(by).sort()){const d=new Date(`${key}T00:00:00`),sec=document.createElement('section');sec.className='agenda-day';sec.innerHTML=`<div class="agenda-date"><strong>${d.toLocaleDateString('en-SG',{day:'2-digit',month:'short'}).toUpperCase()}</strong><span>${d.toLocaleDateString('en-SG',{weekday:'long'}).toUpperCase()}</span></div>`;for(const ev of by[key]){const row=document.createElement('div');row.className='agenda-event';row.style.setProperty('--event-color',ev.color||categoryColor(ev.category));row.innerHTML=`<div class="agenda-time">${ev.allDay?'ALL DAY':formatTime(ev.occurrenceStart)}</div><div class="agenda-bar"></div><div><div class="agenda-title">${escapeHtml(ev.title)}</div><div class="agenda-type">${escapeHtml(ev.category||'EVENT')}${ev.repeatRule?' // REPEATING':''}</div></div><span>›</span>`;row.onclick=()=>openEventDialog(ev);sec.append(row)}wrap.append(sec)}
  root.append(wrap);
}

export function renderCalendar(){applyPrefs();updatePeriod();if(prefs.view==='month')renderMonth();else if(prefs.view==='agenda')renderAgenda();else renderTimeline(prefs.view==='day'?1:7);resetNowTimer();}
export function refreshCalendar(){renderCalendar()}

export function initCalendar(changed){
  onChanged=changed;applyPrefs();
  $('#todayBtn').onclick=()=>{anchor=startOfDay(new Date());renderCalendar()};
  $('#newEventBtn').onclick=()=>{const d=new Date();d.setMinutes(Math.ceil(d.getMinutes()/15)*15,0,0);openEventDialog(null,d,new Date(d.getTime()+3600000))};
  $('#calPrev').onclick=()=>shiftPeriod(-1);$('#calNext').onclick=()=>shiftPeriod(1);
  document.querySelectorAll('.calendar-view').forEach(b=>b.onclick=()=>{prefs.view=b.dataset.view;savePrefs();renderCalendar()});
  $('#eventForm').addEventListener('submit',async e=>{e.preventDefault();await saveEvent()});
  $('#deleteEventBtn').onclick=deleteEvent;
  $('#eventRepeat').onchange=syncRepeatUi;$('#repeatUnit').onchange=syncRepeatUi;$('#repeatEndMode').onchange=syncRepeatUi;$('#repeatInterval').oninput=syncRepeatUi;$('#repeatCount').oninput=syncRepeatUi;$('#repeatEndDate').onchange=syncRepeatUi;
  document.querySelectorAll('#repeatDaysWrap button').forEach(b=>b.onclick=()=>{b.classList.toggle('active');syncRepeatUi()});
  document.querySelectorAll('#eventColorPresets button').forEach(b=>b.onclick=()=>$('#eventColor').value=b.dataset.color);
  $('#eventCategory').onchange=()=>{if(!$('#eventId').value)$('#eventColor').value=categoryColor($('#eventCategory').value)};
  initDisplay();renderCalendar();
}
function resetNowTimer(){clearInterval(nowTimer);nowTimer=setInterval(()=>{if(prefs.view==='week'||prefs.view==='day')renderCalendar()},60000)}

function openEventDialog(item=null,start=null,end=null){
  const parent=item?state.events.find(x=>x.id===item.id):null;$('#eventId').value=parent?.id||'';$('#eventModalTitle').textContent=parent?'Edit Event':'New Event';$('#eventTitle').value=parent?.title||'';$('#eventCategory').value=parent?.category||'OPERATIONAL';$('#eventColor').value=parent?.color||categoryColor(parent?.category||'OPERATIONAL');$('#eventLocation').value=parent?.location||'';$('#eventNotes').value=parent?.notes||'';
  const range=parent?[new Date(parent.startAt),new Date(parent.endAt)]:[start,end];$('#eventStart').value=localInput(range[0]);$('#eventEnd').value=localInput(range[1]);$('#deleteEventBtn').classList.toggle('hidden',!parent);setRepeatFromRule(parent?.repeatRule,range[0]);$('#eventDialog').showModal();
}
function setRepeatFromRule(text,start){
  document.querySelectorAll('#repeatDaysWrap button').forEach(b=>b.classList.remove('active'));$('#repeatInterval').value=1;$('#repeatEndMode').value='never';$('#repeatCount').value=10;$('#repeatEndDate').value='';
  const r=parseRule(text);if(!r){$('#eventRepeat').value='none';syncRepeatUi();return}
  const interval=Number(r.INTERVAL)||1,days=(r.BYDAY||'').split(',').filter(Boolean),weekdaySet=['MO','TU','WE','TH','FR'];
  let preset='custom';if(r.FREQ==='DAILY'&&interval===1)preset='daily';else if(r.FREQ==='WEEKLY'&&interval===1&&weekdaySet.every(x=>days.includes(x))&&days.length===5)preset='weekdays';else if(r.FREQ==='WEEKLY'&&interval===1&&days.length<=1)preset='weekly';else if(r.FREQ==='WEEKLY'&&interval===2&&days.length<=1)preset='biweekly';else if(r.FREQ==='MONTHLY'&&interval===1)preset='monthly';
  $('#eventRepeat').value=preset;$('#repeatInterval').value=interval;$('#repeatUnit').value=r.FREQ||'WEEKLY';for(const d of days)document.querySelector(`#repeatDaysWrap button[data-day="${d}"]`)?.classList.add('active');
  if(r.COUNT){$('#repeatEndMode').value='count';$('#repeatCount').value=r.COUNT}else if(r.UNTIL){$('#repeatEndMode').value='date';const u=untilDate(r);if(u)$('#repeatEndDate').value=isoDate(u)}
  syncRepeatUi();
}
function syncRepeatUi(){
  const preset=$('#eventRepeat').value,custom=preset==='custom',repeating=preset!=='none';$('#repeatIntervalWrap').classList.toggle('hidden',!custom);$('#repeatDaysWrap').classList.toggle('hidden',!(custom&&$('#repeatUnit').value==='WEEKLY'));$('#repeatEndsWrap').classList.toggle('hidden',!repeating);
  const mode=$('#repeatEndMode').value;$('#repeatEndDateWrap').classList.toggle('hidden',!repeating||mode!=='date');$('#repeatCountWrap').classList.toggle('hidden',!repeating||mode!=='count');
  $('#repeatSummary').textContent=repeatSummary();
}
function selectedDays(){return[...document.querySelectorAll('#repeatDaysWrap button.active')].map(b=>b.dataset.day)}
function repeatRuleFromForm(start){
  const preset=$('#eventRepeat').value;if(preset==='none')return null;let freq='WEEKLY',interval=1,days=[];
  if(preset==='daily')freq='DAILY';else if(preset==='weekdays'){freq='WEEKLY';days=['MO','TU','WE','TH','FR']}else if(preset==='weekly'){freq='WEEKLY';days=[dayCode(start)]}else if(preset==='biweekly'){freq='WEEKLY';interval=2;days=[dayCode(start)]}else if(preset==='monthly')freq='MONTHLY';else{freq=$('#repeatUnit').value;interval=Math.max(1,Number($('#repeatInterval').value)||1);if(freq==='WEEKLY')days=selectedDays().length?selectedDays():[dayCode(start)]}
  const bits=[`FREQ=${freq}`];if(interval!==1)bits.push(`INTERVAL=${interval}`);if(days.length)bits.push(`BYDAY=${days.join(',')}`);const mode=$('#repeatEndMode').value;if(mode==='count')bits.push(`COUNT=${Math.max(1,Number($('#repeatCount').value)||1)}`);if(mode==='date'&&$('#repeatEndDate').value)bits.push(`UNTIL=${$('#repeatEndDate').value.replaceAll('-','')}T155959Z`);return`RRULE:${bits.join(';')}`;
}
function repeatSummary(){const p=$('#eventRepeat').value;if(p==='none')return'ONE-TIME EVENT';if(p==='daily')return'REPEATS DAILY';if(p==='weekdays')return'REPEATS MONDAY — FRIDAY';if(p==='weekly')return'REPEATS WEEKLY';if(p==='biweekly')return'REPEATS EVERY 2 WEEKS';if(p==='monthly')return'REPEATS MONTHLY';const days=selectedDays();return`CUSTOM // EVERY ${$('#repeatInterval').value||1} ${$('#repeatUnit').value}${days.length?` // ${days.join(' ')}`:''}`}
async function saveEvent(){
  const id=$('#eventId').value,start=parseLocalInput($('#eventStart').value),end=parseLocalInput($('#eventEnd').value);if(!start||!end||end<=start){onChanged('End time must be after start time.',true);return}
  const body={title:$('#eventTitle').value.trim(),category:$('#eventCategory').value,color:$('#eventColor').value,startAt:start.toISOString(),endAt:end.toISOString(),location:$('#eventLocation').value.trim(),notes:$('#eventNotes').value.trim(),allDay:false,repeatRule:repeatRuleFromForm(start)};
  try{const out=await api(id?`/api/v8/events/${encodeURIComponent(id)}`:'/api/v8/events',{method:id?'PATCH':'POST',body});upsert(state.events,out.item);$('#eventDialog').close();renderCalendar();onChanged(out.syncWarning?`Saved locally // ${out.syncWarning}`:(id?'Event series synced':'Event created + synced'))}catch(e){onChanged(e.message,true)}
}
async function deleteEvent(){const id=$('#eventId').value;if(!id||!confirm('Delete this event / recurring series from Neon Ops and Google Calendar?'))return;try{await api(`/api/v8/events/${encodeURIComponent(id)}`,{method:'DELETE'});remove(state.events,id);$('#eventDialog').close();renderCalendar();onChanged('Event deleted from Neon Ops + Google')}catch(e){onChanged(e.message,true)}}

function initDisplay(){
  $('#calendarDisplayBtn').onclick=()=>{$('#hourHeight').value=prefs.hourHeight;$('#dayStartHour').value=prefs.startHour;$('#dayEndHour').value=prefs.endHour;$('#timeFormat').value=prefs.timeFormat;$('#eventOpacity').value=prefs.eventOpacity;$('#eventRadius').value=prefs.eventRadius;updateDisplayLabels();$('#calendarDisplayDialog').showModal()};
  const update=updateDisplayLabels;['hourHeight','eventOpacity','eventRadius'].forEach(id=>$('#'+id).addEventListener('input',update));
  $('#calendarDisplayForm').addEventListener('submit',e=>{e.preventDefault();prefs.hourHeight=Number($('#hourHeight').value);prefs.startHour=Number($('#dayStartHour').value);prefs.endHour=Number($('#dayEndHour').value);prefs.timeFormat=$('#timeFormat').value;prefs.eventOpacity=Number($('#eventOpacity').value);prefs.eventRadius=Number($('#eventRadius').value);if(prefs.endHour<=prefs.startHour)prefs.endHour=24;savePrefs();$('#calendarDisplayDialog').close();renderCalendar();onChanged('Calendar display updated')});
  $('#resetCalendarDisplay').onclick=()=>{prefs={...DEFAULT_PREFS};savePrefs();$('#calendarDisplayDialog').close();renderCalendar();onChanged('Calendar display reset')};
}
function updateDisplayLabels(){$('#hourHeightValue').textContent=`${$('#hourHeight').value} px`;$('#eventOpacityValue').textContent=`${$('#eventOpacity').value}%`;$('#eventRadiusValue').textContent=`${$('#eventRadius').value} px`}

export const state={user:null,events:[],tasks:[],integrations:{},taskFilter:'active'};
export function upsert(list,item){const i=list.findIndex(x=>x.id===item.id);if(i>=0)list[i]=item;else list.push(item);return item;}
export function remove(list,id){const i=list.findIndex(x=>x.id===id);if(i>=0)list.splice(i,1);}

import { api } from './api.js';import { state,upsert,remove } from './state.js';const $=s=>document.querySelector(s);const pad=n=>String(n).padStart(2,'0');function localInput(value){if(!value)return'';const d=new Date(value);return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;}
export function initTasks(onChanged){$('#newTaskBtn').onclick=()=>openTask();$('#taskForm').addEventListener('submit',async e=>{e.preventDefault();await saveTask(onChanged);});$('#deleteTaskBtn').onclick=()=>deleteTask(onChanged);document.querySelectorAll('.filter').forEach(b=>b.onclick=()=>{state.taskFilter=b.dataset.filter;document.querySelectorAll('.filter').forEach(x=>x.classList.toggle('active',x===b));renderTasks(onChanged);});renderTasks(onChanged);}
export function renderTasks(onChanged){const root=$('#taskList');let items=[...state.tasks];if(state.taskFilter!=='all')items=items.filter(t=>state.taskFilter==='completed'?t.status==='completed':t.status!=='completed'&&t.status!=='cancelled');items.sort((a,b)=>(a.dueAt?new Date(a.dueAt):Infinity)-(b.dueAt?new Date(b.dueAt):Infinity));root.replaceChildren();if(!items.length){const e=document.createElement('div');e.className='task-meta';e.textContent='NO RECORDS IN THIS VIEW';root.append(e);}for(const t of items){const row=document.createElement('div');row.className=`task ${t.status==='completed'?'done':''}`;const check=document.createElement('input');check.type='checkbox';check.className='task-check';check.checked=t.status==='completed';check.ariaLabel=`Complete ${t.title}`;check.onchange=async()=>{check.disabled=true;try{const out=await api(`/api/v8/tasks/${encodeURIComponent(t.id)}`,{method:'PATCH',body:{status:check.checked?'completed':'active',completedAt:check.checked?new Date().toISOString():null}});upsert(state.tasks,out.item);renderTasks(onChanged);onChanged(out.syncWarning?`Task saved locally // ${out.syncWarning}`:(check.checked?'Objective complete + synced':'Objective reopened + synced'));}catch(e){check.checked=!check.checked;check.disabled=false;onChanged(e.message,true);}};const body=document.createElement('div');const title=document.createElement('div');title.className='task-title';title.textContent=t.title;const meta=document.createElement('div');meta.className='task-meta';meta.textContent=[t.priority?.toUpperCase(),t.category,t.provider==='google'?'GOOGLE':t.syncStatus?.toUpperCase(),t.dueAt?`DUE ${new Date(t.dueAt).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}`:null].filter(Boolean).join(' // ');body.append(title,meta);const open=document.createElement('button');open.className='task-open';open.textContent='›';open.onclick=()=>openTask(t);row.append(check,body,open);root.append(row);}}
function openTask(t=null){$('#taskId').value=t?.id||'';$('#taskModalTitle').textContent=t?'Edit Task':'New Task';$('#taskTitle').value=t?.title||'';$('#taskPriority').value=t?.priority||'medium';$('#taskDue').value=localInput(t?.dueAt);$('#taskCategory').value=t?.category||'DAILY';$('#taskNotes').value=t?.notes||'';$('#deleteTaskBtn').classList.toggle('hidden',!t);$('#taskDialog').showModal();}
async function saveTask(onChanged){const id=$('#taskId').value,due=$('#taskDue').value;const body={title:$('#taskTitle').value.trim(),priority:$('#taskPriority').value,category:$('#taskCategory').value,dueAt:due?new Date(due).toISOString():null,notes:$('#taskNotes').value.trim()};try{const out=await api(id?`/api/v8/tasks/${encodeURIComponent(id)}`:'/api/v8/tasks',{method:id?'PATCH':'POST',body});upsert(state.tasks,out.item);renderTasks(onChanged);$('#taskDialog').close();onChanged(out.syncWarning?`Saved locally // ${out.syncWarning}`:(id?'Task synced':'Task created + synced'));}catch(e){onChanged(e.message,true);}}
async function deleteTask(onChanged){const id=$('#taskId').value;if(!id||!confirm('Delete this task from Neon Ops and Google Tasks?'))return;try{await api(`/api/v8/tasks/${encodeURIComponent(id)}`,{method:'DELETE'});remove(state.tasks,id);renderTasks(onChanged);$('#taskDialog').close();onChanged('Task deleted from Neon Ops + Google');}catch(e){onChanged(e.message,true);}}
