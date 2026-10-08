FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer libreoffice-calc libreoffice-impress \
      fonts-liberation fonts-noto-core fonts-dejavu-core fonts-crosextra-carlito fonts-crosextra-caladea \
 && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 1000 conv && mkdir /cache && chown conv /cache
COPY server.py /app/server.py
USER conv
ENV HOME=/home/conv
EXPOSE 8080
CMD ["python3", "/app/server.py"]
