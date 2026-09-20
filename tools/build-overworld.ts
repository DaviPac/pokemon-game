/**
 * Extrai os sprites de personagem do overworld (jogador e NPCs) do FireRed.
 *
 * Cada OBJ_EVENT_GFX_* do decomp vira um PNG RGBA com os quadros empilhados
 * horizontalmente, mais a metadata de tamanho de quadro.
 *
 * Saida: public/assets/overworld/<slug>.png e public/assets/data/overworld.json
 */
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { fetchSource, fetchText, mapLimit } from './lib/net.js';
import { readIndexedPng } from './lib/gba.js';

const OUT_SPRITES = join(process.cwd(), 'public', 'assets', 'overworld');
const OUT_DATA = join(process.cwd(), 'public', 'assets', 'data');
const MAPS_DIR = join(OUT_DATA, 'maps');

/** Sempre exportados, mesmo que nenhum mapa os referencie. */
const ALWAYS = ['OBJ_EVENT_GFX_RED_NORMAL', 'OBJ_EVENT_GFX_GREEN_NORMAL'];

async function main(): Promise<void> {
  await rm(OUT_SPRITES, { recursive: true, force: true });
  await mkdir(OUT_SPRITES, { recursive: true });

  const picPaths = await parsePicPaths();
  const infos = await parseGraphicsInfo();
  const pointers = await parsePointers();

  const wanted = new Set<string>(ALWAYS);
  for (const file of await readdir(MAPS_DIR)) {
    const map = JSON.parse(await readFileText(join(MAPS_DIR, file)));
    for (const obj of map.objects ?? []) wanted.add(obj.gfx);
  }
  console.log(`[ow] ${wanted.size} graficos de objeto referenciados`);

  const out: Record<string, OverworldSprite> = {};
  const missing: string[] = [];

  await mapLimit([...wanted], 8, async (gfx) => {
    const infoLabel = pointers.get(gfx);
    const info = infoLabel ? infos.get(infoLabel) : undefined;
    if (!info) {
      missing.push(gfx);
      return;
    }
    const picPath = picPaths.get(info.picLabel);
    if (!picPath) {
      missing.push(gfx);
      return;
    }

    const buf = await fetchSource('firered', picPath);
    if (!buf) {
      missing.push(gfx);
      return;
    }

    const image = readIndexedPng(buf);
    const palette = image.embedded;
    if (!palette) {
      missing.push(gfx);
      return;
    }

    const png = new PNG({ width: image.width, height: image.height, colorType: 6 });
    png.data.fill(0);
    for (let i = 0; i < image.indices.length; i++) {
      const index = image.indices[i];
      if (index === 0) continue; // cor 0 e a transparencia nos sprites do GBA
      png.data[i * 4] = palette[index * 3];
      png.data[i * 4 + 1] = palette[index * 3 + 1];
      png.data[i * 4 + 2] = palette[index * 3 + 2];
      png.data[i * 4 + 3] = 255;
    }

    const file = `${slugify(gfx)}.png`;
    await writeFile(join(OUT_SPRITES, file), PNG.sync.write(png));

    out[gfx] = {
      file,
      frameWidth: info.width,
      frameHeight: info.height,
      frames: Math.floor(image.width / info.width) * Math.floor(image.height / info.height),
      inanimate: info.inanimate,
    };
  });

  await writeFile(join(OUT_DATA, 'overworld.json'), JSON.stringify(out));
  console.log(`[ow] ${Object.keys(out).length} sprites exportados, ${missing.length} sem grafico`);
  if (missing.length > 0) console.log(`[ow] sem grafico: ${missing.slice(0, 8).join(', ')}...`);
}

interface OverworldSprite {
  file: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  inanimate: boolean;
}

/** gObjectEventPic_RedNormal -> graphics/object_events/pics/people/red_normal.png */
async function parsePicPaths(): Promise<Map<string, string>> {
  const text = await requiredText('src/data/object_events/object_event_graphics.h');
  const map = new Map<string, string>();
  for (const match of text.matchAll(
    /gObjectEventPic_(\w+)\[\]\s*=\s*INCBIN_U16\("(graphics\/object_events\/pics\/[^"]+)\.4bpp"\)/g,
  )) {
    map.set(match[1], `${match[2]}.png`);
  }
  return map;
}

interface GraphicsInfo {
  width: number;
  height: number;
  picLabel: string;
  inanimate: boolean;
}

async function parseGraphicsInfo(): Promise<Map<string, GraphicsInfo>> {
  const text = await requiredText('src/data/object_events/object_event_graphics_info.h');
  const map = new Map<string, GraphicsInfo>();
  for (const match of text.matchAll(
    /const struct ObjectEventGraphicsInfo gObjectEventGraphicsInfo_(\w+)\s*=\s*\{([^}]*)\}/g,
  )) {
    const body = match[2];
    const width = Number(/\.width\s*=\s*(\d+)/.exec(body)?.[1]);
    const height = Number(/\.height\s*=\s*(\d+)/.exec(body)?.[1]);
    const picLabel = /\.images\s*=\s*sPicTable_(\w+)/.exec(body)?.[1];
    if (!width || !height || !picLabel) continue;
    map.set(match[1], {
      width,
      height,
      picLabel,
      inanimate: /\.inanimate\s*=\s*TRUE/.test(body),
    });
  }
  return map;
}

/** OBJ_EVENT_GFX_WOMAN_1 -> Woman1 */
async function parsePointers(): Promise<Map<string, string>> {
  const text = await requiredText('src/data/object_events/object_event_graphics_info_pointers.h');
  const map = new Map<string, string>();
  for (const match of text.matchAll(
    /\[(OBJ_EVENT_GFX_\w+)\]\s*=\s*&gObjectEventGraphicsInfo_(\w+)/g,
  )) {
    map.set(match[1], match[2]);
  }
  return map;
}

function slugify(gfx: string): string {
  return gfx.replace(/^OBJ_EVENT_GFX_/, '').toLowerCase();
}

async function readFileText(path: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  return readFile(path, 'utf8');
}

async function requiredText(path: string): Promise<string> {
  const text = await fetchText('firered', path);
  if (!text) throw new Error(`arquivo obrigatorio nao encontrado: ${path}`);
  return text;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
