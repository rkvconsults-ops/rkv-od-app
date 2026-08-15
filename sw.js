/* sw.js — offline shell for field use (Rajasthan, patchy network).
 *
 * Strategy: network-first with cache fallback, for everything. Online, the
 * app always gets the freshest deploy (no stale-code confusion -- today's
 * cache lessons applied); offline, the last-seen copy of the shell loads
 * and the app runs fully on localStorage, with sync queued for reconnect.
 * The cache is refreshed on every successful network response.
 */
const CACHE = "od-app-shell-v2";
const SHELL = [
  "./", "./index.html", "./styles.css", "./app.js", "./store.js",
  "./sync.js", "./engine.js", "./process-def.json", "./documents.json",
  "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Never intercept GitHub API calls -- sync.js owns its own failure
  // handling and queueing; a cached API response would lie to it.
  if (url.hostname === "api.github.com") return;
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })
        .then((hit) => hit || caches.match("./index.html")))
  );
});
