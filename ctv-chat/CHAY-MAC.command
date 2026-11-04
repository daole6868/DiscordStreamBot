#!/bin/sh
# macOS: bấm đúp để chạy.  Linux: sh CHAY-MAC.command  (hoặc: npm start)
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Máy chưa cài Node.js. Tải bản LTS tại https://nodejs.org rồi chạy lại."
  exit 1
fi
node server.js
