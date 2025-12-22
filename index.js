require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, Partials } = require('discord.js');
const mongoose = require('mongoose');
const cron = require('node-cron');
const express = require('express');

// ====== KIỂM TRA BIẾN MÔI TRƯỜNG ======
const REQUIRED_ENVS = ['MONGODB_URI', 'DISCORD_TOKEN', 'LOG_CHANNEL_ID', 'ADMIN_CHANNEL_ID', 'DAILY_CHANNEL_ID', 'COMMAND_CHANNEL_ID'];
for (const k of REQUIRED_ENVS) {
  if (!process.env[k]) { console.error(`❌ Thiếu biến môi trường: ${k}`); process.exit(1); }
}

const tz = 'Asia/Ho_Chi_Minh';
const PORT = process.env.PORT || 10000;

// ====== MONGODB SCHEMAS ======
const sessionSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  start: { type: Date, required: true },
  end: { type: Date, default: null },
  duration: { type: Number, default: 0 }
});
sessionSchema.index({ start: 1 }, { expireAfterSeconds: 35 * 24 * 60 * 60 });
const Session = mongoose.model('Session', sessionSchema);

const weeklySchema = new mongoose.Schema({
  userId: String, weekTag: { type: String, index: true }, totalTime: Number, createdAt: { type: Date, default: Date.now }
});
weeklySchema.index({ createdAt: 1 }, { expireAfterSeconds: 26 * 7 * 24 * 60 * 60 });
const WeeklyStats = mongoose.model('WeeklyStats', weeklySchema);

const monthlySchema = new mongoose.Schema({
  userId: String, monthTag: { type: String, index: true }, totalTime: Number, createdAt: { type: Date, default: Date.now }
});
monthlySchema.index({ createdAt: 1 }, { expireAfterSeconds: 18 * 30 * 24 * 60 * 60 });
const MonthlyStats = mongoose.model('MonthlyStats', monthlySchema);

mongoose.connect(process.env.MONGODB_URI).then(() => console.log('✅ MongoDB Connected'));

// ====== UTILITIES ======
const nowMs = () => Date.now();
const discordTS = ms => `<t:${Math.floor(ms / 1000)}:f>`;
const calcSec = (a, b) => Math.max(0, Math.floor((new Date(b) - new Date(a)) / 1000));
const formatDuration = sec => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}h ${m}m ${s}s`;
};
const getWeekTag = (d) => {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  return `${date.getFullYear()}-W${1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7)}`;
};
const getMonthTag = (d) => `${d.getFullYear()}-${d.getMonth() + 1}`;

// ====== KHỞI TẠO CLIENT (BẬT FULL QUYỀN) ======
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel, Partials.Message]
});

const activeStreams = new Map();
const recentToggles = new Map();

// ====== XỬ LÝ VOICE STATE ======
client.on('voiceStateUpdate', async (oldState, newState) => {
  try {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;
    const user = member.user;
    const wasStreaming = !!oldState.streaming;
    const isStreaming = !!newState.streaming;
    const now = nowMs();

    if (!wasStreaming && isStreaming) {
      activeStreams.set(user.id, { startMs: now });
      const arr = (recentToggles.get(user.id) || []).filter(t => now - t <= 300000);
      arr.push(now); recentToggles.set(user.id, arr);
      if (arr.length >= 3) {
        const adm = await client.channels.fetch(process.env.ADMIN_CHANNEL_ID).catch(() => null);
        if (adm) adm.send({ embeds: [new EmbedBuilder().setTitle('⚠️ CẢNH BÁO SPAM').setDescription(`- **Người Dùng : **<@${user.id}> bật/tắt stream **${arr.length} lần/5p**`).setColor('Orange')] });
      }
      const logCh = await client.channels.fetch(process.env.LOG_CHANNEL_ID).catch(() => null);
      if (logCh) logCh.send({ embeds: [new EmbedBuilder().setTitle('🟢 **BẮT ĐẦU STREAM**').setDescription(`- **Người Dùng :** <@${user.id}>\n- **Kênh :** ${newState.channel?.name}\n**- Thời Gian Bắt đầu :** ${discordTS(now)}`).setColor('Green')] });
    }

    if (wasStreaming && (!isStreaming || !newState.channelId)) {
      const active = activeStreams.get(user.id);
      if (!active) return;
      const durSec = calcSec(active.startMs, now);
      await Session.create({ userId: user.id, start: new Date(active.startMs), end: new Date(now), duration: durSec });
      activeStreams.delete(user.id);

      const startDay = new Date(); startDay.setHours(0, 0, 0, 0);
      const todayData = await Session.find({ userId: user.id, start: { $gte: startDay } }).lean();
      const totalToday = todayData.reduce((acc, s) => acc + (s.duration || 0), 0);

      const logCh = await client.channels.fetch(process.env.LOG_CHANNEL_ID).catch(() => null);
      if (logCh) logCh.send({ embeds: [new EmbedBuilder().setTitle('🔴 **KẾT THÚC STREAM**').setDescription(`- **Người Dùng :** <@${user.id}>\n- **Phiên này :** \`${formatDuration(durSec)}\`\n- **Tổng hôm nay:** \`${formatDuration(totalToday)}\``).setColor('Red')] });

      if (durSec < 300) {
        const adm = await client.channels.fetch(process.env.ADMIN_CHANNEL_ID).catch(() => null);
        if (adm) adm.send({ embeds: [new EmbedBuilder().setTitle('⚠️ **STREAM NGẮN**').setDescription(`- **Người Dùng :** <@${user.id}> stream chỉ \`${formatDuration(durSec)}\``).setColor('Orange')] });
      }
    }
  } catch (err) { console.error('❌ Voice Error:', err); }
});

// ====== HÀM GỬI BẢNG XẾP HẠNG VĂN BẢN ======
async function sendLeaderboard(channel, totals, title, timeLabel) {
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 15);
  if (!sorted.length) return channel.send("❌ Không có dữ liệu.");
  let res = `━━━━━━━━━━━━━━━━━━━━━━━━━━\n🏆 **${title}**\n📅 *${timeLabel}*\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  sorted.forEach(([uid, sec], i) => {
    const rank = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
    res += `${rank} <@${uid}> ➔ \`${formatDuration(sec)}\`\n`;
  });
  res += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n🌟 **VINH DANH TOP 1**: <@${sorted[0][0]}> 🎉\n━━━━━━━━━━━━━━━━━━━━━━━━━━`;
  channel.send(res);
}

// ====== CRON JOBS ======
cron.schedule('5 0 * * *', async () => {
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); yesterday.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (const [uid, data] of activeStreams.entries()) {
    const dur = calcSec(data.startMs, today.getTime());
    await Session.create({ userId: uid, start: new Date(data.startMs), end: today, duration: dur });
    activeStreams.set(uid, { startMs: today.getTime() });
  }
  const sessions = await Session.find({ start: { $gte: yesterday, $lt: today } }).lean();
  const dayTotals = {}; sessions.forEach(s => dayTotals[s.userId] = (dayTotals[s.userId] || 0) + s.duration);
  const wTag = getWeekTag(yesterday); const mTag = getMonthTag(yesterday);
  for (const [uid, sec] of Object.entries(dayTotals)) {
    await WeeklyStats.findOneAndUpdate({ userId: uid, weekTag: wTag }, { $inc: { totalTime: sec } }, { upsert: true });
    await MonthlyStats.findOneAndUpdate({ userId: uid, monthTag: mTag }, { $inc: { totalTime: sec } }, { upsert: true });
  }
  const ch = await client.channels.fetch(process.env.DAILY_CHANNEL_ID).catch(() => null);
  if (ch) sendLeaderboard(ch, dayTotals, "BXH HÀNG NGÀY", yesterday.toLocaleDateString('vi-VN'));
}, { timezone: tz });

// ====== HỆ THỐNG LỆNH ======
client.on('messageCreate', async msg => {
  if (msg.author.bot) return;
  if (msg.channel.id !== process.env.COMMAND_CHANNEL_ID) return;

  const content = msg.content.trim().toLowerCase();
  const args = msg.content.trim().split(/\s+/);
  const cmd = args[0].toLowerCase();

  // !TIME, !TIME3, !TIME7, !TIME15, !TIME30
  if (cmd.startsWith('!time')) {
    const days = cmd === '!time' ? 1 : parseInt(cmd.replace('!time', '')) || 1;
    const target = msg.mentions.users.first() || msg.author;
    let found = false;

    for (let i = 0; i < days; i++) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      const next = new Date(d); next.setDate(next.getDate() + 1);
      const ss = await Session.find({ userId: target.id, start: { $gte: d, $lt: next } }).lean();

      if (!ss.length) continue;
      found = true;
      const total = ss.reduce((a, s) => a + (s.duration || calcSec(s.start, s.end || new Date())), 0);
      const e = new EmbedBuilder().setTitle(`📅 **Ngày :** ${d.toLocaleDateString('vi-VN')}`).setColor('Blue').setDescription(`- **Người dùng :** <@${target.id}>\n- **Tổng :** **${formatDuration(total)}**`)
        .addFields(ss.map((s, idx) => ({
          name: `Phiên #${idx + 1}`,
          value: `🟩 ${discordTS(s.start)} - 🔴 ${s.end ? discordTS(s.end) : 'Đang chạy'}\n⏱️ ${formatDuration(s.duration || calcSec(s.start, new Date()))}`
        })));
      await msg.channel.send({ embeds: [e] });
    }
    if (!found) msg.reply("❌ Không tìm thấy dữ liệu trong số ngày yêu cầu.");
  }

  // !TOP, !TOP7, !TOP30
  if (cmd === '!top' || cmd === '!top7' || cmd === '!top30') {
    const days = cmd === '!top' ? 1 : parseInt(cmd.replace('!top', '')) || 1;
    const since = new Date(); since.setHours(0, 0, 0, 0); since.setDate(since.getDate() - (days - 1));
    const ss = await Session.find({ start: { $gte: since } }).lean();
    const totals = {};
    ss.forEach(s => {
      const d = s.duration || calcSec(s.start, s.end || new Date());
      totals[s.userId] = (totals[s.userId] || 0) + d;
    });
    return sendLeaderboard(msg.channel, totals, `BXH ${days} NGÀY QUA`, "Tính đến hiện tại");
  }

  // !TOPWEEK, !TOPMONTH
  if (cmd === '!topweek' || cmd === '!topmonth') {
    const tag = (cmd === '!topweek') ? getWeekTag(new Date()) : getMonthTag(new Date());
    const data = (cmd === '!topweek') ? await WeeklyStats.find({ weekTag: tag }) : await MonthlyStats.find({ monthTag: tag });
    const totals = Object.fromEntries(data.map(i => [i.userId, i.totalTime]));
    return sendLeaderboard(msg.channel, totals, `BXH ${cmd.replace('!top', '').toUpperCase()} HIỆN TẠI`, tag);
  }

  // !CHECKTOP [week/month] [tag]
  if (cmd === '!checktop') {
    const type = args[1]?.toLowerCase(); const tag = args[2];
    if (!type || !tag) return msg.reply("Cú pháp: `!checktop week 2025-W51` hoặc `!checktop month 2025-12`.");
    const data = (type === 'week') ? await WeeklyStats.find({ weekTag: tag }) : await MonthlyStats.find({ monthTag: tag });
    const totals = Object.fromEntries(data.map(i => [i.userId, i.totalTime]));
    return sendLeaderboard(msg.channel, totals, `LỊCH SỬ ${type.toUpperCase()}`, tag);
  }
});
// ====== KHỞI CHẠY WEB SERVER & BOT ======
const app = express();

// Trang chủ để Cron-job.org kiểm tra
app.get('/', (req, res) => {
  res.send('Bot is Online and Staying Alive!');
});

// Lắng nghe cổng từ Render
app.listen(PORT, () => {
  console.log(`🌐 Web server đang chạy tại cổng: ${PORT}`);
});

// Sự kiện khi Bot sẵn sàng
client.once('ready', () => {
  console.log(`🚀 Bot đã sẵn sàng: ${client.user.tag}`);
});

// Đăng nhập Bot
client.login(process.env.DISCORD_TOKEN);