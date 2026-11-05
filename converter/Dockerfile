FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer libreoffice-calc libreoffice-impress \
      fonts-liberation fonts-noto-core fonts-dejavu-core fonts-crosextra-carlito fonts-crosextra-caladea \
 && rm -rf /var/lib/apt/lists/*
# Font miễn phí hay gặp trong tài liệu (để bản xem trước giống Word thật): Arimo/Tinos/Cousine (= Arial/Times/Courier về độ rộng),
# Roboto, Open Sans, Lato, Inter, Source Sans, Fira, Noto đầy đủ (kể cả CJK, emoji, tiếng Việt). Lớp riêng để cache.
RUN apt-get update && apt-get install -y --no-install-recommends \
      fonts-croscore fonts-liberation2 fonts-roboto fonts-open-sans fonts-lato fonts-inter \
      fonts-firacode fonts-hack fonts-cantarell fonts-freefont-ttf fonts-dejavu-extra fonts-noto-extra fonts-noto-ui-core \
      fonts-noto-cjk fonts-noto-color-emoji fonts-opensymbol fonts-quicksand fonts-comfortaa fonts-linuxlibertine fonts-texgyre fontconfig \
 && rm -rf /var/lib/apt/lists/*
# Font có bản quyền (Arial, Times New Roman, Calibri, Tahoma, Segoe UI...) KHÔNG đóng vào image công khai: đặt file .ttf/.otf vào thư mục
# fonts/ cạnh docker-compose.yml, compose mount vào /usr/share/fonts/truetype/custom, container nạp lại khi khởi động (xem CMD).
RUN mkdir -p /usr/share/fonts/truetype/custom
# Thumbnail: ảnh (Pillow), trang đầu PDF (poppler), khung hình video (ffmpeg). Lớp riêng để cache LibreOffice ở trên.
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils ffmpeg \
 && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir pillow==11.0.0
RUN useradd -m -u 1000 conv && mkdir /cache && chown conv /cache
LABEL org.opencontainers.image.title="ViewIO converter (Office to PDF via LibreOffice)" \
      org.opencontainers.image.source="https://github.com/ntanhprt/ViewIO" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.version="1.2.0"
COPY server.py /app/server.py
USER conv
ENV HOME=/home/conv
EXPOSE 8080
# fc-cache nạp font vừa mount vào /usr/share/fonts/truetype/custom trước khi LibreOffice chạy
CMD ["sh", "-c", "fc-cache -f >/dev/null 2>&1; exec python3 /app/server.py"]
