#!/bin/sh
# Khởi động DCMS: CSDL SQLite nằm trên volume /data (symlink vào vị trí schema Prisma), lần đầu tạo bảng + nạp dữ liệu mẫu.
set -e
mkdir -p /data /app/server/uploads
ln -sf /data/dcms.db /app/server/prisma/dcms.db
cd /app/server
if [ ! -s /data/dcms.db ]; then
  echo "[dcms] Khởi tạo cơ sở dữ liệu mới"
  npx prisma db push --skip-generate
  npx tsx prisma/seed.ts
else
  npx prisma db push --skip-generate
fi
exec npx tsx src/index.ts
