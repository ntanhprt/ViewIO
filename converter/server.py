#!/usr/bin/env python3
"""Dịch vụ phụ của ViewIO: đổi Office -> PDF (LibreOffice) và tạo thumbnail.

POST /convert   body = nội dung file, header X-File-Name (URL-encoded)      -> 200 application/pdf
POST /thumb     body = nội dung file (hoặc phần đầu file), headers:
                  X-File-Name (URL-encoded), X-Cache-Key (sha256 hex 64 ký tự) -> 200 image/webp
                  422 nếu định dạng không tạo được thumbnail (đã nhớ để lần sau trả nhanh)
GET  /thumb?key=<hex>   tra cache: 200 image/webp | 204 đã biết là không tạo được | 404 chưa có
GET  /healthz   -> 200 ok

Chỉ phụ thuộc: Python stdlib, Pillow, poppler-utils (pdftoppm), ffmpeg, LibreOffice.
Cache trên đĩa (CACHE_DIR): PDF đã đổi theo sha256 nội dung, thumbnail theo khóa do Console tính.
"""
import hashlib
import io
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

from PIL import Image, ImageDraw, ImageFont, ImageOps

PORT = int(os.environ.get("PORT", "8080"))
MAX_BYTES = int(os.environ.get("MAX_BYTES", str(100 * 1024 * 1024)))
CONCURRENCY = int(os.environ.get("CONCURRENCY", "2"))
THUMB_CONCURRENCY = int(os.environ.get("THUMB_CONCURRENCY", "4"))
TIMEOUT = int(os.environ.get("CONVERT_TIMEOUT", "120"))
CACHE_DIR = os.environ.get("CACHE_DIR", "/cache")
CACHE_DAYS = int(os.environ.get("CACHE_DAYS", "7"))
THUMB_CACHE_DAYS = int(os.environ.get("THUMB_CACHE_DAYS", "60"))
ALLOW_ORIGIN = os.environ.get("ALLOW_ORIGIN", "*")

THUMB_W, THUMB_H = 360, 270
Image.MAX_IMAGE_PIXELS = 120_000_000  # chặn "decompression bomb"

ALLOWED = {
    "doc", "dot", "docx", "docm", "rtf", "odt",
    "xls", "xlsx", "xlsm", "ods",
    "ppt", "pptx", "pps", "ppsx", "odp",
}
IMAGE_EXT = {"png", "jpg", "jpeg", "gif", "bmp", "webp", "tif", "tiff", "ico", "jfif", "jpe"}
VIDEO_EXT = {"mp4", "mov", "avi", "mkv", "webm", "mpeg", "mpg", "m4v", "wmv", "flv"}
TEXT_EXT = {
    "txt", "log", "md", "markdown", "csv", "tsv", "json", "jsonl", "yaml", "yml", "xml", "html", "htm",
    "css", "js", "jsx", "ts", "tsx", "py", "java", "go", "rs", "c", "h", "cpp", "hpp", "cs", "php", "rb",
    "sh", "bash", "sql", "ini", "conf", "cfg", "toml", "env", "properties", "gradle", "kt", "swift", "lua",
    "vue", "scss", "r",
}

slots = threading.BoundedSemaphore(CONCURRENCY)
thumb_slots = threading.BoundedSemaphore(THUMB_CONCURRENCY)
THUMB_DIR = os.path.join(CACHE_DIR, "thumbs")
os.makedirs(CACHE_DIR, exist_ok=True)
os.makedirs(THUMB_DIR, exist_ok=True)

KEY_RE = re.compile(r"^[0-9a-f]{64}$")
FONT_PATHS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
]


class Unsupported(Exception):
    """Định dạng/nội dung không tạo được thumbnail (không phải lỗi hệ thống)."""


# ------------------------------------------------------------------ Office -> PDF
def convert(data: bytes, ext: str) -> bytes:
    key = hashlib.sha256(data).hexdigest() + "." + ext
    cached = os.path.join(CACHE_DIR, key + ".pdf")
    if os.path.exists(cached):
        os.utime(cached)
        with open(cached, "rb") as f:
            return f.read()

    with slots:
        work = tempfile.mkdtemp(prefix="cv-")
        profile = "file:///tmp/lo-" + uuid.uuid4().hex
        try:
            src = os.path.join(work, "input." + ext)
            with open(src, "wb") as f:
                f.write(data)
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


# ------------------------------------------------------------------ Thumbnail
def _tile(img: Image.Image, mode: str) -> Image.Image:
    """Đưa ảnh vào khung THUMB_W x THUMB_H.  cover: lấp đầy + cắt giữa (ảnh/video);
    contain: giữ nguyên toàn bộ trên nền xám nhạt (trang tài liệu)."""
    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "LA", "P"):
        rgba = img.convert("RGBA")
        bg = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        img = Image.alpha_composite(bg, rgba)
    img = img.convert("RGB")
    if mode == "cover":
        return ImageOps.fit(img, (THUMB_W, THUMB_H), method=Image.LANCZOS, centering=(0.5, 0.5))
    canvas = Image.new("RGB", (THUMB_W, THUMB_H), (241, 243, 245))
    scale = min(THUMB_W / img.width, THUMB_H / img.height)
    size = (max(1, int(img.width * scale)), max(1, int(img.height * scale)))
    img = img.resize(size, Image.LANCZOS)
    canvas.paste(img, ((THUMB_W - size[0]) // 2, (THUMB_H - size[1]) // 2))
    return canvas


def _encode(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=80, method=4)
    return buf.getvalue()


def _thumb_image(data: bytes) -> Image.Image:
    try:
        img = Image.open(io.BytesIO(data))
        if img.format == "JPEG":
            img.draft("RGB", (THUMB_W * 2, THUMB_H * 2))  # giải mã nhanh JPEG lớn
        img.load()
        return _tile(img, "cover")
    except Exception as e:  # noqa: BLE001
        raise Unsupported("ảnh không đọc được: %s" % e)


def _pdf_first_page(pdf_bytes: bytes) -> Image.Image:
    work = tempfile.mkdtemp(prefix="pd-")
    try:
        with open(os.path.join(work, "in.pdf"), "wb") as f:
            f.write(pdf_bytes)
        subprocess.run(
            ["pdftoppm", "-f", "1", "-l", "1", "-png", "-scale-to", "720", "-singlefile",
             os.path.join(work, "in.pdf"), os.path.join(work, "out")],
            capture_output=True, timeout=40, check=True)
        out = os.path.join(work, "out.png")
        if not os.path.exists(out):
            raise Unsupported("PDF không có trang đầu")
        img = Image.open(out)
        img.load()
        return _tile(img, "contain")
    except subprocess.SubprocessError as e:
        raise Unsupported("PDF không dựng được: %s" % e)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _thumb_video(data: bytes, ext: str) -> Image.Image:
    work = tempfile.mkdtemp(prefix="vd-")
    try:
        src = os.path.join(work, "in." + ext)
        with open(src, "wb") as f:
            f.write(data)
        out = os.path.join(work, "out.png")
        for seek in (["-ss", "1"], []):  # thử lấy khung hình ở giây thứ 1, không được thì khung đầu
            try:
                subprocess.run(
                    ["ffmpeg", "-v", "error", "-y", "-i", src] + seek +
                    ["-frames:v", "1", "-vf", "scale=720:-2", out],
                    capture_output=True, timeout=45, check=True)
            except subprocess.SubprocessError:
                pass
            if os.path.exists(out) and os.path.getsize(out) > 0:
                break
        if not (os.path.exists(out) and os.path.getsize(out) > 0):
            raise Unsupported("video không lấy được khung hình")
        img = Image.open(out)
        img.load()
        return _tile(img, "cover")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _thumb_text(data: bytes) -> Image.Image:
    text = data[:4096].decode("utf-8", "replace")
    text = "".join(ch if (ch == "\n" or ch == "\t" or ch >= " ") else " " for ch in text)
    lines = [ln.expandtabs(4).rstrip() for ln in text.splitlines()][:14]
    if not any(lines):
        raise Unsupported("file trống")
    font = None
    for p in FONT_PATHS:
        if os.path.exists(p):
            font = ImageFont.truetype(p, 12)
            break
    font = font or ImageFont.load_default()
    img = Image.new("RGB", (THUMB_W, THUMB_H), (251, 251, 252))
    d = ImageDraw.Draw(img)
    y = 12
    for ln in lines:
        d.text((14, y), (ln[:44] + "…") if len(ln) > 44 else ln, fill=(52, 58, 66), font=font)
        y += 18
    d.rectangle([0, 0, THUMB_W - 1, THUMB_H - 1], outline=(222, 226, 230))
    return img


def make_thumb(data: bytes, name: str) -> bytes:
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    with thumb_slots:
        if ext in IMAGE_EXT:
            img = _thumb_image(data)
        elif ext == "pdf":
            img = _pdf_first_page(data)
        elif ext in ALLOWED:
            try:
                pdf = convert(data, ext)
            except Exception as e:  # noqa: BLE001
                raise Unsupported("không đổi được sang PDF: %s" % e)
            img = _pdf_first_page(pdf)
        elif ext in VIDEO_EXT:
            img = _thumb_video(data, ext)
        elif ext in TEXT_EXT:
            img = _thumb_text(data)
        else:
            raise Unsupported("định dạng .%s chưa hỗ trợ thumbnail" % ext)
        return _encode(img)


def thumb_path(key: str, suffix: str) -> str:
    return os.path.join(THUMB_DIR, key + suffix)


def janitor():
    while True:
        time.sleep(3600)
        for base, days in ((CACHE_DIR, CACHE_DAYS), (THUMB_DIR, THUMB_CACHE_DAYS)):
            cutoff = time.time() - days * 86400
            for n in os.listdir(base):
                p = os.path.join(base, n)
                try:
                    if os.path.isfile(p) and os.path.getmtime(p) < cutoff:
                        os.remove(p)
                except OSError:
                    pass


class Handler(BaseHTTPRequestHandler):
    server_version = "docview-converter"

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", ALLOW_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "X-File-Name, X-Cache-Key, Content-Type")
        self.send_header("Access-Control-Max-Age", "600")

    def _text(self, code, msg):
        body = msg.encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _empty(self, code):
        self.send_response(code)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _image(self, data):
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "image/webp")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/healthz":
            return self._text(200, "ok")
        if u.path == "/thumb":
            key = (parse_qs(u.query).get("key") or [""])[0]
            if not KEY_RE.match(key):
                return self._text(400, "key không hợp lệ")
            p = thumb_path(key, ".webp")
            if os.path.exists(p):
                os.utime(p)
                with open(p, "rb") as f:
                    return self._image(f.read())
            n = thumb_path(key, ".none")
            if os.path.exists(n):
                os.utime(n)
                return self._empty(204)
            return self._text(404, "chưa có")
        return self._text(404, "not found")

    def _read_body(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0:
            self._text(411, "Thiếu Content-Length")
            return None
        if length > MAX_BYTES:
            self._text(413, "File quá lớn")
            return None
        return self.rfile.read(length)

    def do_POST(self):
        path = self.path.split("?")[0]
        if path == "/convert":
            return self._post_convert()
        if path == "/thumb":
            return self._post_thumb()
        return self._text(404, "not found")

    def _post_convert(self):
        name = unquote(self.headers.get("X-File-Name", ""))
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        if ext not in ALLOWED:
            return self._text(415, "Định dạng không được hỗ trợ: ." + ext)
        data = self._read_body()
        if data is None:
            return
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

    def _post_thumb(self):
        key = self.headers.get("X-Cache-Key", "")
        if not KEY_RE.match(key):
            return self._text(400, "X-Cache-Key không hợp lệ")
        name = unquote(self.headers.get("X-File-Name", ""))
        data = self._read_body()
        if data is None:
            return
        # Có thể một request khác đã tạo xong trong lúc này
        p = thumb_path(key, ".webp")
        if os.path.exists(p):
            with open(p, "rb") as f:
                return self._image(f.read())
        try:
            webp = make_thumb(data, name)
        except Unsupported as e:
            open(thumb_path(key, ".none"), "wb").close()
            return self._text(422, str(e))
        except subprocess.TimeoutExpired:
            return self._text(504, "Tạo thumbnail quá thời gian")
        except Exception as e:  # noqa: BLE001
            return self._text(500, str(e))
        tmp = p + "." + uuid.uuid4().hex
        with open(tmp, "wb") as f:
            f.write(webp)
        os.replace(tmp, p)
        self._image(webp)

    def log_message(self, fmt, *args):
        print("%s %s" % (self.address_string(), fmt % args), flush=True)


if __name__ == "__main__":
    threading.Thread(target=janitor, daemon=True).start()
    print("docview-converter listening on :%d" % PORT, flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
