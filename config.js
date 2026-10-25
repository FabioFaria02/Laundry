// Firebase web app config — bookings are shared between everyone through Firestore.
// These keys are public by design; access is controlled by firestore.rules.
// Set to null to run in demo mode (bookings saved only on this device).
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCWNT9RJG-xyPqC6oMRVXgKp1ADHaANhEw",
  authDomain: "laundry-34f67.firebaseapp.com",
  projectId: "laundry-34f67",
  storageBucket: "laundry-34f67.firebasestorage.app",
  messagingSenderId: "112557852811",
  appId: "1:112557852811:web:d6733f5729ebaf74606c8e",
};

// Public half of the Web Push (VAPID) key pair. The private half is the
// VAPID_PRIVATE_KEY secret of the GitHub repository (used by push/send.mjs).
export const VAPID_PUBLIC_KEY = "BAGcyqqCKIygY0xFzX11bFIx6C1NiRbw5aN0ighoEi3KkmsxuACe5iq-BjVlcUvBe4gzw1fEK8bZQdPejers3Mc";
