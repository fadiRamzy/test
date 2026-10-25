import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';

/**
 * يولّد ملف عامل الخدمة (Service Worker) بعد البناء مع قائمة أصول مُهشّرة،
 * بحيث تعمل النسخة المبنية بالكامل دون اتصال، وتحت أي مسار فرعي على GitHub Pages.
 * لا يتم تخزين أي سجلات عمل في الـ Cache — فقط أصول التطبيق.
 */
function serviceWorkerPlugin(): Plugin {
  return {
    name: 'generate-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter(
        (f) => !f.endsWith('.map') && f !== 'sw.js' && !f.endsWith('.txt'),
      );
      files.push('index.html', 'favicon.svg', 'manifest.webmanifest', '.nojekyll');
      const list = Array.from(new Set(files)).sort();
      const version = createHash('sha256').update(list.join('|')).digest('hex').slice(0, 12);

      const source = `/* عامل الخدمة — يُولَّد آليًا أثناء البناء. لا تُخزَّن سجلات العمل هنا. */
const VERSION = ${JSON.stringify(version)};
const CACHE = 'roms-assets-' + VERSION;
const BASE = new URL('./', self.location.href).href;
const ASSETS = ${JSON.stringify(list)};

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
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  // اسم المستودع على GitHub Pages: https://fadiRamzy.github.io/test/
  base: '/test/',
  plugins: [react(), serviceWorkerPlugin()],
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 0,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // يسمح بمعاينة التطبيق عبر نطاقات الاستضافة المؤقتة (لا يؤثر على النشر الثابت)
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
