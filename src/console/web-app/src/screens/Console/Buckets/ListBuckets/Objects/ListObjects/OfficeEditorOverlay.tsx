// ViewIO: khung toàn màn hình nhúng trình soạn thảo ONLYOFFICE (trang /docview/office/editor).
// Document Server tự lưu khi đóng; ViewIO ghi bản mới về kho (giữ bản cũ nếu bucket bật versioning).

import React, { useEffect } from "react";
import { baseName, drawioEditorUrl, officeEditorUrl } from "./fileOps";
import "./ObjectContextMenu.css";

const OfficeEditorOverlay = ({
  bucket,
  objectKey,
  kind = "office",
  onClose,
}: {
  bucket: string;
  objectKey: string;
  kind?: "office" | "drawio";
  onClose: () => void;
}) => {
  // trang soạn thảo (iframe cùng origin) báo đóng bằng postMessage
  useEffect(() => {
    const f = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.data && e.data.viewioClose) {
        onClose();
      }
    };
    window.addEventListener("message", f);
    return () => window.removeEventListener("message", f);
  }, [onClose]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div className="vio-office">
      <iframe
        className="vio-office-frame"
        title={baseName(objectKey)}
        src={kind === "drawio" ? drawioEditorUrl(bucket, objectKey) : officeEditorUrl(bucket, objectKey)}
        allow="clipboard-read; clipboard-write; fullscreen"
      />
      {/* Nút đóng nổi: thu gọn thành ✕, rê chuột vào thì hiện tên file + ghi chú tự lưu; bấm để đóng */}
      <button
        type="button"
        className="vio-office-fab"
        onClick={onClose}
        aria-label={`Đóng ${baseName(objectKey)}`}
      >
        <span className="vio-office-fab-x">✕</span>
        <span className="vio-office-fab-info">
          <b>{baseName(objectKey)}</b>
          <small>
            {kind === "drawio"
              ? "Tự động lưu khi sửa"
              : "Tự động lưu, bản sửa ghi về kho sau vài giây"}
          </small>
        </span>
        <span className="vio-office-fab-act">Đóng</span>
      </button>
    </div>
  );
};

export default OfficeEditorOverlay;
