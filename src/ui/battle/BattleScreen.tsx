/**
 * Tela de batalha. O motor entrega um roteiro de eventos; aqui eles viram
 * animacao, som visual e texto, um de cada vez.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MoveCategory, PokemonType, StatusName } from '../../game/data/types.js';
import { BATTLE_ITEMS, type Battle } from '../../game/battle/engine.js';
import { BALLS } from '../../game/battle/capture.js';
import type { BattleEvent, BattleOutcome, Side } from '../../game/battle/types.js';
import {
  displayName,
  expProgress,
  isFainted,
  maxHp,
  type Pokemon,
  type PokemonContext,
} from '../../game/pokemon/pokemon.js';
import { battleSprite } from '../../game/pokemon/sprites.js';
import { audio } from '../../game/audio/index.js';
import { haptic, useSettings } from '../../state/settings.js';
import { CATEGORY_LABELS, TYPE_COLORS, TYPE_NAMES_PT } from '../theme/types.js';
import {
  playBall,
  playBattleIntro,
  playFieldIntro,
  pushCamera,
  playEntrance,
  playFaint,
  playHit,
  playMove,
  wait,
} from './animations.js';
import { HPBar } from './HPBar.js';

type Menu = 'main' | 'moves' | 'bag' | 'party' | 'none';

interface Props {
  battle: Battle;
  ctx: PokemonContext;
  bag: Record<string, number>;
  onUseItem: (item: string) => void;
  onFinish: (outcome: BattleOutcome, caught: Pokemon | null) => void;
  environment: { isCave: boolean; isWater: boolean; isNight: boolean };
  playerLevel: number;
}

interface SideView {
  species: number;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  status: StatusName | null;
  shiny: boolean;
  gender: 'M' | 'F' | 'N';
  exp?: number;
}

export function BattleScreen({
  battle,
  ctx,
  bag,
  onUseItem,
  onFinish,
  environment,
  playerLevel,
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const playerSpriteRef = useRef<HTMLImageElement>(null);
  const foeSpriteRef = useRef<HTMLImageElement>(null);
  const busyRef = useRef(false);
  /** Tema de vitoria ou de captura em andamento, e o atalho para pula-lo. */
  const cueRef = useRef<Promise<void> | null>(null);
  const skipRef = useRef<(() => void) | null>(null);

  const fast = useSettings((s) => s.fastAnimations);
  const animationsOn = useSettings((s) => s.battleAnimations);
  const animOptions = { speed: fast ? 2.2 : 1, enabled: animationsOn };

  const [message, setMessage] = useState('');
  const [menu, setMenu] = useState<Menu>('none');
  const [player, setPlayer] = useState<SideView>(() => viewOf(ctx, battle.active('player'), true));
  const [foe, setFoe] = useState<SideView>(() => viewOf(ctx, battle.active('foe'), false));
  const [finished, setFinished] = useState<BattleOutcome | null>(null);
  /** Tela parada no fim da batalha, esperando o tema terminar. */
  const [waitingMusic, setWaitingMusic] = useState(false);
  const [activeSlot, setActiveSlot] = useState(battle.player.activeIndex);
  // Quem ja caiu na animacao; os pontinhos da equipe seguem isto, nao o motor.
  const [faintedUids, setFaintedUids] = useState<string[]>([]);

  const spriteRef = (side: Side) => (side === 'player' ? playerSpriteRef : foeSpriteRef);

  /**
   * O HUD segue os eventos, nao o motor: quando o turno chega aqui ele ja foi
   * resolvido inteiro, entao ler o motor faria a barra de HP cair antes mesmo
   * de o golpe aparecer na tela.
   */
  const patch = useCallback((side: Side, changes: Partial<SideView>) => {
    const apply = (view: SideView) => ({ ...view, ...changes });
    if (side === 'player') setPlayer(apply);
    else setFoe(apply);
  }, []);

  /**
   * Segura a tela ate o tema terminar -- ou ate o jogador tocar, que nem todo
   * mundo quer ouvir a musica inteira depois de cada vitoria.
   */
  const holdForMusic = useCallback(async (cue: Promise<void> | null) => {
    if (!cue) return;
    setWaitingMusic(true);
    await Promise.race([
      cue,
      new Promise<void>((resolve) => {
        skipRef.current = resolve;
      }),
    ]);
    skipRef.current = null;
    setWaitingMusic(false);
  }, []);

  const play = useCallback(
    async (events: BattleEvent[]) => {
      busyRef.current = true;
      setMenu('none');
      // O tema de vitoria comeca quando o ultimo adversario cai, nao no fim do
      // turno: assim a barra de EXP sobe junto com a musica, como nos jogos.
      const winning = events.some((e) => e.t === 'end' && e.outcome === 'win');

      for (const event of events) {
        switch (event.t) {
          case 'text':
            setMessage(event.text);
            await wait((event.text.length * 16 + 420) / animOptions.speed);
            break;

          case 'sendOut': {
            const pokemon = battle.team(event.side).party[event.index];
            if (event.side === 'player') setActiveSlot(event.index);
            const view = viewOf(ctx, pokemon, event.side === 'player');
            // Identidade vem do Pokemon; HP e status, do instante do evento.
            if (event.side === 'player') {
              setPlayer({ ...view, hp: event.hp, maxHp: event.maxHp, status: event.status });
            } else {
              setFoe({ ...view, hp: event.hp, maxHp: event.maxHp, status: event.status });
            }
            await wait(60);
            if (event.entrance !== 'wild') audio.sfx('ball');
            await playEntrance(
              spriteRef(event.side).current,
              stageRef.current,
              event.entrance,
              animOptions,
            );
            // O grito sai quando o Pokemon aparece, como nos jogos.
            audio.cry(pokemon.species);
            await wait(180 / animOptions.speed);
            break;
          }

          case 'useMove': {
            const move = ctx.moves[event.move];
            if (move) {
              pushCamera(worldRef.current, animOptions);
              await playMove(
                spriteRef(event.side).current,
                spriteRef(event.side === 'player' ? 'foe' : 'player').current,
                stageRef.current,
                { type: move.t as PokemonType, category: move.cat as MoveCategory },
                animOptions,
              );
            }
            break;
          }

          case 'damage': {
            await playHit(
              spriteRef(event.side).current,
              stageRef.current,
              event.effectiveness === 'super'
                ? 'super'
                : event.effectiveness === 'resisted'
                  ? 'resisted'
                  : 'normal',
              animOptions,
            );
            if (event.side === 'player') haptic(event.effectiveness === 'super' ? [22, 30, 22] : 14);
            audio.sfx(
              event.effectiveness === 'super'
                ? 'super'
                : event.effectiveness === 'resisted'
                  ? 'weak'
                  : 'hit',
            );
            patch(event.side, { hp: event.hp, maxHp: event.maxHp });
            await wait(200 / animOptions.speed);
            break;
          }

          case 'heal':
            patch(event.side, { hp: event.hp, maxHp: event.maxHp });
            await wait(200 / animOptions.speed);
            break;

          case 'status':
            patch(event.side, { status: event.status });
            await wait(200 / animOptions.speed);
            break;

          case 'boost':
            await wait(160 / animOptions.speed);
            break;

          case 'miss':
            await wait(200 / animOptions.speed);
            break;

          case 'faint': {
            const fallen = battle.active(event.side);
            audio.sfx('faint');
            await playFaint(spriteRef(event.side).current, animOptions);
            patch(event.side, { hp: 0 });
            setFaintedUids((current) => [...current, fallen.uid]);
            if (winning && event.side === 'foe' && !cueRef.current) {
              cueRef.current = audio.playCue(
                battle.config.kind === 'trainer' ? 'mus_victory_trainer' : 'mus_victory_wild',
                { resume: false },
              );
            }
            await wait(240 / animOptions.speed);
            break;
          }

          case 'ball':
            haptic([14, 60, 14]);
            audio.sfx('ball');
            await playBall(
              stageRef.current,
              foeSpriteRef.current,
              event.shakes,
              event.caught,
              animOptions,
            );
            break;

          case 'caught':
            haptic([30, 60, 30, 60, 60]);
            // O tema da captura segue tocando na tela do Pokemon capturado; por
            // isso ele nao devolve a musica de batalha ao terminar.
            cueRef.current = audio.playCue('mus_caught', { resume: false });
            await wait(900 / animOptions.speed);
            break;

          case 'exp':
            if (event.leveledUp) audio.playJingle('mus_level_up');
            // So a barra do Pokemon que esta em campo muda na tela.
            if (battle.active('player').uid === event.uid) {
              patch('player', {
                exp: event.progress,
                level: event.level,
                hp: event.hp,
                maxHp: event.maxHp,
              });
            }
            await wait(260 / animOptions.speed);
            break;

          case 'prompt':
            setMenu('party');
            busyRef.current = false;
            return;

          case 'end':
            setFinished(event.outcome);
            busyRef.current = false;
            await wait(600 / animOptions.speed);
            // Vitoria: a tela so sai depois do tema. Captura: quem espera o
            // tema e a tela do Pokemon capturado, que abre em seguida.
            if (event.outcome === 'win') await holdForMusic(cueRef.current);
            onFinish(event.outcome, battle.caught);
            return;

          default:
            break;
        }
      }

      busyRef.current = false;
      if (!battle.outcome) setMenu('main');
    },
    [animOptions, battle, ctx, holdForMusic, onFinish, patch],
  );

  // Abertura: a cortina varre a tela antes do primeiro texto.
  useEffect(() => {
    void (async () => {
      void audio.playMusic(battleSong(battle.config.kind, battle.config.foeName));
      // A cortina varre a tela enquanto a camera se aproxima do campo.
      void playFieldIntro(worldRef.current, animOptions);
      await playBattleIntro(stageRef.current, animOptions);
      await play(battle.start());
    })();
    // Roda uma vez por batalha.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = (run: () => BattleEvent[]) => {
    if (busyRef.current || finished) return;
    void play(run());
  };

  const active = battle.active('player');
  const foeActive = battle.active('foe');
  const terrain = environment.isWater ? 'water' : environment.isCave ? 'cave' : 'grass';

  return (
    <div className="battle">
      <div className="battle-stage" ref={stageRef}>
        {/*
          O campo e montado em tres dimensoes de verdade, como nos jogos de
          NDS: o chao e um plano deitado que foge para o horizonte e as duas
          plataformas sao circulos no mesmo plano -- e a perspectiva que os
          transforma em elipses. Os Pokemon ficam em pe por cima, como os
          cartazes que a geracao 5 usava sobre o cenario 3D.
        */}
        <div className={`field field-${terrain}`}>
          <div className="field-world" ref={worldRef}>
            <div className="field-sky" />
            <div className="field-scenery" />
            <div className="field-haze" />
            <div className="field-floor">
              {/* Filhas do chao: ficam deitadas no mesmo plano, sem disputa. */}
              <div className="field-platform field-platform-foe" />
              <div className="field-platform field-platform-player" />
            </div>
          </div>
        </div>

        <div className="battle-slot battle-slot-foe">
          <img
            ref={foeSpriteRef}
            className="battle-sprite battle-sprite-foe"
            src={battleSprite(foe.species, 'front', foe.shiny)}
            alt={foe.name}
            draggable={false}
          />
          <span className="battle-shadow" />
        </div>

        <div className="battle-slot battle-slot-player">
          <img
            ref={playerSpriteRef}
            className="battle-sprite battle-sprite-player"
            src={battleSprite(player.species, 'back', player.shiny)}
            alt={player.name}
            draggable={false}
          />
          <span className="battle-shadow" />
        </div>

        <div className="battle-hud battle-hud-foe">
          <HPBar
            name={foe.name}
            level={foe.level}
            hp={foe.hp}
            maxHp={foe.maxHp}
            status={foe.status}
            gender={foe.gender}
            shiny={foe.shiny}
            align="left"
          />
        </div>
        <div className="battle-hud battle-hud-player">
          <HPBar
            name={player.name}
            level={player.level}
            hp={player.hp}
            maxHp={player.maxHp}
            status={player.status}
            gender={player.gender}
            shiny={player.shiny}
            exp={player.exp}
            align="right"
          />
        </div>

        <div className="battle-party-dots">
          {battle.player.party.map((p, i) => (
            <span
              key={p.uid}
              className={`party-dot ${faintedUids.includes(p.uid) ? 'party-dot-out' : ''} ${i === activeSlot ? 'party-dot-active' : ''}`}
            />
          ))}
        </div>
      </div>

      <div className="battle-panel">
        <p className="battle-message">{message}</p>

        {waitingMusic && (
          <button
            type="button"
            className="battle-continue"
            onClick={() => skipRef.current?.()}
          >
            Toque para continuar
          </button>
        )}

        {menu === 'main' && (
          <div className="battle-actions">
            <button
              type="button"
              className="battle-action action-fight"
              onClick={() => {
                audio.sfx('select');
                setMenu('moves');
              }}
            >
              Lutar
            </button>
            <button
              type="button"
              className="battle-action action-bag"
              onClick={() => {
                audio.sfx('select');
                setMenu('bag');
              }}
            >
              Mochila
            </button>
            <button
              type="button"
              className="battle-action action-party"
              onClick={() => {
                audio.sfx('select');
                setMenu('party');
              }}
            >
              Pokemon
            </button>
            <button
              type="button"
              className="battle-action action-run"
              onClick={() => act(() => battle.takeTurn({ kind: 'run' }))}
            >
              Fugir
            </button>
          </div>
        )}

        {menu === 'moves' && (
          <div className="move-grid">
            {active.moves.map((slot, index) => {
              const move = ctx.moves[slot.id];
              if (!move) return null;
              const type = move.t as PokemonType;
              return (
                <button
                  key={slot.id}
                  type="button"
                  className="move-button"
                  style={{ borderColor: TYPE_COLORS[type] }}
                  disabled={slot.pp <= 0}
                  onClick={() => act(() => battle.takeTurn({ kind: 'move', index }))}
                >
                  <span className="move-name">{move.n}</span>
                  <span className="move-meta">
                    <span className="type-chip" style={{ background: TYPE_COLORS[type] }}>
                      {TYPE_NAMES_PT[type]}
                    </span>
                    <span className="move-cat">{CATEGORY_LABELS[move.cat]}</span>
                    <span className="move-pp">
                      {slot.pp}/{slot.maxPp}
                    </span>
                  </span>
                </button>
              );
            })}
            <button type="button" className="back-button" onClick={() => setMenu('main')}>
              Voltar
            </button>
          </div>
        )}

        {menu === 'bag' && (
          <div className="bag-list">
            {Object.entries(bag)
              .filter(([, count]) => count > 0)
              .map(([item, count]) => {
                const ball = BALLS[item];
                const usable = BATTLE_ITEMS[item];
                if (!ball && !usable) return null;
                return (
                  <button
                    key={item}
                    type="button"
                    className="bag-item"
                    onClick={() => {
                      onUseItem(item);
                      if (ball) {
                        act(() =>
                          battle.throwBall(item, {
                            playerLevel,
                            isCave: environment.isCave,
                            isWater: environment.isWater,
                            isNight: environment.isNight,
                          }),
                        );
                      } else {
                        act(() => battle.takeTurn({ kind: 'item', item }));
                      }
                    }}
                  >
                    <span className="bag-item-name">{ball?.name ?? usable?.name ?? item}</span>
                    <span className="bag-item-count">×{count}</span>
                  </button>
                );
              })}
            <button type="button" className="back-button" onClick={() => setMenu('main')}>
              Voltar
            </button>
          </div>
        )}

        {menu === 'party' && (
          <div className="party-list">
            {battle.player.party.map((p, index) => {
              const hpMax = maxHp(ctx, p);
              const disabled = isFainted(p) || index === battle.player.activeIndex;
              return (
                <button
                  key={p.uid}
                  type="button"
                  className="party-row"
                  disabled={disabled}
                  onClick={() => {
                    if (battle.awaitingSwitch) act(() => battle.switchTo(index));
                    else act(() => battle.takeTurn({ kind: 'switch', index }));
                  }}
                >
                  <img
                    className="party-icon"
                    src={battleSprite(p.species, 'front', p.shiny)}
                    alt=""
                    draggable={false}
                  />
                  <span className="party-info">
                    <span className="party-name">{displayName(ctx, p)}</span>
                    <span className="party-hp">
                      Nv{p.level} · {Math.max(0, p.hp)}/{hpMax}
                    </span>
                  </span>
                </button>
              );
            })}
            {!battle.awaitingSwitch && (
              <button type="button" className="back-button" onClick={() => setMenu('main')}>
                Voltar
              </button>
            )}
          </div>
        )}
      </div>

      <span className="sr-only">
        {foeActive.species} {active.species}
      </span>
    </div>
  );
}

/** Lider de ginasio tem tema proprio; o resto segue selvagem ou treinador. */
function battleSong(kind: 'wild' | 'trainer', foeName?: string): string {
  if (kind === 'wild') return 'mus_vs_wild';
  return /Lider|Elite|Campeao/i.test(foeName ?? '') ? 'mus_vs_gym_leader' : 'mus_vs_trainer';
}

function viewOf(ctx: PokemonContext, pokemon: Pokemon, isPlayer: boolean): SideView {
  return {
    species: pokemon.species,
    name: displayName(ctx, pokemon),
    level: pokemon.level,
    hp: pokemon.hp,
    maxHp: maxHp(ctx, pokemon),
    status: pokemon.status,
    shiny: pokemon.shiny,
    gender: pokemon.gender,
    exp: isPlayer ? expProgress(ctx, pokemon) : undefined,
  };
}
