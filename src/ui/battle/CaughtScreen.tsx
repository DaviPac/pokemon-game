/**
 * Tela do Pokemon capturado.
 *
 * A captura e o momento que o jogo inteiro persegue; cortar direto de volta
 * para o mapa desperdicava esse momento. Aqui ela ganha tempo proprio: o tema
 * da captura toca, o Pokemon aparece inteiro e a tela diz o que aconteceu com
 * ele -- entrou na equipe, foi para a caixa, virou registro novo na Pokedex.
 */
import { useEffect, useState } from 'react';
import type { PokemonType } from '../../game/data/types.js';
import {
  displayName,
  maxHp,
  speciesOf,
  type Pokemon,
  type PokemonContext,
} from '../../game/pokemon/pokemon.js';
import { battleSprite } from '../../game/pokemon/sprites.js';
import { audio } from '../../game/audio/index.js';
import { TYPE_COLORS, TYPE_NAMES_PT } from '../theme/types.js';

interface Props {
  ctx: PokemonContext;
  pokemon: Pokemon;
  /** Para onde ele foi: a equipe estava cheia ou nao. */
  where: 'party' | 'box';
  /** Primeira vez desta especie na Pokedex. */
  isNew: boolean;
  onClose: () => void;
}

export function CaughtScreen({ ctx, pokemon, where, isNew, onClose }: Props) {
  const species = speciesOf(ctx, pokemon);
  const name = displayName(ctx, pokemon);
  // A entrada e em duas partes: a bola abre, e so entao o Pokemon aparece.
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setRevealed(true), 420);
    const cry = setTimeout(() => audio.cry(pokemon.species), 700);
    return () => {
      clearTimeout(timer);
      clearTimeout(cry);
    };
  }, [pokemon.species]);

  return (
    <div className="caught-screen">
      <div className="caught-head">
        <p className="caught-kicker">Gotcha!</p>
        <h2 className="caught-title">{name} foi capturado!</h2>
      </div>

      <div className={revealed ? 'caught-stage caught-stage-open' : 'caught-stage'}>
        <span className="caught-ball" />
        <img
          className="caught-sprite"
          src={battleSprite(pokemon.species, 'front', pokemon.shiny)}
          alt={name}
          draggable={false}
        />
      </div>

      <div className="caught-card">
        <div className="caught-row">
          <span className="caught-dex">Nº {String(pokemon.species).padStart(3, '0')}</span>
          <span className="caught-level">
            Nv {pokemon.level} · {maxHp(ctx, pokemon)} PS
            {pokemon.gender !== 'N' && (
              <span className={pokemon.gender === 'M' ? 'gender-m' : 'gender-f'}>
                {' '}
                {pokemon.gender === 'M' ? '♂' : '♀'}
              </span>
            )}
          </span>
        </div>

        <div className="caught-types">
          {species.t.map((type) => (
            <span
              key={type}
              className="type-chip"
              style={{ background: TYPE_COLORS[type as PokemonType] }}
            >
              {TYPE_NAMES_PT[type as PokemonType]}
            </span>
          ))}
          {pokemon.shiny && <span className="type-chip caught-shiny">✦ Shiny</span>}
        </div>

        <p className="caught-where">
          {where === 'party'
            ? `${name} entrou na sua equipe.`
            : `Sua equipe estava cheia: ${name} foi para a caixa.`}
        </p>
        {isNew && <p className="caught-dexnew">Novo registro na Pokedex!</p>}
      </div>

      <button type="button" className="primary-button caught-continue" onClick={onClose}>
        Continuar
      </button>
    </div>
  );
}
