// Xóa database SQLite cục bộ để tạo lại dữ liệu mẫu (chỉ dùng cho môi trường phát triển/nghiệm thu).
const fs = require('fs');
const path = require('path');
for (const f of ['dcms.db', 'dcms.db-journal']) {
  const p = path.join(__dirname, '..', 'prisma', f);
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
    console.log('Đã xóa', p);
  }
}
