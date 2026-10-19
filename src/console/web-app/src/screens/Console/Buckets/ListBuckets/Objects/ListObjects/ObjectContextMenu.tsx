// ViewIO: menu chuột phải + phím tắt kiểu Windows Explorer cho danh sách file
// (Mở, Tải xuống, Cắt, Sao chép, Dán, Di chuyển đến…, Sao chép đến…, Đổi tên).

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAppDispatch } from "../../../../../../store";
import { setSnackBarMessage } from "../../../../../../systemSlice";
import {
  setReloadObjectsList,
  setSelectedObjects,
} from "../../../../ObjectBrowser/objectBrowserSlice";
import {
  baseName,
  getClipboard,
  listBuckets,
  listFolders,
  setClipboard,
  transfer,
} from "./fileOps";
import "./ObjectContextMenu.css";

interface IProps {
  bucketName: string;
  currentPrefix: string; // "" hoặc "a/b/"
  selected: string[];
  // Tìm item (key) từ phần tử DOM được bấm chuột phải; undefined nếu bấm vào chỗ trống
  itemFromTarget: (target: HTMLElement) => string | undefined;
  onSelect: (names: string[]) => void;
  onOpen: (name: string) => void;
  onDownload: (name: string) => void;
  children: React.ReactNode;
}

type Mode = "copy" | "move";

const inField = (t: EventTarget | null) =>
  !!(t as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true']");

const ObjectContextMenu = ({
  bucketName,
  currentPrefix,
  selected,
  itemFromTarget,
  onSelect,
  onOpen,
  onDownload,
  children,
}: IProps) => {
  const dispatch = useAppDispatch();
  const [menu, setMenu] = useState<{ x: number; y: number; items: string[] } | null>(null);
  const [picker, setPicker] = useState<{ mode: Mode; items: string[] } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ text: string } | null>(null);
  const [problem, setProblem] = useState<string[] | null>(null);
  const [, bump] = useState(0);

  useEffect(() => {
    const f = () => bump((n) => n + 1);
    window.addEventListener("viewio-clipboard", f);
    return () => window.removeEventListener("viewio-clipboard", f);
  }, []);

  const refresh = useCallback(() => {
    dispatch(setSelectedObjects([]));
    dispatch(setReloadObjectsList(true));
  }, [dispatch]);

  const run = useCallback(
    async (
      mode: Mode,
      items: string[],
      destBucket: string,
      destPrefix: string,
      opts: { newName?: string; conflict?: "keep" | "fail"; src?: string } = {},
    ) => {
      const verb = mode === "copy" ? "Đang sao chép" : "Đang chuyển";
      setBusy({ text: `${verb}…` });
      try {
        const r = await transfer({
          op: mode,
          bucket: opts.src || bucketName,
          items,
          destBucket,
          destPrefix,
          newName: opts.newName,
          conflict: opts.conflict || "keep",
          onProgress: (d, t) => setBusy({ text: `${verb}… ${d}/${t}` }),
        });
        if (r.failed.length > 0) {
          setProblem(r.failed);
        } else {
          dispatch(
            setSnackBarMessage(
              `${mode === "copy" ? "Đã sao chép" : "Đã chuyển"} ${r.ok} file`,
            ),
          );
        }
        refresh();
        return r.failed.length === 0;
      } catch (e: any) {
        setProblem([e?.message || String(e)]);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [bucketName, dispatch, refresh],
  );

  const doCopyCut = useCallback(
    (op: Mode, items: string[]) => {
      if (items.length > 0) {
        setClipboard({ op, bucket: bucketName, items });
      }
    },
    [bucketName],
  );

  const doPaste = useCallback(
    async (intoFolder?: string) => {
      const cb = getClipboard();
      if (!cb) {
        return;
      }
      const ok = await run(cb.op, cb.items, bucketName, intoFolder ?? currentPrefix, {
        src: cb.bucket,
      });
      if (ok && cb.op === "move") {
        setClipboard(null);
      }
    },
    [bucketName, currentPrefix, run],
  );

  // Phím tắt: Ctrl+C / Ctrl+X / Ctrl+V / F2 khi không gõ trong ô nhập và không có hộp thoại
  const dialogOpen = !!(picker || renaming || busy || problem);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialogOpen || inField(e.target) || window.getSelection()?.toString()) {
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "c" && selected.length) {
        e.preventDefault();
        doCopyCut("copy", selected);
      } else if (mod && k === "x" && selected.length) {
        e.preventDefault();
        doCopyCut("move", selected);
      } else if (mod && k === "v" && getClipboard()) {
        e.preventDefault();
        doPaste();
      } else if (e.key === "F2" && selected.length === 1) {
        e.preventDefault();
        setRenaming(selected[0]);
      } else if (e.key === "Escape") {
        setMenu(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialogOpen, selected, doCopyCut, doPaste]);

  useEffect(() => {
    if (!menu) {
      return;
    }
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (inField(target)) {
      return;
    }
    e.preventDefault();
    const hit = itemFromTarget(target);
    let items: string[] = [];
    if (hit) {
      // giống Explorer: bấm phải vào mục đang được chọn thì thao tác cả nhóm, ngược lại chỉ mục đó
      items = selected.includes(hit) ? selected : [hit];
      if (!selected.includes(hit)) {
        onSelect([hit]);
      }
    }
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const cb = getClipboard();
  const single = menu && menu.items.length === 1 ? menu.items[0] : null;
  const singleIsDir = !!single && single.endsWith("/");

  const entries: { label: string; hint?: string; disabled?: boolean; act: () => void; sep?: boolean }[] =
    [];
  if (menu) {
    if (single) {
      entries.push({ label: singleIsDir ? "Mở thư mục" : "Mở / xem", act: () => onOpen(single) });
      if (!singleIsDir) {
        entries.push({ label: "Tải xuống", act: () => onDownload(single) });
      }
    }
    if (menu.items.length > 0) {
      entries.push({ label: "Cắt", hint: "Ctrl+X", sep: entries.length > 0, act: () => doCopyCut("move", menu.items) });
      entries.push({ label: "Sao chép", hint: "Ctrl+C", act: () => doCopyCut("copy", menu.items) });
    }
    const pasteInto = singleIsDir ? single : undefined;
    entries.push({
      label: pasteInto ? "Dán vào thư mục này" : "Dán",
      hint: pasteInto ? undefined : "Ctrl+V",
      disabled: !cb,
      sep: menu.items.length === 0 ? false : false,
      act: () => doPaste(pasteInto || undefined),
    });
    if (menu.items.length > 0) {
      entries.push({ label: "Di chuyển đến…", sep: true, act: () => setPicker({ mode: "move", items: menu.items }) });
      entries.push({ label: "Sao chép đến…", act: () => setPicker({ mode: "copy", items: menu.items }) });
    }
    if (single) {
      entries.push({ label: "Đổi tên", hint: "F2", sep: true, act: () => setRenaming(single) });
    }
    entries.push({ label: "Làm mới", sep: true, act: () => dispatch(setReloadObjectsList(true)) });
  }

  return (
    <div onContextMenu={onContextMenu}>
      {children}
      {menu ? (
        <div
          className="vio-menu"
          style={{
            left: Math.min(menu.x, window.innerWidth - 230),
            top: Math.min(menu.y, window.innerHeight - entries.length * 32 - 16),
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menu.items.length > 1 ? (
            <div className="vio-menu-title">{menu.items.length} mục đã chọn</div>
          ) : null}
          {entries.map((en) => (
            <React.Fragment key={en.label}>
              {en.sep ? <div className="vio-menu-sep" /> : null}
              <button
                type="button"
                className="vio-menu-item"
                disabled={en.disabled}
                onClick={() => {
                  setMenu(null);
                  en.act();
                }}
              >
                <span>{en.label}</span>
                {en.hint ? <span className="vio-menu-hint">{en.hint}</span> : null}
              </button>
            </React.Fragment>
          ))}
        </div>
      ) : null}
      {picker ? (
        <FolderPicker
          mode={picker.mode}
          count={picker.items.length}
          startBucket={bucketName}
          startPrefix={currentPrefix}
          disabledPrefixes={picker.items.filter((i) => i.endsWith("/"))}
          srcBucket={bucketName}
          onCancel={() => setPicker(null)}
          onChoose={(b, p) => {
            const p0 = picker;
            setPicker(null);
            run(p0.mode, p0.items, b, p);
          }}
        />
      ) : null}
      {renaming ? (
        <RenameDialog
          name={baseName(renaming)}
          isDir={renaming.endsWith("/")}
          onCancel={() => setRenaming(null)}
          onOk={async (n) => {
            const key = renaming;
            setRenaming(null);
            if (n !== baseName(key)) {
              await run("move", [key], bucketName, key.slice(0, key.length - baseName(key).length - (key.endsWith("/") ? 1 : 0)), {
                newName: n,
                conflict: "fail",
              });
            }
          }}
        />
      ) : null}
      {busy ? (
        <div className="vio-overlay">
          <div className="vio-dialog vio-busy">{busy.text}</div>
        </div>
      ) : null}
      {problem ? (
        <div className="vio-overlay">
          <div className="vio-dialog">
            <h3>Có lỗi khi thực hiện</h3>
            <div className="vio-errlist">
              {problem.slice(0, 20).map((m, i) => (
                <div key={i}>{m}</div>
              ))}
              {problem.length > 20 ? <div>… và {problem.length - 20} lỗi khác</div> : null}
            </div>
            <div className="vio-actions">
              <button type="button" className="vio-btn vio-primary" onClick={() => setProblem(null)}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const RenameDialog = ({
  name,
  isDir,
  onOk,
  onCancel,
}: {
  name: string;
  isDir: boolean;
  onOk: (n: string) => void;
  onCancel: () => void;
}) => {
  const [v, setV] = useState(name);
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.focus();
      const dot = isDir ? -1 : name.lastIndexOf(".");
      el.setSelectionRange(0, dot > 0 ? dot : name.length);
    }
  }, [name, isDir]);
  const valid = v.trim() !== "" && !v.includes("/");
  return (
    <div className="vio-overlay" onMouseDown={onCancel}>
      <div className="vio-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Đổi tên {isDir ? "thư mục" : "file"}</h3>
        <input
          ref={ref}
          className="vio-input"
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && valid) {
              onOk(v.trim());
            } else if (e.key === "Escape") {
              onCancel();
            }
          }}
        />
        {v.includes("/") ? <div className="vio-warn">Tên không được chứa dấu “/”</div> : null}
        <div className="vio-actions">
          <button type="button" className="vio-btn" onClick={onCancel}>
            Hủy
          </button>
          <button type="button" className="vio-btn vio-primary" disabled={!valid} onClick={() => onOk(v.trim())}>
            Đổi tên
          </button>
        </div>
      </div>
    </div>
  );
};

const FolderPicker = ({
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
      .then((f) => alive && setFolders(f))
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
    <div className="vio-overlay" onMouseDown={onCancel}>
      <div className="vio-dialog vio-picker" onMouseDown={(e) => e.stopPropagation()}>
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
            <button
              type="button"
              className="vio-folder"
              onClick={() => setPrefix(crumbs.slice(0, -1).join("/") + (crumbs.length > 1 ? "/" : ""))}
            >
              ↩ Lên thư mục cha
            </button>
          ) : null}
          {loading ? <div className="vio-muted">Đang tải…</div> : null}
          {err ? <div className="vio-warn">{err}</div> : null}
          {!loading && !err && folders.length === 0 ? (
            <div className="vio-muted">Không có thư mục con</div>
          ) : null}
          {folders.map((f) => (
            <button
              type="button"
              key={f}
              className="vio-folder"
              disabled={blocked(f)}
              onClick={() => setPrefix(f)}
            >
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
          <button
            type="button"
            className="vio-btn vio-primary"
            disabled={hereBlocked}
            onClick={() => onChoose(bucket, prefix)}
          >
            {mode === "move" ? "Chuyển vào đây" : "Sao chép vào đây"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ObjectContextMenu;
