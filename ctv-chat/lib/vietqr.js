'use strict';
/* Tạo nội dung mã QR chuyển khoản theo chuẩn VietQR (EMVCo / NAPAS 247).
 * Quét bằng app ngân hàng bất kỳ → tự điền ngân hàng, số tài khoản, số tiền, nội dung. */

const tlv = (id, value) => { const v = String(value); return id + String(v.length).padStart(2, '0') + v; };

/** CRC-16/CCITT-FALSE (đa thức 0x1021, khởi tạo 0xFFFF) — trường 63 của EMVCo. */
function crc16(str) {
  let crc = 0xffff;
  for (const byte of Buffer.from(str, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Nội dung chuyển khoản: bỏ dấu, chỉ chữ/số/khoảng trắng, tối đa 25 ký tự (để mọi ngân hàng đều nhận). */
function safeMemo(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 25).trim();
}

function vietqrPayload({ bin, account, amount, memo }) {
  const beneficiary = tlv('00', bin) + tlv('01', account);
  const merchant = tlv('00', 'A000000727') + tlv('01', beneficiary) + tlv('02', 'QRIBFTTA');
  const m = safeMemo(memo);
  let s = tlv('00', '01') + tlv('01', amount ? '12' : '11') + tlv('38', merchant) + tlv('53', '704')
    + (amount ? tlv('54', String(Math.round(amount))) : '') + tlv('58', 'VN') + (m ? tlv('62', tlv('08', m)) : '');
  s += '6304';
  return s + crc16(s);
}

module.exports = { vietqrPayload, safeMemo, crc16 };
