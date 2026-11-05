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

import React, { Fragment, ReactNode, useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { AppState } from "../../../../../../../store";
import "./DocViewer.css";

interface IViewerShellProps {
  title: string;
  subtitle?: string;
  badge?: string;
  onClose: () => void;
  onDownload: () => void;
  zoomKey?: string;
  children: ReactNode;
}

export const ViewerShell = ({
  title,
  subtitle,
  badge,
  onClose,
  onDownload,
  zoomKey = "default",
  children,
}: IViewerShellProps) => {
  const darkMode = useSelector((state: AppState) => state.system.darkMode);
  const rootRef = useRef<HTMLDivElement>(null);
  const [immersive, setImmersive] = useState(() => {
    try {
      return localStorage.getItem("docview.immersive") === "1";
    } catch (e) {
      return false;
    }
  });
  const [reveal, setReveal] = useState(false);
  // tùy chọn hiển thị riêng cho viewer: thu gọn thanh tiêu đề, thu gọn thanh nút, cỡ nội dung
  // hdr/tb dùng chung; zoom lưu riêng theo loại file (zoomKey) để mỗi loại có cỡ riêng
  const readOpt = (key: string) => {
    try {
      const o = JSON.parse(localStorage.getItem("docview.viewer") || "{}");
      const z = o.zooms ? o.zooms[key] : undefined;
      return {
        hdr: !!o.hdr,
        tb: !!o.tb,
        zoom: z >= 0.7 && z <= 2 ? z : 1,
      };
    } catch (e) {
      return { hdr: false, tb: false, zoom: 1 };
    }
  };
  const [opt, setOpt] = useState<{ hdr: boolean; tb: boolean; zoom: number }>(
    () => readOpt(zoomKey)
  );
  useEffect(() => {
    setOpt(readOpt(zoomKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomKey]);
  const patchOpt = (d: Partial<typeof opt>) => {
    const n = { ...opt, ...d };
    setOpt(n);
    try {
      const o = JSON.parse(localStorage.getItem("docview.viewer") || "{}");
      const zooms = { ...(o.zooms || {}), [zoomKey]: n.zoom };
      localStorage.setItem(
        "docview.viewer",
        JSON.stringify({ hdr: n.hdr, tb: n.tb, zooms })
      );
    } catch (e) {
      // bỏ qua
    }
  };
  const zoomBy = (d: number) =>
    patchOpt({ zoom: Math.round(Math.min(2, Math.max(0.7, opt.zoom + d)) * 10) / 10 });
  const hideTimer = useRef<number>();

  // Ctrl + lăn chuột = phóng to/thu nhỏ nội dung (thay vì zoom cả trình duyệt); Shift + lăn = cuộn ngang khi trang rộng hơn khung.
  // Dùng listener gốc (không passive) vì React không cho preventDefault trên wheel.
  const zoomRef = useRef(opt.zoom);
  zoomRef.current = opt.zoom;
  const zoomFn = useRef(patchOpt);
  zoomFn.current = patchOpt;
  useEffect(() => {
    const el = rootRef.current;
    if (!el) {
      return;
    }
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const d = e.deltaY < 0 ? 0.1 : -0.1;
        const z = Math.round(Math.min(2, Math.max(0.7, zoomRef.current + d)) * 10) / 10;
        if (z !== zoomRef.current) {
          zoomFn.current({ zoom: z });
        }
      } else if (e.shiftKey) {
        // tìm phần tử cuộn được theo chiều ngang gần nhất dưới con trỏ
        let n = e.target as HTMLElement | null;
        while (n && n !== el.parentElement) {
          if (n.scrollWidth > n.clientWidth + 1) {
            const ox = getComputedStyle(n).overflowX;
            if (ox === "auto" || ox === "scroll") {
              e.preventDefault();
              n.scrollLeft += e.deltaY || e.deltaX;
              return;
            }
          }
          n = n.parentElement;
        }
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const setMode = (on: boolean) => {
    setImmersive(on);
    setReveal(false);
    try {
      localStorage.setItem("docview.immersive", on ? "1" : "0");
    } catch (e) {
      // bỏ qua
    }
    // thêm toàn màn hình thật của trình duyệt (như F11) nếu được phép
    try {
      if (on && !document.fullscreenElement) {
        rootRef.current?.requestFullscreen?.().catch(() => undefined);
      } else if (!on && document.fullscreenElement) {
        document.exitFullscreen().catch(() => undefined);
      }
    } catch (e) {
      // bỏ qua
    }
  };

  const showBars = () => {
    setReveal(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setReveal(false), 2500);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el?.tagName === "INPUT" || el?.tagName === "TEXTAREA";
      if (e.key === "Escape" && !typing) {
        if (immersive) {
          setMode(false);
        } else {
          onClose();
        }
      } else if ((e.key === "f" || e.key === "F") && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setMode(!immersive);
      }
    };
    // Esc của trình duyệt thoát fullscreen thật -> thoát luôn chế độ này
    const onFs = () => {
      if (!document.fullscreenElement && immersive) {
        setMode(false);
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, immersive]);

  // đóng viewer thì thoát luôn fullscreen thật
  useEffect(
    () => () => {
      window.clearTimeout(hideTimer.current);
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => undefined);
      }
    },
    []
  );

  return (
    <div
      ref={rootRef}
      className={`dv-root ${darkMode ? "dv-dark" : ""} ${
        immersive ? "dv-immersive" : ""
      } ${reveal ? "dv-reveal" : ""} ${opt.hdr ? "dv-hdr-min" : ""} ${
        opt.tb ? "dv-tb-min" : ""
      }`}
      style={{ ["--dv-zoom" as string]: opt.zoom }}
      role="dialog"
      onMouseMove={(e) => {
        if (immersive && reveal && e.clientY < 120) {
          showBars();
        }
      }}
    >
      {immersive ? (
        <div className="dv-hot" onMouseEnter={showBars} title="Di chuột lên đây để hiện thanh công cụ" />
      ) : null}
      <div className="dv-header">
        <div className="dv-title">
          <b title={title}>{title}</b>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
        {badge ? <span className="dv-badge">{badge}</span> : null}
        <span className="dv-grp" title="Cỡ nội dung">
          <button className="dv-btn" onClick={() => zoomBy(-0.1)} title="Thu nhỏ nội dung">
            A−
          </button>
          <button className="dv-btn" onClick={() => patchOpt({ zoom: 1 })} title="Cỡ chuẩn (100%)">
            {Math.round(opt.zoom * 100)}%
          </button>
          <button className="dv-btn" onClick={() => zoomBy(0.1)} title="Phóng to nội dung">
            A+
          </button>
        </span>
        <button
          className={`dv-btn ${opt.tb ? "dv-active" : ""}`}
          onClick={() => patchOpt({ tb: !opt.tb })}
          title={opt.tb ? "Hiện thanh nút của nội dung" : "Thu gọn thanh nút của nội dung"}
        >
          ☰<span className="dv-lbl"> Thanh nút</span>
        </button>
        <button
          className={`dv-btn ${opt.hdr ? "dv-active" : ""}`}
          onClick={() => patchOpt({ hdr: !opt.hdr })}
          title={opt.hdr ? "Mở rộng thanh tiêu đề" : "Thu gọn thanh tiêu đề"}
        >
          ▭<span className="dv-lbl"> Thu gọn menu</span>
        </button>
        <button
          className="dv-btn"
          onClick={() => setMode(!immersive)}
          title={immersive ? "Thoát toàn màn hình (Esc / F)" : "Toàn màn hình (F)"}
        >
          {immersive ? "⤡" : "⛶"}<span className="dv-lbl">{immersive ? " Thu nhỏ" : " Toàn màn hình"}</span>
        </button>
        <button className="dv-btn" onClick={onDownload} title="Tải xuống">
          ⬇<span className="dv-lbl"> Tải xuống</span>
        </button>
        <button className="dv-btn" onClick={onClose} title="Đóng (Esc)">
          ✕
        </button>
      </div>
      {children}
    </div>
  );
};

export const Loading = ({ text = "Đang tải..." }: { text?: string }) => (
  <div className="dv-center">
    <div className="dv-spinner" />
    <div>{text}</div>
  </div>
);

export const Problem = ({
  title,
  message,
  onDownload,
}: {
  title: string;
  message?: string;
  onDownload?: () => void;
}) => (
  <div className="dv-center">
    <h3>{title}</h3>
    {message ? <div>{message}</div> : null}
    {onDownload ? (
      <Fragment>
        <button className="dv-btn dv-active" onClick={onDownload}>
          ⬇ Tải xuống file
        </button>
      </Fragment>
    ) : null}
  </div>
);
