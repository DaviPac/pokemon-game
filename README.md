# PokeDeluge

RPG de Pokemon jogavel no navegador, instalavel como PWA e pensado **primeiro para
celular em retrato** — inspirado no DelugeRPG, mas com um overworld de verdade para
explorar, batalhas animadas e progressao que continua com o app fechado.

- **Mundo**: Kanto inteira e fiel (420 mapas), convertida do decomp `pret/pokefirered`.
- **Pokemon**: #1 a #721 (Gen 1 a 6), com sprites animados de Pokemon Black/White.
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

O pipeline fica em `tools/`:

- `build-world.ts` — compoe os atlas de metatiles (tiles 4bpp + paletas JASC +
  `metatiles.bin`) e converte cada `map.bin` num JSON compacto.
- `build-dex.ts` — reduz o `@pkmn/dex` a um JSON enxuto de Gen 1–6.
- `build-overworld.ts` — extrai os sprites de personagem do overworld.
- `preview-map.ts` — renderiza um mapa inteiro num PNG, util para conferir o pipeline.
- `screenshot.ts` — abre o jogo num Chromium com viewport de celular.

Os sprites de Pokemon sao carregados sob demanda de `raw.githubusercontent.com` e
ficam em cache no service worker: cada Pokemon visto continua disponivel offline.

## Aviso

Projeto de fa, sem fins lucrativos. Pokemon e marca registrada da Nintendo /
Creatures Inc. / GAME FREAK inc. Os assets vem de projetos de decompilacao e de
bases de dados publicas, e nao devem ser usados comercialmente.
