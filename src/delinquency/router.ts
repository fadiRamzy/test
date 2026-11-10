import { useEffect, useState } from 'react';

/**
 * موجّه مسارات يعتمد على الـ hash — يعمل على GitHub Pages تحت أي مسار فرعي
 * دون أي إعداد على الخادم.
 *
 * المسارات:
 *   #/            لوحة المقارنة (الصفحة الافتراضية للنظام)
 *   #/entry       إدخال البيانات الشهرية
 *   #/saved       المقارنات المحفوظة      #/saved/<id>  مقارنة محفوظة
 *   #/data        البيانات والنسخ الاحتياطي
 */

export type Section = 'dashboard' | 'entry' | 'saved' | 'data';

export interface Route {
  section: Section;
  itemId?: string;
}

export function parseRoute(hash: string): Route {
  const segments = hash
    .replace(/^#\/?/, '')
    .split('?')[0]
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  // روابط قديمة كانت تبدأ بـ ‎/delinquency
  if (segments[0] === 'delinquency') segments.shift();
  const [first, second] = segments;
  if (first === 'entry') return { section: 'entry' };
  if (first === 'saved') return { section: 'saved', itemId: second };
  if (first === 'data') return { section: 'data' };
  return { section: 'dashboard' };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(to: string): void {
  const target = `#${to.startsWith('/') ? to : `/${to}`}`;
  if (window.location.hash === target) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = target;
  }
  if (typeof window.scrollTo === 'function') {
    try {
      window.scrollTo({ top: 0 });
    } catch {
      /* غير مدعوم في بعض البيئات */
    }
  }
}
