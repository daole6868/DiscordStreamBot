# CTV Chat — Nhắn tin nội bộ, giao đơn cho CTV, doanh thu, sao lưu tự động

App nhắn tin nội bộ giao diện giống Messenger, dành cho nhóm khoảng 20–100 người:

- **Admin** (người tạo app, đăng ký bằng Gmail) có quyền cao nhất và **duyệt** mọi thành viên mới.
- Admin **lên đơn ngay trong tin nhắn** với CTV: nhập nội dung, tiền công, hạn chót.
- Dưới mỗi đơn có 3 nút cho CTV: **Done** · **Ảnh** · **Ghi chú**. Done và Ảnh bắt buộc (phải gửi ảnh thì mới bấm được Done); Ghi chú tuỳ chọn.
- **Doanh thu** của từng CTV theo **Tuần / Tháng / Năm**. Chỉ tính đơn khi CTV đã bấm Done.
- **Lịch sử** mọi thao tác. Admin xem tất cả, CTV chỉ xem của mình.
- **Sao lưu tự động** và khôi phục bằng một nút bấm.

Không cần cài thư viện, không cần internet. Chỉ cần **Node.js**.

---

## 1. Cách chạy

1. Cài **Node.js bản LTS** tại <https://nodejs.org>. Cần bản **22.13 trở lên**; bản LTS hiện tại đều đạt.
2. Giải nén zip ra một thư mục cố định, ví dụ `D:\ctv-chat`. **Đừng để trong thư mục Downloads/Temp.**
3. Windows: bấm đúp **`CHAY-WINDOWS.bat`**. macOS: bấm đúp `CHAY-MAC.command`. Cách khác: mở terminal trong thư mục và gõ `npm start`.
4. Trình duyệt tự mở **http://localhost:3000**. Người đầu tiên đăng ký sẽ trở thành **Admin**.

> Giữ cửa sổ đen mở trong lúc mọi người dùng app. Đóng cửa sổ = tắt app (dữ liệu vẫn được giữ nguyên).

### CTV vào app bằng cách nào?

| Trường hợp | Cách làm |
|---|---|
| Cùng mạng Wi-Fi / LAN với máy chạy app | Cửa sổ đen hiện dòng `Máy khác cùng mạng: http://192.168.x.x:3000`. Gửi link đó cho CTV. Nếu Windows hỏi tường lửa, chọn **Allow**. |
| CTV ở xa, dùng 4G — **và để có thông báo trên điện thoại** | Cần địa chỉ **https://**. Xem mục **1b** bên dưới (miễn phí, khoảng 10 phút). |

Trên điện thoại, mở link bằng Chrome/Safari rồi chọn **"Thêm vào màn hình chính"** để dùng như một app.

### 1b. Địa chỉ https:// — để CTV dùng 4G và nhận thông báo trên điện thoại

Điện thoại (Android lẫn iPhone) **chỉ cho phép thông báo** khi app được mở bằng địa chỉ `https://`. Link `http://192.168…:3000` chỉ dùng được trong cùng Wi-Fi và **không có thông báo**.

> **Có VPS + tên miền? Dùng mục 1c (khuyên dùng)**: app chạy 24/7, không cần để máy ở nhà luôn bật. Các cách dưới đây dành cho khi chạy app trên máy tính ở nhà.

**Cách A — Tailscale Funnel (miễn phí, không cần tên miền)**
1. Trên máy chạy app: cài **Tailscale** tại <https://tailscale.com/download> và đăng nhập (bằng Google cũng được).
2. Mở **Command Prompt** (cmd) và gõ: `tailscale funnel --bg 3000`
   Lần đầu, nó in ra một link để bật HTTPS / Funnel cho tài khoản → mở link, bấm đồng ý, rồi gõ lại lệnh trên.
3. Lệnh in ra địa chỉ dạng **`https://ten-may.ten-ban.ts.net`**. Đó là địa chỉ của app: gửi cho CTV, ai ở đâu cũng vào được.
4. Địa chỉ này **cố định**, tự chạy lại khi khởi động máy. Muốn tắt: `tailscale funnel --bg off`.

**Cách B — Cloudflare Tunnel (cần một tên miền, khoảng 250k/năm)**: địa chỉ đẹp dạng `https://chat.tenmien.com`. Làm theo hướng dẫn “Cloudflare Tunnel” trên trang Cloudflare (Zero Trust → Networks → Tunnels → Create tunnel), trỏ tới `http://localhost:3000`.

> Máy chạy app vẫn phải bật và có Internet. Dữ liệu vẫn nằm trên máy của bạn, Tailscale / Cloudflare chỉ chuyển tiếp kết nối có mã hoá.

### 1c. Chạy trên VPS với tên miền riêng (khuyên dùng)

Cần: VPS **Ubuntu 22.04 / 24.04** hoặc **Debian 11 / 12** (1 GB RAM là đủ cho 20–100 người), một tên miền, và cổng **80, 443** không bị chặn.

**Bước 1. Trỏ tên miền về VPS.** Vào trang quản lý tên miền (Tenten, Mắt Bão, PA, iNET, Cloudflare…) → tạo bản ghi **A**: tên `chat` → **IP của VPS**. Sau vài phút, `chat.tenmien.com` sẽ trỏ về VPS. Nếu dùng Cloudflare, để đám mây màu **xám (DNS only)**.

**Bước 2. Đưa app lên VPS** — chọn **2a (GitHub, khuyên dùng: cập nhật bằng 1 lệnh)** hoặc **2b (file zip)**.

**2a. Lấy thẳng từ GitHub** (kho `daole6868/DiscordStreamBot` đang để công khai). Trên VPS:
```
sudo apt-get update && sudo apt-get install -y git
git clone --depth 1 --filter=blob:none --sparse -b claude/determined-franklin-77acow https://github.com/daole6868/DiscordStreamBot.git ctv-src
cd ctv-src && git sparse-checkout set ctv-chat && cd ctv-chat
sudo bash deploy/cai-dat-vps.sh chat.tenmien.com
```
Nếu sau này để kho ở chế độ riêng tư (private), VPS cần một deploy key (chìa khoá chỉ đọc): GitHub → Settings → Deploy keys.
(bỏ qua bước 3 bên dưới). Sau này **cập nhật chỉ cần**: `sudo ctv-chat cap-nhat`.

**2b. File zip.** Dùng **WinSCP** (kéo thả file) hoặc trên Windows mở PowerShell:
```
scp ctv-chat.zip root@IP_CUA_VPS:/root/
```
Nếu **đã dùng app trên máy tính** và muốn giữ dữ liệu: tắt app trên máy tính, rồi tải luôn thư mục **`data`** của máy tính lên VPS. Đặt nó vào trong thư mục `ctv-chat` sau khi giải nén ở bước 3 (thành `ctv-chat/data`). Lệnh cài sẽ tự chuyển dữ liệu.

**Bước 3. Cài (một lệnh).** Đăng nhập VPS (`ssh root@IP_CUA_VPS` hoặc bảng điều khiển web của nhà cung cấp) rồi gõ:
```
apt-get update && apt-get install -y unzip
unzip -o ctv-chat.zip
cd ctv-chat
sudo bash deploy/cai-dat-vps.sh chat.tenmien.com
```
Lệnh này tự làm hết:
- cài Node.js;
- chạy app như một dịch vụ: tự chạy lại khi lỗi và khi khởi động lại VPS;
- cài **Caddy**: tự lấy và tự gia hạn chứng chỉ **HTTPS miễn phí** cho tên miền;
- mở tường lửa;
- kiểm tra tên miền đã trỏ đúng chưa.

Xong sẽ hiện **“XONG! Mở app tại: https://chat.tenmien.com”**.

**Bước 4.** Mở `https://chat.tenmien.com`. Nếu là dữ liệu mới, người đăng ký đầu tiên là Admin. Gửi link cho CTV. Mỗi người bật thông báo theo mục “Thông báo trên điện thoại” bên dưới.

**Cập nhật bản mới:** nếu cài từ GitHub (2a) thì chỉ cần `sudo ctv-chat cap-nhat`. Nếu cài bằng zip: tải `ctv-chat.zip` mới lên VPS, rồi chạy lại đúng lệnh cài:
```
unzip -o ctv-chat.zip && cd ctv-chat && sudo bash deploy/cai-dat-vps.sh chat.tenmien.com
```
Dữ liệu nằm riêng ở `/var/lib/ctv-chat` nên **không bị mất** khi cập nhật.

**Lệnh hay dùng trên VPS:**

| Lệnh | Để làm gì |
|---|---|
| `sudo ctv-chat cap-nhat` | Cập nhật bản mới từ GitHub rồi cài lại (dữ liệu giữ nguyên) |
| `sudo ctv-chat trang-thai` | Xem app có đang chạy không |
| `sudo ctv-chat nhat-ky` | Xem nhật ký / lỗi (Ctrl+C để thoát) |
| `sudo ctv-chat khoi-dong-lai` | Khởi động lại app |
| `sudo ctv-chat dat-lai-mat-khau ten@gmail.com MatKhauMoi` | Đặt lại mật khẩu (kể cả admin gốc) |

- **Sao lưu:** bản tự động nằm ở `/var/lib/ctv-chat/backups`, ngay trên VPS. Thỉnh thoảng nên vào **Cài đặt → tải về** một bản để giữ trên máy tính, hoặc bật tính năng chụp ảnh ổ đĩa (snapshot) của nhà cung cấp VPS. Ô “Thư mục sao lưu phụ” chỉ dùng khi VPS có gắn thêm ổ đĩa khác (không dùng thư mục trong `/home` hay `/root`).
- **VPS đang chạy web khác bằng Nginx** (ví dụ web cửa hàng ở `gachaz.shop`): lệnh cài **tự thêm một trang riêng** cho tên miền của app vào Nginx và tự lấy HTTPS bằng certbot. Cấu hình của web cũ giữ nguyên. Nếu Nginx báo lỗi, lệnh cài tự gỡ trang mới ra, web cũ không bị ảnh hưởng. Đã dùng Caddy thì lệnh cài tự thêm vào Caddyfile.
- **Hai dự án trên cùng một VPS:** dùng tên miền con, ví dụ `ctv.gachaz.shop`. Chỉ cần thêm bản ghi A `ctv` trỏ về **cùng IP VPS**, không cần đổi `gachaz.shop`.
- **Cổng 3000 đã có chương trình khác dùng:** chạy `sudo PORT=3005 bash deploy/cai-dat-vps.sh chat.tenmien.com`.
- Trên VPS, app chỉ nhận kết nối qua `https://chat.tenmien.com`. Không vào thẳng bằng IP:3000 được, như vậy an toàn hơn.

### Thông báo trên điện thoại (như Zalo / Messenger)

1. Mở app bằng địa chỉ **https://** (mục 1b hoặc 1c).
   - **iPhone:** bấm nút **Chia sẻ ⬆ → Thêm vào MH chính**, rồi mở app từ biểu tượng đó (cần iOS 16.4 trở lên). Safari thường không hiện thông báo được.
   - **Android:** dùng Chrome, nên “Thêm vào màn hình chính” cho giống app.
2. Bấm **Bật** trên thanh xanh ở danh sách chat (hoặc **Tài khoản → Thông báo trên điện thoại → Bật**), rồi chọn **Cho phép**. Bấm **Gửi thử** để kiểm tra.
3. Mỗi máy bật một lần. Một người có thể bật trên nhiều máy (điện thoại + máy tính). Đăng xuất là tắt thông báo trên máy đó.

**Khi nào có thông báo:**

| Việc | Ai nhận |
|---|---|
| Tin nhắn riêng | Người nhận |
| Admin lên đơn, sửa đơn, mở lại / xoá đơn | CTV của đơn đó |
| CTV bấm Done | Admin |
| Kết toán lương, admin bấm “Đã thanh toán” | CTV đó |
| Tin trong **nhóm** | Chỉ người được **@nhắc tên**, hoặc **cả nhóm khi admin gõ @all** |

- Ai muốn nhận **mọi tin trong nhóm** thì vào Tài khoản → tick “Báo mọi tin nhắn trong nhóm”.
- Đang mở app trên màn hình thì không hiện thông báo trùng, chỉ có tiếng báo trong app.
- Bấm vào thông báo sẽ mở đúng đoạn chat đó.

### Nhắc tên trong nhóm (@)

- Trong nhóm, gõ **@** rồi chọn người trong danh sách (gõ thêm vài chữ để lọc, có dấu hay không dấu đều được). Người được nhắc sẽ nhận thông báo, thấy tên mình **tô vàng** trong tin và dấu **@** cam ở danh sách chat.
- **Admin** có thêm **@all**: báo cho **tất cả** mọi người trong nhóm. CTV không dùng được @all.

Giao diện điện thoại: thanh dưới có **Đoạn chat · Đơn hàng · Doanh thu · Kết toán · Thêm**. Nút **Thêm** mở Lịch sử, Thành viên, Cài đặt và Tài khoản. Các bảng tự chuyển thành danh sách gọn, không phải kéo ngang.

**Trả lời một tin nhắn cũ** (giống Zalo):
- Điện thoại: **vuốt ngang** tin nhắn hoặc thẻ đơn sang trái/phải. Hoặc **giữ lâu** để mở menu Trả lời / Sao chép / Thu hồi.
- Máy tính: rê chuột vào tin nhắn rồi bấm nút ↩.
- Tin trả lời hiện phần trích dẫn ở trên. **Bấm vào trích dẫn** để nhảy tới tin gốc (tin cũ cũng tự tải lên). Tin gốc bị thu hồi thì trích dẫn ghi “Tin nhắn đã thu hồi”.

**Tìm kiếm** (admin và CTV đều dùng được):
- Mở bằng: ô **“Tìm tin nhắn, đơn, tài khoản…”** trên đầu danh sách chat, nút **Tìm kiếm** ở thanh bên trái (máy tính, hoặc **Ctrl+K** / phím **/**), mục **Thêm → Tìm kiếm** (điện thoại). Nút 🔍 trên đầu một đoạn chat thì **chỉ tìm trong đoạn chat đó**.
- Tìm được: **tin nhắn**, **nội dung đơn**, ghi chú, **tài khoản / mật khẩu**, mã đơn (`DH12`, `DH0012`), mã kết toán (`KT3`). Admin tìm thêm được **thành viên** theo tên, email, SĐT, số tài khoản ngân hàng.
- Gõ **có dấu hay không dấu đều được** (“dac san” tìm ra “Đặc sản”), chữ khớp được tô vàng. Các tab: Tất cả · Tin nhắn · Đơn hàng · Tài khoản/MK · Thành viên · Kết toán.
- Bấm kết quả: tin nhắn → nhảy tới đúng tin trong đoạn chat (tin cũ cũng tự tải); đơn → mở chi tiết đơn; kết toán → mở chi tiết kết toán.
- **Mỗi người chỉ tìm thấy những gì mình được xem**: tin nhắn trong các đoạn chat mình có mặt; CTV chỉ thấy đơn, tài khoản/mật khẩu và kết toán của chính mình. Khi khớp mật khẩu, kết quả chỉ ghi “Mật khẩu: •••••• (khớp)”, không hiện chữ; mở đơn ra mới xem được.

---

## 2. Quy trình làm việc

```
CTV đăng ký (Gmail) ──► chờ duyệt ──► Admin duyệt ──► CTV vào app, tự vào "Cả nhóm"
                                                         │
Admin mở chat riêng với CTV ──► [Lên đơn] nội dung + tài khoản/mật khẩu + tiền công
                                 (app tự trừ chiết khấu % của CTV → ra số "thực nhận")
                                                         │
CTV thấy thẻ đơn ──► [Ảnh] gửi ảnh kết quả (bắt buộc) ──► [Ghi chú] (tuỳ chọn) ──► [Done]
                                                         │
Đơn được tính vào doanh thu (theo số thực nhận)
                                                         │
00:00 ngày 1 hằng tháng: app tự KẾT TOÁN tháng trước cho từng CTV
(hoặc admin bấm "Kết toán ngay" bất cứ lúc nào)
                                                         │
Admin vào trang Kết toán ──► quét mã QR chuyển khoản ──► bấm [Đã thanh toán] ──► CTV được báo ngay
```

- **Sửa / Xoá đơn:** nút dưới thẻ đơn (chỉ admin thấy). Mỗi lần sửa, chat hiện một dòng thông báo, ví dụ “Admin đã sửa đơn DH0012: tiền công 100.000đ → 120.000đ”, và lịch sử lưu lại giá trị trước/sau.
- **CTV bấm Done nhầm:** admin bấm **Mở lại**. Đơn quay về “Đang làm” và không còn được tính tiền.
- **Đơn đã xoá** vào **Thùng rác** (trang Đơn hàng), khôi phục lại được. Đơn đã xoá không tính doanh thu.
- **Đơn đã thanh toán bị khoá:** không sửa, không mở lại, không xoá được nữa, để số liệu đã trả không bị lệch. Nếu bấm “Đã thanh toán” nhầm, vào trang Kết toán → **Huỷ TT** rồi sửa.

---

## 2b. Tài khoản/mật khẩu, chiết khấu, kết toán lương

### Ô “Tài khoản / mật khẩu” trong đơn

Chỉ có **một ô**: dòng 1 là tài khoản, dòng 2 là mật khẩu, các dòng sau ghi gì cũng được (UID, server, mã 2FA…).

```
acc_khach_genshin
MatKhau@2026
UID 812345678 · server Asia · mã 2FA hỏi admin
```

- CTV thấy trên thẻ đơn: tài khoản hiện rõ, **mật khẩu ẩn ●●●●** cho tới khi bấm con mắt. Mỗi dòng có nút **sao chép**.
- Chỉ admin và đúng CTV nhận đơn xem được. Tài khoản/mật khẩu **không** có trong file Excel, lịch sử chỉ ghi “đã sửa tài khoản/mật khẩu” (không ghi giá trị), và **không** gửi sang Discord/Google Sheets sau này.

### Chiết khấu % theo từng CTV

- Đặt ở **Thành viên → Sửa thông tin → Chiết khấu (%)**. Khi đổi, có ô tick **“Áp luôn cho các đơn chưa thanh toán”** nếu muốn tính lại các đơn cũ chưa trả.
- Lúc lên đơn, ô Chiết khấu tự điền theo CTV được chọn (vẫn sửa riêng cho đơn đó được). Gõ tiền công là app hiện ngay: *Tiền công 200.000đ − chiết khấu 15% (30.000đ) → CTV thực nhận: 170.000đ*.
- Mỗi đơn **giữ lại % lúc lên đơn**. Sau này đổi % của CTV, đơn cũ không tự đổi (trừ khi tick ô ở trên).
- Trang Doanh thu, Kết toán, khung thông tin CTV và file Excel đều tính theo **số thực nhận**, có hiện kèm tiền công và phần chiết khấu.

### Thông tin ngân hàng của CTV

CTV vào **Tài khoản → Tài khoản ngân hàng nhận lương**: chọn ngân hàng (58 ngân hàng/ví hỗ trợ VietQR, có MoMo), nhập số tài khoản và tên chủ tài khoản (tự viết hoa, bỏ dấu). App lưu lại để tạo mã QR. Admin cũng sửa giúp được trong trang Thành viên.

### Kết toán lương (trang **Kết toán**)

- **Tự động:** 00:00 ngày 1 hằng tháng (giờ Việt Nam), app gom mọi đơn đã Done của tháng trước thành **một phiếu kết toán cho mỗi CTV**, mã **KT0001, KT0002…** Nếu lúc đó máy đang tắt, app làm bù ngay khi bật lại.
- **Chủ động:** bấm **Kết toán ngay** (nút trên cùng cho tất cả, hoặc nút trên từng dòng CTV ở bảng “Chưa kết toán”). App gom các đơn đã Done tới thời điểm bấm, không cần chờ hết tháng.
- Mỗi phiếu chờ thanh toán có **mã QR VietQR** đã điền sẵn ngân hàng, số tài khoản, **số tiền** và nội dung `LUONG KT0001`. Mở app ngân hàng → quét QR → **kiểm tra tên người nhận** → chuyển. Bên cạnh có nút sao chép số tài khoản / số tiền / nội dung nếu muốn chuyển tay.
- Chuyển xong bấm **Đã thanh toán**: CTV nhận thông báo ngay (hiện popup + tin nhắn trong chat riêng với admin), các đơn trong phiếu chuyển sang “Đã thanh toán” và bị khoá.
- Đơn Done sau thời điểm kết toán sẽ vào kỳ sau. Nếu admin **mở lại** hoặc **xoá** một đơn đang nằm trong phiếu chờ thanh toán, đơn đó tự rời khỏi phiếu (phiếu trống thì tự huỷ).
- **Huỷ kết toán** (phiếu chưa trả): các đơn quay về “chưa kết toán”. **Huỷ TT** (phiếu đã trả, bấm nhầm): phiếu quay về “chờ thanh toán”.
- CTV cũng có trang Kết toán riêng: xem số chưa kết toán, đang chờ trả và lịch sử đã nhận.
- Không còn nút “Đã trả” trên từng đơn. Trang Doanh thu có ô **Đã thanh toán / Chưa thanh toán** lấy từ kết toán, và nút **Kết toán lương** để sang trang Kết toán.

> Mã QR theo chuẩn VietQR (NAPAS), quét được bằng app của hầu hết ngân hàng Việt Nam và MoMo. Đã kiểm tra mã tạo ra trùng từng byte với thư viện chuẩn `vietnam-qr-pay`. Dù vậy, **luôn nhìn tên người nhận trên app ngân hàng trước khi bấm chuyển**.

---

## 3. Bạn yêu cầu → app đã có

| Yêu cầu | Trong app |
|---|---|
| Giao diện kiểu Messenger | Danh sách đoạn chat, bong bóng tin nhắn, gửi ảnh, “Đã xem”, “Đang hoạt động”, số tin chưa đọc, chế độ sáng/tối, giao diện điện thoại |
| Admin cao nhất, đăng ký bằng Gmail | Người đăng ký đầu tiên = **Admin gốc**. Mặc định chỉ nhận email `@gmail.com` (tắt được trong Cài đặt) |
| Thành viên mới phải được admin duyệt | Đăng ký xong ở màn hình “Chờ duyệt”. Admin bấm **Duyệt / Từ chối** ở trang Thành viên; người được duyệt tự vào app, không cần tải lại trang |
| Nhắn riêng từng người để lên đơn — **chỉ admin mới nhắn riêng** | Mỗi CTV được duyệt sẽ **tự có sẵn một đoạn chat riêng với admin** trong danh sách. CTV **không nhắn riêng được với nhau**; họ chỉ nhắn với admin hoặc trong nhóm. Server cũng chặn, không lách được |
| Admin lên đơn trong tin nhắn (nội dung + giá) | Nút **Lên đơn** ở đầu đoạn chat với CTV, hoặc nút **Lên đơn** trên cùng danh sách chat (chọn CTV, đơn tự gửi vào chat riêng với người đó). Chỉ còn ô **Tiền công** (đã bỏ “Giá khách trả”). Gõ giá nhanh: `150k`, `1.5tr`, `150000` |
| Ô tài khoản/mật khẩu gửi cho CTV | Một ô duy nhất: dòng 1 tài khoản, dòng 2 mật khẩu, còn lại ghi tự do. Xem mục 2b |
| Chiết khấu % theo CTV, tự tính thực nhận | Đặt ở trang Thành viên; lúc lên đơn tự trừ và hiện số thực nhận; doanh thu tính theo thực nhận. Xem mục 2b |
| Không cần nút “đã trả” từng đơn, tự tổng kết cuối tháng | App tự kết toán 00:00 ngày 1 hằng tháng; hiện trong Doanh thu và trang Kết toán |
| CTV nhập STK + chọn ngân hàng; admin kết toán có QR, bấm “Đã thanh toán” báo CTV; kết toán chủ động | Có đủ. Xem mục 2b |
| Nút Done · Ảnh · Ghi chú dưới tin nhắn | Có. **Done bị khoá cho tới khi có ít nhất 1 ảnh.** Server cũng kiểm tra lại, nên không lách được |
| Doanh thu CTV theo Tuần/Tháng/Năm, chỉ tính khi Done | Trang **Doanh thu**: chuyển kỳ trước/sau, biểu đồ, bảng theo từng CTV, danh sách đơn. Có thêm mục **Đơn đang làm** (đơn admin đã giao, chưa bấm Done): hiện ra để theo dõi nhưng **không tính tiền** |
| Admin xem tất cả, CTV có trang doanh thu riêng | Admin chọn “Tất cả CTV” hoặc từng người. CTV chỉ thấy số liệu của mình |
| Admin sửa / xoá đơn | Có, và mọi lần sửa/xoá đều vào lịch sử |
| Lịch sử đơn (admin sửa, giờ CTV báo Done…) | Trang **Lịch sử** + nút **Lịch sử** trên từng đơn. Admin xem hết, CTV xem của mình |
| Lưu trữ có sao lưu tự động, không mất dữ liệu | Xem mục 5 |

---

## 4. Phân tích: các phần còn thiếu, đã bổ sung

| Thiếu | Vì sao cần | Đã thêm |
|---|---|---|
| **Theo dõi đã trả tiền CTV chưa** | Doanh thu chỉ cho biết CTV *kiếm được* bao nhiêu, chưa cho biết admin *đã trả* chưa | **Kết toán lương** theo phiếu (KT0001…), tự động cuối tháng hoặc bấm tay, có QR và nút **Đã thanh toán**. Ô “Đã/Chưa thanh toán” cho cả admin và CTV |
| **Không trả trùng / trả sót** | Kết toán tay dễ nhầm | Mỗi đơn chỉ nằm trong 1 phiếu. Đơn đã trả bị khoá. Đơn Done muộn tự vào kỳ sau. Mở lại/xoá đơn tự rút khỏi phiếu chưa trả |
| **Mã QR đúng số tiền** | Gõ tay số tài khoản, số tiền dễ sai | QR VietQR điền sẵn ngân hàng, STK, số tiền, nội dung `LUONG KT…`. CTV chọn ngân hàng từ danh sách (không gõ tự do), STK được kiểm tra định dạng |
| **Hạn chót đơn** | Cày thuê thường có hạn | Bấm nhanh **2 giờ · 5 giờ · 10 giờ · 1 ngày · 2 ngày · 3 ngày · 5 ngày · 7 ngày** (tính từ lúc lên đơn), hoặc tự chọn ngày giờ. Quá hạn thì báo đỏ “trễ hạn” |
| **Mở lại đơn** | CTV bấm Done nhầm, hoặc đơn làm chưa đạt | Nút **Mở lại** (admin) |
| **Xoá mà không mất hẳn** | Tránh xoá nhầm | Thùng rác + **Khôi phục** |
| **Mã đơn** | Để nói chuyện / tra cứu | Mã tự tăng **DH0001, DH0002…**, tìm được theo mã |
| **Quản lý thành viên** | CTV nghỉ, quên mật khẩu… | **Khoá / Mở khoá** (bị đăng xuất ngay, dữ liệu vẫn giữ), **Đặt lại mật khẩu**, **Cấp quyền admin phụ** (chỉ admin gốc làm được) |
| **Thông tin nhận tiền** | Admin cần số tài khoản để trả tiền | CTV chọn ngân hàng + nhập STK + tên chủ TK trong **Tài khoản**, kèm SĐT/Zalo. Admin xem ngay ở khung bên phải đoạn chat và trang Thành viên (hiện “chưa có STK” nếu CTV chưa nhập) |
| **Ảnh đại diện** | Dễ nhận ra nhau | Mỗi người tự tải ảnh trong **Tài khoản** (bấm vào ảnh hoặc nút “Tải ảnh đại diện”; ảnh tự cắt vuông). Admin đổi giúp được trong trang Thành viên → Sửa thông tin |
| **Nhóm chung** | Để thông báo cho cả team | Nhóm **“Cả nhóm”** tự thêm người mới. Admin tạo thêm nhóm được |
| **Không bỏ sót tin** | CTV không mở app liên tục | Số tin chưa đọc, âm báo, thông báo trên máy khi đang mở tab khác |
| **Khung thông tin CTV** | Admin cần nhìn nhanh | Khung bên phải mỗi đoạn chat: thực nhận tuần/tháng, số tiền chưa trả, danh sách đơn đang làm (bấm để nhảy tới đơn) |
| **Xuất Excel** | Đối soát / gửi kế toán, trước khi có Google Sheets | Nút **Xuất Excel (CSV)** ở trang Đơn hàng và Doanh thu, mở bằng Excel hiển thị đúng tiếng Việt |
| **Bảo mật** | App chứa thông tin acc khách, tiền | Mật khẩu mã hoá (scrypt), chặn dò mật khẩu (sai 8 lần khoá 15 phút), ảnh chỉ người đã đăng nhập mới xem được, chống giả mạo yêu cầu (CSRF), mọi quyền đều kiểm tra ở server |
| **Chừa sẵn chỗ cho Discord / Google Sheets** | Bạn sẽ làm sau | Có sẵn điểm nối sự kiện (`order.done`…), xem `integrations/DOC-TRUOC.md` |

---

## 5. Lưu trữ & sao lưu: không mất dữ liệu

Dữ liệu nằm trong thư mục **`data/`** cạnh `server.js`:

```
data/
├── ctv-chat.sqlite          ← toàn bộ tin nhắn, đơn, doanh thu, lịch sử
├── uploads/                 ← ảnh (theo tháng)
└── backups/
    ├── tu-dong/             ← mỗi 1 giờ (chỉnh được), giữ 72 bản gần nhất
    ├── hang-ngay/           ← 1 bản mỗi ngày, giữ 90 ngày
    ├── thu-cong/            ← khi bấm "Sao lưu ngay", không tự xoá
    └── truoc-khoi-phuc/     ← tự tạo trước mỗi lần khôi phục
```

Các lớp bảo vệ:

1. **Ghi ngay xuống ổ đĩa sau mỗi thao tác** (SQLite chế độ WAL + `synchronous=FULL`). Mất điện hay tắt ngang cũng không mất đơn đã lưu. Thao tác nhiều bước hoặc xong hết, hoặc không có gì.
2. **Sao lưu tự động** theo giờ và theo ngày như trên.
3. **Thư mục sao lưu phụ** (rất nên bật): Cài đặt → nhập đường dẫn thư mục **Google Drive / OneDrive / ổ USB**, ví dụ `G:\My Drive\CTV-SaoLuu`. Mỗi bản sao lưu **và toàn bộ ảnh** được chép thêm sang đó. Máy hỏng ổ cứng thì dữ liệu vẫn còn trên Drive.
4. **Khôi phục bằng một nút**: Cài đặt → chọn bản → **Khôi phục**. App tự sao lưu bản hiện tại trước (loại “Trước khôi phục”), nên khôi phục nhầm vẫn quay lại được. Có kiểm tra file hỏng/rỗng trước khi khôi phục.
5. **Tải về / mang sang máy khác**: tải file `.sqlite` ở danh sách bản sao lưu, rồi ở máy mới dùng **“Khôi phục từ file .sqlite”**. Hoặc đơn giản chép cả thư mục `data/` sang máy mới.
6. **Xuất toàn bộ dữ liệu ra JSON** (Cài đặt) để lưu trữ lâu dài.

### Tự động xoá dữ liệu cũ (Cài đặt → “Tự động xoá dữ liệu cũ”)

Mặc định **tắt hết**. Bật mục nào thì app tự xoá mục đó, mỗi giờ kiểm tra một lần. Số ngày chỉnh tuỳ ý:

| Mục | Tính từ lúc | Ghi chú |
|---|---|---|
| **Ảnh** (1–3650 ngày) | gửi ảnh trong chat / đơn hoàn thành (ảnh bằng chứng) | Gồm cả ảnh rác (tải lên nhưng không gửi). **Ảnh đại diện không bị xoá.** Tin nhắn và đơn vẫn còn, chỉ hiện “ảnh đã tự xoá”. Ảnh ở thư mục sao lưu phụ cũng được xoá theo. |
| **Tài khoản / mật khẩu** trong đơn (0–3650 ngày) | CTV bấm Done | **0 = xoá ngay khi CTV bấm Done.** Đơn đang làm không bị xoá. Cần lại thì admin bấm Sửa đơn và nhập lại. |
| **Đơn** (7–3650 ngày) | thanh toán (đơn đã trả lương) / bị xoá (đơn trong thùng rác) | Đơn đang làm hoặc chưa thanh toán **không bao giờ** bị xoá. Xoá hẳn thẻ đơn trong chat, ảnh và lịch sử của đơn. Tổng tiền các lần kết toán đã trả vẫn giữ, nhưng trang Doanh thu không còn chi tiết các đơn này. **App tự sao lưu trước mỗi lần xoá đơn.** |

- Ngay dưới các mục có dòng **“Với cài đặt này, lần dọn tới sẽ xoá: …”** để biết trước sẽ xoá bao nhiêu, tránh đặt nhầm.
- Nút **Dọn ngay** xoá luôn, không chờ tới giờ (có hỏi lại trước khi xoá).
- Mỗi lần dọn đều ghi vào **Lịch sử** (lọc “Tự xoá dữ liệu”).
- Các **bản sao lưu cũ vẫn chứa dữ liệu** cho tới khi tự hết hạn theo số bản giữ lại ở mục Sao lưu tự động. Muốn xoá sạch nhanh hơn thì giảm số bản giữ lại.

---

## 6. Giai đoạn tiếp theo (chưa làm)

| Việc | Ghi chú |
|---|---|
| **Discord**: báo đơn hoàn thành qua webhook | Đã có sự kiện `order.done` (và `settlement.paid` nếu muốn báo trả lương). Chỉ cần thêm 1 file trong `integrations/` + nhập URL webhook |
| **Google Sheets**: ghi lại đơn CTV đã làm | Dùng Service Account (share sheet cho email của nó là xong), nối vào `order.done` / `settlement.paid` |
| **Đưa lên mạng** cho CTV dùng 4G | Đã làm: VPS + tên miền chỉ cần **một lệnh** (mục 1c), hoặc chạy ở nhà qua Tailscale Funnel / Cloudflare Tunnel (mục 1b) |
| Nút **“Đăng nhập bằng Google”** | Hiện đăng ký bằng địa chỉ Gmail + mật khẩu. Nút Google thật cần tạo OAuth Client trên Google Cloud và có tên miền |
| Mẫu đơn / giao nhiều đơn một lúc, CTV bấm “Nhận đơn” / “Từ chối” | Tuỳ nhu cầu |

---

## 7. Cấu trúc thư mục (cho người sửa code)

```
ctv-chat/
├── CHAY-WINDOWS.bat / CHAY-MAC.command
├── server.js            ← máy chủ + toàn bộ API (Node thuần, không thư viện ngoài)
├── lib/db.js            ← lưu trữ SQLite (node:sqlite có sẵn trong Node), nâng cấp cấu trúc tự động
├── lib/backup.js        ← sao lưu tự động / khôi phục / thư mục phụ
├── lib/banks.js         ← danh sách ngân hàng hỗ trợ VietQR (mã BIN)
├── lib/vietqr.js        ← tạo nội dung mã QR chuyển khoản (chuẩn VietQR/EMVCo)
├── lib/webpush.js       ← gửi thông báo đẩy (Web Push, RFC 8291/8292) — không dùng thư viện ngoài
├── lib/fold.js          ← bỏ dấu tiếng Việt để tìm kiếm
├── public/sw.js         ← service worker: nhận thông báo đẩy, mở đúng đoạn chat khi bấm
├── integrations/        ← nơi gắn Discord, Google Sheets sau này
├── deploy/              ← cài lên VPS: cai-dat-vps.sh (1 lệnh), nginx-ctv-chat.conf (khi VPS đã có Nginx)
├── public/              ← giao diện (Vue 3 kèm sẵn, không cần build)
│   ├── index.html       ← các màn hình
│   ├── css/app.css      ← giao diện kiểu Messenger, sáng/tối, điện thoại
│   └── js/app.js        ← logic giao diện, nhận tin thời gian thực (Server-Sent Events)
└── data/                ← DỮ LIỆU (tự tạo khi chạy lần đầu). Sao lưu thư mục này là đủ
```

Biến môi trường: `PORT` (mặc định 3000), `HOST` (mặc định `0.0.0.0`; đặt `127.0.0.1` để chỉ máy này vào được), `DATA_DIR` (đổi nơi lưu dữ liệu).

---

## 8. Lỗi thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| “Ứng dụng cần Node.js 22.13 trở lên” | Cài lại Node.js bản LTS mới nhất |
| “Cổng 3000 đang bị dùng” | App đã chạy rồi, chỉ cần mở http://localhost:3000. Hoặc chạy cổng khác: `set PORT=3001 && node server.js` |
| CTV cùng mạng không vào được | Dùng đúng link `http://192.168…:3000` hiện trong cửa sổ đen. Cho phép Node.js qua tường lửa Windows |
| Quên mật khẩu (kể cả admin gốc) | Trên máy chạy app, mở terminal trong thư mục và gõ `node dat-lai-mat-khau.js ten@gmail.com MatKhauMoi`. Không cần tắt app. Thành viên thường thì admin đặt lại được ngay trong trang Thành viên |
| Muốn làm lại từ đầu | Tắt app, đổi tên thư mục `data/` (đừng xoá), chạy lại |
| Phiếu kết toán ghi “Chưa có STK”, không có QR | Nhắc CTV vào **Tài khoản → Tài khoản ngân hàng nhận lương**, hoặc admin nhập giúp ở trang Thành viên → Sửa thông tin. QR hiện ngay khi có STK |
| Không sửa / xoá được một đơn | Đơn đã thanh toán bị khoá. Vào Kết toán → **Huỷ TT** phiếu đó nếu thật sự cần sửa |

*Thư viện kèm theo: Vue 3 (MIT), qrcode-generator (MIT). Danh sách mã ngân hàng lấy từ vietnam-qr-pay (MIT). Font: Be Vietnam Pro (SIL OFL).*
