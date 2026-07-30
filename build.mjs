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

/**
 * Описание площадок. Ссылки живут в site.config.json, а как их назвать и
 * нарисовать — здесь: это оформление, а не контент. Пустая ссылка в конфиге
 * означает, что площадки нет, и она нигде не появится.
 */
const SOCIAL = {
  vk: {
    name: 'ВКонтакте',
    kind: 'Соцсеть',
    text: 'Анонсы, фотографии со встреч, записи служений и короткие фрагменты проповедей.',
    cta: 'Открыть сообщество',
    icon: 'M12.8 16.9c-5.3 0-8.6-3.7-8.7-9.8h2.7c.1 4.5 2.2 6.4 3.8 6.8V7.1h2.6v3.9c1.5-.2 3.1-1.9 3.6-3.9h2.5c-.4 2.4-2.1 4.1-3.2 4.8 1.2.6 3.1 2.1 3.8 5h-2.8c-.6-1.8-2-3.2-3.9-3.4v3.4h-.4z',
  },
  telegram: {
    name: 'Telegram',
    kind: 'Канал',
    text: 'Самое быстрое место: расписание, изменения, молитвенные нужды.',
    cta: 'Подписаться',
    icon: 'M21.9 4.3 18.9 19c-.2 1-.8 1.2-1.7.8l-4.6-3.4-2.2 2.1c-.3.3-.5.5-1 .5l.3-4.7 8.5-7.7c.4-.3-.1-.5-.6-.2L6.9 13 2.4 11.6c-1-.3-1-1 .2-1.4l18-7c.8-.3 1.5.2 1.3 1.1z',
  },
  youtube: {
    name: 'YouTube',
    kind: 'Видео',
    text: 'Полные записи воскресных служений и отдельные проповеди.',
    cta: 'Открыть канал',
    icon: 'M22 12s0-3.2-.4-4.7c-.2-.9-.9-1.5-1.7-1.7C18.3 5.2 12 5.2 12 5.2s-6.3 0-7.9.4c-.8.2-1.5.8-1.7 1.7C2 8.8 2 12 2 12s0 3.2.4 4.7c.2.9.9 1.5 1.7 1.7 1.6.4 7.9.4 7.9.4s6.3 0 7.9-.4c.8-.2 1.5-.8 1.7-1.7.4-1.5.4-4.7.4-4.7zM10 15V9l5.2 3-5.2 3z',
  },
  whatsapp: {
    name: 'WhatsApp',
    kind: 'Мессенджер',
    text: 'Написать напрямую — отвечает живой человек, обычно в тот же день.',
    cta: 'Написать',
    icon: 'M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2zm5.1 14c-.2.6-1.2 1.2-1.7 1.2-.5.1-1 .1-3.1-.7-2.6-1.1-4.2-3.7-4.3-3.9-.1-.2-1-1.3-1-2.5s.6-1.8.9-2c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 1.9c.1.2.1.4 0 .6l-.4.5c-.1.2-.3.3-.1.6.1.3.7 1.2 1.5 1.9 1 .9 1.8 1.2 2.1 1.3.2.1.4.1.6-.1l.8-.9c.2-.2.4-.2.6-.1l1.8.9c.2.1.4.2.5.3.1.2.1.5-.1.9z',
  },
};

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

  // Карта Яндекса по координатам из конфига. Виджету не нужен API-ключ,
  // но грузится он только по нажатию — см. .map в main.js.
  const { lat, lon } = site.address ?? {};
  site.address.mapEmbed =
    lat && lon
      ? `https://yandex.ru/map-widget/v1/?ll=${lon}%2C${lat}&z=17&pt=${lon},${lat},pm2rdm`
      : '';

  // Метрика подключается, только если в конфиге есть номер счётчика
  site.metrikaHtml = site.metrikaId
    ? `<script>
      (function (m, e, t, r, i, k, a) {
        m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
        m[i].l = 1 * new Date();
        for (var j = 0; j < document.scripts.length; j++) {
          if (document.scripts[j].src === r) return;
        }
        k = e.createElement(t); a = e.getElementsByTagName(t)[0];
        k.async = 1; k.src = r; a.parentNode.insertBefore(k, a);
      })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');
      ym(${site.metrikaId}, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true });
    </script>
    <noscript><div><img src="https://mc.yandex.ru/watch/${site.metrikaId}" style="position:absolute;left:-9999px" alt="" /></div></noscript>`
    : '';

  // Пасторов может быть несколько — имена склеиваем по-русски, через «и»
  const pastors = site.pastors ?? [];
  site.pastorNames = pastors
    .map((p) => p.name)
    .reduce((acc, name, i, all) =>
      i === 0 ? name : i === all.length - 1 ? `${acc} и ${name}` : `${acc}, ${name}`
    , '');

  site.pastorsJsonLd = JSON.stringify(
    pastors.map((p) => ({ '@type': 'Person', name: p.name, jobTitle: p.role }))
  );

  site.pastorsHtml = pastors
    .map((p, i) => {
      const photo = p.photo
        ? `<img class="card__photo" src="${p.photo}" alt="${p.name}" loading="lazy" />\n        `
        : '';
      return (
        `<article class="card reveal" style="--i: ${i}">\n` +
        `        ${photo}<p class="card__index">${p.role}</p>\n` +
        `        <h3 class="card__title">${p.name}</h3>\n` +
        `      </article>`
      );
    })
    .join('\n      ');

  // Фото входа — самая полезная картинка на сайте: по ней человек узнаёт дверь
  site.entranceHtml = site.photos?.entrance
    ? `<figure class="shot reveal">\n` +
      `      <img src="${site.photos.entrance}" alt="Вход в здание, где собирается церковь «Свет миру»" loading="lazy" />\n` +
      `      <figcaption>Ищите эту дверь — мы за ней</figcaption>\n` +
      `    </figure>`
    : '';

  // Почта необязательна: пустое поле лучше, чем опубликованный мёртвый ящик
  site.emailFooterHtml = site.email
    ? `<li><a href="mailto:${site.email}">${site.email}</a></li>`
    : '';

  site.emailRowHtml = site.email
    ? `<div>\n` +
      `            <dt>Почта</dt>\n` +
      `            <dd><a class="link" href="mailto:${site.email}">${site.email}</a></dd>\n` +
      `          </div>`
    : '';

  // Только те площадки, у которых в конфиге действительно стоит адрес
  const links = Object.entries(SOCIAL).filter(([key]) => site.social?.[key]);

  site.socialsHtml = links
    .map(
      ([key, s]) =>
        `<a href="${site.social[key]}" aria-label="${s.name}" rel="noopener noreferrer" target="_blank">` +
        `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">` +
        `<path d="${s.icon}" /></svg></a>`
    )
    .join('\n          ');

  // На «Медиа» мессенджер не нужен — там про то, где нас смотреть и слушать
  site.mediaCardsHtml = links
    .filter(([key]) => key !== 'whatsapp')
    .map(
      ([key, s], i) =>
        `<article class="card card--link reveal" style="--i: ${i}">\n` +
        `        <p class="card__index">${s.kind}</p>\n` +
        `        <h3 class="card__title">${s.name}</h3>\n` +
        `        <p class="card__text">${s.text}</p>\n` +
        `        <a class="link" href="${site.social[key]}" target="_blank" rel="noopener noreferrer">\n` +
        `          ${s.cta} <span aria-hidden="true">→</span>\n` +
        `        </a>\n` +
        `      </article>`
    )
    .join('\n      ');

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
