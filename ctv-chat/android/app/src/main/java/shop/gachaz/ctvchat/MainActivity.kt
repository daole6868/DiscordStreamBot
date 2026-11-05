package shop.gachaz.ctvchat

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.PowerManager
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.Toast
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import java.lang.ref.WeakReference

/**
 * Màn hình chính: giao diện CTV Chat chạy trong WebView riêng của app (không cần Chrome).
 * Phần web nói chuyện với app qua đối tượng JavaScript `CTVNative` (xin quyền thông báo, lấy mã Firebase, mở cài đặt pin…).
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var bar: ProgressBar
    private var fileCb: ValueCallback<Array<Uri>>? = null
    private var pendingDownload: Array<String?>? = null
    @Volatile
    private var pageOk = false
    @Volatile
    private var dead = false

    private val server: Uri get() = Uri.parse(App.serverUrl(this))

    companion object {
        private const val REQ_FILE = 11
        private const val REQ_NOTIF = 12
        private const val REQ_STORAGE = 13
        private var current: WeakReference<MainActivity>? = null

        /** Mã thiết bị Firebase mới → chuyển cho phần web (nếu app đang mở). */
        fun deliverToken(token: String) {
            val a = current?.get() ?: return
            a.runOnUiThread { a.js("window.ctvNativeToken&&ctvNativeToken(${JSONObject.quote(token)},'')") }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        current = WeakReference(this)
        App.initFirebase(this)

        web = WebView(this)
        web.setBackgroundColor(ContextCompat.getColor(this, R.color.bar))
        // thanh tải mỏng ở mép trên (mạng 4G chậm vẫn thấy app đang tải)
        bar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal)
        bar.max = 100
        bar.isIndeterminate = false
        bar.progressTintList = ColorStateList.valueOf(ContextCompat.getColor(this, R.color.accent))
        bar.visibility = View.GONE
        val root = FrameLayout(this)
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        val h = (3 * resources.displayMetrics.density).toInt()
        root.addView(bar, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, h, Gravity.TOP))
        setContentView(root)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            allowFileAccess = false
            allowContentAccess = true
            textZoom = 100
            cacheMode = WebSettings.LOAD_DEFAULT
            userAgentString = "$userAgentString CTVChatApp/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
        web.addJavascriptInterface(Bridge(), "CTVNative")
        web.webViewClient = Client()
        web.webChromeClient = Chrome()
        web.setDownloadListener { url, _, disposition, mime, _ -> download(url, disposition, mime) }

        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) web.loadUrl(startUrl(intent))
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val path = intent.getStringExtra("url") ?: return
        if (pageOk) js("window.ctvNativeOpen?ctvNativeOpen(${JSONObject.quote(path)}):(location.href=${JSONObject.quote(absolute(path))})")
        else web.loadUrl(absolute(path))
    }

    override fun onResume() {
        super.onResume()
        App.foreground = true
        web.onResume()
        js("window.ctvNativeVisible&&ctvNativeVisible(true)")
    }

    override fun onPause() {
        App.foreground = false
        js("window.ctvNativeVisible&&ctvNativeVisible(false)")
        CookieManager.getInstance().flush() // giữ đăng nhập khi Android tắt app
        web.onPause()
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (!dead) web.saveState(outState)
    }

    override fun onDestroy() {
        if (current?.get() === this) current = null
        fileCb?.onReceiveValue(null)
        fileCb = null
        (web.parent as? ViewGroup)?.removeView(web)
        web.destroy()
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // để phần web đóng cửa sổ / khung chat đang mở trước; hết thì đưa app xuống nền (không tắt)
        if (!pageOk) {
            moveTaskToBack(true)
            return
        }
        web.evaluateJavascript("(window.ctvNativeBack&&window.ctvNativeBack())?1:0") { r ->
            if (r != "1") moveTaskToBack(true)
        }
    }

    // ------------------------------------------------------------ đường dẫn
    private fun sameOrigin(u: Uri): Boolean {
        val s = server
        val port = { x: Uri -> if (x.port != -1) x.port else if (x.scheme == "http") 80 else 443 }
        return u.scheme == s.scheme && u.host.equals(s.host, ignoreCase = true) && port(u) == port(s)
    }

    private fun absolute(path: String): String {
        if (path.startsWith("http://") || path.startsWith("https://")) {
            return if (sameOrigin(Uri.parse(path))) path else App.serverUrl(this) + "/"
        }
        return App.serverUrl(this) + (if (path.startsWith("/")) path else "/$path")
    }

    private fun startUrl(i: Intent?): String = absolute(i?.getStringExtra("url") ?: "/")

    fun js(code: String) {
        if (!::web.isInitialized || dead) return
        web.post { if (!dead) web.evaluateJavascript(code, null) }
    }

    private fun toast(t: String) = Toast.makeText(this, t, Toast.LENGTH_LONG).show()

    private fun openExternal(u: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: ActivityNotFoundException) {
            toast("Không có ứng dụng nào mở được liên kết này")
        }
    }

    // ------------------------------------------------------------ trang báo lỗi (mất mạng / sai địa chỉ máy chủ)
    private fun showError(desc: String) {
        pageOk = false
        val esc = { s: String -> s.replace("&", "&amp;").replace("<", "&lt;").replace("\"", "&quot;") }
        val html = """
<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark}body{margin:0;font:15px/1.5 system-ui,sans-serif;background:#f0f2f5;color:#1c1e21;display:flex;min-height:100vh;align-items:center;justify-content:center}
@media(prefers-color-scheme:dark){body{background:#18191a;color:#e4e6eb}.c{background:#242526!important}input{background:#3a3b3c;color:#e4e6eb;border-color:#4e4f50!important}}
.c{background:#fff;border-radius:16px;padding:24px 20px;margin:16px;max-width:380px;width:100%;box-shadow:0 2px 12px rgba(0,0,0,.08)}
h1{font-size:18px;margin:0 0 6px}p{margin:0 0 14px;opacity:.75;font-size:14px}a.b,button{display:block;width:100%;box-sizing:border-box;text-align:center;border:0;border-radius:10px;padding:12px;font:600 15px system-ui;background:#0a7cff;color:#fff;text-decoration:none}
details{margin-top:18px;font-size:14px}summary{opacity:.75}input{width:100%;box-sizing:border-box;padding:11px;border:1px solid #ccd0d5;border-radius:10px;font:15px system-ui;margin:10px 0}
button{background:#e4e6eb;color:#1c1e21}small{opacity:.6;word-break:break-all}
</style></head><body><div class="c">
<h1>Chưa kết nối được máy chủ</h1>
<p>Kiểm tra mạng (Wi‑Fi / 4G) rồi bấm thử lại.</p>
<a class="b" href="ctv-app://retry">Thử lại</a>
<details><summary>Đổi địa chỉ máy chủ</summary>
<form action="ctv-app://server" method="get"><input name="u" inputmode="url" autocapitalize="off" value="${esc(App.serverUrl(this))}"><button>Lưu và kết nối</button></form>
</details>
<p style="margin-top:16px"><small>${esc(desc)}</small></p>
</div></body></html>"""
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
    }

    private fun appLink(u: Uri) {
        when (u.host) {
            "retry" -> web.loadUrl(App.serverUrl(this) + "/")
            "server" -> {
                var s = (u.getQueryParameter("u") ?: "").trim().trimEnd('/')
                if (s.isNotEmpty() && !s.startsWith("http")) s = "https://$s"
                val p = Uri.parse(s)
                if (p.host.isNullOrEmpty() || (p.scheme != "https" && p.scheme != "http")) {
                    toast("Địa chỉ không hợp lệ")
                    return
                }
                // app chỉ kết nối qua https (mã hoá) — http:// bị Android chặn
                if (p.scheme != "https") {
                    toast("Cần địa chỉ https://, ví dụ https://ctv.gachaz.shop")
                    return
                }
                App.prefs(this).edit().putString("server", "${p.scheme}://${p.encodedAuthority}").apply()
                web.loadUrl(App.serverUrl(this) + "/")
            }
        }
    }

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
            val u = req.url
            if (u.scheme == "ctv-app") {
                appLink(u)
                return true
            }
            if (sameOrigin(u)) {
                // ảnh mở trong tab mới → tải về máy thay vì rời khỏi app
                if (u.path?.startsWith("/uploads/") == true) {
                    download(u.toString(), null, null)
                    return true
                }
                return false
            }
            openExternal(u)
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            if (url != null && url.startsWith("http")) pageOk = sameOrigin(Uri.parse(url))
        }

        override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
            if (req.isForMainFrame) showError("${err.description} (${req.url.host})")
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            dead = true
            recreate()
            return true
        }
    }

    // ------------------------------------------------------------ chọn ảnh để gửi
    private inner class Chrome : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) {
            bar.progress = newProgress
            bar.visibility = if (newProgress < 100) View.VISIBLE else View.GONE
        }

        override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCb?.onReceiveValue(null)
            fileCb = cb
            val i = params.createIntent()
            if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            return try {
                startActivityForResult(Intent.createChooser(i, "Chọn ảnh"), REQ_FILE)
                true
            } catch (_: ActivityNotFoundException) {
                fileCb = null
                false
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_FILE) return
        val cb = fileCb ?: return
        fileCb = null
        if (resultCode != Activity.RESULT_OK || data == null) {
            cb.onReceiveValue(null)
            return
        }
        val clip = data.clipData
        val uris: Array<Uri>? = if (clip != null && clip.itemCount > 0) Array(clip.itemCount) { clip.getItemAt(it).uri }
        else data.data?.let { arrayOf(it) }
        cb.onReceiveValue(uris)
    }

    // ------------------------------------------------------------ tải file (Excel, sao lưu, ảnh) — giữ phiên đăng nhập
    private fun download(url: String, disposition: String?, mime: String?) {
        if (Build.VERSION.SDK_INT < 29 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED
        ) {
            pendingDownload = arrayOf(url, disposition, mime)
            requestPermissions(arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE), REQ_STORAGE)
            return
        }
        try {
            val name = URLUtil.guessFileName(url, disposition, mime)
            val r = DownloadManager.Request(Uri.parse(url))
                .addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url) ?: "")
                .addRequestHeader("User-Agent", web.settings.userAgentString)
                .setTitle(name)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
            if (!mime.isNullOrEmpty()) r.setMimeType(mime)
            (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(r)
            toast("Đang tải về thư mục Download: $name")
        } catch (e: Exception) {
            toast("Không tải được: ${e.message}")
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, results)
        val ok = results.isNotEmpty() && results[0] == PackageManager.PERMISSION_GRANTED
        when (requestCode) {
            REQ_NOTIF -> js("window.ctvNativePerm&&ctvNativePerm('${if (ok && notifEnabled()) "granted" else "denied"}')")
            REQ_STORAGE -> {
                val p = pendingDownload
                pendingDownload = null
                if (ok && p != null) download(p[0]!!, p[1], p[2]) else if (!ok) toast("Cần quyền bộ nhớ để lưu file")
            }
        }
    }

    // ------------------------------------------------------------ quyền thông báo / chạy nền
    private fun notifEnabled() = NotificationManagerCompat.from(this).areNotificationsEnabled()

    private fun notifPermission(): String {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            val asked = App.prefs(this).getBoolean("askedNotif", false)
            return if (asked && !shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)) "denied" else "default"
        }
        return if (notifEnabled()) "granted" else "denied"
    }

    private fun tryStart(vararg intents: Intent): Boolean {
        for (i in intents) {
            try {
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivity(i)
                return true
            } catch (_: Exception) {
            }
        }
        return false
    }

    private fun appDetails() = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))

    private fun notifSettings(): Intent =
        if (Build.VERSION.SDK_INT >= 26) Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
        else appDetails()

    private fun component(pkg: String, cls: String) = Intent().setComponent(ComponentName(pkg, cls))

    /** Màn hình "Tự khởi động / Chạy nền" của từng hãng (Oppo, Realme, Xiaomi, Vivo, Huawei…); không có thì mở trang thông tin app. */
    private fun autostartIntents(): Array<Intent> = arrayOf(
        component("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
        component("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"),
        component("com.oplus.safecenter", "com.oplus.safecenter.permission.startup.StartupAppListActivity"),
        component("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"),
        component("com.coloros.oppoguardelf", "com.coloros.powermanager.fuelgaue.PowerUsageModelActivity"),
        component("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
        component("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
        component("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"),
        component("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
        component("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"),
        component("com.asus.mobilemanager", "com.asus.mobilemanager.autostart.AutoStartActivity"),
        component("com.letv.android.letvsafe", "com.letv.android.letvsafe.AutobootManageActivity"),
        appDetails(),
    )

    /** Các hàm phần web gọi được: window.CTVNative.xxx() */
    private inner class Bridge {
        private fun allowed(): Boolean = pageOk

        @JavascriptInterface
        fun version(): String = BuildConfig.VERSION_NAME

        @JavascriptInterface
        fun brand(): String = Build.MANUFACTURER ?: ""

        @JavascriptInterface
        fun androidVersion(): Int = Build.VERSION.SDK_INT

        @JavascriptInterface
        fun setup(json: String): String = if (allowed()) App.saveFirebase(this@MainActivity, json) else "error:origin"

        @JavascriptInterface
        fun permission(): String = notifPermission()

        @JavascriptInterface
        fun requestPermission() {
            runOnUiThread {
                when (notifPermission()) {
                    "granted" -> js("window.ctvNativePerm&&ctvNativePerm('granted')")
                    "default" -> {
                        if (Build.VERSION.SDK_INT >= 33) {
                            App.prefs(this@MainActivity).edit().putBoolean("askedNotif", true).apply()
                            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIF)
                        } else {
                            tryStart(notifSettings(), appDetails())
                            js("window.ctvNativePerm&&ctvNativePerm('denied')")
                        }
                    }
                    else -> {
                        // đã từ chối hẳn → mở cài đặt thông báo của app để bật tay
                        tryStart(notifSettings(), appDetails())
                        js("window.ctvNativePerm&&ctvNativePerm('denied')")
                    }
                }
            }
        }

        @JavascriptInterface
        fun getToken() {
            if (!allowed()) return
            runOnUiThread {
                if (!App.initFirebase(this@MainActivity)) {
                    js("window.ctvNativeToken&&ctvNativeToken('','Chưa có cấu hình Firebase')")
                    return@runOnUiThread
                }
                try {
                    FirebaseMessaging.getInstance().token.addOnCompleteListener { t ->
                        if (t.isSuccessful && !t.result.isNullOrEmpty()) {
                            js("window.ctvNativeToken&&ctvNativeToken(${JSONObject.quote(t.result)},'')")
                        } else {
                            val e = t.exception?.message ?: "Không lấy được mã thiết bị"
                            js("window.ctvNativeToken&&ctvNativeToken('',${JSONObject.quote(e)})")
                        }
                    }
                } catch (e: Exception) {
                    js("window.ctvNativeToken&&ctvNativeToken('',${JSONObject.quote(e.message ?: "lỗi Firebase")})")
                }
            }
        }

        /** Phần web báo đã bật / tắt thông báo (để app tự báo mã mới cho máy chủ khi Firebase đổi mã). */
        @JavascriptInterface
        fun setPushOn(on: Boolean) {
            App.prefs(this@MainActivity).edit().putBoolean("pushOn", on).apply()
        }

        @JavascriptInterface
        fun batteryOk(): Boolean {
            if (Build.VERSION.SDK_INT < 23) return true
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            return pm.isIgnoringBatteryOptimizations(packageName)
        }

        @SuppressLint("BatteryLife")
        @JavascriptInterface
        fun openBattery() {
            runOnUiThread {
                if (Build.VERSION.SDK_INT >= 23 && !batteryOk()) {
                    if (tryStart(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))) return@runOnUiThread
                }
                if (Build.VERSION.SDK_INT >= 23) tryStart(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS), appDetails())
                else tryStart(appDetails())
            }
        }

        @JavascriptInterface
        fun openAutostart() {
            runOnUiThread { tryStart(*autostartIntents()) }
        }

        @JavascriptInterface
        fun openAppSettings() {
            runOnUiThread { tryStart(appDetails()) }
        }

        @JavascriptInterface
        fun openNotifSettings() {
            runOnUiThread { tryStart(notifSettings(), appDetails()) }
        }

        @JavascriptInterface
        fun copy(text: String) {
            runOnUiThread {
                val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                cm.setPrimaryClip(ClipData.newPlainText("CTV Chat", text))
            }
        }

        @JavascriptInterface
        fun clearNotif(tag: String) {
            Notifier.clear(this@MainActivity, tag)
        }

        @JavascriptInterface
        fun openExternal(url: String) {
            runOnUiThread { this@MainActivity.openExternal(Uri.parse(url)) }
        }
    }
}
