'use strict';
/* Gửi thông báo đẩy (Web Push) tới điện thoại / máy tính — kể cả khi đã đóng app.
 * Tự viết bằng crypto có sẵn của Node, không cần thư viện ngoài.
 * Chuẩn: RFC 8291 (mã hoá nội dung aes128gcm) + RFC 8292 (khoá VAPID). */
const crypto = require('crypto');
const https = require('https');

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');

/** Cặp khoá VAPID của máy chủ (tạo 1 lần, lưu trong cài đặt). */
function generateVapidKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}
function vapidKeyObject(publicKey, privateKey) {
  const pub = fromB64u(publicKey);
  return crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) } });
}
/** Header Authorization: JWT ký ES256, hạn 12 giờ. */
function vapidHeader(endpoint, vapid) {
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: vapid.subject }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: vapid.key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${vapid.publicKey}`;
}

/** Mã hoá nội dung cho đúng 1 thiết bị (RFC 8291). salt / ecdh chỉ truyền vào khi chạy bộ kiểm tra. */
function encrypt(payload, p256dh, auth, { salt = crypto.randomBytes(16), ecdh } = {}) {
  const uaPublic = fromB64u(p256dh);
  if (!ecdh) { ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys(); }
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, fromB64u(auth), keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, ct]);
}

/** Gửi 1 thông báo. Trả về { status } — 201 là thành công, 404/410 là thiết bị đã huỷ đăng ký. */
function send(sub, payload, vapid, { ttl = 86400, urgency = 'high', topic } = {}) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(sub.endpoint); } catch { resolve({ status: 0, error: 'endpoint' }); return; }
    let body;
    try { body = encrypt(JSON.stringify(payload), sub.p256dh, sub.auth); } catch (e) { resolve({ status: 0, error: e.message }); return; }
    const req = https.request(url, {
      method: 'POST', timeout: 15000,
      headers: {
        Authorization: vapidHeader(sub.endpoint, vapid), TTL: String(ttl), Urgency: urgency,
        'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', 'Content-Length': body.length,
        ...(topic ? { Topic: topic } : {}),
      },
    }, (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.end(body);
  });
}

module.exports = { generateVapidKeys, vapidKeyObject, vapidHeader, encrypt, send };
