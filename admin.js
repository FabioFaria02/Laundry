// God mode is unlocked with a PIN. The PIN is not in the code: only a salted PBKDF2 hash of it.
// This is a soft lock — it hides the admin tools from housemates. The database itself has no
// accounts, so it cannot stop someone who talks to Firestore directly.
const SALT = 'f09aafe7386238ab2a6f5d397d703480';
const HASH = '125c2cffc8a313eef9d10074cc5a151d8da61f6dba7b050e8ddc854cf170cc87';
const ITERATIONS = 250_000;

export const UNLOCK_MS = 8 * 3600e3; // how long God mode stays on after unlocking
export const MAX_TRIES = 5;          // wrong PINs before a short lock-out
export const LOCK_MS = 60_000;

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const bytes = h => Uint8Array.from(h.match(/../g), x => parseInt(x, 16));

export async function checkPin(pin) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: bytes(SALT), iterations: ITERATIONS }, key, 256);
  return hex(bits) === HASH;
}
