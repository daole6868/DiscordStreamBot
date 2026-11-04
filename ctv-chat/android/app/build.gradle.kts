// App Android của CTV Chat: giao diện web chạy trong WebView riêng (không cần Chrome) + thông báo qua Firebase (FCM).
// Đóng gói:  gradle assembleRelease -PserverUrl=https://ctv.gachaz.shop -PversionCode=2
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val serverUrl = (project.findProperty("serverUrl") as String?) ?: "https://ctv.gachaz.shop"
val vCode = ((project.findProperty("versionCode") as String?) ?: "1").toInt()

android {
    namespace = "shop.gachaz.ctvchat"
    compileSdk = 34

    defaultConfig {
        applicationId = "shop.gachaz.ctvchat"
        minSdk = 24
        targetSdk = 34
        versionCode = vCode
        versionName = "1.0.$vCode"
        buildConfigField("String", "SERVER_URL", "\"${serverUrl.trimEnd('/')}\"")
    }
    buildFeatures { buildConfig = true }

    // Khoá ký: đường dẫn trong biến CTV_KEYSTORE (GitHub Actions đặt sẵn). Khoá KHÔNG nằm trong kho code.
    // Không có khoá (đóng gói thử trên máy) → ký bằng khoá debug.
    val ks = System.getenv("CTV_KEYSTORE")?.let { file(it) }?.takeIf { it.exists() }
    signingConfigs {
        if (ks != null) create("release") {
            storeFile = ks
            storePassword = System.getenv("CTV_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("CTV_KEY_ALIAS") ?: "ctvchat"
            keyPassword = System.getenv("CTV_KEY_PASSWORD") ?: System.getenv("CTV_KEYSTORE_PASSWORD")
            storeType = "pkcs12"
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName(if (ks != null) "release" else "debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation(platform("com.google.firebase:firebase-bom:33.3.0"))
    implementation("com.google.firebase:firebase-messaging")
}
