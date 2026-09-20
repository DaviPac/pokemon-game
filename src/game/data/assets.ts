/**
 * Carregamento preguicoso dos dados gerados em build. Tudo e buscado uma vez e
 * fica em memoria; o service worker cuida do cache entre sessoes.
 */
import type {
  GameMap,
  LearnsetsFile,
  MovesFile,
  NaturesFile,
  OverworldSpriteMeta,
  RawMapData,
  SpeciesFile,
  TilesetsFile,
  TypeChart,
  WorldIndex,
} from './types.js';

const BASE = `${import.meta.env.BASE_URL ?? '/'}assets`.replace(/\/{2,}/g, '/');

const cache = new Map<string, Promise<unknown>>();

function loadJson<T>(path: string): Promise<T> {
  const existing = cache.get(path);
  if (existing) return existing as Promise<T>;
  const promise = fetch(`${BASE}/${path}`).then((res) => {
    if (!res.ok) throw new Error(`falha ao carregar ${path}: HTTP ${res.status}`);
    return res.json() as Promise<T>;
  });
  cache.set(path, promise);
  return promise;
}

/** Carrega qualquer JSON de assets pelo caminho, com o mesmo cache. */
export const loadJsonAsset = loadJson;

export const loadWorldIndex = (): Promise<WorldIndex> => loadJson<WorldIndex>('data/world.json');
export const loadTilesets = (): Promise<TilesetsFile> => loadJson<TilesetsFile>('data/tilesets.json');
export const loadSpecies = (): Promise<SpeciesFile> => loadJson<SpeciesFile>('data/species.json');
export const loadMoves = (): Promise<MovesFile> => loadJson<MovesFile>('data/moves.json');
export const loadLearnsets = (): Promise<LearnsetsFile> => loadJson<LearnsetsFile>('data/learnsets.json');
export const loadTypeChart = (): Promise<TypeChart> => loadJson<TypeChart>('data/typechart.json');
export const loadNatures = (): Promise<NaturesFile> => loadJson<NaturesFile>('data/natures.json');
export const loadOverworldSprites = (): Promise<Record<string, OverworldSpriteMeta>> =>
  loadJson<Record<string, OverworldSpriteMeta>>('data/overworld.json');

const mapCache = new Map<string, Promise<GameMap>>();

export function loadMap(id: string): Promise<GameMap> {
  const existing = mapCache.get(id);
  if (existing) return existing;
  const promise = loadJson<RawMapData>(`data/maps/${id}.json`).then(decodeMap);
  mapCache.set(id, promise);
  return promise;
}

function decodeMap(raw: RawMapData): GameMap {
  const { metatiles, collision, elevation, ...rest } = raw;
  return {
    ...rest,
    metatiles: decodeU16(metatiles),
    collision: decodeU8(collision),
    elevationData: decodeU8(elevation),
  };
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeU8(value: string): Uint8Array {
  return decodeBase64(value);
}

function decodeU16(value: string): Uint16Array {
  const bytes = decodeBase64(value);
  return new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();

export function loadImage(path: string): Promise<HTMLImageElement> {
  const existing = imageCache.get(path);
  if (existing) return existing;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`falha ao carregar imagem ${path}`));
    img.src = `${BASE}/${path}`;
  });
  imageCache.set(path, promise);
  return promise;
}

export const tilesetImage = (file: string): Promise<HTMLImageElement> => loadImage(`tilesets/${file}`);
export const overworldImage = (file: string): Promise<HTMLImageElement> => loadImage(`overworld/${file}`);
