/* Dữ liệu mẫu cho DCMS. Chạy: npm run db:reset */
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { prisma, genFormCode, genTicketCode, logHistory } from '../src/core';
import { T24_PRODUCTS } from '../src/t24';
import { getCalendar } from '../src/services/calendar';
import { autoGenerate, evaluateStep, instantiateSteps, resultPath, ResultSnap } from '../src/services/engine';
import { resolveServiceConfig } from '../src/services/snapshot';
import { addDuration, WorkHoursMode } from '../../shared/sla';

const pw = bcrypt.hashSync('123456', 8);

async function main() {
  if (await prisma.user.count()) {
    console.log('Database đã có dữ liệu – bỏ qua seed. (Muốn tạo lại dữ liệu mẫu: npm run db:reset)');
    return;
  }
  // ───── Lịch làm việc ─────
  await prisma.setting.create({
    data: { key: 'workShifts', value: JSON.stringify([{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }]) },
  });
  const holidays: [string, string, string?][] = [
    ['2026-01-01', 'Tết Dương lịch'],
    ['2026-02-16', 'Tết Nguyên đán'],
    ['2026-02-17', 'Tết Nguyên đán'],
    ['2026-02-18', 'Tết Nguyên đán'],
    ['2026-02-19', 'Tết Nguyên đán'],
    ['2026-02-20', 'Tết Nguyên đán'],
    ['2026-04-27', 'Nghỉ bù Giỗ Tổ Hùng Vương'],
    ['2026-04-30', 'Ngày Giải phóng miền Nam'],
    ['2026-05-01', 'Quốc tế Lao động'],
    ['2026-09-01', 'Quốc khánh'],
    ['2026-09-02', 'Quốc khánh'],
    ['2026-12-26', 'Làm bù (ví dụ cấu hình)', 'WORKDAY'],
    ['2027-01-01', 'Tết Dương lịch'],
  ];
  for (const [date, name, type] of holidays) await prisma.holiday.create({ data: { date, name, type: type ?? 'HOLIDAY' } });

  // ───── Cây đơn vị ─────
  const depts: [string, string, string | null][] = [
    ['KVH', 'Khối Vận hành', null],
    ['TTT', 'Trung tâm Thẻ', 'KVH'],
    ['TTT.TS', 'Phòng Tra soát thẻ', 'TTT'],
    ['TTT.PH', 'Phòng Phát hành thẻ', 'TTT'],
    ['TTTT', 'Trung tâm Thanh toán', 'KVH'],
    ['TTTT.HT', 'Phòng Hoàn trả & Điều chỉnh', 'TTTT'],
    ['KBL', 'Khối Bán lẻ', null],
    ['CSKH', 'Trung tâm Chăm sóc khách hàng', 'KBL'],
    ['CSKH.TD', 'Phòng Tổng đài', 'CSKH'],
    ['CSKH.XL', 'Phòng Xử lý khiếu nại', 'CSKH'],
    ['KCN', 'Khối Công nghệ', null],
    ['KCN.UD', 'Phòng Ứng dụng ngân hàng số', 'KCN'],
    ['KQT', 'Khối Quản trị', null],
    ['KQT.HT', 'Phòng Quản trị hệ thống', 'KQT'],
  ];
  const D: Record<string, number> = {};
  for (const [code, name, parent] of depts) {
    const p = parent ? await prisma.department.findUniqueOrThrow({ where: { code: parent } }) : null;
    D[code] = (await prisma.department.create({ data: { code, name, parentId: p?.id ?? null, level: p ? p.level + 1 : 1 } })).id;
  }

  const users: [string, string, string, string, string?, boolean?][] = [
    ['admin', 'Nguyễn Quản Trị', 'KQT.HT', 'Quản trị hệ thống', 'ADMIN'],
    ['cs.lan', 'Trần Thị Lan', 'CSKH.TD', 'Trưởng nhóm tổng đài'],
    ['cs.minh', 'Lê Văn Minh', 'CSKH.TD', 'Điện thoại viên'],
    ['xl.hoa', 'Phạm Thu Hoa', 'CSKH.XL', 'Chuyên viên xử lý khiếu nại'],
    ['xl.tuan', 'Đỗ Anh Tuấn', 'CSKH.XL', 'Chuyên viên xử lý khiếu nại'],
    ['ts.nam', 'Hoàng Văn Nam', 'TTT.TS', 'Chuyên viên tra soát'],
    ['ts.linh', 'Vũ Mai Linh', 'TTT.TS', 'Chuyên viên tra soát'],
    ['ph.duc', 'Bùi Minh Đức', 'TTT.PH', 'Chuyên viên phát hành thẻ'],
    ['tt.huong', 'Ngô Thanh Hương', 'TTTT.HT', 'Chuyên viên thanh toán'],
    ['tt.khoa', 'Đặng Đăng Khoa', 'TTTT.HT', 'Chuyên viên thanh toán', 'USER', false],
    ['ud.son', 'Trịnh Hồng Sơn', 'KCN.UD', 'Kỹ sư ứng dụng'],
  ];
  const U: Record<string, number> = {};
  for (const [username, fullName, dept, title, role, active] of users) {
    U[username] = (
      await prisma.user.create({
        data: {
          username,
          fullName,
          title,
          passwordHash: pw,
          role: role ?? 'USER',
          active: active ?? true,
          departmentId: D[dept],
          email: `${username}@dcms.local`,
        },
      })
    ).id;
  }
  const focal: [string, string][] = [
    ['CSKH.TD', 'cs.lan'],
    ['CSKH.XL', 'xl.hoa'],
    ['TTT.TS', 'ts.nam'],
    ['TTT.PH', 'ph.duc'],
    ['TTTT.HT', 'tt.huong'],
    ['KQT.HT', 'admin'],
  ];
  for (const [d, u] of focal) await prisma.department.update({ where: { id: D[d] }, data: { focalUserId: U[u] } });

  // ───── Chi nhánh – RM ─────
  const branches: [string, string, string[]][] = [
    ['CN.HN', 'Chi nhánh Hà Nội', ['Phan Quốc Bảo', 'Lý Thu Trang', 'Cao Minh Hiếu']],
    ['CN.SG', 'Chi nhánh Sài Gòn', ['Mai Ngọc Hân', 'Tôn Thất Phong']],
    ['CN.DN', 'Chi nhánh Đà Nẵng', ['Hồ Thị Ngân', 'Lưu Văn Khải']],
    ['CN.HP', 'Chi nhánh Hải Phòng', ['Đinh Quang Vinh', 'Kiều Thanh Mai']],
  ];
  let rmNo = 1;
  for (const [code, name, rms] of branches) {
    const b = await prisma.branch.create({ data: { code, name } });
    for (const r of rms)
      await prisma.relationshipManager.create({ data: { code: `RM${String(rmNo++).padStart(3, '0')}`, fullName: r, branchId: b.id } });
  }

  // ───── Đơn vị hành chính (mô hình Tỉnh/Thành phố → Xã/Phường) ─────
  const provinces: [string, string, string[]][] = [
    ['01', 'Thành phố Hà Nội', ['Phường Hoàn Kiếm', 'Phường Cửa Nam', 'Phường Ba Đình', 'Phường Ngọc Hà', 'Phường Giảng Võ', 'Phường Đống Đa', 'Phường Cầu Giấy', 'Phường Tây Hồ', 'Xã Sóc Sơn']],
    ['79', 'Thành phố Hồ Chí Minh', ['Phường Sài Gòn', 'Phường Bến Thành', 'Phường Tân Định', 'Phường Cầu Ông Lãnh', 'Phường Thủ Đức', 'Phường Bình Thạnh', 'Phường Gò Vấp', 'Xã Cần Giờ']],
    ['48', 'Thành phố Đà Nẵng', ['Phường Hải Châu', 'Phường Hòa Cường', 'Phường Thanh Khê', 'Phường Sơn Trà', 'Phường Ngũ Hành Sơn']],
    ['31', 'Thành phố Hải Phòng', ['Phường Hồng Bàng', 'Phường Lê Chân', 'Phường Ngô Quyền', 'Phường Hải An']],
    ['92', 'Thành phố Cần Thơ', ['Phường Ninh Kiều', 'Phường Cái Khế', 'Phường Bình Thủy']],
    ['22', 'Tỉnh Quảng Ninh', ['Phường Hạ Long', 'Phường Bãi Cháy', 'Phường Cẩm Phả']],
    ['56', 'Tỉnh Khánh Hòa', ['Phường Nha Trang', 'Phường Bắc Nha Trang', 'Phường Cam Ranh']],
  ];
  let wardNo = 1;
  for (const [code, name, wards] of provinces) {
    const p = await prisma.province.create({ data: { code, name } });
    for (const w of wards) await prisma.ward.create({ data: { code: `${code}${String(wardNo++).padStart(3, '0')}`, name: w, provinceId: p.id } });
  }

  // ───── Khách hàng (360 view) ─────
  const customers = [
    { cif: '100001', fullName: 'Nguyễn Văn An', segment: 'MASS', phone: '0912345678', email: 'an.nguyen@example.com', idNumber: '001090012345', address: '12 Hàng Bài, Phường Hoàn Kiếm, Hà Nội' },
    { cif: '100002', fullName: 'Trần Thị Bình', segment: 'PRIORITY', phone: '0987654321', email: 'binh.tran@example.com', idNumber: '079185012346', address: '45 Lê Lợi, Phường Bến Thành, TP.HCM' },
    { cif: '100003', fullName: 'Công ty TNHH Minh Phát', segment: 'SME', phone: '02438123456', email: 'ketoan@minhphat.vn', idNumber: '0101234567', address: '88 Láng Hạ, Phường Đống Đa, Hà Nội' },
    { cif: '100004', fullName: 'Lê Hoàng Cường', segment: 'PRIVATE', phone: '0903111222', email: 'cuong.le@example.com', idNumber: '048088012347', address: '20 Bạch Đằng, Phường Hải Châu, Đà Nẵng' },
    { cif: '100005', fullName: 'Phạm Thị Dung', segment: 'MASS', phone: '0978222333', email: 'dung.pham@example.com', idNumber: '031195012348', address: '5 Lạch Tray, Phường Ngô Quyền, Hải Phòng' },
    { cif: '100006', fullName: 'Công ty CP Thương mại Sao Việt', segment: 'SME', phone: '02839998888', email: 'finance@saoviet.vn', idNumber: '0309876543', address: '100 Nguyễn Huệ, Phường Sài Gòn, TP.HCM' },
  ];
  let accNo = 1;
  let txNo = 1;
  for (const [i, c] of customers.entries()) {
    const cust = await prisma.customer.create({ data: c });
    const acc = `0${(1100000000 + accNo++ * 7919).toString()}`;
    await prisma.account.create({ data: { customerId: cust.id, accountNo: acc, type: 'Tài khoản thanh toán', balance: 15_000_000 * (i + 1), status: 'Hoạt động' } });
    if (i % 2 === 0)
      await prisma.account.create({
        data: { customerId: cust.id, accountNo: `0${(1100000000 + accNo++ * 7919).toString()}`, type: 'Tài khoản tiết kiệm', balance: 200_000_000, status: 'Hoạt động' },
      });
    const cards = [`4214 83•• •••• ${String(1000 + i * 37).slice(-4)}`, `9704 22•• •••• ${String(5000 + i * 53).slice(-4)}`];
    await prisma.card.create({ data: { customerId: cust.id, cardNo: cards[0], cardType: 'Thẻ tín dụng Visa', status: 'Hoạt động', expiry: '09/29' } });
    await prisma.card.create({ data: { customerId: cust.id, cardNo: cards[1], cardType: 'Thẻ ghi nợ nội địa', status: 'Hoạt động', expiry: '03/30' } });
    const txs: [string, number, string, number][] = [
      [cards[0], 2_450_000, 'Thanh toán POS – Siêu thị WinMart', 2],
      [cards[0], 2_450_000, 'Thanh toán POS – Siêu thị WinMart (trùng)', 2],
      [cards[1], 3_000_000, 'Rút tiền ATM – không nhận được tiền', 5],
      [acc, 12_500_000, 'Chuyển khoản liên ngân hàng', 8],
      [cards[0], 899_000, 'Thanh toán trực tuyến – Shopee', 12],
    ];
    for (const [src, amount, desc, daysAgo] of txs)
      await prisma.transaction.create({
        data: {
          customerId: cust.id,
          refNo: `FT26${String(txNo++).padStart(8, '0')}`,
          sourceNo: src,
          amount,
          description: desc,
          txnAt: new Date(Date.now() - daysAgo * 86400_000 - i * 3600_000),
        },
      });
  }

  // ───── Sản phẩm (đồng bộ T24 – để lại vài bản ghi cho chức năng "Đồng bộ T24") ─────
  const skip = new Set(['THE.TD.JCB', 'VAY', 'VAY.TC', 'VAY.TC.TC']);
  const P: Record<string, number> = {};
  for (const p of T24_PRODUCTS.filter((x) => !skip.has(x.code))) {
    const parent = p.parent ? await prisma.product.findUniqueOrThrow({ where: { code: p.parent } }) : null;
    P[p.code] = (
      await prisma.product.create({ data: { code: p.code, name: p.name, parentId: parent?.id ?? null, level: parent ? parent.level + 1 : 1, source: 'T24' } })
    ).id;
  }

  // ───── Nghiệp vụ ─────
  const ops: [string, string, string | null][] = [
    ['KN', 'Khiếu nại', null],
    ['KN.GD', 'Khiếu nại giao dịch', 'KN'],
    ['KN.GD.TS', 'Tra soát giao dịch', 'KN.GD'],
    ['KN.GD.HT', 'Yêu cầu hoàn tiền', 'KN.GD'],
    ['KN.CL', 'Khiếu nại chất lượng dịch vụ', 'KN'],
    ['YC', 'Yêu cầu dịch vụ', null],
    ['YC.KHOA', 'Khóa thẻ / tài khoản', 'YC'],
    ['YC.MO', 'Mở khóa thẻ / tài khoản', 'YC'],
    ['YC.PIN', 'Cấp lại PIN', 'YC'],
    ['YC.PHL', 'Phát hành lại thẻ', 'YC'],
    ['TD', 'Thay đổi thông tin', null],
    ['TD.SDT', 'Cập nhật số điện thoại', 'TD'],
    ['TD.HM', 'Điều chỉnh hạn mức', 'TD'],
  ];
  const O: Record<string, number> = {};
  for (const [code, name, parent] of ops) {
    const p = parent ? await prisma.operation.findUniqueOrThrow({ where: { code: parent } }) : null;
    O[code] = (await prisma.operation.create({ data: { code, name, parentId: p?.id ?? null, level: p ? p.level + 1 : 1 } })).id;
  }

  // ───── Trường nhập liệu ─────
  const opt = (...pairs: [string, string][]) => JSON.stringify(pairs.map(([value, label]) => ({ value, label })));
  const fields: any[] = [
    { code: 'SO_THE', name: 'Số thẻ', infoType: 'VIEW360', view360Source: 'CARD_NO', dataType: 'TEXT', displayType: 'TEXTBOX', required: true },
    { code: 'SO_TK', name: 'Số tài khoản', infoType: 'VIEW360', view360Source: 'ACCOUNT_NO', dataType: 'TEXT', displayType: 'TEXTBOX' },
    { code: 'MA_GD', name: 'Mã giao dịch', infoType: 'VIEW360', view360Source: 'TRANSACTION', dataType: 'TEXT', displayType: 'TEXTBOX', required: true },
    { code: 'SO_TIEN', name: 'Số tiền tra soát', infoType: 'INPUT', dataType: 'NUMBER', displayType: 'TEXTBOX', required: true },
    { code: 'NGAY_GD', name: 'Ngày giao dịch', infoType: 'INPUT', dataType: 'DATE', displayType: 'DATEPICKER', required: true },
    {
      code: 'LOAI_TS', name: 'Loại tra soát', infoType: 'INPUT', dataType: 'SINGLE_CHOICE', displayType: 'DROPDOWN', required: true,
      options: opt(['ATM_KHONG_NHA_TIEN', 'ATM không nhả tiền'], ['TRU_TIEN_2_LAN', 'Trừ tiền 2 lần'], ['GD_GIA_MAO', 'Giao dịch không do chủ thẻ thực hiện'], ['KHAC', 'Khác']),
    },
    { code: 'MO_TA_KHAC', name: 'Mô tả loại tra soát khác', infoType: 'INPUT', dataType: 'TEXT', displayType: 'TEXTAREA', required: true },
    { code: 'KHOA_THE_TAM', name: 'Đã khóa thẻ tạm thời', infoType: 'INPUT', dataType: 'BOOLEAN', displayType: 'SWITCH' },
    {
      code: 'LY_DO_KHOA', name: 'Lý do khóa', infoType: 'INPUT', dataType: 'SINGLE_CHOICE', displayType: 'RADIO', required: true,
      options: opt(['MAT_THE', 'Mất thẻ'], ['GIAN_LAN', 'Nghi ngờ gian lận'], ['KH_YEU_CAU', 'Khách hàng yêu cầu']),
    },
    { code: 'PHAT_HANH_LAI', name: 'Yêu cầu phát hành lại thẻ', infoType: 'INPUT', dataType: 'BOOLEAN', displayType: 'RADIO', required: true },
    {
      code: 'HINH_THUC_NHAN', name: 'Hình thức nhận thẻ', infoType: 'INPUT', dataType: 'SINGLE_CHOICE', displayType: 'RADIO', required: true,
      options: opt(['TAI_CN', 'Nhận tại chi nhánh'], ['CHUYEN_PHAT', 'Chuyển phát tận nơi']),
    },
    { code: 'CN_NHAN', name: 'Chi nhánh nhận thẻ', infoType: 'INPUT', dataType: 'BRANCH_RM', displayType: 'COMPOSITE', required: true },
    { code: 'DIA_CHI_NHAN', name: 'Địa chỉ nhận thẻ', infoType: 'INPUT', dataType: 'ADMIN_UNIT', displayType: 'COMPOSITE', required: true },
    {
      code: 'KQ_GOI', name: 'Kết quả gọi xác minh', infoType: 'INPUT', dataType: 'CALL_RESULT', displayType: 'DROPDOWN',
      options: opt(['LIEN_LAC_DUOC', 'Liên lạc được'], ['KHONG_NGHE', 'Không nghe máy'], ['SAI_SO', 'Thuê bao / sai số'], ['HEN_GOI_LAI', 'Hẹn gọi lại']),
    },
    {
      code: 'KENH_LIEN_HE', name: 'Kênh liên hệ ưu tiên', infoType: 'INPUT', dataType: 'MULTI_CHOICE', displayType: 'CHECKBOX',
      options: opt(['PHONE', 'Điện thoại'], ['EMAIL', 'Email'], ['SMS', 'SMS']),
    },
    { code: 'SDT_LIEN_HE', name: 'SĐT liên hệ', infoType: 'VIEW360', view360Source: 'CUSTOMER_PHONE', dataType: 'TEXT', displayType: 'TEXTBOX' },
    { code: 'GHI_CHU_NB', name: 'Ghi chú nội bộ', infoType: 'INPUT', dataType: 'TEXT', displayType: 'TEXTAREA', showOnTicket: false },
    { code: 'SO_TIEN_HOAN', name: 'Số tiền hoàn trả', infoType: 'INPUT', dataType: 'NUMBER', displayType: 'TEXTBOX', required: true, showOnTicket: false },
    { code: 'HAN_MUC_DE_NGHI', name: 'Hạn mức đề nghị', infoType: 'INPUT', dataType: 'NUMBER', displayType: 'TEXTBOX' },
  ];
  const F: Record<string, number> = {};
  for (const f of fields) F[f.code] = (await prisma.field.create({ data: { options: '[]', ...f } })).id;

  // ───── Mẫu nhập liệu ─────
  async function createForm(name: string, description: string, items: { f: string; parent?: string; values?: string[] }[]) {
    const code = await genFormCode(prisma);
    const form = await prisma.form.create({ data: { code, name, description } });
    const ids: Record<string, number> = {};
    for (const [i, it] of items.entries()) {
      ids[it.f] = (
        await prisma.formItem.create({
          data: {
            formId: form.id,
            fieldId: F[it.f],
            sortOrder: i + 1,
            parentItemId: it.parent ? ids[it.parent] : null,
            parentValues: JSON.stringify(it.values ?? []),
          },
        })
      ).id;
    }
    return form.id;
  }
  const FM_TS = await createForm('Mẫu tra soát giao dịch thẻ', 'Thông tin tra soát giao dịch thẻ/ATM', [
    { f: 'SO_THE' },
    { f: 'MA_GD' },
    { f: 'NGAY_GD' },
    { f: 'SO_TIEN' },
    { f: 'LOAI_TS' },
    { f: 'MO_TA_KHAC', parent: 'LOAI_TS', values: ['KHAC'] },
    { f: 'SDT_LIEN_HE' },
    { f: 'KENH_LIEN_HE' },
  ]);
  const FM_KHOA = await createForm('Mẫu khóa / phát hành lại thẻ', 'Khóa thẻ khẩn cấp, có cấu hình phụ thuộc 2 cấp', [
    { f: 'SO_THE' },
    { f: 'LY_DO_KHOA' },
    { f: 'PHAT_HANH_LAI' },
    { f: 'HINH_THUC_NHAN', parent: 'PHAT_HANH_LAI', values: ['true'] },
    { f: 'CN_NHAN', parent: 'HINH_THUC_NHAN', values: ['TAI_CN'] },
    { f: 'DIA_CHI_NHAN', parent: 'HINH_THUC_NHAN', values: ['CHUYEN_PHAT'] },
    { f: 'SDT_LIEN_HE' },
  ]);
  const FM_GOI = await createForm('Mẫu xác minh cuộc gọi', 'Dùng cho công việc liên hệ khách hàng', [{ f: 'KQ_GOI' }, { f: 'GHI_CHU_NB' }]);
  const FM_HOAN = await createForm('Mẫu hoàn tiền', 'Dùng cho công việc hoàn tiền', [{ f: 'SO_TK' }, { f: 'SO_TIEN_HOAN' }, { f: 'GHI_CHU_NB' }]);

  // ───── Quy trình ─────
  type R = { name: string; code?: string; route?: 'NEXT' | 'GOTO' | 'END'; goto?: string; children?: R[] };
  type S = { ref: string; name: string; sla: [number, number, number]; dept?: string; user?: string; form?: number; expected?: string; results: R[] };
  async function createWorkflow(code: string, name: string, mode: 'OFFICE' | 'H24', description: string, steps: S[]) {
    const wf = await prisma.workflow.create({ data: { code, name, workHoursMode: mode, description } });
    const keys: Record<string, string> = Object.fromEntries(steps.map((s) => [s.ref, randomUUID()]));
    for (const [i, s] of steps.entries()) {
      const step = await prisma.workflowStep.create({
        data: {
          key: keys[s.ref],
          workflowId: wf.id,
          sortOrder: i + 1,
          name: s.name,
          slaDays: s.sla[0],
          slaHours: s.sla[1],
          slaMinutes: s.sla[2],
          departmentId: s.dept ? D[s.dept] : null,
          assigneeId: s.user ? U[s.user] : null,
          formId: s.form ?? null,
          expectedResult: s.expected ?? null,
        },
      });
      let order = 1;
      const addResults = async (list: R[], parentKey: string | null) => {
        for (const r of list) {
          const key = randomUUID();
          await prisma.stepResult.create({
            data: {
              key,
              stepId: step.id,
              parentKey,
              code: r.code ?? `KQ${order}`,
              name: r.name,
              sortOrder: order++,
              routeType: r.children ? 'NEXT' : r.route ?? 'NEXT',
              gotoStepKey: r.goto ? keys[r.goto] : null,
            },
          });
          if (r.children) await addResults(r.children, key);
        }
      };
      await addResults(s.results, null);
    }
    return wf.id;
  }

  const tsSteps = (fast: boolean): S[] => [
    {
      ref: 'S1', name: 'Tiếp nhận & kiểm tra hồ sơ', sla: fast ? [0, 2, 0] : [0, 4, 0], dept: 'CSKH.XL', form: FM_GOI,
      expected: 'Hồ sơ tra soát đầy đủ, hợp lệ',
      results: [
        { name: 'Hồ sơ hợp lệ', code: 'HOP_LE' },
        { name: 'Hồ sơ không hợp lệ', code: 'KHONG_HOP_LE', children: [
          { name: 'Thiếu chứng từ', code: 'THIEU_CT', route: 'END' },
          { name: 'Không thuộc phạm vi tra soát', code: 'NGOAI_PV', route: 'END' },
        ] },
      ],
    },
    {
      ref: 'S2', name: 'Tra soát với tổ chức thẻ', sla: fast ? [1, 0, 0] : [2, 0, 0], dept: 'TTT.TS',
      expected: 'Có kết luận tra soát từ tổ chức thẻ',
      results: [
        { name: 'Khách hàng đúng – cần hoàn tiền', code: 'KH_DUNG' },
        { name: 'Khách hàng sai – từ chối', code: 'KH_SAI', route: 'GOTO', goto: 'S4' },
      ],
    },
    {
      ref: 'S3', name: 'Hoàn tiền cho khách hàng', sla: fast ? [0, 4, 0] : [1, 0, 0], dept: 'TTTT.HT', form: FM_HOAN,
      expected: 'Khách hàng được hoàn đủ số tiền',
      results: [{ name: 'Đã hoàn tiền', code: 'DA_HOAN' }],
    },
    {
      ref: 'S4', name: 'Phản hồi kết quả cho khách hàng', sla: fast ? [0, 2, 0] : [0, 4, 0], dept: 'CSKH.TD', form: FM_GOI,
      expected: 'Khách hàng nhận được phản hồi kết quả',
      results: [
        { name: 'Đã phản hồi khách hàng', code: 'DA_PHAN_HOI' },
        { name: 'Không liên lạc được – đã gửi email', code: 'GUI_EMAIL' },
      ],
    },
  ];
  const WF_TS = await createWorkflow('QT_TS_STD', 'Tra soát giao dịch thẻ – tiêu chuẩn', 'OFFICE', 'Áp dụng cho khách hàng Mass/SME', tsSteps(false));
  const WF_TS_PRI = await createWorkflow('QT_TS_PRI', 'Tra soát giao dịch thẻ – ưu tiên', 'OFFICE', 'Áp dụng cho khách hàng Priority/Private, SLA rút ngắn', tsSteps(true));
  const WF_KHOA = await createWorkflow('QT_KHOA_247', 'Khóa thẻ khẩn cấp 24/7', 'H24', 'Xử lý liên tục 24/7', [
    { ref: 'S1', name: 'Khóa thẻ trên hệ thống', sla: [0, 0, 30], dept: 'TTT.PH', results: [{ name: 'Đã khóa thẻ' }, { name: 'Thẻ đã bị khóa trước đó' }] },
    { ref: 'S2', name: 'Xác nhận với khách hàng', sla: [0, 2, 0], dept: 'CSKH.TD', form: FM_GOI, results: [{ name: 'Đã xác nhận' }, { name: 'Không liên lạc được' }] },
  ]);
  const WF_PHL = await createWorkflow('QT_PHL', 'Phát hành lại thẻ', 'OFFICE', 'Phát hành lại thẻ do mất/hỏng', [
    { ref: 'S1', name: 'Kiểm tra yêu cầu', sla: [0, 4, 0], dept: 'CSKH.XL', results: [{ name: 'Hợp lệ' }, { name: 'Không hợp lệ', route: 'END' }] },
    { ref: 'S2', name: 'In & phát hành thẻ', sla: [2, 0, 0], dept: 'TTT.PH', results: [{ name: 'Đã phát hành' }] },
    { ref: 'S3', name: 'Bàn giao thẻ cho khách hàng', sla: [1, 0, 0], dept: 'CSKH.TD', results: [{ name: 'Đã bàn giao' }, { name: 'Khách hàng chưa nhận', route: 'GOTO', goto: 'S2' }] },
  ]);
  const WF_APP = await createWorkflow('QT_APP', 'Xử lý lỗi Mobile Banking', 'OFFICE', 'Phòng Ứng dụng chưa cấu hình đầu mối – dùng để kiểm thử cảnh báo sinh tác vụ lỗi', [
    { ref: 'S1', name: 'Tiếp nhận lỗi', sla: [0, 2, 0], dept: 'CSKH.TD', results: [{ name: 'Đã ghi nhận đủ thông tin' }] },
    { ref: 'S2', name: 'Kiểm tra kỹ thuật', sla: [1, 0, 0], dept: 'KCN.UD', results: [{ name: 'Đã khắc phục' }, { name: 'Lỗi do thao tác khách hàng' }] },
    { ref: 'S3', name: 'Phản hồi khách hàng', sla: [0, 4, 0], dept: 'CSKH.TD', results: [{ name: 'Đã phản hồi' }] },
  ]);

  // ───── Dịch vụ ─────
  async function createService(prod: string, op: string, formId: number | null, mode: 'OFFICE' | 'H24', wfs: Record<string, number>) {
    const product = await prisma.product.findUniqueOrThrow({ where: { id: P[prod] } });
    const operation = await prisma.operation.findUniqueOrThrow({ where: { id: O[op] } });
    return prisma.service.create({
      data: {
        code: `${product.code}-${operation.code}`,
        productId: product.id,
        operationId: operation.id,
        formId,
        workHoursMode: mode,
        segmentMode: wfs.ALL ? 'ALL' : 'BY_SEGMENT',
        workflows: { create: Object.entries(wfs).map(([segment, workflowId]) => ({ segment, workflowId })) },
      },
    });
  }
  await createService('THE.TD.VISA', 'KN.GD.TS', FM_TS, 'OFFICE', { MASS: WF_TS, SME: WF_TS, PRIORITY: WF_TS_PRI, PRIVATE: WF_TS_PRI });
  await createService('THE.GN.ND', 'KN.GD.TS', FM_TS, 'OFFICE', { ALL: WF_TS });
  await createService('THE.GN.QT', 'KN.GD.TS', FM_TS, 'OFFICE', { ALL: WF_TS });
  await createService('THE.TD.VISA', 'YC.KHOA', FM_KHOA, 'H24', { ALL: WF_KHOA });
  await createService('THE.GN.ND', 'YC.KHOA', FM_KHOA, 'H24', { ALL: WF_KHOA });
  await createService('THE.TD.VISA', 'YC.PHL', FM_KHOA, 'OFFICE', { ALL: WF_PHL });
  await createService('NHDT.APP', 'KN.CL', null, 'OFFICE', { ALL: WF_APP });

  // ───── Phiếu mẫu ─────
  const cal = await getCalendar();
  const userName = async (id: number) => (await prisma.user.findUniqueOrThrow({ where: { id } })).fullName;
  const custId = async (cif: string) => (await prisma.customer.findUniqueOrThrow({ where: { cif } })).id;

  async function createTicket(p: { creator: string; owner: string; prod: string; op: string; cif: string; channel: string; description: string; values: any }) {
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: await custId(p.cif) } });
    const cfg = await resolveServiceConfig(prisma, P[p.prod], O[p.op], customer.segment);
    const creator = { id: U[p.creator], fullName: await userName(U[p.creator]) };
    return prisma.$transaction(async (tx) => {
      const now = new Date();
      const mode = cfg.service.workHoursMode as WorkHoursMode;
      const status = U[p.creator] === U[p.owner] ? 'IN_PROGRESS' : 'NEW';
      const t = await tx.ticket.create({
        data: {
          code: await genTicketCode(tx),
          channel: p.channel,
          status,
          productId: P[p.prod],
          operationId: O[p.op],
          serviceId: cfg.service.id,
          customerId: customer.id,
          segment: customer.segment,
          ownerId: U[p.owner],
          creatorId: creator.id,
          description: p.description,
          workHoursMode: mode,
          slaMinutes: cfg.slaMinutes,
          slaStartAt: now,
          dueAt: new Date(addDuration(mode, cal, now.getTime(), cfg.slaMinutes)),
          configSnapshot: JSON.stringify(cfg.snapshot),
          dynamicValues: JSON.stringify(p.values),
        },
      });
      await logHistory(tx, { entityType: 'TICKET', entityId: t.id, actor: creator, action: 'CREATE', summary: `Tạo phiếu – dịch vụ ${cfg.service.code}, quy trình "${cfg.workflow.name}"` });
      const steps = await instantiateSteps(tx, t.id, 1, cfg.workflow);
      await autoGenerate(tx, t.id, steps[0].id, cal);
      return t;
    });
  }

  async function completeOpenTask(ticketId: number, resultCode: string, by: string) {
    const task = await prisma.task.findFirstOrThrow({ where: { ticketId, status: { not: 'DONE' } }, include: { step: true } });
    const results = JSON.parse(task.step.resultsSnapshot) as ResultSnap[];
    const r = results.find((x) => x.code === resultCode)!;
    const actor = { id: U[by], fullName: await userName(U[by]) };
    await prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: task.id },
        data: { status: 'DONE', resultKey: r.key, resultLabel: resultPath(results, r.key), completedAt: new Date(), note: 'Đã xử lý (dữ liệu mẫu)' },
      });
      await logHistory(tx, {
        entityType: 'TASK', entityId: task.id, actor, action: 'DONE', summary: 'Hoàn thành',
        changes: [
          { field: 'resultKey', label: 'Kết quả', oldValue: null, newValue: resultPath(results, r.key) },
          { field: 'status', label: 'Trạng thái', oldValue: 'Đang xử lý', newValue: 'Hoàn thành' },
        ],
      });
      await evaluateStep(tx, task.ticketStepId, cal);
    });
  }

  const tsValues = (cif: string, kind: string) => ({ SO_THE: '4214 83•• •••• 1000', MA_GD: 'FT2600000002', NGAY_GD: '2026-10-05', SO_TIEN: 2450000, LOAI_TS: kind, SDT_LIEN_HE: cif, KENH_LIEN_HE: ['PHONE'] });

  await createTicket({
    creator: 'cs.minh', owner: 'xl.hoa', prod: 'THE.TD.VISA', op: 'KN.GD.TS', cif: '100001', channel: 'HOTLINE',
    description: 'Khách hàng phản ánh bị trừ tiền 2 lần khi thanh toán tại siêu thị.', values: tsValues('0912345678', 'TRU_TIEN_2_LAN'),
  });
  const t2 = await createTicket({
    creator: 'xl.hoa', owner: 'xl.hoa', prod: 'THE.TD.VISA', op: 'KN.GD.TS', cif: '100002', channel: 'COUNTER',
    description: 'Khách hàng Priority tra soát giao dịch trực tuyến không do mình thực hiện.', values: tsValues('0987654321', 'GD_GIA_MAO'),
  });
  await completeOpenTask(t2.id, 'HOP_LE', 'xl.hoa');
  const t3 = await createTicket({
    creator: 'cs.lan', owner: 'cs.lan', prod: 'NHDT.APP', op: 'KN.CL', cif: '100004', channel: 'APP',
    description: 'Ứng dụng báo lỗi khi đăng nhập bằng sinh trắc học.', values: {},
  });
  await completeOpenTask(t3.id, 'KQ1', 'cs.lan');
  const t4 = await createTicket({
    creator: 'cs.minh', owner: 'cs.minh', prod: 'THE.GN.ND', op: 'YC.KHOA', cif: '100005', channel: 'HOTLINE',
    description: 'Khách hàng báo mất thẻ, yêu cầu khóa khẩn cấp và phát hành lại.',
    values: { SO_THE: '9704 22•• •••• 5212', LY_DO_KHOA: 'MAT_THE', PHAT_HANH_LAI: true, HINH_THUC_NHAN: 'CHUYEN_PHAT', DIA_CHI_NHAN: { provinceId: 4, wardId: 25, address: '5 Lạch Tray' }, SDT_LIEN_HE: '0978222333' },
  });
  // Lùi thời điểm để minh họa tác vụ quá hạn (24/7, SLA 30 phút)
  const past = new Date(Date.now() - 45 * 60_000);
  await prisma.ticket.update({ where: { id: t4.id }, data: { createdAt: past, slaStartAt: past, dueAt: new Date(past.getTime() + 150 * 60_000) } });
  await prisma.task.updateMany({ where: { ticketId: t4.id }, data: { createdAt: past, dueAt: new Date(past.getTime() + 30 * 60_000) } });

  console.log('✔ Seed hoàn tất. Đăng nhập: admin / 123456 (hoặc bất kỳ tài khoản mẫu nào, mật khẩu 123456)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
