package com.superlight.reader;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

/**
 * Small, read-only Metron client for the Android shell.
 *
 * The token is accepted from the app UI, encrypted with an Android Keystore
 * key, and kept in app-private preferences. No token is bundled or logged.
 */
@CapacitorPlugin(name = "Metron")
public class MetronNative extends Plugin {
    private static final String BASE_URL = "https://metron.cloud/api/issue/";
    private static final String KEY_ALIAS = "superlight.reader.metron.token";
    private static final String PREFS = "metron_native";
    private static final String TOKEN_VALUE = "token";
    private static final int CONNECT_TIMEOUT_MS = 8_000;
    private static final int READ_TIMEOUT_MS = 8_000;
    private static final int MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
    private static final int MAX_TOKEN_LENGTH = 4_096;
    private static final int MAX_QUERY_LENGTH = 120;
    private static final int MAX_NUMBER_LENGTH = 30;
    private static final int MAX_PAGE = 100;
    private static final int GCM_TAG_BITS = 128;
    private static final int GCM_IV_BYTES = 12;

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Object storageLock = new Object();

    @PluginMethod
    public void setToken(PluginCall call) {
        String token = call.getString("token");
        if (!isValidToken(token)) {
            call.reject("Metron-token saknas eller har ogiltigt format.", "INVALID_TOKEN");
            return;
        }
        try {
            saveToken(token.trim());
            call.resolve(new JSObject().put("stored", true));
        } catch (GeneralSecurityException | IOException error) {
            // Do not forward the exception: it could contain implementation details.
            call.reject("Metron-token kunde inte sparas.", "TOKEN_STORAGE_FAILED");
        }
    }

    @PluginMethod
    public void clearToken(PluginCall call) {
        try {
            synchronized (storageLock) {
                preferences().edit().remove(TOKEN_VALUE).commit();
            }
            call.resolve(new JSObject().put("cleared", true));
        } catch (RuntimeException error) {
            call.reject("Metron-token kunde inte raderas.", "TOKEN_STORAGE_FAILED");
        }
    }

    @PluginMethod
    public void hasToken(PluginCall call) {
        try {
            call.resolve(new JSObject().put("configured", loadToken() != null));
        } catch (GeneralSecurityException | IOException error) {
            call.reject("Metron-token kunde inte läsas.", "TOKEN_STORAGE_FAILED");
        }
    }

    /** Alias used by the web client to avoid exposing whether this is native storage. */
    @PluginMethod
    public void status(PluginCall call) {
        hasToken(call);
    }

    @PluginMethod
    public void search(PluginCall call) {
        String query = call.getString("query");
        if (query == null) query = call.getString("q");
        String number = call.getString("number");
        Integer page = integerOption(call, "page");
        if (page == null) page = 1;
        String validation = validateSearch(query, number, page);
        if (validation != null) {
            call.reject(validation, "INVALID_ARGUMENT");
            return;
        }
        final int requestPage = page;
        final String requestQuery = query.trim();
        final String requestNumber = number == null ? null : number.trim();
        io.execute(() -> request(call, searchUrl(requestQuery, requestNumber, requestPage)));
    }

    @PluginMethod
    public void detail(PluginCall call) {
        Integer id = positiveInteger(call.getData().opt("id"));
        if (id == null) {
            call.reject("Metron-id måste vara ett positivt heltal.", "INVALID_ARGUMENT");
            return;
        }
        io.execute(() -> request(call, BASE_URL + id + "/"));
    }

    @Override
    protected void handleOnDestroy() {
        io.shutdownNow();
        super.handleOnDestroy();
    }

    private void request(PluginCall call, String endpoint) {
        final String token;
        try {
            token = loadToken();
        } catch (GeneralSecurityException | IOException error) {
            call.reject("Metron-token kunde inte läsas.", "TOKEN_STORAGE_FAILED");
            return;
        }
        if (token == null) {
            call.reject("Ange en Metron-token först.", "TOKEN_MISSING");
            return;
        }
        try {
            String body = getJson(endpoint, token);
            // Keep the wire shape identical to Metron. The TS adapter validates and parses it.
            call.resolve(bridgeJson(body));
        } catch (MetronHttpException error) {
            call.reject("Metron svarade med HTTP " + error.status + ".", "METRON_HTTP_ERROR");
        } catch (IOException | RuntimeException error) {
            call.reject("Metron kunde inte nås.", "METRON_REQUEST_FAILED");
        }
    }

    private String getJson(String endpoint, String token) throws IOException {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(endpoint);
            // URL is built only by searchUrl/detail URL; redirects are disabled so the
            // bearer token cannot be sent to another host.
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Authorization", "Bearer " + token);

            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new MetronHttpException(status);
            String body = readBody(connection.getInputStream());
            validateJson(body);
            return body;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String readBody(InputStream input) throws IOException {
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8 * 1024];
            int total = 0;
            for (int read; (read = stream.read(buffer)) != -1; ) {
                total += read;
                if (total > MAX_RESPONSE_BYTES) throw new IOException("response too large");
                output.write(buffer, 0, read);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static void validateJson(String body) throws IOException {
        String trimmed = body.trim();
        if (trimmed.isEmpty()) throw new IOException("empty response");
        try {
            if (trimmed.startsWith("{")) new JSONObject(trimmed);
            else if (trimmed.startsWith("[")) new JSONArray(trimmed);
            else throw new IOException("invalid response");
        } catch (JSONException error) {
            throw new IOException("invalid response");
        }
    }

    private static JSObject bridgeJson(String body) throws IOException {
        try {
            JSONObject parsed = new JSONObject(body);
            JSObject result = new JSObject();
            java.util.Iterator<String> keys = parsed.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                result.put(key, parsed.get(key));
            }
            return result;
        } catch (JSONException error) {
            throw new IOException("invalid object response");
        }
    }

    private void saveToken(String token) throws GeneralSecurityException, IOException {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] iv = cipher.getIV();
        if (iv == null || iv.length != GCM_IV_BYTES) throw new GeneralSecurityException("invalid IV");
        byte[] encrypted = cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
        byte[] packed = new byte[iv.length + encrypted.length];
        System.arraycopy(iv, 0, packed, 0, iv.length);
        System.arraycopy(encrypted, 0, packed, iv.length, encrypted.length);
        synchronized (storageLock) {
            if (!preferences().edit().putString(TOKEN_VALUE, Base64.encodeToString(packed, Base64.NO_WRAP)).commit()) {
                throw new IOException("preference write failed");
            }
        }
    }

    private String loadToken() throws GeneralSecurityException, IOException {
        String encoded;
        synchronized (storageLock) {
            encoded = preferences().getString(TOKEN_VALUE, null);
        }
        if (encoded == null) return null;
        final byte[] packed;
        try {
            packed = Base64.decode(encoded, Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            throw new IOException("invalid stored token");
        }
        if (packed.length <= GCM_IV_BYTES) throw new IOException("invalid stored token");
        byte[] iv = new byte[GCM_IV_BYTES];
        byte[] encrypted = new byte[packed.length - GCM_IV_BYTES];
        System.arraycopy(packed, 0, iv, 0, iv.length);
        System.arraycopy(packed, iv.length, encrypted, 0, encrypted.length);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(GCM_TAG_BITS, iv));
        String token = new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8).trim();
        return isValidToken(token) ? token : null;
    }

    private SharedPreferences preferences() {
        Context context = getContext();
        if (context == null) throw new IllegalStateException("plugin is not attached");
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private SecretKey key() throws GeneralSecurityException, IOException {
        synchronized (storageLock) {
            KeyStore store = KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            if (!store.containsAlias(KEY_ALIAS)) {
                KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
                generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                        KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .build());
                generator.generateKey();
            }
            KeyStore.Entry entry = store.getEntry(KEY_ALIAS, null);
            if (!(entry instanceof KeyStore.SecretKeyEntry)) throw new IOException("invalid keystore entry");
            SecretKey secret = ((KeyStore.SecretKeyEntry) entry).getSecretKey();
            if (secret == null) throw new IOException("missing keystore key");
            return secret;
        }
    }

    static String validateSearch(String query, String number, int page) {
        if (query == null || query.trim().isEmpty() || query.trim().length() > MAX_QUERY_LENGTH || containsControl(query)) {
            return "Metron-sökningen måste innehålla 1–120 giltiga tecken.";
        }
        if (number != null && (number.trim().isEmpty() || number.trim().length() > MAX_NUMBER_LENGTH || containsControl(number))) {
            return "Metron-numret har ogiltigt format.";
        }
        if (page < 1 || page > MAX_PAGE) return "Metron-sidan måste vara mellan 1 och 100.";
        return null;
    }

    static boolean isValidToken(String token) {
        if (token == null) return false;
        String value = token.trim();
        return !value.isEmpty() && value.length() <= MAX_TOKEN_LENGTH && !containsControl(value);
    }

    private static boolean containsControl(String value) {
        for (int i = 0; i < value.length(); i++) if (Character.isISOControl(value.charAt(i))) return true;
        return false;
    }

    private static Integer integerOption(PluginCall call, String key) {
        Object value = call.getData().opt(key);
        if (value instanceof Number) {
            double number = ((Number) value).doubleValue();
            int integer = ((Number) value).intValue();
            return number >= 0 && number == integer ? integer : null;
        }
        if (value instanceof String && ((String) value).matches("\\d+")) {
            try {
                long parsed = Long.parseLong((String) value);
                return parsed <= Integer.MAX_VALUE ? (int) parsed : null;
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
    }

    private static Integer positiveInteger(Object value) {
        if (value instanceof Number) {
            double number = ((Number) value).doubleValue();
            int integer = ((Number) value).intValue();
            return number >= 1 && number == integer ? integer : null;
        }
        if (value instanceof String && ((String) value).matches("[1-9]\\d*")) {
            try {
                long parsed = Long.parseLong((String) value);
                return parsed <= Integer.MAX_VALUE ? (int) parsed : null;
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
    }

    private static String searchUrl(String query, String number, int page) {
        try {
            StringBuilder url = new StringBuilder(BASE_URL)
                    .append("?series_name=").append(URLEncoder.encode(query, "UTF-8"))
                    .append("&page=").append(page);
            if (number != null) url.append("&number=").append(URLEncoder.encode(number.trim(), "UTF-8"));
            return url.toString();
        } catch (Exception error) {
            throw new IllegalArgumentException("invalid query");
        }
    }

    private static final class MetronHttpException extends IOException {
        final int status;

        MetronHttpException(int status) {
            this.status = status;
        }
    }
}
