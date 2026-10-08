#!/usr/bin/env bash
# ViewIO — lệnh vận hành hằng ngày
cd "$(dirname "$0")"
[ -f .env ] || { echo "Chưa có .env — hãy chạy ./install.sh trước."; exit 1; }
set -a; . ./.env; set +a

case "${1:-help}" in
  start)    docker compose up -d ;;
  stop)     docker compose stop ;;
  restart)  docker compose up -d --force-recreate ;;
  down)     docker compose down ;;          # xóa container, GIỮ dữ liệu
  status)   docker compose ps
            echo; curl -fsS "http://127.0.0.1:${VIEWIO_API_PORT}/minio/health/ready" >/dev/null 2>&1 && echo "MinIO: sẵn sàng" || echo "MinIO: CHƯA sẵn sàng"
            echo; du -sh "${VIEWIO_DATA_DIR}" 2>/dev/null ;;
  logs)     shift; docker compose logs "${@:---tail=100}" ;;
  info)     echo "Giao diện: http://localhost:${VIEWIO_CONSOLE_PORT}"
            echo "S3 API   : http://localhost:${VIEWIO_API_PORT}"
            echo "User     : ${VIEWIO_ROOT_USER}"
            echo "Dữ liệu  : ${VIEWIO_DATA_DIR}" ;;
  update)   git pull --ff-only 2>/dev/null || echo "(không phải bản git, bỏ qua git pull)"
            ./install.sh --yes ;;
  rebuild)  docker compose build --no-cache && docker compose up -d ;;
  health)   curl -fsS "http://127.0.0.1:${VIEWIO_API_PORT}/minio/health/live" && echo " live"
            curl -fsS "http://127.0.0.1:${VIEWIO_API_PORT}/minio/health/ready" && echo " ready" ;;
  help|*)   cat <<H
./viewio.sh <lệnh>
  start | stop | restart | down    bật / dừng / khởi động lại (tạo lại container) / gỡ container (giữ dữ liệu)
  status | health | info           trạng thái, kiểm tra sức khỏe, thông tin truy cập
  logs [-f] [service]              xem log (service: minio | converter)
  update                           lấy bản mới (git pull) rồi build + chạy lại
  rebuild                          build lại từ đầu không dùng cache
H
            ;;
esac
