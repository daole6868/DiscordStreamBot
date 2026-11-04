# Tích hợp (Discord, Google Sheets…) — dành cho giai đoạn sau

Mỗi file `.js` đặt trong thư mục này sẽ được nạp tự động khi khởi động `server.js`.
File nhận vào `hooks` (bộ phát sự kiện) và có thể lắng nghe:

| Sự kiện | Khi nào | Dữ liệu |
|---|---|---|
| `order.created` | Admin vừa lên đơn | `{ order, user }` (user = CTV nhận đơn) |
| `order.updated` | Admin sửa đơn | `{ order, changes }` |
| `order.done` | CTV bấm **Done** | `{ order, user }` |
| `order.reopened` | Admin mở lại đơn | `{ order }` |
| `settlement.paid` | Admin bấm **Đã thanh toán** một phiếu kết toán lương | `{ settlement, user }` (settlement có mã KT…, số tiền, số đơn) |
| `order.deleted` | Admin xoá đơn | `{ order }` |
| `user.approved` | Admin duyệt thành viên | `{ user }` |

Khung mẫu (chưa bật — chỉ để tham khảo khi làm phần Discord):

```js
// integrations/discord.js
module.exports = (hooks) => {
  hooks.on('order.done', async ({ order, user }) => {
    // gửi thông báo tới Discord webhook ở đây (sẽ làm ở giai đoạn sau)
  });
};
```

Lỗi trong tích hợp không làm hỏng app chính — đơn vẫn được lưu bình thường.

`order` gửi cho tích hợp có tiền công, chiết khấu %, thực nhận (`price`, `discountPct`, `net`) nhưng **không bao giờ có tài khoản/mật khẩu** của khách.
