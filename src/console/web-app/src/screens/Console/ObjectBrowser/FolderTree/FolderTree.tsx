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

import React, {
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { api } from "api";
import { setViewState, useViewState } from "../viewMode";
import "./FolderTree.css";

const LS_OPEN = "docview.tree.open";
const LS_WIDTH = "docview.tree.width";
const MIN_W = 180;
const MAX_W = 560;
const LIST_LIMIT = 3000;

const lsGet = (k: string): string | null => {
  try {
    return window.localStorage.getItem(k);
  } catch (e) {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    window.localStorage.setItem(k, v);
  } catch (e) {
    /* localStorage bị chặn: bỏ qua */
  }
};

interface IChildren {
  loading?: boolean;
  error?: string;
  items?: string[]; // prefix đầy đủ, kết thúc bằng "/"
  truncated?: boolean;
}

const keyOf = (bucket: string, prefix: string) => `${bucket}\u0000${prefix}`;

const ChevronIcon = () => (
  <svg viewBox="0 0 10 10">
    <path d="M2 0l6 5-6 5z" />
  </svg>
);
const FolderIcon = ({ bucket }: { bucket?: boolean }) =>
  bucket ? (
    <svg className="ft-ico" viewBox="0 0 16 16">
      <path d="M2 3h12v3H2zM3 7h10v6.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5zm3 1.5v1h4v-1z" />
    </svg>
  ) : (
    <svg className="ft-ico" viewBox="0 0 16 16">
      <path d="M1.5 3A1.5 1.5 0 0 1 3 1.5h3l1.5 1.5H13A1.5 1.5 0 0 1 14.5 4.5v8A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5z" />
    </svg>
  );

interface IFolderTreeLayoutProps {
  bucketName: string;
  // đường dẫn hiện tại trong URL (đã giải mã), có thể là file
  internalPaths: string;
  disabled?: boolean;
  children: ReactNode;
}

// Bọc nội dung Object Browser: thanh cây thư mục bên trái (mặc định ẩn, chỉ còn nút mở).
export const FolderTreeLayout = ({
  bucketName,
  internalPaths,
  disabled = false,
  children,
}: IFolderTreeLayoutProps) => {
  const navigate = useNavigate();
  const view = useViewState();

  // Chế độ tập trung: đặt class lên <body> (CSS ẩn các thanh); gỡ khi rời Object Browser
  useEffect(() => {
    const cls = ["vio-focus-1", "vio-focus-2"];
    document.body.classList.remove(...cls);
    if (view.focus > 0) {
      document.body.classList.add(`vio-focus-${view.focus}`);
    }
    return () => document.body.classList.remove(...cls);
  }, [view.focus]);

  // Esc thoát toàn màn hình (không khi đang mở viewer hay đang gõ)
  useEffect(() => {
    if (view.focus !== 2) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        e.key === "Escape" &&
        !document.querySelector(".dv-root") &&
        el?.tagName !== "INPUT" &&
        el?.tagName !== "TEXTAREA"
      ) {
        setViewState({ focus: 0 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view.focus]);

  const [open, setOpen] = useState<boolean>(lsGet(LS_OPEN) === "1");
  const [width, setWidth] = useState<number>(() => {
    const n = parseInt(lsGet(LS_WIDTH) || "", 10);
    return n >= MIN_W && n <= MAX_W ? n : 270;
  });
  const [buckets, setBuckets] = useState<string[] | null>(null);
  const [bucketsError, setBucketsError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [kids, setKids] = useState<Record<string, IChildren>>({});
  const kidsRef = useRef(kids);
  kidsRef.current = kids;

  const folder = internalPaths.endsWith("/")
    ? internalPaths
    : internalPaths.split("/").slice(0, -1).join("/") +
      (internalPaths.includes("/") ? "/" : "");

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    lsSet(LS_OPEN, next ? "1" : "0");
  };

  const loadBuckets = useCallback(() => {
    setBucketsError("");
    api.buckets
      .listBuckets()
      .then((res) => {
        const names = (res.data.buckets || []).map((b) => b.name);
        names.sort((a, b) => a.localeCompare(b));
        setBuckets(names);
      })
      .catch((e) => {
        setBuckets([]);
        setBucketsError(e?.error?.message || "Không tải được danh sách bucket");
      });
  }, []);

  const loadChildren = useCallback((bucket: string, prefix: string) => {
    const key = keyOf(bucket, prefix);
    const cur = kidsRef.current[key];
    if (cur && (cur.loading || cur.items)) {
      return Promise.resolve();
    }
    setKids((k) => ({ ...k, [key]: { loading: true } }));
    return api.buckets
      .listObjects(bucket, { prefix, limit: LIST_LIMIT })
      .then((res) => {
        const objs = res.data.objects || [];
        const items = objs
          .map((o) => o.name || "")
          .filter((n) => n.endsWith("/") && n !== prefix)
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        setKids((k) => ({
          ...k,
          [key]: { items, truncated: objs.length >= LIST_LIMIT },
        }));
      })
      .catch((e) => {
        setKids((k) => ({
          ...k,
          [key]: { error: e?.error?.message || "Không có quyền hoặc lỗi tải" },
        }));
      });
  }, []);

  // Mở panel: nạp danh sách bucket
  useEffect(() => {
    if (open && buckets === null) {
      loadBuckets();
    }
  }, [open, buckets, loadBuckets]);

  // Tự bung các cấp tới thư mục đang xem
  useEffect(() => {
    if (!open || !bucketName) {
      return;
    }
    const keys: string[] = [keyOf(bucketName, "")];
    const toLoad: string[] = [""];
    let acc = "";
    folder
      .split("/")
      .filter(Boolean)
      .forEach((seg) => {
        acc += seg + "/";
        keys.push(keyOf(bucketName, acc));
        toLoad.push(acc);
      });
    setExpanded((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => next.add(k));
      return next;
    });
    toLoad.forEach((p) => loadChildren(bucketName, p));
  }, [open, bucketName, folder, loadChildren]);

  const refresh = () => {
    setKids({});
    kidsRef.current = {};
    setBuckets(null);
    // useEffect ở trên sẽ nạp lại bucket và nhánh đang xem
    setExpanded(new Set());
  };

  const toggleNode = (bucket: string, prefix: string) => {
    const key = keyOf(bucket, prefix);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
    loadChildren(bucket, prefix);
  };

  const go = (bucket: string, prefix: string) => {
    navigate(
      `/browser/${encodeURIComponent(bucket)}/${encodeURIComponent(prefix)}`,
    );
  };

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    let last = startW;
    const move = (ev: MouseEvent) => {
      last = Math.min(MAX_W, Math.max(MIN_W, startW + ev.clientX - startX));
      setWidth(last);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      lsSet(LS_WIDTH, String(last));
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const renderFolders = (bucket: string, prefix: string, depth: number) => {
    const key = keyOf(bucket, prefix);
    const st = kids[key];
    if (!st || st.loading) {
      return (
        <div className="ft-note" style={{ paddingLeft: 40 + depth * 14 }}>
          Đang tải...
        </div>
      );
    }
    if (st.error) {
      return (
        <div className="ft-note" style={{ paddingLeft: 40 + depth * 14 }}>
          {st.error}
        </div>
      );
    }
    if (!st.items?.length) {
      return (
        <div className="ft-note" style={{ paddingLeft: 40 + depth * 14 }}>
          (không có thư mục con)
        </div>
      );
    }
    return (
      <React.Fragment>
        {st.items.map((p) => {
          const name = p.slice(prefix.length).replace(/\/$/, "");
          const nk = keyOf(bucket, p);
          const isOpen = expanded.has(nk);
          const isCur = bucket === bucketName && folder === p;
          return (
            <React.Fragment key={p}>
              <div
                className={`ft-row ${isCur ? "ft-cur" : ""}`}
                style={{ paddingLeft: 6 + depth * 14 }}
                onClick={() => go(bucket, p)}
                title={name}
              >
                <button
                  className={`ft-chev ${isOpen ? "ft-open" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleNode(bucket, p);
                  }}
                >
                  <ChevronIcon />
                </button>
                <FolderIcon />
                <span className="ft-label">{name}</span>
              </div>
              {isOpen ? renderFolders(bucket, p, depth + 1) : null}
            </React.Fragment>
          );
        })}
        {st.truncated ? (
          <div className="ft-note" style={{ paddingLeft: 40 + depth * 14 }}>
            … còn nữa, hãy dùng ô lọc ở danh sách chính
          </div>
        ) : null}
      </React.Fragment>
    );
  };

  if (disabled) {
    return <React.Fragment>{children}</React.Fragment>;
  }

  return (
    <div className="ft-layout">
      {view.focus === 2 ? (
        <button
          className="vio-exit-focus"
          title="Thoát toàn màn hình (Esc)"
          onClick={() => setViewState({ focus: 0 })}
        >
          ✕
        </button>
      ) : null}
      <div className="ft-side">
        <button
          className="ft-rail"
          onClick={toggleOpen}
          title={open ? "Ẩn cây thư mục" : "Hiện cây thư mục"}
          aria-label="Cây thư mục"
        >
          <svg
            viewBox="0 0 10 10"
            style={{ transform: open ? "rotate(180deg)" : undefined }}
          >
            <path d="M2 0l6 5-6 5z" />
          </svg>
        </button>
        {open ? (
          <div className="ft-panel" style={{ width }}>
            <div className="ft-head">
              <span>Cây thư mục</span>
              <button className="ft-icobtn" onClick={refresh} title="Làm mới">
                <svg viewBox="0 0 16 16">
                  <path d="M8 2a6 6 0 1 0 5.7 4h-1.7A4.3 4.3 0 1 1 8 3.7c1.1 0 2 .4 2.800 1.100L8.500 7H14V1.500l-1.900 1.900A6 6 0 0 0 8 2z" />
                </svg>
              </button>
              <button className="ft-icobtn" onClick={toggleOpen} title="Ẩn">
                ✕
              </button>
            </div>
            <div className="ft-body">
              {buckets === null ? (
                <div className="ft-note">Đang tải...</div>
              ) : null}
              {bucketsError ? (
                <div className="ft-note">{bucketsError}</div>
              ) : null}
              {(buckets || []).map((b) => {
                const bk = keyOf(b, "");
                const isOpen = expanded.has(bk);
                const isCur = b === bucketName && folder === "";
                return (
                  <React.Fragment key={b}>
                    <div
                      className={`ft-row ${isCur ? "ft-cur" : ""}`}
                      style={{ paddingLeft: 6 }}
                      onClick={() => go(b, "")}
                      title={b}
                    >
                      <button
                        className={`ft-chev ${isOpen ? "ft-open" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleNode(b, "");
                        }}
                      >
                        <ChevronIcon />
                      </button>
                      <FolderIcon bucket />
                      <span className="ft-label">{b}</span>
                    </div>
                    {isOpen ? renderFolders(b, "", 1) : null}
                  </React.Fragment>
                );
              })}
            </div>
            <div className="ft-resize" onMouseDown={startResize} />
          </div>
        ) : null}
      </div>
      <div className="ft-main">{children}</div>
    </div>
  );
};

export default FolderTreeLayout;
