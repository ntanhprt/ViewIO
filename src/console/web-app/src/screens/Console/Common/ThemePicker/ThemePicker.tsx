// ViewIO: nút chọn theme (bảng màu) cạnh nút sáng/tối của Console.

import React, { useEffect, useRef, useState } from "react";
import { useAppDispatch } from "../../../../store";
import { applyTheme, getThemeId, THEMES } from "../../../../themes";
import "./ThemePicker.css";

const ThemePicker = () => {
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState(getThemeId());
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setCur(getThemeId());
    const close = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="vio-theme-wrap" ref={wrap}>
      <button
        type="button"
        className="vio-theme-btn"
        title="Chọn giao diện (theme)"
        aria-label="Chọn giao diện"
        onClick={() => setOpen(!open)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.3A3.7 3.7 0 0 0 21 10.7C21 6.4 17 3 12 3z" />
          <circle cx="7.5" cy="11" r="1" />
          <circle cx="10" cy="7" r="1" />
          <circle cx="15" cy="7" r="1" />
        </svg>
      </button>
      {open ? (
        <div className="vio-theme-menu">
          <div className="vio-theme-title">Giao diện</div>
          {THEMES.map((t) => {
            const active = (cur || "") === t.id;
            return (
              <button
                type="button"
                key={t.id}
                className={`vio-theme-item ${active ? "vio-theme-active" : ""}`}
                onClick={() => {
                  applyTheme(dispatch, t.id);
                  setCur(t.id);
                }}
              >
                <span className="vio-theme-swatch" style={{ background: t.p.bg, borderColor: t.p.border }}>
                  <i style={{ background: t.p.accent }} />
                  <i style={{ background: t.p.text }} />
                </span>
                <span>{t.label}</span>
                {active ? <span className="vio-theme-check">✓</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

export default ThemePicker;
