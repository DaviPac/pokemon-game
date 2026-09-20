/**
 * Renderiza um mapa inteiro num PNG, para conferir o pipeline sem abrir o jogo.
 * Uso: npx tsx tools/preview-map.ts MAP_PALLET_TOWN saida.png
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const METATILE = 16;
const ASSETS = join(process.cwd(), 'public', 'assets');

async function main(): Promise<void> {
  const mapId = process.argv[2] ?? 'MAP_PALLET_TOWN';
  const out = process.argv[3] ?? 'preview.png';

  const map = JSON.parse(await readFile(join(ASSETS, 'data', 'maps', `${mapId}.json`), 'utf8'));
  const { tilesets } = JSON.parse(await readFile(join(ASSETS, 'data', 'tilesets.json'), 'utf8'));

  const primary = tilesets[map.primary];
  const secondary = map.secondary ? tilesets[map.secondary] : null;
  const atlases = new Map<string, PNG>();
  for (const meta of [primary, secondary]) {
    if (meta && !atlases.has(meta.atlas)) {
      atlases.set(meta.atlas, PNG.sync.read(await readFile(join(ASSETS, 'tilesets', meta.atlas))));
    }
  }

  const raw = Buffer.from(map.metatiles, 'base64');
  const metatiles = new Uint16Array(raw.buffer, raw.byteOffset, raw.length / 2);
  const png = new PNG({ width: map.width * METATILE, height: map.height * METATILE });

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const id = metatiles[y * map.width + x];
      const fromSecondary = id >= 640;
      const meta = fromSecondary ? secondary : primary;
      if (!meta) continue;
      const atlas = atlases.get(meta.atlas)!;
      const local = fromSecondary ? id - 640 : id;
      const sx = (local % meta.columns) * METATILE;
      const sy = Math.floor(local / meta.columns) * METATILE;
      blit(atlas, png, sx, sy, x * METATILE, y * METATILE);
    }
  }

  await writeFile(out, PNG.sync.write(png));
  console.log(`${out} (${png.width}x${png.height}) — ${map.name}`);
}

function blit(src: PNG, dst: PNG, sx: number, sy: number, dx: number, dy: number): void {
  for (let y = 0; y < METATILE; y++) {
    for (let x = 0; x < METATILE; x++) {
      if (sy + y >= src.height || sx + x >= src.width) continue;
      const s = ((sy + y) * src.width + (sx + x)) * 4;
      const d = ((dy + y) * dst.width + (dx + x)) * 4;
      if (src.data[s + 3] === 0) continue;
      dst.data[d] = src.data[s];
      dst.data[d + 1] = src.data[s + 1];
      dst.data[d + 2] = src.data[s + 2];
      dst.data[d + 3] = 255;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
