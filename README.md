# PokeDeluge

RPG de Pokemon jogavel no navegador, instalavel como PWA e pensado **primeiro para
celular em retrato** — inspirado no DelugeRPG, mas com um overworld de verdade para
explorar, batalhas animadas e progressao que continua com o app fechado.

- **Mundo**: Kanto inteira e fiel (420 mapas), convertida do decomp `pret/pokefirered`.
- **Pokemon**: #1 a #721 (Gen 1 a 6), com sprites animados de Pokemon Black/White.
- **Som**: as musicas originais do FireRed, tocadas por um sintetizador chiptune.
- **Offline**: save local em IndexedDB, sem contas e sem servidor.
- **Idioma**: interface em pt-BR.

## Rodando

```bash
npm install
npm run assets   # baixa e converte os assets (so precisa na primeira vez)
npm run dev
```

`npm run assets` guarda os arquivos baixados em `.cache/`, entao rodar de novo e
instantaneo. Os assets convertidos ficam versionados em `public/assets`, ou seja,
um clone novo ja roda com `npm install && npm run dev`.

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Typecheck + build de producao |
| `npm run assets` | Pipeline completo de assets |
| `npm run test` | Testes do motor de jogo (Vitest) |
| `npm run test:update` | Testa o ciclo de atualizacao do PWA num navegador real |
| `npm run typecheck` | Só o typecheck |

## Modos de locomocao

Trocaveis a qualquer momento nas configuracoes:

| Modo | Como funciona |
| --- | --- |
| **Novo** | Analogico invisivel: arraste o dedo em qualquer lugar da tela |
| **Toque** | Toque num ponto do mapa e o personagem caminha ate la (A\*) |
| **Classico (analogico)** | Analogico na esquerda, A/B na direita |
| **Classico (direcional)** | D-pad de setas, igual a um emulador de GBA |
| **Duas telas** | Mapa em cima, painel estilo Game Boy Color embaixo |

No desktop, teclado (setas/WASD, Z/X, Shift para correr) funciona em qualquer modo.

## Como os assets sao montados

Nada e inventado: tudo vem de projetos publicos, convertido em build.

| O que | Fonte |
| --- | --- |
| Mapas, colisao, warps, NPCs e encontros de Kanto | `pret/pokefirered` |
| Tilesets e sprites de personagem do overworld | `pret/pokefirered` |
| Sprites de batalha animados (#1–649) | `PokeAPI/sprites`, geracao V (Black/White) |
| Sprites de batalha (#650–721) | `PokeAPI/sprites`, geracao VI (X/Y) |
| Especies, golpes, learnsets, tipos | `@pkmn/dex` (npm) |
| Taxa de captura, EXP base, EV yield, grupo de crescimento | `veekun/pokedex` |
| Musicas (MIDI) | `pret/pokefirered` |
| Gritos dos Pokemon | `PokeAPI/cries` |

O pipeline fica em `tools/`:

- `build-world.ts` — compoe os atlas de metatiles (tiles 4bpp + paletas JASC +
  `metatiles.bin`) e converte cada `map.bin` num JSON compacto.
- `build-dex.ts` — reduz o `@pkmn/dex` a um JSON enxuto de Gen 1–6.
- `build-overworld.ts` — extrai os sprites de personagem do overworld, inclusive
  a folha de corrida do jogador (que no FireRed divide o arquivo com o surf: a
  tabela de quadros e a de animacao do decomp dizem quais indices usar).
- `build-events.ts` — liga cada NPC ao seu treinador e a sua fala original.
- `build-music.ts` — le os MIDIs originais e os converte em notas com tempo em
  segundos, que o sintetizador WebAudio toca ao vivo.
- `build-icons.ts` — desenha os icones do PWA.
- `preview-map.ts` — renderiza um mapa inteiro num PNG, util para conferir o pipeline.
- `screenshot.ts` — abre o jogo num Chromium com viewport de celular.

Os sprites de Pokemon sao carregados sob demanda de `raw.githubusercontent.com` e
ficam em cache no service worker: cada Pokemon visto continua disponivel offline.

## Som

Nenhum arquivo de audio e distribuido. As 28 musicas usadas vem dos MIDIs do
decomp, convertidos para JSON de notas, e sao tocadas por um sintetizador
escrito em WebAudio (`src/game/audio/`) que imita os canais do Game Boy Advance:
onda quadrada nas melodias, triangular no baixo e ruido na percussao. Os efeitos
do sistema sao sintetizados na hora, e os gritos dos Pokemon vem do repositorio
de audio do PokeAPI.

Navegador nenhum toca som antes de um gesto do usuario, entao tudo comeca no
primeiro toque. Volume de musica, de efeitos e o mudo ficam nas configuracoes.

## Atualizacoes e seu progresso

O jogo se atualiza sozinho. Quando sai uma versao nova, o app instalado percebe
(na abertura, ao voltar do segundo plano ou a cada 30 minutos), avisa com um
banner e troca de versao em um toque -- sem limpar cache e sem reinstalar. Depois
da troca, uma tela mostra o que mudou desde a ultima vez que voce jogou.

O save fica no IndexedDB, que nem a atualizacao nem o service worker tocam, e as
migracoes so somam campos novos: nenhuma versao nova custa progresso. Ainda
assim, limpar os dados do site pelo navegador apaga tudo, entao as configuracoes
trazem **exportar backup** (gera um arquivo), **importar backup** e um pedido de
armazenamento persistente ao navegador.

`npm run test:capture` faz o mesmo com o fim de batalha e com o acabamento da
tela: confere que o tema de vitoria segura a tela ate acabar, que a captura abre
a tela do Pokemon capturado com o tema tocando, que a musica do lugar volta ao
chegar no mapa (e que a de batalha nao sobra tocando), que perder leva de volta
ao Centro Pokemon, que sair do app cala o som, que a barra inferior nao cobre
botao nenhum, que correr usa o sprite de corrida, que a barra inferior cresce
sob o dedo e se recolhe ao andar, que as plataformas do campo de batalha saem em
perspectiva de verdade (a da frente mais aberta que a do fundo, cada Pokemon
pisando no meio da sua) e que numa tela de densidade quebrada o mapa sai pixel a
pixel, sem costura entre os tiles.

`npm run test:update` verifica isso de ponta a ponta num navegador de verdade:
instala uma versao, cria um save, publica outra por cima, confere que o aviso
aparece sozinho, aplica a atualizacao e valida que o save continua intacto, que a
versao nova esta mesmo rodando e que o jogo ainda abre offline.

## Aviso

Projeto de fa, sem fins lucrativos. Pokemon e marca registrada da Nintendo /
Creatures Inc. / GAME FREAK inc. Os assets vem de projetos de decompilacao e de
bases de dados publicas, e nao devem ser usados comercialmente.
