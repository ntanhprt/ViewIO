import { getWho } from "../../../../../../identity";

// ViewIO: thao tác kiểu Windows Explorer (copy / cắt / dán / di chuyển / đổi tên) — gọi /docview/fs/* (api/docview_fs.go)

export interface FsClipboard {
  op: "copy" | "move";
  bucket: string;
  items: string[]; // key; thư mục kết thúc bằng "/"
}

export interface FsMove {
  from: string;
  to: string;
}

export interface FsResult {
  ok: number;
  skipped: number;
  failed: string[];
  moves: FsMove[];
}

export type FsOp = "copy" | "move" | "trash" | "restore";

const base = () => document.baseURI.replace(window.location.origin, "");
const url = (p: string) => `${window.location.origin}${base()}docview/fs/${p}`;

let clipboard: FsClipboard | null = null;
export const getClipboard = () => clipboard;
export const setClipboard = (c: FsClipboard | null) => {
  clipboard = c;
  window.dispatchEvent(new Event("viewio-clipboard"));
};

export const baseName = (key: string) =>
  key.split("/").filter(Boolean).pop() || key;

export const listFolders = async (
  bucket: string,
  prefix: string,
): Promise<string[]> => {
  const q = new URLSearchParams({ bucket, prefix });
  const res = await fetch(url(`list?${q.toString()}`), {
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detailedMessage || `Lỗi ${res.status}`);
  }
  return data.folders || [];
};

export const listBuckets = async (): Promise<string[]> => {
  const res = await fetch(url("list"), { credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detailedMessage || `Lỗi ${res.status}`);
  }
  return data.buckets || [];
};

export interface TransferOpts {
  op: FsOp;
  bucket: string;
  items: string[];
  destBucket: string;
  destPrefix: string;
  newName?: string;
  conflict?: "keep" | "overwrite" | "skip" | "fail";
  onProgress?: (done: number, total: number) => void;
}

// Server trả luồng NDJSON: {"done":n,"total":m} ... {"result":true,"ok":..,"failed":[..]}
export const transfer = async (o: TransferOpts): Promise<FsResult> => {
  const res = await fetch(url("transfer"), {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      op: o.op,
      bucket: o.bucket,
      items: o.items,
      destBucket: o.destBucket,
      destPrefix: o.destPrefix,
      newName: o.newName,
      conflict: o.conflict,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detailedMessage || `Lỗi ${res.status}`);
  }
  const text = await res.text();
  let result: FsResult = { ok: 0, skipped: 0, failed: [], moves: [] };
  let got = false;
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const l = JSON.parse(line);
      if (l.result) {
        result = {
          ok: l.ok || 0,
          skipped: l.skipped || 0,
          failed: l.failed || [],
          moves: l.moves || [],
        };
        got = true;
      } else if (l.total && o.onProgress) {
        o.onProgress(l.done || 0, l.total);
      }
    } catch {
      // bỏ qua dòng hỏng
    }
  }
  if (!got) {
    throw new Error("Máy chủ ngắt kết nối giữa chừng, hãy tải lại danh sách để kiểm tra");
  }
  return result;
};

export const fsParent = (key: string) => {
  const k = key.endsWith("/") ? key.slice(0, -1) : key;
  const i = k.lastIndexOf("/");
  return i < 0 ? "" : k.slice(0, i + 1);
};

const postJson = async (p: string, body: unknown) => {
  const res = await fetch(url(p), {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detailedMessage || `Lỗi ${res.status}`);
  }
  return data;
};

const getJson = async (p: string, params: Record<string, string>) => {
  const res = await fetch(url(`${p}?${new URLSearchParams(params).toString()}`), {
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detailedMessage || `Lỗi ${res.status}`);
  }
  return data;
};

export const mkdir = (bucket: string, key: string) =>
  postJson("mkdir", { bucket, key });

export const purge = (bucket: string, items: string[]): Promise<{ deleted: number; failed: string[] }> =>
  postJson("purge", { bucket, items });

export interface FsHit {
  key: string;
  size: number;
  modified: string;
}

export const search = (
  bucket: string,
  o: { prefix?: string; q?: string; type?: string; days?: number; limit?: number },
): Promise<{ hits: FsHit[]; truncated: boolean }> =>
  getJson("search", {
    bucket,
    prefix: o.prefix || "",
    q: o.q || "",
    type: o.type || "",
    days: String(o.days || 0),
    limit: String(o.limit || 300),
  });

export interface FsInfo {
  dir: boolean;
  key: string;
  size: number;
  modified?: string;
  contentType?: string;
  etag?: string;
  editor?: string;
  files?: number;
  folders?: number;
  truncated?: boolean;
}

export const info = (bucket: string, key: string): Promise<FsInfo> =>
  getJson("info", { bucket, key });

// Tải nhiều mục / thư mục dưới dạng .zip: dùng chính phiên đăng nhập (cookie), trình duyệt tự stream về đĩa
export const zipDownload = (bucket: string, keys: string[]) => {
  const q = new URLSearchParams({ bucket });
  keys.forEach((k) => q.append("key", k));
  const a = document.createElement("a");
  a.href = url(`zip?${q.toString()}`);
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
};

export const formatSize = (n: number) => {
  if (n < 1024) {
    return `${n} B`;
  }
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${u[i]}`;
};

// ---- Yêu thích / gần đây (lưu cục bộ trên trình duyệt) ----
export interface FsRef {
  bucket: string;
  key: string;
  t?: number;
}

const loadList = (k: string): FsRef[] => {
  try {
    const v = JSON.parse(localStorage.getItem(k) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const saveList = (k: string, v: FsRef[], push = true) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    // bỏ qua
  }
  if (push) {
    pushPrefs();
  }
};

// Yêu thích/gần đây đồng bộ theo tài khoản qua /docview/fs/prefs (server giữ bản chuẩn); lỗi thì dùng localStorage
let pushTimer: any = null;
const pushPrefs = () => {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    fetch(url("prefs"), {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fav: getFavorites(), recent: getRecent() }),
    }).catch(() => undefined);
  }, 800);
};

let prefsSynced = false;
export const syncPrefs = async () => {
  if (prefsSynced) {
    return;
  }
  prefsSynced = true;
  try {
    const res = await fetch(url("prefs"), { credentials: "same-origin" });
    if (!res.ok) {
      return;
    }
    const d = await res.json();
    const sf: FsRef[] = d.fav || [];
    const sr: FsRef[] = d.recent || [];
    if (sf.length === 0 && sr.length === 0) {
      if (getFavorites().length || getRecent().length) {
        pushPrefs(); // lần đầu: đưa dữ liệu cục bộ lên server
      }
      return;
    }
    saveList("viewio.fav", sf, false);
    saveList("viewio.recent", sr, false);
  } catch {
    // dùng localStorage
  }
};

export const getFavorites = () => loadList("viewio.fav");
export const isFavorite = (bucket: string, key: string) =>
  getFavorites().some((f) => f.bucket === bucket && f.key === key);
export const toggleFavorite = (bucket: string, key: string) => {
  const cur = getFavorites();
  const has = cur.some((f) => f.bucket === bucket && f.key === key);
  saveList(
    "viewio.fav",
    has ? cur.filter((f) => !(f.bucket === bucket && f.key === key)) : [...cur, { bucket, key }],
  );
  return !has;
};

export const getRecent = () => loadList("viewio.recent");
export const addRecent = (bucket: string, key: string) => {
  const cur = getRecent().filter((f) => !(f.bucket === bucket && f.key === key));
  saveList("viewio.recent", [{ bucket, key, t: Date.now() }, ...cur].slice(0, 30));
};

// ---- Hoàn tác thao tác gần nhất ----
export type UndoEntry =
  | { kind: "moveBack"; label: string; moves: FsMove[]; bucket: string }
  | { kind: "trashCreated"; label: string; keys: string[]; bucket: string };

let undoEntry: UndoEntry | null = null;
export const getUndo = () => undoEntry;
export const setUndo = (u: UndoEntry | null) => {
  undoEntry = u;
  window.dispatchEvent(new Event("viewio-clipboard"));
};

// Lưu nội dung text đã sửa. etag = ETag lúc mở file: nếu file đã bị người khác sửa, server trả 409 (conflict=true)
export const saveText = async (
  bucket: string,
  key: string,
  etag: string,
  text: string,
): Promise<{ etag: string; versionId: string }> => {
  const q = new URLSearchParams({ bucket, key, etag });
  const res = await fetch(url(`save?${q.toString()}`), {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body: new Blob([text], { type: "text/plain; charset=utf-8" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: any = new Error(data.detailedMessage || `Lỗi ${res.status}`);
    err.conflict = res.status === 409;
    throw err;
  }
  return data;
};

// ---- Soạn thảo Word/Excel/PowerPoint bằng ONLYOFFICE (xem api/docview_office.go) ----
export const OFFICE_EDIT_EXT = ["docx", "xlsx", "pptx", "odt", "ods", "odp"];
export const canOfficeEdit = (name: string) =>
  OFFICE_EDIT_EXT.includes((name.split(".").pop() || "").toLowerCase());

let officeFlag: Promise<boolean> | null = null;
export const officeEnabled = (): Promise<boolean> => {
  if (!officeFlag) {
    officeFlag = fetch(`${window.location.origin}${base()}docview/office/status`, {
      credentials: "same-origin",
    })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => !!d.enabled)
      .catch(() => false);
  }
  return officeFlag;
};

export const officeEditorUrl = (bucket: string, key: string) =>
  `${window.location.origin}${base()}docview/office/editor?${new URLSearchParams({ bucket, key, who: getWho() }).toString()}`;

export const newOfficeDoc = (bucket: string, key: string) =>
  postJson("newdoc", { bucket, key });

// ---- Sửa sơ đồ draw.io trực quan (draw.io tự host, xem api/docview_drawio.go) ----
export const canDrawioEdit = (name: string) => /\.(drawio|dio)$/i.test(name);

let drawioFlag: Promise<boolean> | null = null;
export const drawioEnabled = (): Promise<boolean> => {
  if (!drawioFlag) {
    drawioFlag = fetch(`${window.location.origin}${base()}docview/drawio/status`, {
      credentials: "same-origin",
    })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => !!d.enabled)
      .catch(() => false);
  }
  return drawioFlag;
};

export const drawioEditorUrl = (bucket: string, key: string) =>
  `${window.location.origin}${base()}docview/drawio/editor?${new URLSearchParams({ bucket, key, who: getWho() }).toString()}`;

// ---- Office đời cũ (.doc/.xls/.ppt...): chuyển sang định dạng mới rồi mới sửa được ----
export const LEGACY_OFFICE: Record<string, string> = {
  doc: "docx",
  rtf: "docx",
  xls: "xlsx",
  ppt: "pptx",
  pps: "pptx",
};
export const isLegacyOffice = (name: string) =>
  (name.split(".").pop() || "").toLowerCase() in LEGACY_OFFICE;

export const convertOffice = async (bucket: string, key: string): Promise<string> => {
  const res = await fetch(`${window.location.origin}${base()}docview/office/convert`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket, key }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detailedMessage || `Lỗi ${res.status}`);
  }
  return data.key;
};

// Ảnh nằm trực tiếp trong một thư mục (danh sách lấy từ máy chủ, đủ cả khi danh sách trên màn hình chưa tải hết)
export const listImages = async (bucket: string, dir: string): Promise<FsHit[]> => {
  const d = await getJson("images", { bucket, dir });
  return d.images || [];
};

// ---- Nhật ký hoạt động / thông báo ----
export interface ActivityEntry {
  t: number;
  bucket: string;
  actor: string;
  op: string;
  key: string;
  to?: string;
  via?: string;
}

export const getActivity = async (): Promise<{ entries: ActivityEntry[]; now: number }> =>
  getJson("activity", { limit: "100" });

// ---- Menu "+ Mới" (giống Google Drive): các loại file/thư mục tạo được ngay trong thư mục hiện tại ----
export interface NewType {
  id: string;
  label: string;
  ext: string; // "" = thư mục hoặc tự nhập
  group: "folder" | "office" | "drawio" | "text" | "custom";
  badge: string;
  color: string;
}

export const NEW_TYPES: NewType[] = [
  { id: "folder", label: "Thư mục", ext: "", group: "folder", badge: "📁", color: "#8a8f98" },
  { id: "docx", label: "Tài liệu Word", ext: "docx", group: "office", badge: "W", color: "#2b579a" },
  { id: "xlsx", label: "Bảng tính Excel", ext: "xlsx", group: "office", badge: "X", color: "#217346" },
  { id: "pptx", label: "Bài trình chiếu PowerPoint", ext: "pptx", group: "office", badge: "P", color: "#d24726" },
  { id: "drawio", label: "Sơ đồ draw.io", ext: "drawio", group: "drawio", badge: "◇", color: "#f08705" },
  { id: "md", label: "Markdown (.md)", ext: "md", group: "text", badge: "M", color: "#4b5563" },
  { id: "txt", label: "Văn bản (.txt)", ext: "txt", group: "text", badge: "T", color: "#6b7280" },
  { id: "csv", label: "Bảng CSV (.csv)", ext: "csv", group: "text", badge: "C", color: "#0f9d58" },
  { id: "json", label: "JSON (.json)", ext: "json", group: "text", badge: "{}", color: "#b7791f" },
  { id: "html", label: "Trang HTML (.html)", ext: "html", group: "text", badge: "<>", color: "#e34c26" },
  { id: "yaml", label: "YAML (.yaml)", ext: "yaml", group: "text", badge: "Y", color: "#cb171e" },
  { id: "xml", label: "XML (.xml)", ext: "xml", group: "text", badge: "‹›", color: "#7c3aed" },
  { id: "other", label: "File văn bản khác…", ext: "", group: "custom", badge: "＋", color: "#2563eb" },
];

export const requestNew = (id: string) =>
  window.dispatchEvent(new CustomEvent("viewio-new", { detail: { id } }));
