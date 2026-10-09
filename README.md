# DCMS – Hệ thống Phiếu & Tác vụ theo quy trình

Xây dựng lại theo đặc tả *"Luồng Tạo & Xử lý Phiếu - Tác vụ (DCMS)"*: không còn khái niệm Tương tác. Người dùng tạo thẳng Phiếu; phiếu được xử lý bằng các Tác vụ sinh theo Quy trình của Dịch vụ, và chỉ xử lý thủ công trên màn hình.

## Công nghệ

| Lớp | Công nghệ |
|---|---|
| Giao diện | React 18 + TypeScript, Vite, Ant Design 5 (locale vi_VN), TanStack Query, dnd-kit |
| Backend | Node.js + Express, TypeScript (tsx) |
| CSDL | SQLite qua Prisma ORM (không cần cài database server) |
| Dùng chung | `shared/` – tính SLA/lịch làm việc, mẫu nhập liệu động, hằng số. Cả server lẫn web dùng chung để kết quả tính khớp nhau |

## Chạy hệ thống

Yêu cầu Node.js ≥ 20.

```bash
npm install        # cài toàn bộ (server + web)
npm run setup      # tạo database + nạp dữ liệu mẫu (bỏ qua nếu đã có dữ liệu)
npm run dev        # API http://localhost:4000 + Web http://localhost:5173
```

Mở **http://localhost:5173**. Các lệnh khác:

- `npm run db:reset`: **xóa database** và nạp lại dữ liệu mẫu từ đầu.
- `npm run db:fill`: bổ sung dữ liệu demo "như đang vận hành". Lệnh này thêm 7 nhân sự, 14 khách hàng, 4 dịch vụ mới (Cập nhật SĐT, Cấp lại PIN ×2, Điều chỉnh hạn mức) và **60 phiếu rải trong 30 ngày qua**, được xử lý qua engine thật với đồng hồ giả lập. Dữ liệu gồm đủ các trạng thái: hoàn thành sớm/trễ, quá hạn, trả lại xử lý, báo hoàn thành, nhiều tác vụ trên một công việc, đổi dịch vụ, lỗi sinh tác vụ. Phiếu demo chỉ sinh 1 lần; thêm `-- --force` để sinh thêm.
- `npm start`: build giao diện, sau đó chạy một cổng duy nhất là http://localhost:4000.
- `npm run typecheck`: kiểm tra kiểu TypeScript (server, web, knowledge).
- `npm run mock:confluence`: chạy Confluence giả lập (cổng 8090) cho kho tri thức SP-NV.
- `npm run mindmate:setup`: chuẩn bị workspace `dcms` trên Mindmate (AGENTS.md + đăng ký MCP). Không bắt buộc vì server tự làm khi có câu hỏi đầu tiên.
- `npm test`: kiểm thử tự động của kho tri thức.

### Tài khoản mẫu (mật khẩu chung `123456`)

| Tài khoản | Họ tên | Phòng ban | Ghi chú |
|---|---|---|---|
| admin | Nguyễn Quản Trị | Quản trị hệ thống | **Quản trị** – sửa Danh mục |
| cs.lan | Trần Thị Lan | Phòng Tổng đài | Đầu mối |
| cs.minh | Lê Văn Minh | Phòng Tổng đài | |
| xl.hoa | Phạm Thu Hoa | Phòng Xử lý khiếu nại | Đầu mối |
| xl.tuan | Đỗ Anh Tuấn | Phòng Xử lý khiếu nại | |
| ts.nam | Hoàng Văn Nam | Phòng Tra soát thẻ | Đầu mối |
| ts.linh | Vũ Mai Linh | Phòng Tra soát thẻ | |
| ph.duc | Bùi Minh Đức | Phòng Phát hành thẻ | Đầu mối |
| tt.huong | Ngô Thanh Hương | Phòng Hoàn trả & Điều chỉnh | Đầu mối |
| tt.khoa | Đặng Đăng Khoa | Phòng Hoàn trả & Điều chỉnh | **Ngừng hoạt động** |
| ud.son | Trịnh Hồng Sơn | Phòng Ứng dụng ngân hàng số | Phòng **chưa có đầu mối** |

Bấm vào avatar ở góc phải để **chuyển nhanh người dùng**. Tính năng này phục vụ nghiệm thu các tình huống "người tạo ≠ người phụ trách", "người được giao mở tác vụ"…

## Các quyết định nghiệp vụ đã thống nhất

1. **Rẽ nhánh theo kết quả:** mặc định đi sang công việc kế tiếp. Riêng mỗi *kết quả lá* có thể cấu hình: *Công việc kế tiếp*, *Chuyển đến công việc X* (đi tới hoặc quay lui), hoặc *Kết thúc quy trình*. Các công việc bị nhảy qua có trạng thái "Bỏ qua".
2. **Tác vụ của công việc đầu tiên được sinh tự động ngay khi tạo phiếu.** Các công việc sau cũng sinh tự động khi công việc trước hoàn thành.
3. **Công việc có nhiều tác vụ:** chỉ chuyển sang bước tiếp khi *toàn bộ* tác vụ của công việc đã Hoàn thành. Kết quả của tác vụ hoàn thành *sau cùng* quyết định hướng đi.
4. **Phân khúc khách hàng:** phiếu có trường Khách hàng, tra cứu theo CIF/tên/SĐT, phân khúc lấy theo khách hàng. Khách hàng cũng là nguồn dữ liệu cho trường *360 view*. Nếu dịch vụ áp quy trình theo phân khúc thì bắt buộc chọn khách hàng.
5. **Người nhận tác vụ tự sinh:** là nhân sự cụ thể nếu công việc có cấu hình, nếu không thì là *nhân sự đầu mối* của phòng ban xử lý (cấu hình ở *Danh mục → Đơn vị & nhân sự*). Khi sinh lỗi, có 3 thông báo lỗi đúng như mục 10 của đặc tả. Cảnh báo hiện ở **lần đầu** mở phiếu, kèm nút **Thử lại** (retry) và **Tạo thủ công**.
6. **Snapshot cấu hình:** khi tạo phiếu, hệ thống chụp lại dịch vụ, quy trình (công việc, SLA, kết quả) và mẫu nhập liệu. Sửa danh mục sau đó không ảnh hưởng phiếu đã tạo.
7. **Đổi Sản phẩm/Nghiệp vụ của phiếu:** công việc cũ chuyển "Hủy" và hiện trong box *"Công việc thuộc dịch vụ cũ"*; tác vụ của chúng chỉ còn xem. Quy trình mới áp dụng và SLA tính lại từ thời điểm đổi.
8. **Mã phiếu / mã tác vụ** dùng 5 chữ số tăng dần (`P/V + yymmdd + xxxxx`), theo bảng tóm tắt mục 12 của đặc tả.
9. **"Hướng xử lý"** trên phiếu hiển thị tên quy trình được áp dụng.
10. **Giờ hành chính** mặc định là 08:00–12:00 và 13:00–17:00, thứ 2 đến thứ 6, sửa được ở *Lịch làm việc*. Tổng thời gian các ca bắt buộc bằng 8 giờ. Ngày lễ và ngày làm bù cấu hình theo từng ngày. Mọi tính toán theo giờ Việt Nam (UTC+7).
11. **Thông báo:** có chuông thông báo trong ứng dụng. Email/SMS chỉ ghi nhận lựa chọn, không gửi thật.
12. **Phân quyền đơn giản:** *Quản trị* được sửa Danh mục. Người phụ trách phiếu hoặc Quản trị được đổi trạng thái phiếu. Mọi người dùng đều thao tác được trên tác vụ, vì đặc tả bỏ phân quyền theo vai trò xử lý.
13. **Dữ liệu ngoài là dữ liệu giả lập:** T24 (nút *Đồng bộ T24* thêm các sản phẩm còn thiếu), cây đơn vị/nhân sự, chi nhánh – RM, tỉnh/xã, khách hàng/tài khoản/thẻ/giao dịch.

## Đối chiếu đặc tả

| Mục đặc tả | Màn hình / chức năng |
|---|---|
| 3. Sản phẩm & Nghiệp vụ | Danh mục → Sản phẩm / Nghiệp vụ (cây 3 cấp, đang/ngừng sử dụng, đồng bộ T24) |
| 4. Dịch vụ | Danh mục → Dịch vụ (mã tự sinh, không trùng SP+NV, đổi 24/7 có xác nhận xóa quy trình, SLA tham chiếu tự fill, theo phân khúc, quy tắc sửa/xóa khi đã dùng) |
| 5. Trường & Mẫu nhập liệu | Danh mục → Trường nhập liệu (Nhập/360 view, các kiểu dữ liệu, Chi nhánh–RM, Tỉnh/Xã/Địa chỉ); Mẫu nhập liệu (mã F+mmyy+xxxx, không trùng tên, phụ thuộc tối đa 2 cấp, kéo thả, xem trước 3 khu vực) |
| — Quy trình | Danh mục → Quy trình (công việc, SLA ngày/giờ/phút, phòng ban/nhân sự, mẫu nhập liệu công việc, cây kết quả + rẽ nhánh) |
| 6. Tạo phiếu | Tạo phiếu; trạng thái Mới/Đang xử lý theo người tạo – phụ trách; người phụ trách mở lần đầu → Đang xử lý |
| 7. Sinh tác vụ | Chi tiết phiếu → tab Công việc → *Tạo tác vụ* (đổi phòng ban xóa nhân sự; chọn nhân sự cập nhật phòng ban; 10MB/file, 20 file; ≥1 hình thức thông báo); danh sách tác vụ, xóa có xác nhận |
| 8. Xử lý tác vụ | Popup *Xử lý tác vụ*: Nhận / Cập nhật / Trả lại xử lý / Báo hoàn thành / Hoàn thành / Hủy; Kết quả bắt buộc, chọn tới level cuối; đổi người xử lý → Mới; tab Lịch sử tác vụ (mở rộng xem Thông tin / Giá trị mới / Giá trị cũ) |
| 9. SLA | Sớm/trễ đếm ngược thời gian thực, tag *Sắp đến hạn* (90–100%) / *Quá hạn*, trừ giờ nghỉ theo lịch |
| 10. Sinh tự động | Engine quy trình + cảnh báo lỗi + Thử lại |
| 11. Cập nhật theo lô | Danh sách phiếu (tác vụ đang mở của các phiếu chọn) và Danh sách tác vụ |
| 13. Lưu vết | Lịch sử phiếu và lịch sử tác vụ (người, thời gian, giá trị cũ/mới) |

## Kịch bản nghiệm thu gợi ý

1. Đăng nhập **cs.minh** → *Tạo phiếu*: khách hàng *Trần Thị Bình* (Priority), sản phẩm *Thẻ tín dụng quốc tế Visa*, nghiệp vụ *Tra soát giao dịch*. Quan sát quy trình **ưu tiên** được áp dụng. Thử nút **360** ở ô Số thẻ / Mã giao dịch; chọn Loại tra soát = *Khác* để thấy trường phụ thuộc xuất hiện. Chọn người phụ trách là *Phạm Thu Hoa* → phiếu ở trạng thái **Mới**.
2. Chuyển sang **xl.hoa** → mở phiếu: phiếu chuyển **Đang xử lý**. Ở tab Công việc, mở tác vụ: tác vụ chuyển **Đang xử lý**. Chọn Kết quả *Hồ sơ hợp lệ* → **Hoàn thành**: hệ thống tự sinh tác vụ *Tra soát với tổ chức thẻ* cho *Hoàng Văn Nam*.
3. Đăng nhập **ts.nam** → hoàn thành với kết quả *Khách hàng sai – từ chối*: hệ thống bỏ qua bước *Hoàn tiền* và nhảy tới *Phản hồi khách hàng*. Hoàn thành bước cuối → phiếu tự **Hoàn thành**.
4. Mở phiếu mẫu *Ứng dụng Mobile Banking* (P…003) bằng **cs.lan**: hiện cảnh báo sinh tác vụ lỗi. Đăng nhập admin, vào *Đơn vị & nhân sự* gán đầu mối cho *Phòng Ứng dụng ngân hàng số*, rồi bấm **Thử lại**.
5. Phiếu mẫu *Khóa thẻ* (24/7, SLA 30 phút) có sẵn một tác vụ **Quá hạn**.
6. *Sửa phiếu* → đổi Nghiệp vụ: công việc cũ chuyển **Hủy**, quy trình mới được áp dụng.

## Trợ lý Mindmate & kho tri thức Sản phẩm - Nghiệp vụ

Người dùng không cần tự tìm trên Confluence mô tả "khi nào nên chọn" của từng SP-NV (có thể tới 10.000 mục).
Họ hỏi thẳng trợ lý qua nút chat ở góc phải màn hình DCMS.

```
Confluence ──(hằng giờ, CQL lastmodified)──▶ knowledge/ (SQLite FTS5) ──▶ MCP /mcp ◀── Mindmate control-plane
                                                                                            ▲  workspace "dcms" + AGENTS.md
DCMS web (nút chat → Drawer) ──▶ DCMS server /api/assistant/* ──(Keycloak client "dcms", SSE)┘
```

| Thành phần | Vị trí | Ghi chú |
|---|---|---|
| Kho tri thức + MCP | `knowledge/` (cổng 4100) | Xem [knowledge/README.md](knowledge/README.md). Cấu hình space trong `knowledge/config/application.properties` |
| Tích hợp Mindmate | `server/src/services/mindmate.ts`, `server/src/routes/assistant.ts` | Cấu hình trong `server/config/application.properties` |
| Chỉ dẫn agent | `server/mindmate/AGENTS.md` | Tự đẩy lên workspace `dcms`. Sửa file rồi khởi động lại server để áp dụng |
| Ô chat | `web/src/components/assistant/` | Giao diện hiển thị phản hồi giống Mindmate web (markdown, Thinking, nhóm "Đã sử dụng N công cụ", stream) |

**Yêu cầu phía Mindmate** (nhánh `feature/workspace-agents-md` của repo mindmate):
- Control-plane hỗ trợ `AGENTS.md` theo workspace (`GET/PUT/DELETE /v1/workspaces/{id}/agents-md`). File này được nối vào system prompt ở mỗi lượt hỏi.
- Keycloak có client confidential `dcms` (service account). Với Keycloak đã cài từ trước, chạy `keycloak/add-dcms-client.sh` một lần.
- Chạy control-plane với `MINDMATE_MCP_ALLOW_PRIVATE_HOSTS=true` để Mindmate gọi được MCP ở `localhost`.

**Chạy nghiệm thu đầy đủ:**

1. Bên Mindmate: bật PostgreSQL, Keycloak, Docker. Chạy `mindmate-control-plane` với `MINDMATE_MCP_ALLOW_PRIVATE_HOSTS=true`.
2. `npm run mock:confluence` (hoặc cấu hình Confluence thật trong `knowledge/config/application.properties`).
3. `npm run dev`. Lệnh này chạy API, web và kho tri thức. Kho sẽ tự quét toàn bộ ở lần đầu.
4. Đăng nhập DCMS, bấm nút chat tím ở góc phải dưới rồi hỏi, ví dụ *"Khách báo mất thẻ ghi nợ nội địa, tôi nên tạo phiếu gì?"*.

Mỗi người dùng DCMS có danh sách hội thoại riêng (bảng `AssistantConversation`). Lịch sử hội thoại lưu trên Mindmate.

## Cấu trúc thư mục

```
shared/            Logic dùng chung (SLA, mẫu nhập liệu động, hằng số)
server/prisma/     schema.prisma, seed.ts (dữ liệu mẫu)
server/src/        core.ts (mã, lịch sử, thông báo), auth.ts,
                   services/engine.ts (engine quy trình), services/snapshot.ts,
                   routes/* (API REST)
web/src/           pages/ (màn hình), components/ (form động, popup tác vụ…, assistant/ – ô chat)
knowledge/         Kho tri thức SP-NV: đồng bộ Confluence, tìm kiếm, MCP server, Confluence giả lập
```
