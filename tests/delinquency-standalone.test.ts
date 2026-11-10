/**
 * يضمن أن «نظام تحليل ترحيل المتأخرات الشهري» هو التطبيق الافتراضي للموقع،
 * وأنه النظام الوحيد في الموقع (نظام الموظفين السابق أُزيل بالكامل).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { parseRoute } from '../src/delinquency/router';
import { clientListsNoun, comparisonsNoun, monthsNoun } from '../src/delinquency/lib/utils';
import { BUCKETS } from '../src/delinquency/lib/delinquency';

const ROOT = resolve(__dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf-8');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const importsOf = (source: string): string[] =>
  Array.from(source.matchAll(/(?:from\s+|import\s+|import\()\s*['"]([^'"]+)['"]/g)).map((match) => match[1]);

describe('نقطة دخول الموقع', () => {
  it('index.html (الصفحة الافتراضية) يحمّل النظام الجديد بعنوانه', () => {
    const html = read('index.html');
    expect(html).toContain('<title>نظام تحليل ترحيل المتأخرات الشهري</title>');
    expect(html).toContain('src="/src/delinquency/main.tsx"');
    expect(html).not.toContain('src="/src/main.tsx"');
    expect(html).not.toMatch(/الموظف/);
    expect(html).toContain('lang="ar" dir="rtl"');
  });

  it('نظام الموظفين السابق أُزيل: لا صفحة employees.html ولا ملفات مصدر خارج مجلد النظام', () => {
    expect(existsSync(join(ROOT, 'employees.html'))).toBe(false);
    expect(readdirSync(join(ROOT, 'src'))).toEqual(['delinquency']);
    expect(walk(join(ROOT, 'public')).map((file) => relative(join(ROOT, 'public'), file)).sort()).toEqual([
      '404.html',
      'favicon-delinquency.svg',
      'manifest.webmanifest',
    ]);
  });

  it('البناء ينتج صفحة واحدة، والتطبيق المثبَّت (manifest) هو النظام الجديد', () => {
    const config = read('vite.config.ts');
    expect(config).toMatch(/main:\s*fileURLToPath\(new URL\('\.\/index\.html'/);
    expect(config).not.toMatch(/employees/);
    const manifest = JSON.parse(read('public/manifest.webmanifest'));
    expect(manifest.name).toBe('نظام تحليل ترحيل المتأخرات الشهري');
    expect(manifest.start_url).toBe('./');
    expect(existsSync(join(ROOT, 'public', manifest.icons[0].src))).toBe(true);
  });
});

describe('استقلال النظام', () => {
  const appDir = join(ROOT, 'src/delinquency');
  const appFiles = walk(appDir).filter((file) => /\.(ts|tsx|css)$/.test(file));

  it('لا يستورد أي ملف من خارج مجلده', () => {
    expect(appFiles.length).toBeGreaterThan(15);
    const outside: string[] = [];
    for (const file of appFiles) {
      for (const specifier of importsOf(readFileSync(file, 'utf-8'))) {
        if (!specifier.startsWith('.')) continue;
        const target = resolve(dirname(file), specifier);
        if (relative(appDir, target).startsWith('..')) outside.push(`${relative(ROOT, file)} → ${specifier}`);
      }
    }
    expect(outside).toEqual([]);
  });

  it('يعتمد فقط على React وخط الواجهة وقارئ PDF من الحزم الخارجية', () => {
    const packages = new Set<string>();
    for (const file of appFiles) {
      for (const specifier of importsOf(readFileSync(file, 'utf-8'))) {
        if (!specifier.startsWith('.')) packages.add(specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]);
      }
    }
    expect(Array.from(packages).sort()).toEqual(['@fontsource/ibm-plex-sans-arabic', 'pdfjs-dist', 'react', 'react-dom']);
  });

  it('لا رابط ولا إشارة إلى صفحة النظام السابق في أي ملف من ملفات الموقع', () => {
    const siteFiles = [...appFiles, join(ROOT, 'index.html'), ...walk(join(ROOT, 'public'))];
    const offenders = siteFiles.filter((file) => /employees\.html|النظام السابق|مسؤولي المخاطر/.test(readFileSync(file, 'utf-8')));
    expect(offenders.map((file) => relative(ROOT, file))).toEqual([]);
  });
});

describe('المسارات والشرائح والصياغة', () => {
  it('الصفحة الافتراضية هي لوحة المقارنة، وأي مسار غير معروف يعود إليها', () => {
    expect(parseRoute('')).toEqual({ section: 'dashboard' });
    expect(parseRoute('#/')).toEqual({ section: 'dashboard' });
    expect(parseRoute('#/entry')).toEqual({ section: 'entry' });
    expect(parseRoute('#/saved')).toEqual({ section: 'saved', itemId: undefined });
    expect(parseRoute('#/saved/dqc_1')).toEqual({ section: 'saved', itemId: 'dqc_1' });
    expect(parseRoute('#/data?x=1')).toEqual({ section: 'data' });
    expect(parseRoute('#/delinquency/saved/dqc_1')).toEqual({ section: 'saved', itemId: 'dqc_1' });
    expect(parseRoute('#/delinquency')).toEqual({ section: 'dashboard' });
    expect(parseRoute('#/employees/123')).toEqual({ section: 'dashboard' });
    expect(parseRoute('#/saved/%E0%A4%A')).toEqual({ section: 'saved', itemId: '%E0%A4%A' });
  });

  it('خمس شرائح بالحدود المطلوبة', () => {
    expect(BUCKETS.map((bucket) => [bucket.from, bucket.to])).toEqual([
      [1, 30],
      [31, 60],
      [61, 90],
      [91, 120],
      [121, null],
    ]);
  });

  it('صياغة عربية سليمة للأعداد', () => {
    expect([0, 1, 2, 5, 11].map(monthsNoun)).toEqual(['لا أشهر', 'شهر واحد', 'شهران', '5 أشهر', '11 شهرًا']);
    expect([0, 1, 2, 3, 20].map(clientListsNoun)).toEqual(['لا قوائم عملاء', 'قائمة عملاء واحدة', 'قائمتا عملاء', '3 قوائم عملاء', '20 قائمة عملاء']);
    expect([0, 1, 2, 4, 15].map(comparisonsNoun)).toEqual([
      'لا مقارنات محفوظة',
      'مقارنة محفوظة واحدة',
      'مقارنتان محفوظتان',
      '4 مقارنات محفوظة',
      '15 مقارنة محفوظة',
    ]);
  });
});
