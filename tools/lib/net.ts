import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const CACHE_DIR = join(process.cwd(), '.cache', 'sources');

/** Repositorios de decompilacao usados como fonte de assets. */
export const REPOS = {
  firered: 'pret/pokefirered',
  emerald: 'pret/pokeemerald',
  crystal: 'pret/pokecrystal',
  sprites: 'PokeAPI/sprites',
  veekun: 'veekun/pokedex',
} as const;

export type RepoKey = keyof typeof REPOS;

const BRANCH: Record<RepoKey, string> = {
  firered: 'master',
  emerald: 'master',
  crystal: 'master',
  sprites: 'master',
  veekun: 'master',
};

function rawUrl(repo: RepoKey, path: string): string {
  return `https://raw.githubusercontent.com/${REPOS[repo]}/${BRANCH[repo]}/${path}`;
}

/**
 * Baixa um arquivo do repositorio e guarda em .cache/ para que rodar o pipeline
 * de novo nao bata na rede. Retorna null em 404 (varios arquivos sao opcionais).
 */
export async function fetchSource(repo: RepoKey, path: string): Promise<Buffer | null> {
  const cached = join(CACHE_DIR, repo, path);
  if (existsSync(cached)) {
    const buf = await readFile(cached);
    return buf.length === 0 ? null : buf;
  }

  const res = await fetchWithRetry(rawUrl(repo, path));
  if (res === null) {
    await mkdir(dirname(cached), { recursive: true });
    await writeFile(cached, Buffer.alloc(0)); // memoriza o 404
    return null;
  }

  await mkdir(dirname(cached), { recursive: true });
  await writeFile(cached, res);
  return res;
}

export async function fetchJson<T>(repo: RepoKey, path: string): Promise<T | null> {
  const buf = await fetchSource(repo, path);
  return buf ? (JSON.parse(buf.toString('utf8')) as T) : null;
}

export async function fetchText(repo: RepoKey, path: string): Promise<string | null> {
  const buf = await fetchSource(repo, path);
  return buf ? buf.toString('utf8') : null;
}

async function fetchWithRetry(url: string, attempts = 4): Promise<Buffer | null> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 2 ** i * 500));
    }
  }
  throw lastError;
}

/** Executa `worker` sobre `items` com no maximo `limit` requisicoes simultaneas. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}
