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

import React, { Fragment, ReactNode, useEffect } from "react";
import { useSelector } from "react-redux";
import { AppState } from "../../../../../../../store";
import "./DocViewer.css";

interface IViewerShellProps {
  title: string;
  subtitle?: string;
  badge?: string;
  onClose: () => void;
  onDownload: () => void;
  children: ReactNode;
}

export const ViewerShell = ({
  title,
  subtitle,
  badge,
  onClose,
  onDownload,
  children,
}: IViewerShellProps) => {
  const darkMode = useSelector((state: AppState) => state.system.darkMode);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key === "Escape" && el?.tagName !== "INPUT") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className={`dv-root ${darkMode ? "dv-dark" : ""}`} role="dialog">
      <div className="dv-header">
        <div className="dv-title">
          <b title={title}>{title}</b>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
        {badge ? <span className="dv-badge">{badge}</span> : null}
        <button className="dv-btn" onClick={onDownload} title="Tải xuống">
          ⬇ Tải xuống
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
