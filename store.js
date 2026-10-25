import { FIREBASE_CONFIG } from './config.js';

const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
// how far back bookings are loaded (the "best times" map looks at the last 4 weeks)
const HISTORY = 29 * 864e5;

// A store exposes: mode, add(booking), finish(id, end), remove(id).
// onChange(list) is called with every booking whenever anything changes.
export async function createStore(onChange, onError) {
  if (FIREBASE_CONFIG && FIREBASE_CONFIG.projectId) {
    try {
      return await firebaseStore(onChange, onError);
    } catch (err) {
      console.error('Firebase unavailable, falling back to local mode', err);
      onError?.(err);
    }
  }
  return localStore(onChange);
}

async function firebaseStore(onChange, onError) {
  const { initializeApp } = await import(FIREBASE_SDK + 'firebase-app.js');
  const fs = await import(FIREBASE_SDK + 'firebase-firestore.js');
  const app = initializeApp(FIREBASE_CONFIG);
  let db;
  try {
    db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache() });
  } catch {
    db = fs.getFirestore(app);
  }
  const col = fs.collection(db, 'bookings');
  const recent = fs.query(col, fs.where('end', '>=', Date.now() - HISTORY));
  fs.onSnapshot(
    recent,
    snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => { console.error(err); onError?.(err); },
  );
  return {
    mode: 'cloud',
    add: b => fs.addDoc(col, { ...b, createdAt: Date.now() }),
    // `done` stops the "finished" reminder; older rules only accept `end`, so fall back to that
    finish: (id, end) => fs.updateDoc(fs.doc(db, 'bookings', id), { end, done: true })
      .catch(() => fs.updateDoc(fs.doc(db, 'bookings', id), { end })),
    remove: id => fs.deleteDoc(fs.doc(db, 'bookings', id)),
    // edit = delete + create in one atomic batch (the rules only allow shortening `end` in place)
    replace: (id, b) => {
      const batch = fs.writeBatch(db);
      batch.delete(fs.doc(db, 'bookings', id));
      batch.set(fs.doc(col), { ...b, createdAt: Date.now() });
      return batch.commit();
    },
    savePushSub: (id, data) => fs.setDoc(fs.doc(db, 'pushSubs', id), data),
    deletePushSub: id => fs.deleteDoc(fs.doc(db, 'pushSubs', id)),
    // who has a phone registered for notifications (a Set of names)
    watchSubscribers: cb => fs.onSnapshot(fs.collection(db, 'pushSubs'),
      snap => cb(new Set(snap.docs.map(d => d.data().person))), err => console.error(err)),
    // profile pictures / emojis, keyed by name
    watchProfiles: cb => fs.onSnapshot(fs.collection(db, 'profiles'),
      snap => cb(Object.fromEntries(snap.docs.map(d => [d.id, d.data()]))), err => console.error(err)),
    saveProfile: (person, data) => fs.setDoc(fs.doc(db, 'profiles', person), { ...data, updatedAt: Date.now() }),
    deleteProfile: person => fs.deleteDoc(fs.doc(db, 'profiles', person)),
    // "please take your laundry out" — sent as a push by push/send.mjs; false if already asked
    nudge: async (id, data) => {
      const ref = fs.doc(db, 'nudges', id);
      if ((await fs.getDoc(ref)).exists()) return false;
      await fs.setDoc(ref, data);
      return true;
    },
  };
}

function localStore(onChange) {
  const KEY = 'laundry.bookings.v1';
  let memory = [];
  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return memory; }
  };
  const write = list => {
    memory = list;
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private mode */ }
    onChange(list);
  };
  addEventListener('storage', e => { if (e.key === KEY) onChange(read()); });
  queueMicrotask(() => onChange(read().filter(b => b.end >= Date.now() - HISTORY)));
  const PROFILES = 'laundry.profiles.v1';
  let profileCb = () => {};
  const readProfiles = () => { try { return JSON.parse(localStorage.getItem(PROFILES)) || {}; } catch { return {}; } };
  const writeProfiles = all => {
    try { localStorage.setItem(PROFILES, JSON.stringify(all)); } catch { /* private mode */ }
    profileCb(all);
  };
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
  return {
    mode: 'local',
    add: async b => write([...read(), { ...b, id: newId(), createdAt: Date.now() }]),
    finish: async (id, end) => write(read().map(b => (b.id === id ? { ...b, end, done: true } : b))),
    remove: async id => write(read().filter(b => b.id !== id)),
    replace: async (id, b) => write([...read().filter(x => x.id !== id), { ...b, id: newId(), createdAt: Date.now() }]),
    savePushSub: async () => {},
    deletePushSub: async () => {},
    watchSubscribers: cb => cb(new Set()),
    watchProfiles: cb => { profileCb = cb; cb(readProfiles()); },
    saveProfile: async (person, data) => writeProfiles({ ...readProfiles(), [person]: data }),
    deleteProfile: async person => { const all = readProfiles(); delete all[person]; writeProfiles(all); },
    nudge: async () => true,
  };
}
