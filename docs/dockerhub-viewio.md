# ViewIO — MinIO + giao diện xem tài liệu

**EN:** MinIO (`RELEASE.2025-04-22T22-12-26Z`) with an upgraded web Console: in-browser preview of PDF, Word, Excel/CSV, PowerPoint, Markdown, code, images and video; a collapsible folder tree; a thumbnail grid view; double-click a file to preview. Drop-in replacement for the official `minio/minio` image — same data format, same S3 API, `mc` included.

**VI:** MinIO có giao diện web đã nâng cấp: xem trước **PDF, Word, Excel/CSV, PowerPoint, Markdown, code, ảnh, video** ngay trong trình duyệt, **cây thư mục** bên trái, **chế độ xem thumbnail**, **double-click file để xem**. Thay thế trực tiếp image `minio/minio` chính thức — cùng định dạng dữ liệu, cùng S3 API, có sẵn `mc`.

Mã nguồn, hướng dẫn đầy đủ: **https://github.com/ntanhprt/ViewIO** · Dịch vụ đi kèm (xem PowerPoint/Office cũ): [`ntanhprt/viewio-converter`](https://hub.docker.com/r/ntanhprt/viewio-converter)

## Chạy nhanh (1 container)

```bash
mkdir -p ~/viewio-data
docker run -d --name viewio --restart unless-stopped \
  -u "$(id -u):$(id -g)" -e HOME=/tmp \
  -e MINIO_ROOT_USER=admin -e MINIO_ROOT_PASSWORD='doi-mat-khau-nay-123' \
  -p 9000:9000 -p 9001:9001 \
  -v ~/viewio-data:/data \
  ntanhprt/viewio:2025-04-22 server /data --console-address ":9001"
```

Mở **http://localhost:9001** và đăng nhập. S3 API ở cổng **9000**. Word `.docx`, Excel `.xlsx`, CSV, PDF, ảnh, Markdown, code xem được ngay.
Muốn xem thêm **PowerPoint và Word/Excel đời cũ** (`.pptx .ppt .doc .xls .odt .rtf`…) và có **thumbnail** cần chạy thêm converter — cách đơn giản nhất là bộ cài đầy đủ bên dưới.

## Cài đầy đủ (MinIO + converter) — khuyên dùng

```bash
git clone https://github.com/ntanhprt/ViewIO.git && cd ViewIO && ./install.sh
```
Script tải 2 image này, tạo mật khẩu ngẫu nhiên, chạy sẵn cả converter. Xem [docs/INSTALL.md](https://github.com/ntanhprt/ViewIO/blob/main/docs/INSTALL.md).

## Đã có MinIO đang chạy, có dữ liệu? Chỉ nâng cấp giao diện

Đổi `image:` của MinIO cũ sang `ntanhprt/viewio:2025-04-22` — cổng, dữ liệu, user, access key, mật khẩu **giữ nguyên**; rollback bằng cách đổi lại dòng đó.
Điều kiện: MinIO cũ phải là `RELEASE.2025-04-22T22-12-26Z` hoặc cũ hơn. Chi tiết (Docker Compose, `docker run`, binary/systemd, nhiều MinIO): [mục 3b](https://github.com/ntanhprt/ViewIO/blob/main/docs/INSTALL.md#3b-đã-có-minio-đang-chạy--chỉ-nâng-cấp-giao-diện-giữ-nguyên-mọi-thứ).

## Tag

| Tag | Ý nghĩa |
|---|---|
| `2025-04-22` | theo phiên bản lõi MinIO (nhận bản vá giao diện) |
| `1.0.0` | phiên bản ViewIO cố định |
| `latest` | bản mới nhất |

Chỉ có kiến trúc **linux/amd64**.

## Cấu hình

| Biến môi trường | Ý nghĩa |
|---|---|
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | tài khoản quản trị (mật khẩu ≥ 8 ký tự) |
| `DOCVIEW_CONVERTER_URL` | địa chỉ converter, ví dụ `http://converter:8080`; `off` để tắt xem Office |
| `MINIO_BROWSER_REDIRECT_URL` | URL công khai của giao diện khi đặt sau reverse proxy |
| `HOME` | đặt `/tmp` khi chạy bằng user thường (`-u 1000:1000`) |
| (các biến `MINIO_*` khác) | như MinIO chính thức |

| Cổng | Dùng cho |
|---|---|
| 9000 | S3 API |
| 9001 | Giao diện web |

Volume: `/data` (dữ liệu). Image có `minio` và `mc` ở `/usr/bin`, entrypoint là `minio`, nên tham số bắt đầu bằng `server ...` (không viết thêm chữ `minio`).

## Giấy phép

GNU AGPL v3 (MinIO và MinIO Console là AGPL; ViewIO là bản sửa đổi). Source đầy đủ: https://github.com/ntanhprt/ViewIO. Dự án không liên kết hay được xác nhận bởi MinIO, Inc.
