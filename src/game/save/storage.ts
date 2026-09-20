/**
 * Persistencia do save em IndexedDB, com export/import em arquivo para quem
 * quiser levar o progresso para outro aparelho.
 */
import { openDB, type IDBPDatabase } from 'idb';
import { SAVE_VERSION, migrate, type SaveData } from './schema.js';

const DB_NAME = 'pokedeluge';
const STORE = 'saves';
const SLOT = 'main';

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
    },
  });
  return dbPromise;
}

export async function loadSave(): Promise<SaveData | null> {
  try {
    const raw = (await (await db()).get(STORE, SLOT)) as SaveData | undefined;
    if (!raw) return null;
    return raw.version === SAVE_VERSION ? raw : migrate(raw);
  } catch {
    // Modo privado ou armazenamento bloqueado: o jogo segue sem save.
    return null;
  }
}

export async function writeSave(save: SaveData): Promise<void> {
  try {
    await (await db()).put(STORE, save, SLOT);
  } catch {
    // Sem armazenamento disponivel; nao ha o que fazer alem de continuar.
  }
}

export async function deleteSave(): Promise<void> {
  try {
    await (await db()).delete(STORE, SLOT);
  } catch {
    // ignorado
  }
}

export function exportSave(save: SaveData): void {
  const blob = new Blob([JSON.stringify(save)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `pokedeluge-${stamp}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function importSave(file: File): Promise<SaveData> {
  const text = await file.text();
  const parsed = JSON.parse(text) as SaveData;
  if (typeof parsed.playerName !== 'string' || !Array.isArray(parsed.party)) {
    throw new Error('Arquivo de save invalido.');
  }
  const migrated = migrate(parsed);
  await writeSave(migrated);
  return migrated;
}
