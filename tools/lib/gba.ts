import { inflateSync } from 'node:zlib';

export interface IndexedImage {
  width: number;
  height: number;
  /** Um indice de paleta (0-15) por pixel. */
  indices: Uint8Array;
  /** Paleta embutida no proprio PNG (PLTE), quando existir. */
  embedded?: Palette;
}

export type Palette = Uint8Array; // 16 cores * 3 canais (RGB)

/**
 * Le um PNG indexado (color type 3) devolvendo os indices crus de paleta.
 * Os tilesets dos decomps sao 4bpp e a paleta embutida no PNG nao e a que o
 * jogo usa -- por isso precisamos dos indices, e nao do RGBA que um decoder
 * normal entregaria.
 */
export function readIndexedPng(buffer: Buffer): IndexedImage {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('nao e um PNG');

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let plte: Palette | undefined;
  const idat: Buffer[] = [];

  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') {
      plte = new Uint8Array(48);
      plte.set(data.subarray(0, Math.min(48, data.length)));
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  if (colorType !== 3) throw new Error(`esperava PNG indexado, veio colorType ${colorType}`);
  if (interlace !== 0) throw new Error('PNG entrelacado nao suportado');

  const raw = inflateSync(Buffer.concat(idat));
  const bytesPerLine = Math.ceil((width * bitDepth) / 8);
  const scanlines = unfilter(raw, bytesPerLine, height);

  const indices = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const line = scanlines.subarray(y * bytesPerLine, (y + 1) * bytesPerLine);
    for (let x = 0; x < width; x++) {
      indices[y * width + x] =
        bitDepth === 8
          ? line[x]
          : bitDepth === 4
            ? (line[x >> 1] >> (x % 2 === 0 ? 4 : 0)) & 0x0f
            : (() => {
                throw new Error(`bit depth ${bitDepth} nao suportado`);
              })();
    }
  }

  return { width, height, indices, embedded: plte };
}

/** Desfaz os filtros por scanline do PNG (bpp = 1 byte para profundidades < 8). */
function unfilter(raw: Buffer, bytesPerLine: number, height: number): Buffer {
  const bpp = 1;
  const out = Buffer.alloc(bytesPerLine * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + bytesPerLine);
    pos += bytesPerLine;
    const cur = out.subarray(y * bytesPerLine, (y + 1) * bytesPerLine);
    const prev = y > 0 ? out.subarray((y - 1) * bytesPerLine, y * bytesPerLine) : null;

    for (let i = 0; i < bytesPerLine; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      const x = line[i];
      switch (filter) {
        case 0:
          cur[i] = x;
          break;
        case 1:
          cur[i] = (x + a) & 0xff;
          break;
        case 2:
          cur[i] = (x + b) & 0xff;
          break;
        case 3:
          cur[i] = (x + ((a + b) >> 1)) & 0xff;
          break;
        case 4:
          cur[i] = (x + paeth(a, b, c)) & 0xff;
          break;
        default:
          throw new Error(`filtro PNG desconhecido: ${filter}`);
      }
    }
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Le uma paleta no formato JASC-PAL usado pelos decomps. */
export function readJascPalette(text: string): Palette {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines[0].trim() !== 'JASC-PAL') throw new Error('paleta nao e JASC-PAL');
  const count = Number.parseInt(lines[2], 10);
  const pal = new Uint8Array(16 * 3);
  for (let i = 0; i < Math.min(count, 16); i++) {
    const [r, g, b] = lines[3 + i].trim().split(/\s+/).map(Number);
    pal[i * 3] = r;
    pal[i * 3 + 1] = g;
    pal[i * 3 + 2] = b;
  }
  return pal;
}

export const TILE_SIZE = 8;
export const METATILE_SIZE = 16;
/** Tiles/metatiles/paletas que ficam com o tileset primario em FireRed. */
export const TILES_IN_PRIMARY = 640;
export const METATILES_IN_PRIMARY = 640;
export const PALS_IN_PRIMARY = 7;

export interface TileEntry {
  tile: number;
  flipX: boolean;
  flipY: boolean;
  palette: number;
}

/** Cada metatile sao 8 entradas u16: 4 da camada de baixo e 4 da de cima. */
export function parseMetatiles(bin: Buffer): TileEntry[][] {
  const count = Math.floor(bin.length / 16);
  const metatiles: TileEntry[][] = [];
  for (let m = 0; m < count; m++) {
    const entries: TileEntry[] = [];
    for (let i = 0; i < 8; i++) {
      const value = bin.readUInt16LE(m * 16 + i * 2);
      entries.push({
        tile: value & 0x03ff,
        flipX: (value & 0x0400) !== 0,
        flipY: (value & 0x0800) !== 0,
        palette: (value >> 12) & 0x0f,
      });
    }
    metatiles.push(entries);
  }
  return metatiles;
}

/**
 * Atributos de metatile do FireRed: 4 bytes por metatile.
 * bits 0-8 = behavior (grama alta, agua, porta...), bits 24-27 = tipo de encontro,
 * bits 29-30 = layer type.
 */
export interface MetatileAttributes {
  behavior: number;
  encounterType: number;
  layerType: number;
}

export function parseAttributes(bin: Buffer, count: number): MetatileAttributes[] {
  const stride = bin.length >= count * 4 ? 4 : 2;
  const attrs: MetatileAttributes[] = [];
  for (let i = 0; i < count; i++) {
    if (stride === 4) {
      const value = bin.readUInt32LE(i * 4);
      attrs.push({
        behavior: value & 0x1ff,
        encounterType: (value >> 24) & 0x0f,
        layerType: (value >> 29) & 0x03,
      });
    } else {
      const value = bin.readUInt16LE(i * 2);
      attrs.push({ behavior: value & 0xff, encounterType: 0, layerType: (value >> 12) & 0x03 });
    }
  }
  return attrs;
}

export interface TileSource {
  /** Graficos 8x8 do tileset primario (640 tiles) e do secundario. */
  primaryTiles: IndexedImage;
  secondaryTiles: IndexedImage | null;
  /** 16 paletas: 0-6 do primario, 7-12 do secundario. */
  palettes: Palette[];
}

/**
 * Desenha um metatile 16x16 em RGBA. A camada de baixo e opaca (indice 0 vira a
 * cor 0 da paleta), a de cima trata o indice 0 como transparente -- que e como
 * o GBA compoe os dois BGs.
 */
export function renderMetatile(
  entries: TileEntry[],
  source: TileSource,
  out: Uint8Array,
  outWidth: number,
  originX: number,
  originY: number,
): void {
  for (let layer = 0; layer < 2; layer++) {
    for (let quad = 0; quad < 4; quad++) {
      const entry = entries[layer * 4 + quad];
      const dx = originX + (quad % 2) * TILE_SIZE;
      const dy = originY + Math.floor(quad / 2) * TILE_SIZE;
      drawTile(entry, source, layer === 1, out, outWidth, dx, dy);
    }
  }
}

function drawTile(
  entry: TileEntry,
  source: TileSource,
  transparentZero: boolean,
  out: Uint8Array,
  outWidth: number,
  dx: number,
  dy: number,
): void {
  const fromSecondary = entry.tile >= TILES_IN_PRIMARY;
  const sheet = fromSecondary ? source.secondaryTiles : source.primaryTiles;
  if (!sheet) return;
  const localTile = fromSecondary ? entry.tile - TILES_IN_PRIMARY : entry.tile;
  const tilesPerRow = sheet.width / TILE_SIZE;
  const tileX = (localTile % tilesPerRow) * TILE_SIZE;
  const tileY = Math.floor(localTile / tilesPerRow) * TILE_SIZE;
  if (tileY >= sheet.height) return;

  const palette = source.palettes[entry.palette] ?? source.palettes[0];

  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const sx = entry.flipX ? TILE_SIZE - 1 - x : x;
      const sy = entry.flipY ? TILE_SIZE - 1 - y : y;
      const index = sheet.indices[(tileY + sy) * sheet.width + (tileX + sx)];
      if (index === 0 && transparentZero) continue;
      const o = ((dy + y) * outWidth + (dx + x)) * 4;
      out[o] = palette[index * 3];
      out[o + 1] = palette[index * 3 + 1];
      out[o + 2] = palette[index * 3 + 2];
      out[o + 3] = 255;
    }
  }
}
