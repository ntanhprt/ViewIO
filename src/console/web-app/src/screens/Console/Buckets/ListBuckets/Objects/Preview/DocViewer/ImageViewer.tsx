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

import React, { useEffect, useRef, useState } from "react";
import { Loading, Problem } from "./ViewerShell";

interface IImageViewerProps {
  src: string;
  onDownload: () => void;
}

const ImageViewer = ({ src, onDownload }: IImageViewerProps) => {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [scale, setScale] = useState(1);
  const [fit, setFit] = useState(1);
  const [rot, setRot] = useState(0);
  const [flip, setFlip] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dim, setDim] = useState("");
  const stage = useRef<HTMLDivElement | null>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(
    null,
  );

  const computeFit = () => {
    const st = stage.current;
    const im = img.current;
    if (!st || !im || !im.naturalWidth) {
      return 1;
    }
    const turned = rot % 180 !== 0;
    const w = turned ? im.naturalHeight : im.naturalWidth;
    const h = turned ? im.naturalWidth : im.naturalHeight;
    return Math.min(1, (st.clientWidth - 40) / w, (st.clientHeight - 40) / h);
  };

  const reset = () => {
    const f = computeFit();
    setFit(f);
    setScale(f);
    setPos({ x: 0, y: 0 });
  };

  useEffect(() => {
    if (loaded) {
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, rot]);

  useEffect(() => {
    const el = stage.current;
    if (!el) {
      return;
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setScale((s) => Math.min(16, Math.max(0.05, s * (e.deltaY < 0 ? 1.12 : 1 / 1.12))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  if (failed) {
    return (
      <Problem
        title="Không hiển thị được ảnh"
        message="Định dạng này trình duyệt không hỗ trợ."
        onDownload={onDownload}
      />
    );
  }

  const zoomBy = (f: number) =>
    setScale((s) => Math.min(16, Math.max(0.05, s * f)));

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
      <div className="dv-toolbar">
        <button className="dv-btn" onClick={() => zoomBy(1 / 1.25)}>
          −
        </button>
        <span className="dv-info">{Math.round(scale * 100)}%</span>
        <button className="dv-btn" onClick={() => zoomBy(1.25)}>
          +
        </button>
        <button className="dv-btn" onClick={reset}>
          Vừa khung
        </button>
        <button
          className="dv-btn"
          onClick={() => {
            setScale(1);
            setPos({ x: 0, y: 0 });
          }}
        >
          100%
        </button>
        <span className="dv-sep" />
        <button className="dv-btn" onClick={() => setRot((r) => (r + 270) % 360)}>
          ⟲
        </button>
        <button className="dv-btn" onClick={() => setRot((r) => (r + 90) % 360)}>
          ⟳
        </button>
        <button className="dv-btn" onClick={() => setFlip(!flip)}>
          ⇋
        </button>
        <span className="dv-info" style={{ marginLeft: "auto" }}>
          {dim}
        </span>
      </div>
      <div
        ref={stage}
        className={`dv-stage ${dragging ? "dv-drag" : ""}`}
        onMouseDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
          setDragging(true);
        }}
        onMouseMove={(e) => {
          if (drag.current) {
            setPos({
              x: drag.current.px + e.clientX - drag.current.x,
              y: drag.current.py + e.clientY - drag.current.y,
            });
          }
        }}
        onMouseUp={() => {
          drag.current = null;
          setDragging(false);
        }}
        onMouseLeave={() => {
          drag.current = null;
          setDragging(false);
        }}
        onDoubleClick={reset}
      >
        {!loaded ? <Loading /> : null}
        <img
          ref={img}
          src={src}
          alt="preview"
          draggable={false}
          style={{
            opacity: loaded ? 1 : 0,
            transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px)) rotate(${rot}deg) scale(${flip ? -scale : scale}, ${scale})`,
          }}
          onLoad={(e) => {
            const t = e.currentTarget;
            setDim(`${t.naturalWidth} × ${t.naturalHeight}px`);
            setLoaded(true);
          }}
          onError={() => setFailed(true)}
        />
      </div>
    </div>
  );
};

export default ImageViewer;
