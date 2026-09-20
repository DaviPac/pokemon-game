/**
 * Novidades da versao. Aparece sozinha depois de uma atualizacao, mostrando so
 * o que mudou desde a ultima vez que o jogador entrou, e fica disponivel a
 * qualquer momento pelas configuracoes.
 */
import { KIND_LABELS, type PatchNote } from '../../data/patchNotes.js';
import { formatBuildTime } from '../../state/updates.js';
import { Sheet } from '../shell/Sheet.js';

interface Props {
  notes: PatchNote[];
  /** Titulo diferente quando o jogador abriu pelas configuracoes. */
  browsing?: boolean;
  onClose: () => void;
}

export function PatchNotes({ notes, browsing = false, onClose }: Props) {
  if (notes.length === 0) return null;

  return (
    <Sheet title={browsing ? 'Historico de versoes' : 'O que mudou'} onClose={onClose} height={82}>
      {!browsing && (
        <p className="paragraph">
          O jogo foi atualizado. Seu progresso continua onde estava.
        </p>
      )}

      {notes.map((note) => (
        <section key={note.version} className="patch-note">
          <header className="patch-head">
            <span className="patch-version">v{note.version}</span>
            <span className="patch-date">{formatDate(note.date)}</span>
          </header>
          <h3 className="patch-title">{note.title}</h3>
          <ul className="patch-list">
            {note.changes.map((change) => (
              <li key={change.text} className="patch-item">
                <span className={`patch-tag patch-tag-${change.kind}`}>
                  {KIND_LABELS[change.kind]}
                </span>
                <span className="patch-change">{change.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <div className="sheet-actions">
        <button type="button" className="primary-button" onClick={onClose}>
          {browsing ? 'Fechar' : 'Voltar ao jogo'}
        </button>
      </div>

      {formatBuildTime() && (
        <p className="screen-footnote">Compilado em {formatBuildTime()}</p>
      )}
    </Sheet>
  );
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}
