/**
 * Animacoes de golpe. Ficam na camada DOM (Web Animations API) por cima dos
 * GIFs dos Pokemon: e mais leve no celular do que redesenhar tudo num canvas e
 * deixa os sprites animados originais continuarem rodando.
 *
 * A forma da animacao vem da categoria do golpe (fisico avanca e bate, especial
 * atira um projetil, status pulsa uma aura) e a cor vem do tipo.
 */
import type { MoveCategory, PokemonType } from '../../game/data/types.js';
import { TYPE_COLORS } from '../theme/types.js';

export interface AnimationOptions {
  /** Multiplicador de velocidade: 2 deixa tudo duas vezes mais rapido. */
  speed: number;
  enabled: boolean;
}

const reduceMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export async function playMove(
  attacker: HTMLElement | null,
  defender: HTMLElement | null,
  stage: HTMLElement | null,
  move: { type: PokemonType; category: MoveCategory },
  options: AnimationOptions,
): Promise<void> {
  if (!attacker || !defender || !options.enabled || reduceMotion()) {
    await wait(120 / options.speed);
    return;
  }

  const color = TYPE_COLORS[move.type] ?? '#ffffff';
  switch (move.category) {
    case 'Physical':
      await lunge(attacker, defender, options);
      break;
    case 'Special':
      await projectile(attacker, defender, stage, color, options);
      break;
    case 'Status':
      await aura(defender, color, options);
      break;
  }
}

/** Fisico: o atacante avanca ate o alvo, bate e volta. */
async function lunge(
  attacker: HTMLElement,
  defender: HTMLElement,
  options: AnimationOptions,
): Promise<void> {
  const from = attacker.getBoundingClientRect();
  const to = defender.getBoundingClientRect();
  const dx = (to.left + to.width / 2 - (from.left + from.width / 2)) * 0.45;
  const dy = (to.top + to.height / 2 - (from.top + from.height / 2)) * 0.45;

  await animate(
    attacker,
    [
      { transform: 'translate(0, 0)' },
      { transform: `translate(${dx}px, ${dy}px)`, offset: 0.45 },
      { transform: 'translate(0, 0)' },
    ],
    360 / options.speed,
  );
}

/** Especial: um projetil atravessa a tela e estoura no alvo. */
async function projectile(
  attacker: HTMLElement,
  defender: HTMLElement,
  stage: HTMLElement | null,
  color: string,
  options: AnimationOptions,
): Promise<void> {
  const host = stage ?? document.body;
  const hostRect = host.getBoundingClientRect();
  const from = attacker.getBoundingClientRect();
  const to = defender.getBoundingClientRect();

  const orb = document.createElement('span');
  orb.className = 'fx-orb';
  orb.style.background = `radial-gradient(circle, #fff 5%, ${color} 55%, transparent 72%)`;
  orb.style.left = `${from.left + from.width / 2 - hostRect.left}px`;
  orb.style.top = `${from.top + from.height / 2 - hostRect.top}px`;
  host.appendChild(orb);

  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);

  await animate(
    orb,
    [
      { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 0.2 },
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.25 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1.1)`, opacity: 1 },
    ],
    420 / options.speed,
  );
  orb.remove();
  await burst(defender, stage, color, options);
}

/** Estouro de particulas no ponto do impacto. */
async function burst(
  target: HTMLElement,
  stage: HTMLElement | null,
  color: string,
  options: AnimationOptions,
): Promise<void> {
  const host = stage ?? document.body;
  const hostRect = host.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  const cx = rect.left + rect.width / 2 - hostRect.left;
  const cy = rect.top + rect.height / 2 - hostRect.top;

  const particles: HTMLElement[] = [];
  const animations: Promise<unknown>[] = [];
  for (let i = 0; i < 10; i++) {
    const particle = document.createElement('span');
    particle.className = 'fx-particle';
    particle.style.background = color;
    particle.style.left = `${cx}px`;
    particle.style.top = `${cy}px`;
    host.appendChild(particle);
    particles.push(particle);

    const angle = (i / 10) * Math.PI * 2 + Math.random() * 0.4;
    const distance = 34 + Math.random() * 30;
    animations.push(
      animate(
        particle,
        [
          { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
          {
            transform: `translate(calc(-50% + ${Math.cos(angle) * distance}px), calc(-50% + ${Math.sin(angle) * distance}px)) scale(0.2)`,
            opacity: 0,
          },
        ],
        360 / options.speed,
      ),
    );
  }
  await Promise.all(animations);
  for (const particle of particles) particle.remove();
}

/** Status: aura pulsando em volta do alvo. */
async function aura(target: HTMLElement, color: string, options: AnimationOptions): Promise<void> {
  await animate(
    target,
    [
      { filter: 'drop-shadow(0 0 0 transparent)' },
      { filter: `drop-shadow(0 0 14px ${color}) brightness(1.25)`, offset: 0.5 },
      { filter: 'drop-shadow(0 0 0 transparent)' },
    ],
    520 / options.speed,
  );
}

/** Reacao de quem levou o golpe: piscada e tremida. */
export async function playHit(
  target: HTMLElement | null,
  stage: HTMLElement | null,
  intensity: 'normal' | 'super' | 'resisted',
  options: AnimationOptions,
): Promise<void> {
  if (!target || !options.enabled || reduceMotion()) {
    await wait(80 / options.speed);
    return;
  }

  const amplitude = intensity === 'super' ? 14 : intensity === 'resisted' ? 4 : 8;
  const flash = animate(
    target,
    [{ opacity: 1 }, { opacity: 0.25 }, { opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }],
    300 / options.speed,
  );
  const shakeTarget = animate(
    target,
    [
      { transform: 'translateX(0)' },
      { transform: `translateX(-${amplitude}px)` },
      { transform: `translateX(${amplitude}px)` },
      { transform: `translateX(-${amplitude / 2}px)` },
      { transform: 'translateX(0)' },
    ],
    280 / options.speed,
  );

  const shakes: Promise<unknown>[] = [flash, shakeTarget];
  if (intensity === 'super' && stage) {
    shakes.push(
      animate(
        stage,
        [
          { transform: 'translate(0, 0)' },
          { transform: 'translate(-5px, 3px)' },
          { transform: 'translate(5px, -3px)' },
          { transform: 'translate(0, 0)' },
        ],
        200 / options.speed,
      ),
    );
  }
  await Promise.all(shakes);
}

export async function playFaint(target: HTMLElement | null, options: AnimationOptions): Promise<void> {
  if (!target) return;
  if (!options.enabled || reduceMotion()) {
    target.style.opacity = '0';
    return;
  }
  await animate(
    target,
    [
      { transform: 'translateY(0)', opacity: 1 },
      { transform: 'translateY(46px)', opacity: 0 },
    ],
    440 / options.speed,
  );
  target.style.opacity = '0';
}

/** Como o Pokemon entra em campo. */
export type Entrance = 'player' | 'trainer' | 'wild';

/**
 * Abertura do combate: um clarao e uma cortina que varre a tela, no lugar do
 * corte seco que existia antes.
 */
export async function playBattleIntro(
  stage: HTMLElement | null,
  options: AnimationOptions,
): Promise<void> {
  if (!stage) return;
  if (!options.enabled || reduceMotion()) {
    await wait(120 / options.speed);
    return;
  }

  const curtain = document.createElement('span');
  curtain.className = 'fx-curtain';
  stage.appendChild(curtain);

  await animate(
    curtain,
    [
      { opacity: 1, clipPath: 'inset(0 0 0 0)' },
      { opacity: 1, clipPath: 'inset(0 0 0 0)', offset: 0.35 },
      { opacity: 1, clipPath: 'inset(50% 0 50% 0)' },
    ],
    620 / options.speed,
    'forwards',
  );
  curtain.remove();
}

/**
 * Entrada em campo. O Pokemon do jogador e o do treinador saem de uma bola
 * arremessada; o selvagem simplesmente aparece, vindo da borda.
 */
export async function playEntrance(
  target: HTMLElement | null,
  stage: HTMLElement | null,
  entrance: Entrance,
  options: AnimationOptions,
): Promise<void> {
  if (!target) return;
  // A sombra pertence ao mesmo slot e entra junto com o Pokemon.
  const shadow = target.parentElement?.querySelector<HTMLElement>('.battle-shadow') ?? null;
  const reveal = () => {
    target.style.opacity = '1';
    if (shadow) shadow.style.opacity = '1';
  };

  if (!options.enabled || reduceMotion()) {
    reveal();
    await wait(120 / options.speed);
    return;
  }

  if (entrance === 'wild') {
    reveal();
    await animate(
      target,
      [
        { transform: 'translateX(60px) scale(0.9)', opacity: 0 },
        { transform: 'translateX(-6px) scale(1.02)', opacity: 1, offset: 0.72 },
        { transform: 'translateX(0) scale(1)', opacity: 1 },
      ],
      460 / options.speed,
    );
    return;
  }

  // Bola sai da mao do jogador (canto de baixo) ou do treinador (canto de cima).
  target.style.opacity = '0';
  if (shadow) shadow.style.opacity = '0';
  const from = entrance === 'player' ? { x: 0.16, y: 0.86 } : { x: 0.12, y: 0.2 };
  await throwBall(stage, target, from, options, { openAtEnd: true });

  reveal();
  await animate(
    target,
    [
      { transform: 'scale(0.15)', opacity: 0.2 },
      { transform: 'scale(1.1)', opacity: 1, offset: 0.65 },
      { transform: 'scale(1)', opacity: 1 },
    ],
    360 / options.speed,
  );
}

/**
 * Arremesso da bola, com os balancos antes de prender (ou escapar).
 * Cada etapa usa `fill: forwards` para a bola continuar de onde parou.
 */
export async function playBall(
  stage: HTMLElement | null,
  target: HTMLElement | null,
  shakes: number,
  caught: boolean,
  options: AnimationOptions,
): Promise<void> {
  if (!stage || !target) return;
  const speed = options.enabled && !reduceMotion() ? options.speed : options.speed * 4;
  const fast = { ...options, speed };

  const { ball, restX, restY } = await throwBall(
    stage,
    target,
    { x: 0.2, y: 0.82 },
    fast,
    { openAtEnd: false },
  );

  // O Pokemon e "sugado" para dentro da bola.
  await animate(
    target,
    [
      { transform: 'scale(1)', opacity: 1 },
      { transform: 'scale(0.1)', opacity: 0 },
    ],
    280 / speed,
  );
  target.style.opacity = '0';

  const atRest = (rotation: number) =>
    `translate(calc(-50% + ${restX}px), calc(-50% + ${restY}px)) rotate(${rotation}deg)`;

  // A bola cai no chao.
  await animate(
    ball,
    [
      { transform: `translate(calc(-50% + ${restX}px), calc(-50% + ${restY - 48}px))` },
      { transform: atRest(0) },
    ],
    260 / speed,
    'forwards',
  );

  for (let i = 0; i < shakes; i++) {
    await animate(
      ball,
      [
        { transform: atRest(0) },
        { transform: atRest(-18) },
        { transform: atRest(18) },
        { transform: atRest(0) },
      ],
      420 / speed,
      'forwards',
    );
    await wait(140 / speed);
  }

  if (caught) {
    await animate(
      ball,
      [{ filter: 'brightness(1)' }, { filter: 'brightness(2.4)' }, { filter: 'brightness(1)' }],
      420 / speed,
      'forwards',
    );
    ball.remove();
    return;
  }

  // Escapou: a bola se abre e o Pokemon volta.
  await animate(
    ball,
    [
      { opacity: 1, transform: `${atRest(0)} scale(1)` },
      { opacity: 0, transform: `${atRest(0)} scale(1.6)` },
    ],
    240 / speed,
    'forwards',
  );
  ball.remove();

  target.style.opacity = '1';
  await animate(
    target,
    [
      { transform: 'scale(0.1)', opacity: 0 },
      { transform: 'scale(1)', opacity: 1 },
    ],
    300 / speed,
  );
}

/**
 * Desenha uma Pokebola, joga num arco ate o alvo e devolve onde ela parou.
 * `openAtEnd` faz a bola estourar num clarao em vez de ficar no chao.
 */
async function throwBall(
  stage: HTMLElement | null,
  target: HTMLElement,
  from: { x: number; y: number },
  options: AnimationOptions,
  { openAtEnd }: { openAtEnd: boolean },
): Promise<{ ball: HTMLElement; restX: number; restY: number }> {
  const host = stage ?? document.body;
  const hostRect = host.getBoundingClientRect();
  const rect = target.getBoundingClientRect();

  const originX = hostRect.width * from.x;
  const originY = hostRect.height * from.y;

  const ball = document.createElement('span');
  ball.className = 'fx-ball';
  ball.style.left = `${originX}px`;
  ball.style.top = `${originY}px`;
  host.appendChild(ball);

  const dx = rect.left + rect.width / 2 - hostRect.left - originX;
  const dy = rect.top + rect.height / 2 - hostRect.top - originY;

  await animate(
    ball,
    [
      { transform: 'translate(-50%, -50%) rotate(0deg)' },
      {
        transform: `translate(calc(-50% + ${dx * 0.5}px), calc(-50% + ${dy - 70}px)) rotate(360deg)`,
        offset: 0.5,
      },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(720deg)` },
    ],
    520 / options.speed,
    'forwards',
  );

  if (openAtEnd) {
    await animate(
      ball,
      [
        { opacity: 1, transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1)` },
        { opacity: 0, transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(2.4)` },
      ],
      240 / options.speed,
      'forwards',
    );
    ball.remove();
  }

  return { ball, restX: dx, restY: dy + 48 };
}

/**
 * `fill` importa: numa sequencia de varias etapas (o arremesso da bola), sem
 * `forwards` o elemento volta ao estado inicial entre uma etapa e outra -- o
 * que aparecia como a bola teleportando de baixo para cima a cada passo.
 */
function animate(
  element: HTMLElement,
  keyframes: Keyframe[],
  duration: number,
  fill: FillMode = 'none',
): Promise<unknown> {
  const animation = element.animate(keyframes, {
    duration: Math.max(16, duration),
    easing: 'ease-in-out',
    fill,
  });
  return animation.finished.catch(() => undefined);
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
