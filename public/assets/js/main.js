/* =====================================================================
   Церковь «Свет миру» — поведение сайта.
   Ванильный JS, без зависимостей. Всё — прогрессивное улучшение:
   без него сайт остаётся читаемым и полностью функциональным.
   ===================================================================== */

(() => {
  'use strict';

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Данные сайта прокидывает сборщик из site.config.json. */
  const data = (() => {
    const el = $('#site-data');
    try {
      return el ? JSON.parse(el.textContent) : {};
    } catch {
      return {};
    }
  })();

  /* ── Тема ──────────────────────────────────────────────────────── */

  const applyTheme = (theme) => {
    document.documentElement.dataset.theme = theme;
    $('.theme-toggle')?.setAttribute(
      'aria-label',
      theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'
    );
  };

  $('.theme-toggle')?.addEventListener('click', () => {
    const next =
      document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
      localStorage.setItem('svetmiru-theme', next);
    } catch {
      /* приватный режим — просто не запоминаем */
    }
  });

  applyTheme(document.documentElement.dataset.theme || 'light');

  /* ── Мобильное меню ────────────────────────────────────────────── */

  const burger = $('.burger');
  const menu = $('.menu');

  if (burger && menu) {
    const setMenu = (open) => {
      burger.setAttribute('aria-expanded', String(open));
      menu.classList.toggle('is-open', open);
      menu.toggleAttribute('inert', !open);
      document.body.classList.toggle('no-scroll', open);
    };

    setMenu(false);
    burger.addEventListener('click', () =>
      setMenu(burger.getAttribute('aria-expanded') !== 'true')
    );
    menu.addEventListener('click', (e) => {
      if (e.target.closest('a')) setMenu(false);
    });
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu.classList.contains('is-open')) {
        setMenu(false);
        burger.focus();
      }
    });
  }

  /* ── Шапка: «включается» после тёмного первого экрана ───────────── */

  const header = $('.header');
  const darkTop = $('.hero, .page-head');

  if (header) {
    if (darkTop && 'IntersectionObserver' in window) {
      // Как только тёмный блок ушёл из-под шапки — переключаем её вид.
      new IntersectionObserver(
        ([entry]) => header.classList.toggle('is-lit', !entry.isIntersecting),
        { rootMargin: '-72px 0px 0px 0px', threshold: 0 }
      ).observe(darkTop);
    } else {
      header.classList.add('is-lit');
    }
  }

  /* ── Свет, следующий за курсором ────────────────────────────────
     Управляет тремя CSS-переменными тёмного блока: --lx, --ly, --beam.
     До первого движения указателя луч огромный, поэтому текст читается
     сразу — и у тех, у кого мыши нет вовсе.                          */

  const lightHost = $('.hero, .page-head');

  if (lightHost && !reduceMotion) {
    const BEAM = 'clamp(20rem, 46vw, 46rem)';
    let tx = 50,
      ty = 42,
      x = 50,
      y = 42,
      raf = 0,
      engaged = false;

    const tick = () => {
      x += (tx - x) * 0.09;
      y += (ty - y) * 0.09;
      lightHost.style.setProperty('--lx', x.toFixed(2) + '%');
      lightHost.style.setProperty('--ly', y.toFixed(2) + '%');
      raf = requestAnimationFrame(tick);
    };

    const engage = () => {
      if (engaged) return;
      engaged = true;
      lightHost.style.setProperty('--beam', BEAM);
      raf = requestAnimationFrame(tick);
    };

    if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
      addEventListener(
        'pointermove',
        (e) => {
          const r = lightHost.getBoundingClientRect();
          tx = ((e.clientX - r.left) / r.width) * 100;
          ty = ((e.clientY - r.top) / r.height) * 100;
          engage();
        },
        { passive: true }
      );
    } else {
      // На тач-устройствах свет живёт сам: медленно дрейфует по фигуре Лиссажу.
      engage();
      const t0 = performance.now();
      const drift = () => {
        const t = (performance.now() - t0) / 1000;
        tx = 50 + Math.sin(t * 0.28) * 26;
        ty = 44 + Math.sin(t * 0.19 + 1.2) * 16;
        requestAnimationFrame(drift);
      };
      requestAnimationFrame(drift);
    }

    // Не жжём батарею, когда вкладка не видна.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else if (engaged) raf = requestAnimationFrame(tick);
    });
  }

  /* ── Появление блоков при скролле ──────────────────────────────── */

  const revealables = $$('.reveal');

  if (revealables.length && 'IntersectionObserver' in window && !reduceMotion) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.05 }
    );
    revealables.forEach((el) => io.observe(el));
  } else {
    revealables.forEach((el) => el.classList.add('is-in'));
  }

  /* ── Подсветка карточки под курсором ───────────────────────────── */

  if (matchMedia('(hover: hover)').matches) {
    for (const card of $$('.card')) {
      card.addEventListener(
        'pointermove',
        (e) => {
          const r = card.getBoundingClientRect();
          card.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
          card.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
        },
        { passive: true }
      );
    }
  }

  /* ── Карта по требованию ────────────────────────────────────────
     Виджет Яндекса — единственный внешний запрос на сайте, поэтому он
     не грузится сам: до нажатия человек видит фирменную плашку с
     адресом, и никакие данные никуда не уходят.                      */

  for (const map of $$('.map[data-map]')) {
    const btn = $('.map__btn', map);
    if (!btn) continue;

    btn.addEventListener('click', () => {
      const frame = document.createElement('iframe');
      frame.src = map.dataset.map;
      frame.title = 'Карта проезда к церкви';
      frame.loading = 'lazy';
      frame.allowFullscreen = true;
      frame.referrerPolicy = 'no-referrer-when-downgrade';
      map.classList.add('is-loaded');
      map.append(frame);
    });
  }

  /* ── Аккордеон ─────────────────────────────────────────────────── */

  for (const btn of $$('.faq__q')) {
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
    });
  }

  /* ── Обратный отсчёт до ближайшего служения ────────────────────
     Считаем в часовом поясе церкви (Asia/Novosibirsk, UTC+7), а не в
     поясе посетителя: человек из Москвы должен видеть время церкви.  */

  const DAY_NAMES = [
    'Воскресенье',
    'Понедельник',
    'Вторник',
    'Среда',
    'Четверг',
    'Пятница',
    'Суббота',
  ];

  /** Дни встречи: одна запись расписания может идти в несколько дней недели. */
  const daysOf = (service) => service.days ?? [service.day];

  /** Ближайшее по времени служение из расписания. */
  function nextService(services, offsetHours) {
    const nowMs = Date.now();
    const shifted = new Date(nowMs + offsetHours * 3600e3); // «сейчас» глазами церкви
    let best = null;

    for (const service of services) {
      const [hh, mm] = service.time.split(':').map(Number);
      const days = daysOf(service);

      for (let add = 0; add <= 7; add++) {
        const local = new Date(
          Date.UTC(
            shifted.getUTCFullYear(),
            shifted.getUTCMonth(),
            shifted.getUTCDate() + add,
            hh,
            mm
          )
        );
        if (!days.includes(local.getUTCDay())) continue;

        const ms = local.getTime() - offsetHours * 3600e3; // обратно в реальный UTC
        if (ms <= nowMs) continue;
        if (!best || ms < best.ms) best = { ms, service, day: local.getUTCDay() };
        break;
      }
    }
    return best;
  }

  /** Идёт ли встреча прямо сейчас. Длительность берём из `till`, иначе 90 минут. */
  function liveNow(services, offsetHours) {
    const nowMs = Date.now();
    const shifted = new Date(nowMs + offsetHours * 3600e3);

    return services.find((service) => {
      if (!daysOf(service).includes(shifted.getUTCDay())) return false;

      const [hh, mm] = service.time.split(':').map(Number);
      const day = [
        shifted.getUTCFullYear(),
        shifted.getUTCMonth(),
        shifted.getUTCDate(),
      ];
      const start = Date.UTC(...day, hh, mm) - offsetHours * 3600e3;

      const end = service.till
        ? Date.UTC(...day, ...service.till.split(':').map(Number)) -
          offsetHours * 3600e3
        : start + 90 * 60e3;

      return nowMs >= start && nowMs < end;
    });
  }

  const countdown = $('.countdown');

  if (countdown && Array.isArray(data.services) && data.services.length) {
    const offset = Number(data.utcOffset) || 0;
    const label = $('#countdown-label');
    const pad = (n) => String(n).padStart(2, '0');

    const render = () => {
      const live = liveNow(data.services, offset);

      if (live) {
        countdown.classList.add('is-live');
        countdown.innerHTML =
          '<span class="countdown__unit"><span class="countdown__num">Идёт сейчас</span></span>';
        if (label) label.textContent = `${live.title} — прямо сейчас`;
        return;
      }

      countdown.classList.remove('is-live');
      const next = nextService(data.services, offset);
      if (!next) return;

      if (label) {
        const till = next.service.till ? `–${next.service.till}` : '';
        label.textContent = `${next.service.title} · ${DAY_NAMES[next.day]}, ${
          next.service.time
        }${till}`;
      }

      let left = Math.max(0, next.ms - Date.now());
      const d = Math.floor(left / 864e5);
      left -= d * 864e5;
      const h = Math.floor(left / 36e5);
      left -= h * 36e5;
      const m = Math.floor(left / 6e4);
      const s = Math.floor((left - m * 6e4) / 1000);

      const units = [
        d > 0 && [d, 'дней'],
        [pad(h), 'часов'],
        [pad(m), 'минут'],
        [pad(s), 'секунд'],
      ].filter(Boolean);

      countdown.innerHTML = units
        .map(
          ([value, name], i) =>
            (i ? '<span class="countdown__sep" aria-hidden="true">:</span>' : '') +
            `<span class="countdown__unit"><span class="countdown__num">${value}</span>` +
            `<span class="countdown__label">${name}</span></span>`
        )
        .join('');
    };

    render();
    setInterval(render, 1000);
  }

  /* ── Форма связи → мессенджер ───────────────────────────────────
     У церкви нет бэкенда, поэтому «карта связи» собирает сообщение и
     открывает WhatsApp. Всё, что ввёл человек, остаётся у него до
     момента, когда он сам нажмёт «Отправить» в мессенджере.          */

  const form = $('#connect-form');

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const text = [
        'Здравствуйте! Пишу с сайта церкви «Свет миру».',
        '',
        `Имя: ${f.get('name') || '—'}`,
        `Связаться: ${f.get('contact') || '—'}`,
        `Тема: ${f.get('topic') || '—'}`,
        '',
        f.get('message') || '',
      ].join('\n');

      const phone = (data.phoneRaw || '').replace(/\D/g, '');
      window.open(
        `https://wa.me/${phone}?text=${encodeURIComponent(text)}`,
        '_blank',
        'noopener'
      );

      const status = $('#form-status');
      if (status) {
        status.textContent =
          'Открыли WhatsApp с готовым сообщением — осталось нажать «Отправить».';
      }
    });
  }

  /* ── Согласие на счётчик посещаемости ───────────────────────────
     Порядок здесь важнее кода: до нажатия «Принять» на mc.yandex.ru
     не уходит ни одного запроса. Счётчик подключается только после
     согласия, а решение помнится вместе с датой — если когда-нибудь
     спросят, когда человек его дал, ответ будет.                     */

  const CONSENT = 'svetmiru-analytics';

  const readConsent = () => {
    try {
      return JSON.parse(localStorage.getItem(CONSENT) || 'null');
    } catch (e) {
      return null;
    }
  };

  const loadMetrika = (id) => {
    if (!id || window.ym) return;
    window.ym = function () {
      (window.ym.a = window.ym.a || []).push(arguments);
    };
    window.ym.l = Date.now();
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://mc.yandex.ru/metrika/tag.js';
    document.head.appendChild(s);
    window.ym(id, 'init', {
      clickmap: true,
      trackLinks: true,
      accurateTrackBounce: true,
    });
  };

  const bar = $('#cookie-bar');
  const metrikaId = data.metrikaId;

  const decide = (answer) => {
    try {
      localStorage.setItem(
        CONSENT,
        JSON.stringify({ ответ: answer, дата: new Date().toISOString() })
      );
    } catch (e) {}
    if (bar) bar.hidden = true;
    if (answer === 'yes') loadMetrika(metrikaId);
  };

  if (metrikaId) {
    const saved = readConsent();
    if (saved?.ответ === 'yes') loadMetrika(metrikaId);
    else if (!saved && bar) {
      bar.hidden = false;
      requestAnimationFrame(() => bar.classList.add('is-shown'));
    }
  }

  if (bar) {
    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cookie]');
      if (btn) decide(btn.dataset.cookie);
    });
  }

  // Кнопка на странице политики: отозвать согласие или дать его заново.
  const reset = $('#cookie-reset');
  if (reset) {
    const status = $('#cookie-status');
    const show = () => {
      const saved = readConsent();
      if (!status) return;
      status.textContent = !metrikaId
        ? 'Счётчик на сайте сейчас не подключён — считать нечего.'
        : saved?.ответ === 'yes'
          ? 'Сейчас вы разрешили подсчёт посещаемости.'
          : saved?.ответ === 'no'
            ? 'Сейчас подсчёт посещаемости выключен.'
            : 'Вы ещё не отвечали на вопрос о подсчёте посещаемости.';
      reset.hidden = !saved;
    };
    show();
    reset.addEventListener('click', () => {
      try {
        localStorage.removeItem(CONSENT);
      } catch (e) {}
      show();
      if (bar) {
        bar.hidden = false;
        requestAnimationFrame(() => bar.classList.add('is-shown'));
      }
    });
  }

  /* ── Год в подвале ─────────────────────────────────────────────── */

  const year = $('#year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
