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

import { useSyncExternalStore } from "react";

// ViewIO: trạng thái chế độ xem danh sách file (danh sách / thumbnail), dùng chung giữa
// thanh công cụ (BrowserBreadcrumbs) và bảng file (ListObjectsTable). Nhớ trong localStorage.

export type ViewModeType = "list" | "thumb";
export type ThumbSize = "s" | "m" | "l";
export type SortField = "name" | "last_modified" | "size";

export interface ViewState {
  mode: ViewModeType;
  size: ThumbSize;
  sortBy: SortField;
  sortDir: "ASC" | "DESC";
}

const LS_KEY = "docview.listview";
const DEFAULT: ViewState = {
  mode: "list",
  size: "m",
  sortBy: "name",
  sortDir: "ASC",
};

const read = (): ViewState => {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        mode: p.mode === "thumb" ? "thumb" : "list",
        size: ["s", "m", "l"].includes(p.size) ? p.size : "m",
        sortBy: ["name", "last_modified", "size"].includes(p.sortBy)
          ? p.sortBy
          : "name",
        sortDir: p.sortDir === "DESC" ? "DESC" : "ASC",
      };
    }
  } catch (e) {
    /* localStorage bị chặn: dùng mặc định */
  }
  return DEFAULT;
};

let state: ViewState = read();
const listeners = new Set<() => void>();

export const setViewState = (patch: Partial<ViewState>) => {
  state = { ...state, ...patch };
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch (e) {
    /* bỏ qua */
  }
  listeners.forEach((l) => l());
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export const useViewState = (): ViewState =>
  useSyncExternalStore(subscribe, () => state);
