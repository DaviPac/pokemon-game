/**
 * Aviso de versao nova. Fica por cima de tudo, mas sem bloquear o jogo: da para
 * atualizar na hora ou continuar jogando e atualizar depois.
 */
import { useUpdates } from '../../state/updates.js';
import { haptic } from '../../state/settings.js';
import { audio } from '../../game/audio/index.js';

export function UpdateBanner() {
  const available = useUpdates((s) => s.available);
  const dismissed = useUpdates((s) => s.dismissed);
  const applying = useUpdates((s) => s.applying);
  const apply = useUpdates((s) => s.apply);
  const dismiss = useUpdates((s) => s.dismiss);

  if (!available || dismissed) return null;

  return (
    <div className="update-banner" role="status">
      <div className="update-text">
        <strong className="update-title">Nova versao disponivel</strong>
        <span className="update-sub">
          {applying
            ? 'Atualizando…'
            : 'A atualizacao e instantanea e seu progresso continua salvo.'}
        </span>
      </div>
      <div className="update-actions">
        <button
          type="button"
          className="update-later"
          disabled={applying}
          onClick={() => {
            audio.sfx('cancel');
            dismiss();
          }}
        >
          Depois
        </button>
        <button
          type="button"
          className="update-now"
          disabled={applying}
          onClick={() => {
            haptic(14);
            audio.sfx('select');
            apply();
          }}
        >
          {applying ? '…' : 'Atualizar'}
        </button>
      </div>
    </div>
  );
}
