package shop.gachaz.ctvchat

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/** Hiện thông báo lên thanh thông báo, gộp các tin của cùng một đoạn chat thành một thông báo (như Zalo / Messenger). */
object Notifier {
    private const val MAX_LINES = 6

    fun idOf(tag: String) = tag.hashCode() and 0x7fffffff

    @SuppressLint("MissingPermission")
    fun show(ctx: Context, title: String, body: String, url: String, tag: String, force: Boolean) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val key = tag.ifEmpty { "t" + System.currentTimeMillis() }
        val id = idOf(key)

        // các dòng của thông báo cũ (cùng đoạn chat) còn trên thanh thông báo → nối tiếp
        val lines = ArrayList<CharSequence>()
        if (tag.isNotEmpty() && Build.VERSION.SDK_INT >= 23) {
            try {
                val nm = ctx.getSystemService(NotificationManager::class.java)
                val old = nm?.activeNotifications?.firstOrNull { it.tag == key && it.id == id }
                if (old != null) {
                    val ex = old.notification.extras
                    val prev = ex.getCharSequenceArray(NotificationCompat.EXTRA_TEXT_LINES)
                    if (prev != null) lines.addAll(prev) else ex.getCharSequence(NotificationCompat.EXTRA_TEXT)?.let { lines.add(it) }
                }
            } catch (_: Exception) {
            }
        }
        lines.add(body)
        while (lines.size > MAX_LINES) lines.removeAt(0)

        val open = Intent(ctx, MainActivity::class.java)
            .setAction("shop.gachaz.ctvchat.OPEN." + key)
            .putExtra("url", url)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pi = PendingIntent.getActivity(ctx, id, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        val b = NotificationCompat.Builder(ctx, App.CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_chat)
            .setColor(ContextCompat.getColor(ctx, R.color.accent))
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setShowWhen(true)
            .setWhen(System.currentTimeMillis())
            .setSilent(App.foreground && !force)
        if (lines.size > 1) {
            val st = NotificationCompat.InboxStyle().setSummaryText("${lines.size} tin mới")
            lines.forEach { st.addLine(it) }
            b.setStyle(st).setNumber(lines.size)
        } else {
            b.setStyle(NotificationCompat.BigTextStyle().bigText(body))
        }
        try {
            NotificationManagerCompat.from(ctx).notify(key, id, b.build())
        } catch (_: SecurityException) {
        }
    }

    fun clear(ctx: Context, tag: String) {
        try {
            NotificationManagerCompat.from(ctx).cancel(tag, idOf(tag))
        } catch (_: Exception) {
        }
    }
}
