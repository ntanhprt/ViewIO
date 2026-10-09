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

import React, { useEffect, useMemo, useState } from "react";
import { Loading, Problem } from "./ViewerShell";
import { useFileData } from "./useFileData";

interface IDrawioViewerProps {
  path: string;
  onDownload: () => void;
}

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

// Trình xem draw.io (viewer-static.min.js, đóng gói sẵn trong public/drawio nên chạy được khi
// không có Internet). Chạy trong iframe sandbox KHÔNG có allow-same-origin: sơ đồ do người khác
// tải lên không đụng được tới cookie/phiên đăng nhập của Console.
const DrawioViewer = ({ path, onDownload }: IDrawioViewerProps) => {
  const { blob, loading, error } = useFileData(path);
  const [xml, setXml] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      return;
    }
    blob.text().then(setXml);
  }, [blob]);

  const srcDoc = useMemo(() => {
    if (!xml) {
      return "";
    }
    const basename = document.baseURI.replace(window.location.origin, "");
    const script = `${window.location.origin}${basename}drawio/viewer-static.min.js`;
    const cfg = JSON.stringify({
      highlight: "#0000ff",
      nav: true,
      resize: false,
      "auto-fit": true,
      toolbar: "pages zoom layers lightbox",
      "toolbar-nohide": true,
      xml,
    });
    return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#fff}
.mxgraph{width:100%;height:100%;max-width:100%;box-sizing:border-box}
</style></head><body>
<div class="mxgraph" data-mxgraph="${esc(cfg)}"></div>
<script src="${esc(script)}"></script></body></html>`;
  }, [xml]);

  if (error) {
    return (
      <Problem
        title="Không tải được sơ đồ"
        message={error}
        onDownload={onDownload}
      />
    );
  }
  if (loading || xml === null) {
    return <Loading />;
  }
  return (
    <iframe
      className="dv-htmlframe"
      title="draw.io"
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-popups"
    />
  );
};

export default DrawioViewer;
