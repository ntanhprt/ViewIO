# Hướng dẫn cài đặt ViewIO

ViewIO gồm **2 container** cài cùng lúc bằng một lệnh:

| Container | Vai trò |
|---|---|
| `viewio-minio` | MinIO (kho S3) + giao diện ViewIO (viewer tài liệu, cây thư mục) |
| `viewio-converter` | Đổi PowerPoint/Word cũ/Excel cũ… sang PDF (LibreOffice) để xem trước. Không mở cổng ra ngoài |

Mục lục: [1. Yêu cầu](#1-yêu-cầu) · [2. Chuẩn bị máy](#2-chuẩn-bị-máy) · [3. Cài đặt mới](#3-cài-đặt) · **[3b. Đã có MinIO → chỉ nâng cấp giao diện](#3b-đã-có-minio-đang-chạy--chỉ-nâng-cấp-giao-diện-giữ-nguyên-mọi-thứ)** · [4. Tùy chọn](#4-tùy-chọn-cài-đặt) ·
[5. Kiểm tra sau cài](#5-kiểm-tra-sau-khi-cài) · [6. Vận hành](#6-vận-hành-hằng-ngày) · [7. Cập nhật](#7-cập-nhật) · [8. Sao lưu](#8-sao-lưu--khôi-phục) ·
[9. Chuyển dữ liệu sang ViewIO mới](#9-chuyển-dữ-liệu-sang-một-viewio-mới-không-nâng-cấp-tại-chỗ) · [10. HTTPS/Reverse proxy](#10-đặt-sau-reverse-proxy-https) · [11. Bảo mật](#11-bảo-mật) ·
[12. Gỡ cài đặt](#12-gỡ-cài-đặt) · [13. Xử lý sự cố](#13-xử-lý-sự-cố)

---

## 1. Yêu cầu

| Hạng mục | Tối thiểu | Ghi chú |
|---|---|---|
| Hệ điều hành | Linux x86_64 (Ubuntu 22.04/24.04, Debian 12, Rocky/Alma 9…) | ARM chưa kiểm thử |
| Docker Engine | 24 trở lên | kèm **Docker Compose v2** (lệnh `docker compose`) |
| RAM | 1 GB khi chạy; 6 GB nếu phải **build từ source** | chỉ cần 6 GB khi không tải được image dựng sẵn |
| Ổ đĩa | ~2 GB cho image (8 GB nếu build từ source) + dung lượng dữ liệu của bạn | hai image cuối ~1,2 GB (converter ~1 GB do có LibreOffice + ffmpeg để tạo thumbnail, MinIO ~150 MB) |
| Internet | chỉ cần **khi cài** để tải image | mặc định tải image dựng sẵn từ Docker Hub (`ntanhprt/viewio`, `ntanhprt/viewio-converter`). Chỉ khi build từ source mới cần thêm registry.npmjs.org, github.com, proxy.golang.org |
| Cổng | 9000 (S3 API) và 9001 (giao diện) | đổi được, xem [mục 4](#4-tùy-chọn-cài-đặt) |

> Chạy xong rồi thì **không cần Internet** nữa. Image chỉ có bản **linux/amd64** (máy x86_64); máy ARM phải build từ source (`./install.sh --build`, chưa kiểm thử).

## 2. Chuẩn bị máy

### 2.1 Cài Docker (Ubuntu/Debian)

Bỏ qua nếu đã có `docker compose version` chạy được.

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER      # để dùng docker không cần sudo
# Đăng xuất rồi đăng nhập lại (hoặc: newgrp docker)
docker compose version             # phải in ra "Docker Compose version v2.x"
```

### 2.2 Cài git (nếu chưa có)

```bash
sudo apt-get update && sudo apt-get install -y git
```

## 3. Cài đặt

```bash
git clone https://github.com/ntanhprt/ViewIO.git
cd ViewIO
./install.sh
```

Script sẽ lần lượt:

1. Kiểm tra Docker, Compose, dung lượng ổ đĩa, RAM.
2. Tạo file `.env` (cấu hình) từ `.env.example`, **sinh mật khẩu ngẫu nhiên 24 ký tự** cho tài khoản quản trị, điền UID/GID của bạn để file dữ liệu thuộc user thường.
3. Kiểm tra cổng 9000/9001 có đang bị chiếm không.
4. Tạo thư mục dữ liệu (`./data` mặc định).
5. **Tải hai image dựng sẵn từ Docker Hub** (~1–2 phút; ~0,8 GB). Nếu không tải được thì tự **build từ source** (~10–15 phút). Muốn ép build: `./install.sh --build`.
6. Khởi động và chờ MinIO báo sẵn sàng.
7. In ra địa chỉ truy cập, tài khoản, mật khẩu.

Kết quả cuối cùng trông như:

```
=============== ViewIO đã chạy ===============
 Giao diện web : http://localhost:9001   (mạng LAN: http://192.168.1.20:9001)
 S3 API        : http://localhost:9000
 Tài khoản     : viewio-admin
 Mật khẩu      : Xk3...(24 ký tự)   (lưu trong file .env — hãy ghi lại)
 Dữ liệu       : /đường/dẫn/ViewIO/data
 Quản lý       : ./viewio.sh help
==============================================
```

Mở trình duyệt vào địa chỉ "Giao diện web" và đăng nhập. Xong.

> **Mật khẩu ở đâu?** Trong file `.env` (quyền 600, đã nằm trong `.gitignore` nên không bị đẩy lên git). Đổi mật khẩu: xem [mục 6](#6-vận-hành-hằng-ngày).

## 3b. Đã có MinIO đang chạy → chỉ nâng cấp giao diện, giữ nguyên mọi thứ

Dành cho trường hợp bạn **đã cài MinIO, đang chạy ở các cổng riêng, đã có dữ liệu** và chỉ muốn có giao diện ViewIO mới.
**Không dùng `./install.sh` thường** (nó tạo một MinIO mới). Thay vào đó chỉ *thay binary/image MinIO bằng bản của ViewIO* — cùng phiên bản lõi `RELEASE.2025-04-22T22-12-26Z`, chỉ khác phần giao diện web.

| GIỮ NGUYÊN | THAY ĐỔI |
|---|---|
| Toàn bộ dữ liệu: bucket, object, version, tag, lifecycle… | Giao diện web (Console): viewer tài liệu, cây thư mục, double-click, menu gọn |
| User, group, policy, access key, service account | Thêm 1 container nhỏ `viewio-converter` (chỉ để xem PowerPoint/Office cũ) |
| Tài khoản root và mật khẩu | Image mới dựa trên Alpine (image gốc dựa trên UBI): khác hệ nền nhưng vẫn có đủ `minio` và `mc` ở `/usr/bin` |
| Các script đang dùng `docker exec <container> mc ...` | Không còn `docker-entrypoint.sh` của image gốc (tính năng `MINIO_USERNAME`/`MINIO_GROUPNAME` đã deprecated); nếu bạn dùng thì báo trước khi nâng cấp |
| Cổng, địa chỉ, volume, `user:`, biến môi trường, S3 API | |
| Ứng dụng đang kết nối vào MinIO | |

Đã kiểm thử: MinIO chính thức `RELEASE.2025-04-22` (có bucket, object, user và access key) → đổi sang image ViewIO → object, user, mật khẩu cũ **vẫn nguyên**, đăng nhập bằng user ứng dụng vẫn được → đổi ngược về image gốc cũng **vẫn nguyên**.

### 3b.0 Điều kiện — đọc trước khi làm

1. **Phiên bản MinIO hiện tại phải là `RELEASE.2025-04-22T22-12-26Z` hoặc cũ hơn.**
   Kiểm tra: `docker exec <tên-container> minio --version` (hoặc `minio --version` nếu chạy binary).
   Nếu MinIO của bạn **mới hơn** thì **dừng lại** — MinIO không hỗ trợ hạ phiên bản trên dữ liệu đã nâng cấp. Dùng cách ở [mục 9](#9-chuyển-dữ-liệu-sang-một-viewio-mới-không-nâng-cấp-tại-chỗ) (cài ViewIO mới rồi `mc mirror`).
2. **Sao lưu dữ liệu trước** ([mục 8](#8-sao-lưu--khôi-phục)). Việc nâng cấp không đổi định dạng dữ liệu, nhưng đây là dữ liệu thật — không bỏ qua bước này.
3. Ghi lại cấu hình đang chạy để so sánh/rollback: `docker inspect <tên-container> > minio-truoc-khi-nang-cap.json`.
4. Làm vào lúc ít người dùng: MinIO sẽ **ngắt vài giây** khi khởi động lại.

### 3b.1 Lấy image ViewIO (không ảnh hưởng MinIO đang chạy)

Cách nhanh nhất — chỉ cần tải image, **không cần clone repo**:

```bash
docker pull ntanhprt/viewio:2025-04-22
docker pull ntanhprt/viewio-converter:1
```

Hoặc (cùng kết quả) qua script: `git clone https://github.com/ntanhprt/ViewIO.git && cd ViewIO && ./install.sh --build-only`
(script tải image; nếu không tải được thì tự build từ source, 10–15 phút).

Cả hai cách đều **không** tạo `.env`, **không** kiểm tra/chiếm cổng, **không** khởi động gì, **không** đụng thư mục dữ liệu nào.
Chỉ cần lấy image **một lần** trên mỗi máy; nhiều MinIO trên cùng máy dùng chung các image này.

Bước tiếp theo tùy cách MinIO của bạn đang chạy:

### 3b.2-A. MinIO chạy bằng Docker Compose (phổ biến nhất)

Mở file `docker-compose.yml` của MinIO cũ và sửa **đúng các chỗ sau**, giữ nguyên mọi thứ còn lại (`ports`, `volumes`, `user`, `environment`, `command`…):

```diff
 services:
   minio:
-    image: minio/minio:RELEASE.2025-04-22T22-12-26Z
+    image: ntanhprt/viewio:2025-04-22
     command: server /data --console-address ":9001"
     environment:
       MINIO_ROOT_USER: ...        # giữ nguyên
       MINIO_ROOT_PASSWORD: ...    # giữ nguyên
+      DOCVIEW_CONVERTER_URL: http://converter:8080
+
+  converter:
+    image: ntanhprt/viewio-converter:1
+    restart: unless-stopped
+    user: "1000:1000"
+    volumes:
+      - converter-cache:/cache
+
+volumes:
+  converter-cache:
```

Lưu ý khi sửa:

- **Healthcheck giữ nguyên được** (kể cả `mc ready local`) vì image ViewIO có sẵn `mc`; lệnh `docker exec <container> mc ...` cũng chạy như trước. Nếu bạn muốn dùng `curl` thay `mc` thì cũng được (image có `curl`).
- Nếu compose có `pull_policy: never` hoặc script tự chạy `docker compose pull` với image khác: không ảnh hưởng, vì `ntanhprt/viewio` có sẵn trên Docker Hub.
- Nếu `command:` của bạn viết là `minio server ...` thì **bỏ chữ `minio` đi** → `server ...` (image ViewIO đã có sẵn entrypoint `minio`).
- Nếu MinIO nằm trong một **network riêng/`external`**, thêm đúng network đó cho service `converter` (để MinIO gọi được `http://converter:8080`).
- Compose cũ có `MINIO_BROWSER_REDIRECT_URL: http://localhost:...` thì **xóa dòng đó** (hoặc đặt đúng địa chỉ mọi người dùng để vào): nếu không, mọi link *Share* sẽ bắt đầu bằng `localhost` và người khác không mở được.
- Nếu bạn chạy MinIO bằng user thường kèm `HOME: /mc` (hoặc tương tự) → giữ nguyên.
- Dùng TLS (chứng chỉ ở `~/.minio/certs` hoặc `--certs-dir`)? Giữ nguyên volume và tham số như cũ; không có gì đổi.

Áp dụng (chỉ container `minio` bị tạo lại, converter được thêm mới):

```bash
cd <thư mục compose của MinIO cũ>
docker compose up -d
docker compose ps                      # minio phải "healthy", converter "Up"
docker exec <tên-container-minio> minio --version   # vẫn RELEASE.2025-04-22T22-12-26Z
```

**Rollback (đã thử):** đổi lại dòng `image:` về như cũ (và bỏ `DOCVIEW_CONVERTER_URL`/`converter` nếu muốn) rồi `docker compose up -d`. Dữ liệu không bị ảnh hưởng.

### 3b.2-B. MinIO chạy bằng `docker run` thuần

Khuyến nghị chuyển sang Compose như mục A cho dễ quản lý. Nếu vẫn dùng `docker run`:

```bash
# 1. xem lại toàn bộ tùy chọn container cũ (cổng, volume, env, user, network)
docker inspect <tên-container> --format '{{json .HostConfig}} {{json .Config.Env}}'

# 2. chạy converter trong CÙNG network với MinIO
docker run -d --name viewio-converter --restart unless-stopped -u 1000:1000 \
  --network <network-của-minio> -v viewio-converter-cache:/cache ntanhprt/viewio-converter:1

# 3. dừng + xóa container MinIO cũ (dữ liệu nằm ở volume/thư mục host nên KHÔNG mất)
docker stop <tên-container> && docker rm <tên-container>

# 4. chạy lại với CÙNG tùy chọn như cũ, chỉ đổi image và thêm biến DOCVIEW_CONVERTER_URL
docker run -d --name <tên-container> ...(các tùy chọn cũ)... \
  -e DOCVIEW_CONVERTER_URL=http://viewio-converter:8080 \
  ntanhprt/viewio:2025-04-22 server /data --console-address ":9001"
```

### 3b.2-C. MinIO chạy bằng binary / systemd (không Docker)

Binary ViewIO là **file tĩnh** (không phụ thuộc thư viện hệ thống), chạy được trên mọi Linux x86_64.

```bash
# 1. lấy binary ra khỏi image (trên máy đã docker pull ở 3b.1)
docker create --name viewio-extract ntanhprt/viewio:2025-04-22
docker cp viewio-extract:/usr/bin/minio ./minio-viewio
docker rm viewio-extract
./minio-viewio --version          # RELEASE.2025-04-22T22-12-26Z

# 2. converter vẫn chạy bằng Docker, chỉ nghe trên localhost
docker run -d --name viewio-converter --restart unless-stopped -u 1000:1000 \
  -p 127.0.0.1:18080:8080 -v viewio-converter-cache:/cache ntanhprt/viewio-converter:1

# 3. cho MinIO biết địa chỉ converter: thêm vào file biến môi trường của dịch vụ
#    (thường /etc/default/minio hoặc dòng Environment= trong unit systemd)
echo 'DOCVIEW_CONVERTER_URL=http://127.0.0.1:18080' | sudo tee -a /etc/default/minio

# 4. thay binary (có sao lưu binary cũ)
which minio                       # ví dụ /usr/local/bin/minio
sudo systemctl stop minio
sudo cp /usr/local/bin/minio /usr/local/bin/minio.bak-$(date +%F)
sudo install -m 755 ./minio-viewio /usr/local/bin/minio
sudo systemctl start minio
sudo systemctl status minio --no-pager
```

**Rollback:** `sudo systemctl stop minio && sudo cp /usr/local/bin/minio.bak-<ngày> /usr/local/bin/minio && sudo systemctl start minio`.
Máy không có Docker? Lấy binary ở máy khác (làm bước 1 ở đó) rồi chép file `minio-viewio` sang; phần xem PowerPoint/Office cũ cần converter nên có thể bỏ qua (Word `.docx`, Excel `.xlsx`, PDF, ảnh, Markdown… vẫn xem được, không cần converter).

### 3b.3 Có nhiều MinIO ở các cổng khác nhau?

Lặp lại bước 3b.2 cho **từng** MinIO. Chỉ `docker pull` một lần: các image dùng chung.
**Một converter dùng chung được cho nhiều MinIO** — chỉ cần mỗi MinIO trỏ `DOCVIEW_CONVERTER_URL` tới cùng converter đó (cùng network Docker, hoặc `http://<host>:<port>` nếu khác máy). Nếu muốn tách biệt hoàn toàn thì mỗi MinIO một converter cũng được. Giới hạn mặc định: 2 lượt chuyển đổi đồng thời.

Nâng cấp **lần lượt từng cái**, kiểm tra xong cái này mới sang cái khác.

### 3b.4 Kiểm tra sau khi nâng cấp

1. Đăng nhập giao diện web **bằng tài khoản/mật khẩu cũ** (không đổi).
2. Bucket và object cũ còn đủ; thử tải một file xuống.
3. Ứng dụng đang dùng S3 API vẫn kết nối bình thường (không cần sửa gì).
4. Mở một file PDF → **double-click** → viewer mới hiện ra. Thử một file `.pptx` để chắc converter hoạt động (1–3 giây).
5. Bấm dải mũi tên mỏng cạnh menu trái → cây thư mục.

Nếu bước 1–3 có vấn đề: **rollback ngay** theo hướng dẫn của cách bạn đã dùng, rồi kiểm tra log (`docker logs <container>`).

### 3b.5 Về sau

- Muốn lấy bản ViewIO mới: `docker pull ntanhprt/viewio:latest` (hoặc tag phiên bản cụ thể như `:1.0.0`), rồi `docker compose up -d` ở thư mục MinIO cũ (hoặc thay binary lại như 3b.2-C).
- Muốn quay về MinIO gốc: rollback như trên. ViewIO không để lại thay đổi nào trong dữ liệu.
- Chưa kiểm thử với MinIO cấu hình SSO (OpenID/LDAP): phần đăng nhập không bị sửa, nhưng hãy thử trên một bản sao trước.

---

## 4. Tùy chọn cài đặt

### 4.1 Tùy chọn dòng lệnh của `install.sh`

Chỉ có tác dụng khi **tạo `.env` lần đầu**.

| Tùy chọn | Ý nghĩa | Mặc định |
|---|---|---|
| `--user NAME` | tên tài khoản quản trị | `viewio-admin` |
| `--password PASS` | mật khẩu (≥ 8 ký tự) | sinh ngẫu nhiên |
| `--api-port N` | cổng S3 API | `9000` |
| `--console-port N` | cổng giao diện web | `9001` |
| `--bind ADDR` | địa chỉ lắng nghe; `127.0.0.1` = chỉ truy cập từ chính máy | `0.0.0.0` |
| `--data-dir PATH` | thư mục chứa dữ liệu | `./data` |
| `--no-start` | tạo `.env` + lấy image, chưa chạy | |
| `--build` | build từ source thay vì tải image Docker Hub | |
| `--build-only` | chỉ lấy image, không tạo `.env` (dùng khi nâng cấp MinIO có sẵn) | |
| `-y`, `--yes` | không hỏi | |

Ví dụ: cài vào ổ dữ liệu riêng, đổi cổng:

```bash
./install.sh --data-dir /mnt/data/viewio --api-port 21030 --console-port 21031
```

### 4.2 Các biến trong `.env`

Sửa file rồi chạy `./viewio.sh restart` để áp dụng.

| Biến | Ý nghĩa | Mặc định |
|---|---|---|
| `VIEWIO_ROOT_USER` / `VIEWIO_ROOT_PASSWORD` | tài khoản/mật khẩu quản trị | `viewio-admin` / ngẫu nhiên |
| `VIEWIO_API_PORT` | cổng S3 API trên máy chủ | `9000` |
| `VIEWIO_CONSOLE_PORT` | cổng giao diện web | `9001` |
| `VIEWIO_BIND` | địa chỉ lắng nghe | `0.0.0.0` |
| `VIEWIO_DATA_DIR` | thư mục dữ liệu (nên dùng đường dẫn tuyệt đối) | `./data` |
| `VIEWIO_UID`, `VIEWIO_GID` | chạy MinIO bằng user này | user chạy `install.sh` |
| `TZ` | múi giờ | `Asia/Ho_Chi_Minh` |
| `VIEWIO_REDIRECT_URL` | URL công khai của giao diện khi đặt sau reverse proxy. **Để trống** thì link *Share* tự lấy theo địa chỉ người dùng đang mở; đã đặt giá trị thì MỌI link Share dùng đúng địa chỉ đó | trống |
| `VIEWIO_CONVERTER_URL` | địa chỉ dịch vụ `converter` (đổi Office→PDF **và tạo thumbnail**); `off` để tắt | `http://converter:8080` |

> Muốn **tắt hẳn** xem Office/PowerPoint (tiết kiệm ~1 GB và 1 container; khi đó chế độ thumbnail chỉ hiện icon theo loại file): đặt `VIEWIO_CONVERTER_URL=off`, xóa khối `converter:` trong `docker-compose.yml`, rồi `./viewio.sh restart`. Word `.docx`, Excel `.xlsx`, PDF… vẫn xem được vì chúng chạy ngay trên trình duyệt.

### Chế độ tập trung (ẩn các thanh phía trên)

Ở hàng đường dẫn của Object Browser, cạnh nút chuyển danh sách/thumbnail có hai nút:
- **Gọn**: ẩn thanh tiêu đề (tìm kiếm, cài đặt…) và khung thông tin bucket (tên, dung lượng, Rewind/Refresh/Upload) — nội dung chiếm khoảng 89% chiều cao màn hình (mặc định ~63%). Bấm lại để hiện.
- **Toàn màn hình**: ẩn thêm hàng đường dẫn và menu trái — nội dung chiếm khoảng 96–98%. Thoát bằng chấm **✕** nhỏ ở góc trên phải, hoặc phím **Esc** (khi không mở viewer). Trong chế độ này vẫn điều hướng được bằng cây thư mục (dải mũi tên bên trái), double-click file để xem, kéo-thả để tải lên.
Lựa chọn được nhớ trong trình duyệt và chỉ áp dụng cho Object Browser; các trang khác của Console không bị ảnh hưởng.

**Khi đang xem nội dung một file** (viewer) thanh tiêu đề có thêm:
- **A− / 100% / A+**: đổi cỡ nội dung (70%–200%), bấm số % để về chuẩn.
- **Thanh nút**: thu gọn/hiện thanh công cụ riêng của loại file (zoom, trang, tìm kiếm…).
- **Thu gọn menu**: thu thanh tiêu đề còn một dải mỏng (chỉ tên file và nút biểu tượng).
- **Toàn màn hình** (hoặc phím **F**): ẩn cả hai thanh, dùng toàn màn hình của trình duyệt; di chuột lên mép trên để hiện lại thanh trong 2,5 giây. **Esc** để thu nhỏ, Esc lần nữa để đóng viewer.
Các lựa chọn này được nhớ trong trình duyệt.

### Xem file HTML như trang web thật

- Mở file `.html`/`.htm` bằng double-click: trang được dựng trong khung riêng tại địa chỉ `…/docview/raw/<bucket>/<đường dẫn>`. Vì vậy `<img src="img/a.png">`, `<link href="css/style.css">`, `<a href="trang-khac.html">` tự hiểu theo **thư mục chứa file** (thanh công cụ hiện *Base URL* của thư mục đó); đường dẫn gốc như `/img/a.png` được hiểu là gốc của **bucket**. File trong thư mục `a/b/` có `index.html` thì mở `a/b/` cũng ra trang đó.
- **Script bị tắt** (sandbox, CSP `script-src 'none'`) vì nội dung do người khác tải lên: trang tĩnh (HTML + CSS + ảnh + font) hiển thị đầy đủ, còn trang cần JavaScript (SPA, biểu đồ…) sẽ không chạy. Tài nguyên ngoài (CDN ảnh/CSS/font bằng https) vẫn tải như web thường.
- Cần quyền đọc file; mọi tài nguyên đi qua quyền của người đang đăng nhập. Nút **Mã nguồn** xem HTML gốc có tô màu cú pháp.

### Thumbnail (chế độ xem lưới) hoạt động thế nào

- Thumbnail do dịch vụ `converter` tạo và **lưu cache trên đĩa** (volume `converter-cache`, giữ 60 ngày không dùng); trình duyệt cũng cache 24 giờ. File đổi nội dung thì thumbnail tự làm lại.
- Lấy từ nội dung: ảnh (png, jpg, gif, webp, bmp, tiff…), trang đầu của PDF và Office (doc/docx, xls/xlsx, ppt/pptx, odt…), khung hình của video (mp4, mov, mkv, webm…), và phần đầu của file text/CSV/JSON/Markdown/code. Loại khác (zip, audio, file lạ), file quá lớn, hoặc không tạo được → hiện **icon theo loại file**.
- Giới hạn đọc: ảnh ≤ 25 MB, PDF ≤ 40 MB, Office ≤ 25 MB, video chỉ đọc 24 MB đầu, text 4 KB đầu. Cần quyền đọc file mới thấy thumbnail (dùng chính tài khoản đang đăng nhập).
- Chỉnh bằng biến môi trường của service `converter` (trong `docker-compose.yml`): `THUMB_CONCURRENCY` (số thumbnail dựng song song, mặc định 4), `THUMB_CACHE_DAYS` (mặc định 60), `CACHE_DAYS` (cache PDF, mặc định 7).

## 5. Kiểm tra sau khi cài

1. `./viewio.sh status` → hai container `viewio-minio` (healthy) và `viewio-converter` đang `Up`; dòng "MinIO: sẵn sàng".
2. Mở giao diện web, đăng nhập, bấm **Buckets → Create Bucket**, tạo bucket `demo`.
3. Vào **Object Browser → demo → Upload**, tải lên vài file mẫu (có sẵn trong thư mục `samples/` của repo: PDF, docx, xlsx, pptx, csv, md, ảnh…).
4. **Double-click** vào một file → viewer toàn màn hình mở ra. Thử với `trinh-bay.pptx` (mất 1–3 giây vì phải đổi sang PDF).
5. Bấm **dải mũi tên mỏng cạnh menu trái** để mở **Cây thư mục**; bấm tên thư mục để chuyển tới đó.

Kiểm tra S3 API từ máy khác (cần `mc` hoặc `aws` CLI):

```bash
mc alias set viewio http://<ip-máy>:9000 viewio-admin '<mật-khẩu>'
mc ls viewio
```

## 6. Vận hành hằng ngày

```bash
./viewio.sh status        # trạng thái, dung lượng dữ liệu
./viewio.sh start|stop    # bật / tắt
./viewio.sh restart       # áp dụng thay đổi trong .env
./viewio.sh logs -f       # xem log trực tiếp (Ctrl+C để thoát);  ./viewio.sh logs minio
./viewio.sh health        # live/ready
./viewio.sh info          # địa chỉ, tài khoản
```

- Container có `restart: unless-stopped`: **tự chạy lại sau khi máy khởi động lại** (miễn là bạn chưa chủ động `stop`).
- **Đổi mật khẩu quản trị:** sửa `VIEWIO_ROOT_PASSWORD` trong `.env` → `./viewio.sh restart`.
- **Đổi cổng:** sửa `VIEWIO_API_PORT` / `VIEWIO_CONSOLE_PORT` → `./viewio.sh restart`.
- **Tạo user/access key cho ứng dụng:** trong giao diện, mục **Identity → Users** hoặc **Access Keys**. Không nên dùng tài khoản root cho ứng dụng.

## 7. Cập nhật

```bash
cd ViewIO
./viewio.sh update      # git pull + tải image mới + chạy lại
```

Dữ liệu (`VIEWIO_DATA_DIR`) và `.env` không bị đụng tới. MinIO ngắt vài giây khi khởi động lại.

## 8. Sao lưu & khôi phục

Toàn bộ dữ liệu nằm trong `VIEWIO_DATA_DIR` (và cấu hình trong `.env`).

**Cách đơn giản và chắc chắn nhất (có ngắt dịch vụ):**

```bash
./viewio.sh stop
rsync -aH --info=progress2 "$(grep ^VIEWIO_DATA_DIR .env | cut -d= -f2)/" /nơi/sao/lưu/viewio-data/
cp .env /nơi/sao/lưu/viewio.env
./viewio.sh start
```

**Không ngắt dịch vụ:** dùng `mc mirror` sang MinIO/ổ khác:

```bash
mc mirror --preserve viewio/demo /nơi/sao/lưu/demo
```

**Khôi phục:** cài ViewIO mới → `./viewio.sh stop` → chép dữ liệu về lại `VIEWIO_DATA_DIR` (đúng chủ sở hữu `VIEWIO_UID:VIEWIO_GID`) → dùng cùng `VIEWIO_ROOT_USER/PASSWORD` → `./viewio.sh start`.

## 9. Chuyển dữ liệu sang một ViewIO mới (không nâng cấp tại chỗ)

> Nếu bạn chỉ muốn **giữ MinIO hiện tại và đổi giao diện** → dùng [mục 3b](#3b-đã-có-minio-đang-chạy--chỉ-nâng-cấp-giao-diện-giữ-nguyên-mọi-thứ), đó là cách ít rủi ro nhất.

Mục này dành cho: MinIO cũ **mới hơn** `RELEASE.2025-04-22`, hoặc bạn muốn tách sang máy/ổ khác.

**Cách A — sao chép qua S3 (an toàn, dùng được cho mọi phiên bản MinIO cũ):**

```bash
# Cài ViewIO mới (mục 3), rồi:
mc alias set cu  http://<minio-cu>:<cổng> <user-cu> <mật-khẩu-cu>
mc alias set moi http://<viewio>:9000    viewio-admin '<mật-khẩu-mới>'
mc mirror --preserve --overwrite cu/<bucket> moi/<bucket>     # lặp cho từng bucket
mc admin policy ... / mc admin user ...                        # tạo lại user, policy nếu cần
```
`mc mirror` không chép user/policy/access key — phải tạo lại ở ViewIO mới.

**Cách B — dùng lại thư mục dữ liệu cũ** (chỉ khi MinIO cũ cùng bản hoặc cũ hơn `RELEASE.2025-04-22`):
sao lưu → dừng MinIO cũ → `./install.sh --data-dir <thư-mục-dữ-liệu-cũ>` → sửa `.env` cho đúng `VIEWIO_ROOT_USER/PASSWORD` **cũ** → `./viewio.sh start`.
(Cách này tương đương mục 3b nhưng bạn chuyển hẳn sang quản lý bằng `viewio.sh`.)

---

## 10. Đặt sau reverse proxy (HTTPS)

Đặt `VIEWIO_REDIRECT_URL=https://viewio.example.com` trong `.env`, rồi `./viewio.sh restart`. Ví dụ Nginx cho giao diện (cổng 9001):

```nginx
server {
    listen 443 ssl http2;
    server_name viewio.example.com;
    # ssl_certificate / ssl_certificate_key ...

    client_max_body_size 0;            # cho phép tải lên file lớn
    proxy_request_buffering off;
    proxy_buffering off;

    location / {
        proxy_pass http://127.0.0.1:9001;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Giao diện dùng WebSocket (đường /ws) để hiển thị danh sách file
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
```

Với S3 API (cổng 9000) làm tương tự ở một `server` riêng (không cần WebSocket). Nếu ứng dụng dùng chữ ký S3, giữ nguyên header `Host`.

## 11. Bảo mật

- **Mật khẩu root mạnh**; không dùng tài khoản root trong ứng dụng, tạo user/access key riêng với policy tối thiểu.
- Chỉ dùng trong mạng nội bộ? Đặt `VIEWIO_BIND=127.0.0.1` nếu chỉ truy cập từ chính máy, hoặc mở firewall cho đúng dải mạng cần thiết.
- Đưa ra Internet thì **bắt buộc HTTPS** (mục 10).
- `viewio-converter` **không publish cổng**; chỉ giao diện ViewIO gọi được qua `/docview/convert` và yêu cầu đã đăng nhập. Nó chạy LibreOffice trên file người dùng tải lên, nên đừng mở cổng converter ra ngoài.
- File `.env` chứa mật khẩu: giữ quyền `600`, không commit lên git (đã có trong `.gitignore`).

## 12. Gỡ cài đặt

```bash
./viewio.sh down                         # xóa container, GIỮ dữ liệu và .env
docker compose down -v --rmi local       # xóa thêm cache converter và image
rm -rf ./data                            # CHỈ khi chắc chắn muốn xóa vĩnh viễn dữ liệu
```

## 13. Xử lý sự cố

| Hiện tượng | Nguyên nhân thường gặp / cách xử lý |
|---|---|
| `install.sh`: *Không kết nối được Docker daemon* | Docker chưa chạy (`sudo systemctl start docker`) hoặc user chưa trong nhóm `docker` (mục 2.1, nhớ đăng nhập lại) |
| *Cần Docker Compose v2* | Cài plugin: `sudo apt-get install docker-compose-plugin` |
| *Cổng 9000/9001 đang bị chiếm* | Dịch vụ khác (có thể là MinIO cũ). Xem `ss -ltnp | grep 9001`, hoặc đổi cổng bằng `--console-port`/`--api-port` |
| Build chết giữa chừng ở bước `react-scripts build` (có chữ `Killed`) | Thiếu RAM. Thêm swap 4GB: `sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`, rồi chạy lại `./install.sh` |
| Không tải được image từ Docker Hub (`pull access denied`/timeout) | Kiểm tra Internet/proxy của Docker; tên image phải đúng `ntanhprt/viewio:2025-04-22`. Script sẽ tự chuyển sang build từ source |
| Build từ source lỗi tải thư viện (npm/github/golang proxy) | Máy không ra được Internet hoặc bị chặn. Cấu hình proxy cho Docker, hoặc build ở máy có mạng rồi `docker save`/`docker load` image sang máy đích |
| Báo lỗi `canvas install ... Failed` khi build | **Bình thường**, bỏ qua (gói tùy chọn của pdf.js) |
| Đăng nhập được nhưng `MinIO chưa sẵn sàng` mãi | `./viewio.sh logs minio`. Hay gặp: thư mục dữ liệu sai quyền → `sudo chown -R $(id -u):$(id -g) <thư-mục-dữ-liệu>` |
| `Permission denied` trong log MinIO | `VIEWIO_UID/GID` trong `.env` không khớp chủ sở hữu thư mục dữ liệu |
| Xem PowerPoint/Word cũ báo *Không kết nối được dịch vụ chuyển đổi* | `docker ps` xem `viewio-converter` có chạy không; `./viewio.sh logs converter`. Có thể bạn đã đặt `VIEWIO_CONVERTER_URL=off` |
| File Office lớn xem báo *quá lớn* | Giới hạn 100 MB cho xem trước Office; tải xuống để mở |
| Link **Share** bắt đầu bằng `http://localhost:...` nên người khác không mở được | MinIO đang có biến `MINIO_BROWSER_REDIRECT_URL` (hoặc `VIEWIO_REDIRECT_URL`) đặt là `localhost`. Xóa biến đó (hoặc đặt đúng địa chỉ người dùng truy cập, ví dụ `http://192.168.1.20:9001`) rồi tạo lại container; link đã tạo trước đó phải tạo lại. Khi nâng cấp MinIO có sẵn (mục 3b), kiểm tra compose cũ có dòng này không |
| Sau reverse proxy, danh sách file không hiện / không tải được | Thiếu header WebSocket (`Upgrade`/`Connection`) cho đường `/ws`; xem mục 10 |
| Quên mật khẩu | Xem `.env`; hoặc sửa `VIEWIO_ROOT_PASSWORD` rồi `./viewio.sh restart` |
| Cần bắt đầu lại từ đầu | `./viewio.sh down`, xóa `.env`, chạy lại `./install.sh` (dữ liệu giữ nguyên nếu không xóa thư mục data) |

Cần hỗ trợ thêm: mở issue tại https://github.com/ntanhprt/ViewIO/issues kèm đầu ra của `./viewio.sh status` và `./viewio.sh logs --tail=100`.
