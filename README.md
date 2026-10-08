# ViewIO

**ViewIO = MinIO + giao diện xem tài liệu.** Cài một lệnh là có cả kho lưu trữ S3 (MinIO) lẫn giao diện web đã được nâng cấp:
xem trước PDF/Word/Excel/PowerPoint/Markdown/code/ảnh/video ngay trong trình duyệt, cây thư mục bên trái, double-click file để xem.

![kiến trúc](docs/architecture.svg)

## Có gì khác MinIO gốc

| | MinIO Console gốc | ViewIO |
|---|---|---|
| PDF | khung nhúng thô, 5 trang đầu | pdf.js: thumbnail, zoom, tìm kiếm, nhảy trang, phím tắt |
| Word `.docx` | không xem được | dựng ngay trên trình duyệt |
| Excel `.xlsx`, CSV/TSV | không | bảng có lọc, nhiều sheet |
| PowerPoint, `.doc`, `.xls`, `.odt`, `.rtf`… | không | tự chuyển sang PDF bằng LibreOffice rồi xem |
| Markdown, code, log, JSON, YAML… | không | hiển thị đẹp, highlight, số dòng, tìm kiếm |
| Ảnh | xem tĩnh | zoom, kéo, xoay, lật |
| Mở xem | chọn file → bấm Preview | **double-click file** là xem |
| Cây thư mục | không | thanh bên trái, bung/thu từng nhánh, kéo đổi độ rộng (mặc định ẩn) |
| Menu trái (thu nhỏ) | 80px | 40px |
| Giao diện sáng/tối | có | viewer theo đúng theme |

Phần lõi MinIO giữ nguyên (`RELEASE.2025-04-22T22-12-26Z`), dữ liệu và S3 API hoàn toàn tương thích.

## Cài nhanh

Yêu cầu: Linux x86_64, Docker Engine + Docker Compose v2, ~2GB ổ trống cho image, có Internet khi cài (tải image từ Docker Hub: [`ntanhprt/viewio`](https://hub.docker.com/r/ntanhprt/viewio), [`ntanhprt/viewio-converter`](https://hub.docker.com/r/ntanhprt/viewio-converter)).

```bash
git clone https://github.com/ntanhprt/ViewIO.git
cd ViewIO
./install.sh
```

Script tải image dựng sẵn (~1–2 phút); nếu không tải được thì tự build từ source (~10–15 phút, cần RAM ≥ 6GB, không cần cài Node/Go). Kết thúc script in địa chỉ,
tài khoản và mật khẩu ngẫu nhiên (lưu trong `.env`). Mặc định: giao diện `http://localhost:9001`, S3 API `http://localhost:9000`.

### Đã có MinIO đang chạy, có dữ liệu? Chỉ nâng cấp giao diện

Không cần cài mới, không đổi cổng/dữ liệu/tài khoản: `docker pull ntanhprt/viewio:2025-04-22`, rồi đổi `image:` của MinIO cũ sang
`ntanhprt/viewio:2025-04-22` (hoặc thay binary nếu chạy systemd). Có rollback một dòng. Chi tiết từng bước:
**[docs/INSTALL.md mục 3b](docs/INSTALL.md#3b-đã-có-minio-đang-chạy--chỉ-nâng-cấp-giao-diện-giữ-nguyên-mọi-thứ)**.

**Hướng dẫn cài đặt chi tiết: [docs/INSTALL.md](docs/INSTALL.md)** · Dành cho người phát triển: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)

## Vận hành

```bash
./viewio.sh status      # trạng thái
./viewio.sh logs -f     # xem log
./viewio.sh restart     # khởi động lại
./viewio.sh update      # lấy bản mới + tải image + chạy lại (không mất dữ liệu)
./viewio.sh help        # tất cả lệnh
```

## Giấy phép

MinIO và MinIO Console là phần mềm **GNU AGPL v3**; ViewIO là bản sửa đổi của chúng nên phát hành theo cùng giấy phép (xem [LICENSE](LICENSE)).
Source đầy đủ nằm trong `src/`. Nếu bạn cung cấp ViewIO cho người khác qua mạng, AGPL yêu cầu bạn cung cấp source (kể cả các sửa đổi của bạn) cho họ.
ViewIO không liên kết hay được xác nhận bởi MinIO, Inc.
