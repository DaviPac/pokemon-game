/**
 * Abertura: nome do treinador e escolha do inicial, no laboratorio do
 * Professor Oak — so que com cara de app, nao de caixa de texto.
 */
import { useState } from 'react';
import { RNG } from '../../game/core/rng.js';
import { createPokemon, type PokemonContext } from '../../game/pokemon/pokemon.js';
import { artwork } from '../../game/pokemon/sprites.js';
import { useGame } from '../../state/game.js';
import { haptic } from '../../state/settings.js';
import { TYPE_COLORS, TYPE_NAMES_PT } from '../theme/types.js';
import type { PokemonType } from '../../game/data/types.js';

const STARTERS = [
  { species: 1, blurb: 'Calmo e resistente. Facilita os dois primeiros ginasios.' },
  { species: 4, blurb: 'Rapido e agressivo. Comeco dificil, final poderoso.' },
  { species: 7, blurb: 'Equilibrado e seguro. A escolha mais tranquila.' },
];

export function NewGame({ ctx }: { ctx: PokemonContext }) {
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<number | null>(null);
  const startNewGame = useGame((s) => s.startNewGame);

  const confirm = async () => {
    if (chosen === null) return;
    const starter = createPokemon(ctx, new RNG(), { species: chosen, level: 5 });
    haptic([20, 40, 20]);
    await startNewGame(name.trim() || 'Treinador', starter);
  };

  return (
    <div className="newgame">
      <header className="newgame-head">
        <h1 className="newgame-title">PokeDeluge</h1>
        <p className="newgame-sub">Kanto inteira no bolso. Explore no seu ritmo.</p>
      </header>

      <section className="newgame-section">
        <label className="newgame-label" htmlFor="trainer-name">
          Como voce se chama?
        </label>
        <input
          id="trainer-name"
          className="newgame-input"
          value={name}
          maxLength={12}
          placeholder="Treinador"
          onChange={(e) => setName(e.target.value)}
        />
      </section>

      <section className="newgame-section">
        <h2 className="newgame-label">Escolha seu parceiro</h2>
        <div className="starter-grid">
          {STARTERS.map(({ species, blurb }) => {
            const data = ctx.species[String(species)];
            const type = data.t[0] as PokemonType;
            const active = chosen === species;
            return (
              <button
                key={species}
                type="button"
                className={active ? 'starter-card starter-card-active' : 'starter-card'}
                style={{ borderColor: active ? TYPE_COLORS[type] : undefined }}
                onClick={() => {
                  setChosen(species);
                  haptic(10);
                }}
              >
                <img className="starter-art" src={artwork(species)} alt={data.n} draggable={false} />
                <span className="starter-name">{data.n}</span>
                <span className="starter-types">
                  {data.t.map((t) => (
                    <span key={t} className="type-chip" style={{ background: TYPE_COLORS[t as PokemonType] }}>
                      {TYPE_NAMES_PT[t as PokemonType]}
                    </span>
                  ))}
                </span>
                <span className="starter-blurb">{blurb}</span>
              </button>
            );
          })}
        </div>
      </section>

      <button type="button" className="primary-button" disabled={chosen === null} onClick={confirm}>
        Comecar a jornada
      </button>
    </div>
  );
}
