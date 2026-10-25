// Sends booking reminders as Web Push notifications to the phones of the person who booked.
// Run by .github/workflows/reminders.yml every 5 minutes.
//   VAPID_PRIVATE_KEY  (required unless DRY_RUN=1) — GitHub secret
//   DRY_RUN=1          print what would be sent, without sending or writing anything
import webpush from 'web-push';
import { FIREBASE_CONFIG, VAPID_PUBLIC_KEY } from '../config.js';
import { WINDOWS, dueReminders, reminderMessage, reminderKey, nudgeMessage } from '../reminders.js';

const DRY_RUN = process.env.DRY_RUN === '1';
const KEY = `key=${FIREBASE_CONFIG.apiKey}`;
const BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;
const HOUR = 3600e3;

const fromFs = fields => Object.fromEntries(Object.entries(fields || {}).map(([k, v]) => [k,
  'integerValue' in v ? Number(v.integerValue)
    : 'doubleValue' in v ? v.doubleValue
      : 'booleanValue' in v ? v.booleanValue
        : v.stringValue ?? null]));
const docId = name => name.split('/').pop();

async function api(path, init) {
  const res = await fetch(`${BASE}${path}${path.includes('?') ? '&' : '?'}${KEY}`, {
    ...init, headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok && res.status !== 409) throw new Error(`${init?.method || 'GET'} ${path}: ${res.status} ${await res.text()}`);
  return res;
}

async function activeBookings(now) {
  const res = await api(':runQuery', {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'bookings' }],
        where: { fieldFilter: { field: { fieldPath: 'end' }, op: 'GREATER_THAN_OR_EQUAL', value: { integerValue: String(now - HOUR) } } },
      },
    }),
  });
  return (await res.json()).filter(r => r.document).map(r => ({ id: docId(r.document.name), ...fromFs(r.document.fields) }));
}

async function recentNudges(now) {
  const res = await api(':runQuery', {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'nudges' }],
        where: { fieldFilter: { field: { fieldPath: 'at' }, op: 'GREATER_THAN_OR_EQUAL', value: { integerValue: String(now - 30 * 60e3) } } },
      },
    }),
  });
  return (await res.json()).filter(r => r.document).map(r => ({ id: docId(r.document.name), ...fromFs(r.document.fields) }));
}

async function subscriptions() {
  const res = await api('/pushSubs?pageSize=300');
  return ((await res.json()).documents || []).map(d => ({ id: docId(d.name), ...fromFs(d.fields) }));
}

// Claims the reminder so it is sent once, even if two runs overlap.
async function claim(key, now) {
  const res = await api(`/sent?documentId=${encodeURIComponent(key)}`, {
    method: 'POST', body: JSON.stringify({ fields: { at: { integerValue: String(now) } } }),
  });
  return res.status !== 409;
}

// Not set up yet: finish quietly instead of failing (and e-mailing) every 5 minutes.
if (!DRY_RUN && !process.env.VAPID_PRIVATE_KEY) {
  console.log('VAPID_PRIVATE_KEY secret is not set yet — nothing to do (see README, section 4).');
  process.exit(0);
}
const now = Date.now();
const subs = await subscriptions().catch(err => {
  console.log('Cannot read pushSubs — publish the updated firestore.rules (README, section 4).', err.message);
  process.exit(0);
});
const bookings = await activeBookings(now);
// older rules don't allow reading nudges yet — reminders still work without them
const nudges = await recentNudges(now).catch(() => []);
console.log(`${bookings.length} active bookings, ${subs.length} subscribed phones`);

if (!DRY_RUN) {
  webpush.setVapidDetails('https://fabiofaria02.github.io/Laundry/', VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
}

let sent = 0;
async function push(p, msg) {
  try {
    await webpush.sendNotification(
      { endpoint: p.endpoint, keys: { p256dh: p.p256dh, auth: p.auth } },
      JSON.stringify(msg),
      { TTL: 30 * 60, urgency: 'high' },
    );
    sent++;
    console.log(`sent to ${p.person}: ${msg.body}`);
  } catch (err) {
    console.error(`push to ${p.person} failed: ${err.statusCode} ${err.body || err.message}`);
    // the phone unsubscribed or the app was removed
    if (err.statusCode === 404 || err.statusCode === 410) await api(`/pushSubs/${p.id}`, { method: 'DELETE' });
  }
}

for (const n of nudges) {
  const phones = subs.filter(s => s.person === n.to);
  if (!phones.length) continue;
  if (DRY_RUN) { for (const p of phones) console.log(`[dry run] ${n.to}:`, nudgeMessage(n, p.lang).body); continue; }
  if (!(await claim(`nudge_${n.id}`, now))) continue;
  for (const p of phones) await push(p, nudgeMessage(n, p.lang));
}

for (const b of bookings) {
  const phones = subs.filter(s => s.person === b.person);
  if (!phones.length) continue;
  for (const kind of dueReminders(b, now, WINDOWS.server)) {
    if (DRY_RUN) {
      for (const p of phones) console.log(`[dry run] ${b.person}:`, reminderMessage(b, kind, now, p.lang, p.tz).body);
      continue;
    }
    if (!(await claim(reminderKey(b, kind), now))) continue;
    for (const p of phones) await push(p, reminderMessage(b, kind, now, p.lang, p.tz || 'Europe/Prague'));
  }
}
console.log(`${sent} notifications sent`);
