// ViewIO: kéo chuột ở mép phải tiêu đề cột để đổi độ rộng; double-click mép cột để tự khớp theo nội dung
// (như Excel / Windows Explorer). Phủ lên bảng DataTable của MinIO (không sửa thư viện): đọc vị trí các ô
// tiêu đề [role="columnheader"] rồi đặt tay nắm kéo ngay mép phải mỗi ô.

import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import "./ColumnResizeHandles.css";

export interface IResizeCol {
  key: string; // khóa cột (elementKey)
  label: string; // chữ trên tiêu đề, dùng để tìm ô tiêu đề
}

interface IProps {
  containerRef: React.RefObject<HTMLDivElement>;
  cols: IResizeCol[];
  // đổi độ rộng cột (px)
  onResize: (key: string, width: number) => void;
  // tự khớp: trả về độ rộng mong muốn (px) của cột theo nội dung
  onAutoFit: (key: string) => number;
  // đổi gì ở đây thì đo lại vị trí
  deps: unknown[];
}

interface IHandle {
  key: string;
  left: number;
  top: number;
  height: number;
  width: number;
}

const ColumnResizeHandles = ({
  containerRef,
  cols,
  onResize,
  onAutoFit,
  deps,
}: IProps) => {
  const [handles, setHandles] = useState<IHandle[]>([]);
  const drag = useRef<{ key: string; x: number; w: number } | null>(null);

  const measure = useCallback(() => {
    const root = containerRef.current;
    if (!root) {
      return;
    }
    const rb = root.getBoundingClientRect();
    const heads = Array.from(
      root.querySelectorAll<HTMLElement>("[role='columnheader']"),
    );
    const out: IHandle[] = [];
    cols.forEach((c) => {
      const el = heads.find(
        (h) => (h.innerText || "").trim().toLowerCase().startsWith(c.label.toLowerCase()),
      );
      if (!el) {
        return;
      }
      const b = el.getBoundingClientRect();
      out.push({
        key: c.key,
        left: b.right - rb.left,
        top: b.top - rb.top,
        height: b.height,
        width: b.width,
      });
    });
    setHandles((prev) =>
      JSON.stringify(prev) === JSON.stringify(out) ? prev : out,
    );
  }, [containerRef, cols]);

  useLayoutEffect(() => {
    measure();
    const raf = requestAnimationFrame(measure);
    const root = containerRef.current;
    const ro = new ResizeObserver(measure);
    if (root) {
      ro.observe(root);
    }
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps]);

  const startDrag = (e: React.MouseEvent, h: IHandle) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { key: h.key, x: e.clientX, w: h.width };
    const move = (ev: MouseEvent) => {
      const d = drag.current;
      if (d) {
        onResize(d.key, Math.max(60, Math.round(d.w + ev.clientX - d.x)));
      }
    };
    const up = () => {
      drag.current = null;
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
    <>
      {handles.map((h) => (
        <div
          key={h.key}
          className="crh"
          style={{ left: h.left - 4, top: h.top, height: h.height }}
          title="Kéo để đổi độ rộng cột; double-click để tự khớp theo nội dung"
          onMouseDown={(e) => startDrag(e, h)}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onResize(h.key, Math.max(60, Math.round(onAutoFit(h.key))));
          }}
        />
      ))}
    </>
  );
};

export default ColumnResizeHandles;
