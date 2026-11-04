'use strict';
/** Chữ để tìm kiếm: bỏ dấu tiếng Việt + chữ thường ("Đặc Sản" → "dac san"), gõ có dấu hay không dấu đều tìm được. */
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
module.exports = { fold };
