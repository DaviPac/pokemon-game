/**
 * Renderer do overworld em canvas 2D: desenha so os tiles visiveis, empilha
 * personagens por Y e mantem os pixels nitidos em qualquer zoom.
 */
import { overworldImage, tilesetImage } from '../data/assets.js';
import type { Direction, GameMap, OverworldSpriteMeta } from '../data/types.js';
import { TILE, World } from '../world/world.js';
import type { NpcState, PlayerState } from '../world/overworld.js';

const METATILE = 16;
const FALLBACK_SPRITE = 'OBJ_EVENT_GFX_RED_NORMAL';

export interface Camera {
  /** Centro da camera em pixels do mundo. */
  x: number;
  y: number;
  scale: number;
}

export class OverworldRenderer {
  private atlases = new Map<string, HTMLImageElement>();
  private sprites = new Map<string, HTMLImageElement>();
  private running = new Map<string, HTMLImageElement>();
  private spriteMeta: Record<string, OverworldSpriteMeta> = {};

  setSpriteMeta(meta: Record<string, OverworldSpriteMeta>): void {
    this.spriteMeta = meta;
  }

  /** Carrega os atlas dos tilesets do mapa atual e dos vizinhos. */
  async preload(world: World): Promise<void> {
    const labels = new Set<string>();
    const collect = (map: GameMap) => {
      labels.add(map.primary);
      if (map.secondary) labels.add(map.secondary);
    };
    collect(world.map);
    for (const n of world.neighbours) collect(n.map);

    await Promise.all(
      [...labels].map(async (label) => {
        if (this.atlases.has(label)) return;
        const meta = world.metaByLabel(label);
        if (!meta) return;
        try {
          this.atlases.set(label, await tilesetImage(meta.atlas));
        } catch {
          // Tileset ausente: os tiles dele ficam transparentes.
        }
      }),
    );
  }

  async preloadSprites(gfxIds: Iterable<string>): Promise<void> {
    await Promise.all(
      [...new Set(gfxIds)].map(async (gfx) => {
        if (this.sprites.has(gfx)) return;
        const meta = this.spriteMeta[gfx] ?? this.spriteMeta[FALLBACK_SPRITE];
        if (!meta) return;
        try {
          this.sprites.set(gfx, await overworldImage(meta.file));
        } catch {
          // sem sprite: o NPC simplesmente nao aparece
        }
        if (meta.run) {
          try {
            this.running.set(gfx, await overworldImage(meta.run));
          } catch {
            // sem folha de corrida: sobra a de caminhada, acelerada
          }
        }
      }),
    );
  }

  draw(
    ctx: CanvasRenderingContext2D,
    world: World,
    player: PlayerState,
    npcs: NpcState[],
    camera: Camera,
    viewWidth: number,
    viewHeight: number,
  ): void {
    const { scale } = camera;
    ctx.imageSmoothingEnabled = false;
    // Interiores sao menores que uma tela de celular em retrato; o que sobra
    // recebe o fundo do app, nao um preto chapado.
    ctx.fillStyle = '#0a0d12';
    ctx.fillRect(0, 0, viewWidth, viewHeight);

    // Canto superior esquerdo da area visivel, em pixels do mundo.
    const originX = camera.x - viewWidth / (2 * scale);
    const originY = camera.y - viewHeight / (2 * scale);

    const firstTileX = Math.floor(originX / TILE) - 1;
    const firstTileY = Math.floor(originY / TILE) - 1;
    const tilesAcross = Math.ceil(viewWidth / (TILE * scale)) + 3;
    const tilesDown = Math.ceil(viewHeight / (TILE * scale)) + 3;

    ctx.save();
    // A camera e arredondada em pixels de tela, nao do mundo: com uma escala
    // inteira, cada tile cai exatamente sobre a grade de pixels do aparelho.
    // Sem isso, as bordas caiam no meio de um pixel e sobrava uma linha fina do
    // fundo entre um tile e outro.
    ctx.setTransform(scale, 0, 0, scale, -Math.round(originX * scale), -Math.round(originY * scale));

    for (let ty = firstTileY; ty < firstTileY + tilesDown; ty++) {
      for (let tx = firstTileX; tx < firstTileX + tilesAcross; tx++) {
        const tile = world.tileAt(tx, ty);
        const meta = world.tilesetMetaFor(tile.map, tile.metatile);
        if (!meta) continue;
        const label = tile.metatile >= 640 ? tile.map.secondary : tile.map.primary;
        const atlas = label ? this.atlases.get(label) : undefined;
        if (!atlas) continue;

        const local = tile.metatile >= 640 ? tile.metatile - 640 : tile.metatile;
        const sx = (local % meta.columns) * METATILE;
        const sy = Math.floor(local / meta.columns) * METATILE;
        ctx.drawImage(atlas, sx, sy, METATILE, METATILE, tx * TILE, ty * TILE, TILE, TILE);
      }
    }

    // Personagens em ordem de profundidade: quem esta mais abaixo cobre.
    // A posicao vai arredondada em pixels do mundo, como no GBA: meio pixel
    // deixaria o sprite tremendo a cada quadro.
    const actors: { y: number; draw: () => void }[] = [];
    for (const npc of npcs) {
      const px = Math.round(lerp(npc.fromX, npc.x, npc.progress) * TILE);
      const py = Math.round(lerp(npc.fromY, npc.y, npc.progress) * TILE);
      if (px < originX - 64 || py < originY - 96) continue;
      if (px > originX + viewWidth / scale + 64 || py > originY + viewHeight / scale + 96) continue;
      actors.push({
        y: py,
        draw: () =>
          this.drawCharacter(ctx, npc.data.gfx, px, py, {
            dir: npc.dir,
            moving: npc.moving,
            animFrame: npc.animFrame,
          }),
      });
    }

    const playerPx = Math.round(lerp(player.fromX, player.x, player.progress) * TILE);
    let playerPy = lerp(player.fromY, player.y, player.progress) * TILE;
    if (player.jumping) {
      // Arco do pulo de ledge.
      playerPy -= Math.sin(player.progress * Math.PI) * 10;
    }
    playerPy = Math.round(playerPy);
    actors.push({
      y: playerPy,
      draw: () =>
        this.drawCharacter(ctx, FALLBACK_SPRITE, playerPx, playerPy, {
          dir: player.dir,
          moving: player.moving,
          animFrame: player.animFrame,
          // Correndo, o passo alterna a cada tile: um pe em cada passo, como
          // no original -- por isso a contagem de passos entra na conta.
          running: player.running && !player.jumping,
          step: player.steps,
        }),
    });

    actors.sort((a, b) => a.y - b.y);
    for (const actor of actors) actor.draw();

    // Contorno do mapa quando ele nao preenche a tela: deixa claro que o vazio
    // e o limite do comodo, e nao uma falha de carregamento.
    const mapPixelWidth = world.map.width * TILE;
    const mapPixelHeight = world.map.height * TILE;
    if (mapPixelWidth * scale < viewWidth || mapPixelHeight * scale < viewHeight) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.lineWidth = 1 / scale;
      ctx.strokeRect(0, 0, mapPixelWidth, mapPixelHeight);
    }

    ctx.restore();
  }

  private drawCharacter(
    ctx: CanvasRenderingContext2D,
    gfx: string,
    px: number,
    py: number,
    pose: {
      dir: Direction;
      moving: boolean;
      animFrame: number;
      running?: boolean;
      step?: number;
    },
  ): void {
    const meta = this.spriteMeta[gfx] ?? this.spriteMeta[FALLBACK_SPRITE];
    if (!meta) return;

    // Correr tem folha propria: nao e a caminhada acelerada.
    const runSheet = pose.running && pose.moving ? this.running.get(gfx) : undefined;
    const image = runSheet ?? this.sprites.get(gfx) ?? this.sprites.get(FALLBACK_SPRITE);
    if (!image) return;

    const { frame, flip } = runSheet
      ? runningFrame(pose.dir, pose.animFrame, pose.step ?? 0)
      : characterFrame(pose.dir, pose.moving, pose.animFrame, meta.frames);
    const perRow = Math.max(1, Math.floor(image.width / meta.frameWidth));
    const sx = (frame % perRow) * meta.frameWidth;
    const sy = Math.floor(frame / perRow) * meta.frameHeight;

    // O sprite tem 32px de altura mas ocupa um tile de 16: os pes ficam na base.
    const dx = px + (TILE - meta.frameWidth) / 2;
    const dy = py + TILE - meta.frameHeight;

    ctx.save();
    if (flip) {
      ctx.translate(dx + meta.frameWidth, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(image, sx, sy, meta.frameWidth, meta.frameHeight, 0, 0, meta.frameWidth, meta.frameHeight);
    } else {
      ctx.drawImage(
        image,
        sx,
        sy,
        meta.frameWidth,
        meta.frameHeight,
        dx,
        dy,
        meta.frameWidth,
        meta.frameHeight,
      );
    }
    ctx.restore();
  }
}

/**
 * Ordem das poses nas folhas do FireRed: parado sul/norte/oeste e depois dois
 * quadros de caminhada para cada uma. O leste e o oeste espelhado.
 */
function characterFrame(
  dir: Direction,
  moving: boolean,
  animFrame: number,
  totalFrames: number,
): { frame: number; flip: boolean } {
  if (totalFrames < 3) return { frame: 0, flip: false };
  const flip = dir === 'right';
  if (!moving) {
    return { frame: dir === 'down' ? 0 : dir === 'up' ? 1 : 2, flip };
  }
  if (totalFrames < 9) {
    return { frame: dir === 'down' ? 0 : dir === 'up' ? 1 : 2, flip };
  }
  const pairs: Record<Direction, [number, number]> = {
    down: [3, 4],
    up: [5, 6],
    left: [7, 8],
    right: [7, 8],
  };
  return { frame: pairs[dir][animFrame % 2], flip };
}

/**
 * Folha de corrida: tres quadros por direcao (parado, pe direito, pe esquerdo),
 * na ordem sul, norte, oeste. Como no original, cada passo mostra o corpo
 * neutro e depois um pe, alternando o pe a cada tile percorrido.
 */
function runningFrame(
  dir: Direction,
  animFrame: number,
  step: number,
): { frame: number; flip: boolean } {
  const base = dir === 'down' ? 0 : dir === 'up' ? 3 : 6;
  const foot = 1 + (step % 2);
  return { frame: animFrame % 2 === 0 ? base : base + foot, flip: dir === 'right' };
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}
