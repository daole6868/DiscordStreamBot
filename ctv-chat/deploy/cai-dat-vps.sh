#!/usr/bin/env bash
# =====================================================================
#  CTV Chat — cài lên VPS (Ubuntu 22.04 / 24.04, Debian 11 / 12)
#
#  Chạy trong thư mục ctv-chat đã giải nén trên VPS:
#      sudo bash deploy/cai-dat-vps.sh chat.tenmien.com
#
#  - Cài Node.js, chạy app như một dịch vụ (tự chạy lại khi lỗi / khi khởi động lại VPS)
#  - Cài Caddy: tự lấy chứng chỉ HTTPS miễn phí (Let's Encrypt) cho tên miền, tự gia hạn
#  - Có thư mục data/ đi kèm (dữ liệu chép từ máy tính) thì tự chuyển lên VPS
#  Cập nhật bản mới:  sudo ctv-chat cap-nhat   (cài từ git: tự git pull rồi cài lại)
#                     hoặc giải nén bản zip mới và chạy lại ĐÚNG lệnh trên. Dữ liệu giữ nguyên.
# =====================================================================
set -euo pipefail

DOMAIN="${1:-}"
PORT="${PORT:-3000}"
APP_DIR="${APP_DIR:-/opt/ctv-chat}"
DATA_DIR="${DATA_DIR:-/var/lib/ctv-chat}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
BIN_DIR="${BIN_DIR:-/usr/local/bin}"
SVC=ctv-chat
APP_USER=ctvchat
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[1;33m[!]\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m[x] %s\033[0m\n\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Cần quyền root. Chạy:  sudo bash deploy/cai-dat-vps.sh ${DOMAIN:-chat.tenmien.com}"
[ -n "$DOMAIN" ] || die "Thiếu tên miền. Ví dụ:  sudo bash deploy/cai-dat-vps.sh chat.tenmien.com"
[[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$ ]] || die "Tên miền không hợp lệ: $DOMAIN (ghi dạng chat.tenmien.com, không có https://)"
[[ "$PORT" =~ ^[0-9]+$ ]] || die "PORT không hợp lệ: $PORT"
[ -f "$SRC/server.js" ] || die "Không thấy server.js. Hãy cd vào thư mục ctv-chat đã giải nén rồi chạy lại."
command -v apt-get >/dev/null || die "Lệnh cài này dành cho Ubuntu / Debian (có apt-get)."
export DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------- 1. gói cơ bản
say "1/7  Cài gói cơ bản"
apt-get update -y -qq
apt-get install -y -qq curl ca-certificates gnupg rsync iproute2 git >/dev/null
ok "xong"

# ---------------------------------------------------------------- 2. Node.js ≥ 22.13
say "2/7  Node.js"
node_ok() {
  command -v node >/dev/null || return 1
  local v ma mi
  v="$(node -p 'process.versions.node' 2>/dev/null)" || return 1
  IFS=. read -r ma mi _ <<<"$v"
  [ "$ma" -gt 22 ] || { [ "$ma" -eq 22 ] && [ "$mi" -ge 13 ]; }
}
if ! node_ok; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node_ok || die "Cài Node.js chưa được. Thử cài tay Node.js 22 rồi chạy lại."
NODE_BIN="$(command -v node)"
ok "Node.js $("$NODE_BIN" -v)"

# ---------------------------------------------------------------- 3. chép app + dữ liệu
say "3/7  Chép app vào $APP_DIR, dữ liệu ở $DATA_DIR"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --no-create-home --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR" "$DATA_DIR"
if [ "$SRC" != "$APP_DIR" ]; then
  rsync -a --delete --exclude 'data/' --exclude '.git/' "$SRC"/ "$APP_DIR"/
fi
if [ -f "$SRC/data/ctv-chat.sqlite" ]; then
  if [ -f "$DATA_DIR/ctv-chat.sqlite" ]; then
    warn "Có thư mục data/ đi kèm nhưng VPS đã có dữ liệu → KHÔNG ghi đè. (Muốn thay thì dùng Cài đặt → Khôi phục từ file .sqlite trong app.)"
  else
    systemctl stop "$SVC" 2>/dev/null || true
    rsync -a "$SRC/data/" "$DATA_DIR/"
    mv "$SRC/data" "$SRC/data.da-chuyen-len-vps-$(date +%Y%m%d%H%M)"   # giữ 1 bản, lần cập nhật sau không chép lại
    ok "đã chuyển dữ liệu cũ (data/) lên VPS"
  fi
fi
chown -R root:root "$APP_DIR"
chmod -R u=rwX,go=rX "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$DATA_DIR"
chmod 750 "$DATA_DIR"
ok "xong"

# ---------------------------------------------------------------- 4. dịch vụ tự chạy
say "4/7  Chạy app như dịch vụ (tự chạy lại khi lỗi / khi khởi động VPS)"
if ! systemctl is-active --quiet "$SVC" && ss -ltnH "sport = :$PORT" 2>/dev/null | grep -q .; then
  die "Cổng $PORT đang bị chương trình khác dùng. Chạy lại với cổng khác, ví dụ:  sudo PORT=3005 bash deploy/cai-dat-vps.sh $DOMAIN"
fi
cat >"$SYSTEMD_DIR/$SVC.service" <<UNIT
[Unit]
Description=CTV Chat
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
Environment=PORT=$PORT HOST=127.0.0.1 DATA_DIR=$DATA_DIR NO_OPEN=1
ExecStart=$NODE_BIN $APP_DIR/server.js
Restart=always
RestartSec=3
TimeoutStopSec=20
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable "$SVC" >/dev/null 2>&1
systemctl restart "$SVC"
up=0
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/"; then up=1; break; fi
  sleep 1
done
[ "$up" -eq 1 ] || { journalctl -u "$SVC" -n 30 --no-pager || true; die "App chưa chạy được (xem lỗi ở trên)."; }
ok "app đang chạy ở 127.0.0.1:$PORT"

# lệnh tiện dùng:  ctv-chat cap-nhat | trang-thai | nhat-ky | khoi-dong-lai | dat-lai-mat-khau <email> <mật khẩu mới>
cat >"$BIN_DIR/ctv-chat" <<HELPER
#!/usr/bin/env bash
SRC="$SRC"
case "\${1:-}" in
  cap-nhat)
    if git -C "\$SRC" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      OWNER="\$(stat -c %U "\$SRC")"
      runuser -l "\$OWNER" -c "git -C '\$SRC' pull --ff-only" || { echo "git pull lỗi — xem thông báo ở trên."; exit 1; }
      PORT=$PORT bash "\$SRC/deploy/cai-dat-vps.sh" "$DOMAIN"
    else
      echo "Thư mục \$SRC không lấy từ git. Tải bản zip mới, giải nén, rồi chạy: sudo bash deploy/cai-dat-vps.sh $DOMAIN"
    fi ;;
  trang-thai)     systemctl status $SVC --no-pager ;;
  nhat-ky)        journalctl -u $SVC -f ;;
  khoi-dong-lai)  systemctl restart $SVC && echo "Đã khởi động lại." ;;
  dat-lai-mat-khau)
    [ -n "\${2:-}" ] && [ -n "\${3:-}" ] || { echo "Cách dùng: sudo ctv-chat dat-lai-mat-khau ten@gmail.com MatKhauMoi"; exit 1; }
    runuser -u $APP_USER -- env DATA_DIR=$DATA_DIR $NODE_BIN $APP_DIR/dat-lai-mat-khau.js "\$2" "\$3" ;;
  *) echo "Cách dùng: sudo ctv-chat [cap-nhat | trang-thai | nhat-ky | khoi-dong-lai | dat-lai-mat-khau <email> <mật khẩu mới>]" ;;
esac
HELPER
chmod 755 "$BIN_DIR/ctv-chat"

# ---------------------------------------------------------------- 5. tên miền
say "5/7  Kiểm tra tên miền $DOMAIN"
MYIP="$(curl -fsS4 --max-time 8 https://api.ipify.org 2>/dev/null || true)"
DNSIP="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)"
if [ -z "$DNSIP" ]; then
  warn "$DOMAIN chưa trỏ về đâu. Vào trang quản lý tên miền, tạo bản ghi A:  ${DOMAIN}  →  ${MYIP:-<IP của VPS>}"
  warn "Trỏ xong (thường vài phút) thì chạy lại lệnh này để lấy chứng chỉ HTTPS."
elif [ -n "$MYIP" ] && [ "$DNSIP" != "$MYIP" ]; then
  warn "$DOMAIN đang trỏ về $DNSIP, còn IP của VPS là $MYIP."
  warn "Sửa bản ghi A cho đúng. Nếu dùng Cloudflare, hãy để đám mây màu XÁM (DNS only)."
else
  ok "$DOMAIN → $DNSIP (đúng IP của VPS)"
fi

# ---------------------------------------------------------------- 6. HTTPS (Caddy)
say "6/7  HTTPS cho $DOMAIN"
WEB="$(ss -ltnpH '( sport = :80 or sport = :443 )' 2>/dev/null || true)"
if echo "$WEB" | grep -qE '"(nginx|apache2|httpd|lighttpd)"'; then
  warn "VPS đang có Nginx / Apache chiếm cổng 80/443 nên KHÔNG cài Caddy."
  warn "Dùng file mẫu deploy/nginx-ctv-chat.conf (hướng dẫn ở đầu file) để thêm $DOMAIN vào Nginx."
  WEB_OK=0
else
  if ! command -v caddy >/dev/null; then
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' >/etc/apt/sources.list.d/caddy-stable.list
    chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y -qq
    apt-get install -y -qq caddy >/dev/null
  fi
  mkdir -p "$(dirname "$CADDYFILE")"
  BLOCK="$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:$PORT
}"
  if [ -f "$CADDYFILE" ] && grep -qF "$DOMAIN {" "$CADDYFILE"; then
    ok "Caddyfile đã có $DOMAIN"
  elif [ ! -s "$CADDYFILE" ] || grep -q '/usr/share/caddy' "$CADDYFILE"; then
    [ -f "$CADDYFILE" ] && cp "$CADDYFILE" "$CADDYFILE.bak.$(date +%Y%m%d%H%M%S)"
    printf '# CTV Chat — tạo bởi deploy/cai-dat-vps.sh\n%s\n' "$BLOCK" >"$CADDYFILE"
    ok "đã tạo Caddyfile cho $DOMAIN"
  else
    cp "$CADDYFILE" "$CADDYFILE.bak.$(date +%Y%m%d%H%M%S)"
    printf '\n# CTV Chat\n%s\n' "$BLOCK" >>"$CADDYFILE"
    ok "đã thêm $DOMAIN vào Caddyfile (giữ nguyên các trang web khác)"
  fi
  caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1 || die "Caddyfile bị lỗi: kiểm tra $CADDYFILE"
  systemctl enable caddy >/dev/null 2>&1
  systemctl reload caddy 2>/dev/null || systemctl restart caddy
  WEB_OK=1
fi

# ---------------------------------------------------------------- 7. tường lửa + kiểm tra
say "7/7  Tường lửa và kiểm tra"
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q 'Status: active'; then
  ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null
  ok "đã mở cổng 80, 443 (ufw)"
else
  warn "Nếu nhà cung cấp VPS có tường lửa riêng (Firewall / Security Group), hãy mở cổng 80 và 443."
fi
CODE=000
if [ "$WEB_OK" -eq 1 ]; then
  for _ in $(seq 1 30); do
    CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "https://$DOMAIN/" || true)"
    [ "$CODE" = "200" ] && break
    sleep 2
  done
fi

echo
if [ "$CODE" = "200" ]; then
  printf '\033[1;32m  ✓ XONG! Mở app tại:  https://%s\033[0m\n' "$DOMAIN"
  echo "    Người đăng ký đầu tiên là Admin (nếu chưa có dữ liệu)."
  echo "    Gửi link này cho CTV, rồi mỗi người vào Tài khoản → Bật thông báo."
else
  printf '\033[1;33m  App đã chạy trên VPS nhưng chưa mở được https://%s\033[0m\n' "$DOMAIN"
  echo "    Thường do tên miền chưa trỏ đúng IP, hoặc cổng 80/443 đang bị chặn."
  echo "    Sửa xong chạy lại đúng lệnh này. Xem lỗi HTTPS:  journalctl -u caddy -n 50"
fi
echo
echo "  Lệnh hay dùng:"
echo "    sudo ctv-chat cap-nhat            cập nhật bản mới (lấy từ git)"
echo "    sudo ctv-chat trang-thai          xem app có đang chạy không"
echo "    sudo ctv-chat nhat-ky             xem nhật ký (Ctrl+C để thoát)"
echo "    sudo ctv-chat khoi-dong-lai       khởi động lại app"
echo "    sudo ctv-chat dat-lai-mat-khau ten@gmail.com MatKhauMoi"
echo "  Dữ liệu + bản sao lưu: $DATA_DIR"
echo
