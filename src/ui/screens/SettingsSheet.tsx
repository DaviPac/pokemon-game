import { MOVEMENT_MODES } from '../../game/input/InputBus.js';
import { useSettings } from '../../state/settings.js';
import { Sheet } from '../shell/Sheet.js';

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const settings = useSettings();

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

      <h3 className="section-title">Tela</h3>
      <label className="row">
        <span>Zoom do mapa</span>
        <select
          value={settings.zoom}
          onChange={(e) => settings.set('zoom', Number(e.target.value))}
        >
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
        label="Animacoes de batalha"
        checked={settings.battleAnimations}
        onChange={(v) => settings.set('battleAnimations', v)}
      />
      <Toggle
        label="Animacoes rapidas"
        checked={settings.fastAnimations}
        onChange={(v) => settings.set('fastAnimations', v)}
      />
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
      <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
