'use strict';
/* Gửi thông báo tới app Android "CTV Chat" qua Firebase Cloud Messaging (API HTTP v1).
 * Tự viết bằng crypto có sẵn của Node, không cần thư viện ngoài.
 * Admin tải lên 2 file lấy từ Firebase: google-services.json (cấu hình app — công khai) và khoá tài khoản dịch vụ (bí mật). */
const crypto = require('crypto');
const https = require('https');

const FCM_BASE = process.env.CTV_FCM_BASE || 'https://fcm.googleapis.com'; // đổi được khi chạy bộ kiểm tra
const b64u = (x) => Buffer.from(x).toString('base64url');

function request(url, { method = 'POST', headers = {}, body, timeout = 15000 } = {}) {
  return new Promise((resolve) => {
    const req = https.request(url, { method, timeout, headers: { ...headers, ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('timeout', () => req.destroy(new Error('hết thời gian chờ')));
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.end(body);
  });
}
const parse = (text, what) => {
  if (text && typeof text === 'object') return text;
  try { return JSON.parse(String(text || '')); } catch { throw new Error(`File ${what} không đọc được (không phải JSON)`); }
};

/** google-services.json → cấu hình Firebase cho app (giống hệt thứ mọi app Android đều mang theo, không phải bí mật). */
function parseClient(text, pkg) {
  const j = parse(text, 'google-services.json');
  const pi = j.project_info;
  if (!pi || !Array.isArray(j.client)) {
    if (j.type === 'service_account') throw new Error('Đây là file khoá tài khoản dịch vụ — hãy tải nó ở ô thứ 2');
    throw new Error('Đây không phải file google-services.json');
  }
  const c = j.client.find((x) => x.client_info && x.client_info.android_client_info && x.client_info.android_client_info.package_name === pkg);
  if (!c) throw new Error(`File này chưa có app Android tên gói "${pkg}". Trong Firebase hãy thêm app Android với đúng tên gói này rồi tải lại file.`);
  const out = {
    apiKey: c.api_key && c.api_key[0] && c.api_key[0].current_key,
    appId: c.client_info.mobilesdk_app_id,
    projectId: pi.project_id,
    senderId: pi.project_number,
  };
  if (!out.apiKey || !out.appId || !out.projectId || !out.senderId) throw new Error('File google-services.json thiếu thông tin');
  return out;
}

/** Khoá tài khoản dịch vụ (service account) → để máy chủ được phép gửi thông báo. */
function parseServiceAccount(text) {
  const j = parse(text, 'khoá');
  if (j.project_info) throw new Error('Đây là file google-services.json — hãy tải nó ở ô thứ 1');
  if (j.type !== 'service_account' || !j.private_key || !j.client_email || !j.project_id) throw new Error('Đây không phải file khoá tài khoản dịch vụ (service account) của Firebase');
  try { crypto.createPrivateKey(j.private_key); } catch { throw new Error('Khoá trong file bị hỏng'); }
  return { project_id: j.project_id, client_email: j.client_email, private_key: j.private_key, token_uri: j.token_uri || 'https://oauth2.googleapis.com/token' };
}

// mã truy cập Google (hạn 1 giờ) — dùng lại cho mọi lần gửi
const tokens = new Map(), pending = new Map();
function accessToken(sa) {
  const c = tokens.get(sa.client_email);
  if (c && c.exp - 120e3 > Date.now()) return Promise.resolve(c.token);
  // nhiều tin gửi cùng lúc → chỉ xin 1 mã
  if (!pending.has(sa.client_email)) pending.set(sa.client_email, fetchToken(sa).finally(() => pending.delete(sa.client_email)));
  return pending.get(sa.client_email);
}
async function fetchToken(sa) {
  const iat = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: sa.token_uri, iat, exp: iat + 3600 }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${claims}`), sa.private_key);
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${b64u(sig)}` }).toString();
  const r = await request(sa.token_uri, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (r.status !== 200 || !r.json || !r.json.access_token) {
    throw new Error('Google từ chối khoá: ' + ((r.json && (r.json.error_description || r.json.error)) || r.error || 'mã ' + r.status));
  }
  tokens.set(sa.client_email, { token: r.json.access_token, exp: Date.now() + (Number(r.json.expires_in) || 3600) * 1000 });
  return r.json.access_token;
}
const forget = (sa) => tokens.delete(sa.client_email);

/** Gửi 1 thông báo tới 1 máy. Trả về { status, gone } — gone = app đã gỡ / mã máy hết hạn → xoá khỏi danh sách. */
async function send(sa, token, payload, { ttl = 86400 } = {}) {
  let at;
  try { at = await accessToken(sa); } catch (e) { return { status: 0, error: e.message }; }
  const data = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v === undefined || v === null) continue;
    data[k] = typeof v === 'boolean' ? (v ? '1' : '0') : String(v);
  }
  // chỉ gửi "data" (không gửi "notification") để app tự vẽ thông báo, gộp theo đoạn chat; ưu tiên cao để đánh thức máy đang ngủ
  const message = { token, data, android: { priority: 'HIGH', ttl: `${ttl}s` } };
  const r = await request(`${FCM_BASE}/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`, {
    headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (r.status === 200) return { status: 200 };
  const err = (r.json && r.json.error) || {};
  const code = (Array.isArray(err.details) && (err.details.find((d) => d && d.errorCode) || {}).errorCode) || err.status || '';
  if (r.status === 401) forget(sa);
  const gone = r.status === 404 || code === 'UNREGISTERED' || (r.status === 400 && /registration token/i.test(err.message || ''));
  return { status: r.status, gone, error: r.error || [code, err.message].filter(Boolean).join(': ') || 'mã ' + r.status };
}

module.exports = { parseClient, parseServiceAccount, accessToken, send, forget };
