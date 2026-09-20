/**
 * Ganchos que o jogo expoe no `window` em desenvolvimento.
 *
 * Existem para os scripts de teste chegarem depressa na situacao que querem
 * conferir -- posicionar o jogador, saber que musica esta tocando -- sem
 * depender de segurar setas pelo tempo exato. Ficam declarados num lugar so
 * porque o TypeScript junta as declaracoes de `Window` do projeto inteiro.
 */

/** A parte do motor do overworld que o gancho expoe. */
export interface OverworldHandle {
  player: Record<string, unknown>;
  npcs: { x: number; y: number; data: { script: string } }[];
  world: { map: { id: string } };
  swapTo(map: string, x: number, y: number, dir: string): Promise<void>;
}

/** O pedaco do save que os testes precisam mexer. */
export interface SaveHandle {
  party: {
    hp: number;
    level: number;
    moves: { id: string; pp: number; maxPp: number }[];
  }[];
}

/** O estado global do jogo, o bastante para preparar um teste. */
export interface GameHandle {
  getState(): {
    addItem(item: string, amount: number): void;
    healParty(): void;
    update(mutate: (save: SaveHandle) => void): void;
  };
}

declare global {
  interface Window {
    __overworld?: OverworldHandle;
    __audio?: { nowPlaying: string | null; state: string; lastMove: string | null };
    __game?: GameHandle;
  }
}
