import { createStore } from './store.js';
import { STRINGS } from './i18n.js';
import { VAPID_PUBLIC_KEY } from './config.js';
import { WINDOWS, dueReminders, reminderMessage } from './reminders.js';

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
  bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15L6 16z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>',
  bellOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15L6 16z"/><path d="M10 20.5a2 2 0 0 0 4 0"/><path d="M3.5 3.5l17 17"/></svg>',
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
const fmtDur = d => (d < 60 ? `${d} min` : `${Math.floor(d / 60)} h${d % 60 ? ` ${pad(d % 60)}` : ''}`);
const machineName = m => (m === 'washer' ? t().washer : t().dryer);
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
  notify: storage.get('laundry.notify') !== 'off',
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
        <button class="chip icon-chip ${notifyActive() ? 'on' : ''}" data-action="notify"
          aria-label="${s.notifLabel}" aria-pressed="${notifyActive()}">${notifyActive() ? ICONS.bell : ICONS.bellOff}</button>
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
  let action = '';
  if (cur) {
    const pct = Math.min(100, Math.max(0, ((Date.now() - cur.start) / (cur.end - cur.start)) * 100));
    body = `
      <div class="status busy"><span class="dot"></span>${s.inUse}</div>
      <div class="who">${avatar(cur.person, 'sm')}<span>${esc(cur.person)}${cur.person === state.me ? ` (${s.you})` : ''}</span></div>
      <div class="big">${esc(s.minLeft(minutesUntil(cur.end)))}</div>
      <div class="progress"><span style="width:${pct}%"></span></div>`;
    if (cur.person === state.me) {
      action = `<button class="btn small" data-action="done" data-id="${esc(cur.id)}">${s.markDone}</button>`;
    }
  } else {
    body = `
      <div class="status free"><span class="dot"></span>${s.free}</div>
      <div class="big">${next ? esc(s.freeUntil(hhmm(next.start))) : '&nbsp;'}</div>`;
    action = `<button class="btn small" data-action="now" data-machine="${m}">${s.useNow}</button>`;
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
      <div class="machine-foot">${nextLine}${action}</div>
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

function openBook({ machine = state.machine, start = null, edit = null } = {}) {
  if (!state.me) return openWho();
  const s = t();
  const form = edit
    ? { machine: edit.machine, start: edit.start, duration: Math.round((edit.end - edit.start) / MIN), dryerAfter: 0 }
    : {
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
    const startChanged = !edit || form.start !== edit.start;
    if (startChanged && form.start < Date.now() - 5 * MIN) problems.push(s.past);
    for (const c of conflictsFor(form.machine, main, edit?.id)) {
      problems.push(`${s.conflict} ${esc(c.person)} (${hhmm(c.start)}–${hhmm(c.end)})`);
    }
    if (dryerSlot) {
      for (const c of conflictsFor('dryer', dryerSlot)) {
        problems.push(`${s.dryer}: ${s.conflict} ${esc(c.person)} (${hhmm(c.start)}–${hhmm(c.end)})`);
      }
    }
    const durations = [...new Set([...DURATIONS, form.duration])].sort((x, y) => x - y);
    const chips = (list, value, action) =>
      list.map(d => `<button type="button" class="chip ${d === value ? 'active' : ''}" data-action="${action}" data-value="${d}">${d ? fmtDur(d) : s.no}</button>`).join('');

    openSheet(`
      <h2>${edit ? s.editBooking : s.bookSlot}</h2>
      <div class="segmented wide">
        ${['washer', 'dryer'].map(m => `
          <button type="button" aria-selected="${form.machine === m}" data-action="f-machine" data-value="${m}">
            ${ICONS[m]}<span>${machineName(m)}</span>
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
      <div class="chips">${chips(durations, form.duration, 'f-duration')}</div>
      ${form.machine === 'washer' && !edit ? `
        <div class="field-label">${s.dryerAfter}</div>
        <div class="chips">${chips([0, 60, 90, 120], form.dryerAfter, 'f-dryer')}</div>` : ''}
      <div class="summary">
        ${avatar(state.me, 'sm')}
        <div>
          <b>${esc(dayLabel(form.start))} · ${hhmm(form.start)}–${hhmm(end)}</b>
          <div class="muted tiny">${machineName(form.machine)}${dryerSlot ? ` + ${s.dryer} ${hhmm(dryerSlot.start)}–${hhmm(dryerSlot.end)}` : ''}</div>
        </div>
      </div>
      ${problems.length ? `<div class="problems">${problems.map(p => `<div>${ICONS.alert}<span>${p}</span></div>`).join('')}</div>` : ''}
      <div class="sheet-actions">
        <button type="button" class="btn ghost" data-action="close">${s.cancel}</button>
        <button type="button" class="btn" data-action="f-submit" ${problems.length ? 'disabled' : ''}>${edit ? s.saveChanges : s.confirm}</button>
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
        // Firestore shows our own write in the live list before the server confirms it;
        // stop re-validating so the new booking is not reported as overlapping itself.
        refreshSheet = null;
        askNotifyPermission();
        const end = form.start + form.duration * MIN;
        const booking = { machine: form.machine, person: state.me, start: form.start, end };
        try {
          if (edit) {
            await store.replace(edit.id, booking);
          } else {
            await store.add(booking);
            if (form.dryerAfter) {
              await store.add({ machine: 'dryer', person: state.me, start: end, end: end + form.dryerAfter * MIN });
            }
            state.duration = form.duration;
            storage.set('laundry.duration', String(form.duration));
          }
          state.machine = form.machine;
          state.day = startOfDay(form.start);
          state.scrollTimeline = true;
          closeSheet();
          toast(edit ? s.updated : s.booked);
          render();
        } catch (err) {
          console.error(err);
          refreshSheet = draw;
          btn.disabled = false;
          toast(s.error);
        }
      }
    };
  };
  draw();
}

// "Set remaining time": keep the start (or move it to now if started early) and
// end when the machine display says it will.
function adjusted(b, remaining) {
  const now = Date.now();
  const end = Math.round((now + remaining * MIN) / MIN) * MIN;
  const start = Math.max(Math.min(b.start, Math.floor(now / MIN) * MIN), end - 4 * 60 * MIN);
  return { start, end };
}

function openDetail(id) {
  const s = t();
  let mode = 'view'; // 'view' | 'remaining' | 'cancel'
  let remaining = null;
  let busy = false;

  const draw = () => {
    if (busy) return;
    const b = state.bookings.find(x => x.id === id);
    if (!b) return closeSheet();
    const now = Date.now();
    const mine = b.person === state.me;
    const live = b.start <= now && b.end > now;
    const done = b.end <= now;
    const startsSoon = !live && !done && b.start - now <= 30 * MIN;
    const linked = sorted().filter(x => x.person === b.person && x.machine !== b.machine && x.id !== b.id
      && startOfDay(x.start) === startOfDay(b.start) && x.start > now);

    let body;
    if (mode === 'remaining') {
      if (remaining === null) remaining = live ? minutesUntil(b.end) : Math.round((b.end - b.start) / MIN);
      const { start, end } = adjusted(b, remaining);
      const hits = conflictsFor(b.machine, { start, end }, b.id);
      body = `
        <label class="remaining">
          <span>${s.remainingHint}</span>
          <div class="stepper">
            <button type="button" class="chip" data-action="r-step" data-value="-5">−5</button>
            <input type="number" inputmode="numeric" min="1" max="${MAX_MIN}" data-field="remaining" value="${remaining}">
            <button type="button" class="chip" data-action="r-step" data-value="5">+5</button>
          </div>
        </label>
        <div class="new-range">
          <b>${esc(s.newRange(`${hhmm(start)}–${hhmm(end)}`))}</b>
          <span class="muted tiny">${esc(s.wasRange(`${hhmm(b.start)}–${hhmm(b.end)}`))}</span>
        </div>
        ${hits.length ? `<div class="problems warn">${hits.map(c => `<div>${ICONS.alert}<span>${s.conflict} ${esc(c.person)} (${hhmm(c.start)}–${hhmm(c.end)}) — ${s.tellThem}</span></div>`).join('')}</div>` : ''}
        <div class="sheet-actions">
          <button type="button" class="btn ghost" data-action="back">${s.back}</button>
          <button type="button" class="btn" data-action="r-save">${s.saveChanges}</button>
        </div>`;
    } else if (mode === 'cancel') {
      body = `
        <h3 class="confirm-title">${s.cancelConfirm}</h3>
        <div class="checks">
          ${linked.map(x => `
            <label class="check">
              <input type="checkbox" data-linked="${esc(x.id)}" checked>
              <span class="machine-icon sm">${ICONS[x.machine]}</span>
              <span>${esc(s.alsoCancel(machineName(x.machine), `${hhmm(x.start)}–${hhmm(x.end)}`))}</span>
            </label>`).join('')}
        </div>
        <div class="sheet-actions">
          <button type="button" class="btn ghost" data-action="back">${s.back}</button>
          <button type="button" class="btn danger" data-action="c-confirm">${s.cancelBooking}</button>
        </div>`;
    } else {
      body = `
        <div class="sheet-actions stack">
          ${mine && (live || startsSoon) ? `<button type="button" class="btn" data-action="remaining">${s.setRemaining}</button>` : ''}
          ${mine && live ? `<button type="button" class="btn ghost" data-action="finish">${s.finishNow}</button>` : ''}
          ${mine && !done ? `
            <div class="btn-row">
              <button type="button" class="btn ghost" data-action="edit">${s.edit}</button>
              <button type="button" class="btn danger" data-action="delete">${s.deleteBooking}</button>
            </div>` : ''}
          ${!done ? `<button type="button" class="btn ghost" data-action="ics">${ICONS.cal}<span>${s.addCal}</span></button>` : ''}
          <button type="button" class="btn ghost" data-action="close">${s.close}</button>
        </div>`;
    }

    openSheet(`
      <div class="detail-head">
        ${avatar(b.person, 'lg')}
        <div>
          <h2>${esc(b.person)}${mine ? ` <span class="muted">(${s.you})</span>` : ''}</h2>
          <div class="muted">${machineName(b.machine)} · ${s.machineNo(MACHINES[b.machine].num)}</div>
        </div>
      </div>
      <div class="summary">
        <span class="machine-icon sm">${ICONS.cal}</span>
        <div>
          <b>${esc(dayLabel(b.start))} · ${hhmm(b.start)}–${hhmm(b.end)}</b>
          <div class="muted tiny">${live ? esc(s.minLeft(minutesUntil(b.end))) : done ? '' : esc(s.inMin(minutesUntil(b.start)))}</div>
        </div>
      </div>
      ${body}`, draw);

    const input = sheet().querySelector('[data-field="remaining"]');
    if (input) {
      input.oninput = () => {
        const v = Math.round(Number(input.value));
        if (v >= 1) remaining = Math.min(MAX_MIN, v);
      };
      input.onchange = () => draw();
    }

    sheet().onclick = async e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const a = btn.dataset.action;
      if (a === 'close') return closeSheet();
      if (a === 'ics') return downloadIcs(b);
      if (a === 'edit') return openBook({ edit: b });
      if (a === 'back') { mode = 'view'; remaining = null; return draw(); }
      if (a === 'remaining') { mode = 'remaining'; return draw(); }
      if (a === 'r-step') { remaining = Math.min(MAX_MIN, Math.max(1, remaining + Number(btn.dataset.value))); return draw(); }
      if (a === 'delete') { mode = 'cancel'; return draw(); }
      if (!['finish', 'c-confirm', 'r-save'].includes(a)) return;
      busy = true;
      btn.disabled = true;
      try {
        if (a === 'finish') { await store.finish(b.id, Date.now()); toast(s.freed); }
        if (a === 'c-confirm') {
          const extra = [...sheet().querySelectorAll('[data-linked]:checked')].map(x => x.dataset.linked);
          await Promise.all([b.id, ...extra].map(x => store.remove(x)));
          toast(s.cancelled);
        }
        if (a === 'r-save') {
          const { start, end } = adjusted(b, remaining);
          await store.replace(b.id, { machine: b.machine, person: b.person, start, end });
          toast(s.updated);
        }
        closeSheet();
      } catch (err) {
        console.error(err);
        busy = false;
        btn.disabled = false;
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

// ---------- reminders ----------
// Two layers, same messages (reminders.js):
//  * local notifications, precise, while the app is open or was just backgrounded;
//  * Web Push sent by the GitHub Action every ~5 min, which also reaches closed apps.
// Both use the same tag, so a phone shows one notification per reminder.
const NOTIFY_SUPPORTED = 'Notification' in window;
const notifyActive = () => state.notify && NOTIFY_SUPPORTED && Notification.permission !== 'denied';
let reminderTimer;

function askNotifyPermission() {
  if (state.notify && NOTIFY_SUPPORTED && Notification.permission === 'default') {
    Notification.requestPermission().then(() => { render(); checkReminders(); syncPush(); }).catch(() => {});
  }
}

function toggleNotify() {
  const s = t();
  if (!NOTIFY_SUPPORTED) return toast(s.notifUnsupported);
  if (Notification.permission === 'denied') return toast(s.notifBlocked);
  state.notify = !state.notify;
  storage.set('laundry.notify', state.notify ? 'on' : 'off');
  toast(state.notify ? s.notifOn : s.notifOff);
  askNotifyPermission();
  render();
  checkReminders();
  syncPush();
}

function checkReminders() {
  clearTimeout(reminderTimer);
  if (!state.me || !state.notify || !NOTIFY_SUPPORTED || Notification.permission !== 'granted') return;
  let sent;
  try { sent = JSON.parse(storage.get('laundry.sent')) || {}; } catch { sent = {}; }
  const now = Date.now();
  let nextAt = Infinity;
  for (const b of state.bookings.filter(x => x.person === state.me && x.end > now - DAY)) {
    for (const kind of dueReminders(b, now, WINDOWS.app)) {
      const msg = reminderMessage(b, kind, now, state.lang);
      if (sent[msg.tag]) continue;
      sent[msg.tag] = now;
      showNotification(msg);
    }
    for (const at of [b.start + WINDOWS.app.start[0] * MIN, b.end + WINDOWS.app.end[0] * MIN]) {
      if (at > now) nextAt = Math.min(nextAt, at);
    }
  }
  for (const k of Object.keys(sent)) if (now - sent[k] > 2 * DAY) delete sent[k];
  storage.set('laundry.sent', JSON.stringify(sent));
  if (nextAt < Infinity) reminderTimer = setTimeout(checkReminders, Math.min(nextAt - now + 500, 2 ** 31 - 1));
}

async function showNotification(msg) {
  const opts = { body: msg.body, tag: msg.tag, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(msg.title, opts);
    else new Notification(msg.title, opts);
  } catch (err) {
    console.error(err);
  }
  toast(msg.body);
}

// Keep this phone's Web Push subscription in Firestore in line with the bell and the chosen name.
async function syncPush() {
  try {
    if (!store || store.mode !== 'cloud' || !('PushManager' in window)) return;
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) return;
    let sub = await reg.pushManager.getSubscription();
    const wanted = state.me && state.notify && NOTIFY_SUPPORTED && Notification.permission === 'granted';
    if (!wanted) {
      if (sub) {
        await store.deletePushSub(await subId(sub.endpoint));
        await sub.unsubscribe();
      }
      storage.set('laundry.pushSig', '');
      return;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(VAPID_PUBLIC_KEY) });
    const { endpoint, keys } = sub.toJSON();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const sig = [state.me, state.lang, tz, endpoint].join('|');
    if (storage.get('laundry.pushSig') === sig) return;
    await store.savePushSub(await subId(endpoint), {
      person: state.me, lang: state.lang, tz, endpoint, p256dh: keys.p256dh, auth: keys.auth, updatedAt: Date.now(),
    });
    storage.set('laundry.pushSig', sig);
  } catch (err) {
    console.error('push subscription failed', err);
  }
}

async function subId(endpoint) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

function b64urlToBytes(b64url) {
  const b64 = (b64url + '='.repeat((4 - (b64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
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
    syncPush();
  } else if (a === 'who') {
    openWho();
  } else if (a === 'notify') {
    toggleNotify();
  } else if (a === 'machine') {
    state.machine = el.dataset.machine;
    storage.set('laundry.machine', state.machine);
    state.scrollTimeline = true;
    render();
  } else if (a === 'day') {
    state.day = Number(el.dataset.day);
    state.scrollTimeline = true;
    render();
  } else if (a === 'done') {
    e.stopPropagation();
    if (!confirm(t().markDoneConfirm)) return;
    el.disabled = true;
    store.finish(el.dataset.id, Date.now())
      .then(() => toast(t().freed))
      .catch(err => { console.error(err); el.disabled = false; toast(t().error); });
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
    askNotifyPermission();
    render();
    checkReminders();
    syncPush();
  }
});
sheet().addEventListener('close', () => { refreshSheet = null; sheet().onclick = null; });

// keep "minutes left" fresh
setInterval(() => { render(); checkReminders(); }, 20_000);
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
    checkReminders();
  },
  () => toast(t().error),
);
state.mode = store.mode;
render();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').then(() => syncPush()).catch(() => {});
}
