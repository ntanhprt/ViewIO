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
const saveList = (k: string, v: FsRef[]) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    // bỏ qua
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
