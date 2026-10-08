#!/usr/bin/env bash
# ViewIO — cài đặt MinIO + giao diện ViewIO bằng 1 lệnh.
#   ./install.sh                         # cài với cấu hình mặc định, mật khẩu ngẫu nhiên
#   ./install.sh --console-port 21031 --api-port 21030 --data-dir /data/viewio
# Chạy lại bất cứ lúc nào để cập nhật (build lại + khởi động lại, KHÔNG mất dữ liệu).
set -euo pipefail
cd "$(dirname "$0")"

C_RED=$'\e[31m'; C_GRN=$'\e[32m'; C_YEL=$'\e[33m'; C_OFF=$'\e[0m'
say()  { echo "${C_GRN}==>${C_OFF} $*"; }
warn() { echo "${C_YEL}!!${C_OFF} $*"; }
die()  { echo "${C_RED}LỖI:${C_OFF} $*" >&2; exit 1; }

usage() {
  cat <<USAGE
Cách dùng: ./install.sh [tùy chọn]
  --user NAME           tên quản trị (mặc định viewio-admin)
  --password PASS       mật khẩu quản trị (>= 8 ký tự; bỏ trống = sinh ngẫu nhiên)
  --api-port N          cổng S3 API (mặc định 9000)
  --console-port N      cổng giao diện web (mặc định 9001)
  --bind ADDR           địa chỉ lắng nghe (mặc định 0.0.0.0; 127.0.0.1 = chỉ máy này)
  --data-dir PATH       thư mục dữ liệu (mặc định ./data)
  --no-start            tạo .env + build image, không khởi động
  --build-only          CHỈ build 2 image (viewio/minio, viewio/converter): không tạo .env, không đụng cổng/dữ liệu
                        (dùng để nâng cấp MinIO đã có sẵn — xem docs/INSTALL.md mục 4)
  -y, --yes             không hỏi gì cả
  -h, --help            xem hướng dẫn này
Các tùy chọn chỉ có tác dụng khi tạo .env lần đầu; muốn đổi sau này hãy sửa .env rồi ./viewio.sh restart.
USAGE
}

OPT_USER=""; OPT_PASS=""; OPT_API=""; OPT_CON=""; OPT_BIND=""; OPT_DATA=""; NO_START=0; BUILD_ONLY=0; YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --user) OPT_USER="${2:?}"; shift 2;;
    --password) OPT_PASS="${2:?}"; shift 2;;
    --api-port) OPT_API="${2:?}"; shift 2;;
    --console-port) OPT_CON="${2:?}"; shift 2;;
    --bind) OPT_BIND="${2:?}"; shift 2;;
    --data-dir) OPT_DATA="${2:?}"; shift 2;;
    --no-start) NO_START=1; shift;;
    --build-only) BUILD_ONLY=1; shift;;
    -y|--yes) YES=1; shift;;
    -h|--help) usage; exit 0;;
    *) usage; die "Tùy chọn không hợp lệ: $1";;
  esac
done

# ---------- 1. Kiểm tra môi trường ----------
say "Kiểm tra môi trường..."
command -v docker >/dev/null || die "Chưa cài Docker. Xem docs/INSTALL.md mục 'Chuẩn bị'."
docker info >/dev/null 2>&1 || die "Không kết nối được Docker daemon. Docker đã chạy chưa? User hiện tại có trong nhóm 'docker' không (sudo usermod -aG docker \$USER rồi đăng nhập lại)?"
docker compose version >/dev/null 2>&1 || die "Cần Docker Compose v2 (lệnh 'docker compose'). Xem docs/INSTALL.md."
FREE_GB=$(df -Pk . | awk 'NR==2{printf "%d", $4/1024/1024}')
[ "${FREE_GB:-0}" -ge 8 ] || warn "Ổ đĩa hiện chỉ còn ~${FREE_GB}GB trống; quá trình build cần khoảng 8GB."
MEM_GB=$(awk '/MemTotal/{printf "%d", $2/1024/1024}' /proc/meminfo 2>/dev/null || echo 8)
[ "${MEM_GB:-8}" -ge 6 ] || warn "RAM ~${MEM_GB}GB: build giao diện có thể bị thiếu bộ nhớ (khuyến nghị >= 6GB, hoặc thêm swap)."

# ---------- 1b. Chế độ chỉ build ----------
if [ "$BUILD_ONLY" -eq 1 ]; then
  say "Chỉ build image (không tạo .env, không khởi động, không đụng tới MinIO đang chạy)..."
  VIEWIO_ROOT_USER=build VIEWIO_ROOT_PASSWORD=build-only-not-used DOCKER_BUILDKIT=1 docker compose build
  say "Xong. Image đã có: viewio/minio:2025-04-22 và viewio/converter:1"
  say "Bước tiếp theo: docs/INSTALL.md mục 4 (nâng cấp MinIO đã cài tại chỗ)."
  exit 0
fi

# ---------- 2. Tạo .env ----------
rand_pass() { head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24; }
CREATED_ENV=0
if [ ! -f .env ]; then
  say "Tạo file cấu hình .env"
  cp .env.example .env
  PASS="${OPT_PASS:-$(rand_pass)}"
  [ "${#PASS}" -ge 8 ] || die "Mật khẩu phải có ít nhất 8 ký tự."
  setenv() { # setenv KEY VALUE
    local k="$1" v="$2"
    v="${v//\\/\\\\}"; v="${v//&/\\&}"; v="${v//|/\\|}"
    sed -i "s|^${k}=.*|${k}=${v}|" .env
  }
  setenv VIEWIO_ROOT_PASSWORD "$PASS"
  setenv VIEWIO_UID "$(id -u)"
  setenv VIEWIO_GID "$(id -g)"
  [ -z "$OPT_USER" ] || setenv VIEWIO_ROOT_USER "$OPT_USER"
  [ -z "$OPT_API"  ] || setenv VIEWIO_API_PORT "$OPT_API"
  [ -z "$OPT_CON"  ] || setenv VIEWIO_CONSOLE_PORT "$OPT_CON"
  [ -z "$OPT_BIND" ] || setenv VIEWIO_BIND "$OPT_BIND"
  [ -z "$OPT_DATA" ] || setenv VIEWIO_DATA_DIR "$OPT_DATA"
  chmod 600 .env
  CREATED_ENV=1
else
  say "Dùng lại .env có sẵn (giữ nguyên cấu hình và mật khẩu)."
  [ -z "$OPT_USER$OPT_PASS$OPT_API$OPT_CON$OPT_BIND$OPT_DATA" ] || warn "Bỏ qua các tùy chọn dòng lệnh vì .env đã tồn tại. Hãy sửa trực tiếp .env."
fi
set -a; . ./.env; set +a
[ -n "${VIEWIO_ROOT_PASSWORD:-}" ] && [ "${#VIEWIO_ROOT_PASSWORD}" -ge 8 ] || die "VIEWIO_ROOT_PASSWORD trong .env trống hoặc < 8 ký tự."

# ---------- 3. Kiểm tra cổng + thư mục dữ liệu ----------
port_busy() { ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$1\$"; }
RUNNING=$(docker ps --filter name=viewio-minio --format '{{.Names}}' | head -1 || true)
if [ -z "$RUNNING" ]; then
  for p in "$VIEWIO_API_PORT" "$VIEWIO_CONSOLE_PORT"; do
    port_busy "$p" && die "Cổng $p đang bị chương trình khác dùng. Sửa VIEWIO_API_PORT / VIEWIO_CONSOLE_PORT trong .env (hoặc xóa .env rồi chạy lại với --api-port/--console-port)."
  done
fi
DATA_DIR="$VIEWIO_DATA_DIR"
case "$DATA_DIR" in /*) ;; *) DATA_DIR="$PWD/${DATA_DIR#./}";; esac
mkdir -p "$DATA_DIR" || die "Không tạo được thư mục dữ liệu $DATA_DIR"
[ -w "$DATA_DIR" ] || die "Không có quyền ghi vào $DATA_DIR"
say "Dữ liệu sẽ nằm ở: $DATA_DIR"

# ---------- 4. Build ----------
say "Build image (lần đầu mất ~8-15 phút: tải thư viện + biên dịch giao diện và MinIO)..."
DOCKER_BUILDKIT=1 docker compose build
[ "$NO_START" -eq 0 ] || { say "Đã build xong. Khởi động bằng: ./viewio.sh start"; exit 0; }

# ---------- 5. Khởi động ----------
say "Khởi động ViewIO..."
docker compose up -d

say "Chờ MinIO sẵn sàng..."
OK=0
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${VIEWIO_API_PORT}/minio/health/ready" >/dev/null 2>&1; then OK=1; break; fi
  sleep 2
done
[ "$OK" -eq 1 ] || { docker compose logs --tail 40 minio; die "MinIO chưa sẵn sàng sau 2 phút. Xem log ở trên (hoặc ./viewio.sh logs)."; }

HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
echo "${C_GRN}=============== ViewIO đã chạy ===============${C_OFF}"
echo " Giao diện web : http://localhost:${VIEWIO_CONSOLE_PORT}   (mạng LAN: http://${HOST_IP:-<ip-máy>}:${VIEWIO_CONSOLE_PORT})"
echo " S3 API        : http://localhost:${VIEWIO_API_PORT}"
echo " Tài khoản     : ${VIEWIO_ROOT_USER}"
if [ "$CREATED_ENV" -eq 1 ]; then
echo " Mật khẩu      : ${VIEWIO_ROOT_PASSWORD}   (lưu trong file .env — hãy ghi lại)"
else
echo " Mật khẩu      : xem VIEWIO_ROOT_PASSWORD trong file .env"
fi
echo " Dữ liệu       : ${DATA_DIR}"
echo " Quản lý       : ./viewio.sh help"
echo "${C_GRN}==============================================${C_OFF}"
