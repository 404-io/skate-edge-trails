self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached || fetch(event.request).then((response) => {
        if (new URL(event.request.url).origin === self.location.origin) {
          const copy = response.clone();
          caches.open("skate-edge-trails-v1").then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
    )
  );
});

