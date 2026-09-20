/**
 * Maquina de estados do personagem no mapa: andar em grade, virar, pular
 * ledges, cruzar a fronteira para o mapa vizinho, disparar encontros e warps.
 */
import type { Direction, GameMap, MapObject } from '../data/types.js';
import type { RNG } from '../core/rng.js';
import {
  World,
  directionDelta,
  isGrass,
  isWater,
  ledgeDirection,
} from './world.js';

/** Milissegundos por tile. O jogo original leva 16 frames andando, 8 correndo. */
const WALK_MS = 250;
const RUN_MS = 130;
const JUMP_MS = 380;
const TURN_MS = 70;

export interface PlayerState {
  x: number;
  y: number;
  dir: Direction;
  /** Progresso 0..1 do passo atual, usado para interpolar o desenho. */
  progress: number;
  fromX: number;
  fromY: number;
  moving: boolean;
  jumping: boolean;
  running: boolean;
  /** Quadro do ciclo de caminhada (0..3). */
  animFrame: number;
  steps: number;
  surfing: boolean;
}

export interface NpcState {
  data: MapObject;
  mapId: string;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  dir: Direction;
  fromX: number;
  fromY: number;
  progress: number;
  moving: boolean;
  animFrame: number;
  cooldown: number;
  visible: boolean;
}

export interface MoveIntent {
  dir: Direction | null;
  running: boolean;
}

export interface OverworldEvents {
  onEncounter?: (kind: 'land' | 'water') => void;
  onWarp?: (dest: string, warpId: number) => void;
  onMapChange?: (map: GameMap) => void;
  onStep?: (steps: number) => void;
  onBump?: () => void;
}

/** Onde o jogador esta, no formato que o save guarda. */
export interface PlayerPosition {
  map: string;
  x: number;
  y: number;
  dir: Direction;
}

export class Overworld {
  world: World;
  player: PlayerState;
  npcs: NpcState[] = [];
  events: OverworldEvents = {};
  /** Pausa tudo (dialogo aberto, batalha, transicao). */
  paused = false;

  private intent: MoveIntent = { dir: null, running: false };
  private moveElapsed = 0;
  private moveDuration = WALK_MS;
  private turnTimer = 0;
  private swapping = false;
  /** Tile de warp em que o jogador acabou de chegar: nao dispara de novo. */
  private warpLock: { x: number; y: number } | null = null;
  private readonly rng: RNG;

  constructor(world: World, spawn: { x: number; y: number; dir?: Direction }, rng: RNG) {
    this.world = world;
    this.rng = rng;
    this.player = {
      x: spawn.x,
      y: spawn.y,
      fromX: spawn.x,
      fromY: spawn.y,
      dir: spawn.dir ?? 'down',
      progress: 0,
      moving: false,
      jumping: false,
      running: false,
      animFrame: 0,
      steps: 0,
      surfing: false,
    };
    this.rebuildNpcs();
  }

  setIntent(intent: MoveIntent): void {
    this.intent = intent;
  }

  position(): PlayerPosition {
    return {
      map: this.world.map.id,
      x: this.player.x,
      y: this.player.y,
      dir: this.player.dir,
    };
  }

  /** Tile a frente do jogador -- o alvo de "falar/examinar". */
  facingTile(): { x: number; y: number } {
    const { dx, dy } = directionDelta(this.player.dir);
    return { x: this.player.x + dx, y: this.player.y + dy };
  }

  npcAt(x: number, y: number): NpcState | null {
    return this.npcs.find((n) => n.visible && n.x === x && n.y === y) ?? null;
  }

  update(dt: number): void {
    if (this.paused) return;

    this.updatePlayer(dt);
    this.updateNpcs(dt);
  }

  private updatePlayer(dt: number): void {
    const p = this.player;

    if (p.moving) {
      this.moveElapsed += dt;
      p.progress = Math.min(1, this.moveElapsed / this.moveDuration);
      p.animFrame = Math.floor(p.progress * 2) % 2;
      if (p.progress >= 1) {
        p.moving = false;
        p.jumping = false;
        p.progress = 0;
        p.fromX = p.x;
        p.fromY = p.y;
        p.steps++;
        this.events.onStep?.(p.steps);
        this.afterStep();
      }
      return;
    }

    if (this.turnTimer > 0) {
      this.turnTimer -= dt;
      return;
    }

    const dir = this.intent.dir;
    if (!dir) {
      p.animFrame = 0;
      return;
    }

    if (p.dir !== dir) {
      p.dir = dir;
      // Uma virada curta antes de sair andando, como nos jogos de GBA.
      this.turnTimer = TURN_MS;
      return;
    }

    this.tryStep(dir, this.intent.running);
  }

  private tryStep(dir: Direction, running: boolean): void {
    const p = this.player;
    const { dx, dy } = directionDelta(dir);
    const targetX = p.x + dx;
    const targetY = p.y + dy;
    const target = this.world.tileAt(targetX, targetY);

    // Ledge: passa so na direcao certa, e pula dois tiles.
    if (ledgeDirection(target.behavior) === dir) {
      const landingX = targetX + dx;
      const landingY = targetY + dy;
      if (this.isPassable(landingX, landingY, dir)) {
        p.fromX = p.x;
        p.fromY = p.y;
        p.x = landingX;
        p.y = landingY;
        p.moving = true;
        p.jumping = true;
        p.running = running;
        this.moveElapsed = 0;
        this.moveDuration = JUMP_MS;
        return;
      }
    }

    if (!this.isPassable(targetX, targetY, dir)) {
      // Em pe num capacho ou numa escada, andar contra a parede e o jeito de
      // sair -- e assim que se deixa um predio nos jogos originais.
      const here = this.world.tileAt(p.x, p.y);
      const onExit =
        here.behavior === 'door' || here.behavior === 'warp' || here.behavior === 'stairs';
      const warp = onExit ? this.world.warpAt(p.x, p.y) : null;
      if (warp && warp.warp.dest !== 'MAP_NONE') {
        this.warpLock = null;
        this.events.onWarp?.(warp.warp.dest, warp.warp.destWarp);
        return;
      }
      this.events.onBump?.();
      return;
    }

    p.fromX = p.x;
    p.fromY = p.y;
    p.x = targetX;
    p.y = targetY;
    p.moving = true;
    p.jumping = false;
    p.running = running && this.world.map.allowRunning;
    this.moveElapsed = 0;
    this.moveDuration = p.running ? RUN_MS : WALK_MS;
  }

  isPassable(x: number, y: number, fromDir: Direction): boolean {
    const tile = this.world.tileAt(x, y);
    if (tile.isBorder) return false;
    // Portas e escadas tem colisao no mapa original, mas o jogo deixa entrar
    // nelas: e assim que se atravessa um warp.
    if (tile.collision !== 0) {
      const isDoorway =
        tile.behavior === 'door' || tile.behavior === 'warp' || tile.behavior === 'stairs';
      if (!isDoorway || !this.world.warpAt(x, y)) return false;
    }
    if (tile.behavior === 'blocked') return false;
    if (isWater(tile.behavior) && !this.player.surfing) return false;
    if (!isWater(tile.behavior) && this.player.surfing && tile.behavior !== 'normal') return false;
    // Uma ledge so e atravessavel na direcao do pulo, tratada em tryStep.
    if (ledgeDirection(tile.behavior) !== null && ledgeDirection(tile.behavior) !== fromDir) {
      return false;
    }
    if (this.npcAt(x, y)) return false;
    return true;
  }

  private afterStep(): void {
    const p = this.player;

    // Cruzou para o territorio de um mapa vizinho? Troca o mapa "dono".
    const neighbour = this.world.neighbourAt(p.x, p.y);
    if (neighbour && !this.swapping) {
      void this.swapTo(neighbour.map.id, p.x - neighbour.offsetX, p.y - neighbour.offsetY);
      return;
    }

    // Saiu do tile em que caiu vindo de um warp: pode teleportar de novo.
    if (this.warpLock && (this.warpLock.x !== p.x || this.warpLock.y !== p.y)) {
      this.warpLock = null;
    }

    const warp = this.world.warpAt(p.x, p.y);
    if (warp && warp.warp.dest !== 'MAP_NONE' && !this.warpLock) {
      this.events.onWarp?.(warp.warp.dest, warp.warp.destWarp);
      return;
    }

    const tile = this.world.tileAt(p.x, p.y);
    if (isGrass(tile.behavior)) this.rollEncounter('land');
    else if (this.player.surfing && isWater(tile.behavior)) this.rollEncounter('water');
  }

  private rollEncounter(kind: 'land' | 'water'): void {
    const table = kind === 'land' ? this.world.map.encounters?.land : this.world.map.encounters?.water;
    if (!table || table.slots.length === 0) return;
    // Mesma chance do Gen 3: Random() % 2880 < rate * 16.
    if (this.rng.next() * 180 < table.rate) this.events.onEncounter?.(kind);
  }

  /** Chega num mapa vindo de um warp, sem disparar o warp de destino. */
  async arriveFromWarp(mapId: string, x: number, y: number, dir?: Direction): Promise<void> {
    await this.swapTo(mapId, x, y, dir);
    this.warpLock = { x, y };
  }

  /**
   * Desce um tile se der: ao sair de um warp o jogador fica em pe na porta, e
   * o jogo original o coloca um passo a frente dela.
   */
  stepOutOfDoor(): void {
    const p = this.player;
    if (!this.isPassable(p.x, p.y + 1, 'down')) return;
    if (this.world.warpAt(p.x, p.y + 1)) return;
    p.y += 1;
    p.fromY = p.y;
    p.dir = 'down';
    this.warpLock = null;
  }

  async swapTo(mapId: string, x: number, y: number, dir?: Direction): Promise<void> {
    this.swapping = true;
    try {
      const world = await World.load(mapId);
      this.world = world;
      this.player.x = x;
      this.player.y = y;
      this.player.fromX = x;
      this.player.fromY = y;
      this.player.progress = 0;
      this.player.moving = false;
      if (dir) this.player.dir = dir;
      this.rebuildNpcs();
      this.events.onMapChange?.(world.map);
    } finally {
      this.swapping = false;
    }
  }

  rebuildNpcs(): void {
    const npcs: NpcState[] = [];
    const addFrom = (map: GameMap, offsetX: number, offsetY: number) => {
      for (const obj of map.objects) {
        npcs.push({
          data: obj,
          mapId: map.id,
          x: obj.x + offsetX,
          y: obj.y + offsetY,
          homeX: obj.x + offsetX,
          homeY: obj.y + offsetY,
          fromX: obj.x + offsetX,
          fromY: obj.y + offsetY,
          dir: initialFacing(obj.movement),
          progress: 0,
          moving: false,
          animFrame: 0,
          cooldown: 500 + Math.floor(this.rng.next() * 2500),
          visible: true,
        });
      }
    };
    addFrom(this.world.map, 0, 0);
    for (const n of this.world.neighbours) addFrom(n.map, n.offsetX, n.offsetY);
    this.npcs = npcs;
  }

  private updateNpcs(dt: number): void {
    for (const npc of this.npcs) {
      if (npc.moving) {
        npc.progress += dt / WALK_MS;
        npc.animFrame = Math.floor(npc.progress * 2) % 2;
        if (npc.progress >= 1) {
          npc.moving = false;
          npc.progress = 0;
          npc.fromX = npc.x;
          npc.fromY = npc.y;
          npc.cooldown = 900 + this.rng.next() * 2600;
        }
        continue;
      }

      const pattern = movementPattern(npc.data.movement);
      if (pattern === 'static') continue;

      npc.cooldown -= dt;
      if (npc.cooldown > 0) continue;
      npc.cooldown = 900 + this.rng.next() * 2600;

      const dir = pickNpcDirection(pattern, this.rng);
      npc.dir = dir;
      if (pattern === 'look') continue;

      const { dx, dy } = directionDelta(dir);
      const nx = npc.x + dx;
      const ny = npc.y + dy;
      if (Math.abs(nx - npc.homeX) > npc.data.rangeX) continue;
      if (Math.abs(ny - npc.homeY) > npc.data.rangeY) continue;
      if (nx === this.player.x && ny === this.player.y) continue;
      if (this.npcAt(nx, ny)) continue;
      const tile = this.world.tileAt(nx, ny);
      if (tile.isBorder || tile.collision !== 0 || tile.behavior === 'blocked') continue;

      npc.fromX = npc.x;
      npc.fromY = npc.y;
      npc.x = nx;
      npc.y = ny;
      npc.moving = true;
      npc.progress = 0;
    }
  }
}

type Pattern = 'static' | 'look' | 'wander' | 'vertical' | 'horizontal';

function movementPattern(movement: string): Pattern {
  if (movement.includes('WANDER_AROUND')) return 'wander';
  if (movement.includes('WANDER_UP_AND_DOWN') || movement.includes('WALK_UP_AND_DOWN')) {
    return 'vertical';
  }
  if (movement.includes('WANDER_LEFT_AND_RIGHT') || movement.includes('WALK_LEFT_AND_RIGHT')) {
    return 'horizontal';
  }
  if (movement.includes('LOOK_AROUND') || movement.includes('ROTATE')) return 'look';
  return 'static';
}

function pickNpcDirection(pattern: Pattern, rng: RNG): Direction {
  const options: Direction[] =
    pattern === 'vertical'
      ? ['up', 'down']
      : pattern === 'horizontal'
        ? ['left', 'right']
        : ['up', 'down', 'left', 'right'];
  return options[Math.floor(rng.next() * options.length)];
}

function initialFacing(movement: string): Direction {
  if (movement.includes('FACE_UP')) return 'up';
  if (movement.includes('FACE_LEFT')) return 'left';
  if (movement.includes('FACE_RIGHT')) return 'right';
  return 'down';
}
