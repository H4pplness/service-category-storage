/*
 * Bổ sung dữ liệu demo "như đang vận hành": thêm nhân sự, khách hàng, dịch vụ/quy trình mới
 * và ~60 phiếu trải trong 30 ngày qua, được xử lý qua engine thật với đồng hồ giả lập.
 * Chạy: npm run db:fill   (chạy lại sẽ chỉ thêm phần còn thiếu; phiếu demo chỉ sinh 1 lần, dùng --force để sinh thêm)
 */
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import type { Task, Ticket } from '@prisma/client';
import { Actor, clock, genFormCode, genTicketCode, logHistory, notify, parseJson, prisma } from '../src/core';
import { getCalendar } from '../src/services/calendar';
import { autoGenerate, createTask, evaluateStep, instantiateSteps, resultLeaves, resultPath, ResultSnap } from '../src/services/engine';
import { resolveServiceConfig, TicketConfigSnapshot } from '../src/services/snapshot';
import { addDuration, WorkCalendar, WorkHoursMode } from '../../shared/sla';
import { FormItemDef, FormSnapshot, optionsOf, pruneValues, visibleItems } from '../../shared/form';

// ───── Ngẫu nhiên có seed (dữ liệu lặp lại được) ─────
let seed = 20261009;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const chance = (p: number) => rand() < p;
const randint = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const between = (a: number, b: number) => a + rand() * (b - a);

const MIN = 60_000;
const DAY = 86400_000;
const pw = bcrypt.hashSync('123456', 8);

async function main() {
  const REAL_NOW = Date.now();
  const force = process.argv.includes('--force');

  // ═════ 1. Nhân sự bổ sung ═════
  const dept = async (code: string) => (await prisma.department.findUniqueOrThrow({ where: { code } })).id;
  const newUsers: [string, string, string, string][] = [
    ['cs.ha', 'Nguyễn Thu Hà', 'CSKH.TD', 'Điện thoại viên'],
    ['cs.quang', 'Phan Văn Quang', 'CSKH.TD', 'Điện thoại viên'],
    ['xl.mai', 'Lý Thanh Mai', 'CSKH.XL', 'Chuyên viên xử lý khiếu nại'],
    ['ts.phuong', 'Tạ Minh Phương', 'TTT.TS', 'Chuyên viên tra soát'],
    ['ph.trang', 'Hà Thu Trang', 'TTT.PH', 'Chuyên viên phát hành thẻ'],
    ['tt.binh', 'Châu Văn Bình', 'TTTT.HT', 'Chuyên viên thanh toán'],
    ['ud.khanh', 'Mạc Duy Khánh', 'KCN.UD', 'Kỹ sư ứng dụng'],
  ];
  for (const [username, fullName, d, title] of newUsers) {
    if (await prisma.user.findUnique({ where: { username } })) continue;
    await prisma.user.create({ data: { username, fullName, title, passwordHash: pw, departmentId: await dept(d), email: `${username}@dcms.local` } });
  }
  const users = await prisma.user.findMany({ where: { active: true } });
  const U = (u: string) => users.find((x) => x.username === u)!;
  const actor = (u: { id: number; fullName: string }): Actor => ({ id: u.id, fullName: u.fullName });

  // ═════ 2. Khách hàng bổ sung ═════
  const custSeed: [string, string, string, string][] = [
    ['100007', 'Hoàng Thị Mỹ Linh', 'MASS', 'Phường Cầu Giấy, Hà Nội'],
    ['100008', 'Đặng Quốc Huy', 'PRIORITY', 'Phường Tân Định, TP.HCM'],
    ['100009', 'Công ty TNHH Xây dựng Phú Gia', 'SME', 'Phường Hải Châu, Đà Nẵng'],
    ['100010', 'Vũ Thị Thanh Tâm', 'MASS', 'Phường Lê Chân, Hải Phòng'],
    ['100011', 'Bùi Đức Thắng', 'PRIVATE', 'Phường Ba Đình, Hà Nội'],
    ['100012', 'Trương Ngọc Ánh', 'MASS', 'Phường Ninh Kiều, Cần Thơ'],
    ['100013', 'Công ty CP Dược phẩm An Khang', 'SME', 'Phường Gò Vấp, TP.HCM'],
    ['100014', 'Lâm Gia Bảo', 'PRIORITY', 'Phường Bãi Cháy, Quảng Ninh'],
    ['100015', 'Đinh Thị Hồng Nhung', 'MASS', 'Phường Nha Trang, Khánh Hòa'],
    ['100016', 'Ngô Minh Tuấn', 'MASS', 'Phường Thủ Đức, TP.HCM'],
    ['100017', 'Công ty TNHH Logistics Hải Âu', 'SME', 'Phường Hồng Bàng, Hải Phòng'],
    ['100018', 'Phùng Khánh Vy', 'PRIORITY', 'Phường Tây Hồ, Hà Nội'],
    ['100019', 'Hồ Văn Lực', 'MASS', 'Phường Sơn Trà, Đà Nẵng'],
    ['100020', 'Kim Thị Phượng', 'PRIVATE', 'Phường Sài Gòn, TP.HCM'],
  ];
  const merchants = ['Siêu thị WinMart', 'Shopee', 'Grab', 'Highlands Coffee', 'Vietnam Airlines', 'Lazada', 'Điện Máy Xanh', 'Agoda', 'Netflix', 'Circle K'];
  let txSeq = (await prisma.transaction.count()) + 1;
  for (const [i, [cif, fullName, segment, address]] of custSeed.entries()) {
    if (await prisma.customer.findUnique({ where: { cif } })) continue;
    const c = await prisma.customer.create({
      data: {
        cif,
        fullName,
        segment,
        address,
        phone: `09${randint(10000000, 99999999)}`,
        email: `kh${cif}@example.com`,
        idNumber: segment === 'SME' ? `0${randint(100000000, 999999999)}` : `0${randint(10, 99)}${randint(1000000000, 9999999999)}`.slice(0, 12),
      },
    });
    const acc = `0${1200000000 + Number(cif) * 13}`;
    await prisma.account.create({ data: { customerId: c.id, accountNo: acc, type: 'Tài khoản thanh toán', balance: randint(5, 900) * 1_000_000, status: 'Hoạt động' } });
    const cards = [`4214 83•• •••• ${String(2000 + i * 41).slice(-4)}`, `9704 22•• •••• ${String(6000 + i * 67).slice(-4)}`];
    await prisma.card.create({ data: { customerId: c.id, cardNo: cards[0], cardType: 'Thẻ tín dụng Visa', status: 'Hoạt động', expiry: `${randint(1, 12)}/${randint(27, 31)}` } });
    await prisma.card.create({ data: { customerId: c.id, cardNo: cards[1], cardType: 'Thẻ ghi nợ nội địa', status: 'Hoạt động', expiry: `${randint(1, 12)}/${randint(27, 31)}` } });
    for (let k = 0; k < 6; k++)
      await prisma.transaction.create({
        data: {
          customerId: c.id,
          refNo: `FT26${String(txSeq++).padStart(8, '0')}`,
          sourceNo: k === 5 ? acc : pick(cards),
          amount: randint(5, 900) * 10_000,
          description: k === 5 ? 'Chuyển khoản liên ngân hàng' : `Thanh toán – ${pick(merchants)}`,
          txnAt: new Date(REAL_NOW - randint(1, 40) * DAY - randint(0, 600) * MIN),
        },
      });
  }

  // ═════ 3. Trường, mẫu nhập liệu, quy trình, dịch vụ bổ sung ═════
  const opt = (...pairs: [string, string][]) => JSON.stringify(pairs.map(([value, label]) => ({ value, label })));
  const newFields: any[] = [
    { code: 'SDT_MOI', name: 'Số điện thoại mới', infoType: 'INPUT', dataType: 'TEXT', displayType: 'TEXTBOX', required: true, placeholder: '09xxxxxxxx' },
    {
      code: 'LY_DO_CAP_NHAT', name: 'Lý do cập nhật', infoType: 'INPUT', dataType: 'SINGLE_CHOICE', displayType: 'RADIO', required: true,
      options: opt(['DOI_SO', 'Đổi số điện thoại'], ['MAT_SIM', 'Mất SIM'], ['KHAC', 'Khác']),
    },
    { code: 'THU_NHAP', name: 'Thu nhập hàng tháng', infoType: 'INPUT', dataType: 'NUMBER', displayType: 'TEXTBOX', required: true },
    {
      code: 'HINH_THUC_PIN', name: 'Hình thức nhận PIN', infoType: 'INPUT', dataType: 'SINGLE_CHOICE', displayType: 'DROPDOWN', required: true,
      options: opt(['SMS', 'PIN điện tử qua SMS'], ['GIAY', 'PIN giấy tại chi nhánh']),
    },
  ];
  for (const f of newFields) if (!(await prisma.field.findUnique({ where: { code: f.code } }))) await prisma.field.create({ data: { options: '[]', ...f } });
  const F = async (code: string) => (await prisma.field.findUniqueOrThrow({ where: { code } })).id;

  async function ensureForm(name: string, description: string, items: { f: string; parent?: string; values?: string[] }[]) {
    const ex = await prisma.form.findUnique({ where: { name } });
    if (ex) return ex.id;
    const form = await prisma.form.create({ data: { code: await genFormCode(prisma), name, description } });
    const ids: Record<string, number> = {};
    for (const [i, it] of items.entries())
      ids[it.f] = (
        await prisma.formItem.create({
          data: { formId: form.id, fieldId: await F(it.f), sortOrder: i + 1, parentItemId: it.parent ? ids[it.parent] : null, parentValues: JSON.stringify(it.values ?? []) },
        })
      ).id;
    return form.id;
  }
  const FM_SDT = await ensureForm('Mẫu cập nhật thông tin liên hệ', 'Cập nhật số điện thoại nhận OTP', [{ f: 'SDT_LIEN_HE' }, { f: 'SDT_MOI' }, { f: 'LY_DO_CAP_NHAT' }]);
  const FM_PIN = await ensureForm('Mẫu cấp lại PIN', 'Yêu cầu cấp lại PIN thẻ', [{ f: 'SO_THE' }, { f: 'HINH_THUC_PIN' }, { f: 'CN_NHAN', parent: 'HINH_THUC_PIN', values: ['GIAY'] }]);
  const FM_HM = await ensureForm('Mẫu điều chỉnh hạn mức', 'Đề nghị điều chỉnh hạn mức thẻ tín dụng', [{ f: 'SO_THE' }, { f: 'HAN_MUC_DE_NGHI' }, { f: 'THU_NHAP' }, { f: 'KENH_LIEN_HE' }]);
  const FM_GOI = (await prisma.form.findUniqueOrThrow({ where: { name: 'Mẫu xác minh cuộc gọi' } })).id;

  type R = { name: string; code?: string; route?: 'NEXT' | 'GOTO' | 'END'; goto?: string; children?: R[] };
  type S = { ref: string; name: string; sla: [number, number, number]; dept: string; form?: number; expected?: string; results: R[] };
  async function ensureWorkflow(code: string, name: string, mode: 'OFFICE' | 'H24', description: string, steps: S[]) {
    const ex = await prisma.workflow.findUnique({ where: { code } });
    if (ex) return ex.id;
    const wf = await prisma.workflow.create({ data: { code, name, workHoursMode: mode, description } });
    const keys = Object.fromEntries(steps.map((s) => [s.ref, randomUUID()]));
    for (const [i, s] of steps.entries()) {
      const step = await prisma.workflowStep.create({
        data: {
          key: keys[s.ref], workflowId: wf.id, sortOrder: i + 1, name: s.name, slaDays: s.sla[0], slaHours: s.sla[1], slaMinutes: s.sla[2],
          departmentId: await dept(s.dept), formId: s.form ?? null, expectedResult: s.expected ?? null,
        },
      });
      let order = 1;
      const add = async (list: R[], parentKey: string | null) => {
        for (const r of list) {
          const key = randomUUID();
          await prisma.stepResult.create({
            data: { key, stepId: step.id, parentKey, code: r.code ?? `KQ${order}`, name: r.name, sortOrder: order++, routeType: r.children ? 'NEXT' : r.route ?? 'NEXT', gotoStepKey: r.goto ? keys[r.goto] : null },
          });
          if (r.children) await add(r.children, key);
        }
      };
      await add(s.results, null);
    }
    return wf.id;
  }
  const WF_SDT = await ensureWorkflow('QT_CAP_NHAT_TT', 'Cập nhật thông tin liên hệ', 'OFFICE', 'Xác thực khách hàng và cập nhật trên hệ thống lõi', [
    { ref: 'S1', name: 'Xác thực khách hàng', sla: [0, 2, 0], dept: 'CSKH.TD', form: FM_GOI, results: [{ name: 'Xác thực thành công' }, { name: 'Xác thực thất bại', route: 'END' }] },
    { ref: 'S2', name: 'Cập nhật trên hệ thống lõi', sla: [0, 4, 0], dept: 'TTTT.HT', results: [{ name: 'Đã cập nhật' }] },
  ]);
  const WF_PIN = await ensureWorkflow('QT_PIN', 'Cấp lại PIN thẻ', 'OFFICE', 'Tiếp nhận và phát hành PIN mới', [
    { ref: 'S1', name: 'Tiếp nhận yêu cầu cấp PIN', sla: [0, 1, 0], dept: 'CSKH.TD', results: [{ name: 'Hợp lệ' }, { name: 'Không hợp lệ', route: 'END' }] },
    { ref: 'S2', name: 'Phát hành PIN', sla: [1, 0, 0], dept: 'TTT.PH', results: [{ name: 'Đã gửi PIN qua SMS' }, { name: 'Đã in PIN giấy, chuyển chi nhánh' }] },
  ]);
  const WF_HM = await ensureWorkflow('QT_HAN_MUC', 'Điều chỉnh hạn mức thẻ tín dụng', 'OFFICE', 'Thẩm định – phê duyệt – thông báo', [
    {
      ref: 'S1', name: 'Thẩm định hồ sơ', sla: [1, 0, 0], dept: 'CSKH.XL', expected: 'Đánh giá đủ điều kiện điều chỉnh hạn mức',
      results: [{ name: 'Đủ điều kiện' }, { name: 'Không đủ điều kiện', children: [{ name: 'Thu nhập không đạt', route: 'GOTO', goto: 'S3' }, { name: 'Lịch sử tín dụng xấu', route: 'GOTO', goto: 'S3' }] }],
    },
    { ref: 'S2', name: 'Phê duyệt hạn mức', sla: [1, 0, 0], dept: 'TTT.PH', results: [{ name: 'Phê duyệt' }, { name: 'Từ chối' }] },
    { ref: 'S3', name: 'Thông báo kết quả cho khách hàng', sla: [0, 4, 0], dept: 'CSKH.TD', form: FM_GOI, results: [{ name: 'Đã thông báo' }] },
  ]);

  async function ensureService(prod: string, op: string, formId: number | null, mode: 'OFFICE' | 'H24', wfs: Record<string, number>) {
    const product = await prisma.product.findUniqueOrThrow({ where: { code: prod } });
    const operation = await prisma.operation.findUniqueOrThrow({ where: { code: op } });
    const ex = await prisma.service.findUnique({ where: { productId_operationId: { productId: product.id, operationId: operation.id } } });
    if (ex) return;
    await prisma.service.create({
      data: {
        code: `${product.code}-${operation.code}`, productId: product.id, operationId: operation.id, formId, workHoursMode: mode,
        segmentMode: wfs.ALL ? 'ALL' : 'BY_SEGMENT',
        workflows: { create: Object.entries(wfs).map(([segment, workflowId]) => ({ segment, workflowId })) },
      },
    });
  }
  await ensureService('TK.TT.CN', 'TD.SDT', FM_SDT, 'OFFICE', { ALL: WF_SDT });
  await ensureService('THE.GN.ND', 'YC.PIN', FM_PIN, 'OFFICE', { ALL: WF_PIN });
  await ensureService('THE.TD.VISA', 'YC.PIN', FM_PIN, 'OFFICE', { ALL: WF_PIN });
  await ensureService('THE.TD.VISA', 'TD.HM', FM_HM, 'OFFICE', { ALL: WF_HM });

  // ═════ 4. Phiếu demo ═════
  if ((await prisma.setting.findUnique({ where: { key: 'demoFilled' } })) && !force) {
    console.log('Phiếu demo đã được sinh trước đó – bỏ qua (dùng --force để sinh thêm).');
    return;
  }
  const cal = await getCalendar();
  const services = await prisma.service.findMany({ where: { active: true }, include: { product: true, operation: true } });
  const customers = await prisma.customer.findMany({ include: { accounts: true, cards: true, transactions: true } });
  const branches = await prisma.branch.findMany({ include: { rms: true } });
  const provinces = await prisma.province.findMany({ include: { wards: true } });
  const frontOffice = ['cs.lan', 'cs.minh', 'cs.ha', 'cs.quang', 'xl.hoa', 'xl.tuan', 'xl.mai'].map(U).filter(Boolean);

  const weights: Record<string, number> = {
    'THE.TD.VISA-KN.GD.TS': 8, 'THE.GN.ND-KN.GD.TS': 6, 'THE.GN.QT-KN.GD.TS': 2, 'THE.TD.VISA-YC.KHOA': 3, 'THE.GN.ND-YC.KHOA': 3,
    'THE.TD.VISA-YC.PHL': 3, 'NHDT.APP-KN.CL': 4, 'TK.TT.CN-TD.SDT': 4, 'THE.GN.ND-YC.PIN': 3, 'THE.TD.VISA-YC.PIN': 2, 'THE.TD.VISA-TD.HM': 3,
  };
  const pool = services.flatMap((s) => Array(weights[s.code] ?? 1).fill(s));

  const DESC: Record<string, string[]> = {
    'KN.GD.TS': [
      'Khách hàng phản ánh bị trừ tiền 2 lần khi thanh toán POS.',
      'Rút tiền ATM không nhận được tiền nhưng tài khoản bị trừ.',
      'Phát sinh giao dịch trực tuyến lạ, khách hàng khẳng định không thực hiện.',
      'Giao dịch thanh toán quốc tế bị treo, chưa được hoàn tiền sau 7 ngày.',
      'Khách hàng hủy đặt phòng nhưng chưa nhận lại tiền hoàn từ merchant.',
    ],
    'YC.KHOA': ['Khách hàng báo mất thẻ, yêu cầu khóa khẩn cấp.', 'Nghi ngờ lộ thông tin thẻ sau khi mua hàng trực tuyến.', 'Khách hàng bị mất ví, yêu cầu khóa toàn bộ thẻ.'],
    'YC.PHL': ['Thẻ bị gãy, hỏng chip – đề nghị phát hành lại.', 'Thẻ sắp hết hạn, khách hàng đề nghị phát hành lại sớm.', 'Phát hành lại thẻ sau khi đã khóa do mất thẻ.'],
    'KN.CL': ['Ứng dụng báo lỗi khi đăng nhập bằng sinh trắc học.', 'Không nhận được OTP khi chuyển khoản.', 'Ứng dụng bị treo ở màn hình xác nhận chuyển tiền.', 'Không tải được sao kê trên ứng dụng.'],
    'TD.SDT': ['Khách hàng đổi số điện thoại, đề nghị cập nhật số nhận OTP.', 'Mất SIM, cần cập nhật số mới để nhận OTP.'],
    'YC.PIN': ['Khách hàng quên PIN, đề nghị cấp lại.', 'Nhập sai PIN quá 3 lần, đề nghị cấp PIN mới.'],
    'TD.HM': ['Đề nghị nâng hạn mức thẻ tín dụng lên 100 triệu đồng.', 'Đề nghị tăng hạn mức tạm thời để đi du lịch nước ngoài.', 'Doanh nghiệp đề nghị tăng hạn mức thẻ chi tiêu cho lãnh đạo.'],
  };
  const NOTES = [
    'Đã kiểm tra và xử lý theo quy định.',
    'Đã liên hệ khách hàng xác nhận thông tin.',
    'Đã đối chiếu dữ liệu trên hệ thống, thông tin khớp.',
    'Hoàn tất xử lý, chuyển bước tiếp theo.',
    'Đã gửi email xác nhận cho khách hàng.',
  ];
  const RETURN_NOTES = ['Thiếu chứng từ, đề nghị bổ sung sao kê giao dịch.', 'Thông tin số thẻ không khớp, đề nghị kiểm tra lại.', 'Chưa đủ căn cứ xử lý, cần xác minh thêm với khách hàng.'];

  function genOne(it: FormItemDef, c: (typeof customers)[number] | null): any {
    if (it.infoType === 'VIEW360') {
      switch (it.view360Source) {
        case 'ACCOUNT_NO': return c?.accounts[0]?.accountNo ?? `0${randint(1000000000, 1999999999)}`;
        case 'CARD_NO': return c ? pick(c.cards).cardNo : `9704 22•• •••• ${randint(1000, 9999)}`;
        case 'TRANSACTION': return c ? pick(c.transactions).refNo : `FT26${randint(10000000, 99999999)}`;
        case 'CUSTOMER_PHONE': return c?.phone ?? `09${randint(10000000, 99999999)}`;
        case 'CUSTOMER_EMAIL': return c?.email ?? '';
        case 'CUSTOMER_ID_NUMBER': return c?.idNumber ?? '';
        default: return c?.address ?? '';
      }
    }
    switch (it.dataType) {
      case 'TEXT':
        if (it.code === 'SDT_MOI') return `09${randint(10000000, 99999999)}`;
        if (it.code === 'MO_TA_KHAC') return 'Giao dịch hiển thị thành công nhưng merchant báo chưa nhận được tiền.';
        if (it.code === 'GHI_CHU_NB') return pick(NOTES);
        return 'Thông tin bổ sung từ khách hàng';
      case 'NUMBER':
        if (it.code === 'HAN_MUC_DE_NGHI') return randint(5, 30) * 10_000_000;
        if (it.code === 'THU_NHAP') return randint(15, 90) * 1_000_000;
        return c?.transactions.length ? pick(c.transactions).amount : randint(5, 500) * 10_000;
      case 'DATE':
        return new Date(clock.now().getTime() - randint(1, 20) * DAY).toISOString().slice(0, 10);
      case 'SINGLE_CHOICE':
      case 'CALL_RESULT':
        return pick(optionsOf(it)).value;
      case 'MULTI_CHOICE':
        return optionsOf(it).filter(() => chance(0.5)).map((o) => o.value).concat(optionsOf(it)[0].value).filter((v, i, a) => a.indexOf(v) === i);
      case 'BOOLEAN':
        return chance(0.5);
      case 'BRANCH_RM': {
        const b = pick(branches);
        return { branchId: b.id, rmId: pick(b.rms).id };
      }
      case 'ADMIN_UNIT': {
        const p = pick(provinces);
        return { provinceId: p.id, wardId: pick(p.wards).id, address: `Số ${randint(1, 200)} đường ${pick(['Lê Lợi', 'Trần Hưng Đạo', 'Nguyễn Trãi', 'Hai Bà Trưng', 'Lý Thường Kiệt'])}` };
      }
      default:
        return null;
    }
  }
  function genValues(items: FormItemDef[], c: (typeof customers)[number] | null, ticketOnly: boolean) {
    const v: Record<string, any> = {};
    for (let pass = 0; pass < 4; pass++) for (const it of visibleItems(items, v, { ticketOnly })) if (v[it.code] === undefined) v[it.code] = genOne(it, c);
    return pruneValues(items, v, { ticketOnly });
  }

  const at = (ms: number) => {
    clock.now = () => new Date(ms);
  };
  const work = (mode: WorkHoursMode, from: number, minutes: number) => addDuration(mode, cal as WorkCalendar, from, Math.max(1, Math.round(minutes)));
  const colleagueOf = (userId: number) => {
    const u = users.find((x) => x.id === userId);
    const list = users.filter((x) => x.departmentId === u?.departmentId && x.id !== userId && x.active);
    return list.length ? pick(list) : null;
  };

  async function createTicket(t0: number, svc: (typeof services)[number], c: (typeof customers)[number] | null, creator: (typeof users)[number], owner: (typeof users)[number], linked: number[]) {
    at(t0);
    const cfg = await resolveServiceConfig(prisma, svc.productId, svc.operationId, c?.segment);
    const mode = cfg.service.workHoursMode as WorkHoursMode;
    const dyn = genValues(cfg.form?.items ?? [], c, true);
    return prisma.$transaction(
      async (tx) => {
        const status = creator.id === owner.id ? 'IN_PROGRESS' : 'NEW';
        const ticket = await tx.ticket.create({
          data: {
            code: await genTicketCode(tx),
            channel: pick(['COUNTER', 'HOTLINE', 'HOTLINE', 'APP', 'EMAIL', 'SOCIAL']),
            status,
            productId: svc.productId,
            operationId: svc.operationId,
            serviceId: cfg.service.id,
            customerId: c?.id ?? null,
            segment: c?.segment ?? null,
            ownerId: owner.id,
            creatorId: creator.id,
            description: pick(DESC[svc.operation.code] ?? ['Khách hàng có yêu cầu cần xử lý.']),
            linkedTicketIds: JSON.stringify(linked),
            workHoursMode: mode,
            slaMinutes: cfg.slaMinutes,
            slaStartAt: new Date(t0),
            dueAt: new Date(addDuration(mode, cal, t0, cfg.slaMinutes)),
            configSnapshot: JSON.stringify(cfg.snapshot),
            dynamicValues: JSON.stringify(dyn),
            createdAt: new Date(t0),
          },
        });
        await logHistory(tx, {
          entityType: 'TICKET', entityId: ticket.id, actor: actor(creator), action: 'CREATE',
          summary: `Tạo phiếu – dịch vụ ${cfg.service.code}, quy trình "${cfg.workflow.name}"`,
          changes: [
            { field: 'status', label: 'Trạng thái', oldValue: null, newValue: status === 'NEW' ? 'Mới' : 'Đang xử lý' },
            { field: 'ownerId', label: 'Người phụ trách', oldValue: null, newValue: owner.fullName },
          ],
        });
        if (owner.id !== creator.id) await notify(tx, owner.id, `Phiếu mới ${ticket.code}`, `${creator.fullName} đã tạo phiếu và giao bạn phụ trách`, `/tickets/${ticket.id}`);
        const steps = await instantiateSteps(tx, ticket.id, 1, cfg.workflow);
        await autoGenerate(tx, ticket.id, steps[0].id, cal);
        return ticket;
      },
      { timeout: 60000 },
    );
  }

  async function taskAction(task: Task, who: (typeof users)[number], data: any, action: string, summary: string, changes: any[]) {
    await prisma.$transaction(async (tx) => {
      await tx.task.update({ where: { id: task.id }, data });
      await logHistory(tx, { entityType: 'TASK', entityId: task.id, actor: actor(who), action, summary, changes });
    });
  }

  async function finishTask(task: Task, who: (typeof users)[number], when: number, ticket: Ticket) {
    at(when);
    const step = await prisma.ticketStep.findUniqueOrThrow({ where: { id: task.ticketStepId } });
    const results = parseJson<ResultSnap[]>(step.resultsSnapshot, []);
    const leaves = resultLeaves(results);
    const res = chance(0.72) ? leaves[0] : pick(leaves);
    const form = parseJson<FormSnapshot | null>(step.formSnapshot, null);
    const cust = customers.find((c) => c.id === ticket.customerId) ?? null;
    const values = { ...parseJson<Record<string, any>>(task.dynamicValues, {}), ...genValues(form?.items ?? [], cust, false) };
    if (values.SO_TIEN_HOAN !== undefined) values.SO_TIEN_HOAN = parseJson<any>(ticket.dynamicValues, {}).SO_TIEN ?? values.SO_TIEN_HOAN;
    const note = pick(NOTES);
    await prisma.$transaction(
      async (tx) => {
        await tx.task.update({
          where: { id: task.id },
          data: { status: 'DONE', resultKey: res.key, resultLabel: resultPath(results, res.key), note, completedAt: new Date(when), dynamicValues: JSON.stringify(values) },
        });
        await logHistory(tx, {
          entityType: 'TASK', entityId: task.id, actor: actor(who), action: 'DONE', summary: 'Hoàn thành',
          changes: [
            { field: 'resultKey', label: 'Kết quả', oldValue: null, newValue: resultPath(results, res.key) },
            { field: 'note', label: 'Ghi chú xử lý', oldValue: task.note, newValue: note },
            { field: 'status', label: 'Trạng thái', oldValue: task.status === 'REPORTED_DONE' ? 'Báo hoàn thành' : 'Đang xử lý', newValue: 'Hoàn thành' },
          ],
        });
        await logHistory(tx, {
          entityType: 'TICKET', entityId: task.ticketId, actor: actor(who), action: 'TASK_DONE',
          summary: `Tác vụ ${task.code} (công việc "${step.name}") Hoàn thành – kết quả: ${resultPath(results, res.key)}`,
        });
        await evaluateStep(tx, step.id, cal);
      },
      { timeout: 60000 },
    );
  }

  async function changeService(ticket: Ticket, opCode: string, who: (typeof users)[number], when: number) {
    at(when);
    const op = await prisma.operation.findUniqueOrThrow({ where: { code: opCode } });
    const oldOp = await prisma.operation.findUniqueOrThrow({ where: { id: ticket.operationId } });
    const oldSnap = parseJson<TicketConfigSnapshot>(ticket.configSnapshot, null as any);
    const cfg = await resolveServiceConfig(prisma, ticket.productId, op.id, ticket.segment);
    const mode = cfg.service.workHoursMode as WorkHoursMode;
    const dueAt = new Date(addDuration(mode, cal, when, cfg.slaMinutes));
    const cust = customers.find((c) => c.id === ticket.customerId) ?? null;
    await prisma.$transaction(
      async (tx) => {
        await tx.ticketStep.updateMany({ where: { ticketId: ticket.id, generation: ticket.serviceVersion }, data: { status: 'CANCELLED' } });
        await tx.ticket.update({
          where: { id: ticket.id },
          data: {
            operationId: op.id, serviceId: cfg.service.id, workHoursMode: mode, slaMinutes: cfg.slaMinutes, slaStartAt: new Date(when), dueAt,
            configSnapshot: JSON.stringify(cfg.snapshot), serviceVersion: ticket.serviceVersion + 1, autoGenError: null,
            dynamicValues: JSON.stringify(genValues(cfg.form?.items ?? [], cust, true)),
            description: 'Khách hàng xác nhận mất thẻ trong quá trình tra soát – chuyển sang yêu cầu khóa thẻ.',
          },
        });
        await logHistory(tx, {
          entityType: 'TICKET', entityId: ticket.id, actor: actor(who), action: 'CHANGE_SERVICE',
          summary: 'Đổi dịch vụ của phiếu – các công việc thuộc dịch vụ cũ chuyển trạng thái Hủy',
          changes: [
            { field: 'operationId', label: 'Nghiệp vụ', oldValue: oldOp.name, newValue: op.name },
            { field: 'serviceId', label: 'Dịch vụ', oldValue: oldSnap?.service?.code ?? null, newValue: cfg.service.code },
            { field: 'workflow', label: 'Quy trình', oldValue: oldSnap?.workflow?.name ?? null, newValue: cfg.workflow.name },
            { field: 'dueAt', label: 'Thời hạn hoàn thành', oldValue: ticket.dueAt.toISOString(), newValue: dueAt.toISOString() },
          ],
        });
        const steps = await instantiateSteps(tx, ticket.id, ticket.serviceVersion + 1, cfg.workflow);
        await autoGenerate(tx, ticket.id, steps[0].id, cal);
      },
      { timeout: 60000 },
    );
    return prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
  }

  let changedService = 0;
  const COUNT = 60;
  const created: number[] = [];
  let doneCount = 0;
  for (let i = 0; i < COUNT; i++) {
    const svc = pick(pool);
    // Thời điểm tạo: rải 30 ngày, dày hơn ở những ngày gần đây
    const daysAgo = i < 12 ? randint(0, 2) : Math.floor(Math.pow(rand(), 1.4) * 30);
    const dayStartVN = Math.floor((REAL_NOW + 7 * 3600_000) / DAY) * DAY - 7 * 3600_000 - daysAgo * DAY;
    let t0 = dayStartVN + (8 * 60 + randint(0, 8 * 60 + 30)) * MIN;
    if (svc.workHoursMode === 'OFFICE') t0 = work('OFFICE', t0 - MIN, 1);
    if (t0 > REAL_NOW - 20 * MIN) t0 = REAL_NOW - randint(20, 240) * MIN;

    const cfgPreview = await prisma.service.findUniqueOrThrow({ where: { id: svc.id } });
    const needCustomer = cfgPreview.segmentMode === 'BY_SEGMENT' || chance(0.88);
    const cust = needCustomer ? pick(customers) : null;
    const creator = pick(frontOffice);
    const owner = chance(0.55) ? creator : pick(frontOffice);
    const linked = created.length && chance(0.1) ? [pick(created)] : [];
    let ticket = await createTicket(t0, svc, cust, creator, owner, linked);
    created.push(ticket.id);
    let mode = ticket.workHoursMode as WorkHoursMode;

    // Người phụ trách mở phiếu lần đầu
    const tOwnerOpen = work(mode, t0, randint(3, 60));
    if (ticket.status === 'NEW' && tOwnerOpen < REAL_NOW && chance(0.9)) {
      at(tOwnerOpen);
      await prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'IN_PROGRESS' } });
      await prisma.$transaction((tx) =>
        logHistory(tx, {
          entityType: 'TICKET', entityId: ticket.id, actor: actor(owner), action: 'STATUS', summary: 'Người phụ trách mở phiếu lần đầu',
          changes: [{ field: 'status', label: 'Trạng thái', oldValue: 'Mới', newValue: 'Đang xử lý' }],
        }),
      );
    }

    // Đổi dịch vụ (2 phiếu tra soát thẻ ghi nợ → khóa thẻ): công việc cũ chuyển Hủy
    if (changedService < 2 && svc.code === 'THE.GN.ND-KN.GD.TS') {
      const tChange = work(mode, t0, randint(40, 90));
      if (tChange < REAL_NOW) {
        changedService++;
        ticket = await changeService(ticket, 'YC.KHOA', owner, tChange);
        mode = ticket.workHoursMode as WorkHoursMode;
      }
    }

    // Mô phỏng xử lý tác vụ theo thời gian
    const stopEarly = chance(0.3); // phiếu sẽ dừng giữa chừng dù còn thời gian
    const lastT = new Map<number, number>();
    for (let iter = 0; iter < 14; iter++) {
      const open = await prisma.task.findMany({
        where: { ticketId: ticket.id, status: { not: 'DONE' }, step: { generation: ticket.serviceVersion, status: { not: 'CANCELLED' } } },
        orderBy: { createdAt: 'asc' },
      });
      if (!open.length) break;
      let progressed = false;
      for (const task of open) {
        const assignee = users.find((u) => u.id === task.assigneeId)!;
        const base = Math.max(task.createdAt.getTime(), lastT.get(task.id) ?? 0);
        const sla = task.slaMinutes;
        const tOpen = work(mode, base, sla * between(0.02, 0.15));
        if (tOpen >= REAL_NOW) continue;
        if (task.status === 'NEW') {
          at(tOpen);
          await taskAction(task, assignee, { status: 'IN_PROGRESS' }, 'OPEN', 'Người được phân giao mở tác vụ', [
            { field: 'status', label: 'Trạng thái', oldValue: 'Mới', newValue: 'Đang xử lý' },
          ]);
          task.status = 'IN_PROGRESS';
          lastT.set(task.id, tOpen);
          // Chuyển cho đồng nghiệp (→ Mới)
          const col = colleagueOf(assignee.id);
          if (col && chance(0.08)) {
            const tRe = work(mode, tOpen, randint(5, 40));
            if (tRe < REAL_NOW) {
              at(tRe);
              await taskAction(task, assignee, { assigneeId: col.id, departmentId: col.departmentId, status: 'NEW' }, 'UPDATE', 'Cập nhật', [
                { field: 'assigneeId', label: 'Nhân sự chuyên xử lý', oldValue: assignee.fullName, newValue: col.fullName },
                { field: 'status', label: 'Trạng thái', oldValue: 'Đang xử lý', newValue: 'Mới' },
              ]);
              await prisma.$transaction((tx) => notify(tx, col.id, `Tác vụ ${task.code}`, `Bạn được giao xử lý tác vụ của phiếu ${ticket.code}`, `/tickets/${ticket.id}?task=${task.id}`));
              lastT.set(task.id, tRe);
              progressed = true;
              continue;
            }
          }
          // Tạo thêm 1 tác vụ thủ công cho đồng nghiệp trên cùng công việc
          if (col && chance(0.12)) {
            at(work(mode, tOpen, randint(5, 30)));
            const step = await prisma.ticketStep.findUniqueOrThrow({ where: { id: task.ticketStepId } });
            const tk = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
            if (tk.status !== 'DONE')
              await prisma.$transaction((tx) =>
                createTask(tx, {
                  ticket: tk, step, departmentId: col.departmentId!, assigneeId: col.id, creator: actor(assignee),
                  description: 'Phối hợp kiểm tra thêm thông tin liên quan.', notifyChannels: ['EMAIL', 'APP'], dynamicValues: {}, cal,
                }),
              );
          }
        }
        const late = chance(0.2);
        const tDone = work(mode, base, sla * (late ? between(1.05, 1.9) : between(0.2, 0.95)));
        const holdOpen = tDone >= REAL_NOW || (stopEarly && chance(0.5));
        if (holdOpen) {
          // Để mở: một số tác vụ Trả lại xử lý / Báo hoàn thành
          const tMid = work(mode, Math.max(base, tOpen), sla * between(0.1, 0.5));
          if (tMid < REAL_NOW && task.status === 'IN_PROGRESS') {
            const step = await prisma.ticketStep.findUniqueOrThrow({ where: { id: task.ticketStepId } });
            const results = parseJson<ResultSnap[]>(step.resultsSnapshot, []);
            const leaf = resultLeaves(results)[0];
            if (chance(0.18)) {
              at(tMid);
              const note = pick(RETURN_NOTES);
              await taskAction(task, assignee, { status: 'RETURNED', resultKey: leaf.key, resultLabel: resultPath(results, leaf.key), note }, 'RETURN', 'Trả lại xử lý', [
                { field: 'resultKey', label: 'Kết quả', oldValue: null, newValue: resultPath(results, leaf.key) },
                { field: 'note', label: 'Ghi chú xử lý', oldValue: null, newValue: note },
                { field: 'status', label: 'Trạng thái', oldValue: 'Đang xử lý', newValue: 'Trả lại xử lý' },
              ]);
              await prisma.$transaction((tx) => notify(tx, ticket.ownerId, `Tác vụ ${task.code} – Trả lại xử lý`, `${assignee.fullName}: ${note}`, `/tickets/${ticket.id}?task=${task.id}`));
            } else if (chance(0.15)) {
              at(tMid);
              await taskAction(task, assignee, { status: 'REPORTED_DONE', resultKey: leaf.key, resultLabel: resultPath(results, leaf.key), note: 'Đã xử lý xong, chờ xác nhận.' }, 'REPORT_DONE', 'Báo hoàn thành', [
                { field: 'resultKey', label: 'Kết quả', oldValue: null, newValue: resultPath(results, leaf.key) },
                { field: 'status', label: 'Trạng thái', oldValue: 'Đang xử lý', newValue: 'Báo hoàn thành' },
              ]);
            } else if (chance(0.4)) {
              at(tMid);
              const note = 'Đang liên hệ đơn vị liên quan để xác minh.';
              await taskAction(task, assignee, { note }, 'UPDATE', 'Cập nhật', [{ field: 'note', label: 'Ghi chú xử lý', oldValue: null, newValue: note }]);
            }
          }
          continue;
        }
        const fresh = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
        const doer = users.find((u) => u.id === fresh.assigneeId)!;
        await finishTask(fresh, doer, Math.max(tDone, (lastT.get(task.id) ?? 0) + MIN), ticket);
        progressed = true;
      }
      ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      if (!progressed || ticket.status === 'DONE') break;
    }

    ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    if (ticket.status === 'DONE') {
      doneCount++;
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          resolutionSummary: pick(['Đã xử lý theo quy trình, khách hàng đồng ý với kết quả.', 'Đã hoàn tiền cho khách hàng và gửi thông báo.', 'Đã cập nhật thông tin và xác nhận với khách hàng qua điện thoại.']),
          exchangeContent: pick(['KH được thông báo kết quả qua tổng đài.', 'Đã gửi email phản hồi cho khách hàng.', null]),
        },
      });
    } else if (chance(0.08) && ticket.status === 'IN_PROGRESS') {
      // Người phụ trách chủ động chuyển "Trả lại xử lý"
      at(Math.min(REAL_NOW - MIN, work(mode, t0, 120)));
      await prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'RETURNED' } });
      await prisma.$transaction((tx) =>
        logHistory(tx, {
          entityType: 'TICKET', entityId: ticket.id, actor: actor(owner), action: 'STATUS', summary: 'Lý do: chờ khách hàng bổ sung hồ sơ',
          changes: [{ field: 'status', label: 'Trạng thái', oldValue: 'Đang xử lý', newValue: 'Trả lại xử lý' }],
        }),
      );
    }
    // Cảnh báo sinh tác vụ lỗi của phiếu cũ coi như đã được xem
    if (ticket.autoGenError && REAL_NOW - ticket.createdAt.getTime() > 2 * DAY) {
      const e = parseJson<any>(ticket.autoGenError, null);
      await prisma.ticket.update({ where: { id: ticket.id }, data: { autoGenError: JSON.stringify({ ...e, seen: true }) } });
    }
    process.stdout.write(`\r  Đã sinh ${i + 1}/${COUNT} phiếu`);
  }
  clock.now = () => new Date();

  // Thông báo cũ hơn 1 ngày coi như đã đọc
  await prisma.notification.updateMany({ where: { createdAt: { lt: new Date(REAL_NOW - DAY) } }, data: { read: true } });
  await prisma.setting.upsert({ where: { key: 'demoFilled' }, create: { key: 'demoFilled', value: new Date().toISOString() }, update: { value: new Date().toISOString() } });

  const byStatus = await prisma.ticket.groupBy({ by: ['status'], _count: { _all: true } });
  const taskByStatus = await prisma.task.groupBy({ by: ['status'], _count: { _all: true } });
  console.log(`\n✔ Đã sinh ${COUNT} phiếu demo (${doneCount} hoàn thành).`);
  console.log('  Phiếu theo trạng thái:', Object.fromEntries(byStatus.map((b) => [b.status, b._count._all])));
  console.log('  Tác vụ theo trạng thái:', Object.fromEntries(taskByStatus.map((b) => [b.status, b._count._all])));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

