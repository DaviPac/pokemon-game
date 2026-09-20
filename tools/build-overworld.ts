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

/**
 * Quem ganha folha de corrida. Correr e coisa do jogador: os NPCs de Kanto so
 * caminham, e montar a folha deles seria peso baixado a toa.
 */
const RUNNERS = ['OBJ_EVENT_GFX_RED_NORMAL', 'OBJ_EVENT_GFX_GREEN_NORMAL'];

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

    const png = await loadPic(picPath);
    if (!png) {
      missing.push(gfx);
      return;
    }

    const file = `${slugify(gfx)}.png`;
    await writeFile(join(OUT_SPRITES, file), PNG.sync.write(png));

    out[gfx] = {
      file,
      frameWidth: info.width,
      frameHeight: info.height,
      frames: Math.floor(png.width / info.width) * Math.floor(png.height / info.height),
      inanimate: info.inanimate,
    };
  });

  await buildRunningSheets(out, { picPaths, infos, pointers });

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
  /** Folha de corrida, quando existe: 9 quadros (sul, norte, oeste). */
  run?: string;
}

/**
 * Monta a folha de corrida do jogador.
 *
 * No FireRed os quadros de corrida nao moram no mesmo arquivo da caminhada:
 * eles dividem a folha com o surf. Quem junta as duas e a tabela de quadros do
 * decomp, e a tabela de animacao diz quais indices a corrida usa. Seguimos as
 * duas para nao chutar posicao de sprite.
 */
async function buildRunningSheets(
  out: Record<string, OverworldSprite>,
  source: {
    picPaths: Map<string, string>;
    infos: Map<string, GraphicsInfo>;
    pointers: Map<string, string>;
  },
): Promise<void> {
  const tables = await parsePicTables();
  const runFrames = await parseRunFrames();
  if (runFrames.length === 0) {
    console.log('[ow] tabela de animacao sem quadros de corrida; folha nao gerada');
    return;
  }

  for (const gfx of RUNNERS) {
    const entry = out[gfx];
    const info = source.infos.get(source.pointers.get(gfx) ?? '');
    const table = info ? tables.get(info.picLabel) : undefined;
    if (!entry || !info || !table) continue;

    const sheet = new PNG({
      width: info.width * runFrames.length,
      height: info.height,
      colorType: 6,
    });
    sheet.data.fill(0);

    let complete = true;
    for (const [slot, index] of runFrames.entries()) {
      const frame = table[index];
      const picPath = frame ? source.picPaths.get(frame.pic) : undefined;
      const png = picPath ? await loadPic(picPath) : null;
      if (!frame || !png) {
        complete = false;
        break;
      }
      const perRow = Math.max(1, Math.floor(png.width / info.width));
      copyFrame(png, sheet, {
        sx: (frame.frame % perRow) * info.width,
        sy: Math.floor(frame.frame / perRow) * info.height,
        dx: slot * info.width,
        width: info.width,
        height: info.height,
      });
    }
    if (!complete) continue;

    const file = `${slugify(gfx)}_running.png`;
    await writeFile(join(OUT_SPRITES, file), PNG.sync.write(sheet));
    entry.run = file;
    console.log(`[ow] folha de corrida de ${gfx}: ${runFrames.length} quadros`);
  }
}

/** Recorta um quadro de uma folha para outra. */
function copyFrame(
  from: PNG,
  to: PNG,
  rect: { sx: number; sy: number; dx: number; width: number; height: number },
): void {
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      const src = ((rect.sy + y) * from.width + rect.sx + x) * 4;
      const dst = (y * to.width + rect.dx + x) * 4;
      to.data[dst] = from.data[src];
      to.data[dst + 1] = from.data[src + 1];
      to.data[dst + 2] = from.data[src + 2];
      to.data[dst + 3] = from.data[src + 3];
    }
  }
}

const picCache = new Map<string, Promise<PNG | null>>();

/** Le um PNG indexado do decomp e devolve em RGBA, com a cor 0 transparente. */
function loadPic(picPath: string): Promise<PNG | null> {
  const cached = picCache.get(picPath);
  if (cached) return cached;

  const promise = (async () => {
    const buf = await fetchSource('firered', picPath);
    if (!buf) return null;
    const image = readIndexedPng(buf);
    const palette = image.embedded;
    if (!palette) return null;

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
    return png;
  })();

  picCache.set(picPath, promise);
  return promise;
}

/**
 * sPicTable_RedNormal -> [{ pic: 'RedNormal', frame: 0 }, ...]. Uma tabela pode
 * puxar quadros de mais de um arquivo -- e o caso justamente da corrida.
 */
async function parsePicTables(): Promise<Map<string, { pic: string; frame: number }[]>> {
  const text = await requiredText('src/data/object_events/object_event_pic_tables.h');
  const tables = new Map<string, { pic: string; frame: number }[]>();
  for (const match of text.matchAll(
    /sPicTable_(\w+)\[\]\s*=\s*\{([\s\S]*?)\n\}/g,
  )) {
    const frames = [...match[2].matchAll(/gObjectEventPic_(\w+),\s*\d+,\s*\d+,\s*(\d+)/g)].map(
      (frame) => ({ pic: frame[1], frame: Number(frame[2]) }),
    );
    if (frames.length > 0) tables.set(match[1], frames);
  }
  return tables;
}

/**
 * Indices da tabela de quadros que a corrida usa, na ordem parado/passo A/passo
 * B para sul, norte e oeste (o leste e o oeste espelhado, como na caminhada).
 */
async function parseRunFrames(): Promise<number[]> {
  const text = await requiredText('src/data/object_events/object_event_anims.h');
  const frames: number[] = [];
  for (const name of ['RunSouth', 'RunNorth', 'RunWest']) {
    const body = new RegExp(`sAnim_${name}\\[\\]\\s*=\\s*\\{([\\s\\S]*?)\\n\\};`).exec(text)?.[1];
    if (!body) return [];
    const seen: number[] = [];
    for (const cmd of body.matchAll(/ANIMCMD_FRAME\((\d+)/g)) {
      const index = Number(cmd[1]);
      if (!seen.includes(index)) seen.push(index);
    }
    if (seen.length !== 3) return [];
    frames.push(...seen);
  }
  return frames;
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
