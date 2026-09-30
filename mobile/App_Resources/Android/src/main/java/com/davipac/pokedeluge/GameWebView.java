package com.davipac.pokedeluge;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.webkit.WebViewAssetLoader;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * A tela do jogo: uma WebView que roda o build web (npm run build:native),
 * guardado em assets/www dentro do APK.
 *
 * Os arquivos sao servidos por https://appassets.androidplatform.net, uma
 * origem https de verdade -- e nela que IndexedDB (o save), fetch e os
 * imports dinamicos funcionam como no navegador. Tudo o que roda por
 * requisicao fica aqui em Java: a WebView pede arquivos numa thread propria,
 * longe do JavaScript do NativeScript.
 */
public class GameWebView extends WebView {
    private static final String TAG = "PokeDeluge";
    public static final String HOST = "appassets.androidplatform.net";
    public static final String START_URL = "https://" + HOST + "/index.html";

    /** Codigos de resultado para o seletor de arquivos e o "Salvar como". */
    public static final int REQUEST_OPEN_FILE = 7101;
    public static final int REQUEST_SAVE_FILE = 7102;

    private final WebViewAssetLoader assetLoader;
    private final Handler main = new Handler(Looper.getMainLooper());
    private ValueCallback<Uri[]> pendingChooser;
    private String pendingSave;

    @SuppressLint("SetJavaScriptEnabled")
    public GameWebView(Context context) {
        super(context);
        setBackgroundColor(0xFF0D1117);

        WebSettings settings = getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        // O som comeca no primeiro toque, como no navegador; sem isto a
        // WebView ainda pediria um segundo gesto.
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        // A fonte grande do sistema desmontaria o layout feito em pixels.
        settings.setTextZoom(100);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " PokeDeluge-Android");

        assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/", new GameAssets(context))
                .build();

        setWebViewClient(new Client());
        setWebChromeClient(new Chrome());
        addJavascriptInterface(new Bridge(), "PokeNative");
        setOverScrollMode(OVER_SCROLL_NEVER);
    }

    /** Abre o jogo. */
    public void start() {
        loadUrl(START_URL);
    }

    /** O app foi para o fundo: o jogo cala o som e os relogios param. */
    public void pauseGame() {
        dispatch("native-pause");
        onPause();
        pauseTimers();
    }

    /** O app voltou para a frente. */
    public void resumeGame() {
        resumeTimers();
        onResume();
        dispatch("native-resume");
    }

    private void dispatch(String event) {
        evaluateJavascript("window.dispatchEvent(new Event('" + event + "'))", null);
    }

    /**
     * Resposta das telas do sistema (seletor de arquivo, "Salvar como"). A
     * activity e do NativeScript; o app repassa o resultado para ca.
     */
    public boolean handleActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        if (requestCode == REQUEST_OPEN_FILE) {
            if (pendingChooser != null) {
                pendingChooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                pendingChooser = null;
            }
            return true;
        }
        if (requestCode == REQUEST_SAVE_FILE) {
            String content = pendingSave;
            pendingSave = null;
            Uri target = data != null ? data.getData() : null;
            if (resultCode != Activity.RESULT_OK || target == null || content == null) return true;
            try (OutputStream out = getContext().getContentResolver().openOutputStream(target)) {
                if (out == null) throw new IOException("sem destino");
                out.write(content.getBytes(StandardCharsets.UTF_8));
                Toast.makeText(getContext(), "Backup salvo.", Toast.LENGTH_SHORT).show();
            } catch (IOException e) {
                Log.e(TAG, "nao foi possivel salvar o backup", e);
                Toast.makeText(getContext(), "Nao consegui salvar o backup.", Toast.LENGTH_LONG).show();
            }
            return true;
        }
        return false;
    }

    private Activity activity() {
        Context context = getContext();
        return context instanceof Activity ? (Activity) context : null;
    }

    private class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return assetLoader.shouldInterceptRequest(request.getUrl());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (HOST.equals(url.getHost())) return false;
            // Links para fora do jogo abrem no navegador do aparelho.
            try {
                getContext().startActivity(new Intent(Intent.ACTION_VIEW, url));
            } catch (ActivityNotFoundException ignored) {
                // sem navegador: o link so nao abre
            }
            return true;
        }
    }

    private class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            Activity activity = activity();
            if (activity == null) return false;
            if (pendingChooser != null) pendingChooser.onReceiveValue(null);
            pendingChooser = callback;
            try {
                activity.startActivityForResult(params.createIntent(), REQUEST_OPEN_FILE);
                return true;
            } catch (ActivityNotFoundException e) {
                pendingChooser = null;
                return false;
            }
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage message) {
            Log.d(TAG, message.message() + " (" + message.sourceId() + ":" + message.lineNumber() + ")");
            return true;
        }
    }

    /** O que o jogo chama como window.PokeNative. */
    private class Bridge {
        @JavascriptInterface
        public void saveFile(String name, String mime, String content) {
            main.post(() -> {
                Activity activity = activity();
                if (activity == null) return;
                pendingSave = content;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(mime);
                intent.putExtra(Intent.EXTRA_TITLE, name);
                try {
                    activity.startActivityForResult(intent, REQUEST_SAVE_FILE);
                } catch (ActivityNotFoundException e) {
                    pendingSave = null;
                    Toast.makeText(activity, "Nenhum app para salvar arquivos.", Toast.LENGTH_LONG).show();
                }
            });
        }
    }

    /** Serve assets/www/<caminho>, com o tipo certo de cada arquivo. */
    private static class GameAssets implements WebViewAssetLoader.PathHandler {
        private static final Map<String, String> TYPES = new HashMap<>();
        static {
            TYPES.put("html", "text/html");
            TYPES.put("js", "text/javascript");
            TYPES.put("mjs", "text/javascript");
            TYPES.put("css", "text/css");
            TYPES.put("json", "application/json");
            TYPES.put("webmanifest", "application/manifest+json");
            TYPES.put("png", "image/png");
            TYPES.put("jpg", "image/jpeg");
            TYPES.put("gif", "image/gif");
            TYPES.put("svg", "image/svg+xml");
            TYPES.put("woff2", "font/woff2");
            TYPES.put("wasm", "application/wasm");
            TYPES.put("txt", "text/plain");
        }

        private final Context context;

        GameAssets(Context context) {
            this.context = context.getApplicationContext();
        }

        @Nullable
        @Override
        public WebResourceResponse handle(@NonNull String path) {
            String file = path.isEmpty() ? "index.html" : path;
            try {
                InputStream stream = context.getAssets().open("www/" + file);
                WebResourceResponse response = new WebResourceResponse(typeOf(file), null, stream);
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-cache");
                response.setResponseHeaders(headers);
                return response;
            } catch (IOException e) {
                return null;
            }
        }

        private static String typeOf(String file) {
            int dot = file.lastIndexOf('.');
            String ext = dot >= 0 ? file.substring(dot + 1).toLowerCase() : "";
            String type = TYPES.get(ext);
            return type != null ? type : "application/octet-stream";
        }
    }
}
