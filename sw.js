// Balloon Code — minimal service worker, present only to satisfy Chrome/Android's PWA
// installability requirement (a registered service worker with a fetch handler is required
// before the browser will offer an "Install app" / "Add to Home Screen" prompt). Deliberately
// does NOT cache or serve anything itself — this app is one continuously-evolving HTML file
// backed by live Firestore data, and any offline-cache strategy here would risk serving a stale
// build or stale data. Every request passes straight through to the network exactly as if this
// file didn't exist at all — see the empty fetch handler below (no respondWith() call means the
// browser's normal network handling applies unchanged).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
