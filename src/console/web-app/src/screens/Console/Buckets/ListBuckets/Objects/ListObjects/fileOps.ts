// ViewIO: thao tác kiểu Windows Explorer (copy / cắt / dán / di chuyển / đổi tên) — gọi /docview/fs/* (api/docview_fs.go)

export interface FsClipboard {
  op: "copy" | "move";
  bucket: string;
  items: string[]; // key; thư mục kết thúc bằng "/"
}

export interface FsResult {
  ok: number;
  skipped: number;
  failed: string[];
}

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
  op: "copy" | "move";
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
  let result: FsResult = { ok: 0, skipped: 0, failed: [] };
  let got = false;
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const l = JSON.parse(line);
      if (l.result) {
        result = { ok: l.ok || 0, skipped: l.skipped || 0, failed: l.failed || [] };
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
