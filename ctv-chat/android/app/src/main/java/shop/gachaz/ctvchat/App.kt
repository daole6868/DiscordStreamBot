package shop.gachaz.ctvchat

import android.app.Application
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import org.json.JSONObject

/**
 * Khởi động trước mọi thứ khác — kể cả khi app đã bị tắt hẳn và chỉ được Android đánh thức để nhận thông báo.
 * Firebase được bật bằng cấu hình máy chủ gửi về (lưu lại trong máy), nên không cần đóng gói google-services.json vào app.
 */
class App : Application() {
    override fun onCreate() {
        super.onCreate()
        createChannel(this)
        initFirebase(this)
    }

    companion object {
        const val CHANNEL = "tin-nhan"

        /** App đang hiện trên màn hình (để thông báo đến lúc đó không kêu to). */
        @Volatile
        var foreground = false

        fun prefs(ctx: Context): SharedPreferences = ctx.getSharedPreferences("ctv", Context.MODE_PRIVATE)

        fun serverUrl(ctx: Context): String {
            val saved = prefs(ctx).getString("server", null)
            return (if (saved.isNullOrBlank()) BuildConfig.SERVER_URL else saved).trimEnd('/')
        }

        fun createChannel(ctx: Context) {
            if (Build.VERSION.SDK_INT < 26) return
            val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
            val ch = NotificationChannel(CHANNEL, ctx.getString(R.string.channel_name), NotificationManager.IMPORTANCE_HIGH)
            ch.description = ctx.getString(R.string.channel_desc)
            ch.enableVibration(true)
            ch.vibrationPattern = longArrayOf(0, 180, 90, 180)
            ch.enableLights(true)
            ch.lightColor = 0xFF0A7CFF.toInt()
            ch.lockscreenVisibility = Notification.VISIBILITY_PRIVATE
            ch.setShowBadge(true)
            nm.createNotificationChannel(ch)
        }

        private fun options(raw: String): FirebaseOptions {
            val j = JSONObject(raw)
            return FirebaseOptions.Builder()
                .setApiKey(j.getString("apiKey"))
                .setApplicationId(j.getString("appId"))
                .setProjectId(j.getString("projectId"))
                .setGcmSenderId(j.getString("senderId"))
                .build()
        }

        fun firebaseReady(ctx: Context): Boolean = FirebaseApp.getApps(ctx).isNotEmpty()

        /** Bật Firebase từ cấu hình đã lưu. Trả về true nếu đã sẵn sàng. */
        fun initFirebase(ctx: Context): Boolean {
            if (firebaseReady(ctx)) return true
            val raw = prefs(ctx).getString("fcm", null) ?: return false
            return try {
                FirebaseApp.initializeApp(ctx, options(raw))
                true
            } catch (e: Exception) {
                false
            }
        }

        /**
         * Lưu cấu hình Firebase máy chủ gửi về.
         * "ok" = dùng được ngay; "restart" = máy chủ đổi sang dự án Firebase khác, cần mở lại app; "error:…" = cấu hình sai.
         */
        fun saveFirebase(ctx: Context, raw: String): String {
            return try {
                options(raw) // kiểm tra đủ trường
                val old = prefs(ctx).getString("fcm", null)
                if (old != null && JSONObject(old).optString("appId") == JSONObject(raw).optString("appId") && firebaseReady(ctx)) return "ok"
                prefs(ctx).edit().putString("fcm", raw).commit()
                if (firebaseReady(ctx)) "restart" else if (initFirebase(ctx)) "ok" else "error:init"
            } catch (e: Exception) {
                "error:" + (e.message ?: "cấu hình Firebase không hợp lệ")
            }
        }
    }
}
