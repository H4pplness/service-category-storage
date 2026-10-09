// Sinh dữ liệu giả lập: mỗi trang Confluence mô tả 1 Sản phẩm - Nghiệp vụ (SP-NV) và "khi nào nên chọn".
// Dữ liệu sinh tất định (cùng tham số → cùng nội dung/version) để kho tri thức đồng bộ ổn định giữa các lần khởi động.

export interface MockPage {
  id: string;
  title: string;
  parentId: string | null;
  ancestors: string[];
  labels: string[];
  version: number;
  lastModified: Date;
  author: string;
  storage: string;
}

interface ProductDef {
  code: string;
  name: string;
  group: string;
}

interface OperationDef {
  code: string;
  name: string;
  groups: string[]; // nhóm sản phẩm áp dụng
  dept: string;
  sla: string;
  channel: string;
  when: string[];
  notWhen: string[];
  docs: string[];
  note?: string;
}

const GROUPS = ['Thẻ', 'Tài khoản', 'Ngân hàng điện tử', 'Cho vay', 'Tiết kiệm', 'Bảo hiểm', 'Thanh toán & Chuyển tiền'];

const PRODUCTS: ProductDef[] = [
  { code: 'THE.TD.VISA', name: 'Thẻ tín dụng quốc tế Visa', group: 'Thẻ' },
  { code: 'THE.TD.JCB', name: 'Thẻ tín dụng quốc tế JCB', group: 'Thẻ' },
  { code: 'THE.GN.ND', name: 'Thẻ ghi nợ nội địa', group: 'Thẻ' },
  { code: 'THE.GN.QT', name: 'Thẻ ghi nợ quốc tế', group: 'Thẻ' },
  { code: 'TK.TT.CN', name: 'Tài khoản thanh toán cá nhân', group: 'Tài khoản' },
  { code: 'TK.TT.DN', name: 'Tài khoản thanh toán doanh nghiệp', group: 'Tài khoản' },
  { code: 'NHDT.APP', name: 'Ứng dụng Mobile Banking', group: 'Ngân hàng điện tử' },
  { code: 'NHDT.IB', name: 'Internet Banking doanh nghiệp', group: 'Ngân hàng điện tử' },
  { code: 'VAY.TC.TC', name: 'Vay tín chấp', group: 'Cho vay' },
  { code: 'VAY.TC.TS', name: 'Vay mua nhà có tài sản đảm bảo', group: 'Cho vay' },
  { code: 'TG.CKH', name: 'Tiết kiệm có kỳ hạn tại quầy', group: 'Tiết kiệm' },
  { code: 'TG.ONL', name: 'Tiết kiệm online', group: 'Tiết kiệm' },
  { code: 'BH.NT', name: 'Bảo hiểm nhân thọ liên kết ngân hàng', group: 'Bảo hiểm' },
  { code: 'TT.CTQT', name: 'Chuyển tiền quốc tế', group: 'Thanh toán & Chuyển tiền' },
  { code: 'TT.VI', name: 'Ví điện tử liên kết tài khoản', group: 'Thanh toán & Chuyển tiền' },
];

const CARD = ['Thẻ'];
const ALL = GROUPS;

const OPERATIONS: OperationDef[] = [
  {
    code: 'KN.GD.TS',
    name: 'Tra soát giao dịch',
    groups: ['Thẻ', 'Tài khoản', 'Ngân hàng điện tử', 'Thanh toán & Chuyển tiền'],
    dept: 'Phòng Tra soát thẻ',
    sla: '5 ngày làm việc',
    channel: 'Tổng đài, Quầy, Mobile Banking',
    when: [
      'Khách hàng **không nhận ra** một giao dịch trên {sp} (giao dịch lạ, nghi gian lận) và muốn ngân hàng kiểm tra.',
      'Giao dịch bị **trừ tiền nhưng đơn vị chấp nhận / người nhận báo chưa nhận được** tiền.',
      'Giao dịch bị **trừ tiền 2 lần** (trùng lặp) hoặc số tiền bị trừ khác số tiền thực tế.',
      'Rút tiền tại ATM nhưng **máy không nhả tiền** mà tài khoản vẫn bị trừ.',
    ],
    notWhen: [
      'Khách hàng chỉ muốn được trả lại tiền cho giao dịch đã được xác nhận lỗi → chọn **Yêu cầu hoàn tiền**.',
      'Khách hàng phàn nàn về thái độ phục vụ, thời gian chờ → chọn **Khiếu nại chất lượng dịch vụ**.',
    ],
    docs: ['Mã giao dịch / thời gian / số tiền', 'Số thẻ hoặc số tài khoản (che 6 số giữa)', 'Ảnh chụp màn hình, biên lai (nếu có)', 'Giấy đề nghị tra soát có chữ ký (với giao dịch quốc tế)'],
    note: 'Giao dịch quốc tế phải tra soát trong vòng **120 ngày** kể từ ngày giao dịch theo quy định của tổ chức thẻ.',
  },
  {
    code: 'KN.GD.HT',
    name: 'Yêu cầu hoàn tiền',
    groups: ['Thẻ', 'Tài khoản', 'Ngân hàng điện tử', 'Thanh toán & Chuyển tiền'],
    dept: 'Phòng Hoàn trả & Điều chỉnh',
    sla: '3 ngày làm việc',
    channel: 'Tổng đài, Quầy',
    when: [
      'Kết quả tra soát đã xác nhận lỗi thuộc ngân hàng/đơn vị chấp nhận và khách hàng cần được **hoàn lại tiền** vào {sp}.',
      'Khách hàng bị **thu phí sai** (phí thường niên, phí chuyển đổi ngoại tệ, phí SMS...) và yêu cầu hoàn phí.',
      'Đơn vị bán hàng đã đồng ý hủy giao dịch nhưng sau 15 ngày tiền chưa về {sp}.',
    ],
    notWhen: ['Chưa xác định được giao dịch có lỗi hay không → chọn **Tra soát giao dịch** trước.'],
    docs: ['Mã phiếu tra soát trước đó (nếu có)', 'Thông tin giao dịch / khoản phí cần hoàn', 'Xác nhận hủy giao dịch của đơn vị bán hàng (nếu có)'],
  },
  {
    code: 'KN.CL',
    name: 'Khiếu nại chất lượng dịch vụ',
    groups: ALL,
    dept: 'Phòng Xử lý khiếu nại',
    sla: '2 ngày làm việc',
    channel: 'Tổng đài, Quầy, Email',
    when: [
      'Khách hàng **không hài lòng** về thái độ nhân viên, thời gian chờ đợi, hoặc quy trình phục vụ liên quan đến {sp}.',
      'Khách hàng phản ánh **ứng dụng/hệ thống chậm, lỗi giao diện** nhưng không phát sinh sai lệch tiền.',
      'Khách hàng góp ý, đề xuất cải tiến sản phẩm {sp}.',
    ],
    notWhen: ['Có phát sinh sai lệch tiền → chọn **Tra soát giao dịch**.'],
    docs: ['Mô tả sự việc, thời gian, địa điểm', 'Tên nhân viên / chi nhánh liên quan (nếu có)'],
  },
  {
    code: 'YC.KHOA',
    name: 'Khóa thẻ / tài khoản',
    groups: ['Thẻ', 'Tài khoản', 'Ngân hàng điện tử'],
    dept: 'Phòng Tra soát thẻ',
    sla: '30 phút (24/7)',
    channel: 'Tổng đài 24/7, Mobile Banking',
    when: [
      'Khách hàng báo **mất, thất lạc hoặc bị đánh cắp** {sp} hoặc điện thoại cài ứng dụng ngân hàng.',
      'Khách hàng nghi ngờ **lộ thông tin** (số thẻ, CVV, mật khẩu, OTP) hoặc vừa bị lừa đảo cung cấp OTP.',
      'Khách hàng chủ động yêu cầu **tạm khóa** {sp} khi không sử dụng trong thời gian dài.',
    ],
    notWhen: [
      'Thẻ bị máy ATM nuốt → chọn **Phát hành lại thẻ** (nếu khách không nhận lại được thẻ).',
      'Khách chỉ quên PIN, thẻ vẫn còn → chọn **Cấp lại PIN**.',
    ],
    docs: ['Xác thực chủ thẻ/chủ tài khoản qua bộ câu hỏi bảo mật', 'Thời điểm phát hiện mất/lộ thông tin'],
    note: 'Đây là nghiệp vụ **khẩn cấp**: xử lý 24/7, SLA 30 phút kể cả ngày nghỉ.',
  },
  {
    code: 'YC.MO',
    name: 'Mở khóa thẻ / tài khoản',
    groups: ['Thẻ', 'Tài khoản', 'Ngân hàng điện tử'],
    dept: 'Phòng Tra soát thẻ',
    sla: '4 giờ làm việc',
    channel: 'Tổng đài, Quầy',
    when: [
      'Khách hàng đã tìm lại được {sp} sau khi báo khóa và muốn **mở khóa** để dùng tiếp.',
      '{sp} bị khóa do **nhập sai PIN/mật khẩu quá số lần** quy định.',
      'Tài khoản bị tạm khóa do nghi ngờ gian lận và khách hàng đã xác minh chính chủ.',
    ],
    notWhen: ['Thẻ đã khóa vĩnh viễn do mất/lộ thông tin → chọn **Phát hành lại thẻ**.'],
    docs: ['Xác thực chính chủ (CCCD/sinh trắc học)', 'Lý do bị khóa (nếu khách hàng biết)'],
  },
  {
    code: 'YC.PIN',
    name: 'Cấp lại PIN',
    groups: CARD,
    dept: 'Phòng Phát hành thẻ',
    sla: '1 ngày làm việc',
    channel: 'Quầy, Mobile Banking',
    when: ['Khách hàng **quên mã PIN** của {sp}.', 'Khách hàng nghi ngờ người khác biết PIN nhưng thẻ vẫn trong tay.', 'PIN giấy bị thất lạc trước khi kích hoạt thẻ.'],
    notWhen: ['Thẻ bị mất → chọn **Khóa thẻ / tài khoản** rồi **Phát hành lại thẻ**.'],
    docs: ['Thẻ còn hiệu lực', 'CCCD của chủ thẻ'],
  },
  {
    code: 'YC.PHL',
    name: 'Phát hành lại thẻ',
    groups: CARD,
    dept: 'Phòng Phát hành thẻ',
    sla: '5 ngày làm việc',
    channel: 'Quầy, Mobile Banking',
    when: [
      '{sp} bị **mất, hỏng chip, gãy, mờ số** hoặc bị ATM nuốt mà không nhận lại được.',
      'Thẻ đã bị khóa vĩnh viễn do lộ thông tin và khách hàng cần thẻ mới.',
      'Khách hàng muốn **đổi sang thẻ chip/thẻ phi vật lý** hoặc đổi thiết kế thẻ.',
    ],
    notWhen: ['Thẻ sắp hết hạn → hệ thống tự gia hạn, không cần tạo phiếu.'],
    docs: ['CCCD', 'Thẻ cũ (nếu còn)', 'Phí phát hành lại theo biểu phí hiện hành'],
  },
  {
    code: 'TD.SDT',
    name: 'Cập nhật số điện thoại',
    groups: ALL,
    dept: 'Phòng Tổng đài',
    sla: '4 giờ làm việc',
    channel: 'Quầy, Mobile Banking (eKYC)',
    when: [
      'Khách hàng **đổi số điện thoại** và cần nhận OTP/SMS biến động số dư của {sp} về số mới.',
      'Khách hàng **không nhận được OTP** do số điện thoại đăng ký đã bị thu hồi.',
    ],
    notWhen: ['Khách hàng chỉ đổi email/địa chỉ → dùng chức năng tự phục vụ trên ứng dụng, không cần phiếu.'],
    docs: ['CCCD gắn chip', 'Số điện thoại mới chính chủ (đối chiếu thông tin nhà mạng)'],
  },
  {
    code: 'TD.HM',
    name: 'Điều chỉnh hạn mức',
    groups: ['Thẻ', 'Ngân hàng điện tử', 'Cho vay'],
    dept: 'Phòng Hoàn trả & Điều chỉnh',
    sla: '2 ngày làm việc',
    channel: 'Quầy, Tổng đài, Mobile Banking',
    when: [
      'Khách hàng muốn **tăng/giảm hạn mức** chi tiêu, rút tiền hoặc chuyển khoản trong ngày của {sp}.',
      'Khách hàng cần **tăng hạn mức tạm thời** cho một giao dịch lớn (du lịch, mua sắm, học phí).',
    ],
    notWhen: ['Hạn mức chưa đủ do thẻ bị khóa → chọn **Mở khóa thẻ / tài khoản**.'],
    docs: ['Chứng từ chứng minh thu nhập (khi tăng hạn mức tín dụng)', 'Mức hạn mức mong muốn và thời hạn'],
  },
  {
    code: 'TG.TT',
    name: 'Tất toán trước hạn',
    groups: ['Tiết kiệm', 'Cho vay'],
    dept: 'Phòng Hoàn trả & Điều chỉnh',
    sla: '1 ngày làm việc',
    channel: 'Quầy, Mobile Banking',
    when: [
      'Khách hàng cần **rút toàn bộ trước ngày đáo hạn** đối với {sp}.',
      'Khách hàng muốn tất toán để chuyển sang sản phẩm có lãi suất tốt hơn.',
    ],
    notWhen: ['Đến ngày đáo hạn → hệ thống tự tất toán/tái tục theo đăng ký.'],
    docs: ['Sổ/hợp đồng', 'CCCD', 'Lưu ý khách hàng về lãi suất không kỳ hạn/phí trả nợ trước hạn'],
  },
  {
    code: 'VAY.CCN',
    name: 'Cơ cấu lại thời hạn trả nợ',
    groups: ['Cho vay', 'Thẻ'],
    dept: 'Phòng Xử lý khiếu nại',
    sla: '5 ngày làm việc',
    channel: 'Quầy, RM',
    when: [
      'Khách hàng gặp **khó khăn tài chính** (mất việc, ốm đau, thiên tai) không trả được nợ đúng hạn của {sp}.',
      'Khách hàng đề nghị **giãn, hoãn** kỳ trả nợ hoặc chuyển sang trả góp.',
    ],
    notWhen: ['Khách hàng chỉ hỏi số tiền phải trả kỳ này → tra cứu trực tiếp, không cần phiếu.'],
    docs: ['Đơn đề nghị cơ cấu nợ', 'Chứng từ chứng minh khó khăn tài chính'],
  },
  {
    code: 'NH.MK',
    name: 'Cấp lại mật khẩu đăng nhập',
    groups: ['Ngân hàng điện tử'],
    dept: 'Phòng Ứng dụng ngân hàng số',
    sla: '2 giờ làm việc',
    channel: 'Tổng đài, Quầy',
    when: [
      'Khách hàng **quên mật khẩu** đăng nhập {sp} và không tự đặt lại được bằng OTP.',
      'Tài khoản đăng nhập bị **khóa do nhập sai mật khẩu** nhiều lần.',
    ],
    notWhen: ['Khách hàng nghi bị chiếm quyền tài khoản → chọn **Khóa thẻ / tài khoản** trước.'],
    docs: ['Xác thực chính chủ', 'Tên đăng nhập'],
  },
  {
    code: 'BH.HUY',
    name: 'Hủy hợp đồng trong thời gian cân nhắc',
    groups: ['Bảo hiểm'],
    dept: 'Phòng Xử lý khiếu nại',
    sla: '5 ngày làm việc',
    channel: 'Quầy, Tổng đài',
    when: [
      'Khách hàng muốn **hủy hợp đồng** {sp} trong **21 ngày cân nhắc** kể từ khi nhận hợp đồng.',
      'Khách hàng phản ánh bị **ép mua bảo hiểm** khi vay vốn/mở thẻ.',
    ],
    notWhen: ['Quá 21 ngày → hướng dẫn khách liên hệ công ty bảo hiểm để hủy theo điều khoản hợp đồng.'],
    docs: ['Hợp đồng bảo hiểm', 'Đơn yêu cầu hủy', 'CCCD'],
  },
];

const TIERS = ['Classic', 'Gold', 'Platinum', 'Signature', 'Infinite', 'dành cho khách hàng Priority', 'dành cho khách hàng SME', 'gói sinh viên', 'gói lương', 'gói Private'];
const AUTHORS = ['Nguyễn Thu Trang', 'Lê Hoàng Phúc', 'Phạm Minh Châu', 'Trần Quốc Bảo'];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const md = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function storageFor(p: ProductDef & { tier?: string }, op: OperationDef): string {
  const sp = p.tier ? `${p.name} ${p.tier}` : p.name;
  const li = (items: string[]) => '<ul>' + items.map((i) => `<li>${md(i.replace(/\{sp\}/g, sp))}</li>`).join('') + '</ul>';
  return [
    `<ac:structured-macro ac:name="details" ac:schema-version="1"><ac:rich-text-body><table><tbody>`,
    `<tr><th>Mã sản phẩm</th><td>${p.code}${p.tier ? '.' + slug(p.tier).toUpperCase().replace(/-/g, '') : ''}</td></tr>`,
    `<tr><th>Sản phẩm</th><td>${esc(sp)}</td></tr>`,
    `<tr><th>Mã nghiệp vụ</th><td>${op.code}</td></tr>`,
    `<tr><th>Nghiệp vụ</th><td>${esc(op.name)}</td></tr>`,
    `<tr><th>Phòng xử lý</th><td>${esc(op.dept)}</td></tr>`,
    `<tr><th>SLA tham chiếu</th><td>${esc(op.sla)}</td></tr>`,
    `<tr><th>Kênh tiếp nhận</th><td>${esc(op.channel)}</td></tr>`,
    `</tbody></table></ac:rich-text-body></ac:structured-macro>`,
    `<ac:structured-macro ac:name="toc"><ac:parameter ac:name="maxLevel">2</ac:parameter></ac:structured-macro>`,
    `<h2>Khi nào nên chọn</h2>`,
    `<p>Chọn <strong>${esc(sp)} – ${esc(op.name)}</strong> khi:</p>`,
    li(op.when),
    `<h2>Không áp dụng khi</h2>`,
    li(op.notWhen),
    `<h2>Thông tin, hồ sơ cần thu thập</h2>`,
    `<ol>${op.docs.map((d) => `<li>${md(d)}</li>`).join('')}</ol>`,
    op.note
      ? `<ac:structured-macro ac:name="note"><ac:parameter ac:name="title">Lưu ý</ac:parameter><ac:rich-text-body><p>${md(op.note)}</p></ac:rich-text-body></ac:structured-macro>`
      : '',
    `<h2>Quy trình xử lý tóm tắt</h2>`,
    `<p>Phiếu được chuyển tới <strong>${esc(op.dept)}</strong>. SLA tham chiếu: ${esc(op.sla)}. Chi tiết các bước xem tại cấu hình Dịch vụ trên DCMS.</p>`,
  ].join('');
}

export interface MockData {
  spaceKey: string;
  spaceName: string;
  pages: Map<string, MockPage>;
}

/** Sinh ~targetCount trang SP-NV (tối thiểu bằng số tổ hợp sản phẩm × nghiệp vụ gốc) */
export function generateMockData(spaceKey = 'SPNV', targetCount = 0, now = new Date()): MockData {
  const rand = rng(20261009);
  const pages = new Map<string, MockPage>();
  const day = 86_400_000;
  let nextId = 100100;
  const add = (p: Omit<MockPage, 'id' | 'version' | 'lastModified' | 'author'>, idOverride?: string) => {
    const id = idOverride ?? String(nextId++);
    const page: MockPage = {
      id,
      version: 1 + Math.floor(rand() * 6),
      lastModified: new Date(now.getTime() - Math.floor(rand() * 90 * day) - 2 * day),
      author: AUTHORS[Math.floor(rand() * AUTHORS.length)],
      ...p,
    };
    pages.set(id, page);
    return page;
  };

  const home = add(
    {
      title: 'Sổ tay chọn Sản phẩm - Nghiệp vụ',
      parentId: null,
      ancestors: [],
      labels: [],
      storage: '<p>Trang chủ sổ tay hướng dẫn chọn Sản phẩm - Nghiệp vụ khi tạo phiếu trên DCMS.</p>',
    },
    '100000',
  );
  const groupPages = new Map<string, MockPage>();
  GROUPS.forEach((g, i) =>
    groupPages.set(
      g,
      add(
        {
          title: `[Mục lục] ${g}`,
          parentId: home.id,
          ancestors: [home.id],
          labels: ['muc-luc'],
          storage: `<p>Danh sách SP-NV nhóm ${esc(g)}.</p><ac:structured-macro ac:name="children" />`,
        },
        String(100001 + i),
      ),
    ),
  );

  const combos: [ProductDef & { tier?: string }, OperationDef][] = [];
  for (const p of PRODUCTS) for (const op of OPERATIONS) if (op.groups.includes(p.group)) combos.push([p, op]);
  const base = combos.length;
  // Mở rộng theo hạng/gói sản phẩm để đạt số lượng mong muốn (kiểm thử quy mô 10.000 trang)
  for (let k = 0; combos.length < targetCount; k++) {
    const [p, op] = combos[k % base];
    const round = Math.floor(k / base);
    const tier = round < TIERS.length ? TIERS[round] : `gói ưu đãi ${String(round - TIERS.length + 1).padStart(3, '0')}`;
    combos.push([{ ...p, tier }, op]);
  }

  for (const [p, op] of combos) {
    const group = groupPages.get(p.group)!;
    const sp = p.tier ? `${p.name} ${p.tier}` : p.name;
    add({
      title: `${sp} – ${op.name}`,
      parentId: group.id,
      ancestors: [home.id, group.id],
      labels: ['sp-nv', slug(p.group), slug(op.name)],
      storage: storageFor(p, op),
    });
  }
  return { spaceKey, spaceName: 'Sổ tay Sản phẩm - Nghiệp vụ', pages };
}
