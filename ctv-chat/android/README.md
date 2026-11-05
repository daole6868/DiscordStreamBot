# App Android CTV Chat

App Android thật: giao diện CTV Chat chạy trong WebView riêng của app (không cần Chrome), thông báo qua Firebase Cloud Messaging. Thông báo vẫn đến khi đã vuốt tắt app.

## Cài trên điện thoại
1. Mở link `https://github.com/daole6868/DiscordStreamBot/releases/latest/download/CTV-Chat.apk` trên điện thoại Android.
2. Mở file vừa tải → **Cài đặt**. Máy hỏi thì cho phép cài ứng dụng không rõ nguồn gốc. Play Protect cảnh báo thì bấm **Chi tiết → Vẫn cài đặt**.
3. Mở **CTV Chat** → đăng nhập → **Cho phép** thông báo.
4. **Tài khoản** → **Cho chạy nền** và **Tự khởi động**. Oppo / Realme / OnePlus: thêm Cài đặt → Ứng dụng → CTV Chat → Sử dụng pin → bật **Cho phép hoạt động nền** và **Cho phép tự khởi chạy**.

## Đóng gói
- GitHub Actions (`.github/workflows/ctv-chat-android.yml`) đóng gói rồi đăng file `CTV-Chat.apk` lên mục **Releases**. Chạy bằng tay: tab **Actions → CTV Chat — app Android → Run workflow**, chọn nhánh `claude/determined-franklin-77acow`. Khoảng 3 phút.
- Link tải luôn trỏ tới bản mới nhất: `https://github.com/daole6868/DiscordStreamBot/releases/latest/download/CTV-Chat.apk`
- Đóng gói trên máy (cần Android SDK, JDK 17, Gradle 8.7+): `gradle assembleRelease -PserverUrl=https://ctv.gachaz.shop`. Không có khoá ký thì app được ký bằng khoá debug.

## Khoá ký
Khoá **không** nằm trong kho code. Thêm 2 secret trong **Settings → Secrets and variables → Actions**:
- `CTV_KEYSTORE_B64`: file khoá .p12, mã hoá base64
- `CTV_KEYSTORE_PASSWORD`: mật khẩu khoá

Có 2 secret này thì mọi bản ký cùng một khoá, cài đè lên bản cũ được. Chưa có thì mỗi bản ký bằng khoá tạm, muốn lên bản mới phải gỡ app cũ trước.

## Máy chủ
- Mặc định `https://ctv.gachaz.shop`. Đổi khi đóng gói bằng biến kho `CTV_SERVER_URL`, hoặc ngay trong app ở màn hình "Chưa kết nối được máy chủ".
- Cấu hình Firebase do máy chủ gửi về (`/api/app/config`), nên không cần đóng gói `google-services.json` vào app. Admin tải 2 file Firebase lên trong **Cài đặt → App Android & thông báo**.

## Cấu trúc
- `App.kt`: bật Firebase từ cấu hình đã lưu, tạo kênh thông báo
- `MainActivity.kt`: WebView, cầu nối JavaScript `CTVNative` (quyền thông báo, mã Firebase, cài đặt pin / tự khởi động, nút Quay lại, chọn ảnh, tải file)
- `PushService.kt`: nhận tin từ Firebase, báo mã thiết bị mới cho máy chủ
- `Notifier.kt`: hiện thông báo, gộp các tin cùng một đoạn chat
