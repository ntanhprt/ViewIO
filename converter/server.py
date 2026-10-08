#!/usr/bin/env python3
"""Dịch vụ chuyển tài liệu Office -> PDF bằng LibreOffice (cho viewer của MinIO Console).

POST /convert   body = nội dung file, header X-File-Name = tên file (URL-encoded)
                -> 200 application/pdf
GET  /healthz   -> 200 ok
Chỉ dùng stdlib. Có cache theo sha256 nội dung để mở lại cùng file thì tức thì.
"""
import hashlib
import os
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

PORT = int(os.environ.get("PORT", "8080"))
MAX_BYTES = int(os.environ.get("MAX_BYTES", str(100 * 1024 * 1024)))
CONCURRENCY = int(os.environ.get("CONCURRENCY", "2"))
TIMEOUT = int(os.environ.get("CONVERT_TIMEOUT", "120"))
CACHE_DIR = os.environ.get("CACHE_DIR", "/cache")
CACHE_DAYS = int(os.environ.get("CACHE_DAYS", "7"))
ALLOW_ORIGIN = os.environ.get("ALLOW_ORIGIN", "*")

ALLOWED = {
    "doc", "dot", "docx", "docm", "rtf", "odt",
    "xls", "xlsx", "xlsm", "ods",
    "ppt", "pptx", "pps", "ppsx", "odp",
}
slots = threading.BoundedSemaphore(CONCURRENCY)
os.makedirs(CACHE_DIR, exist_ok=True)


def convert(data: bytes, ext: str) -> bytes:
    key = hashlib.sha256(data).hexdigest() + "." + ext
    cached = os.path.join(CACHE_DIR, key + ".pdf")
    if os.path.exists(cached):
        os.utime(cached)
        with open(cached, "rb") as f:
            return f.read()

    with slots:
        work = tempfile.mkdtemp(prefix="cv-")
        try:
            src = os.path.join(work, "input." + ext)
            with open(src, "wb") as f:
                f.write(data)
            profile = "file:///tmp/lo-" + uuid.uuid4().hex
            proc = subprocess.run(
                ["soffice", "--headless", "--norestore", "--nolockcheck",
                 "-env:UserInstallation=" + profile,
                 "--convert-to", "pdf", "--outdir", work, src],
                capture_output=True, timeout=TIMEOUT,
            )
            out = os.path.join(work, "input.pdf")
            if not os.path.exists(out):
                raise RuntimeError("LibreOffice không tạo được PDF: "
                                   + proc.stderr.decode("utf-8", "replace")[-300:])
            with open(out, "rb") as f:
                pdf = f.read()
            tmp = cached + "." + uuid.uuid4().hex
            with open(tmp, "wb") as f:
                f.write(pdf)
            os.replace(tmp, cached)
            return pdf
        finally:
            shutil.rmtree(work, ignore_errors=True)
            shutil.rmtree("/tmp/" + profile.split("/tmp/")[-1], ignore_errors=True)


def janitor():
    while True:
        time.sleep(3600)
        cutoff = time.time() - CACHE_DAYS * 86400
        for n in os.listdir(CACHE_DIR):
            p = os.path.join(CACHE_DIR, n)
            try:
                if os.path.getmtime(p) < cutoff:
                    os.remove(p)
            except OSError:
                pass


class Handler(BaseHTTPRequestHandler):
    server_version = "docview-converter"

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", ALLOW_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "X-File-Name, Content-Type")
        self.send_header("Access-Control-Max-Age", "600")

    def _text(self, code, msg):
        body = msg.encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/healthz":
            self._text(200, "ok")
        else:
            self._text(404, "not found")

    def do_POST(self):
        if self.path.split("?")[0] != "/convert":
            return self._text(404, "not found")
        name = unquote(self.headers.get("X-File-Name", ""))
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        if ext not in ALLOWED:
            return self._text(415, "Định dạng không được hỗ trợ: ." + ext)
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0:
            return self._text(411, "Thiếu Content-Length")
        if length > MAX_BYTES:
            return self._text(413, "File quá lớn")
        data = self.rfile.read(length)
        try:
            pdf = convert(data, ext)
        except subprocess.TimeoutExpired:
            return self._text(504, "Chuyển đổi quá thời gian cho phép")
        except Exception as e:  # noqa: BLE001
            return self._text(500, str(e))
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Content-Length", str(len(pdf)))
        self.end_headers()
        self.wfile.write(pdf)

    def log_message(self, fmt, *args):
        print("%s %s" % (self.address_string(), fmt % args), flush=True)


if __name__ == "__main__":
    threading.Thread(target=janitor, daemon=True).start()
    print("docview-converter listening on :%d" % PORT, flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
