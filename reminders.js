// Booking reminders, shared by the app (local notifications while it is open)
// and push/send.mjs (Web Push from GitHub Actions while the app is closed).
import { STRINGS } from './i18n.js';

const MIN = 60_000;

// When a reminder may be shown, in minutes around the booking's start / end.
// The server is triggered every minute by cron-job.org (GitHub's own 5-minute schedule
// is only a late fallback), so it uses nearly the same window as the app.
export const WINDOWS = {
  app: { start: [-10, 10], end: [-5, 20] },
  server: { start: [-11, 10], end: [-6, 20] },
};

export const reminderKey = (b, kind) => `${b.id}_${kind}_${kind === 'start' ? b.start : b.end}`;

// Reminders for booking `b` that are due at `now`.
export function dueReminders(b, now, windows) {
  if (b.done) return [];
  return ['start', 'end'].filter(kind => {
    const at = kind === 'start' ? b.start : b.end;
    const [from, to] = windows[kind];
    // a booking made right before its start (e.g. "Use now") needs no "starts soon"
    if (b.createdAt && b.createdAt > at + from * MIN) return false;
    return now >= at + from * MIN && now < at + to * MIN;
  });
}

export function reminderMessage(b, kind, now, lang = 'en', timeZone) {
  const s = STRINGS[lang] || STRINGS.en;
  const machine = b.machine === 'washer' ? s.washer : s.dryer;
  const at = kind === 'start' ? b.start : b.end;
  const time = new Date(at).toLocaleTimeString(s.locale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone });
  const n = Math.max(1, Math.round((at - now) / MIN));
  const body = kind === 'start'
    ? (at > now ? s.remStart(machine, time, n) : s.remStarted(machine, time))
    : (at > now ? s.remEnd(machine, time, n) : s.remEnded(machine, time));
  return { title: s.title, body, tag: reminderKey(b, kind) };
}
