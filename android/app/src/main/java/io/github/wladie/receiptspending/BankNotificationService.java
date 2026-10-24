package io.github.wladie.receiptspending;

import android.app.Notification;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Listens to notifications on the device.
 * - From apps the user chose to track: stores the notification text in a local queue
 *   so the app can turn it into an expense (even if the app was closed).
 * - From other apps: only notes that the app sends payment-like messages, so the user
 *   can be offered to track it. Nothing leaves the device.
 */
public class BankNotificationService extends NotificationListenerService {

    static final String PREFS = "bank_notifications";
    static final String KEY_WATCHED = "watched";
    static final String KEY_QUEUE = "queue";
    static final String KEY_CANDIDATES = "candidates";
    static final String KEY_DISMISSED = "dismissed";
    static final String KEY_RECENT = "recent";
    private static final int MAX_QUEUE = 500;
    private static final int MAX_RECENT = 300;

    // An amount with a currency next to it, e.g. "23.40 GEL", "₽ 1 250,00", "$12".
    private static final String CUR = "(₾|₽|€|\\$|£|₸|₴|֏|₼|₺|zł|₪|฿|GEL|USD|EUR|RUB|KZT|UAH|AMD|AZN|BYN|UZS|KGS|TRY|PLN|GBP|ILS|AED|THB|RSD|лари|руб\\.?|р\\.|сум|сом|тг)";
    private static final String NUM = "\\d[\\d\\s\\u00a0]*(?:[.,]\\d{1,2})?";
    static final Pattern MONEY = Pattern.compile(
            "(?iu)(" + NUM + "\\s?" + CUR + "|" + CUR + "\\s?" + NUM + ")");
    static final Pattern PAYMENT_WORDS = Pattern.compile(
            "(?iu)(покупк|оплат|списан|платеж|платёж|перевод|зачислен|поступлен|пополнен|баланс|карт|card|purchase|payment|paid|debit|credit|transfer|balance|transaction|spent|withdraw|снят)");

    static final Object LOCK = new Object();
    static volatile BankNotificationsPlugin plugin;

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            handle(sbn);
        } catch (Exception ignored) {
            // Never crash the listener on an unusual notification.
        }
    }

    private void handle(StatusBarNotification sbn) throws JSONException {
        String pkg = sbn.getPackageName();
        if (pkg == null || pkg.equals(getPackageName()) || pkg.equals("android") || pkg.equals("com.android.systemui")) return;
        Notification n = sbn.getNotification();
        if (n == null || (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
        Bundle ex = n.extras;
        if (ex == null) return;
        String title = str(ex.getCharSequence(Notification.EXTRA_TITLE));
        String text = str(ex.getCharSequence(Notification.EXTRA_TEXT));
        String big = str(ex.getCharSequence(Notification.EXTRA_BIG_TEXT));
        if (big.length() > text.length()) text = big;
        if (text.isEmpty() && title.isEmpty()) return;
        String all = title + "\n" + text;

        SharedPreferences prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        synchronized (LOCK) {
            Set<String> watched = prefs.getStringSet(KEY_WATCHED, new HashSet<>());
            boolean looksLikePayment = MONEY.matcher(all).find();
            if (!looksLikePayment) return;

            // The same notification is often re-posted when updated: keep one copy.
            String fingerprint = pkg + "|" + all.hashCode();
            JSONArray recent = new JSONArray(prefs.getString(KEY_RECENT, "[]"));
            for (int i = 0; i < recent.length(); i++) if (fingerprint.equals(recent.optString(i))) return;
            recent.put(fingerprint);
            while (recent.length() > MAX_RECENT) recent.remove(0);
            SharedPreferences.Editor ed = prefs.edit().putString(KEY_RECENT, recent.toString());

            String appName = appLabel(pkg);
            if (watched.contains(pkg)) {
                JSONObject item = new JSONObject();
                item.put("id", pkg + ":" + sbn.getPostTime() + ":" + Math.abs(all.hashCode()));
                item.put("pkg", pkg);
                item.put("app", appName);
                item.put("title", title);
                item.put("text", text);
                item.put("time", sbn.getPostTime());
                JSONArray queue = new JSONArray(prefs.getString(KEY_QUEUE, "[]"));
                queue.put(item);
                while (queue.length() > MAX_QUEUE) queue.remove(0);
                ed.putString(KEY_QUEUE, queue.toString());
                ed.apply();
                BankNotificationsPlugin p = plugin;
                if (p != null) p.emitNew(item);
                return;
            }

            Set<String> dismissed = prefs.getStringSet(KEY_DISMISSED, new HashSet<>());
            if (!dismissed.contains(pkg) && PAYMENT_WORDS.matcher(all).find()) {
                JSONObject cands = new JSONObject(prefs.getString(KEY_CANDIDATES, "{}"));
                JSONObject c = cands.optJSONObject(pkg);
                if (c == null) c = new JSONObject();
                c.put("pkg", pkg);
                c.put("app", appName);
                c.put("count", c.optInt("count", 0) + 1);
                c.put("sample", (title.isEmpty() ? "" : title + ": ") + text);
                c.put("time", sbn.getPostTime());
                cands.put(pkg, c);
                // Keep the list small.
                if (cands.length() > 30) {
                    String oldest = null; long t = Long.MAX_VALUE;
                    Iterator<String> it = cands.keys();
                    while (it.hasNext()) { String k = it.next(); long tt = cands.getJSONObject(k).optLong("time"); if (tt < t) { t = tt; oldest = k; } }
                    if (oldest != null) cands.remove(oldest);
                }
                ed.putString(KEY_CANDIDATES, cands.toString());
            }
            ed.apply();
        }
    }

    private String appLabel(String pkg) {
        try {
            PackageManager pm = getPackageManager();
            ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
            return String.valueOf(pm.getApplicationLabel(ai));
        } catch (Exception e) {
            return pkg;
        }
    }

    private static String str(CharSequence cs) {
        return cs == null ? "" : cs.toString().trim();
    }
}
