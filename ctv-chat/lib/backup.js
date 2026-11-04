'use strict';
/* Sao lưu tự động.
 *  backups/tu-dong/        mỗi N giờ (mặc định 1 giờ), giữ K bản gần nhất (mặc định 72)
 *  backups/hang-ngay/      bản đầu tiên mỗi ngày, giữ 90 ngày
 *  backups/thu-cong/       khi admin bấm "Sao lưu ngay" — không tự xoá
 *  backups/truoc-khoi-phuc/ tự tạo trước mỗi lần khôi phục — giữ 30 bản
 * Thư mục phụ (tuỳ chọn, ví dụ thư mục Google Drive / ổ USB): chép thêm mọi bản sao lưu + ảnh.
 */
const fs = require('fs');
const path = require('path');
const { checkBackupFile } = require('./db');

const KINDS = {
  'tu-dong': 'Tự động',
  'hang-ngay': 'Hằng ngày',
  'thu-cong': 'Thủ công',
  'truoc-khoi-phuc': 'Trước khôi phục',
};

const vnNow = (t = Date.now()) => new Date(t + 7 * 3600e3); // giờ Việt Nam (UTC+7)
const pad = (n) => String(n).padStart(2, '0');
function stamp(t) {
  const d = vnNow(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}_${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}-${pad(d.getUTCSeconds())}`;
}
const dayOf = (t) => stamp(t).slice(0, 10);

class Backup {
  constructor({ store, dbFile, uploadsDir, backupDir, log }) {
    this.store = store;
    this.dbFile = dbFile;
    this.uploadsDir = uploadsDir;
    this.backupDir = backupDir;
    this.log = log || console.log;
    for (const k of Object.keys(KINDS)) fs.mkdirSync(path.join(backupDir, k), { recursive: true });
    this.lastError = null;
  }

  cfg() {
    const s = (k, d) => this.store.setting(k, d);
    return {
      hours: Math.max(0.25, Number(s('backup_hours', '1')) || 1),
      keep: Math.max(5, Number(s('backup_keep', '72')) || 72),
      keepDaily: Math.max(7, Number(s('backup_keep_daily', '90')) || 90),
      extraDir: String(s('backup_dir2', '') || '').trim(),
    };
  }

  list() {
    const out = [];
    for (const kind of Object.keys(KINDS)) {
      const dir = path.join(this.backupDir, kind);
      let files = [];
      try { files = fs.readdirSync(dir); } catch {}
      for (const name of files) {
        if (!name.endsWith('.sqlite')) continue;
        const st = fs.statSync(path.join(dir, name));
        out.push({ kind, kindName: KINDS[kind], name, size: st.size, at: st.mtimeMs });
      }
    }
    return out.sort((a, b) => b.at - a.at);
  }

  fileOf(kind, name) {
    if (!KINDS[kind] || !/^[\w.-]+\.sqlite$/.test(name)) return null;
    const p = path.join(this.backupDir, kind, name);
    return fs.existsSync(p) ? p : null;
  }

  /** Tạo 1 bản sao lưu. Trả về thông tin file. */
  create(kind = 'tu-dong') {
    const name = `ctv-chat_${stamp()}.sqlite`;
    const dest = path.join(this.backupDir, kind, name);
    this.store.backupTo(dest);
    this.rotate();
    this.copyExtra(kind, dest);
    this.store.setSetting('backup_last_at', Date.now());
    this.store.setSetting('backup_last_' + kind, Date.now());
    this.lastError = null;
    return { kind, name, size: fs.statSync(dest).size, at: Date.now() };
  }

  rotate() {
    const { keep, keepDaily } = this.cfg();
    const limits = { 'tu-dong': keep, 'hang-ngay': keepDaily, 'truoc-khoi-phuc': 30 };
    for (const [kind, max] of Object.entries(limits)) {
      const files = this.list().filter((b) => b.kind === kind);
      for (const b of files.slice(max)) {
        try { fs.unlinkSync(path.join(this.backupDir, kind, b.name)); } catch {}
      }
    }
  }

  /** Chép sang thư mục phụ (Google Drive, USB...). Lỗi ở đây không làm hỏng bản sao lưu chính. */
  copyExtra(kind, file) {
    const { extraDir } = this.cfg();
    if (!extraDir) return;
    try {
      const dir = path.join(extraDir, 'ctv-chat-backups', kind);
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(file, path.join(dir, path.basename(file)));
      this.mirrorUploads(path.join(extraDir, 'ctv-chat-backups', 'uploads'));
      // dọn bản cũ ở thư mục phụ theo cùng quy tắc
      const max = { 'tu-dong': this.cfg().keep, 'hang-ngay': this.cfg().keepDaily, 'truoc-khoi-phuc': 30 }[kind];
      if (max) {
        const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sqlite')).sort().reverse();
        for (const f of files.slice(max)) try { fs.unlinkSync(path.join(dir, f)); } catch {}
      }
    } catch (e) {
      this.lastError = 'Không chép được sang thư mục phụ: ' + e.message;
      this.log('[sao lưu] ' + this.lastError);
    }
  }

  /** Ảnh gốc bị tự xoá theo cài đặt → xoá luôn bản chép ở thư mục phụ. */
  removeMirrored(rel) {
    const { extraDir } = this.cfg();
    if (!extraDir) return;
    try { fs.unlinkSync(path.join(extraDir, 'ctv-chat-backups', 'uploads', rel)); } catch {}
  }

  /** Chép những ảnh chưa có sang thư mục đích (chỉ thêm, không xoá). */
  mirrorUploads(dest) {
    const walk = (src, dst) => {
      let items = [];
      try { items = fs.readdirSync(src, { withFileTypes: true }); } catch { return; }
      fs.mkdirSync(dst, { recursive: true });
      for (const it of items) {
        const s = path.join(src, it.name), d = path.join(dst, it.name);
        if (it.isDirectory()) walk(s, d);
        else if (!fs.existsSync(d)) fs.copyFileSync(s, d);
      }
    };
    walk(this.uploadsDir, dest);
  }

  /** Gọi định kỳ: tạo bản tự động khi tới giờ, và bản hằng ngày nếu hôm nay chưa có. */
  tick() {
    try {
      if (!this.store.get('SELECT COUNT(*) n FROM users').n) return; // chưa có dữ liệu thì chưa cần sao lưu
      const { hours } = this.cfg();
      const last = Number(this.store.setting('backup_last_tu-dong', 0));
      if (Date.now() - last >= hours * 3600e3 - 30e3) this.create('tu-dong');
      const lastDaily = Number(this.store.setting('backup_last_hang-ngay', 0));
      if (dayOf(lastDaily) !== dayOf(Date.now())) this.create('hang-ngay');
    } catch (e) {
      this.lastError = e.message;
      this.log('[sao lưu] lỗi: ' + e.message);
    }
  }

  /** Khôi phục từ 1 file sao lưu. Luôn tạo bản "trước khôi phục" để có thể quay lại. */
  restoreFile(file) {
    let users;
    try { users = checkBackupFile(file); } catch (e) { throw Object.assign(new Error(e.message), { status: 400 }); }
    if (!users) throw Object.assign(new Error('Bản sao lưu này chưa có tài khoản nào (dữ liệu trống) nên không khôi phục.'), { status: 400 });
    const tmp = this.dbFile + '.restore-tmp';
    fs.copyFileSync(file, tmp); // chép trước khi đóng DB, phòng khi file nguồn nằm trên ổ chậm
    const keepSessions = this.store.all('SELECT * FROM sessions');
    const pre = this.create('truoc-khoi-phuc');
    this.store.close();
    try {
      for (const ext of ['-wal', '-shm']) try { fs.unlinkSync(this.dbFile + ext); } catch {}
      fs.renameSync(tmp, this.dbFile);
    } finally {
      this.store.open();
    }
    // giữ lại phiên đăng nhập hiện tại (nếu người dùng còn tồn tại trong bản khôi phục)
    for (const s of keepSessions) {
      try {
        this.store.run('INSERT OR IGNORE INTO sessions(token, user_id, created_at, last_used, ua) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)',
          s.token, s.user_id, s.created_at, s.last_used, s.ua, s.user_id);
      } catch {}
    }
    return pre;
  }
}

module.exports = { Backup, KINDS, stamp };
