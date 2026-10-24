import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const dist = join(root, 'dist');
const hasDist = existsSync(join(dist, 'index.html'));

describe('إعدادات النشر على GitHub Pages', () => {
  it('يستخدم Vite مسارًا نسبيًا (base = "./") لدعم المسارات الفرعية', () => {
    const config = readFileSync(join(root, 'vite.config.ts'), 'utf8');
    expect(config).toMatch(/base:\s*'\.\/'/);
  });

  it('يضبط index.html على اللغة العربية واتجاه RTL', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    expect(html).toContain('lang="ar"');
    expect(html).toContain('dir="rtl"');
  });

  it('لا يحتوي الكود على أي استدعاء لخادم أو CDN خارجي', () => {
    const walk = (dir: string): string[] => {
      const entries = readdirSync(dir, { withFileTypes: true });
      return entries.flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return walk(path);
        return /\.(ts|tsx|css|html)$/.test(entry.name) ? [path] : [];
      });
    };
    const files = walk(join(root, 'src')).concat([join(root, 'index.html')]);
    const forbidden = [/https?:\/\/[^\s"')]+\.(js|css|woff2?|ttf)/, /fetch\(\s*['"]https?:/, /firebase/i, /supabase/i, /sqlite/i];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        expect(pattern.test(content), `${file} يطابق ${pattern}`).toBe(false);
      }
    }
  });

  it('يحتوي مستندًا لمانيفست PWA بمسار نسبي', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'public/manifest.webmanifest'), 'utf8'));
    expect(manifest.dir).toBe('rtl');
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
  });

  it.skipIf(!hasDist)('ينتج بناءً بمسارات نسبية تعمل تحت مسار فرعي للمستودع', () => {
    const html = readFileSync(join(dist, 'index.html'), 'utf8');
    const assetRefs = Array.from(html.matchAll(/(?:src|href)="([^"]+)"/g)).map((match) => match[1]);
    const externalAndAbsolute = assetRefs.filter((ref) => !ref.startsWith('./') && !ref.startsWith('#') && !ref.startsWith('data:'));
    expect(externalAndAbsolute).toEqual([]);
  });

  it.skipIf(!hasDist)('يولّد عامل خدمة يخزّن أصول التطبيق فقط', () => {
    const sw = readFileSync(join(dist, 'sw.js'), 'utf8');
    expect(sw).toContain('roms-assets-');
    expect(sw).toContain('index.html');
    expect(sw).toContain("request.mode === 'navigate'");
    expect(sw).not.toContain('indexedDB');
    // لا تُخزَّن طلبات الكتابة
    expect(sw).toContain("request.method !== 'GET'");
  });

  it.skipIf(!hasDist)('يتضمن ملف .nojekyll لتجنّب تجاهل الملفات التي تبدأ بشرطة سفلية', () => {
    expect(existsSync(join(dist, '.nojekyll'))).toBe(true);
  });

  it.skipIf(!hasDist)('يتضمن الخطوط العربية محليًا داخل حزمة البناء', () => {
    const assets = readdirSync(join(dist, 'assets'));
    expect(assets.some((file) => file.includes('cairo-arabic') && file.endsWith('.woff2'))).toBe(true);
    const css = readFileSync(join(dist, 'assets', assets.find((file) => file.endsWith('.css')) as string), 'utf8');
    expect(css).toContain('@font-face');
    expect(css).toContain('Cairo');
  });

  it.skipIf(!hasDist)('لا يتضمن أي ملفات بيانات أو نسخ احتياطية في مخرجات النشر', () => {
    const entries = readdirSync(dist);
    expect(entries.some((entry) => entry.endsWith('.json') && !entry.startsWith('manifest'))).toBe(false);
    expect(entries.some((entry) => entry.includes('backup'))).toBe(false);
  });

  it('يتضمن ملف .gitignore يمنع رفع النسخ الاحتياطية وبيانات العمل', () => {
    const ignore = readFileSync(join(root, '.gitignore'), 'utf8');
    expect(ignore).toContain('*backup*.json');
    expect(ignore).toContain('node_modules');
    expect(ignore).toContain('dist/');
  });
});
