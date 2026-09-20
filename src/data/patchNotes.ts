/**
 * Historico de versoes, mostrado ao jogador depois de cada atualizacao.
 *
 * Vem junto com o codigo (e nao de um arquivo baixado) porque as novidades
 * descrevem exatamente a versao que esta rodando. A lista fica da mais nova
 * para a mais antiga; a versao do topo deve bater com a do package.json.
 */

export interface PatchNote {
  version: string;
  /** Data de lancamento, no formato AAAA-MM-DD. */
  date: string;
  title: string;
  /** Destaques em uma linha cada. */
  changes: { kind: 'novo' | 'melhoria' | 'correcao'; text: string }[];
}

export const PATCH_NOTES: PatchNote[] = [
  {
    version: '0.3.2',
    date: '2026-09-20',
    title: 'Derrota, silencio e pixels no lugar',
    changes: [
      {
        kind: 'correcao',
        text: 'Perder uma batalha agora leva mesmo de volta ao ultimo Centro Pokemon, em vez de deixar voce de pe onde caiu.',
      },
      {
        kind: 'correcao',
        text: 'Sair do app (ou trocar de aba) para o som na hora, e ele volta de onde parou quando voce retorna.',
      },
      {
        kind: 'correcao',
        text: 'Sumiu a linha fina que aparecia na borda de cada tile do mapa em telas de densidade quebrada.',
      },
    ],
  },
  {
    version: '0.3.1',
    date: '2026-09-20',
    title: 'A captura ganhou sua cena',
    changes: [
      {
        kind: 'novo',
        text: 'Tela de captura: o Pokemon aparece inteiro, com tipos, nivel e para onde foi -- equipe ou caixa -- enquanto o tema da captura toca.',
      },
      {
        kind: 'novo',
        text: 'Sprite de corrida do jogador, tirado do proprio FireRed, no lugar da caminhada acelerada.',
      },
      {
        kind: 'melhoria',
        text: 'O tema de vitoria comeca quando o adversario cai e a batalha so sai da tela quando ele termina (ou quando voce toca para continuar).',
      },
      {
        kind: 'correcao',
        text: 'A musica de batalha continuava tocando no mapa depois de uma captura.',
      },
      {
        kind: 'correcao',
        text: 'A barra inferior cobria botoes dos controles e o fim dos menus.',
      },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-09-20',
    title: 'Som, abertura e atualizacoes automaticas',
    changes: [
      {
        kind: 'novo',
        text: 'Trilha sonora original do jogo, tocada por um sintetizador no estilo do Game Boy Advance, com tema proprio para cada cidade, rota e tipo de batalha.',
      },
      { kind: 'novo', text: 'Gritos dos Pokemon ao entrarem em campo e na escolha do inicial.' },
      { kind: 'novo', text: 'Menu inicial com "Continuar", mostrando onde voce parou.' },
      {
        kind: 'novo',
        text: 'Abertura com o Professor Oak: apresentacao, escolha do nome e do parceiro, sem cortes secos.',
      },
      {
        kind: 'novo',
        text: 'Animacoes de inicio de batalha: cortina de abertura e o Pokemon saindo da Pokebola.',
      },
      {
        kind: 'novo',
        text: 'O jogo avisa quando sai uma versao nova e se atualiza sozinho, sem precisar reinstalar.',
      },
      {
        kind: 'novo',
        text: 'Backup do save: da para exportar para um arquivo e importar depois, nas configuracoes.',
      },
      {
        kind: 'melhoria',
        text: 'No controle novo, um toque rapido (ou segurar parado) interage com o que esta na frente.',
      },
      { kind: 'melhoria', text: 'Volume de musica, de efeitos e mudo nas configuracoes.' },
      {
        kind: 'correcao',
        text: 'A barra de HP caia antes de o golpe aparecer; agora a batalha e animada passo a passo, na ordem certa.',
      },
      { kind: 'correcao', text: 'A Pokebola voltava ao ponto inicial durante o arremesso.' },
      { kind: 'correcao', text: 'Concordancia dos atributos nos textos ("reduziu a Defesa").' },
    ],
  },
  {
    version: '0.2.0',
    date: '2026-09-20',
    title: 'Kanto viva: treinadores, campanha e expedicoes',
    changes: [
      {
        kind: 'novo',
        text: '248 treinadores com o time exato do jogo original, incluindo os lideres de ginasio.',
      },
      { kind: 'novo', text: 'Falas originais dos NPCs de Kanto.' },
      { kind: 'novo', text: 'Entrar e sair de predios, com Centro Pokemon e Loja funcionando.' },
      { kind: 'novo', text: 'Pokedex das 721 especies, equipe, caixa e mochila.' },
      {
        kind: 'novo',
        text: 'Expedicoes: mande Pokemon explorar e receba EXP, itens e ovos mesmo com o app fechado.',
      },
      { kind: 'novo', text: 'Missoes diarias, streak de login e nivel de treinador.' },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-09-20',
    title: 'Primeira versao jogavel',
    changes: [
      { kind: 'novo', text: 'Kanto inteira para explorar: 420 mapas fieis ao jogo original.' },
      { kind: 'novo', text: 'Batalhas por turnos com sprites animados de Pokemon Black/White.' },
      { kind: 'novo', text: 'Cinco modos de locomocao, do direcional classico ao analogico invisivel.' },
      { kind: 'novo', text: 'Funciona offline e pode ser instalado como aplicativo.' },
    ],
  },
];

export const KIND_LABELS: Record<PatchNote['changes'][number]['kind'], string> = {
  novo: 'Novo',
  melhoria: 'Melhor',
  correcao: 'Corrigido',
};

/**
 * Versoes lancadas depois da que o jogador viu por ultimo. Quem entra pela
 * primeira vez so ve a versao atual, e nao o historico inteiro.
 */
export function notesSince(lastSeen: string | null, current: string): PatchNote[] {
  if (!lastSeen) return PATCH_NOTES.slice(0, 1);
  if (lastSeen === current) return [];
  return PATCH_NOTES.filter((note) => compareVersions(note.version, lastSeen) > 0);
}

/** Compara "0.10.0" com "0.9.0" pelos numeros, nao como texto. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
