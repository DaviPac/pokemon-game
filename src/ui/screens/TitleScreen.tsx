/**
 * Menu inicial. Quem ja tem save cai direto no "Continuar", com um resumo de
 * onde parou; quem nao tem, so ve "Nova jornada".
 */
import { useEffect, useState } from 'react';
import { loadMap } from '../../game/data/assets.js';
import { iconSprite } from '../../game/pokemon/sprites.js';
import type { SaveData } from '../../game/save/schema.js';
import { audio } from '../../game/audio/index.js';
import { mapDisplayName } from '../../i18n/places.js';
import { haptic } from '../../state/settings.js';

interface Props {
  save: SaveData | null;
  onContinue: () => void;
  onNewGame: () => void;
  onSettings: () => void;
}

export function TitleScreen({ save, onContinue, onNewGame, onSettings }: Props) {
  const [place, setPlace] = useState('');
  const [confirmingNew, setConfirmingNew] = useState(false);

  useEffect(() => {
    if (!save) return;
    let cancelled = false;
    void loadMap(save.position.map)
      .then((map) => {
        if (!cancelled) setPlace(mapDisplayName(map));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [save]);

  const press = (action: () => void) => () => {
    haptic(12);
    audio.sfx('select');
    action();
  };

  // O tema do titulo comeca assim que o audio for liberado pelo primeiro toque.
  useEffect(() => {
    void audio.playMusic('mus_title');
  }, []);

  return (
    <div className="title">
      <div className="title-sky" />

      <header className="title-head">
        <span className="title-ball" aria-hidden="true" />
        <h1 className="title-name">PokeDeluge</h1>
        <p className="title-tagline">Kanto inteira no bolso</p>
      </header>

      <div className="title-menu">
        {save && (
          <button type="button" className="title-continue" onClick={press(onContinue)}>
            <span className="title-continue-label">Continuar</span>
            <span className="title-continue-info">
              {save.playerName} · Nivel {save.trainerLevel} · {place || '…'}
            </span>
            <span className="title-party">
              {save.party.slice(0, 6).map((pokemon) => (
                <img
                  key={pokemon.uid}
                  className="title-party-icon"
                  src={iconSprite(pokemon.species, pokemon.shiny)}
                  alt=""
                  draggable={false}
                />
              ))}
            </span>
          </button>
        )}

        {!save || confirmingNew ? (
          <>
            {confirmingNew && (
              <p className="title-warning">
                Comecar de novo apaga o save atual. Isso nao tem volta.
              </p>
            )}
            <button type="button" className="title-action title-action-primary" onClick={press(onNewGame)}>
              {confirmingNew ? 'Apagar e comecar de novo' : 'Nova jornada'}
            </button>
            {confirmingNew && (
              <button
                type="button"
                className="title-action"
                onClick={press(() => setConfirmingNew(false))}
              >
                Cancelar
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            className="title-action"
            onClick={press(() => setConfirmingNew(true))}
          >
            Nova jornada
          </button>
        )}

        <button type="button" className="title-action" onClick={press(onSettings)}>
          Configuracoes
        </button>
      </div>

      <p className="title-footer">
        Projeto de fa, sem fins lucrativos. Pokemon e marca da Nintendo / Creatures / GAME FREAK.
      </p>
    </div>
  );
}
