'use strict';
/*
 * CTV Chat — nhắn tin nội bộ + giao đơn cho CTV + doanh thu + sao lưu tự động.
 * Chỉ dùng thư viện có sẵn của Node.js (≥ 22.13). Chạy:  node server.js  → http://localhost:3000
 *
 * Biến môi trường (tuỳ chọn):
 *   PORT=3000            cổng
 *   HOST=0.0.0.0         0.0.0.0 = máy khác trong cùng mạng truy cập được; 127.0.0.1 = chỉ máy này
 *   DATA_DIR=./data      nơi lưu dữ liệu (CSDL, ảnh, bản sao lưu)
 */
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { Store, isSqliteFile } = require('./lib/db');
const { Backup, KINDS } = require('./lib/backup');
const BANKS = require('./lib/banks');
const { vietqrPayload, safeMemo } = require('./lib/vietqr');
const { fold } = require('./lib/fold');
const webpush = require('./lib/webpush');
const fcm = require('./lib/fcm');
const bankByBin = new Map(BANKS.map((b) => [b.bin, b]));

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const DB_FILE = path.join(DATA_DIR, 'ctv-chat.sqlite');
for (const d of [DATA_DIR, UPLOADS_DIR, BACKUP_DIR]) fs.mkdirSync(d, { recursive: true });

const store = new Store(DB_FILE);
const backup = new Backup({ store, dbFile: DB_FILE, uploadsDir: UPLOADS_DIR, backupDir: BACKUP_DIR });

/** Điểm nối cho tích hợp sau này (Discord webhook, Google Sheets…):
 *  hooks.on('order.done', ({ order, user }) => { ... })
 *  Sự kiện: order.created, order.updated, order.done, order.reopened, order.paid, order.deleted, user.approved */
const hooks = new EventEmitter();
/** Gọi các tích hợp một cách an toàn: chạy sau khi đã trả lời người dùng, lỗi chỉ ghi ra màn hình. */
function emitHook(name, data) {
  for (const fn of hooks.listeners(name)) {
    setImmediate(() => Promise.resolve().then(() => fn(data)).catch((e) => console.error(`[tích hợp] ${name}: ${e.message}`)));
  }
}
for (const f of fs.existsSync(path.join(ROOT, 'integrations')) ? fs.readdirSync(path.join(ROOT, 'integrations')) : []) {
  if (f.endsWith('.js')) {
    try { require(path.join(ROOT, 'integrations', f))(hooks, { store }); console.log('  • Đã nạp tích hợp: ' + f); }
    catch (e) { console.error('  [!] Lỗi tích hợp ' + f + ': ' + e.message); }
  }
}

// ================================================================ tiện ích
const now = () => Date.now();
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };
const orderCode = (id) => 'DH' + String(id).padStart(4, '0');
const money = (n) => Number(n || 0).toLocaleString('vi-VN') + 'đ';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const COLORS = ['#0a7cff', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#0891b2', '#ca8a04', '#4f46e5', '#be123c', '#0d9488'];
const IMG_RE = /^\/uploads\/\d{4}-\d{2}\/[a-f0-9]{32}\.(jpg|png|gif|webp)$/;
const parseJSON = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const str = (v, max = 2000) => String(v ?? '').trim().slice(0, max);
const int = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : null; };

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const data = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isBuf ? 'application/octet-stream' : typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(data);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, `File quá lớn (tối đa ${Math.round(limit / 1048576)} MB)`)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const buf = await readBody(req, 1024 * 1024);
  if (!buf.length) return {};
  const j = parseJSON(buf.toString('utf8'), null);
  if (!j || typeof j !== 'object') fail(400, 'Dữ liệu gửi lên không hợp lệ');
  return j;
}
function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setCookie(req, res, value, maxAge) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

// ================================================================ cài đặt
const DEFAULT_SETTINGS = {
  app_name: 'CTV Chat', gmail_only: '1',
  backup_hours: '1', backup_keep: '72', backup_keep_daily: '90', backup_dir2: '',
  vapid_public: '', vapid_private: '', fcm_client: '', fcm_sa: '',
  purge_img_on: '0', purge_img_days: '30', purge_cred_on: '0', purge_cred_days: '3', purge_order_on: '0', purge_order_days: '180', purge_last: '',
};
const setting = (k) => store.setting(k, DEFAULT_SETTINGS[k]);
const publicSettings = () => ({ appName: setting('app_name'), gmailOnly: setting('gmail_only') === '1' });

// ================================================================ mật khẩu & phiên đăng nhập
function hashPass(pw) {
  const salt = crypto.randomBytes(16);
  return `s1$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function checkPass(pw, stored) {
  const [v, salt, hash] = String(stored).split('$');
  if (v !== 's1') return false;
  const a = crypto.scryptSync(String(pw), Buffer.from(salt, 'hex'), 64);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  store.run('INSERT INTO sessions(token, user_id, created_at, last_used, ua) VALUES (?, ?, ?, ?, ?)',
    sha(token), userId, now(), now(), str(req.headers['user-agent'], 200));
  setCookie(req, res, token, 60 * 60 * 24 * 60);
}
function sessionUser(req) {
  const t = cookies(req).sid;
  if (!t) return null;
  const row = store.get('SELECT s.token AS s_token, s.last_used AS s_used, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?', sha(t));
  if (!row) return null;
  if (now() - row.s_used > 5 * 60e3) store.run('UPDATE sessions SET last_used = ? WHERE token = ?', now(), row.s_token);
  return row;
}
/** IP thật của người dùng. Khi chạy trên VPS sau Caddy / Nginx (cùng máy) thì lấy từ X-Forwarded-For. */
function clientIp(req) {
  const peer = req.socket.remoteAddress || '';
  const xff = req.headers['x-forwarded-for'];
  if (xff && /^(127\.|::1$|::ffff:127\.)/.test(peer)) return String(xff).split(',').pop().trim();
  return peer;
}
const loginFails = new Map(); // chống dò mật khẩu
function checkRate(key) {
  const r = loginFails.get(key);
  if (r && r.count >= 8 && now() < r.until) fail(429, 'Sai quá nhiều lần. Thử lại sau ' + Math.ceil((r.until - now()) / 60e3) + ' phút');
}
function addFail(key) {
  const r = loginFails.get(key) || { count: 0, until: 0 };
  if (now() > r.until) r.count = 0;
  r.count++;
  r.until = now() + 15 * 60e3;
  loginFails.set(key, r);
}

// ================================================================ quyền
const isAdmin = (u) => !!u && u.role === 'admin' && u.status === 'active';
const users = {
  byId: (id) => store.get('SELECT * FROM users WHERE id = ?', id),
  admins: () => store.all("SELECT id FROM users WHERE role = 'admin' AND status = 'active'").map((r) => r.id),
};
function needAdmin(u) { if (!isAdmin(u)) fail(403, 'Chỉ admin mới làm được việc này'); }

// ================================================================ dữ liệu gửi cho trình duyệt
function pubUser(u, viewer) {
  if (!u) return null;
  const self = viewer && viewer.id === u.id;
  const adm = isAdmin(viewer);
  return {
    id: u.id, name: u.name, email: adm || self ? u.email : undefined, role: u.role, isOwner: !!u.is_owner,
    status: u.status, color: u.color || COLORS[u.id % COLORS.length], avatar: u.avatar || null,
    lastSeen: u.last_seen, online: clients.has(u.id), createdAt: u.created_at, approvedAt: u.approved_at,
    phone: adm || self ? u.phone : undefined, note: adm ? u.note : undefined,
    discountPct: adm || self ? u.discount_pct || 0 : undefined,
    bank: adm || self ? bankOf(u) : undefined, bankNote: adm || self ? u.bank || null : undefined,
    notifyGroup: self ? !!u.notify_group : undefined,
  };
}
/** Thông tin ngân hàng của CTV (để hiện mã QR khi thanh toán). */
function bankOf(u) {
  if (!u || !u.bank_bin || !u.bank_acc) return null;
  const b = bankByBin.get(u.bank_bin);
  return { bin: u.bank_bin, short: b ? b.short : u.bank_bin, name: b ? b.name : '', account: u.bank_acc, holder: u.bank_holder || '' };
}
const netOf = (price, pct) => Math.round((price * (100 - (pct || 0))) / 100);
const settleCode = (id) => 'KT' + String(id).padStart(4, '0');
function pubOrder(o, viewer, { secrets = true } = {}) {
  if (!o) return null;
  return {
    id: o.id, code: orderCode(o.id), convId: o.conv_id, msgId: o.msg_id, assigneeId: o.assignee_id, createdBy: o.created_by,
    content: o.content, price: o.price, discountPct: o.discount_pct || 0, net: o.net ?? o.price,
    credentials: secrets ? o.credentials || null : undefined, deadline: o.deadline,
    status: o.status, proof: parseJSON(o.proof, []), proofPurged: o.proof_purged || 0, credPurgedAt: o.cred_purged_at || null,
    note: o.note, doneAt: o.done_at, paidAt: o.paid_at, paidBy: o.paid_by,
    settlementId: o.settlement_id || null, settlementCode: o.settlement_id ? settleCode(o.settlement_id) : null,
    createdAt: o.created_at, updatedAt: o.updated_at, deletedAt: o.deleted_at, deletedBy: o.deleted_by,
  };
}
/** Bản gửi cho tích hợp (Discord, Sheets…): không kèm tài khoản/mật khẩu. */
const hookOrder = (o) => pubOrder(o, null, { secrets: false });
function pubMsg(m) {
  return {
    id: m.id, convId: m.conv_id, senderId: m.sender_id, type: m.type,
    text: m.deleted_at ? null : m.text, images: m.deleted_at ? [] : parseJSON(m.images, []) || [],
    orderId: m.order_id, icon: m.icon || null, createdAt: m.created_at, deleted: !!m.deleted_at, imgPurged: m.deleted_at ? 0 : m.img_purged || 0,
    replyTo: m.reply_to && !m.deleted_at ? quoteOf(m.reply_to) : null,
    mentions: m.mentions && !m.deleted_at ? parseJSON(m.mentions, null) : null,
  };
}
/** Phần trích dẫn khi trả lời 1 tin (luôn lấy mới nhất: tin gốc bị thu hồi thì hiện "đã thu hồi"). */
function quoteOf(id) {
  const q = store.get('SELECT * FROM messages WHERE id = ?', id);
  if (!q) return null;
  const out = { id: q.id, senderId: q.sender_id, type: q.type, deleted: !!q.deleted_at, text: null, image: null, images: 0, orderCode: null };
  if (q.deleted_at) return out;
  if (q.type === 'order') {
    const o = store.get('SELECT content FROM orders WHERE id = ?', q.order_id);
    out.orderCode = orderCode(q.order_id);
    out.text = o ? o.content.slice(0, 160) : null;
  } else {
    const imgs = parseJSON(q.images, []) || [];
    out.text = q.text ? q.text.slice(0, 160) : null;
    out.images = imgs.length;
    out.image = imgs[0] || null;
  }
  return out;
}
function pubLog(l, viewer) {
  const d = parseJSON(l.details, {}) || {};
  delete d.customerPrice; // trường cũ (đã bỏ)
  if (d.changes) delete d.changes.customerPrice;
  return { id: l.id, at: l.at, actorId: l.actor_id, action: l.action, orderId: l.order_id, orderCode: l.order_id ? orderCode(l.order_id) : null, targetUserId: l.target_user_id, details: d };
}

function addLog(actorId, action, { orderId, targetUserId, details } = {}) {
  store.run('INSERT INTO logs(at, actor_id, action, order_id, target_user_id, details) VALUES (?, ?, ?, ?, ?, ?)',
    now(), actorId, action, orderId, targetUserId, details ? JSON.stringify(details) : null);
}

// ================================================================ thời gian thực (Server-Sent Events)
const clients = new Map(); // userId -> Set(res)
function sendTo(ids, event, payloadFor) {
  for (const id of new Set(ids)) {
    const set = clients.get(id);
    if (!set) continue;
    const data = typeof payloadFor === 'function' ? payloadFor(id) : payloadFor;
    const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of set) res.write(line);
  }
}
const allOnline = () => [...clients.keys()];
setInterval(() => { for (const set of clients.values()) for (const res of set) res.write(': ping\n\n'); }, 25e3).unref();

// Ai đang thật sự dùng app (mở trên màn hình, đang thao tác): không gửi thông báo đẩy cho họ — app đã tự hiện thanh nổi.
// userId → Map(mã cửa sổ → { on, at }). Cửa sổ báo lại mỗi ~20 giây; quá 45 giây không báo coi như đã rời đi.
const activeWins = new Map();
const cidOf = (v) => (/^[A-Za-z0-9]{8,40}$/.test(String(v || '')) ? String(v) : null);
function setActive(userId, cid, on) {
  if (!cid) return;
  if (!activeWins.has(userId)) activeWins.set(userId, new Map());
  activeWins.get(userId).set(cid, { on: !!on, at: now() });
}
function isActive(userId) {
  const m = activeWins.get(userId);
  if (!m) return false;
  for (const w of m.values()) if (w.on && now() - w.at < 45e3) return true;
  return false;
}
function handleEvents(req, res, user, query) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const cid = cidOf(query && query.cid);
  res.write('retry: 3000\n\n');
  const first = !clients.has(user.id);
  if (first) clients.set(user.id, new Set());
  clients.get(user.id).add(res);
  if (first) sendTo(allOnline(), 'presence', { userId: user.id, online: true });
  req.on('close', () => {
    if (cid && activeWins.has(user.id)) { activeWins.get(user.id).delete(cid); if (!activeWins.get(user.id).size) activeWins.delete(user.id); }
    const set = clients.get(user.id);
    if (!set) return;
    set.delete(res);
    if (!set.size) {
      clients.delete(user.id);
      store.run('UPDATE users SET last_seen = ? WHERE id = ?', now(), user.id);
      sendTo(allOnline(), 'presence', { userId: user.id, online: false, lastSeen: now() });
    }
  });
}

// ================================================================ cuộc trò chuyện
const memberIds = (convId) => store.all('SELECT user_id FROM conv_members WHERE conv_id = ?', convId).map((r) => r.user_id);
function convFor(id, user) {
  const c = store.get('SELECT * FROM convs WHERE id = ?', id);
  if (!c) fail(404, 'Không tìm thấy cuộc trò chuyện');
  if (!store.get('SELECT 1 FROM conv_members WHERE conv_id = ? AND user_id = ?', id, user.id)) fail(403, 'Bạn không ở trong cuộc trò chuyện này');
  if (memberOnlyDm(c)) fail(403, 'Chỉ admin mới nhắn riêng được');
  return c;
}
function addMember(convId, userId) {
  store.run('INSERT OR IGNORE INTO conv_members(conv_id, user_id, last_read, joined_at) VALUES (?, ?, 0, ?)', convId, userId, now());
}
function getOrCreateDm(a, b, { quiet } = {}) {
  const key = [a, b].sort((x, y) => x - y).join(':');
  let c = store.get('SELECT * FROM convs WHERE dm_key = ?', key);
  if (c) return { conv: c, created: false };
  // quiet = tạo sẵn cho admin (chưa có tin nhắn) → nằm cuối danh sách
  const id = store.insert("INSERT INTO convs(type, dm_key, created_by, created_at, last_msg_at) VALUES ('dm', ?, ?, ?, ?)", key, a, now(), quiet ? 0 : now());
  addMember(id, a);
  addMember(id, b);
  return { conv: store.get('SELECT * FROM convs WHERE id = ?', id), created: true };
}
/** Quy tắc: chỉ admin mới nhắn riêng. Tin nhắn riêng giữa 2 thành viên thường không được dùng. */
const memberOnlyDm = (c) => c.type === 'dm' && !memberIds(c.id).some((id) => isAdmin(users.byId(id)));
/** Admin luôn có sẵn đoạn chat riêng với từng CTV để lên đơn. */
function ensureAdminDms(adminId) {
  let created = false;
  for (const m of store.all("SELECT id FROM users WHERE status = 'active' AND role = 'member'")) {
    if (getOrCreateDm(adminId, m.id, { quiet: true }).created) created = true;
  }
  return created;
}
function mainGroup() { return store.get('SELECT * FROM convs WHERE is_main = 1'); }
function ensureMainGroup(ownerId) {
  let g = mainGroup();
  if (!g) {
    const id = store.insert("INSERT INTO convs(type, name, is_main, created_by, created_at, last_msg_at) VALUES ('group', 'Cả nhóm', 1, ?, ?, ?)", ownerId, now(), now());
    g = store.get('SELECT * FROM convs WHERE id = ?', id);
  }
  addMember(g.id, ownerId);
  return g;
}
function convSummary(c, user) {
  const me = store.get('SELECT last_read FROM conv_members WHERE conv_id = ? AND user_id = ?', c.id, user.id);
  const members = store.all('SELECT user_id, last_read FROM conv_members WHERE conv_id = ?', c.id);
  const last = store.get('SELECT * FROM messages WHERE conv_id = ? ORDER BY id DESC LIMIT 1', c.id);
  const unread = store.get('SELECT COUNT(*) n FROM messages WHERE conv_id = ? AND id > ? AND (sender_id IS NULL OR sender_id != ?) AND deleted_at IS NULL',
    c.id, me ? me.last_read : 0, user.id).n;
  const open = c.type === 'dm'
    ? store.get("SELECT COUNT(*) n FROM orders WHERE conv_id = ? AND status = 'open' AND deleted_at IS NULL", c.id).n : 0;
  // nhóm: có tin chưa đọc @nhắc mình (hoặc @all) không → hiện dấu @ ở danh sách chat
  const mention = c.type === 'group' && unread > 0 && !!store.get(`SELECT 1 FROM messages WHERE conv_id = ? AND id > ? AND deleted_at IS NULL AND mentions IS NOT NULL
    AND (json_extract(mentions, '$.all') = 1 OR EXISTS (SELECT 1 FROM json_each(json_extract(mentions, '$.ids')) WHERE value = ?)) LIMIT 1`, c.id, me ? me.last_read : 0, user.id);
  return {
    id: c.id, type: c.type, name: c.name, isMain: !!c.is_main, createdBy: c.created_by, mention,
    members: members.map((m) => m.user_id),
    reads: Object.fromEntries(members.map((m) => [m.user_id, m.last_read])),
    partnerId: c.type === 'dm' ? (members.find((m) => m.user_id !== user.id) || {}).user_id : null,
    lastMsg: last ? pubMsg(last) : null, lastMsgAt: c.last_msg_at, unread, openOrders: open,
  };
}
function listConvs(user) {
  return store.all('SELECT c.* FROM convs c JOIN conv_members m ON m.conv_id = c.id AND m.user_id = ? ORDER BY c.last_msg_at DESC', user.id)
    .filter((c) => !memberOnlyDm(c)).map((c) => convSummary(c, user));
}
/** Ghi 1 tin nhắn và đẩy tới mọi người trong cuộc trò chuyện. */
function postMessage(convId, senderId, { type = 'text', text = null, images = [], orderId = null, replyTo = null, mentions = null, notify = null, icon = null }) {
  const t = now();
  const id = store.insert('INSERT INTO messages(conv_id, sender_id, type, text, images, order_id, reply_to, fold, mentions, icon, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    convId, senderId, type, text, images && images.length ? JSON.stringify(images) : null, orderId, replyTo, text ? fold(text) : null, mentions ? JSON.stringify(mentions) : null, icon, t);
  store.run('UPDATE convs SET last_msg_at = ? WHERE id = ?', t, convId);
  if (senderId) store.run('UPDATE conv_members SET last_read = ? WHERE conv_id = ? AND user_id = ?', id, convId, senderId);
  const msg = pubMsg(store.get('SELECT * FROM messages WHERE id = ?', id));
  const order = orderId ? store.get('SELECT * FROM orders WHERE id = ?', orderId) : null;
  sendTo(memberIds(convId), 'msg', (uid) => ({ msg, order: order ? pubOrder(order, users.byId(uid)) : null }));
  setImmediate(() => { try { pushForMessage(convId, msg, notify); } catch (e) { console.error('[thông báo] lỗi:', e.message); } });
  return msg;
}

// ================================================================ thông báo đẩy (thanh thông báo điện thoại / máy tính, kể cả khi đã đóng app)
let vapidCache = null;
function vapid() {
  if (!vapidCache) {
    let pub = setting('vapid_public'), priv = setting('vapid_private');
    if (!pub || !priv) {
      ({ publicKey: pub, privateKey: priv } = webpush.generateVapidKeys());
      store.setSetting('vapid_public', pub);
      store.setSetting('vapid_private', priv);
    }
    vapidCache = { publicKey: pub, key: webpush.vapidKeyObject(pub, priv) };
  }
  const owner = store.get('SELECT email FROM users WHERE is_owner = 1');
  vapidCache.subject = 'mailto:' + (owner ? owner.email : 'admin@ctv-chat.local');
  return vapidCache;
}
// ---- app Android: Firebase Cloud Messaging (admin tải 2 file của Firebase lên trong Cài đặt)
const ANDROID_PKG = 'shop.gachaz.ctvchat';
const APK_URL = process.env.CTV_APK_URL || 'https://github.com/daole6868/DiscordStreamBot/releases/latest/download/CTV-Chat.apk';
const fcmClient = () => parseJSON(setting('fcm_client'), null);
const fcmSa = () => parseJSON(setting('fcm_sa'), null);
function fcmStatus() {
  const c = fcmClient(), sa = fcmSa();
  return {
    client: c ? { projectId: c.projectId, appId: c.appId } : null,
    sa: sa ? { projectId: sa.project_id, email: sa.client_email } : null,
    ready: !!(c && sa && c.projectId === sa.project_id),
    mismatch: !!(c && sa && c.projectId !== sa.project_id),
    devices: store.get("SELECT COUNT(*) n FROM push_subs WHERE kind = 'fcm'").n,
    pkg: ANDROID_PKG, apk: APK_URL,
  };
}
/** Tên máy dễ đọc từ User-Agent (để báo kết quả "Gửi thử"). */
function deviceName(ua) {
  ua = String(ua || '');
  if (/CTVChatApp/.test(ua)) return 'App Android CTV Chat';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Máy';
  const br = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? `${os} · ${br}` : os;
}
/** Gửi tới mọi máy đã bật thông báo của các người dùng này. Trả về kết quả từng máy (không cần chờ). */
function pushTo(userIds, payload, topic) {
  const ids = [...new Set(userIds)].filter((id) => { const u = users.byId(id); return u && u.status === 'active'; });
  if (!ids.length) return Promise.resolve([]);
  const subs = store.all('SELECT * FROM push_subs WHERE user_id IN (SELECT value FROM json_each(?))', JSON.stringify(ids));
  if (!subs.length) return Promise.resolve([]);
  const v = subs.some((s) => s.kind !== 'fcm') ? vapid() : null;
  const sa = subs.some((s) => s.kind === 'fcm') ? fcmSa() : null;
  const sendOne = (sub) => {
    if (sub.kind !== 'fcm') return webpush.send(sub, payload, v, { topic });
    if (!sa) return Promise.resolve({ status: 0, error: 'Admin chưa cài Firebase (Cài đặt → Thông báo app Android)' });
    return fcm.send(sa, sub.endpoint.slice(4), payload);
  };
  return Promise.all(subs.map((sub) => sendOne(sub).then((r) => {
    if (r.status >= 200 && r.status < 300) store.run('UPDATE push_subs SET last_ok = ?, fails = 0 WHERE id = ?', now(), sub.id);
    else {
      console.error(`  [thông báo] gửi tới ${deviceName(sub.ua)} của người dùng #${sub.user_id} lỗi: ${r.status || ''} ${r.error || ''}`);
      if (r.status === 404 || r.status === 410 || r.gone) store.run('DELETE FROM push_subs WHERE id = ?', sub.id); // máy đã tắt / gỡ app
      else {
        store.run('UPDATE push_subs SET fails = fails + 1 WHERE id = ?', sub.id);
        if (sub.fails >= 30) store.run('DELETE FROM push_subs WHERE id = ?', sub.id);
      }
    }
    return { device: deviceName(sub.ua), status: r.status, error: r.error || null };
  }).catch((e) => ({ device: deviceName(sub.ua), status: 0, error: e.message }))));
}
/** Ai nhận thông báo cho 1 tin: chat riêng → người kia; nhóm → người được @nhắc (admin @all = cả nhóm) + người bật "báo mọi tin trong nhóm". */
function pushForMessage(convId, m, notifyIds) {
  const c = store.get('SELECT * FROM convs WHERE id = ?', convId);
  if (!c) return;
  const sender = m.senderId ? users.byId(m.senderId) : null;
  const others = memberIds(convId).filter((id) => id !== m.senderId);
  const men = m.mentions || { all: false, ids: [] };
  let targets;
  if (notifyIds) targets = notifyIds.filter((id) => others.includes(id));
  else if (c.type === 'dm') targets = others;
  else if (m.type === 'system') targets = [];
  else targets = others.filter((id) => men.all || men.ids.includes(id) || (users.byId(id) || {}).notify_group);
  targets = targets.filter((id) => !isActive(id)); // đang dùng app → đã có thanh nổi trong app, không gửi trùng
  if (!targets.length) return;
  const who = sender ? sender.name : setting('app_name');
  const groupName = c.type === 'group' ? c.name || 'Nhóm' : null;
  let title, body;
  if (m.type === 'order') {
    const o = store.get('SELECT * FROM orders WHERE id = ?', m.orderId);
    title = `Đơn mới ${orderCode(m.orderId)}${sender ? ' · ' + sender.name : ''}`;
    body = o ? `${o.content.slice(0, 140)} — thực nhận ${money(o.net ?? o.price)}` : '';
  } else {
    title = groupName ? `${who} · ${groupName}` : who;
    body = m.text || (m.images.length ? `Đã gửi ${m.images.length} ảnh` : '');
  }
  const base = { title, body: body.slice(0, 200), url: `/#/chat/${convId}`, tag: `conv-${convId}`, convId };
  const topic = `conv${convId}`;
  if (c.type === 'group') {
    const mentioned = targets.filter((id) => men.all || men.ids.includes(id));
    pushTo(mentioned, { ...base, title: groupName, body: `${who} ${men.all ? 'nhắc @Tất cả' : 'nhắc đến bạn'}: ${body}`.slice(0, 200) }, topic);
    targets = targets.filter((id) => !mentioned.includes(id));
  }
  pushTo(targets, base, topic);
}

// ================================================================ đơn hàng
function orderFor(id, user, { write } = {}) {
  const o = store.get('SELECT * FROM orders WHERE id = ?', id);
  if (!o) fail(404, 'Không tìm thấy đơn');
  if (!isAdmin(user) && o.assignee_id !== user.id) fail(403, 'Đơn này không phải của bạn');
  if (write && o.deleted_at) fail(400, 'Đơn đã bị xoá');
  return o;
}
function broadcastOrder(orderId) {
  const o = store.get('SELECT * FROM orders WHERE id = ?', orderId);
  sendTo([...memberIds(o.conv_id), ...users.admins()], 'order', (uid) => ({ order: pubOrder(o, users.byId(uid)) }));
  return o;
}
function sysMsg(o, actorId, text, icon) { return postMessage(o.conv_id, actorId, { type: 'system', text, orderId: o.id, icon }); }
const fmtDeadline = (t) => {
  if (!t) return 'không có';
  const d = new Date(t + 7 * 3600e3);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}`;
};

const ORDER_FILTERS = {
  open: "o.status = 'open' AND o.deleted_at IS NULL",
  done: "o.status = 'done' AND o.deleted_at IS NULL",
  unpaid: "o.status = 'done' AND o.paid_at IS NULL AND o.deleted_at IS NULL",
  paid: "o.status = 'done' AND o.paid_at IS NOT NULL AND o.deleted_at IS NULL",
  deleted: 'o.deleted_at IS NOT NULL',
  all: 'o.deleted_at IS NULL',
};
function queryOrders(user, q) {
  const where = [ORDER_FILTERS[q.status] || ORDER_FILTERS.all];
  const params = [];
  if (!isAdmin(user)) { where.push('o.assignee_id = ?'); params.push(user.id); if (q.status === 'deleted') where.push('0'); }
  else if (q.assignee) { where.push('o.assignee_id = ?'); params.push(int(q.assignee)); }
  if (q.doneFrom) { where.push('o.done_at >= ?'); params.push(int(q.doneFrom)); }
  if (q.doneTo) { where.push('o.done_at < ?'); params.push(int(q.doneTo)); }
  if (q.q) {
    const s = str(q.q, 100);
    const m = s.match(/^#?dh0*(\d+)$/i);
    if (m) { where.push('o.id = ?'); params.push(Number(m[1])); }
    else { where.push('(o.content LIKE ? OR o.note LIKE ? OR u.name LIKE ?)'); params.push(`%${s}%`, `%${s}%`, `%${s}%`); }
  }
  const limit = Math.min(2000, int(q.limit) || 300);
  return store.all(`SELECT o.* FROM orders o JOIN users u ON u.id = o.assignee_id WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(o.done_at, o.created_at) DESC, o.id DESC LIMIT ${limit}`, ...params);
}

function ordersCsv(rows) {
  const names = new Map(store.all('SELECT id, name, email FROM users').map((u) => [u.id, u]));
  const t = (v) => (v ? new Date(v + 7 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : '');
  const esc = (v) => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ['Mã đơn', 'CTV', 'Email', 'Nội dung', 'Tiền công', 'Chiết khấu %', 'Thực nhận', 'Trạng thái', 'Kết toán', 'Tạo lúc', 'Xong lúc', 'Thanh toán lúc', 'Ghi chú'];
  const lines = [head.map(esc).join(',')];
  for (const o of rows) {
    const u = names.get(o.assignee_id) || {};
    const status = o.deleted_at ? 'Đã xoá' : o.status === 'open' ? 'Đang làm' : o.paid_at ? 'Đã thanh toán' : o.settlement_id ? 'Chờ thanh toán' : 'Hoàn thành';
    lines.push([orderCode(o.id), u.name, u.email, o.content, o.price, o.discount_pct || 0, o.net ?? o.price, status,
      o.settlement_id ? settleCode(o.settlement_id) : '', t(o.created_at), t(o.done_at), t(o.paid_at), o.note].map(esc).join(','));
  }
  return '\ufeff' + lines.join('\r\n'); // BOM để Excel hiện đúng Tiếng Việt
}

// ================================================================ doanh thu (theo giờ Việt Nam, tuần bắt đầu thứ Hai)
const VN = 7 * 3600e3, DAY = 86400e3;
const vnStart = (y, m, d) => Date.UTC(y, m, d) - VN;
function vnParts(t) { const d = new Date(t + VN); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: (d.getUTCDay() + 6) % 7 }; }
const isoDay = (t) => new Date(t + VN).toISOString().slice(0, 10);
const dd = (t) => { const p = vnParts(t); return `${String(p.d).padStart(2, '0')}/${String(p.m + 1).padStart(2, '0')}`; };
function periodRange(period, anchor) {
  const a = /^\d{4}-\d{2}-\d{2}$/.test(anchor || '') ? Date.UTC(...anchor.split('-').map((v, i) => (i === 1 ? v - 1 : +v))) - VN : now();
  const p = vnParts(a);
  let from, to, prev, next, label, buckets = [];
  const WD = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  if (period === 'year') {
    from = vnStart(p.y, 0, 1); to = vnStart(p.y + 1, 0, 1);
    prev = vnStart(p.y - 1, 0, 1); next = to; label = `Năm ${p.y}`;
    for (let m = 0; m < 12; m++) buckets.push({ from: vnStart(p.y, m, 1), to: vnStart(p.y, m + 1, 1), label: `Tháng ${m + 1}`, short: `T${m + 1}` });
  } else if (period === 'month') {
    from = vnStart(p.y, p.m, 1); to = vnStart(p.y, p.m + 1, 1);
    prev = vnStart(p.y, p.m - 1, 1); next = to; label = `Tháng ${p.m + 1}/${p.y}`;
    for (let t = from; t < to; t += DAY) buckets.push({ from: t, to: t + DAY, label: dd(t), short: String(vnParts(t).d) });
  } else {
    period = 'week';
    from = vnStart(p.y, p.m, p.d - p.dow); to = from + 7 * DAY;
    prev = from - 7 * DAY; next = to; label = `${dd(from)} – ${dd(to - DAY)}/${vnParts(to - DAY).y}`;
    for (let i = 0; i < 7; i++) buckets.push({ from: from + i * DAY, to: from + (i + 1) * DAY, label: `${WD[i]} ${dd(from + i * DAY)}`, short: WD[i] });
  }
  return { period, from, to, label, buckets, prevAnchor: isoDay(prev), prevFrom: prev, nextAnchor: isoDay(next), isCurrent: now() >= from && now() < to };
}
function revenue(user, q) {
  const r = periodRange(q.period, q.anchor);
  const adm = isAdmin(user);
  const uid = adm ? int(q.userId) : user.id;
  const cond = "status = 'done' AND deleted_at IS NULL AND done_at >= ? AND done_at < ?" + (uid ? ' AND assignee_id = ?' : '');
  const args = (f, t) => (uid ? [f, t, uid] : [f, t]);
  const rows = store.all(`SELECT * FROM orders WHERE ${cond} ORDER BY done_at DESC`, ...args(r.from, r.to));
  const prev = store.get(`SELECT COUNT(*) n, COALESCE(SUM(net), 0) s FROM orders WHERE ${cond}`, ...args(r.prevFrom, r.from));
  // đơn admin đã giao, CTV chưa bấm Done → hiện ra nhưng KHÔNG tính vào doanh thu
  const openRows = store.all(`SELECT * FROM orders WHERE status = 'open' AND deleted_at IS NULL${uid ? ' AND assignee_id = ?' : ''} ORDER BY created_at DESC`, ...(uid ? [uid] : []));
  const sum = (list, f) => list.reduce((t, o) => t + (f(o) || 0), 0);
  const totals = {
    count: rows.length, gross: sum(rows, (o) => o.price), total: sum(rows, (o) => o.net),
    paid: sum(rows, (o) => (o.paid_at ? o.net : 0)),
    pending: sum(rows, (o) => (!o.paid_at && o.settlement_id ? o.net : 0)),
    unsettled: sum(rows, (o) => (!o.paid_at && !o.settlement_id ? o.net : 0)),
    prevTotal: prev.s, prevCount: prev.n,
  };
  totals.unpaid = totals.pending + totals.unsettled;
  totals.discount = totals.gross - totals.total;
  const series = r.buckets.map((b) => {
    const list = rows.filter((o) => o.done_at >= b.from && o.done_at < b.to);
    return { label: b.label, short: b.short, from: b.from, total: sum(list, (o) => o.net), count: list.length };
  });
  let byUser = null;
  if (adm && !uid) {
    const map = new Map();
    const blank = (id) => ({ userId: id, discountPct: (users.byId(id) || {}).discount_pct || 0, count: 0, gross: 0, total: 0, paid: 0, unpaid: 0, openCount: 0, openTotal: 0 });
    for (const u of store.all("SELECT id FROM users WHERE status = 'active' AND role = 'member'")) map.set(u.id, blank(u.id));
    for (const o of openRows) {
      if (!map.has(o.assignee_id)) map.set(o.assignee_id, blank(o.assignee_id));
      const m = map.get(o.assignee_id);
      m.openCount++; m.openTotal += o.net;
    }
    for (const o of rows) {
      if (!map.has(o.assignee_id)) map.set(o.assignee_id, blank(o.assignee_id));
      const m = map.get(o.assignee_id);
      m.count++; m.gross += o.price; m.total += o.net;
      if (o.paid_at) m.paid += o.net; else m.unpaid += o.net;
    }
    byUser = [...map.values()].sort((a, b) => b.total - a.total || b.openTotal - a.openTotal || b.count - a.count);
  }
  return {
    period: r.period, label: r.label, from: r.from, to: r.to, prevAnchor: r.prevAnchor, nextAnchor: r.nextAnchor, isCurrent: r.isCurrent,
    userId: uid || null, totals, open: { count: openRows.length, total: sum(openRows, (o) => o.net), gross: sum(openRows, (o) => o.price) },
    series, byUser,
    orders: rows.slice(0, 500).map((o) => pubOrder(o, user)),
    openOrders: openRows.slice(0, 300).map((o) => pubOrder(o, user)),
  };
}
function userSummary(uid, viewer) {
  const w = periodRange('week'), m = periodRange('month');
  const agg = (f, t) => store.get("SELECT COUNT(*) n, COALESCE(SUM(net), 0) s FROM orders WHERE assignee_id = ? AND status = 'done' AND deleted_at IS NULL AND done_at >= ? AND done_at < ?", uid, f, t);
  const unpaid = store.get("SELECT COUNT(*) n, COALESCE(SUM(net), 0) s FROM orders WHERE assignee_id = ? AND status = 'done' AND paid_at IS NULL AND deleted_at IS NULL", uid);
  const open = store.all("SELECT * FROM orders WHERE assignee_id = ? AND status = 'open' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50", uid);
  const wk = agg(w.from, w.to), mo = agg(m.from, m.to);
  return {
    user: pubUser(users.byId(uid), viewer),
    week: { count: wk.n, total: wk.s }, month: { count: mo.n, total: mo.s }, unpaid: { count: unpaid.n, total: unpaid.s },
    open: open.map((o) => pubOrder(o, viewer)),
  };
}

// ================================================================ kết toán lương
const settleTotals = (id) => store.get("SELECT COUNT(*) n, COALESCE(SUM(net), 0) s, COALESCE(SUM(price), 0) g FROM orders WHERE settlement_id = ? AND status = 'done' AND deleted_at IS NULL", id);
function settleMemo(s) {
  const tag = s.period_key ? ` T${Number(s.period_key.slice(5))} ${s.period_key.slice(0, 4)}` : '';
  return safeMemo(`LUONG ${settleCode(s.id)}${tag}`);
}
function pubSettlement(s, viewer) {
  const adm = isAdmin(viewer);
  const t = s.status === 'paid' ? { n: s.order_count, s: s.amount, g: s.gross } : settleTotals(s.id);
  const bank = s.status === 'paid' ? parseJSON(s.bank_snapshot, null) : bankOf(users.byId(s.user_id));
  const memo = settleMemo(s);
  const canSee = adm || (viewer && viewer.id === s.user_id);
  return {
    id: s.id, code: settleCode(s.id), userId: s.user_id, label: s.label, periodKey: s.period_key, cutoff: s.cutoff, auto: !!s.auto,
    status: s.status, amount: t.s || 0, gross: t.g || 0, count: t.n || 0, createdAt: s.created_at, createdBy: s.created_by,
    paidAt: s.paid_at, paidBy: s.paid_by, memo, bank: canSee ? bank : null,
    qr: adm && s.status === 'pending' && bank && t.s > 0 ? vietqrPayload({ bin: bank.bin, account: bank.account, amount: t.s, memo }) : null,
  };
}
/** Tin nhắn hệ thống báo cho CTV trong đoạn chat riêng với admin. */
function settleMsg(userId, actorId, text, icon) {
  const owner = store.get('SELECT id FROM users WHERE is_owner = 1');
  const adminId = actorId && isAdmin(users.byId(actorId)) ? actorId : owner && owner.id;
  if (!adminId || adminId === userId) return;
  const { conv } = getOrCreateDm(adminId, userId);
  postMessage(conv.id, null, { type: 'system', text, notify: [userId], icon });
}
function broadcastSettlement(s, extra = {}) {
  sendTo([s.user_id, ...users.admins()], 'settlement', (uid) => ({ settlement: pubSettlement(s, users.byId(uid)), ...extra }));
}
function createSettlement(userId, { cutoff, label, periodKey = null, auto = false, actorId = null }) {
  const ids = store.all(`SELECT id FROM orders WHERE assignee_id = ? AND status = 'done' AND deleted_at IS NULL
    AND settlement_id IS NULL AND paid_at IS NULL AND done_at < ?`, userId, cutoff).map((r) => r.id);
  if (!ids.length) return null;
  const sid = store.tx(() => {
    const sid = store.insert('INSERT INTO settlements(user_id, label, period_key, cutoff, auto, status, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      userId, label, periodKey, cutoff, auto ? 1 : 0, 'pending', now(), actorId);
    store.run('UPDATE orders SET settlement_id = ? WHERE id IN (SELECT value FROM json_each(?))', sid, JSON.stringify(ids));
    const t = settleTotals(sid);
    addLog(actorId, 'settlement.create', { targetUserId: userId, details: { code: settleCode(sid), label, auto, count: t.n, amount: t.s } });
    return sid;
  });
  const t = settleTotals(sid);
  settleMsg(userId, actorId, `Đã kết toán lương ${label.charAt(0).toLowerCase() + label.slice(1)}: ${t.n} đơn · thực nhận ${money(t.s)} — chờ admin thanh toán (${settleCode(sid)})`, 'clipboard');
  for (const id of ids) broadcastOrder(id);
  broadcastSettlement(store.get('SELECT * FROM settlements WHERE id = ?', sid));
  return sid;
}
/** Bỏ đơn khỏi kết toán đang chờ (khi admin mở lại / xoá đơn). Kết toán rỗng thì tự huỷ. */
function unlinkFromSettlement(o, actorId) {
  if (!o.settlement_id || o.paid_at) return;
  const sid = o.settlement_id;
  store.run('UPDATE orders SET settlement_id = NULL WHERE id = ?', o.id);
  const s = store.get('SELECT * FROM settlements WHERE id = ?', sid);
  if (!s) return;
  if (!settleTotals(sid).n) {
    store.run('UPDATE orders SET settlement_id = NULL WHERE settlement_id = ?', sid);
    store.run('DELETE FROM settlements WHERE id = ?', sid);
    addLog(actorId, 'settlement.cancel', { targetUserId: s.user_id, details: { code: settleCode(sid), label: s.label, auto: true } });
    setImmediate(() => sendTo([s.user_id, ...users.admins()], 'settlement', { deleted: sid }));
  } else setImmediate(() => broadcastSettlement(s));
}
/** Cuối tháng: tự kết toán tháng trước cho mọi CTV còn đơn chưa kết toán. */
function autoSettle() {
  try {
    if (!store.get('SELECT COUNT(*) n FROM users').n) return;
    const p = vnParts(now());
    const monthStart = vnStart(p.y, p.m, 1);
    const prev = vnParts(monthStart - 1);
    const key = `${prev.y}-${String(prev.m + 1).padStart(2, '0')}`;
    if (store.setting('settle_auto_last', '') === key) return;
    const label = `Tháng ${prev.m + 1}/${prev.y}`;
    const who = store.all(`SELECT DISTINCT assignee_id id FROM orders WHERE status = 'done' AND deleted_at IS NULL
      AND settlement_id IS NULL AND paid_at IS NULL AND done_at < ?`, monthStart);
    for (const u of who) createSettlement(u.id, { cutoff: monthStart, label, periodKey: key, auto: true });
    store.setSetting('settle_auto_last', key);
    if (who.length) console.log(`  • Đã tự kết toán ${label} cho ${who.length} CTV`);
  } catch (e) {
    console.error('[kết toán] ' + e.message);
  }
}

// ================================================================ API
const routes = [];
const route = (method, pattern, auth, fn) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, auth, fn });
};

// ---------------------------------------------------------------- đăng nhập / đăng ký
route('GET', '/api/me', 'none', ({ user }) => ({
  user: user ? pubUser(user, user) : null,
  needSetup: store.get('SELECT COUNT(*) n FROM users').n === 0,
  settings: publicSettings(),
}));

route('POST', '/api/auth/register', 'none', ({ req, res, body }) => {
  const email = str(body.email, 120).toLowerCase();
  const name = str(body.name, 40);
  const pw = String(body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Email không hợp lệ');
  if (setting('gmail_only') === '1' && !/@gmail\.com$/.test(email)) fail(400, 'Chỉ nhận đăng ký bằng Gmail (@gmail.com)');
  if (name.length < 2) fail(400, 'Tên quá ngắn');
  if (pw.length < 6) fail(400, 'Mật khẩu cần ít nhất 6 ký tự');
  if (store.get('SELECT 1 FROM users WHERE email = ?', email)) fail(409, 'Email này đã đăng ký. Hãy đăng nhập.');
  const first = store.get('SELECT COUNT(*) n FROM users').n === 0;
  const id = store.tx(() => {
    const id = store.insert(`INSERT INTO users(email, name, pass, role, is_owner, status, created_at, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      email, name, hashPass(pw), first ? 'admin' : 'member', first ? 1 : 0, first ? 'active' : 'pending', now(), first ? now() : null);
    if (first) { ensureMainGroup(id); addLog(id, 'user.setup', { targetUserId: id }); }
    else addLog(id, 'user.register', { targetUserId: id, details: { email } });
    return id;
  });
  if (first) try { backup.create('tu-dong'); } catch {}
  else sendTo(users.admins(), 'users', { pending: pendingCount() });
  createSession(req, res, id);
  return { user: pubUser(users.byId(id), { id }) };
});

route('POST', '/api/auth/login', 'none', ({ req, res, body }) => {
  const email = str(body.email, 120).toLowerCase();
  const key = clientIp(req) + '|' + email;
  checkRate(key);
  const u = store.get('SELECT * FROM users WHERE email = ?', email);
  if (!u || !checkPass(body.password || '', u.pass)) { addFail(key); fail(401, 'Sai email hoặc mật khẩu'); }
  loginFails.delete(key);
  if (u.status === 'rejected') fail(403, 'Yêu cầu tham gia của bạn đã bị admin từ chối');
  if (u.status === 'locked') fail(403, 'Tài khoản đã bị khoá. Liên hệ admin.');
  createSession(req, res, u.id);
  return { user: pubUser(u, u) };
});

route('POST', '/api/auth/logout', 'none', ({ req, res }) => {
  const t = cookies(req).sid;
  if (t) store.run('DELETE FROM sessions WHERE token = ?', sha(t));
  setCookie(req, res, '', 0);
  return { ok: true };
});

// ---------------------------------------------------------------- khởi động giao diện
const pendingCount = () => store.get("SELECT COUNT(*) n FROM users WHERE status = 'pending'").n;
route('GET', '/api/bootstrap', 'active', ({ user }) => (isAdmin(user) && ensureAdminDms(user.id), {
  me: pubUser(user, user),
  settings: publicSettings(),
  users: store.all(`SELECT * FROM users WHERE status IN ('active', 'locked') OR id IN (SELECT DISTINCT assignee_id FROM orders)`).map((u) => pubUser(u, user)),
  convs: listConvs(user),
  pending: isAdmin(user) ? pendingCount() : 0,
  settlePending: isAdmin(user) ? store.get("SELECT COUNT(*) n FROM settlements WHERE status = 'pending'").n
    : store.get("SELECT COUNT(*) n FROM settlements WHERE status = 'pending' AND user_id = ?", user.id).n,
}));

// ---------------------------------------------------------------- tin nhắn
route('GET', '/api/convs', 'active', ({ user }) => listConvs(user));

route('POST', '/api/convs/dm', 'active', ({ user, body }) => {
  const other = users.byId(int(body.userId));
  if (!other || other.status !== 'active' || other.id === user.id) fail(400, 'Không nhắn được cho người này');
  if (!isAdmin(user) && !isAdmin(other)) fail(403, 'Chỉ admin mới nhắn riêng được. Bạn có thể nhắn riêng cho admin hoặc nhắn trong nhóm.');
  const { conv, created } = getOrCreateDm(user.id, other.id);
  if (created) sendTo([other.id], 'conv', { convId: conv.id });
  return convSummary(conv, user);
});

route('POST', '/api/convs/group', 'admin', ({ user, body }) => {
  const name = str(body.name, 60);
  if (!name) fail(400, 'Nhập tên nhóm');
  const ids = [...new Set([user.id, ...(body.memberIds || []).map(int)])].filter((id) => { const u = users.byId(id); return u && u.status === 'active'; });
  const id = store.tx(() => {
    const id = store.insert("INSERT INTO convs(type, name, created_by, created_at, last_msg_at) VALUES ('group', ?, ?, ?, ?)", name, user.id, now(), now());
    ids.forEach((uid) => addMember(id, uid));
    return id;
  });
  postMessage(id, user.id, { type: 'system', text: `${user.name} đã tạo nhóm “${name}”`, icon: 'group' });
  sendTo(ids, 'conv', { convId: id });
  return convSummary(store.get('SELECT * FROM convs WHERE id = ?', id), user);
});

route('PATCH', '/api/convs/:id', 'admin', ({ user, params, body }) => {
  const c = store.get('SELECT * FROM convs WHERE id = ?', int(params.id));
  if (!c || c.type !== 'group') fail(404, 'Không tìm thấy nhóm');
  const before = memberIds(c.id);
  store.tx(() => {
    if (body.name !== undefined && str(body.name, 60)) store.run('UPDATE convs SET name = ? WHERE id = ?', str(body.name, 60), c.id);
    for (const uid of (body.addIds || []).map(int)) { const u = users.byId(uid); if (u && u.status === 'active') addMember(c.id, uid); }
    if (!c.is_main) for (const uid of (body.removeIds || []).map(int)) if (uid !== user.id) store.run('DELETE FROM conv_members WHERE conv_id = ? AND user_id = ?', c.id, uid);
  });
  sendTo([...new Set([...before, ...memberIds(c.id)])], 'conv', { convId: c.id });
  return convSummary(store.get('SELECT * FROM convs WHERE id = ?', c.id), user);
});

route('GET', '/api/convs/:id/messages', 'active', ({ user, params, query }) => {
  const c = convFor(int(params.id), user);
  const limit = Math.min(100, int(query.limit) || 40);
  const before = int(query.before);
  const until = int(query.until);
  let rows, hasMore;
  if (before && until && until < before) {
    // tải liền mạch từ tin cũ nhất đang có tới tin cần nhảy tới (+ vài tin trước đó cho dễ đọc)
    const older = store.all('SELECT * FROM messages WHERE conv_id = ? AND id < ? ORDER BY id DESC LIMIT 11', c.id, until);
    rows = store.all('SELECT * FROM messages WHERE conv_id = ? AND id < ? AND id >= ? ORDER BY id DESC LIMIT 5000', c.id, before, until).concat(older.slice(0, 10));
    hasMore = older.length > 10;
  } else {
    rows = store.all(`SELECT * FROM messages WHERE conv_id = ? ${before ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT ${limit + 1}`, ...(before ? [c.id, before] : [c.id]));
    hasMore = rows.length > limit;
    rows = rows.slice(0, limit);
  }
  const list = rows.reverse();
  const ids = [...new Set(list.map((m) => m.order_id).filter(Boolean))];
  const orders = ids.length ? store.all('SELECT * FROM orders WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(ids)) : [];
  return { messages: list.map(pubMsg), orders: orders.map((o) => pubOrder(o, user)), hasMore };
});

route('POST', '/api/convs/:id/messages', 'active', ({ user, params, body }) => {
  const c = convFor(int(params.id), user);
  const text = str(body.text, 4000);
  const images = (Array.isArray(body.images) ? body.images : []).filter((u) => IMG_RE.test(u)).slice(0, 10);
  if (!text && !images.length) fail(400, 'Tin nhắn trống');
  // trả lời 1 tin cũ: tin đó phải cùng đoạn chat, không phải tin hệ thống
  const rid = int(body.replyTo);
  const r = rid ? store.get("SELECT id FROM messages WHERE id = ? AND conv_id = ? AND type != 'system'", rid, c.id) : null;
  // @nhắc tên (chỉ trong nhóm): @thành viên ai cũng dùng được, @all chỉ admin
  let mentions = null;
  if (c.type === 'group') {
    const mem = new Set(memberIds(c.id));
    const ids = [...new Set((Array.isArray(body.mentions) ? body.mentions : []).map(int))].filter((id) => id && id !== user.id && mem.has(id)).slice(0, 100);
    const all = !!body.mentionAll && isAdmin(user);
    if (ids.length || all) mentions = { all, ids };
  }
  return postMessage(c.id, user.id, { type: 'text', text: text || null, images, replyTo: r ? r.id : null, mentions });
});

// ---------------------------------------------------------------- thông báo đẩy: đăng ký thiết bị
route('GET', '/api/push/key', 'active', () => ({ key: vapid().publicKey }));
route('POST', '/api/push/subscribe', 'active', ({ req, user, body }) => {
  const sub = body.sub || {};
  const endpoint = str(sub.endpoint, 1000);
  let u;
  try { u = new URL(endpoint); } catch { fail(400, 'Đăng ký thông báo không hợp lệ'); }
  if (u.protocol !== 'https:') fail(400, 'Đăng ký thông báo không hợp lệ');
  const keys = sub.keys || {};
  const p256dh = String(keys.p256dh || ''), auth = String(keys.auth || '');
  if (!/^[A-Za-z0-9_-]{80,100}={0,2}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}={0,2}$/.test(auth)) fail(400, 'Đăng ký thông báo không hợp lệ');
  store.run(`INSERT INTO push_subs(user_id, endpoint, p256dh, auth, ua, created_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua, fails = 0`,
  user.id, endpoint, p256dh.replace(/=+$/, ''), auth.replace(/=+$/, ''), str(req.headers['user-agent'], 300), now());
  return { ok: true, devices: store.get('SELECT COUNT(*) n FROM push_subs WHERE user_id = ?', user.id).n };
});
// app Android: cấu hình Firebase (công khai) + link tải app
route('GET', '/api/app/config', 'none', () => {
  const c = fcmClient(), sa = fcmSa();
  return { fcm: c && sa && c.projectId === sa.project_id ? c : null, apk: APK_URL, pkg: ANDROID_PKG };
});
route('POST', '/api/push/native', 'active', ({ req, user, body }) => {
  const token = String(body.token || '');
  if (!/^[A-Za-z0-9_:.-]{20,4096}$/.test(token)) fail(400, 'Mã thiết bị không hợp lệ');
  const ua = str(req.headers['user-agent'], 300);
  store.tx(() => {
    store.run(`INSERT INTO push_subs(user_id, endpoint, p256dh, auth, ua, created_at, kind) VALUES (?, ?, '', '', ?, ?, 'fcm')
      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, ua = excluded.ua, kind = 'fcm', fails = 0`, user.id, 'fcm:' + token, ua, now());
    // đã có app thật trên điện thoại → bỏ thông báo qua Chrome của điện thoại Android (tránh báo 2 lần)
    if (/Android/.test(ua)) store.run("DELETE FROM push_subs WHERE user_id = ? AND kind = 'web' AND ua LIKE '%Android%'", user.id);
  });
  return { ok: true, devices: store.get('SELECT COUNT(*) n FROM push_subs WHERE user_id = ?', user.id).n };
});
route('POST', '/api/push/unsubscribe', 'active', ({ user, body }) => {
  store.run('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?', str(body.endpoint, 1000), user.id);
  return { ok: true };
});
route('POST', '/api/push/test', 'active', async ({ user }) => {
  const n = store.get('SELECT COUNT(*) n FROM push_subs WHERE user_id = ?', user.id).n;
  if (!n) fail(400, 'Chưa có máy nào bật thông báo');
  const results = await pushTo([user.id], { title: 'Thử thông báo', body: 'Thông báo đã hoạt động! Tin nhắn và đơn mới sẽ hiện như thế này.', url: '/#/account', tag: 'test', force: true });
  return { devices: results.length, ok: results.filter((r) => r.status >= 200 && r.status < 300).length, results };
});

// ---------------------------------------------------------------- tìm kiếm: tin nhắn, đơn, tài khoản/mật khẩu, thành viên, kết toán
// Mỗi người chỉ tìm thấy những gì mình được xem: tin nhắn trong đoạn chat mình đang ở; CTV chỉ thấy đơn / kết toán của mình.
function searchTerms(q) {
  return fold(q).split(/\s+/).filter(Boolean).slice(0, 6)
    .map((t) => { const m = /^(dh|kt)0*(\d{1,6})$/.exec(t); return m ? m[1] + m[2].padStart(4, '0') : t; });
}
const likeOf = (t) => '%' + t.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
const hasAll = (hay, terms) => terms.every((t) => hay.includes(t));
route('GET', '/api/search', 'active', ({ user, query }) => {
  const q = str(query.q, 100);
  const terms = searchTerms(q);
  const type = ['all', 'msg', 'order', 'cred', 'user', 'settle'].includes(query.type) ? query.type : 'all';
  const out = { q, terms, messages: [], orders: [], users: [], settlements: [], more: {} };
  if (!terms.length || terms.join('').length < 2) return out;
  const adm = isAdmin(user);
  let convIds = store.all('SELECT c.* FROM convs c JOIN conv_members m ON m.conv_id = c.id AND m.user_id = ?', user.id).filter((c) => !memberOnlyDm(c)).map((c) => c.id);
  const scope = int(query.convId);
  if (scope) { if (!convIds.includes(scope)) fail(403, 'Bạn không ở trong cuộc trò chuyện này'); convIds = [scope]; }
  const lim = type === 'all' ? 8 : 30;
  if ((type === 'all' || type === 'msg') && convIds.length) {
    const before = int(query.before);
    const rows = store.all(`SELECT * FROM messages WHERE conv_id IN (SELECT value FROM json_each(?)) AND type = 'text' AND deleted_at IS NULL
      AND ${terms.map(() => "fold LIKE ? ESCAPE '\\'").join(' AND ')} ${before ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT ${lim + 1}`,
    JSON.stringify(convIds), ...terms.map(likeOf), ...(before ? [before] : []));
    out.more.messages = rows.length > lim;
    out.messages = rows.slice(0, lim).map(pubMsg);
  }
  if (type === 'all' || type === 'order' || type === 'cred') {
    const rows = adm ? store.all('SELECT * FROM orders ORDER BY id DESC') : store.all('SELECT * FROM orders WHERE assignee_id = ? AND deleted_at IS NULL ORDER BY id DESC', user.id);
    const hits = rows.filter((o) => {
      if (scope && o.conv_id !== scope) return false;
      const cred = fold(o.credentials);
      if (type === 'cred') return !!cred && hasAll(cred, terms);
      return hasAll([fold(orderCode(o.id)), fold(o.content), fold(o.note), cred, o.settlement_id ? fold(settleCode(o.settlement_id)) : '',
        adm ? fold((users.byId(o.assignee_id) || {}).name) : ''].join('\n'), terms);
    });
    const offset = Math.max(0, int(query.offset) || 0);
    out.more.orders = hits.length > offset + lim;
    out.orders = hits.slice(offset, offset + lim).map((o) => pubOrder(o, user));
  }
  if (adm && !scope && (type === 'all' || type === 'user')) {
    out.users = store.all('SELECT * FROM users ORDER BY name')
      .filter((u) => hasAll(fold([u.name, u.email, u.phone, u.bank_acc, u.bank_holder, u.note].join('\n')), terms))
      .slice(0, type === 'all' ? 5 : 50).map((u) => pubUser(u, user));
  }
  if (!scope && (type === 'all' || type === 'settle')) {
    const rows = adm ? store.all('SELECT * FROM settlements ORDER BY id DESC') : store.all('SELECT * FROM settlements WHERE user_id = ? ORDER BY id DESC', user.id);
    out.settlements = rows.filter((s) => hasAll(fold([settleCode(s.id), s.label, adm ? (users.byId(s.user_id) || {}).name : ''].join('\n')), terms))
      .slice(0, type === 'all' ? 5 : 50).map((s) => pubSettlement(s, user));
  }
  return out;
});

route('POST', '/api/convs/:id/read', 'active', ({ user, params, body }) => {
  const c = convFor(int(params.id), user);
  const last = int(body.lastId) || 0;
  const r = store.run('UPDATE conv_members SET last_read = ? WHERE conv_id = ? AND user_id = ? AND last_read < ?', last, c.id, user.id, last);
  if (r.changes) sendTo(memberIds(c.id), 'read', { convId: c.id, userId: user.id, lastRead: last });
  return { ok: true };
});

route('DELETE', '/api/messages/:id', 'active', ({ user, params }) => {
  const m = store.get('SELECT * FROM messages WHERE id = ?', int(params.id));
  if (!m || m.deleted_at) fail(404, 'Không tìm thấy tin nhắn');
  if (m.type === 'order') fail(400, 'Muốn bỏ đơn hãy dùng nút Xoá đơn');
  if (m.sender_id !== user.id && !isAdmin(user)) fail(403, 'Chỉ thu hồi được tin của chính bạn');
  if (!isAdmin(user)) convFor(m.conv_id, user);
  store.run('UPDATE messages SET deleted_at = ?, deleted_by = ? WHERE id = ?', now(), user.id, m.id);
  if (m.sender_id !== user.id) addLog(user.id, 'message.delete', { targetUserId: m.sender_id, details: { text: (m.text || '').slice(0, 200) } });
  sendTo(memberIds(m.conv_id), 'msgdel', { id: m.id, convId: m.conv_id });
  return { ok: true };
});

// ---------------------------------------------------------------- tải ảnh lên
route('POST', '/api/upload', 'active', async ({ req }) => {
  const buf = await readBody(req, 15 * 1024 * 1024);
  const h = buf.subarray(0, 12);
  const ext = h[0] === 0xff && h[1] === 0xd8 ? 'jpg'
    : h.subarray(0, 4).toString('hex') === '89504e47' ? 'png'
    : h.subarray(0, 4).toString('latin1') === 'GIF8' ? 'gif'
    : h.subarray(0, 4).toString('latin1') === 'RIFF' && h.subarray(8, 12).toString('latin1') === 'WEBP' ? 'webp' : null;
  if (!ext) fail(400, 'Chỉ nhận ảnh JPG, PNG, GIF hoặc WebP');
  const month = new Date(now() + VN).toISOString().slice(0, 7);
  const dir = path.join(UPLOADS_DIR, month);
  await fsp.mkdir(dir, { recursive: true });
  const name = crypto.randomBytes(16).toString('hex') + '.' + ext;
  await fsp.writeFile(path.join(dir, name), buf);
  return { url: `/uploads/${month}/${name}` };
});

// ---------------------------------------------------------------- đơn hàng
function parseOrderInput(body, partial) {
  const out = {};
  if (!partial || body.content !== undefined) { out.content = str(body.content, 3000); if (!out.content) fail(400, 'Nhập nội dung đơn'); }
  if (!partial || body.price !== undefined) { out.price = int(body.price); if (out.price === null || out.price < 0) fail(400, 'Tiền công không hợp lệ'); }
  if (body.discountPct !== undefined && body.discountPct !== null && body.discountPct !== '') {
    out.discountPct = Math.round(Number(body.discountPct) * 100) / 100;
    if (!Number.isFinite(out.discountPct) || out.discountPct < 0 || out.discountPct > 100) fail(400, 'Chiết khấu phải từ 0 đến 100%');
  }
  if (body.credentials !== undefined) out.credentials = String(body.credentials ?? '').replace(/\r/g, '').trim().slice(0, 2000) || null;
  if (body.deadline !== undefined) out.deadline = body.deadline ? int(body.deadline) : null;
  return out;
}
function notPaid(o) { if (o.paid_at) fail(400, `Đơn ${orderCode(o.id)} đã thanh toán (kết toán ${o.settlement_id ? settleCode(o.settlement_id) : ''}) — không thay đổi được`); }

route('POST', '/api/orders', 'admin', ({ user, body }) => {
  const a = users.byId(int(body.assigneeId));
  if (!a || a.status !== 'active') fail(400, 'Chọn CTV nhận đơn');
  if (a.id === user.id) fail(400, 'Không giao đơn cho chính mình');
  const inp = parseOrderInput(body);
  const pct = inp.discountPct ?? (a.discount_pct || 0);
  const net = netOf(inp.price, pct);
  const { conv } = getOrCreateDm(user.id, a.id);
  const id = store.tx(() => {
    const id = store.insert(`INSERT INTO orders(conv_id, assignee_id, created_by, content, price, discount_pct, net, credentials, deadline, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`, conv.id, a.id, user.id, inp.content, inp.price, pct, net, inp.credentials ?? null, inp.deadline ?? null, now(), now());
    addLog(user.id, 'order.create', { orderId: id, targetUserId: a.id, details: { content: inp.content, price: inp.price, discountPct: pct, net, deadline: inp.deadline ?? null, hasCredentials: !!inp.credentials } });
    return id;
  });
  const msg = postMessage(conv.id, user.id, { type: 'order', orderId: id });
  store.run('UPDATE orders SET msg_id = ? WHERE id = ?', msg.id, id);
  const o = broadcastOrder(id);
  emitHook('order.created', { order: hookOrder(o), user: pubUser(a, null) });
  return { order: pubOrder(o, user), convId: conv.id };
});

route('GET', '/api/orders', 'active', ({ user, query, res }) => {
  const rows = queryOrders(user, query);
  if (query.format === 'csv') {
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="don-hang-${isoDay(now())}.csv"`, 'Cache-Control': 'no-store' });
    res.end(ordersCsv(rows));
    return undefined;
  }
  return rows.map((o) => pubOrder(o, user));
});

route('GET', '/api/orders/:id', 'active', ({ user, params }) => {
  const o = orderFor(int(params.id), user);
  const logs = store.all('SELECT * FROM logs WHERE order_id = ? ORDER BY id DESC', o.id);
  return { order: pubOrder(o, user), logs: logs.map((l) => pubLog(l, user)) };
});

route('PATCH', '/api/orders/:id', 'admin', ({ user, params, body }) => {
  const o = orderFor(int(params.id), user, { write: true });
  notPaid(o);
  const inp = parseOrderInput(body, true);
  const map = { content: 'content', price: 'price', discountPct: 'discount_pct', deadline: 'deadline', credentials: 'credentials' };
  const changes = {};
  for (const [k, col] of Object.entries(map)) if (inp[k] !== undefined && inp[k] !== (o[col] ?? null)) changes[k] = [o[col] ?? null, inp[k]];
  if (!Object.keys(changes).length) return { order: pubOrder(o, user) };
  const net = netOf(changes.price ? changes.price[1] : o.price, changes.discountPct ? changes.discountPct[1] : o.discount_pct);
  if (net !== o.net) changes.net = [o.net, net];
  const logged = { ...changes };
  if (logged.credentials) logged.credentials = true; // không ghi tài khoản/mật khẩu vào lịch sử
  store.tx(() => {
    for (const [k, [, v]] of Object.entries(changes)) if (map[k]) store.run(`UPDATE orders SET ${map[k]} = ? WHERE id = ?`, v, o.id);
    if (changes.credentials) store.run('UPDATE orders SET cred_purged_at = NULL WHERE id = ?', o.id);
    store.run('UPDATE orders SET net = ?, updated_at = ? WHERE id = ?', net, now(), o.id);
    addLog(user.id, 'order.edit', { orderId: o.id, targetUserId: o.assignee_id, details: { changes: logged } });
  });
  const visible = [];
  if (changes.content) visible.push('nội dung');
  if (changes.price) visible.push(`tiền công ${money(changes.price[0])} → ${money(changes.price[1])}`);
  if (changes.discountPct) visible.push(`chiết khấu ${changes.discountPct[0]}% → ${changes.discountPct[1]}%`);
  if (changes.net) visible.push(`thực nhận ${money(changes.net[0])} → ${money(changes.net[1])}`);
  if (changes.deadline) visible.push(`hạn ${fmtDeadline(changes.deadline[0])} → ${fmtDeadline(changes.deadline[1])}`);
  if (changes.credentials) visible.push('tài khoản / mật khẩu');
  if (visible.length) sysMsg(o, user.id, `${user.name} đã sửa đơn ${orderCode(o.id)}: ${visible.join(', ')}`, 'edit');
  const n = broadcastOrder(o.id);
  if (n.settlement_id) { const st = store.get('SELECT * FROM settlements WHERE id = ?', n.settlement_id); if (st) broadcastSettlement(st); }
  emitHook('order.updated', { order: hookOrder(n), changes: logged });
  return { order: pubOrder(n, user) };
});

route('POST', '/api/orders/:id/proof', 'active', ({ user, params, body }) => {
  const o = orderFor(int(params.id), user, { write: true });
  if (o.assignee_id !== user.id) fail(403, 'Chỉ CTV nhận đơn mới gửi ảnh');
  if (o.status !== 'open') fail(400, 'Đơn đã hoàn thành');
  const add = (Array.isArray(body.images) ? body.images : []).filter((u) => IMG_RE.test(u));
  if (!add.length) fail(400, 'Chưa có ảnh');
  const proof = [...parseJSON(o.proof, []), ...add].slice(0, 12);
  store.tx(() => {
    store.run('UPDATE orders SET proof = ?, updated_at = ? WHERE id = ?', JSON.stringify(proof), now(), o.id);
    addLog(user.id, 'order.proof', { orderId: o.id, targetUserId: o.assignee_id, details: { added: add.length, total: proof.length } });
  });
  return { order: pubOrder(broadcastOrder(o.id), user) };
});

route('POST', '/api/orders/:id/proof-remove', 'active', ({ user, params, body }) => {
  const o = orderFor(int(params.id), user, { write: true });
  if (!isAdmin(user) && (o.assignee_id !== user.id || o.status !== 'open')) fail(403, 'Không xoá được ảnh này');
  const proof = parseJSON(o.proof, []).filter((u) => u !== body.url);
  store.tx(() => {
    store.run('UPDATE orders SET proof = ?, updated_at = ? WHERE id = ?', JSON.stringify(proof), now(), o.id);
    addLog(user.id, 'order.proof_remove', { orderId: o.id, targetUserId: o.assignee_id, details: { total: proof.length } });
  });
  return { order: pubOrder(broadcastOrder(o.id), user) };
});

route('POST', '/api/orders/:id/note', 'active', ({ user, params, body }) => {
  const o = orderFor(int(params.id), user, { write: true });
  if (!isAdmin(user) && o.paid_at) fail(400, 'Đơn đã thanh toán, không sửa ghi chú được');
  const note = str(body.note, 2000) || null;
  if (note === o.note) return { order: pubOrder(o, user) };
  store.tx(() => {
    store.run('UPDATE orders SET note = ?, updated_at = ? WHERE id = ?', note, now(), o.id);
    addLog(user.id, 'order.note', { orderId: o.id, targetUserId: o.assignee_id, details: { before: o.note, after: note } });
  });
  return { order: pubOrder(broadcastOrder(o.id), user) };
});

route('POST', '/api/orders/:id/done', 'active', ({ user, params }) => {
  const o = orderFor(int(params.id), user, { write: true });
  if (o.assignee_id !== user.id) fail(403, 'Chỉ CTV nhận đơn mới bấm Done');
  if (o.status !== 'open') fail(400, 'Đơn đã hoàn thành rồi');
  if (!parseJSON(o.proof, []).length) fail(400, 'Cần gửi ít nhất 1 ảnh trước khi bấm Done');
  store.tx(() => {
    store.run("UPDATE orders SET status = 'done', done_at = ?, updated_at = ? WHERE id = ?", now(), now(), o.id);
    addLog(user.id, 'order.done', { orderId: o.id, targetUserId: o.assignee_id, details: { price: o.price, net: o.net } });
    const pc = purgeCfg().cred;
    if (pc.on && pc.days === 0 && o.credentials) store.run('UPDATE orders SET credentials = NULL, cred_purged_at = ? WHERE id = ?', now(), o.id);
  });
  sysMsg(o, user.id, `${user.name} đã hoàn thành đơn ${orderCode(o.id)} · thực nhận ${money(o.net)}`, 'check');
  const n = broadcastOrder(o.id);
  emitHook('order.done', { order: hookOrder(n), user: pubUser(user, null) });
  return { order: pubOrder(n, user) };
});

route('POST', '/api/orders/:id/reopen', 'admin', ({ user, params }) => {
  const o = orderFor(int(params.id), user, { write: true });
  if (o.status !== 'done') fail(400, 'Đơn chưa hoàn thành');
  notPaid(o);
  store.tx(() => {
    unlinkFromSettlement(o, user.id);
    store.run("UPDATE orders SET status = 'open', done_at = NULL, updated_at = ? WHERE id = ?", now(), o.id);
    addLog(user.id, 'order.reopen', { orderId: o.id, targetUserId: o.assignee_id, details: { doneAt: o.done_at } });
  });
  sysMsg(o, user.id, `${user.name} đã mở lại đơn ${orderCode(o.id)} (chưa tính tiền)`, 'undo');
  const n = broadcastOrder(o.id);
  emitHook('order.reopened', { order: hookOrder(n) });
  return { order: pubOrder(n, user) };
});

route('DELETE', '/api/orders/:id', 'admin', ({ user, params }) => {
  const o = orderFor(int(params.id), user, { write: true });
  notPaid(o);
  store.tx(() => {
    unlinkFromSettlement(o, user.id);
    store.run('UPDATE orders SET deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ?', now(), user.id, now(), o.id);
    addLog(user.id, 'order.delete', { orderId: o.id, targetUserId: o.assignee_id, details: { content: o.content, price: o.price, net: o.net, status: o.status } });
  });
  sysMsg(o, user.id, `${user.name} đã xoá đơn ${orderCode(o.id)}`, 'trash');
  const n = broadcastOrder(o.id);
  emitHook('order.deleted', { order: hookOrder(n) });
  return { order: pubOrder(n, user) };
});

route('POST', '/api/orders/:id/restore', 'admin', ({ user, params }) => {
  const o = orderFor(int(params.id), user);
  if (!o.deleted_at) return { order: pubOrder(o, user) };
  store.tx(() => {
    store.run('UPDATE orders SET deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE id = ?', now(), o.id);
    addLog(user.id, 'order.restore', { orderId: o.id, targetUserId: o.assignee_id });
  });
  sysMsg(o, user.id, `${user.name} đã khôi phục đơn ${orderCode(o.id)}`, 'restore');
  return { order: pubOrder(broadcastOrder(o.id), user) };
});

// ---------------------------------------------------------------- doanh thu
route('GET', '/api/revenue', 'active', ({ user, query }) => revenue(user, query));

// ---------------------------------------------------------------- kết toán
route('GET', '/api/banks', 'none', () => BANKS);

route('GET', '/api/settlements', 'active', ({ user, query }) => {
  const adm = isAdmin(user);
  const uid = adm ? int(query.userId) : user.id;
  const f = uid ? ' AND user_id = ?' : '';
  const a = uid ? [uid] : [];
  const pending = store.all(`SELECT * FROM settlements WHERE status = 'pending'${f} ORDER BY created_at DESC`, ...a);
  const paid = store.all(`SELECT * FROM settlements WHERE status = 'paid'${f} ORDER BY paid_at DESC LIMIT 300`, ...a);
  const unsettled = store.all(`SELECT assignee_id userId, COUNT(*) count, COALESCE(SUM(net), 0) net, COALESCE(SUM(price), 0) gross, MIN(done_at) oldest
    FROM orders WHERE status = 'done' AND deleted_at IS NULL AND settlement_id IS NULL AND paid_at IS NULL${uid ? ' AND assignee_id = ?' : ''}
    GROUP BY assignee_id ORDER BY net DESC`, ...a);
  const p = vnParts(now());
  return {
    pending: pending.map((s) => pubSettlement(s, user)), paid: paid.map((s) => pubSettlement(s, user)),
    unsettled: unsettled.map((r) => ({ ...r, bank: bankOf(users.byId(r.userId)) })),
    nextAuto: vnStart(p.y, p.m + 1, 1), nextAutoLabel: `Tháng ${p.m + 1}/${p.y}`,
    nextAutoDay: ((n) => `${String(n.d).padStart(2, '0')}/${String(n.m + 1).padStart(2, '0')}/${n.y}`)(vnParts(vnStart(p.y, p.m + 1, 1))),
  };
});

function settleFor(id, user) {
  const s = store.get('SELECT * FROM settlements WHERE id = ?', id);
  if (!s) fail(404, 'Không tìm thấy kết toán');
  if (!isAdmin(user) && s.user_id !== user.id) fail(403, 'Không xem được kết toán này');
  return s;
}
route('GET', '/api/settlements/:id', 'active', ({ user, params }) => {
  const s = settleFor(int(params.id), user);
  const orders = store.all('SELECT * FROM orders WHERE settlement_id = ? AND deleted_at IS NULL ORDER BY done_at', s.id);
  return { settlement: pubSettlement(s, user), orders: orders.map((o) => pubOrder(o, user)) };
});

route('POST', '/api/settlements', 'admin', ({ user, body }) => {
  const ids = Array.isArray(body.userIds) && body.userIds.length ? body.userIds.map(int)
    : store.all("SELECT DISTINCT assignee_id id FROM orders WHERE status = 'done' AND deleted_at IS NULL AND settlement_id IS NULL AND paid_at IS NULL").map((r) => r.id);
  const p = vnParts(now());
  const label = `Đến ngày ${String(p.d).padStart(2, '0')}/${String(p.m + 1).padStart(2, '0')}/${p.y}`;
  const created = [];
  for (const uid of ids) { const sid = createSettlement(uid, { cutoff: now() + 1, label, actorId: user.id }); if (sid) created.push(sid); }
  if (!created.length) fail(400, 'Không có đơn hoàn thành nào chưa kết toán');
  return { created: created.map((id) => pubSettlement(store.get('SELECT * FROM settlements WHERE id = ?', id), user)) };
});

route('POST', '/api/settlements/:id/pay', 'admin', ({ user, params }) => {
  const s = settleFor(int(params.id), user);
  if (s.status !== 'pending') fail(400, 'Kết toán này đã được thanh toán');
  const t = settleTotals(s.id);
  if (!t.n) fail(400, 'Kết toán không còn đơn nào');
  const bank = bankOf(users.byId(s.user_id));
  store.tx(() => {
    store.run("UPDATE settlements SET status = 'paid', amount = ?, gross = ?, order_count = ?, bank_snapshot = ?, paid_at = ?, paid_by = ? WHERE id = ?",
      t.s, t.g, t.n, bank ? JSON.stringify(bank) : null, now(), user.id, s.id);
    store.run("UPDATE orders SET paid_at = ?, paid_by = ? WHERE settlement_id = ? AND status = 'done' AND deleted_at IS NULL", now(), user.id, s.id);
    addLog(user.id, 'settlement.paid', { targetUserId: s.user_id, details: { code: settleCode(s.id), label: s.label, count: t.n, amount: t.s } });
  });
  settleMsg(s.user_id, user.id, `${user.name} đã thanh toán lương ${settleCode(s.id)} · ${s.label} · ${money(t.s)}`, 'money');
  const n = store.get('SELECT * FROM settlements WHERE id = ?', s.id);
  for (const o of store.all('SELECT id FROM orders WHERE settlement_id = ?', s.id)) broadcastOrder(o.id);
  broadcastSettlement(n, { justPaid: true });
  emitHook('settlement.paid', { settlement: pubSettlement(n, null), user: pubUser(users.byId(s.user_id), null) });
  return { settlement: pubSettlement(n, user) };
});

route('POST', '/api/settlements/:id/unpay', 'admin', ({ user, params }) => {
  const s = settleFor(int(params.id), user);
  if (s.status !== 'paid') fail(400, 'Kết toán này chưa thanh toán');
  store.tx(() => {
    store.run("UPDATE settlements SET status = 'pending', amount = NULL, gross = NULL, order_count = NULL, bank_snapshot = NULL, paid_at = NULL, paid_by = NULL WHERE id = ?", s.id);
    store.run('UPDATE orders SET paid_at = NULL, paid_by = NULL WHERE settlement_id = ?', s.id);
    addLog(user.id, 'settlement.unpaid', { targetUserId: s.user_id, details: { code: settleCode(s.id), label: s.label, amount: s.amount } });
  });
  settleMsg(s.user_id, user.id, `${user.name} đã huỷ xác nhận thanh toán ${settleCode(s.id)} (${s.label})`, 'undo');
  const n = store.get('SELECT * FROM settlements WHERE id = ?', s.id);
  for (const o of store.all('SELECT id FROM orders WHERE settlement_id = ?', s.id)) broadcastOrder(o.id);
  broadcastSettlement(n);
  return { settlement: pubSettlement(n, user) };
});

route('DELETE', '/api/settlements/:id', 'admin', ({ user, params }) => {
  const s = settleFor(int(params.id), user);
  if (s.status !== 'pending') fail(400, 'Kết toán đã thanh toán — bấm "Huỷ thanh toán" trước');
  const t = settleTotals(s.id);
  const ids = store.all('SELECT id FROM orders WHERE settlement_id = ?', s.id).map((r) => r.id);
  store.tx(() => {
    store.run('UPDATE orders SET settlement_id = NULL WHERE settlement_id = ?', s.id);
    store.run('DELETE FROM settlements WHERE id = ?', s.id);
    addLog(user.id, 'settlement.cancel', { targetUserId: s.user_id, details: { code: settleCode(s.id), label: s.label, count: t.n, amount: t.s } });
  });
  settleMsg(s.user_id, user.id, `${user.name} đã huỷ kết toán ${settleCode(s.id)} (${s.label}) — các đơn quay về "chưa kết toán"`, 'trash');
  for (const id of ids) broadcastOrder(id);
  sendTo([s.user_id, ...users.admins()], 'settlement', { deleted: s.id });
  return { ok: true };
});

// ---------------------------------------------------------------- lịch sử
route('GET', '/api/logs', 'active', ({ user, query }) => {
  const where = [], params = [];
  if (!isAdmin(user)) { where.push('target_user_id = ?'); params.push(user.id); }
  else if (query.userId) { where.push('(target_user_id = ? OR actor_id = ?)'); params.push(int(query.userId), int(query.userId)); }
  if (query.action) { where.push('action LIKE ?'); params.push(str(query.action, 30) + '%'); }
  if (query.orderId) { where.push('order_id = ?'); params.push(int(query.orderId)); }
  if (query.q) { const m = str(query.q, 20).match(/^#?dh0*(\d+)$/i); if (m) { where.push('order_id = ?'); params.push(Number(m[1])); } }
  if (query.before) { where.push('id < ?'); params.push(int(query.before)); }
  const limit = Math.min(200, int(query.limit) || 60);
  const rows = store.all(`SELECT * FROM logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ${limit + 1}`, ...params);
  return { logs: rows.slice(0, limit).map((l) => pubLog(l, user)), hasMore: rows.length > limit };
});

// ---------------------------------------------------------------- thành viên
route('GET', '/api/users', 'admin', ({ user }) => store.all('SELECT * FROM users ORDER BY CASE status WHEN \'pending\' THEN 0 ELSE 1 END, created_at DESC').map((u) => ({
  ...pubUser(u, user),
  openCount: store.get("SELECT COUNT(*) n FROM orders WHERE assignee_id = ? AND status = 'open' AND deleted_at IS NULL", u.id).n,
  unpaid: store.get("SELECT COALESCE(SUM(net), 0) s FROM orders WHERE assignee_id = ? AND status = 'done' AND paid_at IS NULL AND deleted_at IS NULL", u.id).s,
})));

route('GET', '/api/users/:id/summary', 'active', ({ user, params }) => {
  const id = int(params.id);
  if (!isAdmin(user) && id !== user.id) fail(403, 'Không xem được thông tin này');
  if (!users.byId(id)) fail(404, 'Không tìm thấy');
  return userSummary(id, user);
});

function userAction(action, fn) {
  return ({ user, params, body }) => {
    const u = users.byId(int(params.id));
    if (!u) fail(404, 'Không tìm thấy thành viên');
    if (u.is_owner && user.id !== u.id) fail(403, 'Không thao tác được với admin gốc');
    const extra = store.tx(() => fn(u, user, body) || {});
    addLog(user.id, 'user.' + action, { targetUserId: u.id, details: extra.log });
    sendTo(users.admins(), 'users', { pending: pendingCount() });
    return { user: pubUser(users.byId(u.id), user), ...extra.reply };
  };
}
route('POST', '/api/users/:id/approve', 'admin', userAction('approve', (u, admin) => {
  if (u.status !== 'pending' && u.status !== 'rejected') fail(400, 'Thành viên không ở trạng thái chờ duyệt');
  store.run("UPDATE users SET status = 'active', approved_at = ?, approved_by = ? WHERE id = ?", now(), admin.id, u.id);
  const g = ensureMainGroup(store.get('SELECT id FROM users WHERE is_owner = 1').id);
  addMember(g.id, u.id);
  for (const aid of users.admins()) getOrCreateDm(aid, u.id, { quiet: true });
  setImmediate(() => {
    sendTo(users.admins(), 'conv', {});
    postMessage(g.id, admin.id, { type: 'system', text: `${u.name} đã tham gia nhóm`, icon: 'userplus' });
    emitHook('user.approved', { user: pubUser(users.byId(u.id), admin) });
  });
}));
route('POST', '/api/users/:id/reject', 'admin', userAction('reject', (u) => {
  if (u.status !== 'pending') fail(400, 'Chỉ từ chối được người đang chờ duyệt');
  store.run("UPDATE users SET status = 'rejected' WHERE id = ?", u.id);
  store.run('DELETE FROM sessions WHERE user_id = ?', u.id);
}));
route('POST', '/api/users/:id/lock', 'admin', userAction('lock', (u, admin) => {
  if (u.id === admin.id) fail(400, 'Không tự khoá chính mình');
  store.run("UPDATE users SET status = 'locked' WHERE id = ?", u.id);
  store.run('DELETE FROM sessions WHERE user_id = ?', u.id);
  setImmediate(() => sendTo([u.id], 'account', { status: 'locked' }));
}));
route('POST', '/api/users/:id/unlock', 'admin', userAction('unlock', (u) => {
  if (u.status !== 'locked') fail(400, 'Tài khoản không bị khoá');
  store.run("UPDATE users SET status = 'active' WHERE id = ?", u.id);
}));
route('POST', '/api/users/:id/reset-password', 'admin', userAction('reset_password', (u) => {
  const pw = crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').slice(0, 8);
  store.run('UPDATE users SET pass = ? WHERE id = ?', hashPass(pw), u.id);
  store.run('DELETE FROM sessions WHERE user_id = ?', u.id);
  setImmediate(() => sendTo([u.id], 'account', { status: 'password' }));
  return { reply: { password: pw } };
}));
route('POST', '/api/users/:id/role', 'admin', userAction('role', (u, admin, body) => {
  if (!admin.is_owner) fail(403, 'Chỉ admin gốc mới cấp / thu quyền admin');
  if (u.id === admin.id) fail(400, 'Không đổi quyền của chính mình');
  const role = body.role === 'admin' ? 'admin' : 'member';
  store.run('UPDATE users SET role = ? WHERE id = ?', role, u.id);
  setImmediate(() => sendTo([u.id], 'account', { status: 'role' }));
  return { log: { role } };
}));
route('PATCH', '/api/users/:id', 'admin', userAction('edit', (u, admin, body) => {
  const name = body.name !== undefined ? str(body.name, 40) : u.name;
  if (name.length < 2) fail(400, 'Tên quá ngắn');
  const avatar = body.avatar === undefined ? u.avatar : body.avatar === null || body.avatar === '' ? null : IMG_RE.test(body.avatar) ? body.avatar : fail(400, 'Ảnh đại diện không hợp lệ');
  const b = parseBank(body, u);
  let pct = u.discount_pct || 0;
  if (body.discountPct !== undefined && body.discountPct !== '' && body.discountPct !== null) {
    pct = Math.round(Number(body.discountPct) * 100) / 100;
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) fail(400, 'Chiết khấu phải từ 0 đến 100%');
  }
  store.run('UPDATE users SET name = ?, phone = ?, note = ?, avatar = ?, bank_bin = ?, bank_acc = ?, bank_holder = ?, discount_pct = ? WHERE id = ?', name,
    body.phone !== undefined ? str(body.phone, 30) : u.phone, body.note !== undefined ? str(body.note, 500) : u.note, avatar, b.bin, b.acc, b.holder, pct, u.id);
  let applied = [];
  if (body.applyDiscount) {
    // áp chiết khấu mới cho các đơn CHƯA thanh toán của CTV này (đơn đã thanh toán giữ nguyên)
    applied = store.all('SELECT id FROM orders WHERE assignee_id = ? AND paid_at IS NULL AND deleted_at IS NULL AND discount_pct != ?', u.id, pct).map((r) => r.id);
    store.run('UPDATE orders SET discount_pct = ?, net = CAST(ROUND(price * (100 - ?) / 100.0) AS INTEGER), updated_at = ? WHERE id IN (SELECT value FROM json_each(?))',
      pct, pct, now(), JSON.stringify(applied));
  }
  setImmediate(() => {
    const fresh = users.byId(u.id);
    sendTo(allOnline(), 'user', (uid) => ({ user: pubUser(fresh, users.byId(uid)) }));
    for (const id of applied) broadcastOrder(id);
    if (applied.length) for (const st of store.all("SELECT * FROM settlements WHERE user_id = ? AND status = 'pending'", u.id)) broadcastSettlement(st);
  });
  if (pct !== (u.discount_pct || 0) || applied.length) return { log: { discount: [u.discount_pct || 0, pct], applied: applied.length }, reply: { applied: applied.length } };
}));

// ---------------------------------------------------------------- ngân hàng
function parseBank(body, u) {
  const out = { bin: u.bank_bin, acc: u.bank_acc, holder: u.bank_holder };
  if (body.bankBin !== undefined) {
    out.bin = str(body.bankBin, 10) || null;
    if (out.bin && !bankByBin.has(out.bin)) fail(400, 'Ngân hàng không có trong danh sách');
  }
  if (body.bankAcc !== undefined) {
    out.acc = String(body.bankAcc || '').replace(/[\s.-]/g, '') || null;
    if (out.acc && !/^[0-9A-Za-z]{4,30}$/.test(out.acc)) fail(400, 'Số tài khoản chỉ gồm chữ số (4–30 ký tự)');
  }
  if (body.bankHolder !== undefined) {
    out.holder = String(body.bankHolder || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
      .replace(/[^A-Za-z ]+/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 60) || null;
  }
  return out;
}

// ---------------------------------------------------------------- tài khoản của tôi
route('PATCH', '/api/me', 'active', ({ user, body }) => {
  const name = body.name !== undefined ? str(body.name, 40) : user.name;
  if (name.length < 2) fail(400, 'Tên quá ngắn');
  const color = /^#[0-9a-f]{6}$/i.test(body.color || '') ? body.color : user.color;
  const avatar = body.avatar === undefined ? user.avatar : body.avatar === null || body.avatar === '' ? null : IMG_RE.test(body.avatar) ? body.avatar : fail(400, 'Ảnh đại diện không hợp lệ');
  const b = parseBank(body, user);
  store.run('UPDATE users SET name = ?, color = ?, phone = ?, avatar = ?, bank_bin = ?, bank_acc = ?, bank_holder = ? WHERE id = ?', name, color,
    body.phone !== undefined ? str(body.phone, 30) : user.phone, avatar, b.bin, b.acc, b.holder, user.id);
  if (body.notifyGroup !== undefined) store.run('UPDATE users SET notify_group = ? WHERE id = ?', body.notifyGroup ? 1 : 0, user.id);
  const u = users.byId(user.id);
  sendTo(allOnline(), 'user', (uid) => ({ user: pubUser(u, users.byId(uid)) }));
  return { user: pubUser(u, u) };
});
route('POST', '/api/me/password', 'active', ({ req, res, user, body }) => {
  if (!checkPass(body.current || '', user.pass)) fail(400, 'Mật khẩu hiện tại không đúng');
  if (String(body.next || '').length < 6) fail(400, 'Mật khẩu mới cần ít nhất 6 ký tự');
  store.run('UPDATE users SET pass = ? WHERE id = ?', hashPass(body.next), user.id);
  store.run('DELETE FROM sessions WHERE user_id = ?', user.id);
  createSession(req, res, user.id);
  addLog(user.id, 'user.password', { targetUserId: user.id });
  return { ok: true };
});

// ---------------------------------------------------------------- cài đặt & sao lưu (admin)
function backupStatus() {
  const list = backup.list();
  let dbSize = 0;
  for (const ext of ['', '-wal']) try { dbSize += fs.statSync(DB_FILE + ext).size; } catch {}
  return {
    lastAt: Number(store.setting('backup_last_at', 0)) || null, count: list.length, totalSize: list.reduce((t, b) => t + b.size, 0),
    dbSize, dataDir: DATA_DIR, backupDir: BACKUP_DIR, lastError: backup.lastError,
    counts: Object.fromEntries(Object.keys(KINDS).map((k) => [k, list.filter((b) => b.kind === k).length])),
  };
}
route('GET', '/api/settings', 'admin', () => ({
  appName: setting('app_name'), gmailOnly: setting('gmail_only') === '1',
  backupHours: Number(setting('backup_hours')), backupKeep: Number(setting('backup_keep')), backupKeepDaily: Number(setting('backup_keep_daily')),
  backupDir2: setting('backup_dir2'), backup: backupStatus(),
  purge: purgeCfg(), purgeLast: parseJSON(setting('purge_last'), null),
  fcm: fcmStatus(),
}));
// tải lên / gỡ 2 file của Firebase để gửi thông báo tới app Android
route('POST', '/api/settings/fcm', 'admin', async ({ user, body }) => {
  const changes = {};
  if (body.clear) {
    store.setSetting('fcm_client', ''); store.setSetting('fcm_sa', '');
    changes.fcm = 'đã gỡ';
  } else {
    let c = null, sa = null;
    try {
      if (body.client) c = fcm.parseClient(body.client, ANDROID_PKG);
      if (body.sa) sa = fcm.parseServiceAccount(body.sa);
    } catch (e) { fail(400, e.message); }
    if (!c && !sa) fail(400, 'Chọn file để tải lên');
    const pc = c ? c.projectId : (fcmClient() || {}).projectId, ps = sa ? sa.project_id : (fcmSa() || {}).project_id;
    if (pc && ps && pc !== ps) fail(400, `Hai file thuộc 2 dự án Firebase khác nhau (${pc} và ${ps}). Hãy lấy cả 2 file trong cùng một dự án.`);
    if (sa) {
      fcm.forget(sa);
      try { await fcm.accessToken(sa); } catch (e) { fail(400, e.message); }
      store.setSetting('fcm_sa', JSON.stringify(sa));
      changes.fcmKey = sa.client_email;
    }
    if (c) { store.setSetting('fcm_client', JSON.stringify(c)); changes.fcmApp = c.projectId; }
  }
  addLog(user.id, 'settings.update', { details: { changes } });
  return fcmStatus();
});
route('PATCH', '/api/settings', 'admin', ({ user, body }) => {
  const changes = {};
  const set = (k, v) => { if (String(v) !== setting(k)) { changes[k] = [setting(k), String(v)]; store.setSetting(k, v); } };
  if (body.appName !== undefined) { const v = str(body.appName, 40); if (!v) fail(400, 'Nhập tên app'); set('app_name', v); }
  if (body.gmailOnly !== undefined) set('gmail_only', body.gmailOnly ? '1' : '0');
  if (body.backupHours !== undefined) set('backup_hours', [0.5, 1, 2, 3, 6, 12, 24].includes(Number(body.backupHours)) ? Number(body.backupHours) : 1);
  if (body.backupKeep !== undefined) set('backup_keep', Math.min(1000, Math.max(5, int(body.backupKeep) || 72)));
  if (body.backupKeepDaily !== undefined) set('backup_keep_daily', Math.min(3650, Math.max(7, int(body.backupKeepDaily) || 90)));
  if (body.backupDir2 !== undefined) {
    const dir = str(body.backupDir2, 500);
    if (dir) {
      if (!path.isAbsolute(dir)) fail(400, 'Thư mục phụ phải là đường dẫn đầy đủ, ví dụ D:\\Google Drive\\SaoLuu');
      try { fs.mkdirSync(dir, { recursive: true }); const t = path.join(dir, '.ctv-chat-test'); fs.writeFileSync(t, 'ok'); fs.unlinkSync(t); }
      catch (e) { fail(400, 'Không ghi được vào thư mục này: ' + e.message); }
    }
    set('backup_dir2', dir);
  }
  if (body.purge !== undefined) {
    const p = parsePurge(body.purge);
    for (const k of ['img', 'cred', 'order']) { set(`purge_${k}_on`, p[k].on ? '1' : '0'); set(`purge_${k}_days`, p[k].days); }
  }
  if (Object.keys(changes).length) addLog(user.id, 'settings.update', { details: { changes } });
  sendTo(allOnline(), 'settings', publicSettings());
  return { ok: true };
});
// ================================================================ tự động xoá dữ liệu cũ (admin bật trong Cài đặt)
// - Ảnh: ảnh trong tin nhắn (tính từ lúc gửi), ảnh bằng chứng của đơn (tính từ lúc đơn xong / bị xoá), ảnh rác không gắn vào đâu.
//   Ảnh đại diện không bao giờ bị xoá.
// - Tài khoản/mật khẩu trong đơn: tính từ lúc đơn xong (0 ngày = xoá ngay khi CTV bấm Done).
// - Đơn: chỉ đơn ĐÃ THANH TOÁN (tính từ lúc thanh toán) và đơn trong thùng rác (tính từ lúc xoá).
//   Đơn đang làm / chưa thanh toán không bao giờ bị xoá. Số tiền các kết toán đã trả vẫn giữ nguyên.
const PURGE_LIMITS = { img: [1, 3650], cred: [0, 3650], order: [7, 3650] };
function purgeCfg() {
  const out = {};
  for (const k of ['img', 'cred', 'order']) {
    const [lo, hi] = PURGE_LIMITS[k];
    const d = Number(setting(`purge_${k}_days`));
    out[k] = { on: setting(`purge_${k}_on`) === '1', days: Number.isFinite(d) ? Math.min(hi, Math.max(lo, Math.round(d))) : lo };
  }
  return out;
}
function parsePurge(p) {
  const out = {};
  for (const k of ['img', 'cred', 'order']) {
    const v = (p && p[k]) || {};
    const [lo, hi] = PURGE_LIMITS[k];
    const d = Number(v.days);
    if (!Number.isFinite(d) || d < lo || d > hi) fail(400, `Số ngày tự xoá ${{ img: 'ảnh', cred: 'tài khoản/mật khẩu', order: 'đơn' }[k]} phải từ ${lo} đến ${hi}`);
    out[k] = { on: !!v.on, days: Math.round(d) };
  }
  return out;
}
const uploadRel = (u) => (IMG_RE.test(u) ? u.slice('/uploads/'.length) : null);
function referencedImages() {
  const set = new Set();
  for (const r of store.all('SELECT images FROM messages WHERE images IS NOT NULL')) for (const u of parseJSON(r.images, []) || []) set.add(u);
  for (const r of store.all("SELECT proof FROM orders WHERE proof IS NOT NULL AND proof != '[]'")) for (const u of parseJSON(r.proof, []) || []) set.add(u);
  for (const r of store.all('SELECT avatar FROM users WHERE avatar IS NOT NULL')) set.add(r.avatar);
  return set;
}
/** Ảnh rác: file trong uploads/ không gắn vào tin nhắn, đơn hay ảnh đại diện nào, cũ hơn mốc. */
function orphanUploads(cutoff, referenced) {
  const out = [];
  let months = [];
  try { months = fs.readdirSync(UPLOADS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d{4}-\d{2}$/.test(d.name)); } catch { return out; }
  for (const m of months) {
    let files = [];
    try { files = fs.readdirSync(path.join(UPLOADS_DIR, m.name)); } catch { continue; }
    for (const f of files) {
      const u = `/uploads/${m.name}/${f}`;
      if (!IMG_RE.test(u) || referenced.has(u)) continue;
      try { if (fs.statSync(path.join(UPLOADS_DIR, m.name, f)).mtimeMs <= cutoff) out.push(u); } catch {}
    }
  }
  return out;
}
/** Danh sách những gì sẽ bị xoá với cấu hình cfg (dùng cho cả "xem trước" và chạy thật). */
function purgePlan(cfg, t = now()) {
  const plan = { orders: [], credIds: [], msgImgs: [], proofs: [], orphans: [] };
  if (cfg.order.on) {
    const c = t - cfg.order.days * DAY;
    plan.orders = store.all('SELECT * FROM orders WHERE (paid_at IS NOT NULL AND paid_at <= ?) OR (deleted_at IS NOT NULL AND deleted_at <= ?)', c, c);
  }
  const gone = new Set(plan.orders.map((o) => o.id));
  if (cfg.cred.on) {
    const c = t - cfg.cred.days * DAY;
    plan.credIds = store.all("SELECT id FROM orders WHERE credentials IS NOT NULL AND ((status = 'done' AND done_at <= ?) OR (deleted_at IS NOT NULL AND deleted_at <= ?))", c, c)
      .map((r) => r.id).filter((id) => !gone.has(id));
  }
  if (cfg.img.on) {
    const c = t - cfg.img.days * DAY;
    plan.msgImgs = store.all('SELECT id, images FROM messages WHERE images IS NOT NULL AND created_at <= ?', c)
      .map((r) => ({ id: r.id, urls: parseJSON(r.images, []) || [] })).filter((r) => r.urls.length);
    plan.proofs = store.all("SELECT id, proof FROM orders WHERE proof IS NOT NULL AND proof != '[]' AND ((status = 'done' AND done_at <= ?) OR (deleted_at IS NOT NULL AND deleted_at <= ?))", c, c)
      .filter((r) => !gone.has(r.id)).map((r) => ({ id: r.id, urls: parseJSON(r.proof, []) || [] })).filter((r) => r.urls.length);
    plan.orphans = orphanUploads(c, referencedImages());
  }
  const imgs = plan.msgImgs.reduce((n, r) => n + r.urls.length, 0) + plan.proofs.reduce((n, r) => n + r.urls.length, 0) + plan.orphans.length
    + plan.orders.reduce((n, o) => n + (parseJSON(o.proof, []) || []).length, 0);
  plan.counts = { images: imgs, creds: plan.credIds.length, orders: plan.orders.length };
  return plan;
}
function removeUpload(u, keep) {
  const rel = uploadRel(u);
  if (!rel || keep.has(u)) return;
  try { fs.unlinkSync(path.join(UPLOADS_DIR, rel)); } catch {}
  backup.removeMirrored(rel);
}
function runPurge(actorId = null) {
  const cfg = purgeCfg();
  if (!cfg.img.on && !cfg.cred.on && !cfg.order.on) return { images: 0, creds: 0, orders: 0 };
  const t = now();
  const plan = purgePlan(cfg, t);
  const { counts } = plan;
  if (!counts.images && !counts.creds && !counts.orders) return counts;
  // sắp xoá hẳn đơn → sao lưu trước, lỡ đặt nhầm số ngày vẫn khôi phục được
  if (counts.orders) try { backup.create('tu-dong'); } catch (e) { console.error('[tự xoá] không sao lưu được trước khi xoá:', e.message); }
  const files = [];
  store.tx(() => {
    for (const o of plan.orders) {
      files.push(...(parseJSON(o.proof, []) || []));
      store.run("DELETE FROM messages WHERE type = 'order' AND order_id = ?", o.id);
      store.run('UPDATE messages SET order_id = NULL WHERE order_id = ?', o.id);
      store.run('DELETE FROM logs WHERE order_id = ?', o.id);
      store.run('DELETE FROM orders WHERE id = ?', o.id);
    }
    for (const id of plan.credIds) store.run('UPDATE orders SET credentials = NULL, cred_purged_at = ? WHERE id = ?', t, id);
    for (const r of plan.msgImgs) { files.push(...r.urls); store.run('UPDATE messages SET images = NULL, img_purged = COALESCE(img_purged, 0) + ? WHERE id = ?', r.urls.length, r.id); }
    for (const r of plan.proofs) { files.push(...r.urls); store.run("UPDATE orders SET proof = '[]', proof_purged = COALESCE(proof_purged, 0) + ? WHERE id = ?", r.urls.length, r.id); }
    files.push(...plan.orphans);
    addLog(actorId, 'data.purge', { details: { ...counts, auto: !actorId } });
    store.setSetting('purge_last', JSON.stringify({ at: t, ...counts, by: actorId }));
  });
  // xoá file sau khi dữ liệu đã ghi xong; ảnh vẫn còn được dùng ở chỗ khác (vd. ảnh đại diện) thì giữ
  const keep = referencedImages();
  for (const u of files) removeUpload(u, keep);
  sendTo(allOnline(), 'purged', { orderIds: plan.orders.map((o) => o.id), credIds: plan.credIds, ...counts });
  return counts;
}
let lastAutoPurge = 0;
function autoPurge() {
  if (now() - lastAutoPurge < 3600e3) return; // mỗi giờ kiểm tra 1 lần là đủ
  lastAutoPurge = now();
  try {
    const c = runPurge(null);
    if (c.images || c.creds || c.orders) console.log(`  [tự xoá] ${c.images} ảnh · ${c.creds} tài khoản/mật khẩu · ${c.orders} đơn`);
  } catch (e) { console.error('[tự xoá] lỗi:', e.message); }
}
route('POST', '/api/purge/preview', 'admin', ({ body }) => purgePlan(parsePurge(body.purge)).counts);
route('POST', '/api/purge/run', 'admin', ({ user }) => {
  const cfg = purgeCfg();
  if (!cfg.img.on && !cfg.cred.on && !cfg.order.on) fail(400, 'Chưa bật mục tự xoá nào. Bật và bấm Lưu cài đặt trước.');
  return runPurge(user.id);
});

route('GET', '/api/backups', 'admin', () => ({ list: backup.list(), status: backupStatus() }));
route('POST', '/api/backups', 'admin', ({ user }) => {
  const b = backup.create('thu-cong');
  addLog(user.id, 'backup.create', { details: { name: b.name } });
  return b;
});
function afterRestore(user, info) {
  vapidCache = null;
  addLog(user.id, 'backup.restore', { details: info });
  setImmediate(() => sendTo(allOnline(), 'reload', {}));
}
route('POST', '/api/backups/restore', 'admin', ({ user, body }) => {
  const file = backup.fileOf(body.kind, body.name);
  if (!file) fail(404, 'Không tìm thấy bản sao lưu');
  const pre = backup.restoreFile(file);
  afterRestore(user, { from: `${body.kind}/${body.name}`, safety: pre.name });
  return { ok: true, safety: pre };
});
route('POST', '/api/backups/upload', 'admin', async ({ user, req }) => {
  const buf = await readBody(req, 500 * 1024 * 1024);
  if (!isSqliteFile(buf)) fail(400, 'File không phải bản sao lưu (.sqlite) của CTV Chat');
  const tmp = path.join(BACKUP_DIR, 'upload-' + crypto.randomBytes(6).toString('hex') + '.sqlite');
  await fsp.writeFile(tmp, buf);
  try {
    const pre = backup.restoreFile(tmp);
    afterRestore(user, { from: 'file tải lên', safety: pre.name });
    return { ok: true, safety: pre };
  } finally { try { fs.unlinkSync(tmp); } catch {} }
});
route('GET', '/api/backups/download', 'admin', ({ query, res }) => {
  const file = backup.fileOf(query.kind, query.name);
  if (!file) fail(404, 'Không tìm thấy bản sao lưu');
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${path.basename(file)}"`, 'Content-Length': fs.statSync(file).size });
  fs.createReadStream(file).pipe(res);
  return undefined;
});
route('GET', '/api/export.json', 'admin', ({ user, res }) => {
  const data = {
    app: 'ctv-chat', exportedAt: now(), exportedBy: user.email,
    users: store.all('SELECT id, email, name, role, is_owner, status, phone, bank, bank_bin, bank_acc, bank_holder, discount_pct, avatar, note, created_at, approved_at FROM users'),
    convs: store.all('SELECT * FROM convs'), conv_members: store.all('SELECT * FROM conv_members'),
    messages: store.all('SELECT * FROM messages'), orders: store.all('SELECT * FROM orders'),
    settlements: store.all('SELECT * FROM settlements'),
    logs: store.all('SELECT * FROM logs'), settings: store.all("SELECT * FROM settings WHERE key NOT IN ('vapid_private', 'fcm_sa')"),
  };
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="ctv-chat-du-lieu-${isoDay(now())}.json"` });
  res.end(JSON.stringify(data, null, 1));
  return undefined;
});

route('GET', '/api/events', 'active', ({ req, res, user, query }) => { handleEvents(req, res, user, query); return undefined; });
route('POST', '/api/presence', 'active', ({ user, body }) => { setActive(user.id, cidOf(body.cid), body.active); return { ok: true }; });

// ================================================================ phục vụ file
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const CSP = "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
async function serveFile(res, dir, rel, cache) {
  let p;
  try { p = path.resolve(dir, '.' + path.sep + decodeURIComponent(rel)); } catch { return send(res, 400, 'URL không hợp lệ'); }
  if (p !== dir && !p.startsWith(dir + path.sep)) return send(res, 403, 'Không được phép');
  let st;
  try { st = await fsp.stat(p); } catch { return send(res, 404, 'Không tìm thấy'); }
  if (st.isDirectory()) return serveFile(res, dir, path.join(rel, 'index.html'), cache);
  const ext = path.extname(p).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size,
    'Cache-Control': cache || 'no-cache', 'X-Content-Type-Options': 'nosniff',
    ...(ext === '.html' ? { 'Content-Security-Policy': CSP, 'Referrer-Policy': 'same-origin' } : {}),
  });
  fs.createReadStream(p).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (p.startsWith('/api/')) {
      const r = routes.find((x) => x.method === req.method && x.re.test(p));
      if (!r) return send(res, 404, { error: 'API không tồn tại' });
      if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'ctv') return send(res, 403, { error: 'Yêu cầu không hợp lệ' });
      const user = sessionUser(req);
      if (r.auth !== 'none') {
        if (!user) return send(res, 401, { error: 'Bạn cần đăng nhập' });
        if (user.status !== 'active') return send(res, 403, { error: 'Tài khoản chưa được duyệt hoặc đã bị khoá', status: user.status });
        if (r.auth === 'admin' && !isAdmin(user)) return send(res, 403, { error: 'Chỉ admin mới làm được việc này' });
      }
      const m = p.match(r.re);
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const isUpload = p === '/api/upload' || p === '/api/backups/upload';
      const body = req.method === 'GET' || req.method === 'DELETE' || isUpload ? {} : await readJson(req);
      const out = await r.fn({ req, res, user, params, body, query: Object.fromEntries(url.searchParams) });
      if (out !== undefined) send(res, 200, out);
      return;
    }
    if (p.startsWith('/uploads/')) {
      const user = sessionUser(req);
      if (!user || user.status !== 'active') return send(res, 401, 'Bạn cần đăng nhập');
      return serveFile(res, UPLOADS_DIR, p.slice('/uploads/'.length), 'private, max-age=31536000, immutable');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return serveFile(res, PUBLIC_DIR, p === '/' ? 'index.html' : p.slice(1));
  } catch (e) {
    const known = e instanceof HttpError || (e.status >= 400 && e.status < 500);
    if (!known) console.error('[lỗi]', e);
    if (!res.headersSent) send(res, e.status || 500, { error: known ? e.message : 'Lỗi máy chủ: ' + e.message });
    else res.end();
  }
});

// ================================================================ khởi động
backup.tick();
autoSettle();
autoPurge();
const backupTimer = setInterval(() => { backup.tick(); autoSettle(); autoPurge(); }, 5 * 60e3);

function shutdown() {
  console.log('\n  Đang tắt… (lưu dữ liệu)');
  clearInterval(backupTimer);
  for (const set of clients.values()) for (const r of set) r.end();
  server.close();
  try { store.close(); } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\n  [!] Cổng ${PORT} đang bị dùng. Có thể CTV Chat đã chạy rồi → mở http://localhost:${PORT}\n      Hoặc chạy cổng khác: PORT=3001 node server.js (Windows: set PORT=3001 && node server.js)\n`);
  else console.error(e);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log('\n  • CTV Chat đang chạy');
  console.log(`  • Trên máy này:      http://localhost:${PORT}`);
  if (HOST === '0.0.0.0') for (const ip of lan) console.log(`  • Máy khác cùng mạng: http://${ip}:${PORT}`);
  console.log(`  • Dữ liệu:           ${DATA_DIR}`);
  if (HOST !== '127.0.0.1') console.log('  • Thông báo điện thoại / CTV dùng 4G: cần địa chỉ https:// — xem HUONG-DAN.md mục 1b, 1c');
  console.log('  • Tắt: bấm Ctrl + C (dữ liệu đã được lưu liên tục)\n');
  if (!process.env.NO_OPEN) {
    const { exec } = require('child_process');
    const url = `http://localhost:${PORT}`;
    exec(process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`, () => {});
  }
});
