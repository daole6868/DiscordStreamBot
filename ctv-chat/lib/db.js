'use strict';
/* Lưu trữ dữ liệu bằng SQLite có sẵn trong Node.js (node:sqlite) — không cần cài thêm gì.
 * - WAL + synchronous=FULL: mỗi thao tác được ghi chắc xuống ổ đĩa, tắt máy đột ngột không mất dữ liệu.
 * - Mọi thay đổi nhiều bước chạy trong transaction (hoặc xong hết, hoặc không có gì).
 */
const fs = require('fs');
const { fold } = require('./fold');

// Node 22 in cảnh báo "SQLite is an experimental feature" — ẩn đi cho gọn màn hình.
const origEmitWarning = process.emitWarning;
process.emitWarning = function (w, ...rest) {
  if (String((w && w.message) || w).includes('SQLite')) return;
  return origEmitWarning.call(process, w, ...rest);
};

let sqlite;
try {
  sqlite = require('node:sqlite');
} catch {
  console.error('\n  [!] Ứng dụng cần Node.js 22.13 trở lên (khuyên dùng bản LTS mới nhất tại https://nodejs.org).');
  console.error('      Phiên bản đang dùng: ' + process.version + '\n');
  process.exit(1);
}

// Mỗi phần tử = 1 lần nâng cấp cấu trúc. Chỉ thêm vào cuối, không sửa cái cũ.
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    pass TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',          -- admin | member
    is_owner INTEGER NOT NULL DEFAULT 0,           -- admin gốc (người tạo app)
    status TEXT NOT NULL DEFAULT 'pending',        -- pending | active | locked | rejected
    color TEXT, phone TEXT, bank TEXT, note TEXT,
    created_at INTEGER NOT NULL, approved_at INTEGER, approved_by INTEGER, last_seen INTEGER
  );
  CREATE TABLE sessions (
    token TEXT PRIMARY KEY,                        -- sha256 của mã đăng nhập
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL, last_used INTEGER NOT NULL, ua TEXT
  );
  CREATE TABLE convs (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,                            -- dm | group
    name TEXT,
    dm_key TEXT UNIQUE,                            -- "nhỏ:lớn" cho tin nhắn riêng
    is_main INTEGER NOT NULL DEFAULT 0,            -- nhóm chung, thành viên mới tự vào
    created_by INTEGER, created_at INTEGER NOT NULL, last_msg_at INTEGER NOT NULL
  );
  CREATE TABLE conv_members (
    conv_id INTEGER NOT NULL REFERENCES convs(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    last_read INTEGER NOT NULL DEFAULT 0,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (conv_id, user_id)
  );
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    conv_id INTEGER NOT NULL REFERENCES convs(id),
    sender_id INTEGER REFERENCES users(id),
    type TEXT NOT NULL,                            -- text | order | system
    text TEXT, images TEXT, order_id INTEGER,
    created_at INTEGER NOT NULL, deleted_at INTEGER, deleted_by INTEGER
  );
  CREATE INDEX idx_msg_conv ON messages(conv_id, id);
  CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    conv_id INTEGER NOT NULL REFERENCES convs(id),
    msg_id INTEGER,
    assignee_id INTEGER NOT NULL REFERENCES users(id),
    created_by INTEGER NOT NULL,
    content TEXT NOT NULL,
    price INTEGER NOT NULL DEFAULT 0,              -- tiền công CTV nhận
    customer_price INTEGER,                        -- giá khách trả (chỉ admin thấy)
    deadline INTEGER,
    status TEXT NOT NULL DEFAULT 'open',           -- open | done
    proof TEXT NOT NULL DEFAULT '[]',              -- ảnh bằng chứng (JSON)
    note TEXT,
    done_at INTEGER, paid_at INTEGER, paid_by INTEGER,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    deleted_at INTEGER, deleted_by INTEGER
  );
  CREATE INDEX idx_ord_assignee ON orders(assignee_id, status, done_at);
  CREATE INDEX idx_ord_done ON orders(done_at);
  CREATE TABLE logs (
    id INTEGER PRIMARY KEY,
    at INTEGER NOT NULL,
    actor_id INTEGER,
    action TEXT NOT NULL,
    order_id INTEGER,
    target_user_id INTEGER,                        -- CTV liên quan (để CTV xem lịch sử của mình)
    details TEXT
  );
  CREATE INDEX idx_log_order ON logs(order_id);
  CREATE INDEX idx_log_target ON logs(target_user_id, id);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  `,
  // 2: ảnh đại diện tự tải lên
  `ALTER TABLE users ADD COLUMN avatar TEXT;`,
  // 3: chiết khấu, ngân hàng, tài khoản/mật khẩu trong đơn, kết toán lương
  `
  ALTER TABLE users ADD COLUMN discount_pct REAL NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN bank_bin TEXT;
  ALTER TABLE users ADD COLUMN bank_acc TEXT;
  ALTER TABLE users ADD COLUMN bank_holder TEXT;
  ALTER TABLE orders ADD COLUMN credentials TEXT;
  ALTER TABLE orders ADD COLUMN discount_pct REAL NOT NULL DEFAULT 0;
  ALTER TABLE orders ADD COLUMN net INTEGER;
  ALTER TABLE orders ADD COLUMN settlement_id INTEGER;
  UPDATE orders SET net = price WHERE net IS NULL;
  CREATE INDEX idx_ord_settle ON orders(settlement_id);
  CREATE TABLE settlements (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    label TEXT NOT NULL,
    period_key TEXT,                               -- "2026-10" nếu là kết toán tự động cuối tháng
    cutoff INTEGER NOT NULL,                       -- gồm các đơn xong trước thời điểm này
    auto INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',        -- pending (chờ thanh toán) | paid
    amount INTEGER, gross INTEGER, order_count INTEGER,   -- chốt lại khi đã thanh toán
    bank_snapshot TEXT,
    created_at INTEGER NOT NULL, created_by INTEGER,
    paid_at INTEGER, paid_by INTEGER
  );
  CREATE INDEX idx_settle_user ON settlements(user_id, status);
  `,
  // 4: các đơn đã bấm "Đã trả" ở bản cũ → gom thành kết toán đã thanh toán (tránh trả 2 lần)
  (store) => {
    const groups = store.all(`SELECT assignee_id uid, COUNT(*) n, SUM(COALESCE(net, price)) s, SUM(price) g, MAX(paid_at) at, MAX(paid_by) pb
      FROM orders WHERE paid_at IS NOT NULL AND settlement_id IS NULL GROUP BY assignee_id`);
    for (const r of groups) {
      const sid = store.insert(`INSERT INTO settlements(user_id, label, cutoff, auto, status, amount, gross, order_count, created_at, created_by, paid_at, paid_by)
        VALUES (?, 'Đã thanh toán trước khi có kết toán', ?, 0, 'paid', ?, ?, ?, ?, ?, ?, ?)`, r.uid, r.at, r.s, r.g, r.n, r.at, r.pb, r.at, r.pb);
      store.run('UPDATE orders SET settlement_id = ? WHERE assignee_id = ? AND paid_at IS NOT NULL AND settlement_id IS NULL', sid, r.uid);
    }
  },
  // 5: trả lời (trích dẫn) một tin nhắn cũ
  `ALTER TABLE messages ADD COLUMN reply_to INTEGER;`,
  // 6: tự động xoá dữ liệu cũ — ghi lại số ảnh / lúc xoá tài khoản để giao diện hiện "đã tự xoá"
  `
  ALTER TABLE messages ADD COLUMN img_purged INTEGER;
  ALTER TABLE orders ADD COLUMN proof_purged INTEGER;
  ALTER TABLE orders ADD COLUMN cred_purged_at INTEGER;
  `,
  // 7: tìm kiếm tin nhắn — lưu sẵn chữ đã bỏ dấu để tìm nhanh
  (store) => {
    store.db.exec('ALTER TABLE messages ADD COLUMN fold TEXT');
    for (const r of store.all('SELECT id, text FROM messages WHERE text IS NOT NULL')) store.run('UPDATE messages SET fold = ? WHERE id = ?', fold(r.text), r.id);
  },
  // 8: nhắc tên (@) trong nhóm + thông báo đẩy lên điện thoại
  `
  ALTER TABLE messages ADD COLUMN mentions TEXT;
  ALTER TABLE users ADD COLUMN notify_group INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE push_subs (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    endpoint TEXT NOT NULL UNIQUE,                 -- địa chỉ nhận thông báo của 1 trình duyệt / điện thoại
    p256dh TEXT NOT NULL, auth TEXT NOT NULL,
    ua TEXT, created_at INTEGER NOT NULL, last_ok INTEGER, fails INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_push_user ON push_subs(user_id);
  `,
  // 9: tin hệ thống dùng biểu tượng vẽ (SVG) thay cho emoji — chuyển cả tin cũ
  (store) => {
    store.db.exec('ALTER TABLE messages ADD COLUMN icon TEXT');
    const MAP = [['✅', 'check'], ['📋', 'clipboard'], ['💰', 'money'], ['✏', 'edit'], ['↩', 'undo'], ['🗑', 'trash'], ['♻', 'restore'], ['👋', 'userplus'], ['🎉', 'check']];
    for (const r of store.all("SELECT id, text FROM messages WHERE type = 'system' AND text IS NOT NULL")) {
      const hit = MAP.find(([e]) => r.text.startsWith(e));
      const icon = hit ? hit[1] : /đã tạo nhóm/.test(r.text) ? 'group' : null;
      const text = r.text.replace(/^[\p{Extended_Pictographic}\uFE0F\u200D]+\s*/u, '');
      if (icon || text !== r.text) store.run('UPDATE messages SET icon = ?, text = ?, fold = ? WHERE id = ?', icon, text, fold(text), r.id);
    }
  },
];

class Store {
  constructor(file) {
    this.file = file;
    this.open();
  }

  open() {
    this.db = new sqlite.DatabaseSync(this.file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.cache = new Map();
    this.migrate();
  }

  close() {
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
    this.cache.clear();
    this.db.close();
  }

  migrate() {
    const v = this.db.prepare('PRAGMA user_version').get().user_version;
    for (let i = v; i < MIGRATIONS.length; i++) {
      this.db.exec('BEGIN');
      try {
        if (typeof MIGRATIONS[i] === 'function') MIGRATIONS[i](this);
        else this.db.exec(MIGRATIONS[i]);
        this.db.exec(`PRAGMA user_version = ${i + 1}`);
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    }
  }

  stmt(sql) {
    let s = this.cache.get(sql);
    if (!s) { s = this.db.prepare(sql); this.cache.set(sql, s); }
    return s;
  }
  static clean(params) { return params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? Number(p) : p)); }
  get(sql, ...p) { const r = this.stmt(sql).get(...Store.clean(p)); return r ? { ...r } : undefined; }
  all(sql, ...p) { return this.stmt(sql).all(...Store.clean(p)).map((r) => ({ ...r })); }
  run(sql, ...p) { return this.stmt(sql).run(...Store.clean(p)); }
  insert(sql, ...p) { return Number(this.run(sql, ...p).lastInsertRowid); }

  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw e;
    }
  }

  /** Bản sao nhất quán của toàn bộ dữ liệu (an toàn kể cả khi app đang chạy). */
  backupTo(dest) {
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    this.db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  }

  setting(key, def) {
    const r = this.get('SELECT value FROM settings WHERE key = ?', key);
    return r ? r.value : def;
  }
  setSetting(key, value) {
    this.run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
  }
}

/** Kiểm tra 1 file có phải dữ liệu SQLite hợp lệ của app không. */
function isSqliteFile(buf) {
  return Buffer.isBuffer(buf) && buf.length > 100 && buf.subarray(0, 16).toString('latin1') === 'SQLite format 3\u0000';
}

function checkBackupFile(file) {
  const db = new sqlite.DatabaseSync(file, { readOnly: true });
  try {
    const ok = db.prepare('PRAGMA integrity_check').get();
    const hasUsers = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
    if (!hasUsers) throw new Error('File không phải dữ liệu của CTV Chat');
    if (Object.values(ok)[0] !== 'ok') throw new Error('File sao lưu bị hỏng');
    return db.prepare('SELECT COUNT(*) n FROM users').get().n;
  } finally {
    db.close();
  }
}

module.exports = { Store, isSqliteFile, checkBackupFile };
