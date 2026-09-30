const CACHE = "lingoswap-v2";
const APP_SHELL = ["/", "/manifest.webmanifest", "/lingoswap-icon.svg"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith("lingoswap-") && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== "GET" || requestUrl.origin !== self.location.origin || requestUrl.pathname.startsWith("/api/")) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      const cacheControl = response.headers.get("Cache-Control") || "";
      if (response.ok && response.type === "basic" && !/no-store|private/i.test(cacheControl)) {
        const cache = await caches.open(CACHE);
        event.waitUntil(cache.put(event.request, response.clone()));
      }
      return response;
    } catch {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      if (event.request.mode === "navigate") {
        const shell = await caches.match("/");
        if (shell) return shell;
      }
      return new Response("Offline", { status: 503, statusText: "Offline" });
    }
  })());
});
