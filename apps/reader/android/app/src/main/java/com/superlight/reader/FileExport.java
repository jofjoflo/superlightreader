package com.superlight.reader;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Streams generated files through Android's Storage Access Framework. */
@CapacitorPlugin(name = "FileExport")
public class FileExport extends Plugin {

    private static final int MAX_CHUNK_BYTES = 256 * 1024;
    private static final int MAX_CHUNK_BASE64_CHARS = 350_552;
    private static final int MAX_FILE_NAME_LENGTH = 240;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Object stateLock = new Object();
    private PendingExport pending;
    private ExportStream active;
    private boolean opening;
    private boolean abortPending;

    @PluginMethod
    public void start(PluginCall call) {
        final String fileName = safeFileName(call.getString("fileName"));
        final String mimeType = safeMimeType(call.getString("mimeType"));
        final Long size = integerOption(call, "size");
        if (fileName == null) {
            call.reject("Exportfilen saknar ett giltigt filnamn.", "INVALID_ARGUMENT");
            return;
        }
        if (mimeType == null) {
            call.reject("Exportfilen saknar en giltig MIME-typ.", "INVALID_ARGUMENT");
            return;
        }
        if (size == null || size < 0) {
            call.reject("Exportfilen saknar en giltig storlek.", "INVALID_ARGUMENT");
            return;
        }

        synchronized (stateLock) {
            if (pending != null || active != null) {
                call.reject("En annan export pågår.", "EXPORT_BUSY");
                return;
            }
            pending = new PendingExport(call, size);
            abortPending = false;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try {
            startActivityForResult(call, intent, "createDocumentResult");
        } catch (RuntimeException error) {
            synchronized (stateLock) {
                pending = null;
            }
            call.reject("Kunde inte öppna filväljaren.", "EXPORT_UNAVAILABLE", error);
        }
    }

    @ActivityCallback
    public void createDocumentResult(PluginCall call, ActivityResult result) {
        PendingExport request;
        synchronized (stateLock) {
            request = pending;
            pending = null;
        }
        if (call == null) return;
        if (request == null) request = pendingFromCall(call);
        if (request == null) {
            call.reject("Exporten kunde inte återställas.", "EXPORT_STATE_LOST");
            return;
        }
        final PendingExport export = request;

        final Intent data = result == null ? null : result.getData();
        final Uri uri = data == null ? null : data.getData();
        if (result == null || result.getResultCode() != Activity.RESULT_OK || uri == null) {
            synchronized (stateLock) {
                opening = false;
                abortPending = false;
            }
            call.reject("Exporten avbröts.", "CANCELLED");
            return;
        }

        synchronized (stateLock) {
            opening = true;
        }
        io.execute(() -> openStream(export, uri));
    }

    @PluginMethod
    public void write(PluginCall call) {
        final String encoded = call.getString("data");
        if (encoded == null) {
            call.reject("Exportdata saknas.", "INVALID_ARGUMENT");
            return;
        }
        io.execute(() -> {
            final ExportStream stream;
            synchronized (stateLock) {
                stream = active;
            }
            if (stream == null) {
                call.reject("Exporten har inte startats.", "EXPORT_NOT_STARTED");
                return;
            }
            try {
                if (encoded.length() > MAX_CHUNK_BASE64_CHARS) {
                    throw new ExportException("Exportdelen är för stor.", "CHUNK_TOO_LARGE");
                }
                byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
                if (bytes.length > MAX_CHUNK_BYTES) {
                    throw new ExportException("Exportdelen är för stor.", "CHUNK_TOO_LARGE");
                }
                stream.write(bytes);
                call.resolve();
            } catch (ExportException error) {
                failActive(stream, error.getMessage());
                call.reject(error.getMessage(), error.code);
            } catch (IllegalArgumentException | IOException error) {
                failActive(stream, "Exportdelen kunde inte skrivas.");
                call.reject("Exportdelen kunde inte skrivas.", "EXPORT_WRITE_FAILED", error);
            }
        });
    }

    @PluginMethod
    public void finish(PluginCall call) {
        io.execute(() -> {
            final ExportStream stream;
            synchronized (stateLock) {
                stream = active;
            }
            if (stream == null) {
                call.reject("Exporten har inte startats.", "EXPORT_NOT_STARTED");
                return;
            }
            try {
                if (stream.bytesWritten != stream.expectedSize) {
                    failActive(stream, "Exportfilens storlek blev fel.");
                    call.reject("Exportfilens storlek blev fel.", "EXPORT_SIZE_MISMATCH");
                    return;
                }
                stream.output.close();
                synchronized (stateLock) {
                    if (active == stream) active = null;
                }
                call.resolve(new JSObject().put("saved", true));
            } catch (IOException error) {
                failActive(stream, "Exportfilen kunde inte slutföras.");
                call.reject("Exportfilen kunde inte slutföras.", "EXPORT_WRITE_FAILED", error);
            }
        });
    }

    @PluginMethod
    public void abort(PluginCall call) {
        io.execute(() -> {
            final ExportStream stream;
            synchronized (stateLock) {
                stream = active;
                if (pending != null || opening) abortPending = true;
            }
            if (stream != null) {
                closeAndDelete(stream);
                synchronized (stateLock) {
                    if (active == stream) active = null;
                }
            }
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        io.shutdownNow();
        synchronized (stateLock) {
            if (active != null) closeAndDelete(active);
            active = null;
            opening = false;
            pending = null;
        }
    }

    private void openStream(PendingExport request, Uri uri) {
        synchronized (stateLock) {
            if (abortPending) {
                abortPending = false;
                opening = false;
                deleteUri(uri);
                request.call.reject("Exporten avbröts.", "CANCELLED");
                return;
            }
        }
        try {
            OutputStream output = getContext().getContentResolver().openOutputStream(uri, "w");
            if (output == null) throw new IOException("Ingen skrivström tillgänglig.");
            ExportStream stream = new ExportStream(uri, output, request.size);
            synchronized (stateLock) {
                opening = false;
                active = stream;
            }
            request.call.resolve();
        } catch (IOException | SecurityException error) {
            synchronized (stateLock) {
                opening = false;
            }
            deleteUri(uri);
            request.call.reject("Exportfilen kunde inte öppnas.", "EXPORT_OPEN_FAILED", error);
        }
    }

    private void failActive(ExportStream stream, String message) {
        closeAndDelete(stream);
        synchronized (stateLock) {
            if (active == stream) active = null;
        }
    }

    private void closeAndDelete(ExportStream stream) {
        try {
            stream.output.close();
        } catch (IOException ignored) {
            // The partial document is still removed below when possible.
        }
        deleteUri(stream.uri);
    }

    private void deleteUri(Uri uri) {
        try {
            ContentResolver resolver = getContext().getContentResolver();
            resolver.delete(uri, null, null);
        } catch (RuntimeException ignored) {
            // Some document providers do not support deleting a newly created URI.
        }
    }

    private static Long integerOption(PluginCall call, String key) {
        Object value = call.getData().opt(key);
        if (!(value instanceof Number)) return null;
        double asDouble = ((Number) value).doubleValue();
        long asLong = ((Number) value).longValue();
        return asDouble >= 0 && asDouble == asLong ? asLong : null;
    }

    private static PendingExport pendingFromCall(PluginCall call) {
        String fileName = safeFileName(call.getString("fileName"));
        String mimeType = safeMimeType(call.getString("mimeType"));
        Long size = integerOption(call, "size");
        if (fileName == null || mimeType == null || size == null) return null;
        return new PendingExport(call, size);
    }

    private static String safeFileName(String value) {
        if (value == null) return null;
        String name = value.trim().replaceAll("[\\\\/:*?\"<>|\\u0000-\\u001f]", "_");
        if (name.isEmpty() || name.equals(".") || name.equals("..")) return null;
        return name.substring(0, Math.min(MAX_FILE_NAME_LENGTH, name.length()));
    }

    private static String safeMimeType(String value) {
        if (value == null || value.trim().isEmpty()) return "application/octet-stream";
        String mime = value.trim();
        if (mime.length() > 255 || mime.indexOf('\r') >= 0 || mime.indexOf('\n') >= 0 || !mime.contains("/")) return null;
        return mime;
    }

    private static final class PendingExport {
        final PluginCall call;
        final long size;

        PendingExport(PluginCall call, long size) {
            this.call = call;
            this.size = size;
        }
    }

    private static final class ExportStream {
        final Uri uri;
        final OutputStream output;
        final long expectedSize;
        long bytesWritten;

        ExportStream(Uri uri, OutputStream output, long expectedSize) {
            this.uri = uri;
            this.output = output;
            this.expectedSize = expectedSize;
        }

        void write(byte[] bytes) throws IOException, ExportException {
            if (bytesWritten > expectedSize || bytes.length > expectedSize - bytesWritten) {
                throw new ExportException("Exportfilen blev större än angiven storlek.", "EXPORT_SIZE_MISMATCH");
            }
            output.write(bytes);
            bytesWritten += bytes.length;
        }
    }

    private static final class ExportException extends Exception {
        final String code;

        ExportException(String message, String code) {
            super(message);
            this.code = code;
        }
    }
}
