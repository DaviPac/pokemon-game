/**
 * Abertura do jogo: o Professor Oak apresenta o mundo, pergunta seu nome e
 * oferece o inicial. Cada etapa encadeia na seguinte com uma transicao, em vez
 * dos cortes secos que existiam antes.
 */
import { useEffect, useRef, useState } from 'react';
import { RNG } from '../../game/core/rng.js';
import type { PokemonType } from '../../game/data/types.js';
import { createPokemon, type PokemonContext } from '../../game/pokemon/pokemon.js';
import { artwork } from '../../game/pokemon/sprites.js';
import { audio } from '../../game/audio/index.js';
import { useGame } from '../../state/game.js';
import { haptic } from '../../state/settings.js';
import { TYPE_COLORS, TYPE_NAMES_PT } from '../theme/types.js';

const STARTERS = [
  { species: 1, blurb: 'Calmo e resistente. Facilita os dois primeiros ginasios.' },
  { species: 4, blurb: 'Rapido e agressivo. Comeco dificil, final poderoso.' },
  { species: 7, blurb: 'Equilibrado e seguro. A escolha mais tranquila.' },
];

/** Folha de poses do Oak no overworld; a interface mostra so a primeira. */
const OAK_SPRITE = `${import.meta.env.BASE_URL ?? '/'}assets/overworld/prof_oak.png`.replace(
  /\/{2,}/g,
  '/',
);

type Step = 'welcome' | 'name' | 'starter' | 'farewell';

interface Props {
  ctx: PokemonContext;
  onCancel: () => void;
  /** Chamado depois do fade, quando o mapa deve aparecer. */
  onStarted: () => void;
}

export function NewGame({ ctx, onCancel, onStarted }: Props) {
  const [step, setStep] = useState<Step>('welcome');
  const [line, setLine] = useState(0);
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<number | null>(null);
  const [leaving, setLeaving] = useState(false);
  const startNewGame = useGame((s) => s.startNewGame);
  const startedRef = useRef(false);

  const trainerName = name.trim() || 'Treinador';
  const starterName = chosen ? ctx.species[String(chosen)].n : '';

  const WELCOME = [
    'Ola! Bem-vindo ao mundo dos Pokemon!',
    'Meu nome e Oak. As pessoas me chamam de Professor Pokemon.',
    'Este mundo e habitado por criaturas que chamamos de Pokemon.',
    'Para algumas pessoas, sao bichos de estimacao. Outras lutam com eles.',
    'Quanto a mim... eu os estudo, como profissao.',
  ];

  const FAREWELL = [
    `${starterName} e um otimo parceiro, ${trainerName}.`,
    'Sua propria lenda esta prestes a comecar.',
    'Um mundo de sonhos e aventuras espera por voce la fora!',
  ];

  const lines = step === 'welcome' ? WELCOME : step === 'farewell' ? FAREWELL : [];

  // A abertura tem o tema do Professor Oak.
  useEffect(() => {
    void audio.playMusic('mus_oak');
  }, []);

  const advance = () => {
    haptic(8);
    audio.sfx('click');
    if (line + 1 < lines.length) {
      setLine(line + 1);
      return;
    }
    setLine(0);
    if (step === 'welcome') setStep('name');
    else if (step === 'farewell') void finish();
  };

  const finish = async () => {
    if (startedRef.current || chosen === null) return;
    startedRef.current = true;
    const starter = createPokemon(ctx, new RNG(), { species: chosen, level: 5 });
    starter.caughtWith = 'professor';
    await startNewGame(trainerName, starter);
    haptic([20, 50, 20]);
    // A tela some antes de o mapa aparecer: entrada suave, sem corte.
    setLeaving(true);
    setTimeout(onStarted, 620);
  };

  // O texto avanca com teclado tambem, para quem joga no computador.
  useEffect(() => {
    if (lines.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (['Enter', ' ', 'z', 'Z'].includes(e.key)) advance();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className={leaving ? 'intro intro-leaving' : 'intro'}>
      <div className="intro-sky" />

      {(step === 'welcome' || step === 'farewell') && (
        <button type="button" className="intro-scene" onClick={advance}>
          <span
            className="intro-oak"
            style={{ backgroundImage: `url(${OAK_SPRITE})` }}
            role="img"
            aria-label="Professor Oak"
          />
          {step === 'farewell' && chosen !== null && (
            <img
              className="intro-starter"
              src={artwork(chosen)}
              alt={starterName}
              draggable={false}
            />
          )}
          <div className="intro-box">
            <p key={`${step}-${line}`} className="intro-text">
              {lines[line]}
            </p>
            <span className="dialogue-next">▾</span>
          </div>
          <span className="intro-skip">toque para continuar</span>
        </button>
      )}

      {step === 'name' && (
        <div className="intro-panel">
          <span
            className="intro-oak intro-oak-small"
            style={{ backgroundImage: `url(${OAK_SPRITE})` }}
            aria-hidden="true"
          />
          <h2 className="intro-question">E voce? Como se chama?</h2>
          <input
            id="trainer-name"
            className="newgame-input"
            value={name}
            maxLength={12}
            placeholder="Treinador"
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setStep('starter');
            }}
          />
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              haptic(10);
              setStep('starter');
            }}
          >
            {name.trim() ? `Prazer, ${name.trim()}!` : 'Seguir como Treinador'}
          </button>
          <button type="button" className="title-action" onClick={onCancel}>
            Voltar ao menu
          </button>
        </div>
      )}

      {step === 'starter' && (
        <div className="intro-panel intro-panel-wide">
          <h2 className="intro-question">Escolha seu primeiro parceiro</h2>
          <p className="intro-hint">
            Sao tres Pokemon que guardo aqui no laboratorio. Escolha com calma, {trainerName}.
          </p>
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
                    audio.cry(species);
                  }}
                >
                  <img className="starter-art" src={artwork(species)} alt={data.n} draggable={false} />
                  <span className="starter-name">{data.n}</span>
                  <span className="starter-types">
                    {data.t.map((t) => (
                      <span
                        key={t}
                        className="type-chip"
                        style={{ background: TYPE_COLORS[t as PokemonType] }}
                      >
                        {TYPE_NAMES_PT[t as PokemonType]}
                      </span>
                    ))}
                  </span>
                  <span className="starter-blurb">{blurb}</span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="primary-button"
            disabled={chosen === null}
            onClick={() => {
              haptic(12);
              setStep('farewell');
            }}
          >
            {chosen ? `Ficar com ${starterName}` : 'Escolha um parceiro'}
          </button>
        </div>
      )}
    </div>
  );
}
