// ViewIO: các hộp thoại của menu chuột phải (đặt tên, chọn thư mục đích, tìm kiếm, thùng rác, thuộc tính, yêu thích)

import React, { useEffect, useRef, useState } from "react";
import {
  baseName,
  formatSize,
  FsHit,
  FsInfo,
  FsRef,
  fsParent,
  getFavorites,
  getRecent,
  info,
  listBuckets,
  listFolders,
  purge,
  search,
  toggleFavorite,
  transfer,
} from "./fileOps";
import "./ObjectContextMenu.css";

export type Mode = "copy" | "move";

const Overlay = ({
  onClose,
  wide,
  children,
}: {
  onClose: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) => (
  <div className="vio-overlay" onMouseDown={onClose}>
    <div
      className={`vio-dialog ${wide ? "vio-wide" : ""}`}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      {children}
    </div>
  </div>
);

export const NameDialog = ({
  title,
  initial,
  okLabel,
  isDir,
  onOk,
  onCancel,
}: {
  title: string;
  initial: string;
  okLabel: string;
  isDir: boolean;
  onOk: (n: string) => void;
  onCancel: () => void;
}) => {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.focus();
      const dot = isDir ? -1 : initial.lastIndexOf(".");
      el.setSelectionRange(0, dot > 0 ? dot : initial.length);
    }
  }, [initial, isDir]);
  const valid = v.trim() !== "" && !v.includes("/");
  return (
    <Overlay onClose={onCancel}>
      <h3>{title}</h3>
      <input
        ref={ref}
        className="vio-input"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && valid) {
            onOk(v.trim());
          }
        }}
      />
      {v.includes("/") ? <div className="vio-warn">Tên không được chứa dấu “/”</div> : null}
      <div className="vio-actions">
        <button type="button" className="vio-btn" onClick={onCancel}>
          Hủy
        </button>
        <button type="button" className="vio-btn vio-primary" disabled={!valid} onClick={() => onOk(v.trim())}>
          {okLabel}
        </button>
      </div>
    </Overlay>
  );
};

export const FolderPicker = ({
  mode,
  count,
  startBucket,
  startPrefix,
  disabledPrefixes,
  srcBucket,
  onChoose,
  onCancel,
}: {
  mode: Mode;
  count: number;
  startBucket: string;
  startPrefix: string;
  disabledPrefixes: string[];
  srcBucket: string;
  onChoose: (bucket: string, prefix: string) => void;
  onCancel: () => void;
}) => {
  const [bucket, setBucket] = useState(startBucket);
  const [prefix, setPrefix] = useState(startPrefix);
  const [buckets, setBuckets] = useState<string[]>([startBucket]);
  const [folders, setFolders] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    listBuckets()
      .then((b) => b.length && setBuckets(b))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr("");
    listFolders(bucket, prefix)
      .then((f) => alive && setFolders(f.filter((x) => x !== ".trash/")))
      .catch((e) => alive && (setErr(e.message), setFolders([])))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [bucket, prefix]);

  const crumbs = prefix.split("/").filter(Boolean);
  const blocked = (p: string) => bucket === srcBucket && disabledPrefixes.some((d) => p.startsWith(d));
  const hereBlocked = blocked(prefix);
  return (
    <Overlay onClose={onCancel} wide>
      <h3>
        {mode === "move" ? "Di chuyển" : "Sao chép"} {count} mục đến…
      </h3>
      <div className="vio-crumbs">
        <select
          className="vio-input vio-bucket"
          value={bucket}
          onChange={(e) => {
            setBucket(e.target.value);
            setPrefix("");
          }}
        >
          {buckets.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <button type="button" className="vio-crumb" onClick={() => setPrefix("")}>
          /
        </button>
        {crumbs.map((c, i) => (
          <button
            type="button"
            key={i}
            className="vio-crumb"
            onClick={() => setPrefix(crumbs.slice(0, i + 1).join("/") + "/")}
          >
            {c} /
          </button>
        ))}
      </div>
      <div className="vio-folders">
        {prefix ? (
          <button type="button" className="vio-folder" onClick={() => setPrefix(fsParent(prefix))}>
            ↩ Lên thư mục cha
          </button>
        ) : null}
        {loading ? <div className="vio-muted">Đang tải…</div> : null}
        {err ? <div className="vio-warn">{err}</div> : null}
        {!loading && !err && folders.length === 0 ? <div className="vio-muted">Không có thư mục con</div> : null}
        {folders.map((f) => (
          <button type="button" key={f} className="vio-folder" disabled={blocked(f)} onClick={() => setPrefix(f)}>
            📁 {baseName(f)}
          </button>
        ))}
      </div>
      <div className="vio-muted">
        Đích: {bucket}/{prefix}
        {hereBlocked ? " (không thể chuyển thư mục vào chính nó)" : ""}
      </div>
      <div className="vio-actions">
        <button type="button" className="vio-btn" onClick={onCancel}>
          Hủy
        </button>
        <button type="button" className="vio-btn vio-primary" disabled={hereBlocked} onClick={() => onChoose(bucket, prefix)}>
          {mode === "move" ? "Chuyển vào đây" : "Sao chép vào đây"}
        </button>
      </div>
    </Overlay>
  );
};

const TYPES: [string, string][] = [
  ["", "Mọi loại"],
  ["doc", "Tài liệu"],
  ["sheet", "Bảng tính"],
  ["slide", "Trình chiếu"],
  ["image", "Ảnh"],
  ["video", "Video"],
  ["audio", "Âm thanh"],
  ["code", "Mã nguồn / dữ liệu"],
  ["zip", "Nén"],
];

export const SearchDialog = ({
  bucket,
  currentPrefix,
  onOpenFile,
  onOpenFolder,
  onClose,
}: {
  bucket: string;
  currentPrefix: string;
  onOpenFile: (key: string) => void;
  onOpenFolder: (prefix: string) => void;
  onClose: () => void;
}) => {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [days, setDays] = useState(0);
  const [here, setHere] = useState(false);
  const [hits, setHits] = useState<FsHit[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => ref.current?.focus(), []);

  useEffect(() => {
    if (!q.trim() && !type && !days) {
      setHits([]);
      setTruncated(false);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      setLoading(true);
      setErr("");
      search(bucket, { prefix: here ? currentPrefix : "", q, type, days })
        .then((r) => {
          if (alive) {
            setHits(r.hits);
            setTruncated(r.truncated);
          }
        })
        .catch((e) => alive && setErr(e.message))
        .finally(() => alive && setLoading(false));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, type, days, here, bucket, currentPrefix]);

  return (
    <Overlay onClose={onClose} wide>
      <h3>Tìm trong bucket “{bucket}”</h3>
      <input
        ref={ref}
        className="vio-input"
        placeholder="Tên file chứa…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="vio-filters">
        <select className="vio-input" value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select className="vio-input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={0}>Mọi thời gian</option>
          <option value={1}>24 giờ qua</option>
          <option value={7}>7 ngày qua</option>
          <option value={30}>30 ngày qua</option>
          <option value={365}>1 năm qua</option>
        </select>
        <label className="vio-check">
          <input type="checkbox" checked={here} onChange={(e) => setHere(e.target.checked)} /> Chỉ trong thư mục này
        </label>
      </div>
      <div className="vio-folders vio-results">
        {loading ? <div className="vio-muted">Đang tìm…</div> : null}
        {err ? <div className="vio-warn">{err}</div> : null}
        {!loading && !err && hits.length === 0 ? (
          <div className="vio-muted">{q.trim() || type || days ? "Không có kết quả" : "Nhập tên hoặc chọn bộ lọc"}</div>
        ) : null}
        {hits.map((h) => (
          <div key={h.key} className="vio-hit">
            <button
              type="button"
              className="vio-hit-main"
              onClick={() => {
                onClose();
                onOpenFile(h.key);
              }}
              title="Mở file"
            >
              <b>{baseName(h.key)}</b>
              <span className="vio-muted">
                {fsParent(h.key) || "/"} · {formatSize(h.size)} · {new Date(h.modified).toLocaleString()}
              </span>
            </button>
            <button
              type="button"
              className="vio-btn vio-small"
              onClick={() => {
                onClose();
                onOpenFolder(fsParent(h.key));
              }}
              title="Mở thư mục chứa file"
            >
              📁
            </button>
          </div>
        ))}
        {truncated ? <div className="vio-muted">Còn nhiều kết quả hơn, hãy lọc thêm.</div> : null}
      </div>
      <div className="vio-actions">
        <button type="button" className="vio-btn" onClick={onClose}>
          Đóng
        </button>
      </div>
    </Overlay>
  );
};

const stampDate = (s: string) => {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])).toLocaleString() : s;
};

export const TrashDialog = ({
  bucket,
  onChanged,
  onClose,
}: {
  bucket: string;
  onChanged: () => void;
  onClose: () => void;
}) => {
  const [hits, setHits] = useState<FsHit[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    search(bucket, { prefix: ".trash/", limit: 1000 })
      .then((r) => alive && setHits(r.hits))
      .catch((e) => alive && setMsg(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [bucket, tick]);

  const act = async (fn: () => Promise<string>) => {
    setMsg("Đang xử lý…");
    try {
      setMsg(await fn());
    } catch (e: any) {
      setMsg(e?.message || String(e));
    }
    setSel(new Set());
    setTick((n) => n + 1);
    onChanged();
  };
  const chosen = hits.filter((h) => sel.has(h.key)).map((h) => h.key);
  const orig = (k: string) => k.split("/").slice(2).join("/");

  return (
    <Overlay onClose={onClose} wide>
      <h3>Thùng rác — “{bucket}”</h3>
      <div className="vio-folders vio-results">
        {loading ? <div className="vio-muted">Đang tải…</div> : null}
        {!loading && hits.length === 0 ? <div className="vio-muted">Thùng rác trống</div> : null}
        {hits.map((h) => (
          <label key={h.key} className="vio-hit vio-check">
            <input
              type="checkbox"
              checked={sel.has(h.key)}
              onChange={(e) => {
                const n = new Set(sel);
                e.target.checked ? n.add(h.key) : n.delete(h.key);
                setSel(n);
              }}
            />
            <span className="vio-hit-main">
              <b>{baseName(h.key)}</b>
              <span className="vio-muted">
                {fsParent(orig(h.key)) || "/"} · {formatSize(h.size)} · xoá lúc {stampDate(h.key.split("/")[1])}
              </span>
            </span>
          </label>
        ))}
      </div>
      {msg ? <div className="vio-muted">{msg}</div> : null}
      <div className="vio-actions">
        <button
          type="button"
          className="vio-btn"
          disabled={hits.length === 0}
          onClick={() => setSel(sel.size === hits.length ? new Set() : new Set(hits.map((h) => h.key)))}
        >
          Chọn tất cả
        </button>
        <button
          type="button"
          className="vio-btn vio-primary"
          disabled={chosen.length === 0}
          onClick={() =>
            act(async () => {
              const r = await transfer({
                op: "restore",
                bucket,
                items: chosen,
                destBucket: bucket,
                destPrefix: "",
                conflict: "keep",
              });
              return r.failed.length ? `Lỗi: ${r.failed[0]}` : `Đã khôi phục ${r.ok} file`;
            })
          }
        >
          Khôi phục
        </button>
        <button
          type="button"
          className="vio-btn vio-danger"
          disabled={chosen.length === 0}
          onClick={() => {
            if (window.confirm(`Xoá vĩnh viễn ${chosen.length} file? Không thể khôi phục.`)) {
              act(async () => `Đã xoá vĩnh viễn ${(await purge(bucket, chosen)).deleted} file`);
            }
          }}
        >
          Xoá vĩnh viễn
        </button>
        <button
          type="button"
          className="vio-btn vio-danger"
          disabled={hits.length === 0}
          onClick={() => {
            if (window.confirm("Dọn sạch toàn bộ thùng rác? Không thể khôi phục.")) {
              act(async () => `Đã dọn ${(await purge(bucket, [".trash/"])).deleted} file`);
            }
          }}
        >
          Dọn sạch
        </button>
        <button type="button" className="vio-btn" onClick={onClose}>
          Đóng
        </button>
      </div>
    </Overlay>
  );
};

export const InfoDialog = ({ bucket, keyName, onClose }: { bucket: string; keyName: string; onClose: () => void }) => {
  const [d, setD] = useState<FsInfo | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    info(bucket, keyName)
      .then(setD)
      .catch((e) => setErr(e.message));
  }, [bucket, keyName]);
  const row = (k: string, v: React.ReactNode) => (
    <div className="vio-row">
      <span className="vio-muted">{k}</span>
      <span>{v}</span>
    </div>
  );
  return (
    <Overlay onClose={onClose}>
      <h3>Thuộc tính</h3>
      {row("Tên", baseName(keyName))}
      {row("Vị trí", `${bucket}/${fsParent(keyName)}`)}
      {err ? <div className="vio-warn">{err}</div> : null}
      {!d && !err ? <div className="vio-muted">Đang tính…</div> : null}
      {d ? (
        <>
          {row("Loại", d.dir ? "Thư mục" : d.contentType || "File")}
          {row("Dung lượng", `${formatSize(d.size)} (${d.size.toLocaleString()} byte)`)}
          {d.dir ? row("Chứa", `${d.files} file, ${d.folders} thư mục con${d.truncated ? " (chưa đủ, thư mục quá lớn)" : ""}`) : null}
          {d.modified ? row("Sửa lần cuối", new Date(d.modified).toLocaleString()) : null}
          {d.etag ? row("ETag", d.etag) : null}
        </>
      ) : null}
      <div className="vio-actions">
        <button type="button" className="vio-btn vio-primary" onClick={onClose}>
          Đóng
        </button>
      </div>
    </Overlay>
  );
};

export const FavDialog = ({
  onOpen,
  onClose,
}: {
  onOpen: (r: FsRef) => void;
  onClose: () => void;
}) => {
  const [favs, setFavs] = useState<FsRef[]>(getFavorites());
  const recent = getRecent();
  const item = (r: FsRef, removable: boolean) => (
    <div key={r.bucket + r.key} className="vio-hit">
      <button
        type="button"
        className="vio-hit-main"
        onClick={() => {
          onClose();
          onOpen(r);
        }}
      >
        <b>{r.key.endsWith("/") ? "📁 " : ""}{baseName(r.key)}</b>
        <span className="vio-muted">
          {r.bucket}/{fsParent(r.key)}
        </span>
      </button>
      {removable ? (
        <button
          type="button"
          className="vio-btn vio-small"
          title="Bỏ yêu thích"
          onClick={() => {
            toggleFavorite(r.bucket, r.key);
            setFavs(getFavorites());
          }}
        >
          ★
        </button>
      ) : null}
    </div>
  );
  return (
    <Overlay onClose={onClose} wide>
      <h3>Yêu thích và gần đây</h3>
      <div className="vio-folders vio-results">
        <div className="vio-section">★ Yêu thích</div>
        {favs.length === 0 ? <div className="vio-muted">Chưa có. Chuột phải vào file/thư mục → “Thêm vào yêu thích”.</div> : null}
        {favs.map((f) => item(f, true))}
        <div className="vio-section">🕘 Mở gần đây</div>
        {recent.length === 0 ? <div className="vio-muted">Chưa mở file nào</div> : null}
        {recent.map((f) => item(f, false))}
      </div>
      <div className="vio-actions">
        <button type="button" className="vio-btn" onClick={onClose}>
          Đóng
        </button>
      </div>
    </Overlay>
  );
};
