/**
 * Atualizacao do app instalado.
 *
 * Um PWA guarda a versao antiga no cache do service worker; sem alguem dizer
 * "pode trocar", ela fica la para sempre e o jogador acaba desinstalando ou
 * limpando dados para receber a nova -- o que apaga o progresso junto.
 *
 * Aqui a troca e explicita e segura: o jogo avisa que ha versao nova, aplica
 * quando o jogador aceitar e recarrega. O save vive no IndexedDB, que nada
 * disso toca.
 */
import { create } from 'zustand';
import { registerSW } from 'virtual:pwa-register';

/** De quanto em quanto tempo perguntar ao servidor se saiu versao nova. */
const CHECK_INTERVAL_MS = 30 * 60_000;

interface UpdateStore {
  /** Ha uma versao nova baixada, esperando para ser aplicada. */
  available: boolean;
  /** O jogo ja esta inteiro em cache e abre sem rede. */
  offlineReady: boolean;
  /** True enquanto a troca acontece, ate a pagina recarregar. */
  applying: boolean;
  /** O jogador dispensou o aviso; volta a aparecer na proxima sessao. */
  dismissed: boolean;

  apply: () => void;
  dismiss: () => void;
  /** Pergunta ao servidor se ha versao nova agora. */
  checkNow: () => void;
}

let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null;
let registration: ServiceWorkerRegistration | null = null;

export const useUpdates = create<UpdateStore>((set) => ({
  available: false,
  offlineReady: false,
  applying: false,
  dismissed: false,

  apply: () => {
    set({ applying: true });
    // `updateSW(true)` manda o service worker em espera assumir e recarrega.
    void applyUpdate?.(true);
    // Rede de seguranca: quando a versao nova ja ativou sozinha (sem passar por
    // "em espera"), nao ha o que mandar assumir e o plugin nao recarrega. Sem
    // este reload o jogador ficaria preso na versao antiga.
    setTimeout(() => window.location.reload(), 1500);
  },

  dismiss: () => set({ dismissed: true }),

  checkNow: () => {
    void registration?.update().catch(() => undefined);
  },
}));

/** Liga o service worker. Chamado uma vez, na subida do app. */
export function initUpdates(): void {
  applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh() {
      useUpdates.setState({ available: true, dismissed: false });
    },
    onOfflineReady() {
      useUpdates.setState({ offlineReady: true });
    },
    onRegisteredSW(_url, swRegistration) {
      registration = swRegistration ?? null;
      if (!registration) return;

      // Procura versao nova de tempos em tempos e sempre que o app volta ao
      // primeiro plano -- um jogo de celular fica dias aberto em segundo plano.
      setInterval(() => useUpdates.getState().checkNow(), CHECK_INTERVAL_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') useUpdates.getState().checkNow();
      });
    },
  });
}

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
export const BUILD_TIME = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '';

// A versao que esta rodando fica visivel no HTML: ajuda a conferir qual build o
// aparelho carregou sem precisar abrir o menu.
if (typeof document !== 'undefined') {
  document.documentElement.dataset.version = APP_VERSION;
}

export function formatBuildTime(): string {
  if (!BUILD_TIME) return '';
  try {
    return new Date(BUILD_TIME).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}
