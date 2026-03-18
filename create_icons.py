"""
Generate PNG icons for the Ad Scanner browser extension.
Usage: python3 create_icons.py
Creates: icons/icon16.png, icons/icon48.png, icons/icon128.png
"""
import struct
import zlib
import os
import math


def encode_png(width: int, height: int, pixels: list[list[tuple[int,int,int,int]]]) -> bytes:
    """Encode RGBA pixel array as a valid PNG file."""
    def make_chunk(tag: bytes, data: bytes) -> bytes:
        length = struct.pack('>I', len(data))
        payload = tag + data
        crc = struct.pack('>I', zlib.crc32(payload) & 0xFFFFFFFF)
        return length + payload + crc

    # IHDR: width, height, bit_depth=8, color_type=6(RGBA), compress=0, filter=0, interlace=0
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    ihdr = make_chunk(b'IHDR', ihdr_data)

    # IDAT: raw scanlines, each prefixed with filter byte 0
    raw_rows = bytearray()
    for row in pixels:
        raw_rows.append(0)  # filter type None
        for (r, g, b, a) in row:
            raw_rows.extend([r, g, b, a])

    idat = make_chunk(b'IDAT', zlib.compress(bytes(raw_rows), 9))

    iend = make_chunk(b'IEND', b'')

    return b'\x89PNG\r\n\x1a\n' + ihdr + idat + iend


def lerp(a, b, t):
    return a + (b - a) * t


def clamp(v, lo=0, hi=255):
    return max(lo, min(hi, int(v)))


def draw_icon(size: int) -> list[list[tuple[int,int,int,int]]]:
    """
    Draw a radar/scan icon on a rounded-rect dark background.
    - Dark navy background with rounded corners
    - Blue radar rings + center dot
    """
    cx, cy = size / 2, size / 2
    radius = size / 2 - 1

    # Colors
    BG       = (10,  14,  32)   # dark navy
    RING1    = (59,  130, 246)  # blue-500
    RING2    = (37,  99,  235)  # blue-600
    DOT      = (147, 197, 253)  # blue-300

    pixels = []
    for y in range(size):
        row = []
        for x in range(size):
            dx, dy = x - cx, y - cy
            dist = math.sqrt(dx*dx + dy*dy)

            # Rounded rect mask (alpha)
            corner_r = size * 0.22
            in_circle_region = dist <= radius

            # For a rounded-rect effect, use the circle for now (clean circle icon)
            if dist > radius:
                row.append((0, 0, 0, 0))  # fully transparent
                continue

            # Anti-aliased edge
            edge_aa = 1.0
            if dist > radius - 1.2:
                edge_aa = (radius - dist) / 1.2
                edge_aa = max(0.0, min(1.0, edge_aa))

            # Background
            r, g, b = BG

            # Outer ring  (radius ~40% of icon)
            r1 = radius * 0.72
            ring_w = max(1.2, size * 0.045)
            d1 = abs(dist - r1)
            if d1 < ring_w:
                t = 1.0 - d1 / ring_w
                t = t * t
                r = clamp(lerp(r, RING1[0], t * 0.9))
                g = clamp(lerp(g, RING1[1], t * 0.9))
                b = clamp(lerp(b, RING1[2], t * 0.9))

            # Inner ring (radius ~25%)
            r2 = radius * 0.45
            d2 = abs(dist - r2)
            if d2 < ring_w * 0.75:
                t = 1.0 - d2 / (ring_w * 0.75)
                t = t * t
                r = clamp(lerp(r, RING2[0], t * 0.75))
                g = clamp(lerp(g, RING2[1], t * 0.75))
                b = clamp(lerp(b, RING2[2], t * 0.75))

            # Center dot
            dot_r = max(1.5, size * 0.09)
            if dist < dot_r:
                t = 1.0 - dist / dot_r
                r = clamp(lerp(r, DOT[0], t))
                g = clamp(lerp(g, DOT[1], t))
                b = clamp(lerp(b, DOT[2], t))

            # Subtle glow behind rings (soft radial gradient)
            glow_t = max(0.0, 1.0 - dist / radius) * 0.15
            r = clamp(r + RING1[0] * glow_t)
            g = clamp(g + RING1[1] * glow_t)
            b = clamp(b + RING1[2] * glow_t)

            alpha = clamp(255 * edge_aa)
            row.append((clamp(r), clamp(g), clamp(b), alpha))
        pixels.append(row)

    return pixels


def main():
    os.makedirs('icons', exist_ok=True)
    for size in [16, 48, 128]:
        pixels = draw_icon(size)
        png_bytes = encode_png(size, size, pixels)
        path = f'icons/icon{size}.png'
        with open(path, 'wb') as f:
            f.write(png_bytes)
        print(f'  Created {path}  ({len(png_bytes)} bytes)')
    print('Done.')


if __name__ == '__main__':
    main()
