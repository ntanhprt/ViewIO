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

import React, { useEffect, useRef, useState } from "react";
import { renderAsync } from "docx-preview";
import { useFileData } from "./useFileData";
import { Loading, Problem } from "./ViewerShell";

interface IDocxViewerProps {
  path: string;
  onDownload: () => void;
}

const DocxViewer = ({ path, onDownload }: IDocxViewerProps) => {
  const { blob, loading, error } = useFileData(path);
  const host = useRef<HTMLDivElement | null>(null);
  const [rendered, setRendered] = useState(false);
  const [renderError, setRenderError] = useState("");
  // Bảng trong Word có độ rộng cố định, hay tràn ra ngoài lề trang: mặc định ép vừa khít, có thể xem nguyên bản
  const [fit, setFit] = useState(() => {
    try {
      return localStorage.getItem("viewio.docxFit") !== "0";
    } catch {
      return true;
    }
  });
  const toggleFit = () => {
    const next = !fit;
    setFit(next);
    try {
      localStorage.setItem("viewio.docxFit", next ? "1" : "0");
    } catch {
      // bỏ qua
    }
  };

  useEffect(() => {
    if (!blob || !host.current) {
      return;
    }
    renderAsync(blob, host.current, undefined, {
      inWrapper: true,
      breakPages: true,
      ignoreLastRenderedPageBreak: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
    })
      .then(() => setRendered(true))
      .catch((e) => setRenderError(e?.message || "Lỗi đọc file Word"));
  }, [blob]);

  if (error || renderError) {
    return (
      <Problem
        title="Không hiển thị được tài liệu Word"
        message={error || renderError}
        onDownload={onDownload}
      />
    );
  }

  return (
    <div className="dv-scroll">
      {rendered ? (
        <button
          type="button"
          className="dv-docx-toggle"
          onClick={toggleFit}
          title={
            fit
              ? "Bảng đang ép vừa khít trang. Bấm để xem nguyên bản (cuộn ngang)"
              : "Bảng đang ở nguyên bản. Bấm để ép vừa khít trang"
          }
          aria-label="Chế độ hiển thị bảng"
        >
          {fit ? (
            // vừa khít: hai mũi tên thu vào
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12h6M7 9l3 3-3 3" />
              <path d="M20 12h-6M17 9l-3 3 3 3" />
              <path d="M3 5v14M21 5v14" />
            </svg>
          ) : (
            // nguyên bản: bảng + mũi tên hai đầu
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="9" rx="1" />
              <path d="M3 9.5h18M9 5v9M15 5v9" />
              <path d="M5 19h14M8 16.5L5 19l3 2.5M16 16.5l3 2.5-3 2.5" />
            </svg>
          )}
        </button>
      ) : null}
      {loading || !rendered ? <Loading text="Đang dựng tài liệu..." /> : null}
      <div
        className={`dv-docx ${fit ? "dv-docx-fit" : "dv-docx-raw"}`}
        ref={host}
        style={{ display: rendered ? "block" : "none" }}
      />
    </div>
  );
};

export default DocxViewer;
