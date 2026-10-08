# ViewIO converter — Office → PDF và thumbnail

Dịch vụ nhỏ đi kèm [`ntanhprt/viewio`](https://hub.docker.com/r/ntanhprt/viewio): nhận file Word/Excel/PowerPoint (`doc docx docm rtf odt xls xlsx xlsm ods ppt pptx pps ppsx odp`) và trả về **PDF** để giao diện ViewIO xem trước.
Ngoài ra tạo **thumbnail** (WebP tối đa 250 px) cho chế độ xem lưới: ảnh, trang đầu PDF/Office, khung hình video (ffmpeg), phần đầu file text/code. Có cache theo nội dung file (mở lại cùng file là tức thì), giới hạn 100 MB, mặc định 2 lượt chuyển đổi đồng thời.

Mã nguồn / hướng dẫn: **https://github.com/ntanhprt/ViewIO**

## Cách dùng

Thường bạn không chạy riêng — `./install.sh` của ViewIO đã chạy sẵn. Nếu tự ghép với MinIO của mình (cùng network Docker):

```bash
docker run -d --name viewio-converter --restart unless-stopped -u 1000:1000 \
  --network <network-của-minio> -v viewio-converter-cache:/cache \
  ntanhprt/viewio-converter:1
# rồi đặt cho MinIO:  DOCVIEW_CONVERTER_URL=http://viewio-converter:8080
```

Thử trực tiếp (nếu publish cổng): `curl -X POST --data-binary @bai.pptx -H "X-File-Name: bai.pptx" http://localhost:8080/convert -o bai.pdf`

| Đường | Ý nghĩa |
|---|---|
| `POST /convert` | body = nội dung file, header `X-File-Name` = tên file → `application/pdf` |
| `POST /thumb` | body = nội dung file (hoặc phần đầu), headers `X-File-Name`, `X-Cache-Key` (sha256 hex) → `image/webp`, hoặc 422 nếu không hỗ trợ |
| `GET /thumb?key=<hex>` | tra cache: 200 ảnh / 204 đã biết không hỗ trợ / 404 chưa có |
| `GET /healthz` | `ok` |

| Biến môi trường | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | 8080 | cổng lắng nghe |
| `MAX_BYTES` | 104857600 | kích thước file tối đa |
| `CONCURRENCY` | 2 | số lượt chuyển đổi Office→PDF song song |
| `THUMB_CONCURRENCY` | 4 | số thumbnail dựng song song |
| `THUMB_CACHE_DAYS` | 60 | số ngày giữ thumbnail trong cache |
| `CONVERT_TIMEOUT` | 120 | giây tối đa cho mỗi file |
| `CACHE_DIR` / `CACHE_DAYS` | /cache / 7 | thư mục và số ngày giữ cache |
| `ALLOW_ORIGIN` | `*` | CORS (ViewIO gọi qua proxy cùng origin nên không cần) |

## Bảo mật

Dịch vụ chạy LibreOffice trên file do người dùng cung cấp và **không có xác thực**. **Không mở cổng ra Internet/LAN**: chỉ để MinIO (ViewIO) gọi qua mạng nội bộ Docker — ViewIO đã chặn người chưa đăng nhập trước khi chuyển tiếp.

Tag: `1`, `1.0.0`, `latest`. Chỉ linux/amd64. Giấy phép AGPL v3, source ở link trên.
