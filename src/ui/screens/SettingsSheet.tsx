import { useRef, useState } from 'react';
import { PATCH_NOTES } from '../../data/patchNotes.js';
import { MOVEMENT_MODES } from '../../game/input/InputBus.js';
import {
  exportSave,
  importSave,
  requestPersistentStorage,
} from '../../game/save/storage.js';
import { useGame } from '../../state/game.js';
import { useSettings } from '../../state/settings.js';
import { APP_VERSION, formatBuildTime, useUpdates } from '../../state/updates.js';
import { PatchNotes } from './PatchNotes.js';
import { Sheet } from '../shell/Sheet.js';

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  const save = useGame((s) => s.save);
  const setSave = useGame((s) => s.setSave);
  const updateAvailable = useUpdates((s) => s.available);
  const applyUpdate = useUpdates((s) => s.apply);
  const checkNow = useUpdates((s) => s.checkNow);

  const [notesOpen, setNotesOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImport = async (file: File) => {
    try {
      const imported = await importSave(file);
      setSave(imported);
      setMessage(`Save de ${imported.playerName} carregado.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Nao consegui ler esse arquivo.');
    }
  };

  return (
    <Sheet title="Configuracoes" onClose={onClose}>
      <h3 className="section-title">Como voce quer se mover</h3>
      <div className="option-list">
        {MOVEMENT_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className={settings.movementMode === mode.id ? 'option option-active' : 'option'}
            onClick={() => settings.set('movementMode', mode.id)}
          >
            <span className="option-label">{mode.label}</span>
            <span className="option-hint">{mode.hint}</span>
          </button>
        ))}
      </div>

      <h3 className="section-title">Som</h3>
      <Toggle
        label="Silenciar tudo"
        checked={settings.muted}
        onChange={(v) => settings.set('muted', v)}
      />
      <label className="row">
        <span>Musica</span>
        <input
          type="range"
          className="slider"
          min={0}
          max={100}
          value={Math.round(settings.musicVolume * 100)}
          onChange={(e) => settings.set('musicVolume', Number(e.target.value) / 100)}
        />
      </label>
      <label className="row">
        <span>Efeitos</span>
        <input
          type="range"
          className="slider"
          min={0}
          max={100}
          value={Math.round(settings.sfxVolume * 100)}
          onChange={(e) => settings.set('sfxVolume', Number(e.target.value) / 100)}
        />
      </label>

      <h3 className="section-title">Tela</h3>
      <label className="row">
        <span>Zoom do mapa</span>
        <select value={settings.zoom} onChange={(e) => settings.set('zoom', Number(e.target.value))}>
          <option value={0}>Automatico</option>
          <option value={2}>2x</option>
          <option value={3}>3x</option>
          <option value={4}>4x</option>
          <option value={5}>5x</option>
        </select>
      </label>

      <h3 className="section-title">Preferencias</h3>
      <Toggle
        label="Vibracao"
        checked={settings.vibration}
        onChange={(v) => settings.set('vibration', v)}
      />
      <Toggle
        label="Esconder a barra ao andar"
        checked={settings.autoHideNav}
        onChange={(v) => settings.set('autoHideNav', v)}
      />
      <Toggle
        label="Animacoes de batalha"
        checked={settings.battleAnimations}
        onChange={(v) => settings.set('battleAnimations', v)}
      />
      <Toggle
        label="Animacoes rapidas"
        checked={settings.fastAnimations}
        onChange={(v) => settings.set('fastAnimations', v)}
      />

      <h3 className="section-title">Seu progresso</h3>
      <p className="screen-note">
        O save fica guardado neste aparelho e sobrevive as atualizacoes do jogo. Limpar os dados do
        site pelo navegador apaga tudo -- por isso vale exportar um backup de vez em quando.
      </p>
      <div className="option-list">
        <button
          type="button"
          className="secondary-button"
          disabled={!save}
          onClick={() => {
            if (save) exportSave(save);
            setMessage('Backup salvo nos seus downloads.');
          }}
        >
          Exportar backup
        </button>
        <button type="button" className="secondary-button" onClick={() => fileRef.current?.click()}>
          Importar backup
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={async () => {
            const granted = await requestPersistentStorage();
            setMessage(
              granted
                ? 'Pronto: o navegador vai preservar seus dados.'
                : 'O navegador nao garantiu a preservacao. O backup em arquivo continua valendo.',
            );
          }}
        >
          Proteger dados neste aparelho
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleImport(file);
            e.target.value = '';
          }}
        />
      </div>

      <h3 className="section-title">Versao</h3>
      <div className="row">
        <span>PokeDeluge v{APP_VERSION}</span>
        <span className="hp-numbers">{formatBuildTime()}</span>
      </div>
      <div className="option-list">
        <button type="button" className="secondary-button" onClick={() => setNotesOpen(true)}>
          Ver novidades
        </button>
        {updateAvailable ? (
          <button type="button" className="primary-button" onClick={applyUpdate}>
            Atualizar agora
          </button>
        ) : (
          <button
            type="button"
            className="secondary-button"
            disabled={checking}
            onClick={() => {
              setChecking(true);
              checkNow();
              // O service worker responde de forma assincrona; um instante
              // depois ou o aviso aparece, ou ja estamos na versao mais nova.
              setTimeout(() => {
                setChecking(false);
                if (!useUpdates.getState().available) setMessage('Voce ja esta na versao mais nova.');
              }, 2500);
            }}
          >
            {checking ? 'Procurando…' : 'Procurar atualizacao'}
          </button>
        )}
      </div>

      {message && <p className="settings-message">{message}</p>}

      {notesOpen && (
        <PatchNotes notes={PATCH_NOTES} browsing onClose={() => setNotesOpen(false)} />
      )}
    </Sheet>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="row">
      <span>{label}</span>
      <input
        type="checkbox"
        className="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
