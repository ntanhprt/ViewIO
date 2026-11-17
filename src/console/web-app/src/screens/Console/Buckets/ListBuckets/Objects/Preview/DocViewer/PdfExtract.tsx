// ViewIO: trích các trang chọn từ PDF đang xem → lưu về máy hoặc lưu lên S3.
// Xử lý hoàn toàn ở trình duyệt (pdf-lib), PDF không rời khỏi máy người dùng cho tới khi chọn lưu S3.
import React, { useMemo, useState } from "react";
import { PDFDocument } from "pdf-lib";

export const PAGES_HELP =
  "Nhập số trang, ngăn cách bằng dấu phẩy. Ví dụ:\n" +
  "• 1,4,3 → lấy trang 1, 4, 3 (đúng thứ tự gõ)\n" +
  "• 7-11 → từ trang 7 đến 11\n" +
  "• 8... (hoặc 8-) → từ trang 8 đến hết\n" +
  "• ...6 (hoặc -6) → từ đầu đến trang 6\n" +
  "• 11-7 → lấy ngược từ 11 về 7\n" +
  "Ví dụ đầy đủ: 1,4,3, 7-11, 8..., ...6";

// "1,4,3, 7-11, 8..., ...6" → danh sách trang (1-based). Ném Error có thông báo tiếng Việt nếu sai.
export const parsePages = (input: string, total: number): number[] => {
  const tokens = input
    .split(/[,;\n]+/)
    .map((t) => t.replace(/\s+/g, ""))
    .filter(Boolean);
  if (!tokens.length) {
    throw new Error("Chưa nhập trang nào.");
  }
  const out: number[] = [];
  const num = (s: string, tok: string) => {
    const n = parseInt(s, 10);
    if (!/^\d+$/.test(s) || n < 1 || n > total) {
      throw new Error(`"${tok}": trang phải từ 1 đến ${total}.`);
    }
    return n;
  };
  for (const tok of tokens) {
    const m = tok.match(/^(\d*)(?:\.{2,3}|…|-|–)(\d*)$/);
    if (m) {
      if (!m[1] && !m[2]) {
        throw new Error(`"${tok}" không hợp lệ.`);
      }
      const a = m[1] ? num(m[1], tok) : 1;
      const b = m[2] ? num(m[2], tok) : total;
      if (a <= b) {
        for (let p = a; p <= b; p++) out.push(p);
      } else {
        for (let p = a; p >= b; p--) out.push(p);
      }
    } else {
      out.push(num(tok, tok));
    }
  }
  return out;
};

// Rút gọn danh sách trang để đặt tên file: [1,2,3,7] → "1-3_7"
export const pagesLabel = (pages: number[]): string => {
  const parts: string[] = [];
  let i = 0;
  while (i < pages.length) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    parts.push(j > i ? `${pages[i]}-${pages[j]}` : `${pages[i]}`);
    i = j + 1;
  }
  return parts.join("_");
};

const buildPdf = async (src: string | Blob, pages: number[]): Promise<Blob> => {
  let bytes: ArrayBuffer;
  if (typeof src === "string") {
    const res = await fetch(src);
    if (!res.ok) {
      throw new Error(`Không đọc được PDF (HTTP ${res.status}).`);
    }
    bytes = await res.arrayBuffer();
  } else {
    bytes = await src.arrayBuffer();
  }
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const copied = await out.copyPages(
    doc,
    pages.map((p) => p - 1),
  );
  copied.forEach((pg) => out.addPage(pg));
  const data = await out.save();
  return new Blob([data], { type: "application/pdf" });
};

const http = (
  method: string,
  action: string,
  q: Record<string, string>,
  body?: Blob | string,
): Promise<{ status: number; text: string }> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `docview/upload/${action}?${new URLSearchParams(q)}`, true);
    xhr.withCredentials = false;
    if (typeof body === "string") {
      xhr.setRequestHeader("Content-Type", "application/json");
    }
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
    xhr.onerror = () => reject(new Error("Lỗi mạng khi lưu lên S3."));
    xhr.send(body);
  });

const uploadToS3 = async (bucket: string, key: string, blob: Blob) => {
  const base = { bucket, key };
  const init = await http("POST", "init", {
    ...base,
    contentType: "application/pdf",
  });
  if (init.status !== 200) {
    throw new Error(errMsg(init.text, init.status));
  }
  const uploadId = JSON.parse(init.text).uploadId as string;
  try {
    const part = await http(
      "PUT",
      "part",
      { ...base, uploadId, part: "1" },
      blob,
    );
    if (part.status !== 200) {
      throw new Error(errMsg(part.text, part.status));
    }
    const etag = JSON.parse(part.text).etag as string;
    const done = await http(
      "POST",
      "complete",
      { ...base, uploadId },
      JSON.stringify([{ part: 1, etag }]),
    );
    if (done.status >= 300) {
      throw new Error(errMsg(done.text, done.status));
    }
  } catch (e) {
    http("POST", "abort", { ...base, uploadId }).catch(() => undefined);
    throw e;
  }
};

const errMsg = (text: string, status: number) => {
  try {
    return JSON.parse(text).detailedMessage || `Lỗi ${status}`;
  } catch (e) {
    return `Lỗi ${status}`;
  }
};

interface IProps {
  file: string | Blob;
  numPages: number;
  current: number;
  bucket?: string;
  objectKey?: string; // khoá object gốc (để đặt tên mặc định + thư mục đích)
  onClose: () => void;
}

const splitKey = (k: string) => {
  const slash = k.lastIndexOf("/");
  const dir = slash >= 0 ? k.slice(0, slash + 1) : "";
  const file = slash >= 0 ? k.slice(slash + 1) : k;
  const dot = file.lastIndexOf(".");
  return { dir, stem: dot > 0 ? file.slice(0, dot) : file };
};

const PdfExtract = ({ file, numPages, current, bucket, objectKey, onClose }: IProps) => {
  const canS3 = !!bucket && !!objectKey;
  const { dir, stem } = splitKey(objectKey || "tai-lieu.pdf");
  const [text, setText] = useState(String(current));
  const [dest, setDest] = useState<"local" | "s3">(canS3 ? "s3" : "local");
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const parsed = useMemo(() => {
    try {
      return { pages: parsePages(text, numPages), err: "" };
    } catch (e: any) {
      return { pages: [] as number[], err: e.message as string };
    }
  }, [text, numPages]);

  const defName = parsed.pages.length
    ? `${stem}_trang_${pagesLabel(parsed.pages)}.pdf`
    : `${stem}.pdf`;
  const finalName = (touched && name.trim() ? name.trim() : defName).replace(
    /\.pdf$/i,
    "",
  ) + ".pdf";

  const save = async () => {
    if (parsed.err || !parsed.pages.length) {
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const blob = await buildPdf(file, parsed.pages);
      if (dest === "local") {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = finalName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        setMsg({ ok: true, text: `Đã tải về: ${finalName}` });
      } else {
        const key = finalName.includes("/") ? finalName : dir + finalName;
        await uploadToS3(bucket as string, key, blob);
        setMsg({ ok: true, text: `Đã lưu lên S3: ${bucket}/${key}` });
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || "Không trích được trang." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dv-extract" role="dialog" aria-label="Trích trang PDF">
      <div className="dv-extract-head">
        <b>Trích trang PDF</b>
        <button className="dv-btn" onClick={onClose} aria-label="Đóng">
          ✕
        </button>
      </div>
      <label className="dv-extract-row">
        <span>
          Các trang (tổng {numPages}){" "}
          <span className="dv-extract-help" title={PAGES_HELP}>
            ⓘ
          </span>
        </span>
        <input
          className="dv-input"
          style={{ width: "100%" }}
          value={text}
          placeholder="1,4,3, 7-11, 8..., ...6"
          title={PAGES_HELP}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
      </label>
      <div className="dv-extract-hint">
        {parsed.err ? (
          <span style={{ color: "#dc2626" }}>{parsed.err}</span>
        ) : (
          `Sẽ lấy ${parsed.pages.length} trang: ${parsed.pages.slice(0, 30).join(", ")}${
            parsed.pages.length > 30 ? "…" : ""
          }`
        )}
      </div>
      <div className="dv-extract-row">
        <span>Lưu ở đâu</span>
        <label>
          <input
            type="radio"
            checked={dest === "local"}
            onChange={() => setDest("local")}
          />{" "}
          Về máy này
        </label>{" "}
        <label title={canS3 ? "" : "Không xác định được bucket để lưu"}>
          <input
            type="radio"
            disabled={!canS3}
            checked={dest === "s3"}
            onChange={() => setDest("s3")}
          />{" "}
          Lên S3{canS3 ? ` (${bucket}/${dir})` : ""}
        </label>
      </div>
      <label className="dv-extract-row">
        <span>Tên file (mặc định: tên cũ + số trang)</span>
        <input
          className="dv-input"
          style={{ width: "100%" }}
          value={touched ? name : defName}
          onChange={(e) => {
            setTouched(true);
            setName(e.target.value);
          }}
        />
      </label>
      {msg ? (
        <div
          className="dv-extract-hint"
          style={{ color: msg.ok ? "#16a34a" : "#dc2626" }}
        >
          {msg.text}
        </div>
      ) : null}
      <div className="dv-extract-actions">
        <button className="dv-btn" onClick={onClose}>
          Đóng
        </button>
        <button
          className="dv-btn dv-active"
          disabled={busy || !!parsed.err || !parsed.pages.length}
          onClick={save}
        >
          {busy ? "Đang xử lý..." : dest === "local" ? "Tải về" : "Lưu lên S3"}
        </button>
      </div>
    </div>
  );
};

export default PdfExtract;
