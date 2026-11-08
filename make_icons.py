"""Erzeugt die App-Icons (Schale mit Dampf, Türkis auf Dunkel) – Aufruf: python3 make_icons.py"""
import math
from PIL import Image, ImageDraw

BG = (11, 15, 20, 255)
ACCENT = (20, 184, 166, 255)
S = 2048  # groß zeichnen, dann verkleinern (Kantenglättung)


def stroke(draw, pts, w):
    # dicht gesetzte Kreise ergeben eine glatte, runde Linie
    for x, y in pts:
        draw.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill=ACCENT)


def make(size):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 0.22), fill=BG)

    w = int(S * 0.075)
    cx = S / 2
    rim_y = S * 0.53
    r = S * 0.30
    # Schale: untere Halbellipse, gefüllt
    d.pieslice((cx - r, rim_y - r * 0.92, cx + r, rim_y + r * 0.92), 0, 180, fill=ACCENT)
    # Rand
    d.rounded_rectangle((cx - r - w * 0.35, rim_y - w * 0.5, cx + r + w * 0.35, rim_y + w * 0.5),
                        radius=w / 2, fill=ACCENT)
    # Dampf: drei Wellenlinien
    for dx in (-0.14, 0.0, 0.14):
        x0 = cx + dx * S
        top, bottom = S * 0.20, S * 0.41
        pts = []
        for i in range(401):
            t = i / 400
            y = bottom - (bottom - top) * t
            x = x0 + math.sin(t * 2 * math.pi) * S * 0.028
            pts.append((x, y))
        stroke(d, pts, int(w * 0.62))

    return img.resize((size, size), Image.LANCZOS)


for n in (180, 192, 512):
    make(n).save(f"icon-{n}.png")
print("ok")
