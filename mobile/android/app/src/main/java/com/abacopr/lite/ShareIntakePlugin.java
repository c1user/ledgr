package com.abacopr.lite;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Parcelable;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import com.getcapacitor.Bridge;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * "Share to AbacoPR Lite" (ROADMAP-V6 2.6 / 3.2).
 *
 * MainActivity (launchMode singleTask) is the share target declared in
 * AndroidManifest.xml. It hands every ACTION_SEND / ACTION_SEND_MULTIPLE
 * intent to {@link #receive}: the shared images / PDFs are copied into
 * cacheDir/shared/&lt;batch&gt;/ off the UI thread (the sender's content://
 * grant only lasts while this activity lives), the JS layer is poked with the
 * window event {@value #EVENT} and pulls the copies once through
 * {@code consume()} (src/native/shareIntake.js), then uploads them like a
 * camera capture. Image types the API does not accept (HEIC from newer
 * cameras, GIF, BMP…) are transcoded to JPEG here — the WebView cannot decode
 * HEIC itself. Batches accumulate until consumed; copies older than
 * {@link #PURGE_AFTER_MS} are purged on the next share.
 *
 * Why in-house: the send-intent package's receiving activity is a second
 * BridgeActivity — a full copy of the app in its own task that finishes
 * itself on pause — so an upload started from it dies with the activity.
 * iOS gets the same JS contract from the share-extension work in Phase 3.4.
 */
@CapacitorPlugin(name = "ShareIntake")
public class ShareIntakePlugin extends Plugin {

    static final String EVENT = "abacoShareReceived";
    private static final String TAG = "AbacoShareIntake";
    private static final String DIR = "shared";
    private static final long PURGE_AFTER_MS = 10 * 60 * 1000L;
    private static final int JPEG_QUALITY = 90;

    private static final Object LOCK = new Object();
    private static final List<JSObject> pending = new ArrayList<>(); // copied, not yet consumed by JS

    static boolean isShare(Intent intent) {
        if (intent == null) return false;
        String action = intent.getAction();
        return Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action);
    }

    /**
     * Copies the shared items in the background, queues them for consume()
     * and notifies the WebView. Safe to call with any intent (non-share
     * intents are ignored) and before the page has loaded (the JS layer
     * pulls on start-up as well as on the event).
     */
    static void receive(final Activity activity, final Intent intent, final Bridge bridge) {
        if (!isShare(intent)) return;
        final List<Uri> uris = urisOf(intent);
        if (uris.isEmpty()) return;
        final String intentType = intent.getType();
        final Context context = activity.getApplicationContext();

        new Thread(
            () -> {
                List<JSObject> items = copyAll(context, intentType, uris);
                if (items.isEmpty()) return;
                synchronized (LOCK) {
                    pending.addAll(items);
                }
                if (bridge != null) {
                    activity.runOnUiThread(() -> bridge.triggerWindowJSEvent(EVENT));
                }
            },
            "abaco-share-intake"
        )
            .start();
    }

    /** { items: [{ url, name, type, size }] } — empties the queue. */
    @PluginMethod
    public void consume(PluginCall call) {
        JSArray items = new JSArray();
        synchronized (LOCK) {
            for (JSObject item : pending) items.put(item);
            pending.clear();
        }
        JSObject ret = new JSObject();
        ret.put("items", items);
        call.resolve(ret);
    }

    // ── helpers ─────────────────────────────────────────────────────────

    private static List<Uri> urisOf(Intent intent) {
        List<Uri> uris = new ArrayList<>();
        ClipData clip = intent.getClipData();
        if (clip != null) {
            for (int i = 0; i < clip.getItemCount(); i++) {
                Uri uri = clip.getItemAt(i).getUri();
                if (uri != null) uris.add(uri);
            }
        }
        if (uris.isEmpty()) {
            if (Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
                List<Parcelable> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (list != null) {
                    for (Parcelable p : list) if (p instanceof Uri) uris.add((Uri) p);
                }
            } else {
                Parcelable p = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (p instanceof Uri) uris.add((Uri) p);
            }
        }
        return uris;
    }

    private static List<JSObject> copyAll(Context context, String intentType, List<Uri> uris) {
        File root = new File(context.getCacheDir(), DIR);
        purgeOld(root);
        long stamp = System.currentTimeMillis();
        File dir = new File(root, String.valueOf(stamp));
        dir.mkdirs();

        List<JSObject> items = new ArrayList<>();
        ContentResolver resolver = context.getContentResolver();
        int index = 0;
        for (Uri uri : uris) {
            String name = displayName(resolver, uri);
            String type = mimeType(resolver, uri, intentType, name);
            if (!accepted(type)) {
                Logger.warn(TAG, "Skipping shared item of type " + type);
                continue;
            }
            boolean transcode = type.startsWith("image/") && !uploadable(type);
            String ext = transcode ? "jpg" : extensionFor(name, type);
            File out = new File(dir, stamp + "-" + (index++) + "." + ext);
            long size = transcode ? transcodeToJpeg(resolver, uri, out) : copy(resolver, uri, out);
            if (size < 0) continue;

            JSObject item = new JSObject();
            item.put("url", Uri.fromFile(out).toString());
            item.put("name", transcode ? jpegName(name, out) : (name != null ? name : out.getName()));
            item.put("type", transcode ? "image/jpeg" : type);
            item.put("size", size);
            items.add(item);
        }
        return items;
    }

    /** What the share sheet may hand us. */
    private static boolean accepted(String type) {
        return type != null && (type.startsWith("image/") || "application/pdf".equals(type));
    }

    /** What POST /api/receipts/upload accepts as-is. */
    private static boolean uploadable(String type) {
        return "image/jpeg".equals(type) || "image/png".equals(type) || "image/webp".equals(type) || "application/pdf".equals(type);
    }

    private static void purgeOld(File root) {
        File[] batches = root.listFiles();
        if (batches == null) return;
        long cutoff = System.currentTimeMillis() - PURGE_AFTER_MS;
        for (File batch : batches) {
            if (batch.lastModified() >= cutoff) continue;
            File[] files = batch.listFiles();
            if (files != null) for (File f : files) f.delete();
            batch.delete();
        }
    }

    private static String displayName(ContentResolver resolver, Uri uri) {
        if ("file".equals(uri.getScheme())) return uri.getLastPathSegment();
        try (Cursor c = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int col = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (col >= 0) return c.getString(col);
            }
        } catch (Exception e) {
            Logger.warn(TAG, "No display name for shared item: " + e.getMessage());
        }
        return null;
    }

    private static String mimeType(ContentResolver resolver, Uri uri, String intentType, String name) {
        String type = null;
        try {
            type = resolver.getType(uri);
        } catch (Exception ignored) {}
        if (type == null || type.endsWith("/*")) {
            String fromName = null;
            if (name != null && name.contains(".")) {
                String ext = name.substring(name.lastIndexOf('.') + 1).toLowerCase();
                fromName = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
            }
            if (fromName != null) type = fromName;
            else if (type == null) type = intentType;
        }
        if (type != null && type.endsWith("/*")) {
            type = type.startsWith("image/") ? "image/jpeg" : null;
        }
        return type;
    }

    private static String extensionFor(String name, String type) {
        if (name != null && name.contains(".")) {
            String ext = name.substring(name.lastIndexOf('.') + 1).toLowerCase();
            if (ext.matches("[a-z0-9]{1,5}")) return ext;
        }
        String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(type);
        if (ext != null) return ext;
        return "application/pdf".equals(type) ? "pdf" : "jpg";
    }

    private static String jpegName(String name, File out) {
        if (name == null || name.isEmpty()) return out.getName();
        int dot = name.lastIndexOf('.');
        return (dot > 0 ? name.substring(0, dot) : name) + ".jpg";
    }

    /** → bytes copied, or -1 on failure. */
    private static long copy(ContentResolver resolver, Uri uri, File out) {
        try (InputStream in = resolver.openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
            if (in == null) return -1;
            byte[] buf = new byte[64 * 1024];
            long total = 0;
            int n;
            while ((n = in.read(buf)) > 0) {
                os.write(buf, 0, n);
                total += n;
            }
            return total;
        } catch (Exception e) {
            Logger.error(TAG, "Could not copy shared item: " + e.getMessage(), e);
            out.delete();
            return -1;
        }
    }

    /** Decodes with the platform codecs (HEIC on API 28+) and writes a JPEG. → bytes, or -1. */
    private static long transcodeToJpeg(ContentResolver resolver, Uri uri, File out) {
        Bitmap bitmap = null;
        try (InputStream in = resolver.openInputStream(uri)) {
            if (in == null) return -1;
            bitmap = BitmapFactory.decodeStream(in);
            if (bitmap == null) {
                Logger.warn(TAG, "Could not decode shared image for JPEG transcode");
                return -1;
            }
            try (OutputStream os = new FileOutputStream(out)) {
                if (!bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, os)) return -1;
            }
            return out.length();
        } catch (Exception | OutOfMemoryError e) {
            Logger.error(TAG, "Could not transcode shared image: " + e.getMessage(), e instanceof Exception ? (Exception) e : null);
            out.delete();
            return -1;
        } finally {
            if (bitmap != null) bitmap.recycle();
        }
    }
}
