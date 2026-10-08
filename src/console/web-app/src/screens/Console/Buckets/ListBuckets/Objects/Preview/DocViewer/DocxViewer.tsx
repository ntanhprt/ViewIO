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
      {loading || !rendered ? <Loading text="Đang dựng tài liệu..." /> : null}
      <div
        className="dv-docx"
        ref={host}
        style={{ display: rendered ? "block" : "none" }}
      />
    </div>
  );
};

export default DocxViewer;
