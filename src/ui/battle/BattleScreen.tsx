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
import { haptic, useSettings } from '../../state/settings.js';
import { CATEGORY_LABELS, TYPE_COLORS, TYPE_NAMES_PT } from '../theme/types.js';
import { playBall, playFaint, playHit, playMove, playSendOut, wait } from './animations.js';
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
  const playerSpriteRef = useRef<HTMLImageElement>(null);
  const foeSpriteRef = useRef<HTMLImageElement>(null);
  const busyRef = useRef(false);

  const fast = useSettings((s) => s.fastAnimations);
  const animationsOn = useSettings((s) => s.battleAnimations);
  const animOptions = { speed: fast ? 2.2 : 1, enabled: animationsOn };

  const [message, setMessage] = useState('');
  const [menu, setMenu] = useState<Menu>('none');
  const [player, setPlayer] = useState<SideView>(() => viewOf(ctx, battle.active('player'), true));
  const [foe, setFoe] = useState<SideView>(() => viewOf(ctx, battle.active('foe'), false));
  const [finished, setFinished] = useState<BattleOutcome | null>(null);

  const refresh = useCallback(() => {
    setPlayer(viewOf(ctx, battle.active('player'), true));
    setFoe(viewOf(ctx, battle.active('foe'), false));
  }, [battle, ctx]);

  const spriteRef = (side: Side) => (side === 'player' ? playerSpriteRef : foeSpriteRef);

  const play = useCallback(
    async (events: BattleEvent[]) => {
      busyRef.current = true;
      setMenu('none');

      for (const event of events) {
        switch (event.t) {
          case 'text':
            setMessage(event.text);
            await wait((event.text.length * 16 + 420) / animOptions.speed);
            break;

          case 'sendOut': {
            refresh();
            await wait(60);
            await playSendOut(spriteRef(event.side).current, animOptions);
            break;
          }

          case 'useMove': {
            const move = ctx.moves[event.move];
            if (move) {
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
            refresh();
            await wait(200 / animOptions.speed);
            break;
          }

          case 'heal':
          case 'status':
          case 'boost':
            refresh();
            await wait(200 / animOptions.speed);
            break;

          case 'miss':
            await wait(200 / animOptions.speed);
            break;

          case 'faint':
            await playFaint(spriteRef(event.side).current, animOptions);
            await wait(240 / animOptions.speed);
            break;

          case 'ball':
            haptic([14, 60, 14]);
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
            await wait(320 / animOptions.speed);
            break;

          case 'exp':
            refresh();
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
            onFinish(event.outcome, battle.caught);
            return;

          default:
            break;
        }
      }

      refresh();
      busyRef.current = false;
      if (!battle.outcome) setMenu('main');
    },
    [animOptions, battle, ctx, onFinish, refresh],
  );

  // Abertura
  useEffect(() => {
    void play(battle.start());
    // Roda uma vez por batalha.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = (run: () => BattleEvent[]) => {
    if (busyRef.current || finished) return;
    void play(run());
  };

  const active = battle.active('player');
  const foeActive = battle.active('foe');

  return (
    <div className="battle">
      <div className="battle-stage" ref={stageRef}>
        <div
          className={
            environment.isWater
              ? 'battle-bg battle-bg-water'
              : environment.isCave
                ? 'battle-bg battle-bg-cave'
                : 'battle-bg'
          }
        />

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
              className={`party-dot ${isFainted(p) ? 'party-dot-out' : ''} ${i === battle.player.activeIndex ? 'party-dot-active' : ''}`}
            />
          ))}
        </div>
      </div>

      <div className="battle-panel">
        <p className="battle-message">{message}</p>

        {menu === 'main' && (
          <div className="battle-actions">
            <button type="button" className="battle-action action-fight" onClick={() => setMenu('moves')}>
              Lutar
            </button>
            <button type="button" className="battle-action action-bag" onClick={() => setMenu('bag')}>
              Mochila
            </button>
            <button type="button" className="battle-action action-party" onClick={() => setMenu('party')}>
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
