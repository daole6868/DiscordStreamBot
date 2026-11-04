/* CTV Chat — giao diện (Vue 3, không cần build) */
(function () {
  const { createApp, reactive, computed, watch, nextTick } = Vue;

  // ================================================================ tiện ích
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const pad = (n) => String(n).padStart(2, '0');
  const money = (n) => (Number(n) || 0).toLocaleString('vi-VN') + 'đ';
  function compact(n) {
    n = Number(n) || 0;
    const f = (v, u) => (Math.round(v * 10) / 10).toString().replace('.', ',') + u;
    if (Math.abs(n) >= 1e9) return f(n / 1e9, ' tỷ');
    if (Math.abs(n) >= 1e6) return f(n / 1e6, 'tr');
    if (Math.abs(n) >= 1e3) return f(n / 1e3, 'K');
    return String(n);
  }
  /** "150k" → 150000, "1.5tr" / "1,5m" → 1500000, "150.000" → 150000 */
  function parseMoney(s) {
    s = String(s ?? '').trim().toLowerCase().replace(/\s|đ|vnd/g, '');
    if (!s) return null;
    let mult = 1;
    if (/(tr|m)$/.test(s)) { mult = 1e6; s = s.replace(/(tr|m)$/, ''); }
    else if (/k$/.test(s)) { mult = 1e3; s = s.slice(0, -1); }
    s = mult > 1 ? s.replace(',', '.') : s.replace(/[.,]/g, '');
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * mult) : NaN;
  }
  const fmtTime = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtDay = (t) => { const d = new Date(t); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
  const fmtDT = (t) => (t ? `${fmtTime(t)} ${fmtDay(t)}` : '');
  const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  const WD = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
  function dayLabel(t) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d = new Date(t); d.setHours(0, 0, 0, 0);
    const diff = Math.round((today - d) / 86400e3);
    if (diff === 0) return 'Hôm nay';
    if (diff === 1) return 'Hôm qua';
    if (diff < 7) return `${WD[d.getDay()]}, ${fmtDay(t)}`;
    return fmtDay(t);
  }
  function shortTime(t) {
    if (!t) return '';
    const diff = (Date.now() - t) / 60e3;
    if (diff < 1) return 'Vừa xong';
    if (dayKey(t) === dayKey(Date.now())) return fmtTime(t);
    if (diff < 7 * 1440) return ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][new Date(t).getDay()];
    const d = new Date(t);
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  }
  function agoText(t) {
    if (!t) return '';
    const m = Math.floor((Date.now() - t) / 60e3);
    if (m < 1) return 'vừa xong';
    if (m < 60) return `${m} phút trước`;
    if (m < 1440) return `${Math.floor(m / 60)} giờ trước`;
    return `${Math.floor(m / 1440)} ngày trước`;
  }
  const initials = (name) => String(name || '?').trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase();
  const linkify = (text) => String(text || '').split(/(https?:\/\/[^\s<]+)/g).map((v, i) => ({ url: i % 2 === 1, v }));
  const toLocalInput = (t) => { if (!t) return ''; const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

  // ================================================================ biểu tượng
  const ICONS = {
    chat: '<path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.6-5.2A8.5 8.5 0 1 1 21 12z"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    reply: '<path d="M9 17l-5-5 5-5"/><path d="M4 12h11a5 5 0 0 1 5 5v2"/>',
    clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 12h6M9 16h4"/>',
    userplus: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6"/>',
    share: '<path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/>',
    at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
    orders: '<path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 3"/>',
    users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-4-6.3"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    group: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M19 8v6M16 11h6"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    note: '<path d="M4 4h16v12l-4 4H4z"/><path d="M8 9h8M8 13h5"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    upload: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
    money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 10v4M18 10v4"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
    chevl: '<path d="m15 18-6-6 6-6"/>',
    chevr: '<path d="m9 18 6-6-6-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    up: '<path d="m18 15-6-6-6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    restore: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><path d="M3 3l18 18"/>',
  };
  const Ic = {
    props: ['n', 's'],
    computed: { svg() { return `<svg viewBox="0 0 24 24" width="${this.s || 20}" height="${this.s || 20}">${ICONS[this.n] || ''}</svg>`; } },
    template: '<i class="ic" v-html="svg"></i>',
  };

  const DEADLINES = [['2h', '2 giờ', 2], ['5h', '5 giờ', 5], ['10h', '10 giờ', 10], ['1d', '1 ngày', 24], ['2d', '2 ngày', 48], ['3d', '3 ngày', 72], ['5d', '5 ngày', 120], ['7d', '7 ngày', 168]].map(([k, t, h]) => ({ k, t, h }));

  // ================================================================ trạng thái chung
  const S = reactive({
    phase: 'loading', needSetup: false, authTab: 'login', authErr: '', authBusy: false,
    me: null, settings: { appName: 'CTV Chat' },
    users: {}, convs: [], activeId: null,
    msgs: {}, more: {}, orders: {}, loadingMsgs: false,
    view: 'chat', pending: 0, mobileChat: false, info: innerWidth > 1280, convQ: '', search: null, push: '', mentioned: {}, banner: null,
    modal: null, lightbox: null, toasts: [], busy: '', connected: true,
    theme: lsGet('ctv.theme') || 'auto', sound: lsGet('ctv.sound') !== '0',
    notif: typeof Notification !== 'undefined' && Notification.permission === 'granted',
    revUser: null, histUser: null, ordersTick: 0, summaryTick: 0, flashMsg: null,
    banks: [], settlePending: 0, settleTick: 0, usersTick: 0,
  });
  const isAdmin = () => !!S.me && S.me.role === 'admin';
  const uname = (id) => (S.users[id] ? S.users[id].name : id ? `#${id}` : 'Hệ thống');

  function toast(msg, type = 'ok', ms = 3000, icon = null) {
    const t = { id: Math.random(), msg, type, icon };
    S.toasts.push(t);
    setTimeout(() => { S.toasts = S.toasts.filter((x) => x.id !== t.id); }, ms);
  }
  function applyTheme() {
    const t = S.theme;
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    lsSet('ctv.theme', t);
  }

  // ================================================================ gọi server
  async function api(method, url, body) {
    const init = { method, headers: { 'X-Requested-With': 'ctv' }, credentials: 'same-origin' };
    if (body instanceof Blob) { init.body = body; init.headers['Content-Type'] = body.type || 'application/octet-stream'; }
    else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
    let r;
    try { r = await fetch(url, init); } catch { throw new Error('Mất kết nối tới máy chủ'); }
    const txt = await r.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
    if (!r.ok) {
      if (r.status === 401 && S.phase === 'app') { location.reload(); }
      const e = new Error((data && data.error) || `Lỗi ${r.status}`);
      e.status = r.status;
      throw e;
    }
    return data;
  }
  const tryApi = async (...a) => { try { return await api(...a); } catch (e) { toast(e.message, 'err', 4500); throw e; } };

  async function compressImage(file, max = 1600) {
    if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
    try {
      const bmp = await createImageBitmap(file);
      const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
      return blob && (blob.size < file.size || file.size > 14e6) ? blob : file;
    } catch { return file; }
  }
  /** Sao chép chữ — có cách dự phòng khi mở app qua địa chỉ mạng LAN (http://192.168…). */
  function copyText(t) {
    const done = () => toast('Đã sao chép');
    if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(t).then(done, () => fallback()); return; }
    fallback();
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch { toast('Không sao chép được, hãy chọn và chép tay', 'warn'); }
      ta.remove();
    }
  }
  /** Vẽ mã QR (VietQR) thành SVG — chạy hoàn toàn trên máy, không cần internet. */
  function qrSvg(text) {
    try { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); } catch { return ''; }
  }
  const bankLabel = (b) => (b ? `${b.short} · ${b.account}` : '');

  /** Cắt ảnh thành hình vuông (lấy phần giữa) để làm ảnh đại diện. */
  async function squareAvatar(file, size = 320) {
    try {
      const bmp = await createImageBitmap(file);
      const s = Math.min(bmp.width, bmp.height);
      const c = document.createElement('canvas');
      c.width = c.height = Math.min(size, s);
      c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, c.width, c.height);
      return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    } catch { return null; }
  }
  async function uploadAvatar(file) {
    if (!file || !file.type.startsWith('image/')) { toast('Hãy chọn một file ảnh', 'warn'); return null; }
    const blob = await squareAvatar(file);
    if (!blob) { toast('Không đọc được ảnh này', 'err'); return null; }
    S.busy = 'Đang tải ảnh…';
    try { return (await api('POST', '/api/upload', blob)).url; } catch (e) { toast(e.message, 'err'); return null; } finally { S.busy = ''; }
  }
  function applyUser(u) {
    if (S.me && S.me.id === u.id) S.me = { ...S.me, ...u };
    S.users[u.id] = { ...(S.users[u.id] || {}), ...Object.fromEntries(Object.entries(u).filter(([, v]) => v !== undefined)) };
  }
  async function uploadImages(files) {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) { toast('Chỉ gửi được file ảnh', 'warn'); return []; }
    const urls = [];
    S.busy = `Đang tải ${list.length} ảnh…`;
    try {
      for (const f of list) urls.push((await api('POST', '/api/upload', await compressImage(f))).url);
    } catch (e) { toast(e.message, 'err'); } finally { S.busy = ''; }
    return urls;
  }

  // ================================================================ hộp thoại dùng chung
  function confirmBox(opts) {
    return new Promise((resolve) => { S.modal = { kind: 'confirm', ...opts, resolve }; });
  }
  function closeModal(val) {
    const m = S.modal;
    S.modal = null;
    if (m && m.resolve) m.resolve(val);
  }

  // ================================================================ âm báo & thông báo
  let audioCtx = null;
  function beep() {
    if (!S.sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const t = audioCtx.currentTime;
      [880, 1320].forEach((f, i) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = f; o.type = 'sine';
        g.gain.setValueAtTime(0.0001, t + i * 0.12);
        g.gain.exponentialRampToValueAtTime(0.15, t + i * 0.12 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.18);
        o.connect(g).connect(audioCtx.destination);
        o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.2);
      });
    } catch {}
  }
  function notify(title, body, convId) {
    if (S.push === 'on') return; // máy này đã nhận thông báo đẩy → không báo trùng
    if (!S.notif || !document.hidden || typeof Notification === 'undefined') return;
    try {
      const n = new Notification(title, { body, tag: 'conv-' + convId, icon: '/icons/icon-192.png' });
      n.onclick = () => { window.focus(); openConv(convId); n.close(); };
    } catch {}
  }

  // ================================================================ thông báo đẩy (thanh thông báo của điện thoại, kể cả khi đã đóng app)
  // Cần mở app qua https:// (hoặc http://localhost). iPhone: phải "Thêm vào Màn hình chính" rồi mở từ biểu tượng.
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const b64uBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
  async function pushInit() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) { S.push = window.isSecureContext ? 'unsupported' : 'insecure'; return; }
    try {
      navigator.serviceWorker.addEventListener('message', (e) => {
        const m = e.data && e.data.type === 'open' && /#\/chat\/(\d+)/.exec(e.data.url || '');
        if (m) openConv(Number(m[1]));
      });
      const reg = await navigator.serviceWorker.register('/sw.js');
      if (!('PushManager' in window) || typeof Notification === 'undefined') { S.push = isIOS && !standalone() ? 'ios' : 'unsupported'; return; }
      if (Notification.permission === 'denied') { S.push = 'denied'; return; }
      const sub = await reg.pushManager.getSubscription();
      if (sub && Notification.permission === 'granted') await pushSubscribe(reg, sub);
      else S.push = 'off';
    } catch (e) { console.warn('[thông báo]', e); S.push = 'unsupported'; }
  }
  async function pushSubscribe(reg, sub) {
    const { key } = await api('GET', '/api/push/key');
    const want = b64uBytes(key);
    const have = sub && sub.options && sub.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
    // khoá máy chủ đã đổi (vd. khôi phục bản sao lưu cũ) → đăng ký lại
    if (sub && (!have || have.length !== want.length || have.some((x, i) => x !== want[i]))) { await sub.unsubscribe().catch(() => {}); sub = null; }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
    await api('POST', '/api/push/subscribe', { sub: sub.toJSON() });
    S.push = 'on';
  }
  async function enablePush() {
    if (['insecure', 'unsupported', 'ios', ''].includes(S.push)) { go('account'); return; }
    try {
      const p = await Notification.requestPermission();
      if (p !== 'granted') { S.push = p === 'denied' ? 'denied' : 'off'; toast('Bạn chưa cho phép thông báo', 'warn'); return; }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      await pushSubscribe(reg, await reg.pushManager.getSubscription());
      toast('Đã bật thông báo trên máy này', 'ok', 3000, 'bell');
    } catch (e) { toast('Không bật được thông báo: ' + e.message, 'err'); }
  }
  async function disablePush(quiet) {
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
      const sub = reg && (await reg.pushManager.getSubscription());
      if (sub) { await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
    } catch {}
    if (S.push === 'on') S.push = 'off';
    if (quiet !== true) toast('Đã tắt thông báo trên máy này');
  }

  // ================================================================ @nhắc tên trong nhóm
  const mentionsMe = (m) => !!(m && m.mentions && S.me && (m.mentions.all || (m.mentions.ids || []).includes(S.me.id)));
  const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    /** Chia chữ tin nhắn: link, @nhắc tên (tô màu), chữ thường. */
  /** Các cách gọi 1 người khi tag (đã bỏ dấu): "@du duc quang", "@quang", "@duc"… */
  function mentionKeys(name) {
    const w = fold(name).trim().split(/\s+/).filter(Boolean);
    const keys = new Set([w.join(' '), w.join('')]);
    w.forEach((x, i) => { if (x.length >= 3 || i === w.length - 1) keys.add(x); });
    return [...keys].filter(Boolean);
  }
  const ALL_KEYS = ['all', 'tat ca', 'tatca', 'everyone', 'moi nguoi'];
  /** Tìm các @tag trong chữ (so không dấu, không phân biệt hoa thường). Trả về [{a, b, ids}] theo vị trí ký tự gốc. */
  function findMentions(text, cands) {
    const chars = Array.from(String(text || ''));
    const map = []; let f = '';
    chars.forEach((ch, i) => { const x = fold(ch); for (let k = 0; k < x.length; k++) map.push(i); f += x; });
    const out = [];
    for (let p = f.indexOf('@'); p >= 0; p = f.indexOf('@', p + 1)) {
      if (p > 0 && !/\s/.test(f[p - 1])) continue; // @ phải đứng đầu hoặc sau dấu cách (không nhầm với email)
      const rest = f.slice(p + 1);
      let len = 0, ids = [];
      for (const c of cands) for (const k of c.keys) {
        if (!rest.startsWith(k) || /[a-z0-9]/.test(rest[k.length] || '')) continue;
        if (k.length > len) { len = k.length; ids = [c.id]; } else if (k.length === len && !ids.includes(c.id)) ids.push(c.id);
      }
      if (len) out.push({ a: map[p], b: map[p + len] + 1, ids });
    }
    return out;
  }
  /** Chia chữ tin nhắn: link, @nhắc tên (tô màu), chữ thường. */
  function richText(m) {
    const parts = linkify(m.text);
    const men = m.mentions;
    if (!men) return parts;
    const cands = (men.ids || []).map((id) => ({ id, keys: mentionKeys(uname(id)) }));
    if (men.all) cands.push({ id: 'all', keys: ALL_KEYS });
    if (!cands.length) return parts;
    const out = [];
    for (const p of parts) {
      if (p.url) { out.push(p); continue; }
      const chars = Array.from(p.v);
      let at = 0;
      for (const sp of findMentions(p.v, cands)) {
        if (sp.a > at) out.push({ v: chars.slice(at, sp.a).join('') });
        out.push({ v: chars.slice(sp.a, sp.b).join(''), mention: true, me: sp.ids.includes('all') || sp.ids.includes(S.me.id) });
        at = sp.b;
      }
      if (at < chars.length) out.push({ v: chars.slice(at).join('') });
    }
    return out;
  }

  // ---------------------------------------------------------------- thông báo nổi trong app (khi đang mở app ở chỗ khác)
  let bannerT = null;
  function showBanner(c, msg, me) {
    const who = msg.senderId ? uname(msg.senderId) : convTitle(c);
    const title = me ? `${who} nhắc đến bạn · ${convTitle(c)}` : c.type === 'group' && msg.senderId ? `${who} · ${convTitle(c)}` : who;
    S.banner = { id: msg.id, convId: c.id, senderId: msg.senderId, title, body: previewBody(c), icon: previewIcon(c), mention: me };
    clearTimeout(bannerT);
    bannerT = setTimeout(() => { if (S.banner && S.banner.id === msg.id) S.banner = null; }, me ? 9000 : 6000);
    if (navigator.vibrate) try { navigator.vibrate(me ? [70, 50, 70] : 40); } catch {}
  }

  // ================================================================ dữ liệu
  function convById(id) { return S.convs.find((c) => c.id === id); }
  function convTitle(c) {
    if (!c) return '';
    if (c.type === 'group') return c.name || 'Nhóm';
    return uname(c.partnerId);
  }
  /** Dòng xem trước ở danh sách chat, chia 2 phần: "Bạn: " / "Quang: " và nội dung (để chèn biểu tượng vào giữa). */
  function previewWho(c) {
    const m = c.lastMsg;
    if (!m || m.deleted || m.type === 'system') return '';
    return m.senderId === S.me.id ? 'Bạn: ' : c.type === 'group' ? uname(m.senderId).split(' ').pop() + ': ' : '';
  }
  function previewBody(c) {
    const m = c.lastMsg;
    if (!m) return c.type === 'group' ? 'Nhóm mới tạo' : 'Bắt đầu trò chuyện';
    if (m.deleted) return 'Tin nhắn đã thu hồi';
    if (m.type === 'order') { const o = S.orders[m.orderId]; return 'Đơn mới' + (o ? ` ${o.code} · ${money(o.price)}` : ''); }
    if (m.type === 'system') return m.text;
    if (!m.text && m.images.length) return `${m.images.length} ảnh`;
    if (!m.text && m.imgPurged) return 'Ảnh đã tự xoá';
    return m.text;
  }
  const msgPreview = (c) => previewWho(c) + previewBody(c);
  /** Biểu tượng đứng trước dòng xem trước (ảnh, đơn, tin hệ thống). */
  function previewIcon(c) {
    const m = c.lastMsg;
    if (!m || m.deleted) return null;
    if (m.type === 'order') return 'orders';
    if (m.type === 'system') return m.icon || null;
    if (!m.text && (m.images.length || m.imgPurged)) return 'image';
    return null;
  }
  // ================================================================ tìm kiếm
  /** Bỏ dấu + chữ thường — giống hệt máy chủ, để gõ không dấu vẫn tô đúng chữ có dấu. */
  const fold = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
  const searchTerms = (q) => fold(q).split(/\s+/).filter(Boolean).slice(0, 6)
    .map((t) => { const m = /^(dh|kt)0*(\d{1,6})$/.exec(t); return m ? m[1] + m[2].padStart(4, '0') : t; });
  const matchAll = (text, terms) => { const f = fold(text); return terms.every((t) => f.includes(t)); };
  const matchAny = (text, terms) => { const f = fold(text); return terms.some((t) => f.includes(t)); };
  /** Chia chữ thành các đoạn {s, h} (h = khớp). snip = cắt gọn quanh chỗ khớp đầu tiên. */
  function hlParts(text, terms, snip) {
    const chars = Array.from(String(text ?? '').replace(/\s+/g, ' '));
    const map = []; let f = '';
    chars.forEach((ch, i) => { const x = fold(ch); for (let k = 0; k < x.length; k++) map.push(i); f += x; });
    const mark = new Array(chars.length).fill(false);
    let first = -1;
    for (const t of terms || []) {
      if (!t) continue;
      for (let p = f.indexOf(t); p >= 0; p = f.indexOf(t, p + t.length)) {
        for (let k = p; k < p + t.length; k++) mark[map[k]] = true;
        if (first < 0 || map[p] < first) first = map[p];
      }
    }
    let a = 0, b = chars.length;
    if (snip && chars.length > snip) { a = Math.max(0, (first < 0 ? 0 : first) - Math.floor(snip / 3)); b = Math.min(chars.length, a + snip); a = Math.max(0, b - snip); }
    const parts = a > 0 ? [{ s: '…', h: false }] : [];
    for (let i = a; i < b; i++) { const last = parts[parts.length - 1]; if (last && last.h === mark[i]) last.s += chars[i]; else parts.push({ s: chars[i], h: mark[i] }); }
    if (b < chars.length) parts.push({ s: '…', h: false });
    return parts;
  }
  function openSearch(opts = {}) { S.search = { q: opts.q || '', convId: opts.convId || null, tab: opts.tab || 'all' }; }

  /** Phần trích dẫn của 1 tin (giống dữ liệu replyTo máy chủ trả về). */
  function quoteOfMsg(m) {
    const q = { id: m.id, senderId: m.senderId, type: m.type, deleted: !!m.deleted, text: null, image: null, images: 0, orderCode: null };
    if (m.type === 'order') { const o = S.orders[m.orderId]; q.orderCode = o ? o.code : ''; q.text = o ? o.content : null; }
    else { q.text = m.text; q.images = (m.images || []).length; q.image = (m.images || [])[0] || null; }
    return q;
  }
  function quoteText(q) {
    if (!q) return '';
    if (q.deleted) return 'Tin nhắn đã thu hồi';
    if (q.type === 'order') return `Đơn ${q.orderCode}${q.text ? ': ' + q.text : ''}`;
    if (q.text) return q.text;
    return q.images > 1 ? `${q.images} ảnh` : 'Ảnh';
  }
  const quoteIcon = (q) => (!q || q.deleted ? null : q.type === 'order' ? 'orders' : !q.text ? 'image' : null);
  function sortConvs() { S.convs.sort((a, b) => b.lastMsgAt - a.lastMsgAt); }
  let convTimer = null;
  function refreshConvsSoon() {
    clearTimeout(convTimer);
    convTimer = setTimeout(async () => {
      try {
        const list = await api('GET', '/api/convs');
        S.convs = list;
        sortConvs();
      } catch {}
    }, 250);
  }

  async function bootstrap() {
    const d = await api('GET', '/api/bootstrap');
    S.me = d.me;
    S.settings = d.settings;
    S.users = Object.fromEntries(d.users.map((u) => [u.id, u]));
    S.users[d.me.id] = d.me;
    S.convs = d.convs;
    sortConvs();
    S.pending = d.pending;
    S.settlePending = d.settlePending || 0;
    api('GET', '/api/banks').then((b) => { S.banks = b; }).catch(() => {});
    S.phase = 'app';
    connectEvents();
    pushInit();
    readHash();
    if (S.view === 'chat' && !S.activeId && innerWidth > 760 && S.convs.length) openConv(S.convs[0].id);
  }

  async function loadMessages(convId, older, untilId) {
    const list = S.msgs[convId];
    const before = older && list && list.length ? list[0].id : null;
    S.loadingMsgs = true;
    try {
      const d = await api('GET', `/api/convs/${convId}/messages?limit=40${before ? '&before=' + before : ''}${before && untilId ? '&until=' + untilId : ''}`);
      for (const o of d.orders) S.orders[o.id] = o;
      const ids = new Set((S.msgs[convId] || []).map((m) => m.id));
      const fresh = d.messages.filter((m) => !ids.has(m.id));
      S.msgs[convId] = before ? [...fresh, ...(S.msgs[convId] || [])] : fresh.concat((S.msgs[convId] || []).filter((m) => m.id > (fresh.length ? fresh[fresh.length - 1].id : 0)));
      S.more[convId] = d.hasMore;
    } finally { S.loadingMsgs = false; }
  }

  async function openConv(id) {
    delete S.mentioned[id];
    const oc = convById(id);
    if (oc) oc.mention = false;
    S.view = 'chat';
    S.activeId = id;
    S.mobileChat = true;
    writeHash();
    if (!S.msgs[id]) await loadMessages(id);
    markRead();
  }
  let readTimer = null;
  function markRead() {
    clearTimeout(readTimer);
    readTimer = setTimeout(() => {
      const c = convById(S.activeId);
      const list = S.msgs[S.activeId];
      if (!c || !list || !list.length || document.hidden || S.view !== 'chat') return;
      const last = list[list.length - 1].id;
      c.unread = 0;
      if ((c.reads[S.me.id] || 0) < last) {
        c.reads[S.me.id] = last;
        api('POST', `/api/convs/${c.id}/read`, { lastId: last }).catch(() => {});
      }
    }, 300);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) markRead(); });

  async function openDm(userId) {
    const c = await tryApi('POST', '/api/convs/dm', { userId });
    if (!convById(c.id)) { S.convs.unshift(c); sortConvs(); }
    await openConv(c.id);
  }

  // ================================================================ thời gian thực
  let es = null, wasDown = false;
  function connectEvents() {
    if (es) es.close();
    es = new EventSource('/api/events');
    es.onopen = () => {
      S.connected = true;
      if (wasDown) { wasDown = false; resync(); }
    };
    es.onerror = () => { S.connected = false; wasDown = true; };
    const on = (ev, fn) => es.addEventListener(ev, (e) => { try { fn(JSON.parse(e.data)); } catch (err) { console.error(err); } });
    on('msg', ({ msg, order }) => {
      if (order) S.orders[order.id] = order;
      const list = S.msgs[msg.convId];
      if (list && !list.some((m) => m.id === msg.id)) list.push(msg);
      const c = convById(msg.convId);
      if (!c) { refreshConvsSoon(); return; }
      c.lastMsg = msg; c.lastMsgAt = msg.createdAt;
      if (msg.senderId) c.reads[msg.senderId] = Math.max(c.reads[msg.senderId] || 0, msg.id);
      sortConvs();
      if (msg.senderId !== S.me.id) {
        const viewing = S.activeId === msg.convId && S.view === 'chat' && !document.hidden;
        if (viewing) markRead();
        else {
          c.unread = (c.unread || 0) + 1;
          // nhóm: chỉ kêu khi được @nhắc tên (hoặc đã bật "báo mọi tin trong nhóm")
          const me = mentionsMe(msg);
          if (me) S.mentioned[c.id] = true;
          if (c.type !== 'group' || me || S.me.notifyGroup) {
            beep();
            notify(convTitle(c), (me ? 'Nhắc đến bạn · ' : '') + msgPreview(c), c.id);
            showBanner(c, msg, me);
          }
        }
      }
      if (order || msg.orderId) { refreshConvsSoon(); S.summaryTick++; }
    });
    on('msgdel', ({ id, convId }) => {
      const m = (S.msgs[convId] || []).find((x) => x.id === id);
      if (m) { m.deleted = true; m.text = null; m.images = []; m.replyTo = null; }
      for (const x of S.msgs[convId] || []) if (x.replyTo && x.replyTo.id === id) x.replyTo = { ...x.replyTo, deleted: true, text: null, image: null };
      const c = convById(convId);
      if (c && c.lastMsg && c.lastMsg.id === id) c.lastMsg = { ...c.lastMsg, deleted: true };
    });
    on('order', ({ order }) => { S.orders[order.id] = order; S.ordersTick++; S.summaryTick++; refreshConvsSoon(); });
    on('read', ({ convId, userId, lastRead }) => { const c = convById(convId); if (c) c.reads[userId] = lastRead; });
    on('presence', ({ userId, online, lastSeen }) => { const u = S.users[userId]; if (u) { u.online = online; if (lastSeen) u.lastSeen = lastSeen; } });
    on('conv', () => refreshConvsSoon());
    on('users', ({ pending }) => { S.pending = pending; S.ordersTick++; });
    // admin bật tự xoá dữ liệu cũ → bỏ dữ liệu đã tải sẵn, tải lại phần đang xem
    on('purged', ({ orderIds, credIds }) => {
      for (const id of orderIds || []) delete S.orders[id];
      for (const id of credIds || []) if (S.orders[id]) S.orders[id] = { ...S.orders[id], credentials: null, credPurgedAt: Date.now() };
      for (const k of Object.keys(S.msgs)) if (Number(k) !== S.activeId) delete S.msgs[k];
      if (S.activeId) loadMessages(S.activeId).catch(() => {});
      S.ordersTick++; S.summaryTick++; S.settleTick++;
      refreshConvsSoon();
    });
    on('settlement', ({ settlement, justPaid }) => {
      S.settleTick++; S.ordersTick++; S.summaryTick++;
      refreshSettleCount();
      if (justPaid && settlement && settlement.userId === S.me.id) toast(`Admin đã thanh toán lương ${settlement.code} · ${money(settlement.amount)}`, 'ok', 6000, 'money');
    });
    on('user', ({ user }) => { applyUser(user); S.usersTick++; });
    on('settings', (st) => { S.settings = st; });
    on('account', () => location.reload());
    on('reload', () => { toast('Dữ liệu vừa được admin khôi phục — đang tải lại…', 'warn'); setTimeout(() => location.reload(), 1500); });
  }
  let settleCountT = null;
  function refreshSettleCount() {
    clearTimeout(settleCountT);
    settleCountT = setTimeout(async () => { try { S.settlePending = (await api('GET', '/api/settlements')).pending.length; } catch {} }, 300);
  }
  async function resync() {
    try {
      const d = await api('GET', '/api/bootstrap');
      S.users = Object.fromEntries(d.users.map((u) => [u.id, u]));
      S.users[d.me.id] = d.me;
      S.convs = d.convs; sortConvs(); S.pending = d.pending;
      if (S.activeId) await loadMessages(S.activeId);
      S.ordersTick++;
    } catch {}
  }

  // ================================================================ điều hướng (#/chat/12, #/revenue…)
  const VIEWS = ['chat', 'orders', 'revenue', 'settle', 'history', 'members', 'settings', 'account'];
  function writeHash() {
    const h = S.view === 'chat' && S.activeId ? `#/chat/${S.activeId}` : `#/${S.view}`;
    if (location.hash !== h) history.replaceState(null, '', h);
  }
  function readHash() {
    const [, v, id] = location.hash.split('/');
    if (VIEWS.includes(v) && (isAdmin() || !['members', 'settings'].includes(v))) S.view = v;
    if (v === 'chat' && id && convById(Number(id))) openConv(Number(id));
  }
  function go(view) {
    S.view = view;
    if (view !== 'chat') S.mobileChat = false;
    writeHash();
    if (view === 'chat') markRead();
  }

  // ================================================================ thao tác đơn
  function openOrderForm(opts = {}) {
    S.modal = { kind: 'order', order: opts.order || null, assigneeId: opts.assigneeId || (opts.order && opts.order.assigneeId) || null };
  }
  async function openOrderDetail(id) {
    const d = await tryApi('GET', `/api/orders/${id}`);
    S.orders[id] = d.order;
    S.modal = { kind: 'orderDetail', orderId: id, logs: d.logs };
  }
  async function jumpToMsg(convId, msgId, orderId) {
    S.modal = null;
    S.search = null;
    await openConv(convId);
    const has = () => (S.msgs[convId] || []).some((m) => m.id === msgId);
    if (!has() && S.more[convId]) await loadMessages(convId, true, msgId);
    for (let i = 0; i < 5 && !has() && S.more[convId]; i++) await loadMessages(convId, true);
    await nextTick();
    const el = document.querySelector(`[data-mid="${msgId}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      S.flashMsg = msgId;
      setTimeout(() => { if (S.flashMsg === msgId) S.flashMsg = null; }, 2200);
    } else if (orderId) openOrderDetail(orderId);
  }

  function logText(l) {
    const a = uname(l.actorId), t = uname(l.targetUserId), c = l.orderCode, d = l.details || {};
    const ch = d.changes || {};
    const parts = [];
    if (ch.content) parts.push('nội dung');
    if (ch.price) parts.push(`tiền công ${money(ch.price[0])} → ${money(ch.price[1])}`);
    if (ch.discountPct) parts.push(`chiết khấu ${ch.discountPct[0]}% → ${ch.discountPct[1]}%`);
    if (ch.net) parts.push(`thực nhận ${money(ch.net[0])} → ${money(ch.net[1])}`);
    if (ch.credentials) parts.push('tài khoản / mật khẩu');
    if (ch.deadline) parts.push(`hạn ${ch.deadline[0] ? fmtDT(ch.deadline[0]) : 'không có'} → ${ch.deadline[1] ? fmtDT(ch.deadline[1]) : 'không có'}`);
    const map = {
      'order.create': `${a} tạo đơn ${c} giao cho ${t} · tiền công ${money(d.price)}${d.discountPct ? ` − chiết khấu ${d.discountPct}% = thực nhận ${money(d.net)}` : ''}${d.hasCredentials ? ' · có tài khoản/mật khẩu' : ''}`,
      'order.edit': `${a} sửa đơn ${c}: ${parts.join(', ') || 'thông tin'}`,
      'order.proof': `${a} gửi ${d.added} ảnh cho đơn ${c} (tổng ${d.total} ảnh)`,
      'order.proof_remove': `${a} xoá 1 ảnh của đơn ${c} (còn ${d.total})`,
      'order.note': d.after ? `${a} ghi chú đơn ${c}: “${d.after}”` : `${a} xoá ghi chú đơn ${c}`,
      'order.done': `${a} bấm DONE đơn ${c} · thực nhận ${money(d.net ?? d.price)}`,
      'order.reopen': `${a} mở lại đơn ${c} (không tính tiền nữa)`,
      'order.paid': `${a} đánh dấu ĐÃ THANH TOÁN đơn ${c} · ${money(d.price)} (bản cũ)`,
      'order.unpaid': `${a} bỏ đánh dấu thanh toán đơn ${c} (bản cũ)`,
      'settlement.create': `${l.actorId ? a : 'Hệ thống'} kết toán ${d.code} (${d.label}) cho ${t}: ${d.count} đơn · thực nhận ${money(d.amount)}`,
      'settlement.paid': `${a} đã THANH TOÁN lương ${d.code} (${d.label}) cho ${t}: ${money(d.amount)}`,
      'settlement.unpaid': `${a} huỷ xác nhận thanh toán ${d.code} (${d.label}) của ${t}`,
      'settlement.cancel': d.auto ? `Kết toán ${d.code} của ${t} tự huỷ (không còn đơn)` : `${a} huỷ kết toán ${d.code} (${d.label}) của ${t}`,
      'order.delete': `${a} xoá đơn ${c}`,
      'order.restore': `${a} khôi phục đơn ${c}`,
      'user.setup': `${a} tạo ứng dụng (admin gốc)`,
      'user.register': `${t} đăng ký tham gia${d.email ? ` (${d.email})` : ''}`,
      'user.approve': `${a} duyệt cho ${t} tham gia`,
      'user.reject': `${a} từ chối ${t}`,
      'user.lock': `${a} khoá tài khoản ${t}`,
      'user.unlock': `${a} mở khoá tài khoản ${t}`,
      'user.reset_password': `${a} đặt lại mật khẩu cho ${t}`,
      'user.role': `${a} ${d.role === 'admin' ? 'cấp quyền admin cho' : 'thu quyền admin của'} ${t}`,
      'user.edit': d.discount ? `${a} đổi chiết khấu của ${t}: ${d.discount[0]}% → ${d.discount[1]}%${d.applied ? ` (áp cho ${d.applied} đơn chưa thanh toán)` : ''}` : `${a} sửa thông tin của ${t}`,
      'user.password': `${a} đổi mật khẩu`,
      'message.delete': `${a} thu hồi một tin nhắn của ${t}`,
      'settings.update': `${a} thay đổi cài đặt`,
      'backup.create': `${a} sao lưu dữ liệu thủ công`,
      'backup.restore': `${a} khôi phục dữ liệu từ bản sao lưu (${d.from || ''})`,
      'data.purge': `${l.actorId ? a + ' dọn' : 'Tự động xoá'} dữ liệu cũ theo cài đặt: ${purgeText(d)}`,
    };
    return map[l.action] || `${a}: ${l.action}`;
  }
  const purgeText = (c) => [c.images && `${c.images} ảnh`, c.creds && `${c.creds} tài khoản/mật khẩu`, c.orders && `${c.orders} đơn`].filter(Boolean).join(' · ') || 'không có gì';
  const LOG_ICON = (a) => a === 'data.purge' ? 'trash' : a.startsWith('order.done') ? 'check' : a === 'order.create' ? 'plus' : a === 'order.edit' ? 'edit' : a.startsWith('order.proof') ? 'camera'
    : a === 'order.note' ? 'note' : a.startsWith('order.paid') || a === 'order.unpaid' || a.startsWith('settlement') ? 'money' : a === 'order.delete' ? 'trash' : a.startsWith('backup') ? 'db'
    : a.startsWith('user') ? 'user' : a === 'order.reopen' || a === 'order.restore' ? 'undo' : 'history';
  const LOG_TONE = (a) => a === 'order.done' || a === 'order.paid' || a === 'settlement.paid' || a === 'user.approve' ? 'ok' : a === 'order.delete' || a === 'user.lock' || a === 'user.reject' || a === 'settlement.cancel' ? 'err' : a === 'order.edit' || a === 'order.reopen' || a === 'settlement.unpaid' ? 'warn' : '';

  // ================================================================ component: ảnh đại diện
  const Avatar = {
    props: ['u', 'size', 'dot', 'group'],
    template: `<span class="av" :style="{width: px, height: px, minWidth: px, fontSize: fs, background: group ? 'var(--ac)' : img ? 'var(--bg-soft)' : (user && user.color) || '#999'}">
      <ic v-if="group" n="users" :s="Math.round((size||40)*.5)"></ic><img v-else-if="img" :src="img" alt="" loading="lazy" @error="broken = img"><template v-else>{{ini}}</template>
      <i v-if="dot && user && user.online" class="av-dot"></i></span>`,
    data: () => ({ broken: null }),
    computed: {
      user() { return typeof this.u === 'object' ? this.u : S.users[this.u]; },
      img() { const a = !this.group && this.user && this.user.avatar; return a && a !== this.broken ? a : null; },
      px() { return (this.size || 40) + 'px'; },
      fs() { return Math.round((this.size || 40) * 0.38) + 'px'; },
      ini() { return initials(this.user ? this.user.name : '?'); },
    },
  };

  // ================================================================ component: thẻ đơn hàng
  const Hl = {
    props: ['t', 'terms', 'snip'],
    computed: { parts() { return hlParts(this.t, this.terms, this.snip); } },
    template: `<span class="hl"><template v-for="(p, i) in parts" :key="i"><mark v-if="p.h">{{p.s}}</mark><template v-else>{{p.s}}</template></template></span>`,
  };

  const SearchPanel = {
    template: '#tpl-search',
    data: () => ({ S, r: null, loading: false, err: '' }),
    computed: {
      admin: isAdmin,
      q: { get() { return S.search.q; }, set(v) { S.search.q = v; } },
      tab: { get() { return S.search.tab; }, set(v) { S.search.tab = v; } },
      scopeConv() { return S.search.convId ? convById(S.search.convId) : null; },
      terms() { return searchTerms(this.q); },
      ready() { return this.terms.join('').length >= 2; },
      tabs() {
        const t = [['all', 'Tất cả'], ['msg', 'Tin nhắn'], ['order', 'Đơn hàng'], ['cred', 'Tài khoản / MK']];
        if (!this.scopeConv) { if (this.admin) t.push(['user', 'Thành viên']); t.push(['settle', 'Kết toán']); }
        return t;
      },
      convHits() {
        if (this.tab !== 'all' || this.scopeConv || !this.ready) return [];
        return S.convs.filter((c) => matchAll(convTitle(c), this.terms)).slice(0, 5);
      },
      empty() {
        const r = this.r;
        return this.ready && r && !this.loading && !this.convHits.length && !r.messages.length && !r.orders.length && !r.users.length && !r.settlements.length;
      },
      placeholder() { return this.scopeConv ? `Tìm trong đoạn chat với ${convTitle(this.scopeConv)}…` : 'Tìm tin nhắn, đơn, tài khoản, mật khẩu…'; },
    },
    watch: {
      q() { this.soon(); },
      tab() { this.load(); },
      'S.search.convId'() { if (!this.tabs.some((t) => t[0] === this.tab)) this.tab = 'all'; this.load(); },
    },
    mounted() {
      nextTick(() => this.$refs.inp && this.$refs.inp.focus());
      if (this.ready) this.load();
    },
    methods: {
      money, fmtDT, uname, convTitle, convById,
      soon() { clearTimeout(this.t); this.t = setTimeout(() => this.load(), 250); },
      show(k) { return this.tab === 'all' || this.tab === k; },
      async load(more) {
        clearTimeout(this.t);
        if (!this.ready) { this.r = null; return; }
        const seq = (this.seq = (this.seq || 0) + 1);
        const p = new URLSearchParams({ q: this.q, type: this.tab });
        if (S.search.convId) p.set('convId', S.search.convId);
        if (more === 'msg' && this.r) p.set('before', this.r.messages[this.r.messages.length - 1].id);
        if (more === 'order' && this.r) p.set('offset', this.r.orders.length);
        this.loading = true;
        try {
          const d = await api('GET', '/api/search?' + p);
          if (seq !== this.seq) return;
          for (const o of d.orders) S.orders[o.id] = o;
          if (more && this.r) {
            if (more === 'msg') { this.r.messages.push(...d.messages); this.r.more.messages = d.more.messages; }
            if (more === 'order') { this.r.orders.push(...d.orders); this.r.more.orders = d.more.orders; }
          } else this.r = d;
          this.err = '';
        } catch (e) { if (seq === this.seq) this.err = e.message; } finally { if (seq === this.seq) this.loading = false; }
      },
      close() { S.search = null; },
      stateOf(o) { return o.deletedAt ? 'deleted' : o.paidAt ? 'paid' : o.status === 'done' ? 'done' : 'open'; },
      stateLabel(o) { return { deleted: 'Đã xoá', open: 'Đang làm', paid: 'Đã thanh toán', done: 'Hoàn thành' }[this.stateOf(o)]; },
      // dòng tài khoản / mật khẩu khớp (mật khẩu không hiện ra, chỉ báo là khớp)
      credHit(o) {
        if (!o.credentials || !matchAny(o.credentials, this.terms)) return null;
        const lines = o.credentials.split('\n');
        const i = lines.findIndex((l) => matchAny(l, this.terms));
        if (i === 1) return { label: 'Mật khẩu', text: null };
        return { label: i === 0 ? 'Tài khoản' : 'Ghi chú TK', text: lines[i] };
      },
      noteHit(o) { return o.note && matchAny(o.note, this.terms) ? o.note : null; },
      goConv(c) { S.search = null; openConv(c.id); },
      goMsg(m) { jumpToMsg(m.convId, m.id, null); },
      goOrder(o) { openOrderDetail(o.id); },
      goUser(u) { S.search = null; if (u.status === 'active' && u.id !== S.me.id) openDm(u.id); else go('members'); },
      async goSettle(st) {
        const r = await tryApi('GET', `/api/settlements/${st.id}`);
        for (const o of r.orders) S.orders[o.id] = o;
        S.modal = { kind: 'settleDetail', settlement: r.settlement, orders: r.orders };
      },
    },
  };

  const MsgQuote = {
    props: ['q'],
    template: `<div class="mquote" :class="{del: q.deleted}"><img v-if="q.image && !q.deleted" :src="q.image" alt=""><span class="mq-t"><b>{{name}}</b><span><ic v-if="icon" :n="icon" s="13" class="mq-ic"></ic>{{text}}</span></span></div>`,
    computed: { name() { return uname(this.q.senderId); }, text() { return quoteText(this.q); }, icon() { return quoteIcon(this.q); } },
  };

  const OrderCard = {
    props: ['order', 'mode'],
    template: '#tpl-order',
    data: () => ({ busy: false, showPw: false }),
    computed: {
      o() { return S.orders[this.order.id] || this.order; },
      locked() { return !!this.o.paidAt; },
      cred() {
        const lines = String(this.o.credentials || '').split('\n');
        return this.o.credentials ? { account: lines[0] || '', password: lines[1] || '', extra: lines.slice(2).join('\n').trim() } : null;
      },
      admin: isAdmin,
      mine() { return this.o.assigneeId === S.me.id; },
      assignee() { return S.users[this.o.assigneeId]; },
      state() { const o = this.o; return o.deletedAt ? 'deleted' : o.status === 'open' ? 'open' : o.paidAt ? 'paid' : 'done'; },
      stateLabel() { return { deleted: 'Đã xoá', open: 'Đang làm', paid: 'Đã thanh toán', done: 'Hoàn thành' }[this.state]; },
      overdue() { return this.o.status === 'open' && this.o.deadline && this.o.deadline < Date.now(); },
      settleText() {
        const o = this.o;
        if (o.paidAt) return `Đã thanh toán ${fmtDT(o.paidAt)}${o.settlementCode ? ' · ' + o.settlementCode : ''}`;
        if (o.settlementId) return `Đã kết toán ${o.settlementCode} · chờ admin thanh toán`;
        return 'Chưa kết toán — sẽ tính vào lương cuối tháng';
      },
    },
    methods: {
      money, fmtDT, linkify,
      view(u) { S.lightbox = { list: this.o.proof, i: this.o.proof.indexOf(u) }; },
      pick() { this.$refs.file.click(); },
      async onFiles(e) {
        const files = [...e.target.files]; e.target.value = '';
        const urls = await uploadImages(files);
        if (urls.length) { this.busy = true; try { S.orders[this.o.id] = (await tryApi('POST', `/api/orders/${this.o.id}/proof`, { images: urls })).order; toast('Đã gửi ảnh'); } finally { this.busy = false; } }
      },
      async removeProof(u) {
        if (!(await confirmBox({ title: 'Xoá ảnh này?', ok: 'Xoá ảnh', danger: true }))) return;
        S.orders[this.o.id] = (await tryApi('POST', `/api/orders/${this.o.id}/proof-remove`, { url: u })).order;
      },
      async note() {
        const v = await confirmBox({ title: `Ghi chú đơn ${this.o.code}`, input: 'area', value: this.o.note || '', placeholder: 'Ví dụ: đã xong 100%, đã đổi lại mật khẩu…', ok: 'Lưu ghi chú' });
        if (v === false || v === undefined || v === null) return;
        S.orders[this.o.id] = (await tryApi('POST', `/api/orders/${this.o.id}/note`, { note: v })).order;
        toast('Đã lưu ghi chú');
      },
      async done() {
        const ok = await confirmBox({ title: `Xác nhận hoàn thành đơn ${this.o.code}?`, text: `Tiền công ${money(this.o.price)} sẽ được tính vào doanh thu của bạn. Sau khi bấm, chỉ admin mới mở lại được.`, ok: 'Hoàn thành' });
        if (!ok) return;
        this.busy = true;
        try { S.orders[this.o.id] = (await tryApi('POST', `/api/orders/${this.o.id}/done`)).order; toast('Đã hoàn thành đơn ' + this.o.code, 'ok', 3000, 'check'); } finally { this.busy = false; }
      },
      edit() { openOrderForm({ order: this.o }); },
      async del() {
        if (!(await confirmBox({ title: `Xoá đơn ${this.o.code}?`, text: 'Đơn sẽ không được tính doanh thu. Vẫn khôi phục được ở trang Đơn hàng → Thùng rác.', ok: 'Xoá đơn', danger: true }))) return;
        S.orders[this.o.id] = (await tryApi('DELETE', `/api/orders/${this.o.id}`)).order;
      },
      async restore() { S.orders[this.o.id] = (await tryApi('POST', `/api/orders/${this.o.id}/restore`)).order; toast('Đã khôi phục đơn'); },
      async reopen() {
        if (!(await confirmBox({ title: `Mở lại đơn ${this.o.code}?`, text: 'Đơn quay về "Đang làm" và không còn tính vào doanh thu cho tới khi CTV bấm Done lại.', ok: 'Mở lại', danger: true }))) return;
        S.orders[this.o.id] = (await tryApi('POST', `/api/orders/${this.o.id}/reopen`)).order;
      },
      copy: copyText,
      history() { openOrderDetail(this.o.id); },
      openChat() { jumpToMsg(this.o.convId, this.o.msgId, this.o.id); },
    },
  };

  // ================================================================ component: biểu đồ cột (1 chuỗi số liệu)
  const RevChart = {
    props: ['series'],
    template: '#tpl-chart',
    data: () => ({ w: 600, hover: -1 }),
    mounted() {
      this.ro = new ResizeObserver(([e]) => { this.w = Math.max(280, e.contentRect.width); });
      this.ro.observe(this.$el);
    },
    beforeUnmount() { this.ro && this.ro.disconnect(); },
    computed: {
      H: () => 240,
      pad: () => ({ l: 52, r: 8, t: 12, b: 28 }),
      max() {
        const m = Math.max(0, ...this.series.map((s) => s.total));
        if (!m) return 100000;
        const p = Math.pow(10, Math.floor(Math.log10(m)));
        return [1, 2, 2.5, 5, 10].map((x) => x * p).find((x) => x >= m);
      },
      ticks() { return [0, 0.25, 0.5, 0.75, 1].map((f) => this.max * f); },
      slot() { return (this.w - this.pad.l - this.pad.r) / this.series.length; },
      bw() { return Math.max(4, Math.min(24, this.slot * 0.62)); },
      bars() {
        const ih = this.H - this.pad.t - this.pad.b;
        return this.series.map((s, i) => {
          const h = s.total > 0 ? Math.max(2, (s.total / this.max) * ih) : 0;
          const x = this.pad.l + i * this.slot + (this.slot - this.bw) / 2;
          const y = this.pad.t + ih - h;
          const r = Math.min(4, h, this.bw / 2);
          const d = h ? `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + this.bw - r}Q${x + this.bw},${y} ${x + this.bw},${y + r}V${y + h}Z` : '';
          return { ...s, i, x, y, h, d, cx: x + this.bw / 2 };
        });
      },
      labelEvery() { const n = this.series.length; return n <= 12 ? 1 : Math.ceil(n / Math.floor((this.w - 60) / 34)); },
      tip() {
        const b = this.bars[this.hover];
        if (!b) return null;
        return { b, left: Math.min(Math.max(b.cx, 70), this.w - 70) };
      },
    },
    methods: { compact, money, y(v) { return this.pad.t + (this.H - this.pad.t - this.pad.b) * (1 - v / this.max); } },
  };

  // ================================================================ trang: Đơn hàng
  const OrdersView = {
    template: '#tpl-orders',
    data: () => ({ S, status: 'open', assignee: '', q: '', list: [], loading: false }),
    computed: {
      admin: isAdmin,
      members() { return Object.values(S.users).filter((u) => u.role === 'member').sort((a, b) => a.name.localeCompare(b.name, 'vi')); },
      tabs() {
        const t = [['open', 'Đang làm'], ['unpaid', 'Xong · chưa trả'], ['paid', 'Đã thanh toán'], ['all', 'Tất cả']];
        if (this.admin) t.push(['deleted', 'Thùng rác']);
        return t;
      },
      csv() {
        const p = new URLSearchParams({ format: 'csv', status: this.status, limit: 2000 });
        if (this.assignee) p.set('assignee', this.assignee);
        if (this.q) p.set('q', this.q);
        return '/api/orders?' + p;
      },
      rows() { return this.list.map((o) => S.orders[o.id] || o); },
      total() { return this.rows.reduce((t, o) => t + (o.net ?? o.price), 0); },
    },
    watch: { status: 'load', assignee: 'load', 'S.ordersTick'() { this.loadSoon(); } },
    created() { this.load(); },
    methods: {
      money, fmtDT, uname,
      async load() {
        this.loading = true;
        try {
          const p = new URLSearchParams({ status: this.status });
          if (this.assignee) p.set('assignee', this.assignee);
          if (this.q) p.set('q', this.q);
          this.list = await api('GET', '/api/orders?' + p);
          for (const o of this.list) S.orders[o.id] = o;
        } catch (e) { toast(e.message, 'err'); } finally { this.loading = false; }
      },
      loadSoon() { clearTimeout(this.t); this.t = setTimeout(() => this.load(), 400); },
      stateOf(o) { return o.deletedAt ? 'deleted' : o.status === 'open' ? 'open' : o.paidAt ? 'paid' : 'done'; },
      stateLabel(o) { return { deleted: 'Đã xoá', open: 'Đang làm', paid: 'Đã trả', done: 'Hoàn thành' }[this.stateOf(o)]; },
      open(o) { openOrderDetail(o.id); },
      create() { openOrderForm({ assigneeId: this.assignee ? Number(this.assignee) : null }); },
    },
  };

  // ================================================================ trang: Doanh thu
  const RevenueView = {
    template: '#tpl-revenue',
    data: () => ({ S, period: 'week', anchor: '', d: null, loading: false, userId: '' }),
    computed: {
      admin: isAdmin,
      members() { return Object.values(S.users).filter((u) => u.role === 'member').sort((a, b) => a.name.localeCompare(b.name, 'vi')); },
      delta() {
        if (!this.d) return null;
        const { total, prevTotal } = this.d.totals;
        if (!prevTotal) return total ? { up: true, text: 'Kỳ trước chưa có doanh thu' } : null;
        const pct = Math.round(((total - prevTotal) / prevTotal) * 100);
        return { up: pct >= 0, text: `${pct >= 0 ? '+' : ''}${pct}% so với ${{ week: 'tuần', month: 'tháng', year: 'năm' }[this.d.period]} trước (${money(prevTotal)})` };
      },
      csv() {
        if (!this.d) return '#';
        const p = new URLSearchParams({ format: 'csv', status: 'done', doneFrom: this.d.from, doneTo: this.d.to, limit: 2000 });
        if (this.d.userId) p.set('assignee', this.d.userId);
        return '/api/orders?' + p;
      },
      chartTitle() { return this.period === 'year' ? 'Tiền công theo tháng' : 'Tiền công theo ngày'; },
      orders() { return this.d ? this.d.orders.map((o) => S.orders[o.id] || o) : []; },
      openOrders() { return this.d ? (this.d.openOrders || []).map((o) => S.orders[o.id] || o).filter((o) => o.status === 'open' && !o.deletedAt) : []; },
    },
    watch: { period() { this.anchor = ''; this.load(); }, userId() { S.revUser = this.userId || null; this.load(); }, 'S.ordersTick'() { this.loadSoon(); } },
    created() { this.userId = S.revUser ? String(S.revUser) : ''; this.load(); },
    methods: {
      money, compact, fmtDT, uname,
      overdue(o) { return o.deadline && o.deadline < Date.now(); },
      async load() {
        this.loading = true;
        try {
          const p = new URLSearchParams({ period: this.period });
          if (this.anchor) p.set('anchor', this.anchor);
          if (this.userId) p.set('userId', this.userId);
          this.d = await api('GET', '/api/revenue?' + p);
          for (const o of [...this.d.orders, ...(this.d.openOrders || [])]) S.orders[o.id] = o;
        } catch (e) { toast(e.message, 'err'); } finally { this.loading = false; }
      },
      loadSoon() { clearTimeout(this.t); this.t = setTimeout(() => this.load(), 500); },
      nav(dir) { this.anchor = dir < 0 ? this.d.prevAnchor : dir > 0 ? this.d.nextAnchor : ''; this.load(); },
      toSettle() { go('settle'); },
      openOrder(o) { openOrderDetail(o.id); },
    },
  };

  // ================================================================ trang: Lịch sử
  const HistoryView = {
    template: '#tpl-history',
    data: () => ({ logs: [], more: false, userId: '', action: '', q: '', loading: false }),
    computed: {
      admin: isAdmin,
      people() { return Object.values(S.users).sort((a, b) => a.name.localeCompare(b.name, 'vi')); },
      groups() {
        const out = [];
        for (const l of this.logs) {
          const k = dayLabel(l.at);
          if (!out.length || out[out.length - 1].k !== k) out.push({ k, items: [] });
          out[out.length - 1].items.push(l);
        }
        return out;
      },
    },
    watch: { userId() { S.histUser = this.userId || null; this.load(); }, action: 'load' },
    async created() {
      this.userId = S.histUser ? String(S.histUser) : '';
      if (isAdmin()) try { for (const u of await api('GET', '/api/users')) if (!S.users[u.id]) S.users[u.id] = u; } catch {}
      this.load();
    },
    methods: {
      fmtTime, logText, LOG_ICON, LOG_TONE,
      async load(more) {
        this.loading = true;
        try {
          const p = new URLSearchParams({ limit: 60 });
          if (this.userId) p.set('userId', this.userId);
          if (this.action) p.set('action', this.action);
          if (this.q) p.set('q', this.q);
          if (more && this.logs.length) p.set('before', this.logs[this.logs.length - 1].id);
          const d = await api('GET', '/api/logs?' + p);
          this.logs = more ? [...this.logs, ...d.logs] : d.logs;
          this.more = d.hasMore;
        } catch (e) { toast(e.message, 'err'); } finally { this.loading = false; }
      },
      open(l) { if (l.orderId) openOrderDetail(l.orderId); },
    },
  };

  // ================================================================ trang: Thành viên (admin)
  const MembersView = {
    template: '#tpl-members',
    data: () => ({ S, list: [], loading: false, q: '' }),
    computed: {
      pending() { return this.list.filter((u) => u.status === 'pending'); },
      rows() {
        const q = this.q.toLowerCase();
        return this.list.filter((u) => u.status !== 'pending' && (!q || (u.name + ' ' + u.email).toLowerCase().includes(q)));
      },
      owner() { return S.me.isOwner; },
    },
    watch: { 'S.pending'() { this.load(); }, 'S.usersTick'() { clearTimeout(this.t); this.t = setTimeout(() => this.load(), 400); } },
    created() { this.load(); },
    methods: {
      money, fmtDay, agoText,
      async load() {
        this.loading = true;
        try {
          this.list = await api('GET', '/api/users');
          for (const u of this.list) S.users[u.id] = { ...(S.users[u.id] || {}), ...u };
        } catch (e) { toast(e.message, 'err'); } finally { this.loading = false; }
      },
      async act(u, action, body) {
        const r = await tryApi('POST', `/api/users/${u.id}/${action}`, body);
        await this.load();
        return r;
      },
      async approve(u) { await this.act(u, 'approve'); toast(`Đã duyệt ${u.name}`); },
      async reject(u) { if (await confirmBox({ title: `Từ chối ${u.name}?`, text: 'Người này sẽ không đăng nhập được.', ok: 'Từ chối', danger: true })) await this.act(u, 'reject'); },
      async lock(u) { if (await confirmBox({ title: `Khoá tài khoản ${u.name}?`, text: 'Người này bị đăng xuất ngay và không vào được nữa. Dữ liệu đơn và doanh thu vẫn giữ nguyên.', ok: 'Khoá', danger: true })) await this.act(u, 'lock'); },
      async unlock(u) { await this.act(u, 'unlock'); toast('Đã mở khoá'); },
      async resetPw(u) {
        if (!(await confirmBox({ title: `Đặt lại mật khẩu cho ${u.name}?`, text: 'App tạo mật khẩu mới để bạn gửi cho thành viên.', ok: 'Tạo mật khẩu mới' }))) return;
        const r = await this.act(u, 'reset-password');
        S.modal = { kind: 'password', user: u, password: r.password };
      },
      async role(u) {
        const toAdmin = u.role !== 'admin';
        if (await confirmBox({ title: toAdmin ? `Cấp quyền admin cho ${u.name}?` : `Thu quyền admin của ${u.name}?`, text: toAdmin ? 'Admin xem được mọi đơn, doanh thu, lịch sử và duyệt thành viên.' : '', ok: 'Đồng ý', danger: toAdmin })) await this.act(u, 'role', { role: toAdmin ? 'admin' : 'member' });
      },
      async edit(u0) {
        await this.load(); // luôn lấy dữ liệu mới nhất (CTV có thể vừa đổi STK)
        const u = this.list.find((x) => x.id === u0.id) || u0;
        const b = u.bank || {};
        const form = { ...u, discountPct: String(u.discountPct || 0), bankBin: b.bin || '', bankAcc: b.account || '', bankHolder: b.holder || '', applyDiscount: true };
        S.modal = { kind: 'userEdit', user: form, orig: { ...form }, origPct: u.discountPct || 0, after: () => this.load() };
      },
      chat(u) { openDm(u.id); },
      revenue(u) { S.revUser = u.id; go('revenue'); },
      statusLabel(u) { return { active: 'Hoạt động', locked: 'Đã khoá', rejected: 'Đã từ chối', pending: 'Chờ duyệt' }[u.status]; },
    },
  };

  // ================================================================ trang: Cài đặt (admin)
  const SettingsView = {
    template: '#tpl-settings',
    data: () => ({ s: null, backups: [], saving: false, pv: null, pvErr: '' }),
    computed: {
      purgeOn() { const p = this.s && this.s.purge; return !!p && (p.img.on || p.cred.on || p.order.on); },
    },
    watch: {
      's.purge': { deep: true, handler() { clearTimeout(this.pvT); this.pvT = setTimeout(() => this.previewPurge(), 350); } },
    },
    created() { this.load(); },
    methods: {
      fmtDT, fmtSize, agoText, purgeText,
      async load() {
        try {
          this.s = await api('GET', '/api/settings');
          this.backups = (await api('GET', '/api/backups')).list;
        } catch (e) { toast(e.message, 'err'); }
      },
      async save(quiet) {
        this.saving = true;
        try {
          const { appName, gmailOnly, backupHours, backupKeep, backupKeepDaily, backupDir2, purge } = this.s;
          await tryApi('PATCH', '/api/settings', { appName, gmailOnly, backupHours, backupKeep, backupKeepDaily, backupDir2, purge });
          if (quiet !== true) toast('Đã lưu cài đặt');
          await this.load();
        } finally { this.saving = false; }
      },
      async previewPurge() {
        if (!this.s || !this.purgeOn) { this.pv = null; this.pvErr = ''; return; }
        try { this.pv = await api('POST', '/api/purge/preview', { purge: this.s.purge }); this.pvErr = ''; } catch (e) { this.pv = null; this.pvErr = e.message; }
      },
      async purgeNow() {
        await this.save(true);
        const c = await tryApi('POST', '/api/purge/preview', { purge: this.s.purge });
        if (!c.images && !c.creds && !c.orders) { toast('Chưa có dữ liệu nào đủ cũ để xoá'); return; }
        const ok = await confirmBox({ title: 'Xoá dữ liệu cũ ngay?', text: `Sẽ xoá vĩnh viễn: ${purgeText(c)}. Không hoàn tác được (chỉ có thể khôi phục lại từ bản sao lưu).`, ok: 'Xoá ngay', danger: true });
        if (!ok) return;
        S.busy = 'Đang dọn dữ liệu cũ…';
        try { const r = await tryApi('POST', '/api/purge/run'); toast('Đã xoá ' + purgeText(r)); await this.load(); } finally { S.busy = ''; }
      },
      async backupNow() {
        S.busy = 'Đang sao lưu…';
        try { const b = await tryApi('POST', '/api/backups'); toast(`Đã sao lưu: ${b.name}`); this.load(); } finally { S.busy = ''; }
      },
      dl(b) { return `/api/backups/download?kind=${encodeURIComponent(b.kind)}&name=${encodeURIComponent(b.name)}`; },
      async restore(b) {
        const ok = await confirmBox({ title: 'Khôi phục dữ liệu?', text: `Toàn bộ dữ liệu sẽ quay về lúc ${fmtDT(b.at)}. Những gì thay đổi sau thời điểm đó sẽ mất. App tự tạo một bản "Trước khôi phục" để bạn quay lại được nếu cần.`, ok: 'Khôi phục', danger: true });
        if (!ok) return;
        S.busy = 'Đang khôi phục…';
        try { await tryApi('POST', '/api/backups/restore', { kind: b.kind, name: b.name }); } catch { S.busy = ''; }
      },
      async restoreFile(e) {
        const f = e.target.files[0]; e.target.value = '';
        if (!f) return;
        if (!(await confirmBox({ title: `Khôi phục từ file ${f.name}?`, text: 'Toàn bộ dữ liệu hiện tại sẽ được thay bằng dữ liệu trong file. App tự sao lưu bản hiện tại trước.', ok: 'Khôi phục', danger: true }))) return;
        S.busy = 'Đang khôi phục…';
        try { await tryApi('POST', '/api/backups/upload', new Blob([f], { type: 'application/octet-stream' })); } catch { S.busy = ''; }
      },
    },
  };

  // ================================================================ trang: Kết toán lương
  const SettleView = {
    template: '#tpl-settle',
    data: () => ({ S, d: null, loading: false, userId: '' }),
    computed: {
      admin: isAdmin,
      members() { return Object.values(S.users).filter((u) => u.role === 'member').sort((a, b) => a.name.localeCompare(b.name, 'vi')); },
      unsettledTotal() { return this.d ? this.d.unsettled.reduce((t, r) => t + r.net, 0) : 0; },
      pendingTotal() { return this.d ? this.d.pending.reduce((t, s) => t + s.amount, 0) : 0; },
      paidTotal() { return this.d ? this.d.paid.reduce((t, s) => t + s.amount, 0) : 0; },
      myBank() { return S.me.bank; },
    },
    watch: { 'S.settleTick'() { this.loadSoon(); }, 'S.ordersTick'() { this.loadSoon(); }, userId: 'load' },
    created() { this.load(); },
    methods: {
      money, fmtDT, fmtDay, uname, qrSvg, bankLabel, copy: copyText,
      async load() {
        this.loading = true;
        try {
          this.d = await api('GET', '/api/settlements' + (this.userId ? '?userId=' + this.userId : ''));
          if (!this.userId) S.settlePending = this.d.pending.length;
        } catch (e) { toast(e.message, 'err'); } finally { this.loading = false; }
      },
      loadSoon() { clearTimeout(this.t); this.t = setTimeout(() => this.load(), 400); },
      async settleNow(rows) {
        const list = rows || this.d.unsettled;
        const total = list.reduce((t, r) => t + r.net, 0);
        const who = list.length === 1 ? uname(list[0].userId) : `${list.length} CTV`;
        if (!(await confirmBox({ title: `Kết toán ngay cho ${who}?`, text: `Gom ${list.reduce((t, r) => t + r.count, 0)} đơn đã hoàn thành chưa kết toán · thực nhận ${money(total)}. CTV sẽ được báo là đã kết toán, chờ thanh toán.`, ok: 'Kết toán ngay' }))) return;
        const r = await tryApi('POST', '/api/settlements', { userIds: list.map((x) => x.userId) });
        toast(`Đã tạo ${r.created.length} kết toán`);
        this.load();
      },
      async pay(st) {
        if (!(await confirmBox({ title: `Xác nhận đã chuyển ${money(st.amount)} cho ${uname(st.userId)}?`, text: `${st.code} · ${st.label}. Sau khi bấm, CTV nhận được thông báo đã thanh toán và các đơn trong kết toán sẽ bị khoá (không sửa được).`, ok: 'Đã thanh toán' }))) return;
        await tryApi('POST', `/api/settlements/${st.id}/pay`);
        toast(`Đã thanh toán ${st.code} · CTV đã được thông báo`);
        this.load();
      },
      async unpay(st) {
        if (!(await confirmBox({ title: `Huỷ xác nhận thanh toán ${st.code}?`, text: 'Chỉ dùng khi bấm nhầm. Kết toán quay về "chờ thanh toán".', ok: 'Huỷ thanh toán', danger: true }))) return;
        await tryApi('POST', `/api/settlements/${st.id}/unpay`);
        this.load();
      },
      async cancel(st) {
        if (!(await confirmBox({ title: `Huỷ kết toán ${st.code}?`, text: 'Các đơn trong kết toán này quay về "chưa kết toán" (vẫn được tính, lần kết toán sau sẽ gom lại).', ok: 'Huỷ kết toán', danger: true }))) return;
        await tryApi('DELETE', `/api/settlements/${st.id}`);
        this.load();
      },
      async view(st) {
        const r = await tryApi('GET', `/api/settlements/${st.id}`);
        for (const o of r.orders) S.orders[o.id] = o;
        S.modal = { kind: 'settleDetail', settlement: r.settlement, orders: r.orders };
      },
      chat(uid) { openDm(uid); },
      goAccount() { go('account'); },
    },
  };

  // ================================================================ trang: Tài khoản
  const AccountView = {
    template: '#tpl-account',
    data: () => ({ S, pushTest: null, f: { name: '', color: '', phone: '', bankBin: '', bankAcc: '', bankHolder: '' }, pw: { current: '', next: '', again: '' }, colors: ['#0a7cff', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#0891b2', '#ca8a04', '#4f46e5', '#be123c', '#0d9488'] }),
    created() { const m = S.me, b = m.bank || {}; this.f = { name: m.name, color: m.color, phone: m.phone || '', bankBin: b.bin || '', bankAcc: b.account || '', bankHolder: b.holder || '' }; },
    computed: {
      me: () => S.me, notifSupported: () => typeof Notification !== 'undefined', admin: isAdmin, origin: () => location.origin,
      bankName() { const b = S.banks.find((x) => x.bin === this.f.bankBin); return b ? b.short : ''; },
    },
    methods: {
      async save() {
        if (this.f.bankBin && !this.f.bankAcc.trim()) return toast('Nhập số tài khoản', 'warn');
        const r = await tryApi('PATCH', '/api/me', this.f);
        applyUser(r.user);
        const b = r.user.bank || {};
        this.f.bankAcc = b.account || ''; this.f.bankHolder = b.holder || '';
        toast('Đã lưu thông tin');
      },
      async pickAvatar(e) {
        const f = e.target.files[0]; e.target.value = '';
        const url = await uploadAvatar(f);
        if (!url) return;
        applyUser((await tryApi('PATCH', '/api/me', { avatar: url })).user);
        toast('Đã đổi ảnh đại diện');
      },
      async removeAvatar() {
        applyUser((await tryApi('PATCH', '/api/me', { avatar: null })).user);
        toast('Đã bỏ ảnh, dùng chữ cái đầu tên');
      },
      async changePw() {
        if (this.pw.next !== this.pw.again) return toast('Hai mật khẩu mới không giống nhau', 'err');
        await tryApi('POST', '/api/me/password', { current: this.pw.current, next: this.pw.next });
        this.pw = { current: '', next: '', again: '' };
        toast('Đã đổi mật khẩu');
      },
      setTheme(t) { S.theme = t; applyTheme(); },
      toggleSound() { S.sound = !S.sound; lsSet('ctv.sound', S.sound ? '1' : '0'); if (S.sound) beep(); },
      async toggleNotif() {
        if (S.notif) { S.notif = false; return; }
        const p = await Notification.requestPermission();
        S.notif = p === 'granted';
        if (!S.notif) toast('Trình duyệt chưa cho phép thông báo', 'warn');
      },
      enablePush, disablePush,
      async testPush() {
        this.pushTest = null;
        const r = await tryApi('POST', '/api/push/test');
        this.pushTest = r;
        if (r.ok === r.devices) toast(`Máy chủ đã gửi thành công tới ${r.devices} máy — xem thanh thông báo`, 'ok', 5000, 'bell');
        else toast(`Gửi được ${r.ok}/${r.devices} máy — xem chi tiết bên dưới`, 'warn', 6000);
      },
      pushErr(x) {
        if (x.status >= 200 && x.status < 300) return 'đã gửi';
        if (!x.status) return 'máy chủ không kết nối được dịch vụ thông báo (VPS chặn mạng ra ngoài?)' + (x.error ? ` — ${x.error}` : '');
        if (x.status === 401 || x.status === 403) return 'khoá thông báo không khớp — bấm Tắt rồi Bật lại trên máy đó';
        if (x.status === 404 || x.status === 410) return 'đăng ký đã hết hạn — bật lại thông báo trên máy đó';
        return 'lỗi ' + x.status;
      },
      async toggleGroup(e) { const r = await tryApi('PATCH', '/api/me', { notifyGroup: e.target.checked }); applyUser(r.user); toast('Đã lưu'); },
      async logout() {
        await disablePush(true);
        await api('POST', '/api/auth/logout').catch(() => {});
        location.hash = '';
        location.reload();
      },
    },
  };

  // ================================================================ ứng dụng chính
  const App = {
    template: '#tpl-root',
    data: () => ({ S, DEADLINES, auth: { email: '', name: '', password: '', password2: '' }, text: '', newMsgs: false, form: {}, pickQ: '', groupForm: { name: '', ids: [] }, summary: null, dragOver: false, more: false, reply: null, menu: null, mention: null, pushHide: lsGet('ctv.pushHide') === '1' }),
    computed: {
      admin: isAdmin,
      active() { return convById(S.activeId); },
      partner() { return this.active && this.active.type === 'dm' ? S.users[this.active.partnerId] : null; },
      canOrder() { return this.admin && this.partner && this.partner.status === 'active' && this.partner.id !== S.me.id; },
      totalUnread() { return S.convs.reduce((t, c) => t + (c.unread || 0), 0); },
      convList() {
        const q = S.convQ.trim().toLowerCase();
        return S.convs.filter((c) => !q || convTitle(c).toLowerCase().includes(q));
      },
      msgs() { return S.msgs[S.activeId] || []; },
      items() {
        const out = [];
        const list = this.msgs;
        const group = this.active && this.active.type === 'group';
        let prevDay = null;
        list.forEach((m, i) => {
          const dk = dayKey(m.createdAt);
          if (dk !== prevDay) { out.push({ kind: 'day', key: 'd' + m.id, label: dayLabel(m.createdAt) }); prevDay = dk; }
          if (m.type === 'system') { out.push({ kind: 'sys', key: m.id, m }); return; }
          const mine = m.senderId === S.me.id;
          const same = (a, b) => a && b && a.type === 'text' && b.type === 'text' && a.senderId === b.senderId && Math.abs(a.createdAt - b.createdAt) < 5 * 60e3 && dayKey(a.createdAt) === dayKey(b.createdAt);
          const prev = list[i - 1], next = list[i + 1];
          const first = m.type !== 'text' || !same(prev, m);
          const last = m.type !== 'text' || !same(m, next);
          out.push({ kind: m.type === 'order' ? 'order' : 'msg', key: m.id, m, mine, first, last, showName: group && !mine && first });
        });
        return out;
      },
      seenId() {
        const c = this.active;
        if (!c || c.type !== 'dm') return null;
        const r = c.reads[c.partnerId] || 0;
        const mine = this.msgs.filter((m) => m.senderId === S.me.id && m.id <= r);
        return mine.length ? mine[mine.length - 1].id : null;
      },
      subtitle() {
        const c = this.active;
        if (!c) return '';
        if (c.type === 'group') return `${c.members.length} thành viên`;
        const u = this.partner;
        if (!u) return '';
        if (u.status === 'locked') return 'Tài khoản đã bị khoá';
        return u.online ? 'Đang hoạt động' : u.lastSeen ? 'Hoạt động ' + agoText(u.lastSeen) : (u.role === 'admin' ? 'Admin' : 'CTV');
      },
      summaryUserId() {
        const u = this.partner;
        if (!u) return null;
        if (this.admin) return u.role === 'member' ? u.id : null;
        return u.role === 'admin' ? S.me.id : null;
      },
      pickList() {
        const q = this.pickQ.toLowerCase();
        return Object.values(S.users).filter((u) => u.id !== S.me.id && u.status === 'active' && (this.admin || u.role === 'admin') && (!q || u.name.toLowerCase().includes(q)))
          .sort((a, b) => (b.role === 'admin') - (a.role === 'admin') || a.name.localeCompare(b.name, 'vi'));
      },
      modalOrder() { return S.modal && S.modal.orderId ? S.orders[S.modal.orderId] : null; },
      lbUrl() { return S.lightbox ? S.lightbox.list[S.lightbox.i] : null; },
      navItems() {
        const n = [
          { v: 'chat', ic: 'chat', t: 'Đoạn chat', badge: this.totalUnread },
          { v: 'orders', ic: 'orders', t: 'Đơn hàng' },
          { v: 'revenue', ic: 'chart', t: 'Doanh thu' },
          { v: 'settle', ic: 'money', t: 'Kết toán', badge: S.settlePending, dot: true },
          { v: 'history', ic: 'history', t: 'Lịch sử' },
        ];
        if (this.admin) n.push({ v: 'members', ic: 'users', t: 'Thành viên', badge: S.pending, dot: true }, { v: 'settings', ic: 'settings', t: 'Cài đặt' });
        return n;
      },
      members() { return Object.values(S.users).filter((u) => u.role === 'member' && u.status === 'active').sort((a, b) => a.name.localeCompare(b.name, 'vi')); },
      // điện thoại: 4 mục đầu nằm trên thanh dưới, phần còn lại trong nút "Thêm"
      navMore() { return this.navItems.slice(4); },
      moreBadge() { return this.navMore.reduce((t, n) => t + (n.badge || 0), 0); },
      moreOn() { return S.view === 'account' || this.navMore.some((n) => n.v === S.view); },
    },
    watch: {
      'S.view'() { this.more = false; },
      totalUnread: { handler(n) { document.title = (n ? `(${n}) ` : '') + (S.settings.appName || 'CTV Chat'); }, immediate: true },
      'S.settings.appName'() { document.title = (this.totalUnread ? `(${this.totalUnread}) ` : '') + S.settings.appName; },
      'S.modal'(m) { if (m && m.kind === 'order') this.initOrderForm(); },
      'form.assigneeId'(v) {
        if (S.modal && S.modal.kind === 'order' && !S.modal.order && v) this.form.discountPct = String((S.users[v] || {}).discountPct || 0);
      },
      'S.activeId'() { this.text = ''; this.reply = null; this.menu = null; this.mention = null; this.newMsgs = false; this.scrollBottom(true); this.loadSummary(); },
      'S.summaryTick'() { clearTimeout(this.sumT); this.sumT = setTimeout(() => this.loadSummary(), 400); },
      'msgs.length'(n, o) {
        if (!o) return this.scrollBottom(true);
        const el = this.$refs.scroller;
        const last = this.msgs[this.msgs.length - 1];
        if (!el || !last) return;
        if (this.loadingOlder) return;
        const near = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
        if (near || last.senderId === S.me.id) this.scrollBottom(); else this.newMsgs = true;
      },
    },
    async created() {
      applyTheme();
      try {
        const d = await api('GET', '/api/me');
        S.settings = d.settings;
        S.needSetup = d.needSetup;
        if (!d.user) { S.phase = 'auth'; S.authTab = d.needSetup ? 'register' : 'login'; return; }
        S.me = d.user;
        if (d.user.status === 'pending') { S.phase = 'pending'; this.pollPending(); return; }
        await bootstrap();
      } catch (e) {
        S.phase = 'error';
        S.authErr = e.message;
      }
    },
    mounted() {
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { if (S.lightbox) S.lightbox = null; else if (S.modal) closeModal(false); else if (S.search) S.search = null; else if (this.menu) this.menu = null; else if (this.reply) this.reply = null; else this.more = false; }
        // Ctrl+K (hoặc phím /) mở tìm kiếm
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
        if (S.phase === 'app' && !S.modal && ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing))) { e.preventDefault(); openSearch(); }
        if (S.lightbox && e.key === 'ArrowRight') this.lb(1);
        if (S.lightbox && e.key === 'ArrowLeft') this.lb(-1);
      });
      window.addEventListener('focus', markRead);
    },
    methods: {
      goMore(v) { this.more = false; go(v); },
      openSearch(o) { this.more = false; openSearch(o); },
      quoteOfMsg, quoteText, quoteIcon, previewIcon, previewWho, previewBody, copy: copyText, richText, mentionsMe, enablePush,
      hidePush() { this.pushHide = true; lsSet('ctv.pushHide', '1'); },
      // ---------- @nhắc tên: gõ @ trong nhóm → chọn người
      checkMention(t) {
        const c = this.active;
        if (!c || c.type !== 'group' || !t) { this.mention = null; return; }
        const pos = t.selectionStart;
        const m = /(^|\s)@([^\s@][^@\n]{0,24}|)$/.exec(this.text.slice(0, pos));
        if (!m) { this.mention = null; return; }
        const q = fold(m[2]);
        const items = [];
        if (this.admin && (!q || 'all'.startsWith(q) || 'tat ca'.startsWith(q))) items.push({ id: 'all', name: 'all', label: 'Báo cho tất cả mọi người trong nhóm' });
        for (const id of c.members) {
          const u = S.users[id];
          if (id === S.me.id || !u || u.status !== 'active') continue;
          const f = fold(u.name);
          if (!q || f.includes(q) || f.split(' ').some((w) => w.startsWith(q))) items.push({ id, name: u.name });
        }
        this.mention = items.length ? { start: pos - m[2].length - 1, end: pos, items: items.slice(0, 8), i: 0 } : null;
      },
      pickMention(it) {
        const mm = this.mention;
        if (!mm) return;
        const ins = '@' + it.name + ' ';
        this.text = this.text.slice(0, mm.start) + ins + this.text.slice(mm.end);
        this.mention = null;
        nextTick(() => { const t = this.$refs.input; if (t) { const p = mm.start + ins.length; t.focus(); t.setSelectionRange(p, p); this.autoGrow({ target: t }); } });
      },
      mentionsOf(text) {
        const c = this.active;
        if (!c || c.type !== 'group') return {};
        const cands = c.members.filter((id) => id !== S.me.id && S.users[id] && S.users[id].status === 'active').map((id) => ({ id, keys: mentionKeys(S.users[id].name) }));
        if (this.admin) cands.push({ id: 'all', keys: ALL_KEYS });
        const ids = new Set(), spans = findMentions(text, cands);
        let all = false;
        for (const sp of spans) for (const id of sp.ids) { if (id === 'all') all = true; else ids.add(id); }
        return { mentions: [...ids], mentionAll: all };
      },
      openBanner() { const b = S.banner; S.banner = null; if (!b) return; S.search = null; S.modal = null; openConv(b.convId); },
      money, compact, fmtTime, fmtDT, fmtDay, shortTime, linkify, convTitle, msgPreview, uname, agoText, go, openConv, openDm, openOrderForm, openOrderDetail, jumpToMsg, logText, LOG_ICON, LOG_TONE, closeModal, toLocalInput,
      // ---------- đăng nhập
      async submitAuth() {
        S.authErr = '';
        const a = this.auth;
        if (S.authTab === 'register' && a.password !== a.password2) { S.authErr = 'Hai mật khẩu không giống nhau'; return; }
        S.authBusy = true;
        try {
          const r = S.authTab === 'register'
            ? await api('POST', '/api/auth/register', { email: a.email, name: a.name, password: a.password })
            : await api('POST', '/api/auth/login', { email: a.email, password: a.password });
          S.me = r.user;
          if (r.user.status === 'pending') { S.phase = 'pending'; this.pollPending(); }
          else await bootstrap();
        } catch (e) { S.authErr = e.message; } finally { S.authBusy = false; }
      },
      pollPending() {
        clearInterval(this.pendT);
        this.pendT = setInterval(async () => {
          try {
            const d = await api('GET', '/api/me');
            if (!d.user) { clearInterval(this.pendT); S.phase = 'auth'; S.authErr = 'Yêu cầu tham gia đã bị từ chối hoặc phiên đăng nhập hết hạn.'; return; }
            if (d.user.status === 'active') { clearInterval(this.pendT); S.me = d.user; await bootstrap(); toast('Admin đã duyệt, chào mừng bạn!', 'ok', 4000, 'check'); }
          } catch {}
        }, 8000);
      },
      async logout() { await disablePush(true); await api('POST', '/api/auth/logout').catch(() => {}); location.hash = ''; location.reload(); },
      reload() { location.reload(); },
      // ---------- khung chat
      scrollBottom(instant) {
        nextTick(() => {
          const el = this.$refs.scroller;
          if (el) el.scrollTo({ top: el.scrollHeight, behavior: instant ? 'auto' : 'smooth' });
          this.newMsgs = false;
        });
      },
      async onScroll(e) {
        const el = e.target;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) { this.newMsgs = false; markRead(); }
        if (el.scrollTop < 60 && S.more[S.activeId] && !S.loadingMsgs) {
          const h = el.scrollHeight;
          this.loadingOlder = true;
          try { await loadMessages(S.activeId, true); } finally {
            await nextTick();
            el.scrollTop = el.scrollHeight - h + el.scrollTop;
            this.loadingOlder = false;
          }
        }
      },
      autoGrow(e) { const t = e.target; t.style.height = 'auto'; t.style.height = Math.min(140, t.scrollHeight) + 'px'; },
      onKey(e) {
        const mm = this.mention;
        if (mm && !e.isComposing) {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); mm.i = (mm.i + (e.key === 'ArrowDown' ? 1 : mm.items.length - 1)) % mm.items.length; return; }
          if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); this.pickMention(mm.items[mm.i]); return; }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.mention = null; return; }
        }
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.sendText(); }
      },
      onInput(e) { this.autoGrow(e); this.checkMention(e.target); },
      blurMention() { setTimeout(() => { if (document.activeElement !== this.$refs.input) this.mention = null; }, 200); },
      async sendText(images) {
        const text = this.text.trim();
        if (!text && !(images && images.length)) return;
        const convId = S.activeId;
        this.text = '';
        nextTick(() => { const t = this.$refs.input; if (t) { t.style.height = 'auto'; t.focus(); } });
        const reply = this.reply;
        this.reply = null;
        this.mention = null;
        try {
          const men = this.mentionsOf(text);
          const m = await api('POST', `/api/convs/${convId}/messages`, { text, images: images || [], replyTo: reply ? reply.id : null, ...men });
          // có gõ @… mà không khớp ai trong nhóm → nhắc cách tag
          if (men.mentions && !men.mentions.length && !men.mentionAll && /(^|\s)@[^\s@]/.test(text)) toast('Chưa tag được ai: gõ @ rồi chọn tên trong danh sách', 'warn', 5000);
          const list = S.msgs[convId];
          if (list && !list.some((x) => x.id === m.id)) list.push(m);
        } catch (e) { this.text = text; this.reply = reply; toast(e.message, 'err'); }
      },
      // ---------- trả lời tin nhắn: vuốt ngang (điện thoại), giữ lâu để mở menu, hoặc nút "Trả lời" khi rê chuột
      setReply(m) {
        if (!m || m.deleted || m.type === 'system') return;
        this.reply = quoteOfMsg(m);
        this.menu = null;
        if (!matchMedia('(hover: none)').matches) nextTick(() => this.$refs.input && this.$refs.input.focus());
      },
      jumpQuote(q) { if (q) jumpToMsg(S.activeId, q.id, null); },
      menuText(m) { return m.type === 'order' ? (S.orders[m.orderId] || {}).content || '' : m.text || ''; },
      swStart(e, m) {
        if (e.touches.length !== 1 || m.deleted) return;
        const t = e.touches[0];
        this.sw = { m, x: t.clientX, y: t.clientY, el: e.currentTarget, mode: null, hit: false };
        clearTimeout(this.lpT);
        this.lpT = setTimeout(() => {
          const s = this.sw;
          if (!s || s.mode) return;
          s.mode = 'press';
          if (navigator.vibrate) navigator.vibrate(12);
          this.menu = s.m;
        }, 480);
      },
      swMove(e) {
        const s = this.sw;
        if (!s || s.mode === 'press') return;
        const t = e.touches[0], dx = t.clientX - s.x, dy = t.clientY - s.y;
        if (!s.mode) {
          if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
          clearTimeout(this.lpT);
          // vuốt ngang rõ ràng (không phải cuộn dọc, không bắt đầu sát mép màn hình — tránh cử chỉ "quay lại" của máy)
          if (Math.abs(dx) > Math.abs(dy) * 1.4 && s.x > 24 && s.x < innerWidth - 24) s.mode = 'swipe';
          else { this.sw = null; return; }
        }
        const d = Math.max(-84, Math.min(84, dx));
        const hit = Math.abs(d) >= 56;
        s.el.style.transition = 'none';
        s.el.style.transform = `translateX(${d}px)`;
        s.el.style.setProperty('--sw', Math.min(1, Math.abs(d) / 56).toFixed(2));
        s.el.dataset.swdir = d > 0 ? 'r' : 'l';
        if (hit !== s.hit) { s.hit = hit; s.el.classList.toggle('sw-hit', hit); if (hit && navigator.vibrate) navigator.vibrate(10); }
      },
      swEnd(e) {
        clearTimeout(this.lpT);
        const s = this.sw;
        this.sw = null;
        if (!s) return;
        if (s.mode === 'press') { if (e.cancelable) e.preventDefault(); return; } // không để chạm lúc nhả tay bấm nhầm vào ảnh / link
        if (s.mode !== 'swipe') return;
        const el = s.el;
        el.style.transition = 'transform .2s ease-out';
        el.style.transform = '';
        el.classList.remove('sw-hit');
        el.style.removeProperty('--sw');
        if (s.hit) this.setReply(s.m);
      },
      pickImages() { this.$refs.img.click(); },
      async onImages(files) { const urls = await uploadImages(files); if (urls.length) await this.sendText(urls); },
      onPaste(e) {
        const files = [...(e.clipboardData ? e.clipboardData.files : [])].filter((f) => f.type.startsWith('image/'));
        if (files.length) { e.preventDefault(); this.onImages(files); }
      },
      onDrop(e) { this.dragOver = false; const files = [...e.dataTransfer.files]; if (files.length) this.onImages(files); },
      async delMsg(m) {
        if (!(await confirmBox({ title: 'Thu hồi tin nhắn?', text: 'Mọi người sẽ thấy "Tin nhắn đã thu hồi".', ok: 'Thu hồi', danger: true }))) return;
        await tryApi('DELETE', `/api/messages/${m.id}`);
      },
      canDel(m) { return !m.deleted && m.type === 'text' && (m.senderId === S.me.id || this.admin); },
      viewImg(list, i) { S.lightbox = { list, i }; },
      lb(d) { const L = S.lightbox; if (L) L.i = (L.i + d + L.list.length) % L.list.length; },
      async loadSummary() {
        this.summary = null;
        const id = this.summaryUserId;
        if (!id) return;
        try { const s = await api('GET', `/api/users/${id}/summary`); if (id === this.summaryUserId) this.summary = s; } catch {}
      },
      jumpOrder(o) { jumpToMsg(o.convId, o.msgId, o.id); },
      revenueOf(id) { S.revUser = id; go('revenue'); },
      historyOf(id) { S.histUser = id; go('history'); },
      backToList() { S.mobileChat = false; },
      // ---------- tạo đơn / sửa đơn
      initOrderForm() {
        const m = S.modal;
        const o = m.order;
        this.form = {
          assigneeId: m.assigneeId || (this.partner && this.partner.role === 'member' ? this.partner.id : ''),
          content: o ? o.content : '', price: o ? String(o.price) : '', credentials: o ? o.credentials || '' : '',
          discountPct: o ? String(o.discountPct || 0) : String(((S.users[m.assigneeId || (this.partner && this.partner.id)] || {}).discountPct) || 0),
          deadline: o && o.deadline ? toLocalInput(o.deadline) : '', chip: null, err: '', busy: false,
        };
      },
      quickDeadline(c) {
        this.form.deadline = toLocalInput(Date.now() + c.h * 3600e3);
        this.form.chip = c.k;
      },
      deadlineHint(v) {
        if (!v) return 'Không đặt hạn chót';
        const t = new Date(v).getTime();
        if (!Number.isFinite(t)) return '';
        const mins = Math.round((t - Date.now()) / 60e3);
        const left = mins < 0 ? 'đã qua' : mins < 60 ? `còn ${mins} phút` : mins < 1440 ? `còn ${Math.round(mins / 60)} giờ` : `còn ${Math.round(mins / 1440)} ngày`;
        return `Hạn: ${fmtTime(t)} · ${dayLabel(t)} (${left})`;
      },
      async submitOrder() {
        const f = this.form, m = S.modal;
        f.err = '';
        const price = parseMoney(f.price), pct = Number(String(f.discountPct || 0).replace(',', '.'));
        if (!m.order && !f.assigneeId) return (f.err = 'Chọn CTV nhận đơn');
        if (!f.content.trim()) return (f.err = 'Nhập nội dung đơn');
        if (price === null || Number.isNaN(price)) return (f.err = 'Nhập tiền công hợp lệ, ví dụ 150000 hoặc 150k');
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) return (f.err = 'Chiết khấu phải từ 0 đến 100%');
        const body = { content: f.content, credentials: f.credentials, price, discountPct: pct, deadline: f.deadline ? new Date(f.deadline).getTime() : null };
        f.busy = true;
        try {
          if (m.order) {
            const r = await api('PATCH', `/api/orders/${m.order.id}`, body);
            S.orders[r.order.id] = r.order;
            toast('Đã sửa đơn ' + r.order.code);
          } else {
            const r = await api('POST', '/api/orders', { ...body, assigneeId: Number(f.assigneeId) });
            S.orders[r.order.id] = r.order;
            toast(`Đã gửi đơn ${r.order.code} cho ${uname(r.order.assigneeId)}`);
            if (S.view === 'chat') { if (!convById(r.convId)) refreshConvsSoon(); if (S.activeId !== r.convId) setTimeout(() => openConv(r.convId), 300); }
          }
          closeModal(true);
        } catch (e) { f.err = e.message; } finally { f.busy = false; }
      },
      moneyHint(v) { const n = parseMoney(v); return n === null ? '' : Number.isNaN(n) ? 'Số tiền chưa đúng' : '= ' + money(n); },
      netPreview() {
        const price = parseMoney(this.form.price), pct = Number(String(this.form.discountPct || 0).replace(',', '.'));
        if (price === null || Number.isNaN(price) || !Number.isFinite(pct) || pct < 0 || pct > 100) return null;
        const net = Math.round((price * (100 - pct)) / 100);
        return { price, pct, net, cut: price - net };
      },
      // ---------- nhóm & tin nhắn mới
      openNewChat() { this.pickQ = ''; S.modal = { kind: 'newchat' }; },
      openGroup(conv) {
        this.groupForm = conv ? { id: conv.id, name: conv.name, ids: conv.members.filter((i) => i !== S.me.id), isMain: conv.isMain } : { name: '', ids: [] };
        this.pickQ = '';
        S.modal = { kind: 'group' };
      },
      async saveGroup() {
        const g = this.groupForm;
        if (!g.name.trim()) return toast('Nhập tên nhóm', 'warn');
        if (g.id) {
          const c = convById(g.id);
          const before = c.members.filter((i) => i !== S.me.id);
          await tryApi('PATCH', `/api/convs/${g.id}`, { name: g.name, addIds: g.ids.filter((i) => !before.includes(i)), removeIds: before.filter((i) => !g.ids.includes(i)) });
          refreshConvsSoon();
          closeModal(true);
        } else {
          const c = await tryApi('POST', '/api/convs/group', { name: g.name, memberIds: g.ids });
          if (!convById(c.id)) S.convs.unshift(c);
          closeModal(true);
          openConv(c.id);
        }
      },
      toggleId(id) { const ids = this.groupForm.ids; const i = ids.indexOf(id); if (i >= 0) ids.splice(i, 1); else ids.push(id); },
      async pickChat(u) { closeModal(true); await openDm(u.id); },
      // ---------- hộp thoại khác
      confirmOk() { const m = S.modal; closeModal(m.input ? (m.value ?? '') : true); },
      async pickUserAvatar(e) {
        const f = e.target.files[0]; e.target.value = '';
        const url = await uploadAvatar(f);
        if (url && S.modal && S.modal.user) S.modal.user.avatar = url;
      },
      async saveUserEdit() {
        const u = S.modal.user, after = S.modal.after;
        const pctChanged = Number(u.discountPct) !== Number(S.modal.origPct);
        const o = S.modal.orig || {};
        const body = {};
        // chỉ gửi những ô admin thực sự sửa → không ghi đè thông tin CTV vừa tự cập nhật
        for (const k of ['name', 'phone', 'note', 'avatar', 'bankBin', 'bankAcc', 'bankHolder']) if ((u[k] ?? '') !== (o[k] ?? '')) body[k] = u[k] ?? '';
        if (pctChanged) { body.discountPct = u.discountPct; body.applyDiscount = !!u.applyDiscount; }
        if (body.avatar === '') body.avatar = null;
        if (!Object.keys(body).length) { closeModal(true); return; }
        const r = await tryApi('PATCH', `/api/users/${u.id}`, body);
        applyUser(r.user);
        closeModal(true);
        toast(r.applied ? `Đã lưu · áp chiết khấu mới cho ${r.applied} đơn chưa thanh toán` : 'Đã lưu');
        if (after) after();
      },
      copy: copyText,
      bankShort(bin) { const b = S.banks.find((x) => x.bin === bin); return b ? b.short : ''; },
    },
  };

  const app = createApp(App);
  app.component('ic', Ic);
  app.component('avatar', Avatar);
  app.component('order-card', OrderCard);
  app.component('msg-quote', MsgQuote);
  app.component('hl', Hl);
  app.component('search-panel', SearchPanel);
  app.component('rev-chart', RevChart);
  app.component('orders-view', OrdersView);
  app.component('revenue-view', RevenueView);
  app.component('history-view', HistoryView);
  app.component('members-view', MembersView);
  app.component('settings-view', SettingsView);
  app.component('account-view', AccountView);
  app.component('settle-view', SettleView);
  app.mount('#app');
})();
