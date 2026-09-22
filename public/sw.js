/*
 * Keeps the game openable with no network.
 *
 * Nothing here is generated: the build writes hashed file names that no list
 * could be kept in step with, so instead of a precache manifest this caches
 * what the game actually asks for, and decides per request whether a copy on
 * the phone is good enough.
 *
 * Two rules do all the work. A file with a hash in its name can never change
 * behind that name, so it is served from the cache and never checked again. The
 * page itself has no hash, so it is fetched from the network when there is one
 * and served from the cache when there is not — which is how a new version gets
 * in at all.
 */
/*
 * Bump this whenever a file that has no hash in its name changes — the page
 * shell, the manifest, an icon. Everything under the old name is thrown away
 * on activation; a hashed asset needs no bump, since its name already changed.
 */
const CACHE = 'node-wars-v9';

/** Everything needed to open the game cold, before a single asset is known. */
const SHELL = ['./', './manifest.webmanifest', './icons/icon-180.png', './icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      // A missing file must not leave the old worker in charge for ever.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // A navigation is the one request that decides which build you are playing,
  // so it asks the network first and falls back to the copy on the phone.
  //
  // `no-store` is the point of it: the page is served with a ten-minute
  // max-age, so a plain fetch is answered by the browser's own cache and the
  // app goes on launching a build that was replaced a quarter of an hour ago.
  // The network is the only thing that knows which build is current.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request.url, { cache: 'no-store', credentials: 'same-origin' })
        .then((response) => {
          void keep(request, response.clone());
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit ?? caches.match('./'))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        // Only a complete answer is worth keeping; a 404 cached is a 404 for ever.
        if (response.ok && response.type === 'basic') void keep(request, response.clone());
        return response;
      });
    }),
  );
});

function keep(request, response) {
  return caches
    .open(CACHE)
    .then((cache) => cache.put(request, response))
    .catch(() => undefined);
}
