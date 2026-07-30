#!/usr/bin/env python3
"""
Подготовка фотографий для сайта.

Приводит снимок к нужному размеру, чуть подтягивает его к тёплой палитре
сайта и сохраняет в JPEG + WebP. Обработка намеренно лёгкая: сильная
цветокоррекция на лицах выглядит плохо, задача — снять холодный оттенок
и попасть в общий тон, а не перекрасить фотографию.

    python3 tools/photo.py portrait исходник.jpg pastor-maksim
    python3 tools/photo.py wide     исходник.jpg entrance
    python3 tools/photo.py og       исходник.jpg og

Результат кладётся в public/assets/img/photo/ (og — в public/assets/img/).
Нужен Python 3 и Pillow: pip install Pillow
"""

import sys
from pathlib import Path

try:
    from PIL import Image, ImageEnhance
except ImportError:
    sys.exit('Нужен Pillow: pip install Pillow')

ROOT = Path(__file__).resolve().parent.parent
OUT_PHOTO = ROOT / 'public/assets/img/photo'
OUT_IMG = ROOT / 'public/assets/img'

BRAND = (220, 82, 19)
CREAM = (248, 242, 220)

PRESETS = {
    # имя: (ширина, высота, качество JPEG)
    'portrait': (900, 900, 88),
    'wide': (1800, 1125, 85),
    'og': (1200, 630, 88),
}


def crop_to(img, w, h):
    """Обрезает по центру под нужное соотношение, затем масштабирует."""
    target = w / h
    iw, ih = img.size
    current = iw / ih

    if current > target:  # шире нужного — режем по бокам
        new_w = int(ih * target)
        left = (iw - new_w) // 2
        img = img.crop((left, 0, left + new_w, ih))
    else:  # выше нужного — режем сверху и снизу
        new_h = int(iw / target)
        # Смещаем кадр вверх: на портретах лицо обычно в верхней половине
        top = int((ih - new_h) * 0.35)
        img = img.crop((0, top, iw, top + new_h))

    return img.resize((w, h), Image.LANCZOS)


def warm(img, amount=0.05):
    """Мягко сдвигает баланс в тёплую сторону палитры сайта."""
    r, g, b = img.split()
    r = r.point(lambda v: min(255, int(v * (1 + amount))))
    b = b.point(lambda v: int(v * (1 - amount * 0.8)))
    out = Image.merge('RGB', (r, g, b))
    out = ImageEnhance.Color(out).enhance(1.04)
    return ImageEnhance.Contrast(out).enhance(1.05)


def add_og_overlay(img):
    """Для картинки-превью: затемняет низ и кладёт кремовый логотип."""
    scrim = Image.new('RGBA', img.size, (0, 0, 0, 0))
    h = img.height
    start = h * 0.45
    for y in range(int(start), h):
        # Ограничиваем: округление вниз может дать отрицательное t,
        # а дробная степень от отрицательного числа — комплексная.
        t = min(1.0, max(0.0, (y - start) / (h - start)))
        scrim.paste((11, 6, 3, int(215 * t**1.4)), (0, y, img.width, y + 1))
    img = Image.alpha_composite(img.convert('RGBA'), scrim)

    logo_path = OUT_IMG / 'logo-lockup-cream.png'
    if logo_path.exists():
        logo = Image.open(logo_path).convert('RGBA')
        w = int(img.width * 0.42)
        logo = logo.resize((w, int(logo.height * w / logo.width)), Image.LANCZOS)
        img.paste(logo, (int(img.width * 0.06), img.height - logo.height - 52), logo)

    return img.convert('RGB')


def main():
    if len(sys.argv) != 4 or sys.argv[1] not in PRESETS:
        sys.exit(__doc__)

    preset, src, name = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
    if not src.exists():
        sys.exit(f'Нет файла: {src}')

    w, h, quality = PRESETS[preset]
    out_dir = OUT_IMG if preset == 'og' else OUT_PHOTO
    out_dir.mkdir(parents=True, exist_ok=True)

    img = Image.open(src).convert('RGB')
    original = img.size

    # Не растягиваем маленькие снимки: апскейл только мылит картинку и
    # раздувает файл, резкости от него не прибавляется.
    if img.width < w:
        w = img.width
        h = int(round(w / (PRESETS[preset][0] / PRESETS[preset][1])))
        print(f'исходник узкий ({img.width}px) — не растягиваю, оставляю {w}×{h}')

    img = crop_to(img, w, h)
    img = warm(img)
    if preset == 'og':
        img = add_og_overlay(img)

    jpg = out_dir / f'{name}.jpg'
    webp = out_dir / f'{name}.webp'
    img.save(jpg, 'JPEG', quality=quality, optimize=True, progressive=True)
    img.save(webp, 'WEBP', quality=quality - 4, method=6)

    rel = jpg.relative_to(ROOT / 'public')
    print(f'{original[0]}×{original[1]} → {w}×{h}')
    print(f'  {jpg.name}  {jpg.stat().st_size // 1024} КБ')
    print(f'  {webp.name} {webp.stat().st_size // 1024} КБ')
    print(f'\nПуть для site.config.json:  /{rel}')


if __name__ == '__main__':
    main()
