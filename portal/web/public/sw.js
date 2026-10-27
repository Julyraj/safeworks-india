/* SafeWorks field-app service worker: keeps the app shell (HTML, hashed assets, icons, fonts) available offline so the
   PWA opens with no signal. Never cached here: /api/ (signed-in, fresh responses; the outbox in IndexedDB owns retry),
   /files/ (signed photo URLs), /admin (console), /library (its own worker) and /q/ (the public form fetches its own
   data; its assets are still cached below because they live under /assets/). */
const VERSION = "sw-portal-v2";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/favicon-32.png"];
const NEVER = ["/api/", "/files/", "/admin", "/library", "/q/"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("sw-portal-") && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (NEVER.some((p) => url.pathname.startsWith(p))) return;

  // app routes (/, /report, /o/…): network first, fall back to the cached shell
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(VERSION).then((c) => c.put("/", res.clone()));
          return res;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }
  // hashed build assets, icons and fonts: cache first
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
        return res;
      })),
    );
  }
});
