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
const DURATIONS = [30, 45, 60, 90, 120, 180, 240];
const MAX_MIN = 240; // longest booking the landlady allows (4 h)
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
  help: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6M12 17h.01"/></svg>',
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
// Wall-clock helpers: days are not always 24 h long (daylight saving changes), so
// positions and times inside a day come from the local clock, not from ms offsets.
const atTime = (day, minutes) => { const d = new Date(day); d.setHours(0, minutes, 0, 0); return d.getTime(); };
const yOf = (ms, day) => {
  if (ms <= day) return 0;
  if (ms >= addDays(day, 1)) return 24 * HOUR_PX;
  const d = new Date(ms);
  return (d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600) * HOUR_PX;
};
const dateValue = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const minutesUntil = ms => Math.max(1, Math.ceil((ms - Date.now()) / MIN));
const hue = name => [...name].reduce((h, c) => (h * 31 + c.codePointAt(0)) % 360, 7);
const fmtDur = d => (d < 60 ? `${d} min` : `${Math.floor(d / 60)} h${d % 60 ? ` ${pad(d % 60)}` : ''}`);
const machineName = m => (m === 'washer' ? t().washer : t().dryer);
// A person is identified by the name in PEOPLE (bookings, reminders and profiles use it);
// the name they pick for themselves only changes how it is shown.
const displayName = person => state.profiles[person]?.name || person;
const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const avatar = (name, cls = '') => {
  const p = state.profiles[name] || {};
  if (p.photo && PHOTO_RE.test(p.photo)) return `<span class="avatar photo ${cls}" style="background-image:url('${p.photo}')"></span>`;
  if (p.emoji) return `<span class="avatar emoji ${cls}" style="--h:${hue(name)}">${esc(p.emoji)}</span>`;
  return `<span class="avatar ${cls}" style="--h:${hue(name)}">${esc([...displayName(name)][0] || '?')}</span>`;
};

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
  profiles: {},
  subscribers: new Set(),
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
        <p class="muted">${state.me ? esc(s.hi(displayName(state.me))) : ''}</p>
      </div>
      <div class="topbar-actions">
        <button class="chip icon-chip" data-action="help" aria-label="${s.help}">${ICONS.help}</button>
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

    ${bestHoursSection()}

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
    const focus = isToday ? Date.now() : firstBooking ? firstBooking.start : atTime(state.day, 9 * 60);
    tl.scrollTop = Math.max(0, yOf(focus, state.day) - 1.5 * HOUR_PX);
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
      <div class="who">${avatar(cur.person, 'sm')}<span>${esc(displayName(cur.person))}${cur.person === state.me ? ` (${s.you})` : ''}</span></div>
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
    ? `<div class="next muted">${s.next}: ${esc(displayName(next.person))} · ${startOfDay(next.start) === startOfDay(Date.now()) ? hhmm(next.start) : `${esc(dayLabel(next.start))} ${hhmm(next.start)}`}</div>`
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

// "Best times": how busy each weekday / 2-hour slot was over the last 4 weeks
const SLOT_HOURS = [6, 8, 10, 12, 14, 16, 18, 20, 22];

function busyMap(machine) {
  const now = Date.now();
  const since = startOfDay(now - 28 * DAY);
  const past = state.bookings.filter(b => b.machine === machine && b.start < now && b.end > since);
  if (past.length < 5) return null;
  const grid = Array.from({ length: 7 }, () => SLOT_HOURS.map(() => 0));
  for (const b of past) {
    for (let at = Math.max(b.start, since); at < Math.min(b.end, now); at += 15 * MIN) {
      const d = new Date(at);
      const h = d.getHours();
      if (h < SLOT_HOURS[0]) continue;
      grid[(d.getDay() + 6) % 7][Math.floor((h - SLOT_HOURS[0]) / 2)] += 15;
    }
  }
  const weeks = Math.min(4, Math.max(1, Math.ceil((now - Math.min(...past.map(b => b.start))) / (7 * DAY))));
  return grid.map(day => day.map(minutes => Math.min(1, minutes / (120 * weeks))));
}

function bestHoursSection() {
  const s = t();
  const map = busyMap(state.machine);
  const monday = addDays(startOfDay(Date.now()), -((new Date().getDay() + 6) % 7));
  const dayName = (i, style) => new Date(addDays(monday, i)).toLocaleDateString(s.locale, { weekday: style }).replace('.', '');
  const level = v => (v < 0.05 ? 0 : v < 0.25 ? 1 : v < 0.5 ? 2 : v < 0.75 ? 3 : 4);
  let body = `<p class="muted tiny">${s.notEnough}</p>`;
  if (map) {
    // quietest slot between 08:00 and 22:00
    let best = null;
    map.forEach((day, d) => day.forEach((v, i) => {
      if (SLOT_HOURS[i] >= 8 && SLOT_HOURS[i] < 22 && (!best || v < best.v)) best = { v, d, i };
    }));
    const range = `${pad(SLOT_HOURS[best.i])}–${pad(SLOT_HOURS[best.i] + 2)}h`;
    body = `
      <div class="heat">
        <span></span>${map.map((_, d) => `<span class="heat-day">${esc(dayName(d, 'narrow'))}</span>`).join('')}
        ${SLOT_HOURS.map((h, i) => `<span class="heat-hour">${pad(h)}h</span>${map.map(day => `<i class="l${level(day[i])}"></i>`).join('')}`).join('')}
      </div>
      <div class="heat-legend"><span class="muted">${s.quiet}</span>${[0, 1, 2, 3, 4].map(l => `<i class="l${l}"></i>`).join('')}<span class="muted">${s.full}</span></div>
      <p class="heat-tip">${esc(s.bestTip(dayName(best.d, 'long'), range))}</p>`;
  }
  return `
    <section class="card">
      <h2>${s.bestHours}</h2>
      <p class="muted tiny heat-sub">${esc(s.lastWeeks(machineName(state.machine)))}</p>
      ${body}
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
          <span class="row-title">${showPerson ? esc(displayName(b.person)) : (b.machine === 'washer' ? s.washer : s.dryer)}
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
  const dayBookings = forMachine(state.machine).filter(b => b.end > dayStart && b.start < dayEnd);
  const blocks = dayBookings
    .map(b => {
      const top = yOf(b.start, dayStart);
      const height = Math.max(22, yOf(b.end, dayStart) - top - 2);
      const mine = b.person === state.me;
      const past = b.end <= Date.now();
      // bookings that overlap (a machine ran longer than planned) are shown side by side
      const group = dayBookings.filter(x => overlaps(x, b));
      const cols = group.length;
      const col = group.indexOf(b);
      const side = cols > 1 ? `left:calc(62px + (100% - 70px) * ${col} / ${cols});right:auto;width:calc((100% - 70px) / ${cols} - 4px);` : '';
      return `
        <button class="block ${mine ? 'mine' : ''} ${past ? 'past' : ''}" style="top:${top}px;height:${height}px;${side}--h:${hue(b.person)}"
          data-action="detail" data-id="${esc(b.id)}">
          <b>${esc(displayName(b.person))}${mine ? ` (${s.you})` : ''}</b>
          <span>${hhmm(b.start)}–${hhmm(b.end)}</span>
        </button>`;
    }).join('');
  const now = Date.now();
  const nowLine = now >= dayStart && now < dayEnd
    ? `<div class="now-line" style="top:${yOf(now, dayStart)}px"><span>${hhmm(now)}</span></div>`
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

const NAME_MAX = 20;
const EMOJIS = ['🧺', '👕', '🧦', '🫧', '🌸', '🌻', '🍀', '🌈', '⭐', '🔥', '⚡', '🌙', '☀️', '🌊', '🐱', '🐶',
  '🦊', '🐼', '🐸', '🦄', '🐝', '🦋', '🐙', '🐢', '🍕', '🍓', '🥑', '🍩', '🍉', '☕', '🎧', '🎮',
  '⚽', '🏀', '🎸', '📚', '✈️', '🚲', '💎', '👑', '😎', '🤓', '😺', '👻', '🤖', '💀', '🧚', '🦖'];

function openWho() {
  const s = t();
  let mode = 'list'; // 'list' | 'emoji' | 'name'
  const draw = () => {
    const mine = state.me && state.profiles[state.me];
    const profile = state.me ? `
      <div class="profile-row">
        ${avatar(state.me, 'lg')}
        <div class="profile-main">
          <b class="profile-name">${esc(displayName(state.me))}
            <button type="button" class="edit-name" data-action="p-name" aria-label="${s.changeName}">✏️</button></b>
          <div class="profile-actions">
            <button type="button" class="chip" data-action="p-photo">📷 ${s.photo}</button>
            <button type="button" class="chip" data-action="p-emoji">😀 ${s.emoji}</button>
            ${mine && (mine.photo || mine.emoji) ? `<button type="button" class="chip" data-action="p-remove">${s.removeAvatar}</button>` : ''}
          </div>
        </div>
        <input type="file" accept="image/*" data-field="photo" hidden>
      </div>` : '';
    if (mode === 'name') {
      openSheet(`
        <h2>${s.changeName}</h2>
        <div class="profile-row">${avatar(state.me, 'lg')}
          <input type="text" class="name-input" data-field="name" maxlength="${NAME_MAX}" value="${esc(displayName(state.me))}"
            placeholder="${esc(state.me)}" autocomplete="off" autocapitalize="words"></div>
        <p class="muted tiny name-hint">${s.nameHint}</p>
        <div class="sheet-actions">
          <button type="button" class="btn ghost" data-action="p-back">${s.back}</button>
          <button type="button" class="btn" data-action="p-name-save">${s.saveChanges}</button>
        </div>
        ${state.profiles[state.me]?.name ? `<div class="sheet-actions stack"><button type="button" class="btn ghost" data-action="p-name-reset">${esc(s.resetName(state.me))}</button></div>` : ''}`);
      const input = sheet().querySelector('[data-field="name"]');
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    } else if (mode === 'emoji') {
      openSheet(`
        <h2>${s.pickEmoji}</h2>
        <div class="emoji-grid">${EMOJIS.map(e => `<button type="button" data-action="p-set-emoji" data-value="${e}">${e}</button>`).join('')}</div>
        <label class="emoji-input"><span class="muted tiny">${s.typeEmoji}</span>
          <input type="text" data-field="emoji" maxlength="8" placeholder="🙂" autocomplete="off"></label>
        <div class="sheet-actions">
          <button type="button" class="btn ghost" data-action="p-back">${s.back}</button>
          <button type="button" class="btn" data-action="p-typed">${s.saveChanges}</button>
        </div>`, draw);
    } else {
      openSheet(`
        ${state.me ? `<div class="field-label first">${s.myProfile}</div>${profile}` : ''}
        <h2 class="${state.me ? 'who-title' : ''}">${s.whoAreYou}</h2>
        <p class="muted">${s.whoHint}</p>
        <div class="people">
          ${PEOPLE.map(p => `
            <button class="person ${p === state.me ? 'active' : ''}" data-action="pick" data-person="${esc(p)}">
              <span class="av-wrap">${avatar(p)}${state.subscribers.has(p)
                ? `<i class="bell-badge" title="${esc(displayName(p))} ${s.hasNotif}">${ICONS.bell}</i>` : ''}</span>
              <span>${esc(displayName(p))}</span>
            </button>`).join('')}
        </div>`, draw);
    }

    const file = sheet().querySelector('[data-field="photo"]');
    if (file) {
      file.onchange = async () => {
        const f = file.files?.[0];
        if (!f) return;
        try {
          await updateProfile(state.me, { photo: await photoToDataUrl(f) });
          toast(s.saved);
        } catch (err) {
          console.error(err);
          toast(s.photoError);
        }
      };
    }
    sheet().onclick = async e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const a = btn.dataset.action;
      if (a === 'p-photo') return file?.click();
      if (a === 'p-emoji') { mode = 'emoji'; return draw(); }
      if (a === 'p-back') { mode = 'list'; return draw(); }
      if (a === 'p-name') { mode = 'name'; return draw(); }
      if (a === 'p-name-reset' || a === 'p-name-save') {
        const typed = a === 'p-name-reset' ? '' : sheet().querySelector('[data-field="name"]').value.replace(/\s+/g, ' ').trim();
        const name = typed === state.me ? '' : typed;
        if (name && PEOPLE.some(p => p !== state.me && displayName(p).toLowerCase() === name.toLowerCase())) {
          return toast(s.nameTaken(name));
        }
        try {
          await updateProfile(state.me, { name: name || null });
          mode = 'list';
          toast(s.saved);
          draw();
        } catch (err) {
          console.error(err);
          toast(s.error);
        }
        return;
      }
      let emoji = null;
      if (a === 'p-set-emoji') emoji = btn.dataset.value;
      if (a === 'p-typed') emoji = sheet().querySelector('[data-field="emoji"]').value.trim();
      try {
        if (a === 'p-remove') { await updateProfile(state.me, { photo: null, emoji: null }); toast(s.saved); }
        if (emoji) {
          mode = 'list';
          await updateProfile(state.me, { emoji: [...emoji].slice(0, 4).join('') });
          toast(s.saved);
          draw();
        }
      } catch (err) {
        console.error(err);
        toast(s.error);
      }
    };
  };
  draw();
}

// Saves the profile of `person`: `changes` are merged into what is stored; a photo replaces an
// emoji and vice versa, and empty values are dropped (an empty profile is deleted).
async function updateProfile(person, changes) {
  const next = { ...(state.profiles[person] || {}), ...changes };
  delete next.updatedAt;
  if (changes.photo) delete next.emoji;
  if (changes.emoji) delete next.photo;
  for (const k of Object.keys(next)) if (!next[k]) delete next[k];
  if (Object.keys(next).length) await store.saveProfile(person, next);
  else await store.deleteProfile(person);
}

// Square-crop and shrink a gallery photo to a small JPEG, so it fits in the shared database.
async function photoToDataUrl(file) {
  const img = await createImageBitmap(file);
  const side = Math.min(img.width, img.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 160;
  canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 160, 160);
  const url = canvas.toDataURL('image/jpeg', 0.82);
  if (!PHOTO_RE.test(url)) throw new Error('unsupported image');
  return url;
}

const clampDuration = d => Math.min(MAX_MIN, Math.max(5, Math.round(d)));

// If `slot` only collides with bookings that start after it, how long can it be to end
// exactly when the first of them starts?
function fitBefore(machine, slot, ignoreId) {
  const hits = conflictsFor(machine, slot, ignoreId);
  if (!hits.length || hits.some(c => c.start <= slot.start)) return null;
  const until = Math.min(...hits.map(c => c.start));
  const minutes = Math.floor((until - slot.start) / MIN);
  return minutes >= 5 ? { until, minutes } : null;
}

function openBook({ machine = state.machine, start = null, edit = null } = {}) {
  if (!state.me) return openWho();
  const s = t();
  const form = edit
    ? { machine: edit.machine, start: edit.start, duration: Math.round((edit.end - edit.start) / MIN), dryerAfter: 0 }
    : {
      machine,
      start: start ?? nextFreeStart(machine, state.day === startOfDay(Date.now()) ? roundUp(Date.now()) : atTime(state.day, 9 * 60), state.duration),
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
      problems.push(`${s.conflict} ${esc(displayName(c.person))} (${hhmm(c.start)}–${hhmm(c.end)})`);
    }
    if (dryerSlot) {
      for (const c of conflictsFor('dryer', dryerSlot)) {
        problems.push(`${s.dryer}: ${s.conflict} ${esc(displayName(c.person))} (${hhmm(c.start)}–${hhmm(c.end)})`);
      }
    }
    // when only the end runs into the next booking, offer to stop right where it starts
    const fits = [
      ['f-fit', fitBefore(form.machine, main, edit?.id)],
      ['f-fit-dryer', dryerSlot && fitBefore('dryer', dryerSlot)],
    ].filter(([, f]) => f);
    const durations = [...new Set([...DURATIONS, ...(form.custom ? [] : [form.duration])])].sort((x, y) => x - y);
    const chips = (list, value, action) =>
      list.map(d => `<button type="button" class="chip ${d === value && !(action === 'f-duration' && form.custom) ? 'active' : ''}" data-action="${action}" data-value="${d}">${d ? fmtDur(d) : s.no}</button>`).join('');

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
      <div class="chips">${chips(durations, form.duration, 'f-duration')}
        <button type="button" class="chip ${form.custom ? 'active' : ''}" data-action="f-custom">${s.custom}</button></div>
      ${form.custom ? `
        <div class="stepper custom-duration">
          <button type="button" class="chip" data-action="f-step" data-value="-5">−5</button>
          <input type="number" inputmode="numeric" min="5" max="${MAX_MIN}" data-field="duration" value="${form.duration}">
          <span class="unit">min</span>
          <button type="button" class="chip" data-action="f-step" data-value="5">+5</button>
        </div>` : ''}
      ${form.machine === 'washer' && !edit ? `
        <div class="field-label">${s.dryerAfter}</div>
        <div class="chips">${chips([...new Set([0, 60, 90, 120, 180, 240, form.dryerAfter])].sort((x, y) => x - y), form.dryerAfter, 'f-dryer')}</div>` : ''}
      <div class="summary">
        ${avatar(state.me, 'sm')}
        <div>
          <b>${esc(dayLabel(form.start))} · ${hhmm(form.start)}–${hhmm(end)}</b>
          <div class="muted tiny">${machineName(form.machine)}${dryerSlot ? ` + ${s.dryer} ${hhmm(dryerSlot.start)}–${hhmm(dryerSlot.end)}` : ''}</div>
        </div>
      </div>
      ${problems.length ? `<div class="problems">${problems.map(p => `<div>${ICONS.alert}<span>${p}</span></div>`).join('')}</div>` : ''}
      ${fits.map(([action, f]) => `
        <button type="button" class="btn fit" data-action="${action}" data-value="${f.minutes}">
          ${esc((action === 'f-fit-dryer' ? `${s.dryer}: ` : '') + s.fitUntil(hhmm(f.until), fmtDur(f.minutes)))}
        </button>`).join('')}
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
    const durInput = el.querySelector('[data-field="duration"]');
    if (durInput) {
      durInput.oninput = () => { if (Number(durInput.value) >= 1) form.duration = clampDuration(Number(durInput.value)); };
      // deferred: the change can fire on blur while the sheet is being redrawn
      durInput.onchange = () => setTimeout(draw);
    }
    el.onclick = async e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const a = btn.dataset.action;
      if (a === 'f-machine') { form.machine = btn.dataset.value; if (form.machine === 'dryer') form.dryerAfter = 0; draw(); }
      if (a === 'f-duration') { form.duration = Math.min(MAX_MIN, Number(btn.dataset.value)); form.custom = false; draw(); }
      if (a === 'f-custom') { form.custom = !form.custom; draw(); }
      if (a === 'f-step') { form.duration = clampDuration(form.duration + Number(btn.dataset.value)); draw(); }
      if (a === 'f-fit') { form.duration = Number(btn.dataset.value); draw(); }
      if (a === 'f-dryer' || a === 'f-fit-dryer') { form.dryerAfter = Number(btn.dataset.value); draw(); }
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
  const start = Math.max(Math.min(b.start, Math.floor(now / MIN) * MIN), end - MAX_MIN * MIN);
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
    // someone else's finished booking: ask them (by push) to take their laundry out
    const canNudge = state.me && !mine && done && now - b.end < 12 * 3600e3 && state.subscribers.has(b.person);
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
        ${hits.length ? `<div class="problems warn">${hits.map(c => `<div>${ICONS.alert}<span>${s.conflict} ${esc(displayName(c.person))} (${hhmm(c.start)}–${hhmm(c.end)}) — ${s.tellThem}</span></div>`).join('')}</div>` : ''}
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
          ${canNudge ? `<button type="button" class="btn" data-action="nudge">${esc(s.nudge(displayName(b.person)))}</button>` : ''}
          <button type="button" class="btn ghost" data-action="close">${s.close}</button>
        </div>`;
    }

    openSheet(`
      <div class="detail-head">
        ${avatar(b.person, 'lg')}
        <div>
          <h2>${esc(displayName(b.person))}${mine ? ` <span class="muted">(${s.you})</span>` : ''}</h2>
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
      input.onchange = () => setTimeout(draw);
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
      if (a === 'nudge') {
        btn.disabled = true;
        try {
          const ok = await store.nudge(`${b.id}_${state.me}`.replace(/[^\w-]/g, '_'), {
            to: b.person, from: displayName(state.me), machine: b.machine, bookingId: b.id, at: Date.now(),
          });
          toast(ok ? s.nudgeSent(displayName(b.person)) : s.nudgeAlready);
          if (ok) closeSheet();
        } catch (err) {
          console.error(err);
          toast(s.error);
        }
        btn.disabled = false;
        return;
      }
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

// ---------- help: install + notifications ----------
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let installPrompt = null; // Android/Chrome: the browser's own install popup, saved for the Help button
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; refreshSheet?.(); });
addEventListener('appinstalled', () => { installPrompt = null; refreshSheet?.(); });

function openHelp() {
  const s = t();
  const draw = () => {
    const steps = list => `<ol class="steps">${list.map(x => `<li>${x}</li>`).join('')}</ol>`;
    const install = isStandalone()
      ? `<p class="ok-line">${s.installed}</p>`
      : `
        <p class="muted tiny">${s.installWhy}</p>
        ${installPrompt ? `<button type="button" class="btn wide" data-action="h-install">📲 ${s.installBtn}</button>` : ''}
        <details class="how" ${IS_IOS ? 'open' : ''}><summary>📱 ${s.forIphone}</summary>${steps(s.iosSteps)}<p class="muted tiny">${s.iosNoPopup}</p></details>
        <details class="how" ${!IS_IOS && !installPrompt ? 'open' : ''}><summary>🤖 ${s.forAndroid}</summary>${steps(s.androidSteps)}</details>`;

    const perm = NOTIFY_SUPPORTED ? Notification.permission : 'unsupported';
    const status = perm === 'unsupported' ? (IS_IOS && !isStandalone() ? s.notifStatus.needsInstall : s.notifStatus.unsupported)
      : perm === 'denied' ? s.notifStatus.blocked
        : state.notify && perm === 'granted' && state.me ? s.notifStatus.on(displayName(state.me))
          : s.notifStatus.off;
    const on = state.notify && perm === 'granted';
    const notif = `
      <p class="status-line ${on ? 'ok-line' : ''}">${esc(status)}</p>
      ${perm !== 'unsupported' && perm !== 'denied' && !on ? `<button type="button" class="btn wide" data-action="h-notify">🔔 ${s.notifEnable}</button>` : ''}
      ${perm === 'denied' ? `<p class="muted tiny">${IS_IOS ? s.blockedIos : s.blockedAndroid}</p>` : ''}
      <p class="muted tiny">${s.notifWhat}</p>`;

    openSheet(`
      <h2>${s.help}</h2>
      <section class="help-block"><h3>📲 ${s.installTitle}</h3>${install}</section>
      <section class="help-block"><h3>🔔 ${s.notifLabel}</h3>${notif}</section>
      <div class="sheet-actions stack"><button type="button" class="btn ghost" data-action="close">${s.close}</button></div>`, draw);

    sheet().onclick = async e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const a = btn.dataset.action;
      if (a === 'close') closeSheet();
      if (a === 'h-notify') { enableNotify(); draw(); }
      if (a === 'h-install' && installPrompt) {
        installPrompt.prompt();
        await installPrompt.userChoice.catch(() => {});
        installPrompt = null;
        draw();
      }
    };
  };
  draw();
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
    Notification.requestPermission().then(() => { render(); refreshSheet?.(); checkReminders(); syncPush(); }).catch(() => {});
  }
}

function enableNotify() {
  const s = t();
  if (!NOTIFY_SUPPORTED) return toast(s.notifUnsupported);
  if (Notification.permission === 'denied') return toast(s.notifBlocked);
  state.notify = true;
  storage.set('laundry.notify', 'on');
  askNotifyPermission();
  render();
  checkReminders();
  syncPush();
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
  } else if (a === 'help') {
    openHelp();
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
    let start = atTime(state.day, minutes);
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
store.watchProfiles(profiles => { state.profiles = profiles; render(); refreshSheet?.(); });
store.watchSubscribers(names => { state.subscribers = names; render(); refreshSheet?.(); });
render();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').then(() => syncPush()).catch(() => {});
}
