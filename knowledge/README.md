# DCMS Knowledge – kho tri thức Sản phẩm - Nghiệp vụ

Service đồng bộ các trang Confluence mô tả "khi nào nên chọn" của từng Sản phẩm - Nghiệp vụ (SP-NV) về kho SQLite
có chỉ mục toàn văn, rồi cung cấp **MCP server** (Streamable HTTP) để Mindmate tra cứu.

```
Confluence (Cloud / Data Center) ──CQL──▶ sync (cron) ──▶ SQLite + FTS5 ──▶ POST /mcp ◀── Mindmate (tool "mcp")
```

## Chạy

```bash
npm run dev -w knowledge              # http://localhost:4100 (tự đồng bộ khi khởi động + theo lịch)
npm run sync -w knowledge             # đồng bộ 1 lần (lần đầu quét toàn bộ, sau đó chỉ quét thay đổi)
npm run sync:full -w knowledge        # ép quét và lập chỉ mục lại toàn bộ (kể cả trang không đổi)
npm run search -w knowledge -- "mất thẻ ghi nợ"   # thử tìm kiếm từ dòng lệnh
npm test -w knowledge                 # kiểm thử tự động (dùng Confluence giả lập trong tiến trình)
```

### Confluence giả lập (nghiệm thu khi chưa có Confluence thật)

```bash
npm run mock:confluence -w knowledge                  # http://localhost:8090, space SPNV, ~300 trang
MOCK_PAGES=10000 npm run mock:confluence -w knowledge # kiểm thử quy mô 10.000 trang
```

- API Data Center tại `/rest/api`, API Cloud tại `/wiki/rest/api`. Hỗ trợ CQL `space`, `type`, `ancestor`, `label`,
  `lastmodified >=` và phân trang `_links.next`.
- Mở `http://localhost:8090` để xem trang. Link trong câu trả lời của trợ lý trỏ về đây.
- Giả lập thay đổi để kiểm tra lần quét kế tiếp:
  - Sửa trang: `POST /__mock/pages/{id}` với body `{"appendWhen": "tình huống mới"}`. Lệnh này tăng version và cập nhật lastModified.
  - Tạo trang: `POST /__mock/pages` với body `{"title": "...", "when": ["..."], "group": "Thẻ"}`.
  - Xoá trang: `DELETE /__mock/pages/{id}`. Lần đối soát kế tiếp sẽ xoá trang khỏi kho.

### Dữ liệu mẫu trên Confluence thật

```bash
npm run seed:confluence -w knowledge -- --dry-run   # xem trước danh sách trang
npm run seed:confluence -w knowledge                # tạo/cập nhật ~110 trang trên space đầu tiên trong confluence.spaces
```

- Tạo 7 trang `[Mục lục] <nhóm>` và 103 trang SP-NV (danh mục trong `seed/catalog.ts`).
- Loại sản phẩm tham khảo danh mục công khai của các ngân hàng, đặt tên chung, không gắn thương hiệu.
- Mọi trang gắn label `du-lieu-mau`. Chạy lại an toàn: trang đã có chỉ được cập nhật khi nội dung đổi.

## Cấu hình – `config/application.properties`

Giá trị dạng `${BIEN:mac_dinh}` lấy từ biến môi trường. Để ghi đè cục bộ, dùng `config/application-local.properties` (không commit).

| Khoá | Ý nghĩa |
|---|---|
| `confluence.type` | `cloud` hoặc `datacenter` (khác nhau ở cách xác thực) |
| `confluence.base-url` | Cloud: `https://<site>.atlassian.net/wiki`. Data Center: `https://confluence.cty.vn`, kèm context path nếu có |
| `confluence.username` / `confluence.token` | Cloud: email và API token. Data Center: để trống username và điền Personal Access Token (hoặc điền username + mật khẩu) |
| `confluence.spaces` | Danh sách space key cần quét. **Space mới thêm sẽ được quét toàn bộ** ở lần chạy kế tiếp. Space bị bỏ khỏi danh sách thì dữ liệu cũ bị xoá |
| `confluence.space.<KEY>.root-page-id` | (tuỳ chọn) chỉ lấy các trang con của một trang gốc |
| `confluence.space.<KEY>.labels` | (tuỳ chọn) chỉ lấy trang có một trong các label |
| `confluence.exclude-title-prefixes` | Bỏ qua trang mục lục/template theo tiền tố tiêu đề |
| `sync.cron` | Lịch quét thay đổi, mặc định `0 * * * *` (đầu mỗi giờ) |
| `sync.reconcile-cron` | Lịch đối soát id để phát hiện trang bị xoá/di chuyển, mặc định 02:30 hằng ngày |
| `sync.overlap-minutes` | Lùi mốc `lastmodified` để không sót trang (lệch giờ, độ trễ index của Confluence) |
| `content.guidance-headings` | Tên các mục được coi là phần "khi nào nên chọn", được ưu tiên hiển thị khi tìm |
| `mcp.auth-token` | Bearer token mà Mindmate phải gửi kèm |

## Cơ chế đồng bộ

- **Lần đầu** (hoặc khi thêm space mới): quét toàn bộ bằng CQL `space = "X" and type = page`. Trang không còn thấy sẽ bị xoá.
- **Hằng giờ**: chỉ lấy trang có `lastmodified >= mốc lần trước − overlap`, so `version` để bỏ qua trang không đổi.
- **Đối soát hằng ngày**: chỉ lấy danh sách id (không lấy nội dung). Trang bị xoá/di chuyển sẽ bị gỡ, trang còn thiếu sẽ được bổ sung.
- Các lần chạy không chồng nhau. Lịch sử chạy xem ở `GET /api/status`. Có thể kích hoạt tay bằng `POST /api/sync?mode=auto|full|reconcile&wait=true`.
- Nội dung storage format (macro Page Properties, panel, code, bảng…) được chuyển sang Markdown và tách theo tiêu đề.
  Bảng Page Properties được lưu thành thuộc tính trang (mã SP, mã NV, phòng xử lý…).

Đo trên máy dev với 10.000 trang: quét toàn bộ ~10 giây, quét thay đổi ~80ms, mỗi lần tìm kiếm 15–45ms.

## Tìm kiếm

- Có hai bộ chỉ mục FTS5:
  - **có dấu**: dùng khi truy vấn có dấu, phân biệt "mất"/"mật", "nợ"/"no";
  - **không dấu**: dùng khi người dùng gõ không dấu.
- Xếp hạng gồm bm25 (trọng số: tiêu đề > breadcrumb/label/thuộc tính > nội dung) và độ phủ của từ hiếm.
  Sau đó đa dạng hoá để các biến thể gần trùng nhau (hạng thẻ, gói…) không chiếm hết kết quả.

## MCP tools

| Tool | Tham số | Kết quả |
|---|---|---|
| `search_product_guidance` | `query`, `limit?`, `space?` | Danh sách ứng viên: tiêu đề, page_id, breadcrumb, thuộc tính, link, trích mục "Khi nào nên chọn" |
| `get_product_guidance` | `page_id` | Toàn văn trang (Markdown) |
| `get_knowledge_status` | – | Số trang theo space, thời điểm đồng bộ gần nhất |

Endpoint: `POST http://localhost:4100/mcp`, header `Authorization: Bearer <mcp.auth-token>`. Server chạy stateless,
tương thích với client MCP tự viết của Mindmate (protocol `2025-06-18`).
