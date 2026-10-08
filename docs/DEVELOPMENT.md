# Dành cho người phát triển

## Cấu trúc repo

```
install.sh, viewio.sh        cài đặt / vận hành
Dockerfile                   3 giai đoạn: build UI (Node) -> build MinIO (Go) -> image chạy (Alpine)
docker-compose.yml, .env.example
converter/                   dịch vụ Office -> PDF (Python stdlib + LibreOffice)
src/console/                 MinIO Console v1.7.6 ĐÃ SỬA (giao diện web, Go + React)
src/minio/                   MinIO RELEASE.2025-04-22T22-12-26Z (go.mod có replace -> ../console)
samples/                     file mẫu để thử viewer
```

## Những gì đã sửa so với upstream

| Việc | Vị trí |
|---|---|
| Viewer tài liệu (PDF, ảnh, text/code, Markdown, CSV/Excel, docx, Office qua converter) | `src/console/web-app/src/screens/Console/Buckets/ListBuckets/Objects/Preview/` (`PreviewFileContent.tsx`, `PreviewFileModal.tsx`, thư mục `DocViewer/`) |
| Nhận diện loại file để xem | `.../Objects/utils.ts` (`extensionPreview`, `contentTypePreview`) |
| Double-click file → viewer | `.../Objects/ListObjects/ListObjectsTable.tsx` |
| Cây thư mục | `src/console/web-app/src/screens/Console/ObjectBrowser/FolderTree/`, gắn trong `Buckets/BucketDetails/BrowserHandler.tsx` |
| Menu trái thu nhỏ 80px → 40px; dòng kẻ hàng nhạt (`.rowLine`) | cuối `src/console/web-app/src/index.css` |
| Chế độ thumbnail: lưới ảo, chọn/mở/double-click | `.../Objects/ListObjects/ThumbnailGrid.tsx`, chọn bảng/lưới trong `ListObjectsTable.tsx` |
| Nút chuyển danh sách/thumbnail, cỡ thẻ, sắp xếp (nhớ trong localStorage `docview.listview`) | `.../ObjectBrowser/ViewModeToolbar.tsx`, `viewMode.ts`; gắn trong `BrowserBreadcrumbs.tsx` |
| Cột Size đứng trước Last Modified | `.../Objects/ListObjects/ListObjectsHelpers.tsx` |
| API thumbnail `/docview/thumb` (kiểm quyền bằng StatObject/GetObject của người dùng, khóa cache theo etag) | `src/console/api/docview_thumb.go` |
| Xem HTML như web thật (`/docview/raw/<bucket>/<key>`, CSP sandbox không script, tài nguyên gốc-tương-đối theo Referer) | `src/console/api/docview_raw.go` (+ route trong `docview_proxy.go`, `configure_console.go`), viewer `.../Preview/DocViewer/HtmlViewer.tsx` |
| Tạo thumbnail + cache đĩa | `converter/server.py` (Pillow, poppler `pdftoppm`, ffmpeg, LibreOffice) |
| Proxy `/docview/convert` (cùng origin để qua CSP, yêu cầu đã đăng nhập) | `src/console/api/docview_proxy.go` + 1 dòng route trong `api/configure_console.go` |
| Gắn Console tùy biến vào MinIO | cuối `src/minio/go.mod` (`replace github.com/minio/console => ../console`) |

Biến môi trường mới của MinIO: `DOCVIEW_CONVERTER_URL` (mặc định `http://docview-converter:8080`, `off` để tắt).

## Build và chạy thử không qua install.sh

```bash
docker compose build                   # cần .env hoặc export VIEWIO_ROOT_USER/PASSWORD tạm
docker compose up -d
```

Phát triển giao diện nhanh hơn (hot reload) cần Node 22 + pnpm: `cd src/console/web-app && pnpm install && pnpm start` (đặt `proxy` trong `package.json` trỏ tới một MinIO đang chạy).

## Vì sao source nằm trong repo này

Các repo gốc `minio/console` và thư viện UI `minio/mds` **đã bị gỡ khỏi GitHub** (kiểm tra 10/2026), nên không thể `git clone` upstream để build lại.
Source Console/MinIO ở đây được lấy từ Go module proxy (`proxy.golang.org/github.com/minio/{console,minio}`), thư viện `mds` v1.0.4 lấy từ fork
`github.com/openmaxio/mds` (cùng commit `027fb7f` mà `yarn.lock` gốc khóa). Phiên bản gói JS được khóa trong `src/console/web-app/pnpm-lock.yaml`.

Ghi chú build:
- `react-pdf` phải ghim đúng `9.1.1` (khớp `public/scripts/pdf.worker.min.mjs` pdf.js 4.4.168), nếu không viewer PDF báo lệch phiên bản API/Worker.
- Lỗi `canvas install ... Failed` khi `pnpm install` là bình thường.
- `TSC_COMPILE_ON_ERROR=true`: TypeScript mới hơn bản khóa của yarn sinh một cảnh báo kiểu cũ (`objectsWS used before assigned`) không liên quan code mới.

## Nâng phiên bản MinIO

Không đơn giản: upstream Console không còn, nên nâng MinIO lên bản mới nghĩa là phải **port** các sửa đổi ở bảng trên sang source Console/MinIO của bản đó
(nếu lấy được source). Hiện ViewIO cố định ở `RELEASE.2025-04-22T22-12-26Z`.

## Phát hành image lên Docker Hub

```bash
./install.sh --build-only --build                       # build ntanhprt/viewio:2025-04-22 và ntanhprt/viewio-converter:1
docker tag ntanhprt/viewio:2025-04-22 ntanhprt/viewio:1.0.0 && docker tag ntanhprt/viewio:2025-04-22 ntanhprt/viewio:latest
docker tag ntanhprt/viewio-converter:1 ntanhprt/viewio-converter:1.0.0 && docker tag ntanhprt/viewio-converter:1 ntanhprt/viewio-converter:latest
docker push --all-tags ntanhprt/viewio && docker push --all-tags ntanhprt/viewio-converter
```
Image chỉ linux/amd64. Nhãn OCI `org.opencontainers.image.source` trỏ về repo này (AGPL yêu cầu chỉ ra nơi lấy source).
`mc` trong image được lấy từ image `minio/minio` chính thức (build-arg `MC_IMAGE`).

Trang mô tả trên Docker Hub (Overview) lấy từ `docs/dockerhub-viewio.md` và `docs/dockerhub-converter.md`. Cập nhật:
`DOCKERHUB_USER=ntanhprt DOCKERHUB_TOKEN=<PAT quyền Read & Write> ./scripts/dockerhub-description.sh`
(hoặc dán nội dung vào mục Repository → Overview trên web).
