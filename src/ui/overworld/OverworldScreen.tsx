/**
 * Tela do mapa: canvas, loop de jogo e a cola entre os controles e o motor.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadOverworldSprites } from '../../game/data/assets.js';
import type { Direction } from '../../game/data/types.js';
import { InputBus } from '../../game/input/InputBus.js';
import { OverworldRenderer } from '../../game/render/renderer.js';
import { Overworld } from '../../game/world/overworld.js';
import { findPath } from '../../game/world/pathfinding.js';
import { TILE, World, directionDelta } from '../../game/world/world.js';
import { RNG } from '../../game/core/rng.js';
import { haptic, useSettings } from '../../state/settings.js';
import { Controls, DPad } from './Controls.js';
import { GbcScreen } from './GbcScreen.js';
import { mapDisplayName } from '../../i18n/places.js';

/** Quantos tiles queremos ver na largura da tela em modo retrato. */
const TARGET_TILES_ACROSS = 11;

interface Props {
  startMap: string;
  startX: number;
  startY: number;
  onEncounter: (kind: 'land' | 'water', mapId: string) => void;
  onInteract: (message: string) => void;
  onMenu: () => void;
}

export function OverworldScreen({
  startMap,
  startX,
  startY,
  onEncounter,
  onInteract,
  onMenu,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const busRef = useRef(new InputBus());
  const overworldRef = useRef<Overworld | null>(null);
  const rendererRef = useRef(new OverworldRenderer());
  const [ready, setReady] = useState(false);
  const [mapName, setMapName] = useState('');
  const movementMode = useSettings((s) => s.movementMode);
  const zoomSetting = useSettings((s) => s.zoom);

  const onEncounterRef = useRef(onEncounter);
  const onInteractRef = useRef(onInteract);
  onEncounterRef.current = onEncounter;
  onInteractRef.current = onInteract;

  // --- Inicializacao --------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [world, spriteMeta] = await Promise.all([
        World.load(startMap),
        loadOverworldSprites(),
      ]);
      if (cancelled) return;

      const renderer = rendererRef.current;
      renderer.setSpriteMeta(spriteMeta);
      await renderer.preload(world);

      const overworld = new Overworld(world, { x: startX, y: startY }, new RNG());
      overworld.events = {
        onEncounter: (kind) => {
          haptic([18, 40, 18]);
          onEncounterRef.current(kind, overworld.world.map.id);
        },
        onMapChange: (map) => {
          setMapName(mapDisplayName(map));
          void renderer.preload(overworld.world);
          void renderer.preloadSprites(overworld.npcs.map((n) => n.data.gfx));
        },
      };
      await renderer.preloadSprites([
        'OBJ_EVENT_GFX_RED_NORMAL',
        ...overworld.npcs.map((n) => n.data.gfx),
      ]);

      overworldRef.current = overworld;
      setMapName(mapDisplayName(world.map));
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [startMap, startX, startY]);

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

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const frame = (now: number) => {
      const dt = Math.min(60, now - last);
      last = now;

      consumePath(overworld, bus);
      overworld.setIntent({ dir: bus.dir, running: bus.running });

      const action = bus.takeAction();
      if (action === 'a') interact(overworld, onInteractRef.current);

      overworld.update(dt);

      const player = overworld.player;
      const px = (player.fromX + (player.x - player.fromX) * player.progress) * TILE + TILE / 2;
      const py = (player.fromY + (player.y - player.fromY) * player.progress) * TILE + TILE / 2;
      const dpr = canvas.width / Math.max(1, canvas.getBoundingClientRect().width);
      const cssWidth = canvas.width / dpr;
      const scale =
        (zoomSetting > 0
          ? zoomSetting
          : clamp(Math.round(cssWidth / (TILE * TARGET_TILES_ACROSS)), 2, 6)) * dpr;

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
      if (e.key === 'z' || e.key === 'Z' || e.key === 'Enter') bus.press('a');
      if (e.key === 'x' || e.key === 'X' || e.key === 'Escape') bus.press('b');
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
      if (movementMode !== 'touch') return;
      const overworld = overworldRef.current;
      const canvas = canvasRef.current;
      if (!overworld || !canvas) return;

      const rect = canvas.getBoundingClientRect();
      const dpr = canvas.width / rect.width;
      const scale =
        (zoomSetting > 0 ? zoomSetting : clamp(Math.round(rect.width / (TILE * TARGET_TILES_ACROSS)), 2, 6));

      const player = overworld.player;
      const centerX = (e.clientX - rect.left - rect.width / 2) / scale;
      const centerY = (e.clientY - rect.top - rect.height / 2) / scale;
      const targetX = Math.floor(player.x + 0.5 + centerX / TILE);
      const targetY = Math.floor(player.y + 0.5 + centerY / TILE);
      void dpr;

      const path = findPath(overworld, { x: player.x, y: player.y }, { x: targetX, y: targetY });
      if (path && path.length > 0) {
        busRef.current.path = path;
        haptic(10);
      } else {
        haptic([4, 30, 4]);
      }
    },
    [movementMode, zoomSetting],
  );

  const dual = movementMode === 'oldschool-dual';

  return (
    <div className={dual ? 'overworld overworld-dual' : 'overworld'}>
      <div className="overworld-viewport">
        <canvas ref={canvasRef} className="overworld-canvas" onPointerDown={handleTap} />
        <div className="map-banner">{mapName}</div>
        {!ready && <div className="loading-overlay">Carregando Kanto…</div>}
        {ready && !dual && <Controls bus={busRef.current} mode={movementMode} onMenu={onMenu} />}
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

function interact(overworld: Overworld, onInteract: (message: string) => void): void {
  const facing = overworld.facingTile();
  const npc = overworld.npcAt(facing.x, facing.y);
  if (npc) {
    // Vira para o jogador antes de falar.
    const { dx, dy } = directionDelta(overworld.player.dir);
    npc.dir = dx === 1 ? 'left' : dx === -1 ? 'right' : dy === 1 ? 'up' : 'down';
    onInteract(describeNpc(npc.data.gfx, npc.data.trainer));
    haptic(12);
    return;
  }
  const tile = overworld.world.tileAt(facing.x, facing.y);
  if (tile.behavior === 'sign') {
    onInteract('Uma placa. As letras estao meio apagadas pelo tempo.');
    haptic(8);
  }
}

function describeNpc(gfx: string, trainer: boolean): string {
  if (trainer) return 'Esse treinador parece pronto para uma batalha.';
  if (gfx.includes('WOMAN') || gfx.includes('GIRL')) return 'Bom dia! Bonito tempo para viajar, nao acha?';
  if (gfx.includes('MAN') || gfx.includes('BOY')) return 'Dizem que na grama alta aparecem Pokemon selvagens.';
  return 'Ola!';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
