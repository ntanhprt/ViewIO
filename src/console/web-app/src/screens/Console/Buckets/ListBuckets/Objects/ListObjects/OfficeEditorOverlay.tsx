// ViewIO: khung toàn màn hình nhúng trình soạn thảo ONLYOFFICE (trang /docview/office/editor).
// Document Server tự lưu khi đóng; ViewIO ghi bản mới về kho (giữ bản cũ nếu bucket bật versioning).

import React, { useEffect } from "react";
import { baseName, officeEditorUrl } from "./fileOps";
import "./ObjectContextMenu.css";

const OfficeEditorOverlay = ({
  bucket,
  objectKey,
  onClose,
}: {
  bucket: string;
  objectKey: string;
  onClose: () => void;
}) => {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div className="vio-office">
      <div className="vio-office-bar">
        <b className="vio-office-title">{baseName(objectKey)}</b>
        <span className="vio-office-hint">Tự động lưu. Bấm “Đóng” khi xong, bản sửa được ghi về kho sau vài giây.</span>
        <button type="button" className="vio-btn vio-primary" onClick={onClose}>
          Đóng
        </button>
      </div>
      <iframe
        className="vio-office-frame"
        title={baseName(objectKey)}
        src={officeEditorUrl(bucket, objectKey)}
        allow="clipboard-read; clipboard-write; fullscreen"
      />
    </div>
  );
};

export default OfficeEditorOverlay;
