'use strict';
/* Đặt lại mật khẩu cho bất kỳ tài khoản nào (kể cả admin gốc) — chạy trên chính máy chủ.
 * Cách dùng:  node dat-lai-mat-khau.js ten@gmail.com MatKhauMoi
 * (Không cần tắt app. Người đó sẽ bị đăng xuất khỏi mọi thiết bị.) */
const path = require('path');
const crypto = require('crypto');
const { Store } = require('./lib/db');

const [email, pw] = process.argv.slice(2);
if (!email || !pw) {
  console.log('\n  Cách dùng:  node dat-lai-mat-khau.js ten@gmail.com MatKhauMoi\n');
  process.exit(1);
}
if (pw.length < 6) { console.log('\n  Mật khẩu cần ít nhất 6 ký tự.\n'); process.exit(1); }

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const store = new Store(path.join(dataDir, 'ctv-chat.sqlite'));
const u = store.get('SELECT * FROM users WHERE email = ?', email.toLowerCase());
if (!u) { console.log(`\n  Không tìm thấy tài khoản ${email}\n`); store.close(); process.exit(1); }

const salt = crypto.randomBytes(16);
const hash = `s1$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
store.tx(() => {
  store.run('UPDATE users SET pass = ? WHERE id = ?', hash, u.id);
  if (u.status === 'locked') store.run("UPDATE users SET status = 'active' WHERE id = ?", u.id);
  store.run('DELETE FROM sessions WHERE user_id = ?', u.id);
  store.run('INSERT INTO logs(at, actor_id, action, target_user_id, details) VALUES (?, NULL, ?, ?, ?)',
    Date.now(), 'user.reset_password', u.id, JSON.stringify({ via: 'dòng lệnh trên máy chủ' }));
});
store.close();
console.log(`\n  ✓ Đã đặt lại mật khẩu cho ${u.name} (${u.email}). Đăng nhập lại bằng mật khẩu mới.\n`);
