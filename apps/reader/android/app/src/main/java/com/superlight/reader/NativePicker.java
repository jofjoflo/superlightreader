package com.superlight.reader;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.content.res.AssetFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.os.ParcelFileDescriptor;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Android Storage Access Framework picker with bounded, random-access reads. */
@CapacitorPlugin(name = "NativePicker")
public class NativePicker extends Plugin {
    private static final int MAX_CHUNK_BYTES = 256 * 1024;
    private static final String DIRECTORY_MIME = "vnd.android.document/directory";
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void pick(PluginCall call) {
        boolean directory = Boolean.TRUE.equals(call.getBoolean("directory"));
        Intent intent;
        if (directory) {
            intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            intent.putExtra("android.content.extra.SHOW_ADVANCED", true);
        } else {
            intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.setType("*/*");
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
        }
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        try {
            startActivityForResult(call, intent, "pickResult");
        } catch (RuntimeException error) {
            call.reject("Kunde inte öppna filväljaren.", "PICKER_UNAVAILABLE", error);
        }
    }

    @ActivityCallback
    public void pickResult(PluginCall call, ActivityResult result) {
        if (result == null || result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.resolve(new JSObject().put("files", new JSArray()));
            return;
        }
        Intent data = result.getData();
        ArrayList<Uri> uris = new ArrayList<>();
        if (data.getClipData() != null) {
            for (int i = 0; i < data.getClipData().getItemCount(); i++) uris.add(data.getClipData().getItemAt(i).getUri());
        } else if (data.getData() != null) {
            uris.add(data.getData());
        }
        if (uris.isEmpty()) {
            call.resolve(new JSObject().put("files", new JSArray()));
            return;
        }
        for (Uri uri : uris) {
            try {
                getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (SecurityException ignored) {
                // Providers that do not offer persistable permissions remain readable for this session.
            }
        }
        io.execute(() -> {
            try {
                List<Picked> picked = new ArrayList<>();
                List<String> errors = new ArrayList<>();
                Set<String> visited = new HashSet<>();
                for (Uri uri : uris) {
                    if (isTreeUri(uri)) {
                        String rootId = DocumentsContract.getTreeDocumentId(uri);
                        Uri rootDocument = DocumentsContract.buildDocumentUriUsingTree(uri, rootId);
                        walkTree(uri, rootId, displayName(rootDocument), picked, visited, errors);
                    }
                    else addFile(uri, displayName(uri), displayName(uri), picked, errors);
                }
                JSArray files = new JSArray();
                for (Picked item : picked) files.put(item.toJs());
                JSObject response = new JSObject().put("files", files);
                if (!errors.isEmpty()) {
                    JSArray errorArray = new JSArray();
                    for (String error : errors) errorArray.put(error);
                    response.put("errors", errorArray);
                }
                call.resolve(response);
            } catch (SecurityException error) {
                call.reject("Mappen kunde inte läsas.", "PICK_READ_DENIED", error);
            } catch (IOException error) {
                call.reject("Mappen kunde inte läsas.", "PICK_READ_FAILED", error);
            } catch (RuntimeException error) {
                call.reject("Mappen kunde inte läsas.", "PICK_READ_FAILED", error);
            }
        });
    }

    @PluginMethod
    public void readChunk(PluginCall call) {
        String uriValue = call.getString("uri");
        Long offset = integerOption(call, "offset");
        Long length = integerOption(call, "length");
        if (uriValue == null || !uriValue.startsWith("content://") || offset == null || length == null || offset < 0 || length < 0 || length > MAX_CHUNK_BYTES) {
            call.reject("Ogiltigt läsintervall.", "INVALID_ARGUMENT");
            return;
        }
        io.execute(() -> {
            try {
                Uri uri = Uri.parse(uriValue);
                ParcelFileDescriptor descriptor = getContext().getContentResolver().openFileDescriptor(uri, "r");
                if (descriptor == null) throw new IOException("Ingen läsström tillgänglig.");
                try (ParcelFileDescriptor.AutoCloseInputStream stream = new ParcelFileDescriptor.AutoCloseInputStream(descriptor)) {
                    try {
                        stream.getChannel().position(offset);
                    } catch (IOException error) {
                        throw new IOException("Dokumentleverantören stöder inte slumpmässig läsning.", error);
                    }
                    byte[] bytes = new byte[length.intValue()];
                    int total = 0;
                    while (total < bytes.length) {
                        int n = stream.read(bytes, total, bytes.length - total);
                        if (n < 0) break;
                        if (n == 0) continue;
                        total += n;
                    }
                    byte[] result = total == bytes.length ? bytes : java.util.Arrays.copyOf(bytes, total);
                    call.resolve(new JSObject()
                            .put("data", Base64.encodeToString(result, Base64.NO_WRAP))
                            .put("bytesRead", total)
                            .put("eof", total < bytes.length));
                }
            } catch (SecurityException error) {
                call.reject("Filen kunde inte läsas.", "READ_DENIED", error);
            } catch (IOException | RuntimeException error) {
                String message = error.getMessage();
                call.reject(message == null || message.isEmpty() ? "Filen kunde inte läsas." : message, "READ_FAILED", error);
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        io.shutdownNow();
    }

    private void walkTree(Uri tree, String documentId, String prefix, List<Picked> out, Set<String> visited, List<String> errors) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        String key = tree.toString() + "#" + documentId;
        if (!visited.add(key)) return;
        String rootName = prefix;
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, documentId);
        try (Cursor cursor = resolver.query(children, new String[]{
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
                OpenableColumns.SIZE,
                DocumentsContract.Document.COLUMN_LAST_MODIFIED
        }, null, null, null)) {
            if (cursor == null) throw new IOException("Dokumentleverantören saknar mappläsning.");
            int idCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
            int nameCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
            int mimeCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE);
            int sizeCol = cursor.getColumnIndex(OpenableColumns.SIZE);
            int modifiedCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED);
            while (cursor.moveToNext()) {
                String id = cursor.getString(idCol);
                String name = safeComponent(cursor.getString(nameCol));
                if (name.isEmpty()) continue;
                Uri child = DocumentsContract.buildDocumentUriUsingTree(tree, id);
                String mime = mimeCol >= 0 ? cursor.getString(mimeCol) : null;
                String path = rootName + "/" + name;
                if (DIRECTORY_MIME.equals(mime)) {
                    try {
                        walkTree(tree, id, path, out, visited, errors);
                    } catch (IOException | SecurityException error) {
                        // One inaccessible child must not discard readable siblings.
                        errors.add(path + ": mappen kunde inte läsas");
                    }
                } else if (isComic(name)) {
                    long modified = modifiedCol >= 0 ? cursor.getLong(modifiedCol) : 0;
                    try {
                        long size = fileSize(child, cursor, sizeCol);
                        out.add(new Picked(name, path, size, Math.max(0, modified), child.toString()));
                    } catch (IOException | SecurityException error) {
                        errors.add(path + ": filstorlek kunde inte fastställas");
                    }
                }
            }
        }
    }

    private void addFile(Uri uri, String name, String path, List<Picked> out, List<String> errors) {
        if (name == null || !isComic(name)) return;
        long size;
        long modified = 0;
        try (Cursor cursor = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED}, null, null, null)) {
            int sizeCol = cursor == null ? -1 : cursor.getColumnIndex(OpenableColumns.SIZE);
            int modifiedCol = cursor == null ? -1 : cursor.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED);
            if (cursor != null && cursor.moveToFirst() && modifiedCol >= 0 && !cursor.isNull(modifiedCol)) modified = cursor.getLong(modifiedCol);
            size = fileSize(uri, cursor, sizeCol);
        } catch (IOException | SecurityException error) {
            errors.add(path + ": filstorlek kunde inte fastställas");
            return;
        }
        out.add(new Picked(name, path, size, Math.max(0, modified), uri.toString()));
    }

    private long fileSize(Uri uri, Cursor cursor, int sizeColumn) throws IOException {
        if (cursor != null && cursor.getPosition() >= 0 && sizeColumn >= 0 && !cursor.isNull(sizeColumn)) {
            long size = cursor.getLong(sizeColumn);
            if (size >= 0) return size;
        }
        try (AssetFileDescriptor asset = getContext().getContentResolver().openAssetFileDescriptor(uri, "r")) {
            if (asset != null && asset.getLength() >= 0) return asset.getLength();
        }
        try (ParcelFileDescriptor descriptor = getContext().getContentResolver().openFileDescriptor(uri, "r")) {
            if (descriptor != null && descriptor.getStatSize() >= 0) return descriptor.getStatSize();
        }
        throw new IOException("Filstorlek saknas");
    }

    private String displayName(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) return safeComponent(cursor.getString(0));
        }
        String fallback = uri.getLastPathSegment();
        return safeComponent(fallback == null ? "Serier" : fallback);
    }

    private static boolean isTreeUri(Uri uri) {
        return DocumentsContract.isTreeUri(uri) || "tree".equals(uri.getPathSegments().isEmpty() ? "" : uri.getPathSegments().get(0));
    }

    private static boolean isComic(String name) {
        String lower = name.toLowerCase(java.util.Locale.ROOT);
        return lower.endsWith(".cbz") || lower.endsWith(".zip") || lower.endsWith(".cbr") || lower.endsWith(".rar");
    }

    private static String safeComponent(String value) {
        if (value == null) return "";
        String clean = value.replace('/', '／').replace('\\', '＼').trim();
        return clean.equals(".") || clean.equals("..") ? "_" : clean;
    }

    private static Long integerOption(PluginCall call, String key) {
        Object value = call.getData().opt(key);
        if (!(value instanceof Number)) return null;
        double decimal = ((Number) value).doubleValue();
        long integer = ((Number) value).longValue();
        return decimal == integer && integer >= 0 ? integer : null;
    }

    private static final class Picked {
        final String name;
        final String path;
        final long size;
        final long modified;
        final String uri;

        Picked(String name, String path, long size, long modified, String uri) {
            this.name = name;
            this.path = path;
            this.size = size;
            this.modified = modified;
            this.uri = uri;
        }

        JSObject toJs() {
            return new JSObject().put("name", name).put("path", path).put("size", size).put("lastModified", modified).put("uri", uri);
        }
    }
}
