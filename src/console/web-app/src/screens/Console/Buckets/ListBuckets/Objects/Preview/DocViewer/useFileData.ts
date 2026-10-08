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

import { useEffect, useState } from "react";

export interface FileData {
  blob: Blob | null;
  truncated: boolean;
  loading: boolean;
  error: string;
}

// Tải nội dung file về trình duyệt (cùng origin nên dùng luôn cookie phiên Console).
// `limit` > 0: chỉ đọc tối đa ngần đó byte rồi ngắt luồng (dùng cho file text lớn).
export const useFileData = (path: string, limit = 0): FileData => {
  const [state, setState] = useState<FileData>({
    blob: null,
    truncated: false,
    loading: true,
    error: "",
  });

  useEffect(() => {
    if (!path) {
      setState({ blob: null, truncated: false, loading: false, error: "" });
      return;
    }
    const ctrl = new AbortController();
    setState({ blob: null, truncated: false, loading: true, error: "" });

    (async () => {
      try {
        const res = await fetch(path, {
          credentials: "same-origin",
          signal: ctrl.signal,
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const type = res.headers.get("Content-Type") || "";

        if (!limit || !res.body) {
          const blob = await res.blob();
          setState({ blob, truncated: false, loading: false, error: "" });
          return;
        }

        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        let truncated = false;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          chunks.push(value);
          received += value.length;
          if (received >= limit) {
            truncated = true;
            ctrl.abort();
            break;
          }
        }
        const blob = new Blob(chunks as BlobPart[], { type });
        setState({
          blob: truncated ? blob.slice(0, limit) : blob,
          truncated,
          loading: false,
          error: "",
        });
      } catch (e: any) {
        if (e?.name === "AbortError") {
          return;
        }
        setState({
          blob: null,
          truncated: false,
          loading: false,
          error: e?.message || "Không tải được file",
        });
      }
    })();

    return () => ctrl.abort();
  }, [path, limit]);

  return state;
};

export const formatBytes = (n?: number | null): string => {
  if (n === undefined || n === null || isNaN(n)) {
    return "";
  }
  if (n < 1024) {
    return `${n} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
};
