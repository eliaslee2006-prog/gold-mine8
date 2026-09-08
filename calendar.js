import { api } from './api.js';
import { state, upsert, remove } from './state.js';

let calendar;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const pad = n => String(n).padStart(2, '0');

function localInput(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toFC(e) {
  return {
    id: e.id,
    title: e.title,
    start: e.startAt,
    end: e.endAt,
    allDay: e.allDay,
    backgroundColor: e.color || '#00d9ff',
    borderColor: e.color || '#00d9ff',
    extendedProps: e
  };
}

function defaultRange(date = new Date()) {
  const s = new Date(date);
  s.setMinutes(Math.ceil(s.getMinutes()/15)*15, 0, 0);
  const e = new Date(s.getTime() + 3600000);
  return [s, e];
}

function periodLabel(view) {
  const start = view.currentStart;
  const end = new Date(view.currentEnd.getTime() - 1);
  const fmtMonth = new Intl.DateTimeFormat('en-SG', { month: 'long', year: 'numeric' });
  const fmtDay = new Intl.DateTimeFormat('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });
  if (view.type === 'timeGridDay') return fmtDay.format(start).toUpperCase();
  if (view.type === 'dayGridMonth') return fmtMonth.format(start).toUpperCase();
  return `${fmtDay.format(start).toUpperCase()} — ${fmtDay.format(end).toUpperCase()}`;
}

function syncViewControls(view) {
  const label = $('#calendarPeriod');
  if (label) label.textContent = periodLabel(view);
  $$('.calendar-view').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view.type));
}

function eventContent(arg) {
  const wrap = document.createElement('div');
  wrap.className = 'hud-event';

  const time = document.createElement('div');
  time.className = 'hud-event-time';
  time.textContent = arg.timeText || (arg.event.allDay ? 'ALL DAY' : '');

  const title = document.createElement('div');
  title.className = 'hud-event-title';
  title.textContent = arg.event.title;

  wrap.append(time, title);
  return { domNodes: [wrap] };
}

export function initCalendar(onChanged) {
  const el = $('#calendar');
  calendar = new FullCalendar.Calendar(el, {
    initialView: innerWidth < 700 ? 'timeGridDay' : 'timeGridWeek',
    headerToolbar: false,
    slotDuration: '00:15:00',
    snapDuration: '00:15:00',
    slotLabelInterval: '01:00:00',
    scrollTime: '06:00:00',
    scrollTimeReset: false,
    nowIndicator: true,
    editable: true,
    selectable: true,
    selectMirror: true,
    stickyHeaderDates: true,
    dayMaxEvents: true,
    longPressDelay: 600,
    eventLongPressDelay: 600,
    selectLongPressDelay: 600,
    eventDragMinDistance: 12,
    height: 780,
    expandRows: true,
    allDaySlot: true,
    weekNumbers: false,
    dayHeaderFormat: { weekday: 'short', day: '2-digit' },
    slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    events: state.events.map(toFC),
    eventContent,
    eventDidMount(info) {
      info.el.style.setProperty('--event-color', info.event.backgroundColor || '#00d9ff');
    },
    datesSet(info) { syncViewControls(info.view); },
    select(info) {
      openEventDialog(null, info.start, info.end);
      calendar.unselect();
    },
    dateClick(info) {
      if (info.allDay) {
        const [s, e] = defaultRange(info.date);
        openEventDialog(null, s, e);
      }
    },
    eventClick(info) {
      openEventDialog(state.events.find(e => e.id === info.event.id));
    },
    async eventDrop(info) { await mutateDates(info, onChanged); },
    async eventResize(info) { await mutateDates(info, onChanged); }
  });

  calendar.render();

  $('#todayBtn').onclick = () => calendar.today();
  $('#calPrev').onclick = () => calendar.prev();
  $('#calNext').onclick = () => calendar.next();
  $$('.calendar-view').forEach(btn => btn.onclick = () => calendar.changeView(btn.dataset.view));
  $('#newEventBtn').onclick = () => {
    const [s, e] = defaultRange();
    openEventDialog(null, s, e);
  };
  $('#eventForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    await saveEvent(onChanged);
  });
  $('#deleteEventBtn').onclick = () => deleteEvent(onChanged);
}

async function mutateDates(info, onChanged) {
  try {
    const out = await api(`/api/v8/events/${encodeURIComponent(info.event.id)}`, {
      method: 'PATCH',
      body: {
        startAt: info.event.start.toISOString(),
        endAt: (info.event.end || new Date(info.event.start.getTime() + 3600000)).toISOString(),
        allDay: info.event.allDay
      }
    });
    upsert(state.events, out.item);
    onChanged(out.syncWarning ? `Event saved // ${out.syncWarning}` : 'Event synced');
  } catch (e) {
    info.revert();
    onChanged(e.message, true);
  }
}

export function refreshCalendar() {
  if (calendar) {
    calendar.removeAllEvents();
    state.events.forEach(e => calendar.addEvent(toFC(e)));
  }
}

function openEventDialog(item, start, end) {
  $('#eventId').value = item?.id || '';
  $('#eventModalTitle').textContent = item ? 'Edit Event' : 'New Event';
  $('#eventTitle').value = item?.title || '';
  $('#eventCategory').value = item?.category || 'OPERATIONAL';
  $('#eventColor').value = item?.color || '#00d9ff';
  $('#eventLocation').value = item?.location || '';
  $('#eventNotes').value = item?.notes || '';
  const range = item ? [new Date(item.startAt), new Date(item.endAt)] : [start, end];
  $('#eventStart').value = localInput(range[0]);
  $('#eventEnd').value = localInput(range[1]);
  $('#deleteEventBtn').classList.toggle('hidden', !item);
  $('#eventDialog').showModal();
}

async function saveEvent(onChanged) {
  const id = $('#eventId').value;
  const body = {
    title: $('#eventTitle').value.trim(),
    category: $('#eventCategory').value,
    color: $('#eventColor').value,
    startAt: new Date($('#eventStart').value).toISOString(),
    endAt: new Date($('#eventEnd').value).toISOString(),
    location: $('#eventLocation').value.trim(),
    notes: $('#eventNotes').value.trim(),
    allDay: false
  };
  try {
    const out = await api(id ? `/api/v8/events/${encodeURIComponent(id)}` : '/api/v8/events', {
      method: id ? 'PATCH' : 'POST', body
    });
    upsert(state.events, out.item);
    refreshCalendar();
    $('#eventDialog').close();
    onChanged(out.syncWarning ? `Saved locally // ${out.syncWarning}` : (id ? 'Event synced' : 'Event created + synced'));
  } catch (e) {
    onChanged(e.message, true);
  }
}

async function deleteEvent(onChanged) {
  const id = $('#eventId').value;
  if (!id || !confirm('Delete this event from Neon Ops and Google Calendar?')) return;
  try {
    await api(`/api/v8/events/${encodeURIComponent(id)}`, { method: 'DELETE' });
    remove(state.events, id);
    refreshCalendar();
    $('#eventDialog').close();
    onChanged('Event deleted from Neon Ops + Google');
  } catch (e) {
    onChanged(e.message, true);
  }
}
