// ViewIO: menu chuột phải + phím tắt + kéo thả kiểu Windows Explorer cho danh sách file:
// Mở, Tải xuống (.zip), Cắt/Sao chép/Dán, Di chuyển/Sao chép đến…, Đổi tên, Xoá (thùng rác), Thuộc tính,
// Yêu thích, Thư mục/file mới, Tìm toàn bucket, Thùng rác, Hoàn tác.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAppDispatch } from "../../../../../../store";
import { setSnackBarMessage } from "../../../../../../systemSlice";
import {
  setReloadObjectsList,
  setSelectedObjects,
} from "../../../../ObjectBrowser/objectBrowserSlice";
import {
  baseName,
  FsOp,
  FsRef,
  fsParent,
  getClipboard,
  getUndo,
  isFavorite,
  canDrawioEdit,
  convertOffice,
  isLegacyOffice,
  syncPrefs,
  canOfficeEdit,
  drawioEnabled,
  mkdir,
  newOfficeDoc,
  officeEnabled,
  setClipboard,
  setUndo,
  toggleFavorite,
  transfer,
  zipDownload,
} from "./fileOps";
import {
  FavDialog,
  FolderPicker,
  InfoDialog,
  Mode,
  NameDialog,
  SearchDialog,
  TrashDialog,
} from "./FileOpsDialogs";
import OfficeEditorOverlay from "./OfficeEditorOverlay";
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
  onNavigate: (bucket: string, prefix: string) => void;
  onPreviewKey: (bucket: string, key: string) => void;
  children: React.ReactNode;
}

const DRAG_TYPE = "application/x-viewio-items";

const inField = (t: EventTarget | null) =>
  !!(t as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true']");

type Dialog =
  | { t: "picker"; mode: Mode; items: string[] }
  | { t: "rename"; key: string }
  | { t: "new"; dir: boolean }
  | { t: "newoffice"; ext: "docx" | "xlsx" | "pptx" }
  | { t: "office"; key: string }
  | { t: "drawio"; key: string }
  | { t: "newdrawio" }
  | { t: "search" }
  | { t: "trash" }
  | { t: "info"; key: string }
  | { t: "fav" };

interface Entry {
  label: string;
  hint?: string;
  disabled?: boolean;
  sep?: boolean;
  act: () => void;
}

const ObjectContextMenu = ({
  bucketName,
  currentPrefix,
  selected,
  itemFromTarget,
  onSelect,
  onOpen,
  onDownload,
  onNavigate,
  onPreviewKey,
  children,
}: IProps) => {
  const dispatch = useAppDispatch();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: string[] } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string[] | null>(null);
  const [, bump] = useState(0);
  const [office, setOffice] = useState(false);
  const [drawio, setDrawio] = useState(false);
  useEffect(() => {
    officeEnabled().then(setOffice);
    drawioEnabled().then(setDrawio);
    syncPrefs().then(() => bump((n) => n + 1));
  }, []);

  useEffect(() => {
    const f = () => bump((n) => n + 1);
    window.addEventListener("viewio-clipboard", f);
    return () => window.removeEventListener("viewio-clipboard", f);
  }, []);

  const refresh = useCallback(() => {
    dispatch(setSelectedObjects([]));
    dispatch(setReloadObjectsList(true));
  }, [dispatch]);

  const notify = useCallback((m: string) => dispatch(setSnackBarMessage(m)), [dispatch]);

  const run = useCallback(
    async (
      op: FsOp,
      items: string[],
      destBucket: string,
      destPrefix: string,
      opts: { newName?: string; conflict?: "keep" | "fail"; src?: string; noUndo?: boolean } = {},
    ) => {
      const src = opts.src || bucketName;
      const verb = { copy: "Đang sao chép", move: "Đang chuyển", trash: "Đang xoá", restore: "Đang khôi phục" }[op];
      setBusy(`${verb}…`);
      try {
        const r = await transfer({
          op,
          bucket: src,
          items,
          destBucket,
          destPrefix,
          newName: opts.newName,
          conflict: opts.conflict || "keep",
          onProgress: (d, t) => setBusy(`${verb}… ${d}/${t}`),
        });
        if (r.failed.length > 0) {
          setProblem(r.failed);
        } else {
          const done = { copy: "Đã sao chép", move: "Đã chuyển", trash: "Đã chuyển vào thùng rác", restore: "Đã khôi phục" }[op];
          notify(`${done} ${r.ok} file`);
        }
        if (!opts.noUndo && r.moves.length > 0 && destBucket === src) {
          if (op === "copy") {
            setUndo({ kind: "trashCreated", label: "sao chép", keys: r.moves.map((m) => m.to), bucket: src });
          } else {
            setUndo({
              kind: "moveBack",
              label: { move: "di chuyển", trash: "xoá", restore: "khôi phục" }[op],
              moves: r.moves,
              bucket: src,
            });
          }
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
    [bucketName, notify, refresh],
  );

  const doUndo = useCallback(async () => {
    const u = getUndo();
    if (!u) {
      return;
    }
    setUndo(null);
    if (u.kind === "trashCreated") {
      await run("trash", u.keys, u.bucket, "", { src: u.bucket, noUndo: true });
      return;
    }
    setBusy("Đang hoàn tác…");
    const failed: string[] = [];
    for (const m of u.moves) {
      try {
        const r = await transfer({
          op: "move",
          bucket: u.bucket,
          items: [m.to],
          destBucket: u.bucket,
          destPrefix: fsParent(m.from),
          newName: baseName(m.from),
          conflict: "keep",
        });
        failed.push(...r.failed);
      } catch (e: any) {
        failed.push(e?.message || String(e));
      }
    }
    setBusy(null);
    if (failed.length) {
      setProblem(failed);
    } else {
      notify(`Đã hoàn tác ${u.label}`);
    }
    refresh();
  }, [notify, refresh, run]);

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
      const ok = await run(cb.op, cb.items, bucketName, intoFolder ?? currentPrefix, { src: cb.bucket });
      if (ok && cb.op === "move") {
        setClipboard(null);
      }
    },
    [bucketName, currentPrefix, run],
  );

  const doTrash = useCallback((items: string[]) => items.length && run("trash", items, bucketName, ""), [bucketName, run]);

  const download = (items: string[]) => {
    if (items.length === 1 && !items[0].endsWith("/")) {
      onDownload(items[0]);
    } else {
      zipDownload(bucketName, items);
    }
  };

  const openRef = (r: FsRef) => {
    if (r.key.endsWith("/")) {
      onNavigate(r.bucket, r.key);
    } else {
      onPreviewKey(r.bucket, r.key);
    }
  };

  // Phím tắt khi không gõ trong ô nhập và không có hộp thoại
  const dialogOpen = !!(dialog || busy || problem);
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
      } else if (mod && k === "z" && getUndo()) {
        e.preventDefault();
        doUndo();
      } else if (mod && e.shiftKey && k === "f") {
        e.preventDefault();
        setDialog({ t: "search" });
      } else if (e.key === "F2" && selected.length === 1) {
        e.preventDefault();
        setDialog({ t: "rename", key: selected[0] });
      } else if (e.key === "Delete" && selected.length) {
        e.preventDefault();
        doTrash(selected);
      } else if (e.key === "Escape") {
        setMenu(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialogOpen, selected, doCopyCut, doPaste, doUndo, doTrash]);

  useEffect(() => {
    if (!menu) {
      return;
    }
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    // Chuột phải làm panel chi tiết mở ra → bắn resize/scroll ngay lập tức; chỉ đóng menu vì cuộn/đổi cỡ sau đó
    const t = setTimeout(() => {
      window.addEventListener("wheel", close, true);
      window.addEventListener("resize", close);
    }, 400);
    return () => {
      clearTimeout(t);
      window.removeEventListener("click", close);
      window.removeEventListener("wheel", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  // Kéo thả: đặt draggable cho dòng của bảng (thẻ thumbnail tự có data-vt-name)
  useEffect(() => {
    const root = wrapRef.current;
    if (!root) {
      return;
    }
    const mark = () => {
      root.querySelectorAll<HTMLElement>("[role='row'], [data-vt-name]").forEach((el) => {
        if (el.getAttribute("draggable") !== "true" && !el.querySelector("[role='columnheader']")) {
          el.setAttribute("draggable", "true");
        }
      });
    };
    mark();
    const mo = new MutationObserver(mark);
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  const clearDrop = () =>
    wrapRef.current?.querySelectorAll(".vio-drop").forEach((el) => el.classList.remove("vio-drop"));

  const dropTarget = (e: React.DragEvent): { el: HTMLElement; folder: string } | null => {
    const t = e.target as HTMLElement;
    const key = itemFromTarget(t);
    if (!key || !key.endsWith("/")) {
      return null;
    }
    const el = (t.closest("[data-vt-name]") || t.closest("[role='row']")) as HTMLElement | null;
    return el ? { el, folder: key } : null;
  };

  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    const key = itemFromTarget(e.target as HTMLElement);
    if (!key) {
      return;
    }
    const items = selected.includes(key) ? selected : [key];
    if (!selected.includes(key)) {
      onSelect([key]);
    }
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(items));
    e.dataTransfer.effectAllowed = "copyMove";
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) {
      return;
    }
    clearDrop();
    const d = dropTarget(e);
    if (d) {
      e.preventDefault();
      e.dataTransfer.dropEffect = e.ctrlKey ? "copy" : "move";
      d.el.classList.add("vio-drop");
    }
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) {
      return;
    }
    clearDrop();
    const d = dropTarget(e);
    if (!d) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    let items: string[] = [];
    try {
      items = JSON.parse(e.dataTransfer.getData(DRAG_TYPE));
    } catch {
      return;
    }
    items = items.filter((i) => i !== d.folder);
    if (items.length) {
      run(e.ctrlKey ? "copy" : "move", items, bucketName, d.folder);
    }
  };

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
  const undo = getUndo();
  const entries: Entry[] = [];
  if (menu) {
    const items = menu.items;
    const single = items.length === 1 ? items[0] : null;
    const singleIsDir = !!single && single.endsWith("/");
    const inTrash = items.some((i) => i.startsWith(".trash/"));
    if (single) {
      entries.push({ label: singleIsDir ? "Mở thư mục" : "Mở / xem", act: () => onOpen(single) });
      if (drawio && !singleIsDir && canDrawioEdit(single)) {
        entries.push({ label: "Sửa sơ đồ (draw.io)", act: () => setDialog({ t: "drawio", key: single }) });
      }
      if (office && !singleIsDir && canOfficeEdit(single)) {
        entries.push({ label: "Sửa (Office)", act: () => setDialog({ t: "office", key: single }) });
      }
      if (office && !singleIsDir && isLegacyOffice(single)) {
        entries.push({
          label: "Sửa (chuyển sang định dạng mới)",
          act: async () => {
            if (!window.confirm("Sẽ tạo file mới (.docx/.xlsx/.pptx) cạnh file gốc rồi mở để sửa; file gốc giữ nguyên. Tiếp tục?")) {
              return;
            }
            setBusy("Đang chuyển định dạng…");
            try {
              const nk = await convertOffice(bucketName, single);
              dispatch(setReloadObjectsList(true));
              setDialog({ t: "office", key: nk });
            } catch (e: any) {
              setProblem([e?.message || String(e)]);
            } finally {
              setBusy(null);
            }
          },
        });
      }
    }
    if (items.length > 0) {
      entries.push({
        label: single && !singleIsDir ? "Tải xuống" : "Tải xuống (.zip)",
        act: () => download(items),
      });
      entries.push({ label: "Cắt", hint: "Ctrl+X", sep: true, act: () => doCopyCut("move", items) });
      entries.push({ label: "Sao chép", hint: "Ctrl+C", act: () => doCopyCut("copy", items) });
    }
    const pasteInto = singleIsDir ? single : undefined;
    entries.push({
      label: pasteInto ? "Dán vào thư mục này" : "Dán",
      hint: pasteInto ? undefined : "Ctrl+V",
      disabled: !cb,
      sep: items.length === 0,
      act: () => doPaste(pasteInto || undefined),
    });
    if (items.length > 0) {
      entries.push({ label: "Di chuyển đến…", sep: true, act: () => setDialog({ t: "picker", mode: "move", items }) });
      entries.push({ label: "Sao chép đến…", act: () => setDialog({ t: "picker", mode: "copy", items }) });
      if (single) {
        entries.push({ label: "Đổi tên", hint: "F2", act: () => setDialog({ t: "rename", key: single }) });
        entries.push({
          label: isFavorite(bucketName, single) ? "Bỏ khỏi yêu thích" : "Thêm vào yêu thích",
          act: () => notify(toggleFavorite(bucketName, single) ? "Đã thêm vào yêu thích" : "Đã bỏ khỏi yêu thích"),
        });
        entries.push({ label: "Thuộc tính", act: () => setDialog({ t: "info", key: single }) });
      }
      entries.push({
        label: "Xoá (vào thùng rác)",
        hint: "Del",
        sep: true,
        disabled: inTrash,
        act: () => doTrash(items),
      });
    } else {
      entries.push({ label: "Thư mục mới", sep: true, act: () => setDialog({ t: "new", dir: true }) });
      entries.push({ label: "File văn bản mới", act: () => setDialog({ t: "new", dir: false }) });
      if (drawio) {
        entries.push({ label: "Sơ đồ draw.io mới", act: () => setDialog({ t: "newdrawio" }) });
      }
      if (office) {
        entries.push({ label: "Tài liệu Word mới", act: () => setDialog({ t: "newoffice", ext: "docx" }) });
        entries.push({ label: "Bảng tính Excel mới", act: () => setDialog({ t: "newoffice", ext: "xlsx" }) });
        entries.push({ label: "Bài trình chiếu PowerPoint mới", act: () => setDialog({ t: "newoffice", ext: "pptx" }) });
      }
      entries.push({
        label: undo ? `Hoàn tác ${undo.label}` : "Hoàn tác",
        hint: "Ctrl+Z",
        disabled: !undo,
        sep: true,
        act: doUndo,
      });
      entries.push({ label: "Tìm trong toàn bộ bucket…", hint: "Ctrl+Shift+F", act: () => setDialog({ t: "search" }) });
      entries.push({ label: "Yêu thích và gần đây", act: () => setDialog({ t: "fav" }) });
      entries.push({ label: "Thùng rác", act: () => setDialog({ t: "trash" }) });
      entries.push({ label: "Làm mới", sep: true, act: () => dispatch(setReloadObjectsList(true)) });
    }
  }

  const createNew = async (name: string, dir: boolean) => {
    setDialog(null);
    try {
      await mkdir(bucketName, currentPrefix + name + (dir ? "/" : ""));
      notify(dir ? "Đã tạo thư mục" : "Đã tạo file");
      dispatch(setReloadObjectsList(true));
    } catch (e: any) {
      setProblem([e?.message || String(e)]);
    }
  };

  const createOffice = async (name: string, ext: string) => {
    setDialog(null);
    const file = name.toLowerCase().endsWith("." + ext) ? name : `${name}.${ext}`;
    const key = currentPrefix + file;
    try {
      await newOfficeDoc(bucketName, key);
      dispatch(setReloadObjectsList(true));
      setDialog(ext === "drawio" ? { t: "drawio", key } : { t: "office", key });
    } catch (e: any) {
      setProblem([e?.message || String(e)]);
    }
  };

  return (
    <div
      ref={wrapRef}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={clearDrop}
      onDrop={onDrop}
      onDragEnd={clearDrop}
    >
      {children}
      {menu ? (
        <div
          className="vio-menu"
          style={{
            left: Math.min(menu.x, window.innerWidth - 240),
            top: Math.max(8, Math.min(menu.y, window.innerHeight - entries.length * 32 - 24)),
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menu.items.length > 1 ? <div className="vio-menu-title">{menu.items.length} mục đã chọn</div> : null}
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
      {dialog?.t === "picker" ? (
        <FolderPicker
          mode={dialog.mode}
          count={dialog.items.length}
          startBucket={bucketName}
          startPrefix={currentPrefix}
          disabledPrefixes={dialog.items.filter((i) => i.endsWith("/"))}
          srcBucket={bucketName}
          onCancel={() => setDialog(null)}
          onChoose={(b, p) => {
            const d = dialog;
            setDialog(null);
            run(d.mode, d.items, b, p);
          }}
        />
      ) : null}
      {dialog?.t === "rename" ? (
        <NameDialog
          title={`Đổi tên ${dialog.key.endsWith("/") ? "thư mục" : "file"}`}
          initial={baseName(dialog.key)}
          okLabel="Đổi tên"
          isDir={dialog.key.endsWith("/")}
          onCancel={() => setDialog(null)}
          onOk={async (n) => {
            const key = dialog.key;
            setDialog(null);
            if (n !== baseName(key)) {
              await run("move", [key], bucketName, fsParent(key), { newName: n, conflict: "fail" });
            }
          }}
        />
      ) : null}
      {dialog?.t === "new" ? (
        <NameDialog
          title={dialog.dir ? "Thư mục mới" : "File văn bản mới"}
          initial={dialog.dir ? "Thư mục mới" : "Tài liệu mới.txt"}
          okLabel="Tạo"
          isDir={dialog.dir}
          onCancel={() => setDialog(null)}
          onOk={(n) => createNew(n, dialog.dir)}
        />
      ) : null}
      {dialog?.t === "newoffice" ? (
        <NameDialog
          title={{ docx: "Tài liệu Word mới", xlsx: "Bảng tính Excel mới", pptx: "Bài trình chiếu mới" }[dialog.ext]}
          initial={{ docx: "Tài liệu mới.docx", xlsx: "Bảng tính mới.xlsx", pptx: "Bài trình chiếu mới.pptx" }[dialog.ext]}
          okLabel="Tạo và mở"
          isDir={false}
          onCancel={() => setDialog(null)}
          onOk={(n) => createOffice(n, dialog.ext)}
        />
      ) : null}
      {dialog?.t === "newdrawio" ? (
        <NameDialog
          title="Sơ đồ draw.io mới"
          initial="Sơ đồ mới.drawio"
          okLabel="Tạo và mở"
          isDir={false}
          onCancel={() => setDialog(null)}
          onOk={(n) => createOffice(n, "drawio")}
        />
      ) : null}
      {dialog?.t === "drawio" ? (
        <OfficeEditorOverlay
          bucket={bucketName}
          objectKey={dialog.key}
          kind="drawio"
          onClose={() => {
            setDialog(null);
            dispatch(setReloadObjectsList(true));
          }}
        />
      ) : null}
      {dialog?.t === "office" ? (
        <OfficeEditorOverlay
          bucket={bucketName}
          objectKey={dialog.key}
          onClose={() => {
            setDialog(null);
            // Document Server ghi về kho sau khi đóng vài giây: làm mới danh sách vài lần
            [3000, 8000, 15000].forEach((ms) => setTimeout(() => dispatch(setReloadObjectsList(true)), ms));
          }}
        />
      ) : null}
      {dialog?.t === "search" ? (
        <SearchDialog
          bucket={bucketName}
          currentPrefix={currentPrefix}
          onOpenFile={(k) => onPreviewKey(bucketName, k)}
          onOpenFolder={(p) => onNavigate(bucketName, p)}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.t === "trash" ? (
        <TrashDialog bucket={bucketName} onChanged={refresh} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.t === "info" ? (
        <InfoDialog bucket={bucketName} keyName={dialog.key} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.t === "fav" ? <FavDialog onOpen={openRef} onClose={() => setDialog(null)} /> : null}
      {busy ? (
        <div className="vio-overlay">
          <div className="vio-dialog vio-busy">{busy}</div>
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

export default ObjectContextMenu;
