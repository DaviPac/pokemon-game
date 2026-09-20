/**
 * Persistencia do save em IndexedDB.
 *
 * O IndexedDB nao e tocado por atualizacao do app nem pelo service worker: o
 * progresso sobrevive a uma versao nova. O que apaga tudo e o jogador limpar os
 * dados do site -- por isso existem o backup automatico antes de migrar e a
 * exportacao para arquivo.
 */
import { openDB, type IDBPDatabase } from 'idb';
import { SAVE_VERSION, migrate, type SaveData } from './schema.js';

const DB_NAME = 'pokedeluge';
const STORE = 'saves';
const SLOT = 'main';
/** Copia do save como ele estava antes da ultima migracao. */
const BACKUP_SLOT = 'backup';

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
    if (raw.version === SAVE_VERSION) return raw;

    // Guarda o original antes de converter: se a migracao tiver algum defeito,
    // o progresso continua recuperavel.
    await (await db()).put(STORE, raw, BACKUP_SLOT);
    const migrated = migrate(raw);
    await (await db()).put(STORE, migrated, SLOT);
    return migrated;
  } catch {
    // Modo privado ou armazenamento bloqueado: o jogo segue sem save.
    return null;
  }
}

/** O save como estava antes da ultima migracao, se houver. */
export async function loadBackup(): Promise<SaveData | null> {
  try {
    return ((await (await db()).get(STORE, BACKUP_SLOT)) as SaveData | undefined) ?? null;
  } catch {
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

/**
 * Pede ao navegador para nao descartar os dados do site quando o aparelho
 * estiver sem espaco. So funciona depois de um gesto do usuario, e o navegador
 * pode recusar -- por isso o resultado e apenas informativo.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export function exportSave(save: SaveData): void {
  const blob = new Blob([JSON.stringify(save)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `pokedeluge-${save.playerName || 'save'}-${stamp}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function importSave(file: File): Promise<SaveData> {
  const text = await file.text();
  const parsed = JSON.parse(text) as SaveData;
  if (typeof parsed.playerName !== 'string' || !Array.isArray(parsed.party)) {
    throw new Error('Arquivo de save invalido.');
  }

  // O save atual vira backup antes de ser substituido.
  const current = await loadSave();
  if (current) {
    try {
      await (await db()).put(STORE, current, BACKUP_SLOT);
    } catch {
      // segue mesmo sem conseguir guardar a copia
    }
  }

  const migrated = migrate(parsed);
  await writeSave(migrated);
  return migrated;
}
