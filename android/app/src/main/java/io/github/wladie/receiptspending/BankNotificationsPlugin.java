package io.github.wladie.receiptspending;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;

@CapacitorPlugin(name = "BankNotifications")
public class BankNotificationsPlugin extends Plugin {

    @Override
    public void load() {
        BankNotificationService.plugin = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (BankNotificationService.plugin == this) BankNotificationService.plugin = null;
    }

    void emitNew(JSONObject item) {
        try {
            notifyListeners("notification", JSObject.fromJSONObject(item));
        } catch (JSONException ignored) {
        }
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(BankNotificationService.PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void status(PluginCall call) {
        Context ctx = getContext();
        boolean enabled = NotificationManagerCompat.getEnabledListenerPackages(ctx).contains(ctx.getPackageName());
        JSObject res = new JSObject();
        res.put("enabled", enabled);
        res.put("sdk", Build.VERSION.SDK_INT);
        res.put("watched", new JSArray(prefs().getStringSet(BankNotificationService.KEY_WATCHED, new HashSet<>())));
        call.resolve(res);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Context ctx = getContext();
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS);
            intent.putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME,
                    new ComponentName(ctx, BankNotificationService.class).flattenToString());
        } else {
            intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            ctx.startActivity(intent);
        } catch (Exception e) {
            Intent fallback = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(fallback);
        }
        call.resolve();
    }

    /** App info screen: on Android 13+ the user may first need "Allow restricted settings" there. */
    @PluginMethod
    public void openAppInfo(PluginCall call) {
        Context ctx = getContext();
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", ctx.getPackageName(), null));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(intent);
        call.resolve();
    }

    /** Apps that have a launcher icon: name and package id. */
    @PluginMethod
    public void listApps(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        Intent main = new Intent(Intent.ACTION_MAIN);
        main.addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> list = pm.queryIntentActivities(main, 0);
        Set<String> seen = new HashSet<>();
        JSArray apps = new JSArray();
        for (ResolveInfo ri : list) {
            String pkg = ri.activityInfo.packageName;
            if (pkg.equals(getContext().getPackageName()) || !seen.add(pkg)) continue;
            JSObject a = new JSObject();
            a.put("pkg", pkg);
            a.put("name", String.valueOf(ri.loadLabel(pm)));
            apps.put(a);
        }
        JSObject res = new JSObject();
        res.put("apps", apps);
        call.resolve(res);
    }

    @PluginMethod
    public void setWatched(PluginCall call) {
        JSArray arr = call.getArray("packages", new JSArray());
        Set<String> set = new HashSet<>();
        for (int i = 0; i < arr.length(); i++) {
            String p = arr.optString(i, null);
            if (p != null && !p.isEmpty()) set.add(p);
        }
        synchronized (BankNotificationService.LOCK) {
            SharedPreferences.Editor ed = prefs().edit().putStringSet(BankNotificationService.KEY_WATCHED, set);
            // Apps that are now tracked are no longer "candidates".
            try {
                JSONObject cands = new JSONObject(prefs().getString(BankNotificationService.KEY_CANDIDATES, "{}"));
                for (String p : set) cands.remove(p);
                ed.putString(BankNotificationService.KEY_CANDIDATES, cands.toString());
            } catch (JSONException ignored) {
            }
            ed.apply();
        }
        call.resolve();
    }

    /** Notifications from tracked apps that the web part has not taken yet. */
    @PluginMethod
    public void getPending(PluginCall call) {
        synchronized (BankNotificationService.LOCK) {
            JSObject res = new JSObject();
            try {
                res.put("items", new JSArray(prefs().getString(BankNotificationService.KEY_QUEUE, "[]")));
            } catch (JSONException e) {
                res.put("items", new JSArray());
            }
            call.resolve(res);
        }
    }

    /** Remove notifications the web part has saved. */
    @PluginMethod
    public void ack(PluginCall call) {
        JSArray ids = call.getArray("ids", new JSArray());
        Set<String> done = new HashSet<>();
        for (int i = 0; i < ids.length(); i++) done.add(ids.optString(i));
        synchronized (BankNotificationService.LOCK) {
            try {
                JSONArray queue = new JSONArray(prefs().getString(BankNotificationService.KEY_QUEUE, "[]"));
                JSONArray keep = new JSONArray();
                for (int i = 0; i < queue.length(); i++) {
                    JSONObject o = queue.getJSONObject(i);
                    if (!done.contains(o.optString("id"))) keep.put(o);
                }
                prefs().edit().putString(BankNotificationService.KEY_QUEUE, keep.toString()).apply();
            } catch (JSONException ignored) {
            }
        }
        call.resolve();
    }

    /** Apps that are not tracked but sent payment-like notifications. */
    @PluginMethod
    public void getCandidates(PluginCall call) {
        synchronized (BankNotificationService.LOCK) {
            JSArray out = new JSArray();
            try {
                JSONObject cands = new JSONObject(prefs().getString(BankNotificationService.KEY_CANDIDATES, "{}"));
                Iterator<String> it = cands.keys();
                while (it.hasNext()) out.put(cands.getJSONObject(it.next()));
            } catch (JSONException ignored) {
            }
            JSObject res = new JSObject();
            res.put("items", out);
            call.resolve(res);
        }
    }

    @PluginMethod
    public void dismissCandidate(PluginCall call) {
        String pkg = call.getString("pkg", "");
        synchronized (BankNotificationService.LOCK) {
            Set<String> dismissed = new HashSet<>(prefs().getStringSet(BankNotificationService.KEY_DISMISSED, new HashSet<>()));
            dismissed.add(pkg);
            SharedPreferences.Editor ed = prefs().edit().putStringSet(BankNotificationService.KEY_DISMISSED, dismissed);
            try {
                JSONObject cands = new JSONObject(prefs().getString(BankNotificationService.KEY_CANDIDATES, "{}"));
                cands.remove(pkg);
                ed.putString(BankNotificationService.KEY_CANDIDATES, cands.toString());
            } catch (JSONException ignored) {
            }
            ed.apply();
        }
        call.resolve();
    }
}
