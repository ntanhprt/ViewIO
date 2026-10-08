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

import React, { useEffect, useState } from "react";
import { useFileData } from "./useFileData";
import PdfViewer from "./PdfViewer";
import { Loading, Problem } from "./ViewerShell";

const MAX_BYTES = 100 * 1024 * 1024;

// Console proxy cùng origin tới dịch vụ chuyển đổi (LibreOffice), xem api/docview_proxy.go.
// Có thể trỏ thẳng nơi khác bằng: localStorage.setItem("docview.url", "https://host/convert")
export const converterUrl = (): string => {
  try {
    const custom = window.localStorage.getItem("docview.url");
    if (custom) {
      return custom;
    }
  } catch (e) {
    /* localStorage bị chặn: dùng mặc định */
  }
  const basename = document.baseURI.replace(window.location.origin, "");
  return `${window.location.origin}${basename}docview/convert`;
};

interface IOfficeViewerProps {
  path: string;
  fileName: string;
  size?: number;
  onDownload: () => void;
}

const OfficeViewer = ({ path, fileName, size, onDownload }: IOfficeViewerProps) => {
  const tooBig = !!size && size > MAX_BYTES;
  const { blob, loading, error } = useFileData(tooBig ? "" : path);
  const [pdf, setPdf] = useState<Blob | null>(null);
  const [failure, setFailure] = useState("");

  useEffect(() => {
    if (!blob) {
      return;
    }
    const ctrl = new AbortController();
    fetch(converterUrl(), {
      method: "POST",
      headers: { "X-File-Name": encodeURIComponent(fileName) },
      body: blob,
      signal: ctrl.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error((await res.text()) || `HTTP ${res.status}`);
        }
        setPdf(await res.blob());
      })
      .catch((e) => {
        if (e?.name !== "AbortError") {
          setFailure(
            e?.message === "Failed to fetch"
              ? "Không kết nối được dịch vụ chuyển đổi tài liệu."
              : e?.message,
          );
        }
      });
    return () => ctrl.abort();
  }, [blob, fileName]);

  if (tooBig) {
    return (
      <Problem
        title="File quá lớn để xem trước"
        message="Giới hạn xem trước tài liệu Office là 100 MB."
        onDownload={onDownload}
      />
    );
  }
  if (error || failure) {
    return (
      <Problem
        title="Không xem trước được tài liệu"
        message={error || failure}
        onDownload={onDownload}
      />
    );
  }
  if (pdf) {
    return <PdfViewer file={pdf} onDownload={onDownload} />;
  }
  return (
    <Loading
      text={loading ? "Đang tải tài liệu..." : "Đang chuyển đổi để xem (có thể mất vài giây)..."}
    />
  );
};

export default OfficeViewer;
