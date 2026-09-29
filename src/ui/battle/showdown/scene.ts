/**
 * Cena compativel com as animacoes de golpe do Pokemon Showdown.
 *
 * As tabelas do Showdown (src/vendor/showdown) descrevem cada golpe como
 * chamadas a uma cena: `showEffect` solta uma imagem que viaja de um ponto a
 * outro, `attacker.anim(...)` move o Pokemon, `backgroundEffect` tinge o
 * fundo. La, quem executa isso e o jQuery sobre um palco de 640x360 com o
 * jogador perto (z = 0) e o oponente longe (z = 200).
 *
 * Aqui a mesma descricao vira Web Animations sobre o nosso campo 3D. O palco
 * do Showdown e mapeado para o nosso pela posicao real dos sprites: o ponto
 * onde o Showdown poe o Pokemon do jogador cai no centro do nosso sprite do
 * jogador, o do oponente no centro do nosso oponente, e a escala acompanha o
 * tamanho de cada um. Assim a Thunderbolt continua caindo em cima do alvo e o
 * Tackle continua indo ate ele, mesmo com o campo tendo outro formato.
 */
import type { Side } from '../../../game/battle/types.js';

/** Posicao no palco do Showdown. */
interface ScenePos {
  x?: number;
  y?: number;
  z?: number;
  scale?: number;
  xscale?: number;
  yscale?: number;
  opacity?: number;
  time?: number;
  display?: string;
}

/** Uma imagem de efeito (ou o proprio sprite do Pokemon). */
interface SpriteData {
  url?: string;
  rawHTML?: string;
  w: number;
  h: number;
  y?: number;
  gen?: number;
}

interface AnimData {
  anim(scene: Scene, args: SceneSprite[]): void;
  prepareAnim?(scene: Scene, args: SceneSprite[]): void;
  residualAnim?(scene: Scene, args: SceneSprite[]): void;
}

type AnimTable = Record<string, AnimData>;

interface Tables {
  moves: AnimTable;
  other: AnimTable;
  status: AnimTable;
  effects: Record<string, SpriteData>;
}

/** Caixa na tela, em pixels do nosso palco. */
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
  opacity: number;
}

type Easing = (x: number) => number;

/** As curvas que o Showdown registra no jQuery, e as duas nativas dele. */
const EASINGS: Record<string, Easing> = {
  linear: (x) => x,
  swing: (x) => 0.5 - Math.cos(x * Math.PI) / 2,
  ballisticUp: (x) => -3 * x * x + 4 * x,
  ballisticDown: (x) => {
    const y = 1 - x;
    return 1 - (-3 * y * y + 4 * y);
  },
  quadUp: (x) => 1 - (1 - x) * (1 - x),
  quadDown: (x) => x * x,
};

type BoxEasing = Record<keyof Box, Easing>;

const LINEAR: BoxEasing = {
  left: EASINGS.linear,
  top: EASINGS.linear,
  width: EASINGS.linear,
  height: EASINGS.linear,
  opacity: EASINGS.linear,
};

/** Imagens que nao vem junto com o jogo e as que ficam no lugar delas. */
const REPLACED_EFFECTS: Record<string, string> = {
  rocks: 'rock3',
  rock1: 'rock3',
  rock2: 'rock3',
  bone: 'rock3',
};

const FX_BASE = `${import.meta.env.BASE_URL ?? '/'}assets/fx/`.replace(/\/{2,}/g, '/');

/**
 * Uma fila de animacao por elemento, como a do jQuery: cada `animate` comeca
 * quando o anterior termina, e `delay` empurra o proximo.
 */
class Track {
  cursor = 0;
  readonly initial: Box;
  private current: Box;
  readonly segments: { start: number; end: number; from: Box; to: Box; ease: BoxEasing }[] = [];

  constructor(initial: Box) {
    this.initial = { ...initial };
    this.current = { ...initial };
  }

  get state(): Box {
    return this.current;
  }

  delay(time: number): void {
    this.cursor += Math.max(0, time);
  }

  animate(to: Partial<Box>, duration: number, ease: BoxEasing = LINEAR): void {
    const target = { ...this.current, ...to };
    const time = Math.max(0, duration);
    this.segments.push({ start: this.cursor, end: this.cursor + time, from: this.current, to: target, ease });
    this.current = target;
    this.cursor += time;
  }

  get end(): number {
    return this.cursor;
  }

  /** Estado num instante qualquer, para amostrar os quadros-chave. */
  at(time: number): Box {
    let box = this.initial;
    for (const segment of this.segments) {
      if (time < segment.start) break;
      if (time >= segment.end || segment.end === segment.start) {
        box = segment.to;
        continue;
      }
      const progress = (time - segment.start) / (segment.end - segment.start);
      const mix = (key: keyof Box) =>
        segment.from[key] + (segment.to[key] - segment.from[key]) * segment.ease[key](progress);
      return {
        left: mix('left'),
        top: mix('top'),
        width: mix('width'),
        height: mix('height'),
        opacity: mix('opacity'),
      };
    }
    return box;
  }

  /** Instantes em que vale a pena ter um quadro-chave. */
  sampleTimes(step = 24): number[] {
    const times = new Set<number>([0]);
    for (const segment of this.segments) {
      times.add(segment.start);
      times.add(segment.end);
      for (let t = segment.start + step; t < segment.end; t += step) times.add(t);
    }
    return [...times].sort((a, b) => a - b);
  }
}

/** Um efeito na tela, que as tabelas podem continuar animando. */
interface EffectHandle {
  element: HTMLElement;
  track: Track;
  data: SpriteData;
}

/** Referencias ao palco da nossa tela de batalha. */
export interface StageRefs {
  stage: HTMLElement;
  /** Camada dos efeitos, por cima dos Pokemon. */
  fx: HTMLElement;
  /** Camada dos fundos, entre o campo e os Pokemon. */
  bgfx: HTMLElement;
  /** O campo 3D, que treme em golpes como Earthquake. */
  field: HTMLElement | null;
  player: HTMLImageElement | null;
  foe: HTMLImageElement | null;
}

/** Medidas do palco que ligam o espaco do Showdown ao nosso. */
interface Frame {
  near: { cx: number; cy: number; k: number };
  far: { cx: number; cy: number; k: number };
}

/**
 * O Pokemon na cena, com a interface que as tabelas do Showdown esperam:
 * posicao (x, y, z), `anim`, `delay`, `behind` e `leftof`.
 */
export class SceneSprite {
  x = 0;
  y = 0;
  readonly z: number;
  readonly isFrontSprite: boolean;
  isMissedPokemon = false;
  readonly sp: SpriteData;
  readonly track: Track | null;
  private readonly scene: Scene;

  constructor(scene: Scene, side: Side, element: HTMLImageElement | null, missed = false) {
    this.scene = scene;
    this.isFrontSprite = side === 'foe';
    this.z = this.isFrontSprite ? 200 : 0;
    // O alvo de um golpe que errou e um lugar vazio ao lado do Pokemon.
    if (missed) {
      this.isMissedPokemon = true;
      this.x = this.isFrontSprite ? -100 : 100;
    }
    const ratio = element && element.offsetWidth > 0 ? element.offsetHeight / element.offsetWidth : 1;
    this.sp = { url: element?.currentSrc || element?.src, w: 96, h: 96 * ratio, gen: 5 };
    this.track = element && !missed ? new Track(scene.place({ x: 0, y: 0, z: this.z }, this.sp)) : null;
  }

  behindx(offset: number): number {
    return this.x + (this.isFrontSprite ? 1 : -1) * offset;
  }

  behindy(offset: number): number {
    return this.y + (this.isFrontSprite ? -1 : 1) * offset;
  }

  leftof(offset: number): number {
    return this.x + (this.isFrontSprite ? 1 : -1) * offset;
  }

  behind(offset: number): number {
    return this.z + (this.isFrontSprite ? 1 : -1) * offset;
  }

  delay(time: number): this {
    this.track?.delay(time);
    return this;
  }

  anim(end: ScenePos, transition?: string): this {
    if (!this.track) return this;
    const target: ScenePos = { x: this.x, y: this.y, z: this.z, scale: 1, opacity: 1, time: 500, ...end };
    const box = this.scene.place(target, this.sp);
    // Como no Showdown, a direcao do arco se mede a partir do lugar de repouso.
    const ease = this.scene.easing(transition, box, this.track.initial, target);
    this.track.animate(box, target.time ?? 500, ease);
    return this;
  }
}

/** A cena que as tabelas do Showdown recebem como `scene`. */
export class Scene {
  timeOffset = 0;
  readonly battle = { mySide: { x: 0, y: 0, z: 0 } };
  readonly $bg: BackgroundProxy;

  private readonly refs: StageRefs;
  private readonly frame: Frame;
  private readonly tables: Tables;
  private readonly effects: EffectHandle[] = [];
  private readonly backgrounds: { element: HTMLElement; keyframes: Keyframe[]; duration: number }[] = [];

  constructor(refs: StageRefs, tables: Tables) {
    this.refs = refs;
    this.tables = tables;
    this.frame = measure(refs);
    this.$bg = new BackgroundProxy();
  }

  // --- API que as tabelas usam -----------------------------------------------

  wait(time: number): void {
    this.timeOffset += time;
  }

  showEffect(
    effect: string | SpriteData,
    start: ScenePos,
    end: ScenePos,
    transition?: string,
    after?: string,
    css?: Partial<CSSStyleDeclaration>,
  ): EffectHandle | null {
    const data = this.effectData(effect);
    if (!data?.url) return null;
    const element = document.createElement('img');
    element.className = 'sd-effect';
    element.src = data.url;
    element.alt = '';
    element.draggable = false;
    element.style.width = `${data.w}px`;
    element.style.height = `${data.h}px`;
    element.style.opacity = '0';
    if (css?.filter) element.style.filter = css.filter;
    this.refs.fx.appendChild(element);

    const handle: EffectHandle = {
      element,
      track: new Track({ left: 0, top: 0, width: data.w, height: data.h, opacity: 0 }),
      data,
    };
    this.effects.push(handle);
    this.runEffect(handle.track, data, start, end, transition, after);
    return handle;
  }

  /** Continua a animacao de um efeito que ja esta na tela. */
  animateEffect(
    handle: EffectHandle | null,
    effect: string | SpriteData,
    start: ScenePos,
    end: ScenePos,
    transition?: string,
    after?: string,
    css?: Partial<CSSStyleDeclaration>,
  ): EffectHandle | null {
    if (!handle) return this.showEffect(effect, start, end, transition, after, css);
    if (css?.filter) handle.element.style.filter = css.filter;
    this.runEffect(handle.track, this.effectData(effect) ?? handle.data, start, end, transition, after);
    return handle;
  }

  backgroundEffect(bg: string, duration: number, opacity = 1, delay = 0): void {
    const element = document.createElement('div');
    element.className = 'sd-background';
    element.style.background = bg.replace(/https?:\/\/__SHOWDOWN_FX__\/fx\//g, FX_BASE);
    element.style.backgroundSize = 'cover';
    element.style.backgroundPosition = 'center';
    element.style.opacity = '0';
    this.refs.bgfx.appendChild(element);
    const total = delay + duration + 250;
    const at = (time: number) => Math.min(1, time / total);
    this.backgrounds.push({
      element,
      duration: total,
      keyframes: [
        { opacity: 0, offset: 0 },
        { opacity: 0, offset: at(delay) },
        { opacity, offset: at(delay + 250) },
        { opacity, offset: at(delay + duration) },
        { opacity: 0, offset: 1 },
      ],
    });
  }

  // --- Mapeamento -------------------------------------------------------------

  /**
   * O `pos` do Showdown, mas em pixels do nosso palco. A profundidade (z)
   * interpola entre o Pokemon do jogador e o do oponente; x e y sao deslocados
   * na escala daquela profundidade.
   */
  place(loc: ScenePos, obj: SpriteData): Box {
    const x = loc.x ?? 0;
    const y = loc.y ?? 0;
    const z = loc.z ?? 0;
    const scale = loc.scale ?? 1;
    const xscale = loc.xscale || loc.xscale === 0 ? loc.xscale : scale;
    const yscale = loc.yscale || loc.yscale === 0 ? loc.yscale : scale;
    const depth = z / 200;

    let psScale = obj.gen === 5 ? 2 - depth : 1.5 - 0.5 * depth;
    if (psScale < 0.1) psScale = 0.1;
    const { near, far } = this.frame;
    const k = Math.max(0.05, near.k + (far.k - near.k) * depth);
    const cx = near.cx + (far.cx - near.cx) * depth + Math.floor(x * psScale) * k;
    const cy = near.cy + (far.cy - near.cy) * depth - Math.floor(y * psScale) * k;
    const width = obj.w * psScale * xscale * k;
    const height = obj.h * psScale * yscale * k;
    const hoffset = (obj.h - (obj.y ?? 0) * 2) * psScale * yscale * k;
    return {
      left: cx - width / 2,
      top: cy - hoffset / 2,
      width,
      height,
      opacity: loc.opacity ?? 1,
    };
  }

  /** As curvas de cada propriedade, como o `posT` do Showdown escolhe. */
  easing(transition: string | undefined, to: Box, from: Box, loc: ScenePos): BoxEasing {
    const ease = { ...LINEAR };
    const goingUp = to.top < from.top;
    switch (transition) {
      case 'ballistic':
        ease.top = goingUp ? EASINGS.ballisticUp : EASINGS.ballisticDown;
        break;
      case 'ballisticUnder':
        ease.top = goingUp ? EASINGS.ballisticDown : EASINGS.ballisticUp;
        break;
      case 'ballistic2':
        ease.top = goingUp ? EASINGS.quadUp : EASINGS.quadDown;
        break;
      case 'ballistic2Back':
        ease.top = (loc.z ?? 0) > 0 ? EASINGS.quadUp : EASINGS.quadDown;
        break;
      case 'ballistic2Under':
        ease.top = goingUp ? EASINGS.quadDown : EASINGS.quadUp;
        break;
      case 'swing':
        ease.left = ease.top = ease.width = ease.height = EASINGS.swing;
        break;
      case 'accel':
        ease.left = ease.top = ease.width = ease.height = EASINGS.quadDown;
        break;
      case 'decel':
        ease.left = ease.top = ease.width = ease.height = EASINGS.quadUp;
        break;
    }
    return ease;
  }

  private effectData(effect: string | SpriteData): SpriteData | null {
    if (typeof effect !== 'string') return effect;
    const id = REPLACED_EFFECTS[effect] ?? effect;
    const data = this.tables.effects[id];
    if (!data) return null;
    return data.url ? { ...data, url: FX_BASE + data.url } : data;
  }

  /** O `animateEffect` do Showdown, passo a passo. */
  private runEffect(
    track: Track,
    data: SpriteData,
    rawStart: ScenePos,
    rawEnd: ScenePos,
    transition: string | undefined,
    after: string | undefined,
  ): void {
    const start: ScenePos = { ...rawStart };
    let end: ScenePos = { ...rawEnd };
    if (!start.time) start.time = 0;
    if (!end.time) end.time = start.time + 500;
    start.time += this.timeOffset;
    end.time += this.timeOffset;
    if (!end.scale && end.scale !== 0 && start.scale) end.scale = start.scale;
    if (!end.xscale && end.xscale !== 0 && start.xscale) end.xscale = start.xscale;
    if (!end.yscale && end.yscale !== 0 && start.yscale) end.yscale = start.yscale;
    end = { ...start, ...end };

    const startBox = this.place(start, data);
    const endBox = this.place(end, data);

    if (start.time) {
      // Espera invisivel no ponto de partida e aparece de uma vez.
      track.animate({ ...startBox, opacity: 0 }, 0);
      track.delay(start.time);
      track.animate({ opacity: startBox.opacity }, 1);
    } else {
      track.animate(startBox, 0);
    }
    track.animate(endBox, (end.time ?? 0) - start.time, this.easing(transition, endBox, startBox, end));
    if (after === 'fade') track.animate({ opacity: 0 }, 100);
    if (after === 'explode') {
      const exploded: ScenePos = {
        ...end,
        scale: end.scale ? end.scale * 3 : end.scale,
        xscale: end.xscale ? end.xscale * 3 : end.xscale,
        yscale: end.yscale ? end.yscale * 3 : end.yscale,
        opacity: 0,
      };
      track.animate(this.place(exploded, data), 200);
    }
  }

  // --- Execucao ---------------------------------------------------------------

  /**
   * Toca tudo o que as tabelas descreveram e espera acabar. `keep` deixa os
   * Pokemon onde a animacao os deixou (Fly, Dig: somem ate o turno seguinte).
   */
  async play(sprites: SceneSprite[], speed: number, keep = false): Promise<Animation[]> {
    const running: Animation[] = [];
    let total = this.timeOffset;

    for (const { element, track, data } of this.effects) {
      const { w, h } = data;
      const keyframes = track.sampleTimes().map((time) => {
        const box = track.at(time);
        return {
          offset: track.end > 0 ? time / track.end : 1,
          transform: `translate(${box.left}px, ${box.top}px) scale(${box.width / w}, ${box.height / h})`,
          opacity: box.opacity,
        };
      });
      total = Math.max(total, track.end);
      running.push(animateElement(element, keyframes, track.end, speed));
    }

    for (const sprite of sprites) {
      const track = sprite.track;
      if (!track || track.segments.length === 0) continue;
      const element = sprite.isFrontSprite ? this.refs.foe : this.refs.player;
      if (!element) continue;
      const rest = track.initial;
      const restCx = rest.left + rest.width / 2;
      const restCy = rest.top + rest.height / 2;
      const height = element.offsetHeight;
      const keyframes = track.sampleTimes().map((time) => {
        const box = track.at(time);
        const sx = rest.width ? box.width / rest.width : 1;
        const sy = rest.height ? box.height / rest.height : 1;
        const dx = box.left + box.width / 2 - restCx;
        // O sprite cresce a partir dos pes (transform-origin embaixo); o
        // centro sobe junto, e a translacao compensa.
        const dy = box.top + box.height / 2 - restCy + ((sy - 1) * height) / 2;
        return {
          offset: track.end > 0 ? time / track.end : 1,
          transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
          opacity: box.opacity,
        };
      });
      total = Math.max(total, track.end);
      running.push(animateElement(element, keyframes, track.end, speed, keep));
    }

    for (const { element, keyframes, duration } of this.backgrounds) {
      total = Math.max(total, duration);
      running.push(animateElement(element, keyframes, duration, speed));
    }

    const shake = this.$bg.keyframes(this.frame.near.k);
    if (shake && this.refs.field) {
      total = Math.max(total, shake.duration);
      running.push(animateElement(this.refs.field, shake.keyframes, shake.duration, speed));
    }

    await new Promise((resolve) => setTimeout(resolve, total / speed));
    for (const { element } of this.effects) element.remove();
    for (const { element } of this.backgrounds) element.remove();
    const kept: Animation[] = [];
    for (const animation of running) {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      if (keep && (target === this.refs.player || target === this.refs.foe)) kept.push(animation);
      else animation.cancel();
    }
    return kept;
  }
}

/**
 * O fundo do Showdown (`scene.$bg`) so e mexido para tremer a tela. Aqui a
 * tremida vai para o campo 3D inteiro.
 */
class BackgroundProxy {
  private cursor = 0;
  private top = -90;
  private readonly steps: { start: number; end: number; from: number; to: number }[] = [];

  delay(time: number): this {
    this.cursor += time;
    return this;
  }

  animate(props: { top?: number }, duration = 400): this {
    const to = props.top ?? this.top;
    this.steps.push({ start: this.cursor, end: this.cursor + duration, from: this.top, to });
    this.top = to;
    this.cursor += duration;
    return this;
  }

  keyframes(k: number): { keyframes: Keyframe[]; duration: number } | null {
    if (this.steps.length === 0 || this.cursor <= 0) return null;
    const frames: Keyframe[] = [{ offset: 0, transform: 'translateY(0px)' }];
    for (const step of this.steps) {
      frames.push({ offset: step.start / this.cursor, transform: `translateY(${(step.from + 90) * k}px)` });
      frames.push({ offset: step.end / this.cursor, transform: `translateY(${(step.to + 90) * k}px)` });
    }
    frames.push({ offset: 1, transform: 'translateY(0px)' });
    return { keyframes: frames, duration: this.cursor };
  }
}

function animateElement(
  element: Element,
  keyframes: Keyframe[],
  duration: number,
  speed: number,
  keep = false,
): Animation {
  const animation = element.animate(keyframes, {
    duration: Math.max(1, duration),
    fill: 'forwards',
  });
  animation.playbackRate = speed;
  if (!keep) void animation.finished.catch(() => undefined);
  return animation;
}

/** Onde estao os dois Pokemon, sem contar animacoes em andamento. */
function measure(refs: StageRefs): Frame {
  const locate = (element: HTMLImageElement | null, fallback: { x: number; y: number; w: number }) => {
    if (!element || !element.offsetParent) {
      const width = refs.stage.clientWidth;
      const height = refs.stage.clientHeight;
      return { cx: width * fallback.x, cy: height * fallback.y, w: width * fallback.w };
    }
    // offsetLeft/Top ignoram transformacoes: e a posicao de repouso.
    const slot = element.offsetParent as HTMLElement;
    return {
      cx: slot.offsetLeft + element.offsetLeft + element.offsetWidth / 2,
      cy: slot.offsetTop + element.offsetTop + element.offsetHeight / 2,
      w: element.offsetWidth,
    };
  };
  const player = locate(refs.player, { x: 0.28, y: 0.7, w: 0.36 });
  const foe = locate(refs.foe, { x: 0.74, y: 0.4, w: 0.29 });
  // O Showdown desenha o sprite de perto com 2x o tamanho (96px -> 192) e o
  // de longe com 1x: cada lado ganha a escala que casa com o nosso sprite.
  return {
    near: { cx: player.cx, cy: player.cy, k: player.w / 192 },
    far: { cx: foe.cx, cy: foe.cy, k: foe.w / 96 },
  };
}

// --- Entrada -------------------------------------------------------------------

let tablesPromise: Promise<Tables> | null = null;

/** As tabelas pesam: so sao baixadas quando a primeira batalha comeca. */
export function loadTables(): Promise<Tables> {
  tablesPromise ??= Promise.all([
    import('../../../vendor/showdown/moves.js'),
    import('../../../vendor/showdown/other.js'),
  ]).then(([moves, other]) => ({
    moves: moves.BattleMoveAnims as AnimTable,
    other: other.BattleOtherAnims as AnimTable,
    status: other.BattleStatusAnims as AnimTable,
    effects: other.BattleEffects as Record<string, SpriteData>,
  }));
  return tablesPromise;
}

/** O veneno grave usa a mesma animacao do veneno comum, como no Showdown. */
const STATUS_ALIASES: Record<string, string> = { tox: 'psn' };

/** Golpes que somem com o Pokemon no turno de preparo. */
const HIDING_MOVES = new Set(['fly', 'bounce', 'dig', 'dive', 'phantomforce', 'shadowforce', 'skydrop']);

/** Animacoes deixadas no lugar por Fly e companhia, ate o golpe sair. */
const heldPoses = new Map<Side, Animation[]>();

function releasePose(side: Side): void {
  for (const animation of heldPoses.get(side) ?? []) animation.cancel();
  heldPoses.delete(side);
}

export type SceneAnim =
  | { kind: 'move'; move: string; side: Side; target: Side | null; miss?: boolean }
  | { kind: 'prepare'; move: string; side: Side; target: Side | null }
  | { kind: 'status'; anim: string; side: Side };

/**
 * Toca uma animacao do Showdown. Devolve false quando nao ha animacao para
 * aquilo (ou deu erro), para a tela cair na animacao propria do jogo.
 */
export async function playSceneAnim(refs: StageRefs, request: SceneAnim, speed: number): Promise<boolean> {
  const tables = await loadTables();
  const own = request.side;
  const other: Side = own === 'player' ? 'foe' : 'player';

  let entry: AnimData | undefined;
  let method: 'anim' | 'prepareAnim' = 'anim';
  if (request.kind === 'status') entry = tables.status[STATUS_ALIASES[request.anim] ?? request.anim];
  else if (request.kind === 'prepare') {
    entry = tables.moves[request.move];
    method = 'prepareAnim';
    if (!entry?.prepareAnim) return false;
  } else entry = tables.moves[request.move] ?? tables.moves.tackle;
  if (!entry) return false;

  releasePose(own);
  const scene = new Scene(refs, tables);
  const attacker = new SceneSprite(scene, own, own === 'player' ? refs.player : refs.foe);
  const participants = [attacker];
  if (request.kind !== 'status') {
    const targetSide = request.target ?? other;
    const missed = request.kind === 'move' && Boolean(request.miss);
    if (targetSide === own) {
      participants.push(attacker);
    } else {
      // Quem esta no ar (Fly) ou debaixo da terra (Dig) so volta se for
      // atingido; um golpe que erra mira o lugar vazio ao lado.
      if (!missed) releasePose(targetSide);
      participants.push(
        new SceneSprite(
          scene,
          targetSide,
          targetSide === 'player' ? refs.player : refs.foe,
          missed,
        ),
      );
    }
  }

  try {
    entry[method]!(scene, participants);
  } catch (error) {
    if (import.meta.env.DEV) console.warn('animacao do Showdown falhou', request, error);
    return false;
  }

  const hides = request.kind === 'prepare' && HIDING_MOVES.has(request.move);
  const unique = [...new Set(participants)];
  const kept = await scene.play(unique, speed, hides);
  if (hides && kept.length) heldPoses.set(own, kept);
  return true;
}

/** Solta as poses presas (fim da batalha, troca ou nocaute). */
export function resetScene(side?: Side): void {
  if (side) {
    releasePose(side);
    return;
  }
  releasePose('player');
  releasePose('foe');
}
