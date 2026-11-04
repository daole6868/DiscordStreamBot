package shop.gachaz.ctvchat

import android.webkit.CookieManager
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Android gọi vào đây khi máy chủ gửi thông báo — kể cả khi app đã đóng / vuốt tắt. */
class PushService : FirebaseMessagingService() {
    override fun onMessageReceived(msg: RemoteMessage) {
        val d = msg.data
        val n = msg.notification
        Notifier.show(
            this,
            d["title"] ?: n?.title ?: getString(R.string.app_name),
            d["body"] ?: n?.body ?: "",
            d["url"] ?: "/",
            d["tag"] ?: "",
            d["force"] == "1",
        )
    }

    /** Firebase cấp mã thiết bị mới → báo ngay cho máy chủ (dùng phiên đăng nhập của app), không đợi mở app. */
    override fun onNewToken(token: String) {
        MainActivity.deliverToken(token)
        if (!App.prefs(this).getBoolean("pushOn", false)) return
        val server = App.serverUrl(this)
        Thread {
            try {
                val cookie = CookieManager.getInstance().getCookie(server) ?: return@Thread
                val c = URL("$server/api/push/native").openConnection() as HttpURLConnection
                c.requestMethod = "POST"
                c.connectTimeout = 15000
                c.readTimeout = 15000
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.setRequestProperty("X-Requested-With", "ctv")
                c.setRequestProperty("Cookie", cookie)
                c.setRequestProperty("User-Agent", "CTVChatApp/${BuildConfig.VERSION_NAME} (Android)")
                c.outputStream.use { it.write(JSONObject().put("token", token).toString().toByteArray()) }
                c.responseCode
                c.disconnect()
            } catch (_: Exception) {
            }
        }.start()
    }
}
