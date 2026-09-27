"""
Makes the mask library: painted shapes, white on a transparent ground.

An image here carries only a shape. Its colour is given where it is used, so
one image serves every theme and every state. On the web that is mask-image
over a background colour.

Run:  python packages/design/masks/make.py
Needs Pillow and numpy. Output goes to packages/design/src/masks and is
committed, so the build itself needs neither.

Every shape is drawn from a fixed seed: the same command gives the same files.
To get a different stroke, change its seed; to get a new one, add a line to
LIBRARY.

There are three sets, one for each texture the screen can wear. Paint is
thrown and brushed. Metal is cut plate, brushed and worn. Hex is plating
that comes apart into cells. A set fills the same parts: heading, button,
stain, title, ground, chip and burst.
"""

import zlib
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "src" / "masks"
OVERSAMPLE = 2


def noise(rng, w, h, cells_x, cells_y):
    """Smooth noise, 0 to 1: a coarse grid of random values stretched to w by h."""
    grid = rng.random((max(2, int(cells_y)), max(2, int(cells_x))))
    image = Image.fromarray((grid * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    return np.asarray(image, dtype=np.float32) / 255


def layered(rng, w, h, cells_x, cells_y, layers=4):
    total = np.zeros((h, w), dtype=np.float32)
    weight, weights = 1.0, 0.0
    for i in range(layers):
        total += weight * noise(rng, w, h, cells_x * 2**i, cells_y * 2**i)
        weights += weight
        weight *= 0.5
    return total / weights


def ramp(lo, hi, x):
    t = np.clip((x - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def droplets(rng, w, h, spots):
    """spots: (x, y, radius, stretch, angle) in pixels."""
    layer = Image.new("L", (w, h), 0)
    for x, y, r, stretch, angle in spots:
        size = int(r * stretch * 2 + 4)
        blob = Image.new("L", (size, size), 0)
        c = size / 2
        ImageDraw.Draw(blob).ellipse((c - r * stretch, c - r, c + r * stretch, c + r), fill=255)
        blob = blob.rotate(angle, resample=Image.BICUBIC)
        layer.paste(255, (int(x - c), int(y - c)), blob)
    return np.asarray(layer, dtype=np.float32) / 255


def stroke(seed, w, h, thickness=0.34, dry=0.5, bow=0.0, flecks=14, tail=0.2):
    """
    One pass of a loaded brush, left to right. The middle stays solid so that
    words can sit on it; the paint runs out toward the right and at the edges.
    """
    rng = np.random.default_rng(seed)
    W, H = w * OVERSAMPLE, h * OVERSAMPLE
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    u, v = xs / W, ys / H

    along = noise(rng, W, 1, 5, 2)[0]
    middle = 0.5 + bow * ((u - 0.5) ** 2 - 0.08) + 0.05 * (along - 0.5)
    half = thickness * (0.82 + 0.36 * noise(rng, W, 1, 4, 2)[0])
    from_middle = np.abs(v - middle) / half

    rough = (layered(rng, W, H, 36, 6) - 0.5) * 0.16
    alpha = ramp(0.0, 0.03, half - np.abs(v - middle) + rough * half * 2)

    # Bristles: each row of the brush runs out of paint at its own point.
    row = noise(rng, 1, H, 2, H // 3)[:, :1]
    starts = 0.025 + 0.05 * noise(rng, 1, H, 2, H // 5)[:, :1]
    ends = 0.985 - tail * row**1.6
    alpha *= ramp(starts, starts + 0.012, u) * (1 - ramp(ends - 0.03, ends, u))

    # Dry gaps: long thin streaks, more of them late in the stroke and near its edges.
    streaks = 0.65 * noise(rng, W, H, 6, H // 2) + 0.35 * noise(rng, W, H, 18, H // 1.2)
    want = dry * (0.15 + 0.85 * u**2.2) * (0.25 + 0.75 * from_middle**1.5)
    alpha *= ramp(want - 0.12, want - 0.02, streaks)

    spots = []
    for _ in range(flecks):
        at = rng.choice([rng.uniform(0.0, 0.12), rng.uniform(0.75, 1.0)], p=[0.3, 0.7])
        side = rng.choice([-1, 1])
        away = min(0.46, rng.uniform(0.7, 1.35) * thickness) * side
        r = H * 0.012 * (1 + rng.pareto(2.2))
        spots.append((at * W, (0.5 + away) * H, min(r, H * 0.07), rng.uniform(1, 2.6), rng.uniform(-25, 25)))
    alpha = np.maximum(alpha, droplets(rng, W, H, spots))
    return alpha


def splat(seed, size, reach=0.24, arms=9, flecks=70):
    """Paint thrown at the surface: a body, arms flung out of it, and spray."""
    rng = np.random.default_rng(seed)
    S = size * OVERSAMPLE
    ys, xs = np.mgrid[0:S, 0:S].astype(np.float32)
    dx, dy = xs / S - 0.5, ys / S - 0.5
    far = np.hypot(dx, dy)
    turn = np.arctan2(dy, dx)

    edge = np.full_like(far, reach)
    for k in range(1, 6):
        edge += reach * 0.22 / k * np.sin(k * turn + rng.uniform(0, 6.283))
    spots = []
    for _ in range(arms):
        way = rng.uniform(-np.pi, np.pi)
        length = rng.uniform(0.25, 0.9) * reach
        width = rng.uniform(0.025, 0.07)
        gap = np.angle(np.exp(1j * (turn - way)))
        edge += length * np.exp(-((gap / width) ** 2))
        # What left the arm and kept going.
        out = reach + length
        for _ in range(rng.integers(1, 5)):
            out += rng.uniform(0.02, 0.07)
            if out > 0.48:
                break
            r = S * rng.uniform(0.004, 0.014)
            spots.append((S * (0.5 + out * np.cos(way)), S * (0.5 + out * np.sin(way)), r, rng.uniform(1, 2.4), -np.degrees(way)))
    for _ in range(flecks):
        way = rng.uniform(-np.pi, np.pi)
        out = min(0.48, reach * rng.uniform(1.1, 2.0))
        r = S * 0.003 * (1 + rng.pareto(2.5))
        spots.append((S * (0.5 + out * np.cos(way)), S * (0.5 + out * np.sin(way)), min(r, S * 0.02), 1.0, 0))

    rough = (layered(rng, S, S, 14, 14) - 0.5) * 0.03
    alpha = ramp(0.0, 0.006, edge - far + rough)
    return np.maximum(alpha, droplets(rng, S, S, spots))


def splatter(seed, w, h, bodies=5, flecks=160, lean=1.3):
    """
    Nothing but thrown paint, for the back of a card: a few bodies of different
    sizes with spray between them. Broad and soft-edged enough to read as a
    stain, not as specks.
    """
    rng = np.random.default_rng(seed)
    W, H = w * OVERSAMPLE, h * OVERSAMPLE
    alpha = np.zeros((H, W), dtype=np.float32)
    for i in range(bodies):
        size = int(h * rng.uniform(0.7, 1.3) * (1.5 if i == 0 else 1.0))
        body = splat(int(rng.integers(1 << 30)), size, reach=rng.uniform(0.2, 0.3), arms=int(rng.integers(5, 10)), flecks=30)
        S = body.shape[0]
        x = int((1 - rng.random() ** lean * 0.9) * W - S / 2)
        y = int(rng.uniform(0.1, 0.9) * H - S / 2)
        x0, y0, x1, y1 = max(x, 0), max(y, 0), min(x + S, W), min(y + S, H)
        if x1 > x0 and y1 > y0:
            alpha[y0:y1, x0:x1] = np.maximum(alpha[y0:y1, x0:x1], body[y0 - y : y1 - y, x0 - x : x1 - x])
    spots = []
    for _ in range(flecks):
        x = 1 - rng.random() ** lean
        r = H * 0.006 * (1 + rng.pareto(2.3)) * (0.5 + x)
        spots.append((x * W, rng.random() * H, float(np.clip(r, 1, H * 0.03)), rng.uniform(1, 2.2), rng.uniform(0, 180)))
    return np.maximum(alpha, droplets(rng, W, H, spots))


def ground(seed, w, h, lean=-14):
    """
    The floor of the whole screen: blotchy paint dragged over by a wide dry
    brush, on the same lean as the slanted plates, with paint thrown across
    it. Soft and continuous, not a cut-out, so it is laid on faintly.
    """
    rng = np.random.default_rng(seed)
    W, H = int(w * 1.5), int(h * 1.9)
    blotch = ramp(0.32, 0.78, layered(rng, W, H, 5, 5, layers=5))
    drag = 0.6 * noise(rng, W, H, 3, H // 5) + 0.4 * noise(rng, W, H, 9, H // 2)
    paint = blotch * (0.3 + 0.7 * ramp(0.3, 0.72, drag))
    thrown = np.zeros((H, W), dtype=np.float32)
    for _ in range(9):
        size = int(h * rng.uniform(0.25, 0.8)) // OVERSAMPLE
        body = splat(int(rng.integers(1 << 30)), size, reach=rng.uniform(0.16, 0.26), arms=int(rng.integers(7, 14)), flecks=90)
        S = body.shape[0]
        x, y = int(rng.uniform(0.15, 0.85) * W - S / 2), int(rng.uniform(0.2, 0.8) * H - S / 2)
        thrown[y : y + S, x : x + S] = np.maximum(thrown[y : y + S, x : x + S], body * rng.uniform(0.35, 0.8))
    fine = [(rng.random() * W, rng.random() * H, float(np.clip(h * 0.0012 * (1 + rng.pareto(2.2)), 1, h * 0.012)), rng.uniform(1, 2.4), lean + rng.uniform(-30, 30)) for _ in range(2600)]
    thrown = np.maximum(thrown, droplets(rng, W, H, fine) * 0.55)
    both = Image.fromarray((np.clip(np.maximum(paint, thrown), 0, 1) * 255).astype(np.uint8))
    both = both.rotate(lean, resample=Image.BICUBIC)
    left, top = (W - w) // 2, (H - h) // 2
    return np.asarray(both.crop((left, top, left + w, top + h)), dtype=np.float32) / 255


def grain(seed, size):
    """Fine tooth, like the surface the paint is on. Its edges meet, so it repeats."""
    rng = np.random.default_rng(seed)
    specks = Image.fromarray((rng.random((size, size)) * 255).astype(np.uint8))
    tiled = Image.new("L", (size * 3, size * 3))
    for i in range(3):
        for j in range(3):
            tiled.paste(specks, (i * size, j * size))
    soft = tiled.filter(ImageFilter.GaussianBlur(0.7)).crop((size, size, size * 2, size * 2))
    return ramp(0.38, 0.62, np.asarray(soft, dtype=np.float32) / 255)


def dab(seed, w, h, arms=9, flecks=46):
    """
    Paint put down in one press, for a button: a body that fills most of the
    shape, so the button's word sits on solid paint, with a thrown edge.
    """
    rng = np.random.default_rng(seed)
    W, H = w * OVERSAMPLE, h * OVERSAMPLE
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    dx, dy = (xs / W - 0.5) / 0.4, (ys / H - 0.5) / 0.33
    far = (np.abs(dx) ** 3.2 + np.abs(dy) ** 3.2) ** (1 / 3.2)
    turn = np.arctan2(dy, dx)

    edge = np.ones_like(far)
    for k in range(2, 7):
        edge += 0.05 / k * np.sin(k * turn + rng.uniform(0, 6.283))
    spots = []
    for _ in range(arms):
        way = rng.uniform(-np.pi, np.pi)
        length = rng.uniform(0.08, 0.3)
        gap = np.angle(np.exp(1j * (turn - way)))
        edge += length * np.exp(-((gap / rng.uniform(0.03, 0.09)) ** 2))
    for _ in range(flecks):
        way = rng.uniform(-np.pi, np.pi)
        out = rng.uniform(1.08, 1.5)
        x, y = 0.5 + out * 0.4 * np.cos(way), 0.5 + out * 0.33 * np.sin(way)
        if 0.02 < x < 0.98 and 0.04 < y < 0.96:
            r = H * 0.012 * (1 + rng.pareto(2.4))
            spots.append((x * W, y * H, min(r, H * 0.06), rng.uniform(1, 2.2), rng.uniform(0, 180)))
    rough = (layered(rng, W, H, 18, 6) - 0.5) * 0.22
    alpha = ramp(0.0, 0.03, edge - far + rough)
    return np.maximum(alpha, droplets(rng, W, H, spots))


def scatter(seed, w, h, solid=0.76, flecks=700):
    """
    Solid paint at the left that breaks up to the right: first holes in it,
    then islands, then only drops. No brush in it.
    """
    rng = np.random.default_rng(seed)
    W, H = w * OVERSAMPLE, h * OVERSAMPLE
    u = (np.mgrid[0:H, 0:W][1] / W).astype(np.float32)
    cover = 1 - ramp(solid, 0.97, u)
    lumps = 0.55 * layered(rng, W, H, 26, 7, layers=3) + 0.45 * noise(rng, W, H, 90, 24)
    alpha = ramp(-0.02, 0.02, cover * 1.25 - 0.12 - lumps)
    alpha = np.where(u < solid - 0.06, 1.0, alpha).astype(np.float32)
    spots = []
    for _ in range(flecks):
        x = solid + (1 - solid) * rng.random() ** 1.5
        r = H * 0.011 * (1 + rng.pareto(2.2)) * (1.25 - x)
        spots.append((x * W, rng.random() * H, float(np.clip(r, 1, H * 0.06)), rng.uniform(1, 1.7), rng.uniform(0, 180)))
    return np.maximum(alpha, droplets(rng, W, H, spots))


def spray(seed, size, flecks=420):
    """Only the spray: fine at the top left, thinning toward the bottom right."""
    rng = np.random.default_rng(seed)
    S = size * OVERSAMPLE
    spots = []
    for _ in range(flecks):
        x, y = rng.beta(1.2, 2.6), rng.beta(1.2, 2.6)
        r = S * 0.0018 * (1 + rng.pareto(2.4)) * (1.3 - x - y * 0.3)
        spots.append((x * S, y * S, float(np.clip(r, 1, S * 0.012)), rng.uniform(1, 1.8), rng.uniform(0, 180)))
    return droplets(rng, S, S, spots)


def coats(alpha, rng, under=0.42, reach=0.07, uneven=0.12):
    """
    Paint in more than one coat. The body is a little uneven within itself,
    and a thinner coat lies under it and runs out past its edge.
    """
    H, W = alpha.shape
    across, down = 24, max(4, 24 * H // W)
    blur = ImageFilter.GaussianBlur(max(2, int(min(H, W) * reach)))
    spread = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(blur), dtype=np.float32) / 255
    thin = ramp(0.0, 0.05, spread + (layered(rng, W, H, across, down) - 0.5) * 0.55 - 0.2)
    body = alpha * (1 - uneven * ramp(0.35, 0.75, layered(rng, W, H, across // 2, max(3, down // 2))))
    return np.maximum(body, thin * under)


# ----------------------------------------------------------------- metal


def brushed(rng, W, H):
    """The grain a wire brush leaves: long, fine, all one way."""
    return 0.5 * noise(rng, W, H, 3, H // 3) + 0.3 * noise(rng, W, H, 8, H // 1.5) + 0.2 * noise(rng, W, H, 40, H)


def plate(seed, w, h, cuts=(0.5, 0.0, 0.5, 0.0), lean=0.0, inset=0.06, notch=0.0, loose=0):
    """
    A piece of cut plate. cuts are the four corners, clockwise from the top
    left, each as a share of the height taken off that corner. lean slants
    the ends. notch takes a bite out of the top edge. loose is how many small
    pieces sit apart from it at the right.
    """
    rng = np.random.default_rng(seed)
    W, H = w * OVERSAMPLE, h * OVERSAMPLE
    picture = Image.new("L", (W, H), 0)
    draw = ImageDraw.Draw(picture)
    top, bottom = H * inset * 2, H * (1 - inset * 2)
    tall = bottom - top
    left = W * inset / 2 + max(0.0, lean) * tall
    right = W * (1 - inset / 2) - loose * tall * 0.75
    slant = lean * tall
    a, b, c, d = (k * tall for k in cuts)
    shape = [(left + a, top), (right + slant - b, top), (right + slant, top + b), (right, bottom - c) if c == 0 else (right - c * 0 , bottom - c), (right - c, bottom), (left - slant + d, bottom), (left - slant, bottom - d), (left, top + a)]
    draw.polygon(shape, fill=255)
    if notch:
        at = left + (right - left) * rng.uniform(0.55, 0.8)
        wide = tall * notch * 3
        draw.polygon([(at, top - 1), (at + wide, top - 1), (at + wide - tall * notch, top + tall * notch), (at + tall * notch, top + tall * notch)], fill=0)
    x = right + slant + tall * 0.22
    for i in range(loose):
        wide = tall * (0.34 - 0.1 * i)
        draw.polygon([(x, top), (x + wide, top), (x + wide - slant, bottom), (x - slant, bottom)], fill=int(255 * (0.8 - 0.25 * i)))
        x += wide + tall * 0.2
    alpha = np.asarray(picture, dtype=np.float32) / 255
    return alpha * (0.8 + 0.2 * brushed(rng, W, H))


def scratched(rng, W, H, count, light=(90, 255)):
    picture = Image.new("L", (W, H), 0)
    draw = ImageDraw.Draw(picture)
    for _ in range(count):
        x, y = rng.uniform(-0.1, 1.0) * W, rng.random() * H
        long = W * rng.uniform(0.04, 0.4)
        turn = np.radians(-14 + rng.normal(0, 9))
        draw.line([(x, y), (x + long * np.cos(turn), y + long * np.sin(turn))], fill=int(rng.uniform(*light)), width=max(1, int(rng.choice([1, 1, 2, 3])) * OVERSAMPLE // 2))
    return np.asarray(picture, dtype=np.float32) / 255


def slab(seed, w, h, inset=0.08, scratches=12):
    """
    A plain piece of plate with nothing cut out of it. What marks it is use:
    the brush, a chipped edge, and scratches through to what is under it.
    """
    rng = np.random.default_rng(seed)
    W, H = w * OVERSAMPLE, h * OVERSAMPLE
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    side = np.minimum(xs, W - xs) / H - inset * 0.6
    level = np.minimum(ys, H - ys) / H - inset * 1.6
    chipped = (layered(rng, W, H, 48, 10) - 0.5) * 0.09
    body = ramp(0.0, 0.015, np.minimum(side, level) + chipped)
    return body * (0.74 + 0.26 * brushed(rng, W, H)) * (1 - 0.55 * scratched(rng, W, H, scratches))


def worn_off(seed, w, h, solid=0.8):
    """Plate that is whole at the left and worn through to the right, then only scratches."""
    rng = np.random.default_rng(seed)
    W, H = w * OVERSAMPLE, h * OVERSAMPLE
    u = (np.mgrid[0:H, 0:W][1] / W).astype(np.float32)
    left = 1 - ramp(solid - 0.08, 0.99, u)
    scuff = 0.6 * layered(rng, W, H, 16, 5) + 0.4 * brushed(rng, W, H)
    alpha = ramp(-0.1, 0.1, left * 1.3 - 0.16 - scuff)
    alpha = np.where(u < solid - 0.1, 1.0, alpha) * (0.74 + 0.26 * brushed(rng, W, H))
    marks = scratched(rng, W, H, 60) * ramp(solid - 0.2, solid, u)
    return np.maximum(alpha * (1 - 0.5 * scratched(rng, W, H, 16)), marks * 0.8)


def wear(seed, w, h, scratches=70):
    """What use does to plate: scuffed patches and scratches, most of them the way the hand moves."""
    rng = np.random.default_rng(seed)
    W, H = w * OVERSAMPLE, h * OVERSAMPLE
    scuff = ramp(0.55, 0.8, layered(rng, W, H, 9, 4)) * (0.35 + 0.65 * brushed(rng, W, H)) * 0.7
    picture = Image.new("L", (W, H), 0)
    draw = ImageDraw.Draw(picture)
    for _ in range(scratches):
        x, y = rng.uniform(-0.1, 1.0) * W, rng.random() * H
        long = W * rng.uniform(0.04, 0.4)
        turn = np.radians(-14 + rng.normal(0, 9))
        draw.line([(x, y), (x + long * np.cos(turn), y + long * np.sin(turn))], fill=int(rng.uniform(90, 255)), width=int(rng.choice([1, 1, 2, 3])) * OVERSAMPLE // 2 or 1)
    return np.maximum(scuff, np.asarray(picture, dtype=np.float32) / 255)


def halftone(seed, w, h, solid=0.74, pitch=0.085):
    """Solid plate at the left, drilled to the right: the holes grow until only dots of plate are left."""
    rng = np.random.default_rng(seed)
    W, H = w * OVERSAMPLE, h * OVERSAMPLE
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    step = H * pitch
    row = np.floor(ys / step)
    shifted = xs + (row % 2) * step / 2
    cx = (np.floor(shifted / step) + 0.5) * step - (row % 2) * step / 2
    cy = (row + 0.5) * step
    far = np.hypot(xs - cx, ys - cy) / (step * 0.72)
    left = 1 - ramp(solid - 0.04, 0.99, cx / W)
    alpha = ramp(-0.04, 0.04, left * 1.45 - far)
    alpha = np.where(xs / W < solid - 0.06, 1.0, alpha)
    return alpha * (0.8 + 0.2 * brushed(rng, W, H))


def metal_ground(seed, w, h):
    """Sheet laid in panels, each brushed, no two quite the same tone."""
    rng = np.random.default_rng(seed)
    base = 0.25 + 0.5 * brushed(rng, w, h)
    tone = np.zeros((h, w), dtype=np.float32)
    x = 0
    while x < w:
        wide = int(w * rng.uniform(0.12, 0.3))
        y = 0
        while y < h:
            tall = int(h * rng.uniform(0.2, 0.55))
            tone[y : y + tall - 3, x : x + wide - 3] = rng.uniform(0.35, 1.0)
            y += tall
        x += wide
    turned = Image.fromarray((np.clip(base * tone, 0, 1) * 255).astype(np.uint8)).resize((int(w * 1.3), int(h * 1.3))).rotate(-14, resample=Image.BICUBIC)
    left, top = (turned.width - w) // 2, (turned.height - h) // 2
    return np.maximum(np.asarray(turned.crop((left, top, left + w, top + h)), dtype=np.float32) / 255, wear(seed + 1, w // OVERSAMPLE, h // OVERSAMPLE, 260) * 0.5)


def shards(seed, size, count=26):
    """What flies off struck plate: thin slivers, outward, none at the middle."""
    rng = np.random.default_rng(seed)
    S = size * OVERSAMPLE
    picture = Image.new("L", (S, S), 0)
    draw = ImageDraw.Draw(picture)
    for _ in range(count):
        way = rng.uniform(0, 2 * np.pi)
        near, far = S * rng.uniform(0.2, 0.3), S * rng.uniform(0.32, 0.49)
        half = rng.uniform(0.012, 0.05)
        draw.polygon([(S / 2 + near * np.cos(way - half), S / 2 + near * np.sin(way - half)), (S / 2 + near * np.cos(way + half), S / 2 + near * np.sin(way + half)), (S / 2 + far * np.cos(way), S / 2 + far * np.sin(way))], fill=255)
    return np.asarray(picture, dtype=np.float32) / 255


# ------------------------------------------------------------------- hex


def cells(seed, w, h, size, cover, gap=0.1, vary=0.3):
    """
    Plating in six-sided cells. cover says, for every point, how likely the
    cell there is to be present: 1 is always, 0 is never. Where cover is
    whole the cells close up into one solid piece, so words can sit on it.
    """
    rng = np.random.default_rng(seed)
    W, H = w * OVERSAMPLE, h * OVERSAMPLE
    R = size * OVERSAMPLE
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    q = (np.sqrt(3) / 3 * xs - ys / 3) / R
    r = (2 / 3 * ys) / R
    x3, z3 = q, r
    y3 = -x3 - z3
    rx, ry, rz = np.round(x3), np.round(y3), np.round(z3)
    dx, dy, dz = np.abs(rx - x3), np.abs(ry - y3), np.abs(rz - z3)
    rx = np.where((dx > dy) & (dx > dz), -ry - rz, rx)
    rz = np.where(~((dx > dy) & (dx > dz)) & ~(dy > dz), -rx - ry, rz)
    cx, cy = R * np.sqrt(3) * (rx + rz / 2), R * 1.5 * rz
    ax, ay = np.abs(xs - cx), np.abs(ys - cy)
    far = np.maximum(ax, ax / 2 + ay * np.sqrt(3) / 2) / (R * np.sqrt(3) / 2)
    field = cover(np.clip(cx / W, 0, 1), np.clip(cy / H, 0, 1))
    table = rng.random((257, 263, 2)).astype(np.float32)
    chance = table[rx.astype(int) % 257, rz.astype(int) % 263]
    whole = field >= 0.999
    kept = field > chance[..., 0]
    inside = ramp(0.0, 0.05, np.where(whole, 1.06, 1 - gap) - far)
    return kept * inside * np.where(whole, 1.0, 1 - vary * chance[..., 1])


# Where the loose cells of a bar's end can sit, with the bar's height as 1
# and the end's point at the left. U and L lie against the two slopes of the
# point, T lies off the point itself, F lies beyond T.
CELL = 0.22
SPOTS = {"U": (0.3207, 0.2072), "L": (0.3207, 0.7928), "T": (0.152, 0.5), "F": (-0.208, 0.29)}


def bar_end(size, cells_at, side="left"):
    """
    One end of a bar in hex plating, drawn, not scattered. The bar itself ends
    in a point, as a cell does, and whole cells sit off it in fixed places:
    cells_at is which places, and how solid each is. The right end is the
    left end turned half way round, so the two ends of a bar answer each other.
    """
    w, h = size
    k = 4
    W, H = w * k, h * k
    picture = Image.new("L", (W, H), 0)
    draw = ImageDraw.Draw(picture)
    shift = w / h - 1
    top, bottom, start = 0.14, 0.86, 0.62
    point = (bottom - top) / 2 * np.tan(np.radians(30))
    at = lambda x, y: ((x + shift) * H, y * H)
    draw.polygon([at(1.01, top), at(start, top), at(start - point, 0.5), at(start, bottom), at(1.01, bottom)], fill=255)
    for place, solid in cells_at:
        cx, cy = SPOTS[place]
        draw.polygon([at(cx + CELL * np.cos(np.radians(a)), cy + CELL * np.sin(np.radians(a))) for a in range(0, 360, 60)], fill=int(255 * solid))
    if side == "right":
        picture = picture.rotate(180)
    return np.asarray(picture, dtype=np.float32) / 255


def cap(side, over=0.5):
    """One end of a bar: whole toward the middle of the bar, coming apart toward its end."""
    return lambda u, v: ramp(0.0, over, u if side == "left" else 1 - u)


def bar(ends=0.14, edge=0.55):
    """Whole in the middle, coming apart toward both ends and a little at the top and bottom."""
    return lambda u, v: np.clip(np.minimum(ramp(0.0, ends, u), 1 - ramp(1 - ends * 1.6, 1.0, u)) * (1 - ramp(edge, 1.05, np.abs(v - 0.5) * 2)) * 1.6, 0, 1)


def runs_out(solid):
    return lambda u, v: 1 - ramp(solid - 0.05, 0.98, u)


def patch_of(seed, lean=1.2):
    rng = np.random.default_rng(seed)
    blot = layered(rng, 96, 32, 5, 3)
    return lambda u, v: np.clip(ramp(0.42, 0.7, blot[(v * 31).astype(int), (u * 95).astype(int)]) * (0.35 + 0.65 * u**lean), 0, 0.97)


def ring(u, v):
    far = np.hypot(u - 0.5, v - 0.5) * 2
    return np.clip(ramp(0.4, 0.55, far) * (1 - ramp(0.6, 0.98, far)) * 0.8, 0, 0.97)


def one_cell(size):
    S = size * OVERSAMPLE
    picture = Image.new("L", (S, S), 0)
    ImageDraw.Draw(picture).regular_polygon((S / 2, S / 2, S * 0.4), 6, rotation=30, fill=255)
    return np.asarray(picture, dtype=np.float32) / 255


def hex_ground(seed, w, h):
    rng = np.random.default_rng(seed)
    blot = layered(rng, 160, 90, 6, 4)
    whole = cells(seed, w // OVERSAMPLE, h // OVERSAMPLE, 26, lambda u, v: 0.2 + 0.78 * ramp(0.3, 0.75, blot[(v * 89).astype(int), (u * 159).astype(int)]), gap=0.07, vary=0.75)
    return whole


#       name        what it is for                                   size        how it is made
LIBRARY = [
    ("stroke-a", "Behind a heading. Even, a little dry at the end.", (960, 120), lambda s: stroke(11, *s, thickness=0.36, dry=0.45)),
    ("stroke-b", "Behind a heading. Bowed, runs out early.", (960, 120), lambda s: stroke(23, *s, thickness=0.34, dry=0.7, bow=0.5, tail=0.3)),
    ("stroke-c", "Behind a heading. Heavy and wet, more flecks.", (960, 120), lambda s: stroke(37, *s, thickness=0.4, dry=0.2, bow=-0.3, flecks=30, tail=0.12)),
    ("swipe-a", "Behind a title or a figure. A wide dry swipe.", (960, 240), lambda s: stroke(41, *s, thickness=0.38, dry=0.85, bow=0.25, flecks=22, tail=0.35)),
    ("block-a", "Behind a panel. A broad ground with brushed ends.", (800, 400), lambda s: stroke(53, *s, thickness=0.36, dry=0.4, flecks=10, tail=0.1)),
    ("splat-a", "An accent under or beside something. Compact.", (512, 512), lambda s: splat(61, s[0], reach=0.2, arms=13)),
    ("splat-b", "An accent. Long arms, thrown harder.", (512, 512), lambda s: splat(79, s[0], reach=0.17, arms=14, flecks=110)),
    ("splatter-a", "Inside a card, behind its words.", (960, 320), lambda s: splatter(101, *s)),
    ("splatter-b", "Inside a card. Fewer bodies, more spray.", (960, 320), lambda s: splatter(113, *s, bodies=3, flecks=300, lean=1.0)),
    ("splatter-c", "Inside a card. Crowded toward the right.", (960, 320), lambda s: splatter(127, *s, bodies=7, flecks=120, lean=2.4)),
    ("ground-a", "Under everything, covering the screen. Used faintly.", (3200, 1800), lambda s: ground(131, *s)),
    ("grain-a", "Under everything, repeated. Used very faintly.", (256, 256), lambda s: grain(137, s[0])),
    ("dab-a", "A button.", (480, 144), lambda s: dab(149, *s)),
    ("dab-b", "A button.", (480, 144), lambda s: dab(151, *s, arms=6, flecks=70)),
    ("dab-c", "A button.", (480, 144), lambda s: dab(157, *s, arms=13, flecks=30)),
    ("dab-d", "A button.", (480, 144), lambda s: dab(163, *s, arms=8, flecks=55)),
    ("scatter-a", "Behind a title at the edge of the screen. Solid, breaking into drops.", (960, 240), lambda s: scatter(167, *s)),
    ("spray-a", "An accent. Spray only, from the top left corner.", (512, 512), lambda s: spray(83, s[0])),
    # Metal. Plain plate; what marks it is wear.
    ("metal-head-a", "Behind a heading.", (960, 120), lambda s: slab(211, *s)),
    ("metal-head-b", "Behind a heading.", (960, 120), lambda s: slab(223, *s, scratches=20)),
    ("metal-head-c", "Behind a heading.", (960, 120), lambda s: slab(227, *s, scratches=7)),
    ("metal-button-a", "A button.", (480, 144), lambda s: slab(229, *s, inset=0.1, scratches=6)),
    ("metal-button-b", "A button.", (480, 144), lambda s: slab(233, *s, inset=0.1, scratches=10)),
    ("metal-button-c", "A button.", (480, 144), lambda s: slab(239, *s, inset=0.1, scratches=4)),
    ("metal-button-d", "A button.", (480, 144), lambda s: slab(241, *s, inset=0.1, scratches=8)),
    ("metal-stain-a", "Inside a card: wear.", (960, 320), lambda s: wear(251, *s)),
    ("metal-stain-b", "Inside a card: wear.", (960, 320), lambda s: wear(257, *s, scratches=40)),
    ("metal-stain-c", "Inside a card: wear.", (960, 320), lambda s: wear(263, *s, scratches=110)),
    ("metal-title-a", "Behind a title at the edge of the screen. Whole, then worn through.", (960, 240), lambda s: worn_off(269, *s)),
    ("metal-ground-a", "Under everything.", (3200, 1800), lambda s: metal_ground(271, *s)),
    ("metal-chip-a", "A small mark.", (128, 128), lambda s: slab(277, *s, inset=0.12, scratches=3)),
    ("metal-chip-b", "A small mark.", (128, 128), lambda s: slab(281, *s, inset=0.12, scratches=5)),
    ("metal-burst-a", "What flies off a button.", (512, 512), lambda s: shards(283, s[0])),
    # Hex. A cell is never drawn smaller than it is in a card, and never
    # stretched: a bar is two ends with whatever length of solid between.
    # On headings and buttons every cell is the same size, and sits in a fixed place.
    ("hex-head-a", "The left end of a heading.", (216, 144), lambda s: bar_end(s, [('U', 1.0), ('L', 1.0), ('T', 0.6), ('F', 0.4)])),
    ("hex-head-a-r", "The right end of a heading.", (216, 144), lambda s: bar_end(s, [('U', 1.0), ('L', 1.0), ('T', 0.6), ('F', 0.4)], "right")),
    ("hex-head-b", "The left end of a heading.", (216, 144), lambda s: bar_end(s, [('U', 1.0), ('T', 0.6)])),
    ("hex-head-b-r", "The right end of a heading.", (216, 144), lambda s: bar_end(s, [('U', 1.0), ('T', 0.6)], "right")),
    ("hex-head-c", "The left end of a heading.", (216, 144), lambda s: bar_end(s, [('L', 1.0), ('T', 1.0), ('F', 0.5)])),
    ("hex-head-c-r", "The right end of a heading.", (216, 144), lambda s: bar_end(s, [('L', 1.0), ('T', 1.0), ('F', 0.5)], "right")),
    ("hex-button-a", "The left end of a button.", (216, 144), lambda s: bar_end(s, [('U', 1.0), ('T', 0.6)])),
    ("hex-button-a-r", "The right end of a button.", (216, 144), lambda s: bar_end(s, [('U', 1.0), ('T', 0.6)], "right")),
    ("hex-button-b", "The left end of a button.", (216, 144), lambda s: bar_end(s, [('L', 1.0), ('T', 1.0), ('F', 0.5)])),
    ("hex-button-b-r", "The right end of a button.", (216, 144), lambda s: bar_end(s, [('L', 1.0), ('T', 1.0), ('F', 0.5)], "right")),
    ("hex-button-c", "The left end of a button.", (216, 144), lambda s: bar_end(s, [('U', 1.0), ('L', 0.6)])),
    ("hex-button-c-r", "The right end of a button.", (216, 144), lambda s: bar_end(s, [('U', 1.0), ('L', 0.6)], "right")),
    ("hex-button-d", "The left end of a button.", (216, 144), lambda s: bar_end(s, [])),
    ("hex-button-d-r", "The right end of a button.", (216, 144), lambda s: bar_end(s, [], "right")),
    ("hex-stain-a", "Inside a card: loose plating.", (960, 320), lambda s: cells(349, *s, 22, patch_of(349), gap=0.12, vary=0.6)),
    ("hex-stain-b", "Inside a card: loose plating.", (960, 320), lambda s: cells(353, *s, 30, patch_of(353, 0.6), gap=0.12, vary=0.6)),
    ("hex-stain-c", "Inside a card: loose plating.", (960, 320), lambda s: cells(359, *s, 22, patch_of(359, 2.0), gap=0.12, vary=0.6)),
    ("hex-title-a", "The right end of a title at the edge of the screen.", (960, 240), lambda s: cells(367, *s, 19, runs_out(0.9))),
    ("hex-ground-a", "Under everything.", (3200, 1800), lambda s: hex_ground(373, *s)),
    ("hex-chip-a", "A small mark.", (128, 128), lambda s: one_cell(s[0])),
    ("hex-chip-b", "A small mark.", (128, 128), lambda s: one_cell(s[0])),
    ("hex-burst-a", "What flies off a button.", (512, 512), lambda s: cells(379, s[0], s[1], 40, ring, gap=0.14, vary=0.5)),
]

# Paint that is laid on in more than one coat.
COATED = {"stroke-a", "stroke-b", "stroke-c", "swipe-a", "block-a", "splat-a", "splat-b", "splatter-a", "splatter-b", "splatter-c", "dab-a", "dab-b", "dab-c", "dab-d", "scatter-a"}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, _, size, make in LIBRARY:
        alpha = np.clip(make(size), 0, 1).astype(np.float32)
        if name in COATED:
            alpha = coats(alpha, np.random.default_rng(zlib.crc32(name.encode())))
        picture = np.full((*alpha.shape, 4), 255, dtype=np.uint8)
        picture[..., 3] = (alpha * 255).astype(np.uint8)
        Image.fromarray(picture, "RGBA").resize(size, Image.LANCZOS).quantize(256, method=Image.FASTOCTREE, dither=Image.NONE).save(OUT / f"{name}.png", optimize=True)
        print(f"{name}.png  {size[0]}x{size[1]}  {(OUT / f'{name}.png').stat().st_size // 1024} kB")


if __name__ == "__main__":
    main()
