// This file is part of MinIO Console Server
// Copyright (c) 2022 MinIO, Inc.
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

import React from "react";
import { setViewState, SortField, ThumbSize, useViewState } from "./viewMode";
import "./ViewModeToolbar.css";

const ListIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
    <rect x="1" y="3" width="14" height="2" rx="1" />
    <rect x="1" y="7" width="14" height="2" rx="1" />
    <rect x="1" y="11" width="14" height="2" rx="1" />
  </svg>
);
const GridIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
    <rect x="1" y="1" width="6" height="6" rx="1" />
    <rect x="9" y="1" width="6" height="6" rx="1" />
    <rect x="1" y="9" width="6" height="6" rx="1" />
    <rect x="9" y="9" width="6" height="6" rx="1" />
  </svg>
);

const SIZE_LABEL: Record<ThumbSize, string> = { s: "Nhỏ", m: "Vừa", l: "Lớn" };

// Nút chuyển chế độ xem: danh sách / thumbnail (+ cỡ thẻ và sắp xếp khi ở chế độ thumbnail)
const ViewModeToolbar = () => {
  const v = useViewState();
  return (
    <div className="vm-bar">
      <div className="vm-group">
        <button
          className={`vm-btn ${v.mode === "list" ? "vm-on" : ""}`}
          title="Xem dạng danh sách"
          onClick={() => setViewState({ mode: "list" })}
        >
          <ListIcon />
        </button>
        <button
          className={`vm-btn ${v.mode === "thumb" ? "vm-on" : ""}`}
          title="Xem dạng thumbnail"
          onClick={() => setViewState({ mode: "thumb" })}
        >
          <GridIcon />
        </button>
      </div>
      {v.mode === "thumb" ? (
        <React.Fragment>
          <div className="vm-group">
            {(["s", "m", "l"] as ThumbSize[]).map((s) => (
              <button
                key={s}
                className={`vm-btn ${v.size === s ? "vm-on" : ""}`}
                title={`Thẻ ${SIZE_LABEL[s].toLowerCase()}`}
                onClick={() => setViewState({ size: s })}
              >
                {s.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="vm-group">
            <select
              className="vm-select"
              title="Sắp xếp theo"
              value={v.sortBy}
              onChange={(e) =>
                setViewState({ sortBy: e.target.value as SortField })
              }
            >
              <option value="name">Tên</option>
              <option value="size">Dung lượng</option>
              <option value="last_modified">Ngày sửa</option>
            </select>
            <button
              className="vm-btn"
              title={v.sortDir === "ASC" ? "Tăng dần" : "Giảm dần"}
              onClick={() =>
                setViewState({ sortDir: v.sortDir === "ASC" ? "DESC" : "ASC" })
              }
            >
              {v.sortDir === "ASC" ? "↑" : "↓"}
            </button>
          </div>
        </React.Fragment>
      ) : null}
    </div>
  );
};

export default ViewModeToolbar;
