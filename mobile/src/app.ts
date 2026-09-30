/**
 * PokeDeluge para Android, em NativeScript.
 *
 * O jogo e o mesmo do navegador: o build web vai para dentro do APK e roda
 * numa WebView nativa (GameWebView, em App_Resources/Android/src/main/java).
 * O NativeScript sobe o app e cuida do que e do sistema: a tela, o ciclo de
 * vida (som para quando o app vai para o fundo), o botao voltar e as telas de
 * arquivo que o backup do save usa.
 */
import { AndroidActivityBackPressedEventData, AndroidActivityResultEventData, Application } from '@nativescript/core';
import { GameView } from './game-view';

const game = new GameView();

Application.on(Application.suspendEvent, () => game.pause());
Application.on(Application.resumeEvent, () => game.resume());

if (global.isAndroid) {
  // Voltar nao fecha o jogo (e nem perde o que estava na tela): o app so vai
  // para o fundo, como o botao Home.
  Application.android.on(Application.android.activityBackPressedEvent, (args: AndroidActivityBackPressedEventData) => {
    args.cancel = true;
    args.activity.moveTaskToBack(true);
  });

  // Seletor de arquivo e "Salvar como" devolvem o resultado para a activity.
  Application.android.on(Application.android.activityResultEvent, (args: AndroidActivityResultEventData) => {
    game.handleActivityResult(args.requestCode, args.resultCode, args.intent);
  });
}

Application.run({ create: () => game });
