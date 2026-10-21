import { createStore } from './store.js';
import { STRINGS } from './i18n.js';

const PEOPLE = [
  'Fábio', 'Alina', 'Filipa', 'Francisco', 'Inês', 'Laura',
  'Anna R.', 'Anna N.', 'Aslı', 'Charlélie', 'Clara', 'Maria',
  'Martyna', 'Mimi', 'Ourania', 'Sudenaz', 'Umer', 'Veve',
];
const MACHINES = { washer: { num: 2 }, dryer: { num: 1 } };
const DURATIONS = [30, 45, 60, 90, 120];
const MAX_MIN = 120;
const MIN = 60_000;
const DAY = 864e5;
const HOUR_PX = 60;
const DAYS_AHEAD = 14;

const ICONS = {
  washer: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="2.5" width="17" height="19" rx="3"/><circle cx="12" cy="13" r="5"/><path d="M8.6 13.6c1.1-.9 2.3-.9 3.4 0s2.3.9 3.4 0"/><circle cx="7" cy="5.5" r=".6" fill="currentColor"/><circle cx="9.2" cy="5.5" r=".6" fill="currentColor"/></svg>',
  dryer: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="2.5" width="17" height="19" rx="3"/><circle cx="12" cy="13" r="5"/><path d="M10.3 11c-.6.7.6 1.3 0 2s.6 1.3 0 2M13.7 11c-.6.7.6 1.3 0 2s.6 1.3 0 2"/><path d="M14 5.5h3"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/></svg>',
  cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
};

// ---------- small helpers ----------
const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const hhmm = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const startOfDay = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (ms, n) => { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); };
const dateValue = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const minutesUntil = ms => Math.max(1, Math.ceil((ms - Date.now()) / MIN));
const hue = name => [...name].reduce((h, c) => (h * 31 + c.codePointAt(0)) % 360, 7);
const avatar = (name, cls = '') =>
  `<span class="avatar ${cls}" style="--h:${hue(name)}">${esc([...name][0] || '?')}</span>`;

// ---------- state ----------
const state = {
  bookings: [],
  me: PEOPLE.includes(storage.get('laundry.me')) ? storage.get('laundry.me') : null,
  lang: storage.get('laundry.lang') || (navigator.language?.toLowerCase().startsWith('pt') ? 'pt' : 'en'),
  machine: storage.get('laundry.machine') === 'dryer' ? 'dryer' : 'washer',
  day: startOfDay(Date.now()),
  duration: Number(storage.get('laundry.duration')) || 90,
  mode: 'local',
  scrollTimeline: true,
};
let store;
let refreshSheet = null;

const t = () => STRINGS[state.lang];
const sorted = () => [...state.bookings].sort((a, b) => a.start - b.start);
const forMachine = m => sorted().filter(b => b.machine === m);
const currentOf = m => forMachine(m).find(b => b.start <= Date.now() && b.end > Date.now());
const nextOf = m => forMachine(m).find(b => b.start > Date.now());
const conflictsFor = (m, slot, ignoreId) =>
  forMachine(m).filter(b => b.id !== ignoreId && overlaps(b, slot));

function nextFreeStart(m, from, minutes) {
  let start = from;
  for (let i = 0; i < 50; i++) {
    const slot = { start, end: start + minutes * MIN };
    const hits = conflictsFor(m, slot);
    if (!hits.length) return start;
    start = Math.max(...hits.map(b => b.end));
  }
  return start;
}

const roundUp = (ms, step = 15) => Math.ceil(ms / (step * MIN)) * step * MIN;

function dayLabel(ms) {
  const today = startOfDay(Date.now());
  if (startOfDay(ms) === today) return t().today;
  if (startOfDay(ms) === addDays(today, 1)) return t().tomorrow;
  return new Date(ms).toLocaleDateString(t().locale, { weekday: 'short', day: 'numeric', month: 'short' });
}

// ---------- rendering ----------
function render() {
  const s = t();
  document.documentElement.lang = state.lang;
  document.title = s.title;
  const timeline = $('.timeline');
  const keepScroll = timeline && !state.scrollTimeline ? timeline.scrollTop : null;

  $('#app').innerHTML = `
    <header class="topbar">
      <div>
        <h1>${s.title}</h1>
        <p class="muted">${state.me ? esc(s.hi(state.me)) : ''}</p>
      </div>
      <div class="topbar-actions">
        <button class="chip" data-action="lang" aria-label="Language">${state.lang === 'pt' ? 'EN' : 'PT'}</button>
        <button class="me-btn" data-action="who" aria-label="${esc(s.change)}">
          ${state.me ? avatar(state.me) : '<span class="avatar">?</span>'}
        </button>
      </div>
    </header>

    ${state.mode === 'local' ? `<div class="banner">${ICONS.info}<span>${esc(s.demo)}</span></div>` : ''}

    <section class="machines">
      ${['washer', 'dryer'].map(machineCard).join('')}
    </section>

    ${myBookingsSection()}

    <section class="card schedule">
      <div class="section-head">
        <h2>${s.schedule}</h2>
        <div class="segmented" role="tablist">
          ${['washer', 'dryer'].map(m => `
            <button role="tab" aria-selected="${state.machine === m}" data-action="machine" data-machine="${m}">
              ${ICONS[m]}<span>${m === 'washer' ? s.washerShort : s.dryerShort}</span>
            </button>`).join('')}
        </div>
      </div>
      <div class="days" role="tablist">${daysStrip()}</div>
      <p class="hint muted">${s.tapToBook} · ${s.maxNote}</p>
      <div class="timeline">${timelineGrid()}</div>
    </section>

    ${upNextSection()}

    <details class="card rules">
      <summary>${ICONS.info}<span>${s.howItWorks}</span></summary>
      <ol>${s.rules.map(r => `<li>${r}</li>`).join('')}</ol>
    </details>

    <button class="fab" data-action="book">${ICONS.plus}<span>${s.book}</span></button>
  `;

  const tl = $('.timeline');
  if (keepScroll !== null) {
    tl.scrollTop = keepScroll;
  } else {
    const isToday = state.day === startOfDay(Date.now());
    const firstBooking = forMachine(state.machine).find(b => b.end > state.day && b.start < addDays(state.day, 1));
    const focus = isToday ? Date.now() - 1.5 * 3600e3 : firstBooking ? firstBooking.start - 3600e3 : state.day + 8 * 3600e3;
    tl.scrollTop = Math.max(0, ((focus - state.day) / 3600e3) * HOUR_PX);
    state.scrollTimeline = false;
  }
  const days = $('.days');
  const sel = days.querySelector('[aria-selected="true"]');
  if (sel && (sel.offsetLeft < days.scrollLeft || sel.offsetLeft + sel.offsetWidth > days.scrollLeft + days.clientWidth)) {
    days.scrollLeft = sel.offsetLeft - 16;
  }
}

function machineCard(m) {
  const s = t();
  const cur = currentOf(m);
  const next = nextOf(m);
  const name = m === 'washer' ? s.washer : s.dryer;
  let body;
  if (cur) {
    const pct = Math.min(100, Math.max(0, ((Date.now() - cur.start) / (cur.end - cur.start)) * 100));
    body = `
      <div class="status busy"><span class="dot"></span>${s.inUse}</div>
      <div class="who">${avatar(cur.person, 'sm')}<span>${esc(cur.person)}${cur.person === state.me ? ` (${s.you})` : ''}</span></div>
      <div class="big">${esc(s.minLeft(minutesUntil(cur.end)))}</div>
      <div class="progress"><span style="width:${pct}%"></span></div>`;
  } else {
    body = `
      <div class="status free"><span class="dot"></span>${s.free}</div>
      <div class="big">${next ? esc(s.freeUntil(hhmm(next.start))) : '&nbsp;'}</div>
      <button class="btn small" data-action="now" data-machine="${m}">${s.useNow}</button>`;
  }
  const nextLine = next
    ? `<div class="next muted">${s.next}: ${esc(next.person)} · ${startOfDay(next.start) === startOfDay(Date.now()) ? hhmm(next.start) : `${esc(dayLabel(next.start))} ${hhmm(next.start)}`}</div>`
    : `<div class="next muted">${s.freeAllDay}</div>`;
  return `
    <article class="card machine ${cur ? 'is-busy' : 'is-free'} ${state.machine === m ? 'selected' : ''}" data-action="machine" data-machine="${m}">
      <div class="machine-head">
        <span class="machine-icon">${ICONS[m]}</span>
        <div><div class="machine-name">${name}</div><div class="muted tiny">${s.machineNo(MACHINES[m].num)}</div></div>
      </div>
      ${body}
      ${nextLine}
    </article>`;
}

function myBookingsSection() {
  if (!state.me) return '';
  const s = t();
  const mine = sorted().filter(b => b.person === state.me && b.end > Date.now());
  if (!mine.length) return '';
  return `
    <section class="card">
      <h2>${s.myBookings}</h2>
      <ul class="list">${mine.map(b => bookingRow(b)).join('')}</ul>
    </section>`;
}

function upNextSection() {
  const s = t();
  const upcoming = sorted().filter(b => b.end > Date.now()).slice(0, 8);
  if (!upcoming.length) return '';
  return `
    <section class="card">
      <h2>${s.upNext}</h2>
      <ul class="list">${upcoming.map(b => bookingRow(b, true)).join('')}</ul>
    </section>`;
}

function bookingRow(b, showPerson = false) {
  const s = t();
  const live = b.start <= Date.now();
  return `
    <li>
      <button class="row" data-action="detail" data-id="${esc(b.id)}">
        ${showPerson ? avatar(b.person, 'sm') : `<span class="machine-icon sm">${ICONS[b.machine]}</span>`}
        <span class="row-main">
          <span class="row-title">${showPerson ? esc(b.person) : (b.machine === 'washer' ? s.washer : s.dryer)}
            ${showPerson ? `<span class="muted"> · ${b.machine === 'washer' ? s.washerShort : s.dryerShort}</span>` : ''}</span>
          <span class="muted tiny">${esc(dayLabel(b.start))} · ${hhmm(b.start)}–${hhmm(b.end)}</span>
        </span>
        <span class="pill ${live ? 'busy' : ''}">${live ? esc(s.minLeft(minutesUntil(b.end))) : esc(s.inMin(minutesUntil(b.start)))}</span>
      </button>
    </li>`;
}

function daysStrip() {
  const today = startOfDay(Date.now());
  const counts = {};
  for (const b of forMachine(state.machine)) {
    const k = startOfDay(b.start);
    counts[k] = (counts[k] || 0) + 1;
  }
  return Array.from({ length: DAYS_AHEAD }, (_, i) => {
    const d = addDays(today, i);
    const date = new Date(d);
    const wd = i === 0 ? t().today : date.toLocaleDateString(t().locale, { weekday: 'short' }).replace('.', '');
    return `
      <button role="tab" class="day" aria-selected="${d === state.day}" data-action="day" data-day="${d}">
        <span class="wd">${esc(wd)}</span>
        <span class="dn">${date.getDate()}</span>
        <span class="dots">${'<i></i>'.repeat(Math.min(3, counts[d] || 0))}</span>
      </button>`;
  }).join('');
}

function timelineGrid() {
  const s = t();
  const dayStart = state.day;
  const dayEnd = addDays(dayStart, 1);
  const hours = Array.from({ length: 24 }, (_, h) =>
    `<div class="hour" style="top:${h * HOUR_PX}px"><span>${pad(h)}:00</span></div>`).join('');
  const blocks = forMachine(state.machine)
    .filter(b => b.end > dayStart && b.start < dayEnd)
    .map(b => {
      const top = ((Math.max(b.start, dayStart) - dayStart) / 3600e3) * HOUR_PX;
      const height = Math.max(22, ((Math.min(b.end, dayEnd) - Math.max(b.start, dayStart)) / 3600e3) * HOUR_PX - 2);
      const mine = b.person === state.me;
      const past = b.end <= Date.now();
      return `
        <button class="block ${mine ? 'mine' : ''} ${past ? 'past' : ''}" style="top:${top}px;height:${height}px;--h:${hue(b.person)}"
          data-action="detail" data-id="${esc(b.id)}">
          <b>${esc(b.person)}${mine ? ` (${s.you})` : ''}</b>
          <span>${hhmm(b.start)}–${hhmm(b.end)}</span>
        </button>`;
    }).join('');
  const now = Date.now();
  const nowLine = now >= dayStart && now < dayEnd
    ? `<div class="now-line" style="top:${((now - dayStart) / 3600e3) * HOUR_PX}px"><span>${hhmm(now)}</span></div>`
    : '';
  return `<div class="grid" data-action="slot" style="height:${24 * HOUR_PX}px">${hours}${blocks}${nowLine}</div>`;
}

// ---------- sheets ----------
const sheet = () => $('#sheet');

function openSheet(html, onRefresh = null) {
  const el = sheet();
  el.innerHTML = `<div class="sheet-inner"><div class="grabber"></div>${html}</div>`;
  refreshSheet = onRefresh;
  if (!el.open) el.showModal();
}

function closeSheet() {
  refreshSheet = null;
  if (sheet().open) sheet().close();
}

function openWho() {
  const s = t();
  openSheet(`
    <h2>${s.whoAreYou}</h2>
    <p class="muted">${s.whoHint}</p>
    <div class="people">
      ${PEOPLE.map(p => `
        <button class="person ${p === state.me ? 'active' : ''}" data-action="pick" data-person="${esc(p)}">
          ${avatar(p)}<span>${esc(p)}</span>
        </button>`).join('')}
    </div>`);
}

function openBook({ machine = state.machine, start = null } = {}) {
  if (!state.me) return openWho();
  const s = t();
  const form = {
    machine,
    start: start ?? nextFreeStart(machine, state.day === startOfDay(Date.now()) ? roundUp(Date.now()) : state.day + 9 * 3600e3, state.duration),
    duration: state.duration,
    dryerAfter: 0,
  };

  const draw = () => {
    const end = form.start + form.duration * MIN;
    const main = { start: form.start, end };
    const dryerSlot = form.dryerAfter ? { start: end, end: end + form.dryerAfter * MIN } : null;
    const problems = [];
    if (form.start < Date.now() - 5 * MIN) problems.push(s.past);
    for (const c of conflictsFor(form.machine, main)) {
      problems.push(`${s.conflict} ${esc(c.person)} (${hhmm(c.start)}–${hhmm(c.end)})`);
    }
    if (dryerSlot) {
      for (const c of conflictsFor('dryer', dryerSlot)) {
        problems.push(`${s.dryer}: ${s.conflict} ${esc(c.person)} (${hhmm(c.start)}–${hhmm(c.end)})`);
      }
    }
    const chips = (list, value, action, extra = '') =>
      list.map(d => `<button type="button" class="chip ${d === value ? 'active' : ''}" data-action="${action}" data-value="${d}">${d ? `${d >= 60 ? `${d / 60} h` : `${d} min`}`.replace('1.5 h', '1 h 30') : s.no}</button>`).join('') + extra;

    openSheet(`
      <h2>${s.bookSlot}</h2>
      <div class="segmented wide">
        ${['washer', 'dryer'].map(m => `
          <button type="button" aria-selected="${form.machine === m}" data-action="f-machine" data-value="${m}">
            ${ICONS[m]}<span>${m === 'washer' ? s.washer : s.dryer}</span>
          </button>`).join('')}
      </div>
      <div class="fields">
        <label><span>${s.day}</span>
          <input type="date" data-field="date" value="${dateValue(form.start)}" min="${dateValue(Date.now())}" max="${dateValue(addDays(Date.now(), DAYS_AHEAD - 1))}">
        </label>
        <label><span>${s.start}</span>
          <input type="time" data-field="time" step="300" value="${hhmm(form.start)}">
        </label>
      </div>
      <div class="field-label">${s.duration}</div>
      <div class="chips">${chips(DURATIONS, form.duration, 'f-duration')}</div>
      ${form.machine === 'washer' ? `
        <div class="field-label">${s.dryerAfter}</div>
        <div class="chips">${chips([0, 60, 90, 120], form.dryerAfter, 'f-dryer')}</div>` : ''}
      <div class="summary">
        ${avatar(state.me, 'sm')}
        <div>
          <b>${esc(dayLabel(form.start))} · ${hhmm(form.start)}–${hhmm(end)}</b>
          <div class="muted tiny">${form.machine === 'washer' ? s.washer : s.dryer}${dryerSlot ? ` + ${s.dryer} ${hhmm(dryerSlot.start)}–${hhmm(dryerSlot.end)}` : ''}</div>
        </div>
      </div>
      ${problems.length ? `<div class="problems">${problems.map(p => `<div>${ICONS.alert}<span>${p}</span></div>`).join('')}</div>` : ''}
      <div class="sheet-actions">
        <button type="button" class="btn ghost" data-action="close">${s.cancel}</button>
        <button type="button" class="btn" data-action="f-submit" ${problems.length ? 'disabled' : ''}>${s.confirm}</button>
      </div>
    `, draw);

    const el = sheet();
    el.querySelector('[data-field="date"]').onchange = e => {
      if (!e.target.value) return;
      const [y, mo, d] = e.target.value.split('-').map(Number);
      const old = new Date(form.start);
      form.start = new Date(y, mo - 1, d, old.getHours(), old.getMinutes()).getTime();
      draw();
    };
    el.querySelector('[data-field="time"]').onchange = e => {
      if (!e.target.value) return;
      const [h, mi] = e.target.value.split(':').map(Number);
      const d = new Date(form.start);
      d.setHours(h, mi, 0, 0);
      form.start = d.getTime();
      draw();
    };
    el.onclick = async e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const a = btn.dataset.action;
      if (a === 'f-machine') { form.machine = btn.dataset.value; if (form.machine === 'dryer') form.dryerAfter = 0; draw(); }
      if (a === 'f-duration') { form.duration = Math.min(MAX_MIN, Number(btn.dataset.value)); draw(); }
      if (a === 'f-dryer') { form.dryerAfter = Number(btn.dataset.value); draw(); }
      if (a === 'close') closeSheet();
      if (a === 'f-submit') {
        btn.disabled = true;
        const end = form.start + form.duration * MIN;
        try {
          await store.add({ machine: form.machine, person: state.me, start: form.start, end });
          if (form.dryerAfter) {
            await store.add({ machine: 'dryer', person: state.me, start: end, end: end + form.dryerAfter * MIN });
          }
          state.duration = form.duration;
          storage.set('laundry.duration', String(form.duration));
          state.machine = form.machine;
          state.day = startOfDay(form.start);
          state.scrollTimeline = true;
          closeSheet();
          toast(s.booked);
          render();
        } catch (err) {
          console.error(err);
          btn.disabled = false;
          toast(s.error);
        }
      }
    };
  };
  draw();
}

function openDetail(id) {
  const s = t();
  const draw = () => {
    const b = state.bookings.find(x => x.id === id);
    if (!b) return closeSheet();
    const mine = b.person === state.me;
    const live = b.start <= Date.now() && b.end > Date.now();
    const done = b.end <= Date.now();
    openSheet(`
      <div class="detail-head">
        ${avatar(b.person, 'lg')}
        <div>
          <h2>${esc(b.person)}${mine ? ` <span class="muted">(${s.you})</span>` : ''}</h2>
          <div class="muted">${b.machine === 'washer' ? s.washer : s.dryer} · ${s.machineNo(MACHINES[b.machine].num)}</div>
        </div>
      </div>
      <div class="summary">
        <span class="machine-icon sm">${ICONS.cal}</span>
        <div>
          <b>${esc(dayLabel(b.start))} · ${hhmm(b.start)}–${hhmm(b.end)}</b>
          <div class="muted tiny">${live ? esc(s.minLeft(minutesUntil(b.end))) : done ? '' : esc(s.inMin(minutesUntil(b.start)))}</div>
        </div>
      </div>
      <div class="sheet-actions stack">
        ${!done ? `<button type="button" class="btn ghost" data-action="ics">${ICONS.cal}<span>${s.addCal}</span></button>` : ''}
        ${mine && live ? `<button type="button" class="btn" data-action="finish">${s.finishNow}</button>` : ''}
        ${mine && !live && !done ? `<button type="button" class="btn danger" data-action="delete">${s.cancelBooking}</button>` : ''}
        <button type="button" class="btn ghost" data-action="close">${s.close}</button>
      </div>`, draw);

    sheet().onclick = async e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const a = btn.dataset.action;
      if (a === 'close') return closeSheet();
      if (a === 'ics') return downloadIcs(b);
      try {
        if (a === 'finish') { await store.finish(b.id, Date.now()); toast(s.freed); }
        if (a === 'delete') { await store.remove(b.id); toast(s.cancelled); }
        closeSheet();
      } catch (err) {
        console.error(err);
        toast(s.error);
      }
    };
  };
  draw();
}

function downloadIcs(b) {
  const s = t();
  const stamp = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const name = b.machine === 'washer' ? s.washer : s.dryer;
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//house-laundry//EN', 'BEGIN:VEVENT',
    `UID:${b.id}@house-laundry`, `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(b.start)}`, `DTEND:${stamp(b.end)}`,
    `SUMMARY:${s.title} – ${name}`,
    'BEGIN:VALARM', 'TRIGGER:-PT10M', 'ACTION:DISPLAY', `DESCRIPTION:${s.title} – ${name}`, 'END:VALARM',
    'BEGIN:VALARM', 'TRIGGER;RELATED=END:PT0M', 'ACTION:DISPLAY', `DESCRIPTION:${s.title} – ${name}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `laundry-${dateValue(b.start)}-${hhmm(b.start).replace(':', '')}.ics`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------- events ----------
$('#app').addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  if (a === 'lang') {
    state.lang = state.lang === 'pt' ? 'en' : 'pt';
    storage.set('laundry.lang', state.lang);
    render();
  } else if (a === 'who') {
    openWho();
  } else if (a === 'machine') {
    state.machine = el.dataset.machine;
    storage.set('laundry.machine', state.machine);
    state.scrollTimeline = true;
    render();
  } else if (a === 'day') {
    state.day = Number(el.dataset.day);
    state.scrollTimeline = true;
    render();
  } else if (a === 'now') {
    e.stopPropagation();
    openBook({ machine: el.dataset.machine, start: Math.floor(Date.now() / MIN) * MIN });
  } else if (a === 'book') {
    openBook();
  } else if (a === 'detail') {
    openDetail(el.dataset.id);
  } else if (a === 'slot') {
    const y = e.clientY - el.getBoundingClientRect().top;
    const minutes = Math.max(0, Math.min(24 * 60 - 15, Math.floor(((y / HOUR_PX) * 60) / 15) * 15));
    let start = state.day + minutes * MIN;
    if (start < Date.now() && start + 15 * MIN > Date.now()) start = Math.floor(Date.now() / MIN) * MIN;
    openBook({ machine: state.machine, start });
  }
});

sheet().addEventListener('click', e => {
  if (e.target === sheet()) return closeSheet(); // tap on backdrop
  const btn = e.target.closest('[data-action="pick"]');
  if (btn) {
    state.me = btn.dataset.person;
    storage.set('laundry.me', state.me);
    closeSheet();
    render();
  }
});
sheet().addEventListener('close', () => { refreshSheet = null; sheet().onclick = null; });

// keep "minutes left" fresh
setInterval(() => { render(); }, 20_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (state.day < startOfDay(Date.now())) state.day = startOfDay(Date.now());
    render();
  }
});

// ---------- boot ----------
render();
if (!state.me) openWho();

store = await createStore(
  list => {
    state.bookings = list;
    render();
    refreshSheet?.();
  },
  () => toast(t().error),
);
state.mode = store.mode;
render();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
