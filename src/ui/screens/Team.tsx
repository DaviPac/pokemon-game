/**
 * Equipe e caixa: ver, reordenar e trocar os Pokemon que andam com voce.
 */
import { useState } from 'react';
import type { PokemonType } from '../../game/data/types.js';
import {
  displayName,
  expProgress,
  maxHp,
  speciesOf,
  statValue,
  type Pokemon,
  type PokemonContext,
} from '../../game/pokemon/pokemon.js';
import { artwork, iconSprite } from '../../game/pokemon/sprites.js';
import { PARTY_LIMIT, type SaveData } from '../../game/save/schema.js';
import { useGame } from '../../state/game.js';
import { haptic } from '../../state/settings.js';
import { Sheet } from '../shell/Sheet.js';
import { STATUS_COLORS, STATUS_LABELS, TYPE_COLORS, TYPE_NAMES_PT } from '../theme/types.js';

export function Team({ ctx, save }: { ctx: PokemonContext; save: SaveData }) {
  const [detail, setDetail] = useState<Pokemon | null>(null);
  const [tab, setTab] = useState<'party' | 'box'>('party');
  const update = useGame((s) => s.update);

  const list = tab === 'party' ? save.party : save.box;

  const moveToParty = (pokemon: Pokemon) => {
    if (save.party.length >= PARTY_LIMIT) return;
    haptic(12);
    update((s) => {
      s.box = s.box.filter((p) => p.uid !== pokemon.uid);
      s.party = [...s.party, pokemon];
    });
    setDetail(null);
  };

  const moveToBox = (pokemon: Pokemon) => {
    if (save.party.length <= 1) return;
    haptic(12);
    update((s) => {
      s.party = s.party.filter((p) => p.uid !== pokemon.uid);
      s.box = [...s.box, pokemon];
    });
    setDetail(null);
  };

  return (
    <div className="screen">
      <header className="screen-head">
        <h1 className="screen-title">Equipe</h1>
        <p className="screen-sub">
          {save.party.length}/{PARTY_LIMIT} na equipe · {save.box.length} na caixa
        </p>
      </header>

      <div className="chip-row">
        <button
          type="button"
          className={tab === 'party' ? 'chip chip-active' : 'chip'}
          onClick={() => setTab('party')}
        >
          Equipe
        </button>
        <button
          type="button"
          className={tab === 'box' ? 'chip chip-active' : 'chip'}
          onClick={() => setTab('box')}
        >
          Caixa
        </button>
      </div>

      {list.length === 0 && <p className="paragraph">Nada por aqui ainda.</p>}

      <div className="mon-list">
        {list.map((pokemon) => {
          const data = speciesOf(ctx, pokemon);
          const hpMax = maxHp(ctx, pokemon);
          const ratio = Math.max(0, pokemon.hp / hpMax);
          return (
            <button
              key={pokemon.uid}
              type="button"
              className="mon-card"
              onClick={() => setDetail(pokemon)}
            >
              <img
                className="mon-icon"
                src={iconSprite(pokemon.species, pokemon.shiny)}
                alt={data.n}
                loading="lazy"
                draggable={false}
              />
              <div className="mon-body">
                <div className="mon-top">
                  <span className="mon-name">
                    {displayName(ctx, pokemon)}
                    {pokemon.shiny && <span className="shiny-star">✦</span>}
                  </span>
                  <span className="mon-level">Nv{pokemon.level}</span>
                </div>
                <div className="hp-track">
                  <div
                    className="hp-fill"
                    style={{
                      width: `${ratio * 100}%`,
                      background: ratio > 0.5 ? '#4cd964' : ratio > 0.2 ? '#ffcb3d' : '#ff453a',
                    }}
                  />
                </div>
                <div className="mon-meta">
                  <span>
                    {Math.max(0, pokemon.hp)}/{hpMax}
                  </span>
                  {pokemon.status && (
                    <span
                      className="status-chip"
                      style={{ background: STATUS_COLORS[pokemon.status] }}
                    >
                      {STATUS_LABELS[pokemon.status]}
                    </span>
                  )}
                  {data.t.map((t) => (
                    <span
                      key={t}
                      className="type-chip"
                      style={{ background: TYPE_COLORS[t as PokemonType] }}
                    >
                      {TYPE_NAMES_PT[t as PokemonType]}
                    </span>
                  ))}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {detail && (
        <MonDetail
          ctx={ctx}
          pokemon={detail}
          inParty={save.party.some((p) => p.uid === detail.uid)}
          canAddToParty={save.party.length < PARTY_LIMIT}
          canRemove={save.party.length > 1}
          onToParty={() => moveToParty(detail)}
          onToBox={() => moveToBox(detail)}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

function MonDetail({
  ctx,
  pokemon,
  inParty,
  canAddToParty,
  canRemove,
  onToParty,
  onToBox,
  onClose,
}: {
  ctx: PokemonContext;
  pokemon: Pokemon;
  inParty: boolean;
  canAddToParty: boolean;
  canRemove: boolean;
  onToParty: () => void;
  onToBox: () => void;
  onClose: () => void;
}) {
  const data = speciesOf(ctx, pokemon);
  const stats: [string, number][] = [
    ['HP', maxHp(ctx, pokemon)],
    ['Ataque', statValue(ctx, pokemon, 'atk')],
    ['Defesa', statValue(ctx, pokemon, 'def')],
    ['At. Esp.', statValue(ctx, pokemon, 'spa')],
    ['Def. Esp.', statValue(ctx, pokemon, 'spd')],
    ['Velocidade', statValue(ctx, pokemon, 'spe')],
  ];

  return (
    <Sheet title={displayName(ctx, pokemon)} onClose={onClose}>
      <div className="dex-hero">
        <img
          className="dex-art"
          src={artwork(pokemon.species, pokemon.shiny)}
          alt={data.n}
          draggable={false}
        />
        <div className="dex-hero-info">
          <span className="dex-hero-number">
            #{String(pokemon.species).padStart(3, '0')} · Nv{pokemon.level}
          </span>
          <div className="chip-row">
            {data.t.map((t) => (
              <span key={t} className="type-chip" style={{ background: TYPE_COLORS[t as PokemonType] }}>
                {TYPE_NAMES_PT[t as PokemonType]}
              </span>
            ))}
          </div>
          <span className="dex-hero-meta">
            {pokemon.gender === 'M' ? 'Macho' : pokemon.gender === 'F' ? 'Femea' : 'Sem genero'} ·{' '}
            {pokemon.ability}
          </span>
          <span className="dex-hero-meta">Natureza {pokemon.nature}</span>
          <div className="exp-track">
            <div className="exp-fill" style={{ width: `${expProgress(ctx, pokemon) * 100}%` }} />
          </div>
        </div>
      </div>

      <h3 className="section-title">Atributos</h3>
      <div className="stat-list">
        {stats.map(([label, value]) => (
          <div key={label} className="stat-row">
            <span className="stat-label">{label}</span>
            <div className="stat-track">
              <div className="stat-fill" style={{ width: `${Math.min(100, (value / 250) * 100)}%` }} />
            </div>
            <span className="stat-value">{value}</span>
          </div>
        ))}
      </div>

      <h3 className="section-title">Golpes</h3>
      <div className="move-list">
        {pokemon.moves.map((slot) => {
          const move = ctx.moves[slot.id];
          if (!move) return null;
          return (
            <div key={slot.id} className="move-row">
              <span className="move-name">{move.n}</span>
              <span className="move-meta">
                <span className="type-chip" style={{ background: TYPE_COLORS[move.t as PokemonType] }}>
                  {TYPE_NAMES_PT[move.t as PokemonType]}
                </span>
                {move.bp > 0 && <span>{move.bp} de poder</span>}
                <span>
                  {slot.pp}/{slot.maxPp} PP
                </span>
              </span>
            </div>
          );
        })}
      </div>

      <div className="sheet-actions">
        {inParty ? (
          <button type="button" className="primary-button" disabled={!canRemove} onClick={onToBox}>
            Mandar para a caixa
          </button>
        ) : (
          <button
            type="button"
            className="primary-button"
            disabled={!canAddToParty}
            onClick={onToParty}
          >
            Levar na equipe
          </button>
        )}
      </div>
    </Sheet>
  );
}
