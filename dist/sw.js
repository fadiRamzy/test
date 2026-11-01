/* عامل الخدمة — يُولَّد آليًا أثناء البناء. لا تُخزَّن سجلات العمل هنا. */
const VERSION = "a78708a2f836";
const CACHE = 'roms-assets-' + VERSION;
const BASE = new URL('./', self.location.href).href;
const ASSETS = [".nojekyll","assets/cairo-arabic-400-normal-CAYwymWN.woff","assets/cairo-arabic-400-normal-DN15VWMM.woff2","assets/cairo-arabic-500-normal-BADfnM6v.woff","assets/cairo-arabic-500-normal-DDl0i4Xv.woff2","assets/cairo-arabic-600-normal-B3EOalmC.woff","assets/cairo-arabic-600-normal-rkrvveqO.woff2","assets/cairo-arabic-700-normal-CyOqhaeK.woff","assets/cairo-arabic-700-normal-D3nDedWX.woff2","assets/cairo-latin-400-normal-Dh7otpdh.woff2","assets/cairo-latin-400-normal-b1R3q6Pf.woff","assets/cairo-latin-500-normal-D-WQsSKQ.woff2","assets/cairo-latin-500-normal-DkdkMETP.woff","assets/cairo-latin-600-normal-buYOP1M3.woff","assets/cairo-latin-600-normal-mGS0uvCM.woff2","assets/cairo-latin-700-normal-6fcUy4Rc.woff","assets/cairo-latin-700-normal-C3GYtKbV.woff2","assets/cairo-latin-ext-400-normal-C_BIE9Qe.woff","assets/cairo-latin-ext-400-normal-xCL67Y2R.woff2","assets/cairo-latin-ext-500-normal-De4OTi8O.woff","assets/cairo-latin-ext-500-normal-DxXN6Mb5.woff2","assets/cairo-latin-ext-600-normal-DAfLYaOC.woff","assets/cairo-latin-ext-600-normal-DuRnqffh.woff2","assets/cairo-latin-ext-700-normal-Cscux539.woff2","assets/cairo-latin-ext-700-normal-htXca11Z.woff","assets/index-CWC1lQq1.js","assets/index-DVKxN_h6.css","favicon.svg","index.html","manifest.webmanifest"];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS.map((f) => new URL(f, BASE).href)))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // مطابقة تتجاهل ترويسة Vary (خوادم المضيف قد تضيف Vary: Accept-Encoding)
  const matchCached = async (target) => {
    const cache = await caches.open(CACHE);
    return (await cache.match(target, { ignoreVary: true })) || (await cache.match(target));
  };

  // التنقل: الشبكة أولًا ثم النسخة المخزنة (يدعم المسارات الفرعية على GitHub Pages)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(async () => {
          const cached =
            (await matchCached(request)) ||
            (await matchCached(new URL('index.html', BASE).href)) ||
            (await matchCached(new URL('./', BASE).href));
          return (
            cached ||
            new Response('غير متصل بالإنترنت — افتح التطبيق مرة واحدة وأنت متصل لتخزين أصوله.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            })
          );
        }),
    );
    return;
  }

  // الأصول: من الذاكرة المؤقتة أولًا
  event.respondWith(
    (async () => {
      const cached = await matchCached(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      } catch {
        const late = await matchCached(request);
        if (late) return late;
        return new Response('', { status: 504 });
      }
    })(),
  );
});
