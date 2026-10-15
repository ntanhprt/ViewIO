// This file is part of MinIO Console Server
// Copyright (c) 2021 MinIO, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// ViewIO: upload file lớn theo từng phần để không vướng giới hạn kích thước mỗi request của
// proxy/Cloudflare (~100 MB). Server ghép lại bằng S3 multipart (xem api/docview_upload.go).

// File lớn hơn ngưỡng này sẽ được cắt nhỏ; phần còn lại vẫn đi đường upload cũ.
export const CHUNK_THRESHOLD = 64 * 1024 * 1024;
// Mỗi phần 32 MiB: dưới giới hạn 100 MB, đủ nhỏ để thử lại nhanh khi mạng chập chờn (tối đa ~320 GB/file).
export const CHUNK_SIZE = 32 * 1024 * 1024;
const MAX_RETRY = 3;

type Handler = (() => void) | null;
type ProgressFn = (e: { loaded: number; total: number }) => void;

interface HttpResult {
  status: number;
  text: string;
}

// Giả lập phần giao diện XMLHttpRequest mà ObjectManager/TrafficMonitor đang dùng
// (send, abort, onload, onerror, onabort, onloadend, upload.addEventListener) để cắm vào luồng upload sẵn có.
export class ChunkedUpload {
  status = 0;
  response = "";
  withCredentials = false;
  onload: Handler = null;
  onerror: Handler = null;
  onabort: Handler = null;
  onloadend: Handler = null;

  upload = {
    addEventListener: (type: string, fn: any) => {
      if (type === "progress") {
        this.progressFns.push(fn);
      } else if (type === "error") {
        this.errorFns.push(fn);
      }
    },
  };

  private progressFns: ProgressFn[] = [];
  private errorFns: Handler[] = [];
  private aborted = false;
  private current: XMLHttpRequest | null = null;
  private uploadId = "";

  constructor(
    private file: Blob,
    private bucket: string,
    private key: string,
    private contentType: string,
  ) {}

  open(_method?: string, _url?: string, _async?: boolean) {}
  setRequestHeader(_k: string, _v: string) {}

  send(_body?: any) {
    this.run();
  }

  abort() {
    this.aborted = true;
    this.current?.abort();
    this.abortRemote();
    this.onabort?.();
    this.onloadend?.();
  }

  private qs(extra: Record<string, string | number> = {}) {
    const p = new URLSearchParams({
      bucket: this.bucket,
      key: this.key,
      ...(this.uploadId ? { uploadId: this.uploadId } : {}),
    });
    Object.entries(extra).forEach(([k, v]) => p.set(k, String(v)));
    return p.toString();
  }

  private http(
    method: string,
    action: string,
    query: Record<string, string | number>,
    body?: Blob | string,
    onProgress?: (loaded: number) => void,
  ): Promise<HttpResult> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      this.current = xhr;
      xhr.open(method, `docview/upload/${action}?${this.qs(query)}`, true);
      xhr.withCredentials = false;
      if (typeof body === "string") {
        xhr.setRequestHeader("Content-Type", "application/json");
      }
      if (onProgress) {
        xhr.upload.addEventListener("progress", (e) => onProgress(e.loaded));
      }
      xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
      xhr.onerror = () => reject(new Error("network"));
      xhr.onabort = () => reject(new Error("abort"));
      xhr.send(body);
    });
  }

  private abortRemote() {
    if (this.uploadId) {
      const id = this.uploadId;
      this.uploadId = "";
      const x = new XMLHttpRequest();
      x.open(
        "POST",
        `docview/upload/abort?${new URLSearchParams({ bucket: this.bucket, key: this.key, uploadId: id })}`,
        true,
      );
      x.send();
    }
  }

  private fail(status: number, message: string) {
    this.status = status;
    this.response = JSON.stringify({ detailedMessage: message });
    this.abortRemote();
    this.onload?.();
    this.onloadend?.();
  }

  private emitProgress(loaded: number) {
    const total = this.file.size;
    this.progressFns.forEach((fn) => fn({ loaded, total }));
  }

  private async run() {
    try {
      const init = await this.http("POST", "init", {
        contentType: this.contentType || "",
      });
      if (init.status !== 200) {
        return this.fail(init.status, this.errMsg(init));
      }
      this.uploadId = JSON.parse(init.text).uploadId;

      const total = this.file.size;
      const parts: { part: number; etag: string }[] = [];
      let done = 0;
      for (let off = 0, n = 1; off < total; off += CHUNK_SIZE, n++) {
        if (this.aborted) {
          return;
        }
        const blob = this.file.slice(off, Math.min(off + CHUNK_SIZE, total));
        let res: HttpResult | null = null;
        for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
          try {
            res = await this.http("PUT", "part", { part: n }, blob, (l) =>
              this.emitProgress(done + l),
            );
            if (res.status === 200) {
              break;
            }
            // lỗi phía client (quyền, phiên hết hạn...) thì thử lại cũng vô ích
            if (res.status >= 400 && res.status < 500) {
              break;
            }
          } catch (e: any) {
            if (this.aborted) {
              return;
            }
            res = null;
          }
          await new Promise((r) => setTimeout(r, 800 * attempt));
        }
        if (this.aborted) {
          return;
        }
        if (!res) {
          this.errorFns.forEach((fn) => fn?.());
          this.onerror?.();
          this.abortRemote();
          this.onloadend?.();
          return;
        }
        if (res.status !== 200) {
          return this.fail(res.status, this.errMsg(res));
        }
        parts.push({ part: n, etag: JSON.parse(res.text).etag });
        done += blob.size;
        this.emitProgress(done);
      }

      const fin = await this.http("POST", "complete", {}, JSON.stringify(parts));
      if (fin.status < 200 || fin.status >= 300) {
        return this.fail(fin.status, this.errMsg(fin));
      }
      this.uploadId = "";
      this.status = 200;
      this.onload?.();
      this.onloadend?.();
    } catch (e: any) {
      if (this.aborted) {
        return;
      }
      this.errorFns.forEach((fn) => fn?.());
      this.onerror?.();
      this.abortRemote();
      this.onloadend?.();
    }
  }

  private errMsg(r: HttpResult): string {
    try {
      return JSON.parse(r.text).detailedMessage || `HTTP ${r.status}`;
    } catch (e) {
      return `HTTP ${r.status}`;
    }
  }
}
