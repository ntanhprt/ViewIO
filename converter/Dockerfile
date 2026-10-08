FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer libreoffice-calc libreoffice-impress \
      fonts-liberation fonts-noto-core fonts-dejavu-core fonts-crosextra-carlito fonts-crosextra-caladea \
 && rm -rf /var/lib/apt/lists/*
# Thumbnail: ảnh (Pillow), trang đầu PDF (poppler), khung hình video (ffmpeg). Lớp riêng để cache LibreOffice ở trên.
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils ffmpeg \
 && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir pillow==11.0.0
RUN useradd -m -u 1000 conv && mkdir /cache && chown conv /cache
LABEL org.opencontainers.image.title="ViewIO converter (Office to PDF via LibreOffice)" \
      org.opencontainers.image.source="https://github.com/ntanhprt/ViewIO" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.version="1.1.0"
COPY server.py /app/server.py
USER conv
ENV HOME=/home/conv
EXPOSE 8080
CMD ["python3", "/app/server.py"]
