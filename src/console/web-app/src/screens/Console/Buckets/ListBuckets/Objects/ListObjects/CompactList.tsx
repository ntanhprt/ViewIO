// ViewIO: chế độ "danh sách gọn" — icon nhỏ + tên, xếp theo cột như kiểu List của Windows.
// Click = chọn (Ctrl = thêm/bớt), double-click = mở thư mục / xem file.

import React, { ReactNode, useLayoutEffect, useRef, useState } from "react";
import { BucketObjectItem } from "./types";
import { displayFileIconName } from "./utils";
import { niceBytes } from "../../../../../../common/utils";
import "./CompactList.css";

const ROW_H = 28;

interface ICompactListProps {
  items: BucketObjectItem[];
  selected: string[];
  activeName: string | null;
  remeasureKey?: number;
  loading: boolean;
  emptyMessage?: ReactNode;
  onSelectOnly: (item: BucketObjectItem, additive: boolean) => void;
  onActivate: (item: BucketObjectItem) => void;
}

const CompactList = ({
  items,
  selected,
  activeName,
  remeasureKey,
  loading,
  emptyMessage,
  onSelectOnly,
  onActivate,
}: ICompactListProps) => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [h, setH] = useState(480);
  // độ rộng cột do người dùng kéo (theo số thứ tự cột); không có = tự khớp tên dài nhất của cột
  const [colW, setColW] = useState<Record<number, number>>({});

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) {
      return;
    }
    const measure = () => {
      const top = el.getBoundingClientRect().top;
      setH(
        Math.max(260, window.innerHeight - top - (remeasureKey ? 14 : 34)),
      );
    };
    measure();
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
  }, [remeasureKey]);

  if (items.length === 0) {
    return (
      <div className="cl-empty">
        {loading ? "Đang tải..." : emptyMessage || "Thư mục trống"}
      </div>
    );
  }

  const rows = Math.max(1, Math.floor((h - 16) / ROW_H));
  const selectedSet = new Set(selected);
  const nCols = Math.ceil(items.length / rows);
  const template = Array.from({ length: nCols }, (_, c) =>
    colW[c] ? `${colW[c]}px` : "max-content",
  ).join(" ");

  // kéo mép phải của một mục để đổi độ rộng cả cột; double-click mép để tự khớp lại
  const startResize = (e: React.MouseEvent, col: number) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = (e.currentTarget.parentElement as HTMLElement).offsetWidth;
    const move = (ev: MouseEvent) =>
      setColW((p) => ({
        ...p,
        [col]: Math.max(80, Math.round(startW + ev.clientX - startX)),
      }));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div
      ref={wrapRef}
      className="cl-wrap"
      style={{ height: h }}
    >
      <div
        className="cl-grid"
        style={{
          gridTemplateRows: `repeat(${rows}, ${ROW_H}px)`,
          gridTemplateColumns: template,
        }}
      >
        {items.map((item, idx) => {
          const base =
            item.name.split("/").filter(Boolean).pop() || item.name;
          const isFolder = item.name.endsWith("/");
          const tip = isFolder
            ? base
            : `${base}${item.size ? `\n${niceBytes(String(item.size))}` : ""}`;
          return (
            <div
              key={item.name + (item.version_id || "")}
              className={`cl-item ${selectedSet.has(item.name) ? "cl-sel" : ""} ${
                activeName === item.name ? "cl-active" : ""
              }`}
              title={tip}
              data-vt-name={item.name}
              onClick={(e) => {
                if (e.detail <= 1) {
                  onSelectOnly(item, e.ctrlKey || e.metaKey);
                }
              }}
              onDoubleClick={() => onActivate(item)}
            >
              <span className="cl-icon">
                {displayFileIconName(item.name, true)}
              </span>
              <span className="cl-name">{base}</span>
              <span
                className="cl-grip"
                title="Kéo để đổi độ rộng cột; double-click để tự khớp theo nội dung"
                onMouseDown={(e) => startResize(e, Math.floor(idx / rows))}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  const col = Math.floor(idx / rows);
                  setColW((p) => {
                    const n = { ...p };
                    delete n[col];
                    return n;
                  });
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CompactList;
