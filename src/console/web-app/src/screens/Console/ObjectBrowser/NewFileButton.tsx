// ViewIO: nút "＋ Mới" (như Google Drive) — xổ menu các loại file/thư mục, tạo ngay trong thư mục hiện tại.
// Việc tạo thật nằm ở ObjectContextMenu (nhận sự kiện "viewio-new"), nên menu chuột phải và nút này dùng chung một luồng.

import React, { useEffect, useRef, useState } from "react";
import {
  drawioEnabled,
  NEW_TYPES,
  officeEnabled,
  requestNew,
} from "../Buckets/ListBuckets/Objects/ListObjects/fileOps";
import "./NewFileButton.css";

const GROUPS: [string, string[]][] = [
  ["", ["folder"]],
  ["Văn phòng", ["docx", "xlsx", "pptx"]],
  ["Sơ đồ", ["drawio"]],
  ["Văn bản", ["md", "txt", "csv", "json", "html", "yaml", "xml", "other"]],
];

const NewFileButton = ({ disabled }: { disabled?: boolean }) => {
  const [open, setOpen] = useState(false);
  const [office, setOffice] = useState(false);
  const [drawio, setDrawio] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    officeEnabled().then(setOffice);
    drawioEnabled().then(setDrawio);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const allowed = (id: string) => {
    const t = NEW_TYPES.find((x) => x.id === id);
    if (!t) {
      return false;
    }
    if (t.group === "office") {
      return office;
    }
    if (t.group === "drawio") {
      return drawio;
    }
    return true;
  };

  return (
    <div className="vio-new-wrap" ref={wrap}>
      <button
        type="button"
        className="vio-new-btn"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        title="Tạo mới trong thư mục này"
        aria-label="Tạo mới"
      >
        <span className="vio-new-plus">＋</span> Mới
      </button>
      {open ? (
        <div className="vio-new-menu">
          {GROUPS.map(([title, ids]) => {
            const items = ids.filter(allowed);
            if (items.length === 0) {
              return null;
            }
            return (
              <div key={title || "root"}>
                {title ? <div className="vio-new-sep">{title}</div> : null}
                {items.map((id) => {
                  const t = NEW_TYPES.find((x) => x.id === id)!;
                  return (
                    <button
                      type="button"
                      key={id}
                      className="vio-new-item"
                      onClick={() => {
                        setOpen(false);
                        requestNew(id);
                      }}
                    >
                      <span className="vio-new-badge" style={{ background: t.color }}>
                        {t.badge}
                      </span>
                      {t.label}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

export default NewFileButton;
