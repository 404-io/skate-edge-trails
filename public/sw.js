self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== "skate-edge-trails-v2").map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  )
);

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  // HTML を先にキャッシュすると、更新後の index.html と古い JavaScript の
  // 組み合わせで白画面になる。画面遷移は常にネットワークを優先する。
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open("skate-edge-trails-v2").then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
    )
  );
});
