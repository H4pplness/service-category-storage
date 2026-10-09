// Danh mục dữ liệu mẫu Sản phẩm - Nghiệp vụ (SP-NV) để đẩy lên Confluence thử nghiệm.
// Nhóm/loại sản phẩm tham khảo danh mục sản phẩm cá nhân công khai của các ngân hàng Việt Nam
// (Vietcombank, Techcombank – tháng 10/2026), đặt tên chung, không gắn thương hiệu. Nội dung là dữ liệu mẫu.

export interface Product {
  code: string;
  name: string;
  group: string;
  ops: string[]; // mã nghiệp vụ áp dụng
  note?: string; // đặc điểm sản phẩm, đưa vào mô tả
}

export interface Operation {
  code: string;
  name: string;
  dept: string;
  sla: string;
  channel: string;
  when: string[];
  notWhen: string[];
  docs: string[];
  note?: string;
}

export const GROUPS = ['Thẻ', 'Tài khoản', 'Tiết kiệm & Tiền gửi', 'Cho vay', 'Ngân hàng số', 'Bảo hiểm', 'Chuyển tiền & Dịch vụ khác'];

export const PRODUCTS: Product[] = [
  // ───── Thẻ ─────
  { code: 'THE.TD.VISA', name: 'Thẻ tín dụng quốc tế Visa', group: 'Thẻ', ops: ['KN.GD.TS', 'KN.GD.HT', 'YC.KHOA', 'YC.PIN', 'YC.PHL', 'TD.HM', 'THE.TG'], note: 'thẻ tín dụng quốc tế, chi tiêu trước trả sau, miễn lãi tối đa 55 ngày' },
  { code: 'THE.TD.MC', name: 'Thẻ tín dụng quốc tế Mastercard', group: 'Thẻ', ops: ['KN.GD.TS', 'KN.GD.HT', 'YC.KHOA', 'YC.PIN', 'YC.PHL', 'TD.HM', 'THE.TG'], note: 'thẻ tín dụng quốc tế, chi tiêu trước trả sau' },
  { code: 'THE.TD.JCB', name: 'Thẻ tín dụng quốc tế JCB', group: 'Thẻ', ops: ['KN.GD.TS', 'KN.GD.HT', 'YC.KHOA', 'YC.PIN', 'YC.PHL', 'TD.HM', 'THE.TG'], note: 'thẻ tín dụng quốc tế, ưu đãi khi chi tiêu tại Nhật Bản' },
  { code: 'THE.GN.ND', name: 'Thẻ ghi nợ nội địa', group: 'Thẻ', ops: ['KN.GD.TS', 'YC.KHOA', 'YC.MO', 'YC.PIN', 'YC.PHL', 'TD.HM'], note: 'thẻ thanh toán gắn với tài khoản thanh toán, dùng trong nước (NAPAS)' },
  { code: 'THE.GN.QT', name: 'Thẻ ghi nợ quốc tế Visa Debit', group: 'Thẻ', ops: ['KN.GD.TS', 'YC.KHOA', 'YC.MO', 'YC.PIN', 'YC.PHL', 'TD.HM'], note: 'thẻ thanh toán gắn với tài khoản, chi tiêu trong và ngoài nước' },
  { code: 'THE.TT', name: 'Thẻ trả trước', group: 'Thẻ', ops: ['KN.GD.HT', 'YC.KHOA', 'YC.PHL'], note: 'thẻ nạp tiền trước, không gắn tài khoản thanh toán' },
  // ───── Tài khoản ─────
  { code: 'TK.TT.CN', name: 'Tài khoản thanh toán cá nhân', group: 'Tài khoản', ops: ['KN.GD.TS', 'YC.KHOA', 'YC.MO', 'TD.SDT', 'KN.PHI', 'TK.DONG'] },
  { code: 'TK.NT', name: 'Tài khoản ngoại tệ', group: 'Tài khoản', ops: ['KN.GD.TS', 'KN.PHI', 'TK.DONG'], note: 'tài khoản bằng USD, EUR, JPY... phục vụ nhận/chuyển tiền quốc tế' },
  { code: 'TK.TC', name: 'Tài khoản thấu chi', group: 'Tài khoản', ops: ['TD.HM', 'KN.PHI', 'TK.DONG'], note: 'hạn mức chi tiêu vượt số dư tài khoản thanh toán' },
  { code: 'TK.SL', name: 'Tài khoản sinh lời tự động', group: 'Tài khoản', ops: ['KN.GD.HT', 'KN.CL', 'TK.DONG'], note: 'số dư nhàn rỗi tự động hưởng lãi suất cao hơn không kỳ hạn' },
  // ───── Tiết kiệm & Tiền gửi ─────
  { code: 'TG.CKH', name: 'Tiền gửi tiết kiệm có kỳ hạn', group: 'Tiết kiệm & Tiền gửi', ops: ['TG.TT', 'TG.MAT', 'KN.CL'] },
  { code: 'TG.TL', name: 'Tiết kiệm tích lũy định kỳ', group: 'Tiết kiệm & Tiền gửi', ops: ['TG.TT', 'KN.CL'], note: 'gửi góp hằng tháng theo kế hoạch' },
  { code: 'TG.LH', name: 'Tiền gửi rút gốc linh hoạt', group: 'Tiết kiệm & Tiền gửi', ops: ['TG.TT', 'KN.CL'], note: 'được rút một phần gốc trước hạn' },
  { code: 'TG.CCTG', name: 'Chứng chỉ tiền gửi', group: 'Tiết kiệm & Tiền gửi', ops: ['TG.TT', 'TG.MAT'] },
  // ───── Cho vay ─────
  { code: 'VAY.NHA', name: 'Vay mua nhà', group: 'Cho vay', ops: ['TG.TT', 'VAY.CCN', 'VAY.XN', 'KN.CL'], note: 'vay có tài sản đảm bảo là bất động sản' },
  { code: 'VAY.OTO', name: 'Vay mua ô tô', group: 'Cho vay', ops: ['TG.TT', 'VAY.CCN', 'VAY.XN', 'KN.CL'], note: 'vay có tài sản đảm bảo là chính chiếc xe' },
  { code: 'VAY.TC', name: 'Vay tiêu dùng tín chấp', group: 'Cho vay', ops: ['TG.TT', 'VAY.CCN', 'VAY.XN', 'KN.CL'], note: 'vay không tài sản đảm bảo theo thu nhập' },
  { code: 'VAY.CC', name: 'Vay cầm cố tiền gửi', group: 'Cho vay', ops: ['TG.TT', 'VAY.XN', 'KN.CL'], note: 'vay bằng cầm cố sổ tiết kiệm/chứng chỉ tiền gửi' },
  { code: 'VAY.XD', name: 'Vay xây dựng, sửa chữa nhà', group: 'Cho vay', ops: ['TG.TT', 'VAY.CCN', 'VAY.XN'] },
  // ───── Ngân hàng số ─────
  { code: 'NHDT.APP', name: 'Ứng dụng Mobile Banking', group: 'Ngân hàng số', ops: ['KN.GD.TS', 'YC.KHOA', 'YC.MO', 'NH.MK', 'TD.SDT', 'TD.HM', 'KN.CL'] },
  { code: 'NHDT.IB', name: 'Internet Banking', group: 'Ngân hàng số', ops: ['KN.GD.TS', 'YC.KHOA', 'YC.MO', 'NH.MK', 'TD.HM', 'KN.CL'] },
  // ───── Bảo hiểm ─────
  { code: 'BH.SK', name: 'Bảo hiểm sức khỏe', group: 'Bảo hiểm', ops: ['BH.HUY', 'BH.BT', 'KN.CL'] },
  { code: 'BH.DL', name: 'Bảo hiểm du lịch', group: 'Bảo hiểm', ops: ['BH.HUY', 'BH.BT'] },
  { code: 'BH.TL', name: 'Bảo hiểm nhân thọ tích lũy', group: 'Bảo hiểm', ops: ['BH.HUY', 'BH.BT', 'KN.CL'] },
  // ───── Chuyển tiền & Dịch vụ khác ─────
  { code: 'TT.CTQT', name: 'Chuyển tiền quốc tế', group: 'Chuyển tiền & Dịch vụ khác', ops: ['KN.GD.TS', 'KN.GD.HT', 'KN.PHI'] },
  { code: 'TT.CDM', name: 'Nộp tiền qua máy CDM', group: 'Chuyển tiền & Dịch vụ khác', ops: ['KN.GD.TS'], note: 'máy gửi/rút tiền tự động nhận tiền mặt' },
];

export const OPERATIONS: Record<string, Operation> = Object.fromEntries(
  (
    [
      {
        code: 'KN.GD.TS',
        name: 'Tra soát giao dịch',
        dept: 'Phòng Tra soát thẻ',
        sla: '5 ngày làm việc',
        channel: 'Tổng đài, Quầy, Mobile Banking',
        when: [
          'Khách hàng **không nhận ra** một giao dịch trên {sp} (giao dịch lạ, nghi gian lận) và muốn ngân hàng kiểm tra.',
          'Giao dịch bị **trừ tiền nhưng người nhận / đơn vị chấp nhận báo chưa nhận được** tiền.',
          'Giao dịch bị **trừ tiền 2 lần** (trùng lặp) hoặc số tiền bị trừ khác số tiền thực tế.',
          'Nộp/rút tiền tại ATM, CDM nhưng **máy không nhả tiền hoặc không ghi có** mà tài khoản vẫn bị trừ.',
        ],
        notWhen: [
          'Đã có kết luận lỗi, khách chỉ cần nhận lại tiền → chọn **Yêu cầu hoàn tiền**.',
          'Khách phàn nàn thái độ phục vụ, thời gian chờ → chọn **Khiếu nại chất lượng dịch vụ**.',
        ],
        docs: ['Mã giao dịch, thời gian, số tiền', 'Số thẻ/số tài khoản (che 6 số giữa)', 'Ảnh chụp màn hình, biên lai (nếu có)', 'Giấy đề nghị tra soát có chữ ký với giao dịch quốc tế'],
        note: 'Giao dịch thẻ quốc tế phải tra soát trong **120 ngày** kể từ ngày giao dịch theo quy định của tổ chức thẻ.',
      },
      {
        code: 'KN.GD.HT',
        name: 'Yêu cầu hoàn tiền',
        dept: 'Phòng Hoàn trả & Điều chỉnh',
        sla: '3 ngày làm việc',
        channel: 'Tổng đài, Quầy',
        when: [
          'Kết quả tra soát xác nhận lỗi và khách cần được **hoàn lại tiền** vào {sp}.',
          'Đơn vị bán hàng đã đồng ý **hủy giao dịch/hoàn tiền** nhưng quá 15 ngày tiền chưa về {sp}.',
          'Khách được hưởng **hoàn tiền ưu đãi (cashback)** theo chương trình nhưng chưa nhận.',
        ],
        notWhen: ['Chưa xác định giao dịch có lỗi → chọn **Tra soát giao dịch** trước.', 'Khách khiếu nại bị thu phí sai → chọn **Khiếu nại phí**.'],
        docs: ['Mã phiếu tra soát trước đó (nếu có)', 'Xác nhận hủy giao dịch của đơn vị bán hàng', 'Tên chương trình ưu đãi (với cashback)'],
      },
      {
        code: 'KN.CL',
        name: 'Khiếu nại chất lượng dịch vụ',
        dept: 'Phòng Xử lý khiếu nại',
        sla: '2 ngày làm việc',
        channel: 'Tổng đài, Quầy, Email',
        when: [
          'Khách **không hài lòng** về thái độ nhân viên, thời gian chờ, quy trình phục vụ liên quan đến {sp}.',
          'Khách phản ánh **tư vấn sai/thiếu thông tin** khi đăng ký {sp} (lãi suất, điều kiện, phí).',
          'Khách phản ánh **hệ thống chậm, lỗi hiển thị** nhưng không phát sinh sai lệch tiền.',
        ],
        notWhen: ['Có sai lệch tiền → chọn **Tra soát giao dịch**.', 'Khách chỉ phản đối một khoản phí → chọn **Khiếu nại phí**.'],
        docs: ['Mô tả sự việc, thời gian, địa điểm', 'Tên nhân viên/chi nhánh liên quan (nếu có)'],
      },
      {
        code: 'KN.PHI',
        name: 'Khiếu nại phí',
        dept: 'Phòng Hoàn trả & Điều chỉnh',
        sla: '3 ngày làm việc',
        channel: 'Tổng đài, Quầy',
        when: [
          'Khách bị thu **phí không đúng biểu phí** của {sp} (phí quản lý, phí duy trì, phí chuyển tiền, phí SMS...).',
          'Khách bị thu phí cho dịch vụ **đã hủy** hoặc **chưa từng đăng ký**.',
          'Khách đề nghị **miễn/giảm phí** do thuộc diện ưu đãi.',
        ],
        notWhen: ['Khoản trừ tiền không phải phí (giao dịch lạ) → chọn **Tra soát giao dịch**.'],
        docs: ['Tên khoản phí, ngày thu, số tiền', 'Sao kê/thông báo biến động có ghi phí'],
      },
      {
        code: 'YC.KHOA',
        name: 'Khóa thẻ / tài khoản',
        dept: 'Phòng Tra soát thẻ',
        sla: '30 phút (24/7)',
        channel: 'Tổng đài 24/7, Mobile Banking',
        when: [
          'Khách báo **mất, thất lạc hoặc bị đánh cắp** {sp} hoặc điện thoại cài ứng dụng ngân hàng.',
          'Khách nghi **lộ thông tin** (số thẻ, CVV, mật khẩu, OTP) hoặc vừa bị lừa đảo cung cấp OTP.',
          'Khách chủ động yêu cầu **tạm khóa** {sp} khi không sử dụng.',
        ],
        notWhen: ['Khách chỉ quên PIN, thẻ vẫn còn → chọn **Cấp lại PIN**.', 'Khách muốn chấm dứt hẳn tài khoản → chọn **Đóng tài khoản**.'],
        docs: ['Xác thực chính chủ qua bộ câu hỏi bảo mật', 'Thời điểm phát hiện mất/lộ thông tin'],
        note: 'Nghiệp vụ **khẩn cấp**: xử lý 24/7, SLA 30 phút kể cả ngày nghỉ.',
      },
      {
        code: 'YC.MO',
        name: 'Mở khóa thẻ / tài khoản',
        dept: 'Phòng Tra soát thẻ',
        sla: '4 giờ làm việc',
        channel: 'Tổng đài, Quầy',
        when: [
          'Khách tìm lại được {sp} sau khi báo khóa và muốn **mở khóa**.',
          '{sp} bị khóa do **nhập sai PIN/mật khẩu quá số lần** quy định.',
          'Tài khoản bị **tạm khóa do nghi ngờ gian lận** và khách đã xác minh chính chủ.',
        ],
        notWhen: ['Thẻ đã khóa vĩnh viễn do lộ thông tin → chọn **Phát hành lại thẻ**.'],
        docs: ['Xác thực chính chủ (CCCD gắn chip/sinh trắc học)', 'Lý do bị khóa (nếu khách biết)'],
      },
      {
        code: 'YC.PIN',
        name: 'Cấp lại PIN',
        dept: 'Phòng Phát hành thẻ',
        sla: '1 ngày làm việc',
        channel: 'Quầy, Mobile Banking',
        when: ['Khách **quên mã PIN** của {sp}.', 'Khách nghi người khác biết PIN nhưng thẻ vẫn trong tay.', 'PIN giấy bị thất lạc trước khi kích hoạt thẻ.'],
        notWhen: ['Thẻ bị mất → chọn **Khóa thẻ / tài khoản** rồi **Phát hành lại thẻ**.'],
        docs: ['Thẻ còn hiệu lực', 'CCCD của chủ thẻ'],
      },
      {
        code: 'YC.PHL',
        name: 'Phát hành lại thẻ',
        dept: 'Phòng Phát hành thẻ',
        sla: '5 ngày làm việc',
        channel: 'Quầy, Mobile Banking',
        when: [
          '{sp} bị **mất, hỏng chip, gãy, mờ số** hoặc bị ATM nuốt không nhận lại được.',
          'Thẻ đã bị khóa vĩnh viễn do lộ thông tin và khách cần thẻ mới.',
          'Khách muốn **đổi sang thẻ phi vật lý** hoặc đổi thiết kế thẻ.',
        ],
        notWhen: ['Thẻ sắp hết hạn → hệ thống tự gia hạn, không cần tạo phiếu.'],
        docs: ['CCCD', 'Thẻ cũ (nếu còn)', 'Phí phát hành lại theo biểu phí'],
      },
      {
        code: 'THE.TG',
        name: 'Chuyển đổi trả góp',
        dept: 'Phòng Phát hành thẻ',
        sla: '2 ngày làm việc',
        channel: 'Tổng đài, Mobile Banking',
        when: [
          'Khách muốn **chuyển giao dịch lớn** trên {sp} sang trả góp 3–24 tháng.',
          'Khách muốn **chuyển dư nợ sao kê** sang trả góp để giảm số tiền thanh toán tối thiểu.',
        ],
        notWhen: ['Khách gặp khó khăn tài chính, không trả được nợ → chọn **Cơ cấu lại thời hạn trả nợ**.'],
        docs: ['Mã giao dịch hoặc kỳ sao kê cần chuyển đổi', 'Kỳ hạn trả góp mong muốn'],
        note: 'Giao dịch phải từ **3 triệu đồng** và chưa quá ngày đến hạn thanh toán của kỳ sao kê.',
      },
      {
        code: 'TD.SDT',
        name: 'Cập nhật số điện thoại',
        dept: 'Phòng Tổng đài',
        sla: '4 giờ làm việc',
        channel: 'Quầy, Mobile Banking (eKYC)',
        when: [
          'Khách **đổi số điện thoại** và cần nhận OTP/SMS biến động số dư của {sp} về số mới.',
          'Khách **không nhận được OTP** do số đăng ký đã bị nhà mạng thu hồi.',
        ],
        notWhen: ['Chỉ đổi email/địa chỉ → khách tự cập nhật trên ứng dụng, không cần phiếu.'],
        docs: ['CCCD gắn chip', 'Số điện thoại mới chính chủ'],
      },
      {
        code: 'TD.HM',
        name: 'Điều chỉnh hạn mức',
        dept: 'Phòng Hoàn trả & Điều chỉnh',
        sla: '2 ngày làm việc',
        channel: 'Quầy, Tổng đài, Mobile Banking',
        when: [
          'Khách muốn **tăng/giảm hạn mức** chi tiêu, rút tiền hoặc chuyển khoản trong ngày của {sp}.',
          'Khách cần **tăng hạn mức tạm thời** cho một khoản chi lớn (du lịch, học phí, mua sắm).',
        ],
        notWhen: ['Không giao dịch được do thẻ/tài khoản bị khóa → chọn **Mở khóa thẻ / tài khoản**.'],
        docs: ['Chứng từ thu nhập (khi tăng hạn mức tín dụng)', 'Hạn mức mong muốn và thời hạn áp dụng'],
      },
      {
        code: 'TK.DONG',
        name: 'Đóng tài khoản',
        dept: 'Phòng Tổng đài',
        sla: '1 ngày làm việc',
        channel: 'Quầy',
        when: ['Khách muốn **chấm dứt sử dụng** {sp} và nhận lại số dư.', 'Khách chuyển sang ngân hàng khác, không còn nhu cầu duy trì {sp}.'],
        notWhen: ['Khách chỉ muốn tạm ngưng → chọn **Khóa thẻ / tài khoản**.'],
        docs: ['CCCD', 'Tất toán dư nợ/thấu chi liên quan', 'Hủy các dịch vụ trích nợ tự động'],
      },
      {
        code: 'TG.TT',
        name: 'Tất toán trước hạn',
        dept: 'Phòng Hoàn trả & Điều chỉnh',
        sla: '1 ngày làm việc',
        channel: 'Quầy, Mobile Banking',
        when: ['Khách muốn **rút toàn bộ / trả hết nợ trước ngày đáo hạn** đối với {sp}.', 'Khách tất toán để chuyển sang sản phẩm có lãi suất tốt hơn.'],
        notWhen: ['Đến ngày đáo hạn → hệ thống tự tất toán/tái tục theo đăng ký.'],
        docs: ['Hợp đồng/sổ tiết kiệm', 'CCCD', 'Thông báo khách về lãi không kỳ hạn hoặc phí trả nợ trước hạn'],
      },
      {
        code: 'TG.MAT',
        name: 'Báo mất sổ / chứng từ tiền gửi',
        dept: 'Phòng Tra soát thẻ',
        sla: '4 giờ làm việc',
        channel: 'Quầy, Tổng đài',
        when: ['Khách báo **mất, rách, cháy** sổ tiết kiệm/chứng từ của {sp}.', 'Khách nghi người khác đang giữ sổ và muốn **phong tỏa** khoản tiền gửi.'],
        notWhen: ['Khách muốn rút tiền ngay → làm thủ tục báo mất trước, sau đó **Tất toán trước hạn**.'],
        docs: ['CCCD', 'Đơn trình báo mất sổ', 'Số sổ/số chứng từ (nếu nhớ)'],
      },
      {
        code: 'VAY.CCN',
        name: 'Cơ cấu lại thời hạn trả nợ',
        dept: 'Phòng Xử lý khiếu nại',
        sla: '5 ngày làm việc',
        channel: 'Quầy, RM',
        when: ['Khách gặp **khó khăn tài chính** (mất việc, ốm đau, thiên tai) không trả được nợ đúng hạn của {sp}.', 'Khách đề nghị **giãn, hoãn** kỳ trả nợ.'],
        notWhen: ['Khách muốn trả hết nợ sớm → chọn **Tất toán trước hạn**.'],
        docs: ['Đơn đề nghị cơ cấu nợ', 'Chứng từ chứng minh khó khăn tài chính'],
      },
      {
        code: 'VAY.XN',
        name: 'Cấp xác nhận dư nợ',
        dept: 'Phòng Tổng đài',
        sla: '2 ngày làm việc',
        channel: 'Quầy, Email',
        when: ['Khách cần **giấy xác nhận dư nợ / lịch trả nợ** của {sp} để bổ sung hồ sơ (visa, vay nơi khác, quyết toán thuế).', 'Khách cần **xác nhận đã tất toán** để giải chấp tài sản.'],
        notWhen: ['Khách chỉ hỏi số tiền phải trả kỳ này → tra cứu trực tiếp, không cần phiếu.'],
        docs: ['CCCD', 'Số hợp đồng vay', 'Mục đích sử dụng giấy xác nhận, ngôn ngữ (Việt/Anh)'],
      },
      {
        code: 'NH.MK',
        name: 'Cấp lại mật khẩu đăng nhập',
        dept: 'Phòng Ứng dụng ngân hàng số',
        sla: '2 giờ làm việc',
        channel: 'Tổng đài, Quầy',
        when: ['Khách **quên mật khẩu** đăng nhập {sp} và không tự đặt lại được bằng OTP.', 'Tài khoản đăng nhập bị **khóa do nhập sai mật khẩu** nhiều lần.'],
        notWhen: ['Khách nghi bị chiếm quyền tài khoản → chọn **Khóa thẻ / tài khoản** trước.'],
        docs: ['Xác thực chính chủ', 'Tên đăng nhập'],
      },
      {
        code: 'BH.HUY',
        name: 'Hủy hợp đồng trong thời gian cân nhắc',
        dept: 'Phòng Xử lý khiếu nại',
        sla: '5 ngày làm việc',
        channel: 'Quầy, Tổng đài',
        when: ['Khách muốn **hủy hợp đồng** {sp} trong **21 ngày cân nhắc** kể từ khi nhận hợp đồng.', 'Khách phản ánh bị **ép mua bảo hiểm** khi vay vốn/mở thẻ.'],
        notWhen: ['Quá 21 ngày → hướng dẫn khách liên hệ công ty bảo hiểm để hủy theo điều khoản.'],
        docs: ['Hợp đồng bảo hiểm', 'Đơn yêu cầu hủy', 'CCCD'],
      },
      {
        code: 'BH.BT',
        name: 'Hỗ trợ yêu cầu bồi thường',
        dept: 'Phòng Xử lý khiếu nại',
        sla: '3 ngày làm việc',
        channel: 'Quầy, Tổng đài',
        when: ['Khách xảy ra **sự kiện được bảo hiểm** (ốm đau, tai nạn, trễ chuyến...) theo {sp} và cần hỗ trợ nộp hồ sơ bồi thường.', 'Khách phản ánh **hồ sơ bồi thường bị chậm/từ chối** chưa rõ lý do.'],
        notWhen: ['Khách muốn hủy hợp đồng → chọn **Hủy hợp đồng trong thời gian cân nhắc**.'],
        docs: ['Số hợp đồng bảo hiểm', 'Chứng từ y tế/hóa đơn/biên bản sự việc'],
      },
    ] as Operation[]
  ).map((o) => [o.code, o]),
);
