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

import React, { useState } from "react";
import TextViewer from "./TextViewer";

interface IHtmlViewerProps {
  bucketName: string;
  objectName: string;
  fileName: string;
  sourcePath: string; // URL tải nội dung để xem mã nguồn
  onDownload: () => void;
}

// Đường /docview/raw/<bucket>/<đường dẫn> phục vụ file theo URL thật (xem api/docview_raw.go), nên
// các đường dẫn tương đối trong trang (ảnh, CSS, trang khác) tự hiểu theo thư mục đang duyệt.
export const rawBase = (bucketName: string) => {
  const basename = document.baseURI.replace(window.location.origin, "");
  return `${window.location.origin}${basename}docview/raw/${encodeURIComponent(bucketName)}/`;
};

const HtmlViewer = ({
  bucketName,
  objectName,
  fileName,
  sourcePath,
  onDownload,
}: IHtmlViewerProps) => {
  const [source, setSource] = useState(false);
  const [copied, setCopied] = useState(false);

  const encKey = objectName.split("/").map(encodeURIComponent).join("/");
  const pageUrl = rawBase(bucketName) + encKey;
  const folder = objectName.includes("/")
    ? objectName.slice(0, objectName.lastIndexOf("/") + 1)
    : "";
  const baseUrl =
    rawBase(bucketName) + folder.split("/").map(encodeURIComponent).join("/");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minWidth: 0,
        minHeight: 0,
      }}
    >
      <div className="dv-toolbar">
        <button
          className={`dv-btn ${!source ? "dv-active" : ""}`}
          onClick={() => setSource(false)}
        >
          Hiển thị trang
        </button>
        <button
          className={`dv-btn ${source ? "dv-active" : ""}`}
          onClick={() => setSource(true)}
        >
          Mã nguồn
        </button>
        <span className="dv-sep" />
        <a
          className="dv-btn"
          href={pageUrl}
          target="_blank"
          rel="noreferrer"
          title="Mở trang trong tab mới"
        >
          ↗ Tab mới
        </a>
        <span className="dv-sep" />
        <span
          className="dv-info"
          style={{ textAlign: "left", flex: "0 1 auto", minWidth: 0 }}
        >
          Base URL:
        </span>
        <input
          className="dv-input"
          readOnly
          value={baseUrl}
          style={{ flex: "1 1 280px", minWidth: 120 }}
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          className="dv-btn"
          onClick={() => {
            navigator.clipboard?.writeText(baseUrl).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Đã chép" : "Chép"}
        </button>
      </div>
      {source ? (
        <TextViewer
          path={sourcePath}
          fileName={fileName}
          markdown={false}
          onDownload={onDownload}
        />
      ) : (
        <React.Fragment>
          <div className="dv-notice">
            Hiển thị như trang web thật, đường dẫn tương đối theo thư mục hiện
            tại. Script bị tắt để an toàn.
          </div>
          <iframe
            className="dv-htmlframe"
            title={fileName}
            src={pageUrl}
            sandbox="allow-same-origin"
            referrerPolicy="same-origin"
          />
        </React.Fragment>
      )}
    </div>
  );
};

export default HtmlViewer;
