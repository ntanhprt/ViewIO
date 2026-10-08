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

import React, { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import readXlsxFile, { readSheetNames } from "read-excel-file";
import { useFileData } from "./useFileData";
import { Loading, Problem } from "./ViewerShell";

const CSV_LIMIT = 20 * 1024 * 1024;
const MAX_ROWS = 5000;

type Cell = string | number | boolean | Date | null | undefined;

interface ITableViewerProps {
  path: string;
  kind: "csv" | "excel";
  onDownload: () => void;
}

const show = (c: Cell): string => {
  if (c === null || c === undefined) {
    return "";
  }
  if (c instanceof Date) {
    return c.toLocaleString("vi-VN");
  }
  return String(c);
};

const TableViewer = ({ path, kind, onDownload }: ITableViewerProps) => {
  const { blob, truncated, loading, error } = useFileData(
    path,
    kind === "csv" ? CSV_LIMIT : 0,
  );
  const [rows, setRows] = useState<Cell[][] | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [sheet, setSheet] = useState(0);
  const [header, setHeader] = useState(true);
  const [query, setQuery] = useState("");
  const [parseError, setParseError] = useState("");

  useEffect(() => {
    if (!blob) {
      return;
    }
    let cancelled = false;
    setParseError("");
    (async () => {
      try {
        if (kind === "csv") {
          const text = await blob.text();
          // bỏ dòng dở dang cuối cùng khi file bị cắt
          const src = truncated ? text.slice(0, text.lastIndexOf("\n")) : text;
          const res = Papa.parse<string[]>(src, { skipEmptyLines: true });
          if (!cancelled) {
            setRows(res.data);
          }
        } else {
          const names = await readSheetNames(blob);
          const data = await readXlsxFile(blob, { sheet: sheet + 1 });
          if (!cancelled) {
            setSheets(names);
            setRows(data as Cell[][]);
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          setParseError(e?.message || "Không đọc được bảng tính");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blob, kind, sheet, truncated]);

  const view = useMemo(() => {
    if (!rows) {
      return { head: null as Cell[] | null, body: [] as Cell[][], total: 0, cols: 0 };
    }
    const head = header ? rows[0] || [] : null;
    let body = header ? rows.slice(1) : rows;
    const q = query.trim().toLowerCase();
    if (q) {
      body = body.filter((r) => r.some((c) => show(c).toLowerCase().includes(q)));
    }
    const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
    return { head, body: body.slice(0, MAX_ROWS), total: body.length, cols };
  }, [rows, header, query]);

  if (error || parseError) {
    return (
      <Problem
        title="Không hiển thị được bảng"
        message={error || parseError}
        onDownload={onDownload}
      />
    );
  }
  if (loading || !rows) {
    return <Loading text="Đang đọc bảng tính..." />;
  }

  const colIdx = Array.from({ length: view.cols }, (_, i) => i);
  const colName = (i: number) => {
    let n = i + 1;
    let s = "";
    while (n > 0) {
      s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 }}>
      <div className="dv-toolbar">
        <button
          className={`dv-btn ${header ? "dv-active" : ""}`}
          onClick={() => setHeader(!header)}
        >
          Dòng đầu là tiêu đề
        </button>
        <input
          className="dv-input"
          placeholder="Lọc theo từ khóa..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="dv-info" style={{ marginLeft: "auto" }}>
          {view.total.toLocaleString()} dòng × {view.cols} cột
          {view.total > MAX_ROWS ? ` (hiển thị ${MAX_ROWS.toLocaleString()} dòng đầu)` : ""}
        </span>
      </div>
      {truncated ? (
        <div className="dv-notice">
          File lớn, chỉ đọc 20 MB đầu tiên. Tải xuống để xem đầy đủ.
        </div>
      ) : null}
      <div className="dv-table-wrap">
        <table className="dv-table">
          <thead>
            <tr>
              <th className="dv-rn">#</th>
              {colIdx.map((i) => (
                <th key={i}>{view.head ? show(view.head[i]) : colName(i)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.body.map((r, ri) => (
              <tr key={ri}>
                <td className="dv-rn">{ri + 1}</td>
                {colIdx.map((i) => (
                  <td
                    key={i}
                    className={typeof r[i] === "number" ? "dv-num" : undefined}
                    title={show(r[i])}
                  >
                    {show(r[i])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {kind === "excel" && sheets.length > 1 ? (
        <div className="dv-tabs">
          {sheets.map((name, i) => (
            <button
              key={name + i}
              className={`dv-tab ${i === sheet ? "dv-active" : ""}`}
              onClick={() => {
                setRows(null);
                setSheet(i);
              }}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default TableViewer;
