#!/usr/bin/env node
/**
 * Сборка статического сайта. Ноль зависимостей — только Node ≥ 18.
 *
 *   node build.mjs          собрать в dist/
 *   node build.mjs --serve  собрать, поднять localhost:4321 и пересобирать при изменениях
 *
 * Как это работает:
 *   src/layout.html      — общий каркас страницы
 *   src/partials/*.html  — шапка, подвал, повторяемые блоки
 *   src/pages/*.html     — контент страниц; первый HTML-комментарий = JSON с мета-данными
 *   public/**            — копируется в dist/ как есть
 *   site.config.json     — данные, доступные в шаблонах как {{ site.phone }} и т.п.
 */

import { readFile, writeFile, readdir, mkdir, rm, cp, stat } from 'node:fs/promises';
import { existsSync, watch } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const p = (...s) => path.join(root, ...s);

const SERVE = process.argv.includes('--serve');
const PORT = 4321;

/* ─────────────────────────── шаблонизатор ─────────────────────────── */

/** Достаёт значение по пути «site.address.full» из объекта данных. */
const lookup = (data, expr) =>
  expr.trim().split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), data);

/** Подставляет {{ ... }} до тех пор, пока есть что подставлять (партиалы могут содержать плейсхолдеры). */
function interpolate(tpl, data) {
  let out = tpl;
  for (let pass = 0; pass < 5; pass++) {
    const next = out.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, expr) => {
      const value = lookup(data, expr);
      if (value == null) return whole;
      // Объекты и массивы уходят в разметку как JSON — так расписание
      // служений попадает в <script type="application/json"> одной строкой.
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Первый комментарий страницы — её мета-данные. */
function splitFrontMatter(raw, file) {
  const m = raw.match(/^\s*<!--([\s\S]*?)-->/);
  if (!m) throw new Error(`${file}: нет блока мета-данных в начале файла`);
  let meta;
  try {
    meta = JSON.parse(m[1]);
  } catch (e) {
    throw new Error(`${file}: мета-данные не парсятся как JSON — ${e.message}`);
  }
  return { meta, body: raw.slice(m[0].length).trim() };
}

/* ─────────────────────────────── сборка ─────────────────────────────── */

const DAY_NAMES = [
  'Воскресенье',
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
];

const DAY_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

/** Одна встреча может идти в несколько дней — «Вт, Чт» это одна строка расписания. */
const daysOf = (service) => service.days ?? [service.day];

/**
 * Достраивает конфиг вычисляемыми полями, чтобы расписание жило ровно в одном
 * месте: и список на главной, и строка в контактах, и обратный отсчёт берутся
 * из одного массива `services`.
 */
function derive(site) {
  const services = site.services ?? [];

  site.scheduleHtml = services
    .map((s) => {
      const days = daysOf(s);
      // Один день пишем словом, несколько — сокращениями, иначе строка не влезает
      const label =
        days.length === 1
          ? DAY_NAMES[days[0]]
          : days.map((d) => DAY_SHORT[d]).join(' · ');
      const till = s.till ? `<small>до ${s.till}</small>` : '';

      return (
        `<div class="slot">\n` +
        `        <span class="slot__time">${s.time}${till}</span>\n` +
        `        <span class="slot__title">${s.title}</span>\n` +
        `        <span class="slot__day">${label}</span>\n` +
        `        <p class="slot__note">${s.note}</p>\n` +
        `      </div>`
      );
    })
    .join('\n      ');

  site.scheduleShort = services
    .map(
      (s) =>
        `${daysOf(s).map((d) => DAY_SHORT[d]).join(', ')} ${s.time}` +
        (s.till ? `–${s.till}` : '')
    )
    .join(' · ');

  const main = services[0];
  site.primaryService = main
    ? `${DAY_NAMES[daysOf(main)[0]]}, ${main.time}`
    : '';

  return site;
}

async function build() {
  const started = Date.now();
  const site = derive(JSON.parse(await readFile(p('site.config.json'), 'utf8')));

  const layout = await readFile(p('src/layout.html'), 'utf8');

  const partialFiles = await readdir(p('src/partials'));
  const partials = {};
  for (const f of partialFiles.filter((f) => f.endsWith('.html'))) {
    partials[path.basename(f, '.html')] = await readFile(p('src/partials', f), 'utf8');
  }

  await rm(p('dist'), { recursive: true, force: true });
  await mkdir(p('dist'), { recursive: true });
  if (existsSync(p('public'))) await cp(p('public'), p('dist'), { recursive: true });

  const pageFiles = (await readdir(p('src/pages'))).filter((f) => f.endsWith('.html'));
  const built = [];

  for (const file of pageFiles) {
    const raw = await readFile(p('src/pages', file), 'utf8');
    const { meta, body } = splitFrontMatter(raw, file);

    const slug = path.basename(file, '.html');
    const canonical = slug === 'index' ? `${site.url}/` : `${site.url}/${slug}.html`;

    const data = {
      site,
      page: { ...meta, slug, canonical },
      partial: partials,
    };

    // Партиалы вставляем до общей интерполяции, чтобы их плейсхолдеры тоже раскрылись.
    let html = layout
      .replace('{{ content }}', body)
      .replace(/\{\{\s*partial\.(\w+)\s*\}\}/g, (whole, key) => partials[key] ?? whole);

    html = interpolate(html, data);

    // Активный пункт меню: data-nav="about" получает aria-current, если совпал со страницей.
    html = html.replace(
      new RegExp(`(<a\\b[^>]*data-nav="${slug}")`, 'g'),
      '$1 aria-current="page"'
    );

    // Отладочная страховка: не оставляем нераскрытых плейсхолдеров в проде.
    const leftovers = [...html.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]);
    if (leftovers.length) {
      console.warn(`  ! ${file}: не подставлено — ${[...new Set(leftovers)].join(', ')}`);
    }

    await writeFile(p('dist', file), html);
    built.push({ slug, canonical, changefreq: meta.changefreq ?? 'monthly', priority: meta.priority ?? 0.6 });
  }

  await writeSitemap(site, built);

  console.log(
    `✓ собрано ${built.length} стр. за ${Date.now() - started} мс → dist/`
  );
}

async function writeSitemap(site, pages) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = pages
    .sort((a, b) => b.priority - a.priority)
    .map(
      ({ canonical, changefreq, priority }) =>
        `  <url>\n    <loc>${canonical}</loc>\n    <lastmod>${today}</lastmod>\n` +
        `    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`
    )
    .join('\n');

  await writeFile(
    p('dist/sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
  );
  await writeFile(
    p('dist/robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${site.url}/sitemap.xml\n`
  );
}

/* ─────────────────────────── dev-сервер ─────────────────────────── */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

async function serve() {
  createServer(async (req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel === '/') rel = '/index.html';
    if (!path.extname(rel)) rel += '.html';

    const file = p('dist', rel.replace(/^\/+/, ''));
    try {
      const s = await stat(file);
      if (!s.isFile()) throw new Error('not a file');
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>404</h1>');
    }
  }).listen(PORT, () => console.log(`→ http://localhost:${PORT}`));

  let timer;
  for (const dir of ['src', 'public', 'site.config.json']) {
    watch(p(dir), { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => build().catch((e) => console.error(e.message)), 80);
    });
  }
}

await build();
if (SERVE) await serve();
