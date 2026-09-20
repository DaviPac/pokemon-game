/**
 * Pokedex: as 721 especies ate Kalos, com o que voce ja viu e ja capturou.
 */
import { useMemo, useState } from 'react';
import type { PokemonType } from '../../game/data/types.js';
import { artwork, iconSprite } from '../../game/pokemon/sprites.js';
import type { PokemonContext } from '../../game/pokemon/pokemon.js';
import type { SaveData } from '../../game/save/schema.js';
import { TYPE_COLORS, TYPE_NAMES_PT } from '../theme/types.js';
import { Sheet } from '../shell/Sheet.js';

const GENERATIONS = [
  { label: 'Kanto', from: 1, to: 151 },
  { label: 'Johto', from: 152, to: 251 },
  { label: 'Hoenn', from: 252, to: 386 },
  { label: 'Sinnoh', from: 387, to: 493 },
  { label: 'Unova', from: 494, to: 649 },
  { label: 'Kalos', from: 650, to: 721 },
];

export function Pokedex({ ctx, save }: { ctx: PokemonContext; save: SaveData }) {
  const [generation, setGeneration] = useState(0);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number | null>(null);

  const seen = useMemo(() => new Set(save.seen), [save.seen]);
  const caught = useMemo(() => new Set(save.caught), [save.caught]);

  const range = GENERATIONS[generation];
  const entries = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list: number[] = [];
    for (let id = range.from; id <= range.to; id++) {
      const data = ctx.species[String(id)];
      if (!data) continue;
      if (query && !data.n.toLowerCase().includes(query) && !String(id).includes(query)) continue;
      list.push(id);
    }
    return list;
  }, [ctx.species, range, search]);

  const caughtInRange = entries.filter((id) => caught.has(id)).length;

  return (
    <div className="screen">
      <header className="screen-head">
        <h1 className="screen-title">Pokedex</h1>
        <p className="screen-sub">
          {save.caught.length} de 721 capturados · {save.seen.length} vistos
        </p>
      </header>

      <input
        className="search-input"
        placeholder="Buscar por nome ou numero"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="chip-row">
        {GENERATIONS.map((gen, index) => (
          <button
            key={gen.label}
            type="button"
            className={index === generation ? 'chip chip-active' : 'chip'}
            onClick={() => setGeneration(index)}
          >
            {gen.label}
          </button>
        ))}
      </div>

      <p className="screen-note">
        {range.label}: {caughtInRange} de {range.to - range.from + 1}
      </p>

      <div className="dex-grid">
        {entries.map((id) => {
          const data = ctx.species[String(id)];
          const isCaught = caught.has(id);
          const isSeen = seen.has(id);
          return (
            <button
              key={id}
              type="button"
              className={isCaught ? 'dex-cell dex-cell-caught' : 'dex-cell'}
              onClick={() => setSelected(id)}
            >
              <img
                className={isCaught || isSeen ? 'dex-icon' : 'dex-icon dex-icon-unknown'}
                src={iconSprite(id)}
                alt={data.n}
                loading="lazy"
                draggable={false}
              />
              <span className="dex-number">#{String(id).padStart(3, '0')}</span>
              <span className="dex-name">{isSeen ? data.n : '???'}</span>
            </button>
          );
        })}
      </div>

      {selected !== null && (
        <DexEntry
          ctx={ctx}
          id={selected}
          known={seen.has(selected)}
          caught={caught.has(selected)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function DexEntry({
  ctx,
  id,
  known,
  caught,
  onClose,
}: {
  ctx: PokemonContext;
  id: number;
  known: boolean;
  caught: boolean;
  onClose: () => void;
}) {
  const data = ctx.species[String(id)];
  const stats = [
    { label: 'HP', value: data.bs[0] },
    { label: 'Ataque', value: data.bs[1] },
    { label: 'Defesa', value: data.bs[2] },
    { label: 'At. Esp.', value: data.bs[3] },
    { label: 'Def. Esp.', value: data.bs[4] },
    { label: 'Velocidade', value: data.bs[5] },
  ];

  return (
    <Sheet title={known ? data.n : 'Ainda nao visto'} onClose={onClose}>
      {known ? (
        <>
          <div className="dex-hero">
            <img className="dex-art" src={artwork(id)} alt={data.n} draggable={false} />
            <div className="dex-hero-info">
              <span className="dex-hero-number">#{String(id).padStart(3, '0')}</span>
              <div className="chip-row">
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
              <span className="dex-hero-meta">
                {data.h.toFixed(1)} m · {data.w.toFixed(1)} kg
              </span>
              <span className="dex-hero-meta">
                {caught ? 'Capturado' : 'Visto, mas ainda nao capturado'}
              </span>
            </div>
          </div>

          <h3 className="section-title">Atributos base</h3>
          <div className="stat-list">
            {stats.map((stat) => (
              <div key={stat.label} className="stat-row">
                <span className="stat-label">{stat.label}</span>
                <div className="stat-track">
                  <div
                    className="stat-fill"
                    style={{ width: `${Math.min(100, (stat.value / 180) * 100)}%` }}
                  />
                </div>
                <span className="stat-value">{stat.value}</span>
              </div>
            ))}
          </div>

          <h3 className="section-title">Habilidades</h3>
          <p className="paragraph">{data.ab.join(', ') || '—'}</p>

          {data.evos.length > 0 && (
            <>
              <h3 className="section-title">Evolucao</h3>
              <p className="paragraph">
                {data.evos
                  .map((evo) => {
                    const target = ctx.species[String(evo.to)]?.n ?? '???';
                    if (evo.kind === 'level' && evo.level) return `${target} no nivel ${evo.level}`;
                    if (evo.item) return `${target} usando ${evo.item}`;
                    return `${target} (${evo.kind})`;
                  })
                  .join(' · ')}
              </p>
            </>
          )}
        </>
      ) : (
        <p className="paragraph">
          Voce ainda nao encontrou este Pokemon. Explore Kanto para completar a Pokedex.
        </p>
      )}
    </Sheet>
  );
}
