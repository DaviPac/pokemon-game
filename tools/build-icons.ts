/**
 * Gera os icones do PWA. Sao formas geometricas desenhadas aqui (circulos e
 * uma faixa), nao um sprite do jogo -- icone de app e interface, nao asset.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const OUT = join(process.cwd(), 'public', 'icons');

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const RED: Rgb = { r: 226, g: 62, b: 62 };
const WHITE: Rgb = { r: 244, g: 246, b: 250 };
const BLACK: Rgb = { r: 22, g: 25, b: 32 };
const BACKDROP: Rgb = { r: 13, g: 17, b: 23 };

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'icon-192.png'), render(192, 0.82));
  await writeFile(join(OUT, 'icon-512.png'), render(512, 0.82));
  // Maskable precisa de margem: o sistema pode recortar as bordas.
  await writeFile(join(OUT, 'icon-maskable-512.png'), render(512, 0.62));
  await writeFile(join(OUT, 'apple-touch-icon.png'), render(180, 0.82));
  console.log('[icons] 4 icones gerados em public/icons');
}

function render(size: number, ballScale: number): Buffer {
  const png = new PNG({ width: size, height: size });
  const center = size / 2;
  const radius = (size / 2) * ballScale;
  const bandHalf = radius * 0.1;
  const buttonOuter = radius * 0.3;
  const buttonInner = radius * 0.17;
  // Antialiasing simples: 3x3 amostras por pixel.
  const samples = 3;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = x + (sx + 0.5) / samples;
          const py = y + (sy + 0.5) / samples;
          const color = colorAt(px - center, py - center, {
            radius,
            bandHalf,
            buttonOuter,
            buttonInner,
          });
          r += color.r;
          g += color.g;
          b += color.b;
        }
      }

      const total = samples * samples;
      const offset = (y * size + x) * 4;
      png.data[offset] = Math.round(r / total);
      png.data[offset + 1] = Math.round(g / total);
      png.data[offset + 2] = Math.round(b / total);
      png.data[offset + 3] = 255;
    }
  }

  return PNG.sync.write(png);
}

function colorAt(
  dx: number,
  dy: number,
  geometry: { radius: number; bandHalf: number; buttonOuter: number; buttonInner: number },
): Rgb {
  const distance = Math.hypot(dx, dy);
  if (distance > geometry.radius) return BACKDROP;
  if (distance > geometry.radius * 0.94) return BLACK;
  if (distance <= geometry.buttonInner) return WHITE;
  if (distance <= geometry.buttonOuter) return BLACK;
  if (Math.abs(dy) <= geometry.bandHalf) return BLACK;
  return dy < 0 ? RED : WHITE;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
