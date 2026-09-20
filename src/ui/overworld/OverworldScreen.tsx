/**
 * Tela do mapa: canvas, loop de jogo e a cola entre os controles e o motor.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadMap, loadOverworldSprites } from '../../game/data/assets.js';
import type { Direction } from '../../game/data/types.js';
import { InputBus } from '../../game/input/InputBus.js';
import { OverworldRenderer } from '../../game/render/renderer.js';
import { Overworld, type PlayerPosition } from '../../game/world/overworld.js';
import { resolveInteraction, type EventsFile, type Interaction } from '../../game/world/interactions.js';
import { findPath } from '../../game/world/pathfinding.js';
import { TILE, World, directionDelta } from '../../game/world/world.js';
import { RNG } from '../../game/core/rng.js';
import { audio, songForMap } from '../../game/audio/index.js';
import { haptic, useSettings } from '../../state/settings.js';
import { Controls, DPad } from './Controls.js';
import { GbcScreen } from './GbcScreen.js';
import { mapDisplayName } from '../../i18n/places.js';

/** Quantos tiles queremos ver na largura da tela em modo retrato. */
const TARGET_TILES_ACROSS = 11;

/** Mudanca de lugar pedida de fora do mapa (derrota, por exemplo). */
export interface TeleportRequest extends PlayerPosition {
  /** Muda a cada pedido: e o que faz o mesmo destino valer duas vezes. */
  token: number;
}

interface Props {
  start: PlayerPosition;
  events: EventsFile | null;
  /** Congela o jogo enquanto uma tela por cima esta aberta. */
  paused: boolean;
  /** Leva o jogador para outro lugar sem ele ter andado ate la. */
  teleport?: TeleportRequest | null;
  onEncounter: (kind: 'land' | 'water', mapId: string) => void;
  onInteract: (interaction: Interaction) => void;
  onPosition: (position: PlayerPosition) => void;
  onStep: (steps: number) => void;
  onMenu: () => void;
}

export function OverworldScreen({
  start,
  events,
  paused,
  teleport,
  onEncounter,
  onInteract,
  onPosition,
  onStep,
  onMenu,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const busRef = useRef(new InputBus());
  const overworldRef = useRef<Overworld | null>(null);
  const rendererRef = useRef(new OverworldRenderer());
  const [ready, setReady] = useState(false);
  const [mapName, setMapName] = useState('');
  const [fading, setFading] = useState(false);
  const movementMode = useSettings((s) => s.movementMode);
  const zoomSetting = useSettings((s) => s.zoom);

  // Callbacks em refs: o loop nao deve ser recriado quando o App re-renderiza.
  const callbacks = useRef({ onEncounter, onInteract, onPosition, onStep, events });
  callbacks.current = { onEncounter, onInteract, onPosition, onStep, events };
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // --- Inicializacao --------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [world, spriteMeta] = await Promise.all([
        World.load(start.map),
        loadOverworldSprites(),
      ]);
      if (cancelled) return;

      const renderer = rendererRef.current;
      renderer.setSpriteMeta(spriteMeta);
      await renderer.preload(world);

      const overworld = new Overworld(
        world,
        { x: start.x, y: start.y, dir: start.dir },
        new RNG(),
      );

      const refreshSprites = () => {
        void renderer.preload(overworld.world);
        void renderer.preloadSprites(overworld.npcs.map((n) => n.data.gfx));
      };

      overworld.events = {
        onEncounter: (kind) => {
          haptic([18, 40, 18]);
          callbacks.current.onEncounter(kind, overworld.world.map.id);
        },
        onMapChange: (map) => {
          setMapName(mapDisplayName(map));
          void audio.playMusic(songForMap(map));
          refreshSprites();
          callbacks.current.onPosition(overworld.position());
        },
        onBump: () => audio.sfx('bump'),
        onStep: (steps) => {
          callbacks.current.onStep(steps);
          // Guardar a posicao a cada passo seria exagero; de dez em dez basta.
          if (steps % 10 === 0) callbacks.current.onPosition(overworld.position());
        },
        onWarp: (dest, warpId) => {
          audio.sfx('warp');
          void enterWarp(overworld, dest, warpId, setFading, () => {
            setMapName(mapDisplayName(overworld.world.map));
            refreshSprites();
            callbacks.current.onPosition(overworld.position());
          });
        },
      };

      await renderer.preloadSprites([
        'OBJ_EVENT_GFX_RED_NORMAL',
        ...overworld.npcs.map((n) => n.data.gfx),
      ]);

      void audio.playMusic(songForMap(world.map));
      overworldRef.current = overworld;
      // Em desenvolvimento, os scripts de teste usam isto para posicionar o
      // jogador sem depender de segurar setas por um tempo exato.
      if (import.meta.env.DEV) {
        (window as unknown as { __overworld?: Overworld }).__overworld = overworld;
      }
      setMapName(mapDisplayName(world.map));
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // Apenas o mapa inicial importa: depois disso o motor cuida das trocas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Pausa ----------------------------------------------------------------
  useEffect(() => {
    const overworld = overworldRef.current;
    if (!overworld) return;
    overworld.paused = paused;
    if (paused) busRef.current.clear();
    // Voltando de uma batalha (ou de um menu), a musica do lugar volta com o
    // jogador: quem tocou por cima -- tema de batalha, de vitoria, de captura
    // -- ja cumpriu seu papel e nao pode continuar ali no mapa.
    if (!paused) void audio.playMusic(songForMap(overworld.world.map));
  }, [paused, ready]);

  // --- Teleporte vindo de fora ----------------------------------------------
  useEffect(() => {
    const overworld = overworldRef.current;
    if (!ready || !overworld || !teleport) return;
    void travelTo(overworld, teleport, setFading, () => {
      setMapName(mapDisplayName(overworld.world.map));
      void rendererRef.current.preload(overworld.world);
      void rendererRef.current.preloadSprites(overworld.npcs.map((n) => n.data.gfx));
      callbacks.current.onPosition(overworld.position());
    }, () => pausedRef.current);
    // Um token novo e um pedido novo, mesmo que o destino seja o mesmo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, teleport?.token]);

  // --- Loop -----------------------------------------------------------------
  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current;
    const overworld = overworldRef.current;
    if (!canvas || !overworld) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bus = busRef.current;
    const renderer = rendererRef.current;
    let raf = 0;
    let last = performance.now();

    // O canvas e medido pelo espaco que o cerca, e nao por ele mesmo: assim
    // ajustar o tamanho dele nao dispara uma nova medicao sem fim.
    const host = canvas.parentElement ?? canvas;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = host.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      canvas.width = width;
      canvas.height = height;
      // O tamanho em CSS vem do tamanho real em pixels, e nao o contrario: um
      // pixel do canvas passa a ser exatamente um pixel do aparelho. Sem isso,
      // em telas de densidade quebrada o navegador reamostrava a imagem inteira
      // e sobrava uma linha fininha na borda de cada tile.
      canvas.style.width = `${width / dpr}px`;
      canvas.style.height = `${height / dpr}px`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const frame = (now: number) => {
      const dt = Math.min(60, now - last);
      last = now;

      if (!overworld.paused) {
        consumePath(overworld, bus);
        overworld.setIntent({ dir: bus.dir, running: bus.running });
        if (bus.takeAction() === 'a') {
          const interaction = resolveInteraction(overworld, callbacks.current.events);
          if (interaction) {
            faceNpc(overworld, interaction);
            haptic(12);
            audio.sfx(interaction.kind === 'trainer' ? 'menu' : 'select');
            callbacks.current.onInteract(interaction);
          }
        }
      }

      overworld.update(dt);

      const player = overworld.player;
      let px = (player.fromX + (player.x - player.fromX) * player.progress) * TILE + TILE / 2;
      let py = (player.fromY + (player.y - player.fromY) * player.progress) * TILE + TILE / 2;
      const dpr = canvas.width / Math.max(1, canvas.getBoundingClientRect().width);
      const cssWidth = canvas.width / dpr;
      let scale = viewScale(cssWidth, zoomSetting, dpr);

      // Mapas pequenos (interiores) ficam centralizados e ampliados ate
      // preencher a largura, em vez de mostrar o vazio alem da borda.
      const map = overworld.world.map;
      const mapPixelWidth = map.width * TILE;
      if (mapPixelWidth * scale < canvas.width) {
        scale = Math.min(Math.round(8 * dpr), Math.ceil(canvas.width / mapPixelWidth));
      }
      const halfW = canvas.width / (2 * scale);
      const halfH = canvas.height / (2 * scale);
      if (map.width * TILE <= halfW * 2) px = (map.width * TILE) / 2;
      if (map.height * TILE <= halfH * 2) py = (map.height * TILE) / 2;

      renderer.draw(
        ctx,
        overworld.world,
        player,
        overworld.npcs,
        { x: px, y: py, scale },
        canvas.width,
        canvas.height,
      );

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [ready, zoomSetting]);

  // --- Teclado (desktop) ----------------------------------------------------
  useEffect(() => {
    const bus = busRef.current;
    const keys = new Set<string>();
    const dirOf = (key: string): Direction | null => {
      switch (key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          return 'up';
        case 'ArrowDown':
        case 's':
        case 'S':
          return 'down';
        case 'ArrowLeft':
        case 'a':
        case 'A':
          return 'left';
        case 'ArrowRight':
        case 'd':
        case 'D':
          return 'right';
        default:
          return null;
      }
    };
    const refresh = () => {
      let dir: Direction | null = null;
      for (const key of keys) {
        const candidate = dirOf(key);
        if (candidate) dir = candidate;
      }
      bus.dir = dir;
      bus.running = keys.has('Shift');
    };
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      // Com um dialogo ou menu aberto, a tecla e daquela tela: se o botao
      // ficasse na fila, fechar a caixa reabriria a conversa na hora.
      if (pausedRef.current) return;
      if (e.key === 'z' || e.key === 'Z' || e.key === 'Enter') bus.press('a');
      if (e.key === 'x' || e.key === 'X') bus.press('b');
      keys.add(e.key === 'Shift' ? 'Shift' : e.key);
      if (dirOf(e.key)) e.preventDefault();
      refresh();
    };
    const up = (e: KeyboardEvent) => {
      keys.delete(e.key === 'Shift' ? 'Shift' : e.key);
      refresh();
    };
    const blur = () => {
      keys.clear();
      refresh();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // --- Toque para caminhar --------------------------------------------------
  const handleTap = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (movementMode !== 'touch' || paused) return;
      const overworld = overworldRef.current;
      const canvas = canvasRef.current;
      if (!overworld || !canvas) return;

      const rect = canvas.getBoundingClientRect();
      // Mesma conta do desenho, trazida de volta para pixels de CSS: o toque
      // precisa mirar no tile que o jogador esta vendo.
      const dpr = canvas.width / Math.max(1, rect.width);
      const scale = viewScale(rect.width, zoomSetting, dpr) / dpr;

      // O jogador esta sempre no centro da tela; o resto e aritmetica de tiles.
      const player = overworld.player;
      const offsetX = (e.clientX - rect.left - rect.width / 2) / scale;
      const offsetY = (e.clientY - rect.top - rect.height / 2) / scale;
      const targetX = Math.floor(player.x + 0.5 + offsetX / TILE);
      const targetY = Math.floor(player.y + 0.5 + offsetY / TILE);

      const path = findPath(overworld, { x: player.x, y: player.y }, { x: targetX, y: targetY });
      if (path && path.length > 0) {
        busRef.current.path = path;
        haptic(10);
      } else {
        haptic([4, 30, 4]);
      }
    },
    [movementMode, paused, zoomSetting],
  );

  const dual = movementMode === 'oldschool-dual';

  return (
    <div className={dual ? 'overworld overworld-dual' : 'overworld'}>
      <div className="overworld-viewport">
        <canvas ref={canvasRef} className="overworld-canvas" onPointerDown={handleTap} />
        <div className="map-banner">{mapName}</div>
        {!ready && <div className="loading-overlay">Carregando Kanto…</div>}
        {ready && !dual && <Controls bus={busRef.current} mode={movementMode} onMenu={onMenu} />}
        <div className={fading ? 'warp-fade warp-fade-on' : 'warp-fade'} />
      </div>
      {dual && (
        <GbcScreen
          title={mapName}
          onMenu={onMenu}
          left={<DPad bus={busRef.current} compact />}
          bus={busRef.current}
        />
      )}
    </div>
  );
}

/**
 * Entra num warp: o destino guarda a lista de warps, e o indice diz em qual
 * deles o jogador aparece do outro lado.
 */
async function enterWarp(
  overworld: Overworld,
  dest: string,
  warpId: number,
  setFading: (value: boolean) => void,
  onArrive: () => void,
): Promise<void> {
  overworld.paused = true;
  setFading(true);
  haptic(12);
  await new Promise((resolve) => setTimeout(resolve, 220));

  try {
    const map = await loadMap(dest);
    const warp = map.warps[warpId] ?? map.warps[0];
    const x = warp?.x ?? Math.floor(map.width / 2);
    const y = warp?.y ?? Math.floor(map.height / 2);
    await overworld.arriveFromWarp(dest, x, y, 'down');
    // Como no jogo original, o jogador da um passo para fora da porta.
    overworld.stepOutOfDoor();
    onArrive();
  } catch {
    // Destino inexistente (alguns warps do decomp apontam para fora de Kanto).
  } finally {
    overworld.paused = false;
    setFading(false);
  }
}

/**
 * Leva o jogador para um lugar marcado no save (o Centro Pokemon, depois de
 * uma derrota). Chega como se tivesse saido de um warp, entao ele nao e
 * teleportado de volta ao pisar na porta de entrada.
 */
async function travelTo(
  overworld: Overworld,
  to: PlayerPosition,
  setFading: (value: boolean) => void,
  onArrive: () => void,
  /** Como o mapa deve ficar no fim: a tela por cima pode continuar aberta. */
  pausedAfter: () => boolean,
): Promise<void> {
  overworld.paused = true;
  setFading(true);
  await new Promise((resolve) => setTimeout(resolve, 220));
  try {
    await overworld.arriveFromWarp(to.map, to.x, to.y, to.dir);
    onArrive();
  } catch {
    // Mapa inexistente: melhor ficar onde esta do que travar a tela.
  } finally {
    overworld.paused = pausedAfter();
    setFading(false);
  }
}

/** O NPC vira para o jogador antes de falar. */
function faceNpc(overworld: Overworld, interaction: Interaction): void {
  if (!interaction || !('npc' in interaction)) return;
  const { dx, dy } = directionDelta(overworld.player.dir);
  interaction.npc.dir = dx === 1 ? 'left' : dx === -1 ? 'right' : dy === 1 ? 'up' : 'down';
}

/** Converte o caminho pendente do modo toque em intencao de movimento. */
function consumePath(overworld: Overworld, bus: InputBus): void {
  const path = bus.path;
  if (!path || path.length === 0) {
    if (path) bus.path = null;
    return;
  }
  if (overworld.player.moving) return;

  const player = overworld.player;
  while (path.length > 0 && path[0].x === player.x && path[0].y === player.y) path.shift();
  if (path.length === 0) {
    bus.path = null;
    bus.dir = null;
    return;
  }

  const next = path[0];
  const dx = next.x - player.x;
  const dy = next.y - player.y;
  const dir: Direction | null =
    dx === 1 ? 'right' : dx === -1 ? 'left' : dy === 1 ? 'down' : dy === -1 ? 'up' : null;
  if (!dir) {
    // Caminho ficou invalido (um NPC andou na frente): recalcula na proxima vez.
    bus.path = null;
    bus.dir = null;
    return;
  }
  bus.dir = dir;
  bus.running = path.length > 3;
}

/**
 * Quantos pixels do aparelho cada pixel do mundo ocupa. E sempre um numero
 * inteiro: e o que mantem cada tile encaixado na grade de pixels da tela, sem
 * a linha fina que aparecia entre um tile e outro em aparelhos com densidade
 * quebrada (2,75x, por exemplo).
 */
function viewScale(cssWidth: number, zoomSetting: number, dpr: number): number {
  const zoom = zoomSetting > 0 ? zoomSetting : clamp(Math.round(cssWidth / (TILE * TARGET_TILES_ACROSS)), 2, 6);
  return Math.max(1, Math.round(zoom * dpr));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
