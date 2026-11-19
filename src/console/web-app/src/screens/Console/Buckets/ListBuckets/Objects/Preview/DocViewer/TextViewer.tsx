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

import React, { useEffect, useMemo, useRef, useState } from "react";
import hljs from "highlight.js/lib/common";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useFileData } from "./useFileData";
import { HeaderActions, Loading, Problem } from "./ViewerShell";

const TEXT_LIMIT = 2 * 1024 * 1024;
const HIGHLIGHT_LIMIT = 600 * 1024;

const LANG_BY_EXT: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  yml: "yaml",
  sh: "bash",
  bash: "bash",
  rs: "rust",
  kt: "kotlin",
  htm: "xml",
  html: "xml",
  xml: "xml",
  cs: "csharp",
  hpp: "cpp",
  h: "c",
  rb: "ruby",
  conf: "ini",
  cfg: "ini",
  env: "ini",
  properties: "ini",
  jsonl: "json",
  vue: "xml",
  gradle: "java",
  log: "plaintext",
  txt: "plaintext",
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface ITextViewerProps {
  path: string;
  fileName: string;
  markdown: boolean;
  onDownload: () => void;
}

const TextViewer = ({
  path,
  fileName,
  markdown,
  onDownload,
}: ITextViewerProps) => {
  const { blob, truncated, loading, error } = useFileData(path, TEXT_LIMIT);
  const [text, setText] = useState<string | null>(null);
  const [source, setSource] = useState(!markdown);
  const [wrap, setWrap] = useState(false);
  const [query, setQuery] = useState("");
  const [hit, setHit] = useState(0);
  const body = useRef<HTMLDivElement | null>(null);
  // ---- Markdown: heading thu gọn / mở rộng ----
  const md = useRef<HTMLDivElement | null>(null);
  const closed = useRef<Set<number>>(new Set());
  const [foldTick, setFoldTick] = useState(0); // ép render lại thanh nút khi đổi trạng thái
  const [foldInfo, setFoldInfo] = useState({ total: 0, shut: 0 });
  const applyFold = () => {
    const root = md.current;
    if (!root) {
      return;
    }
    let k = -1;
    let hideLevel = 0; // >0: đang ẩn mọi thứ dưới heading cấp này
    let shut = 0;
    const kids = Array.from(root.children) as HTMLElement[];
    // heading nào có nội dung phía sau thì mới gập được
    const hasBody = new Map<number, boolean>();
    {
      let idx = -1;
      let cur = -1;
      let lvl = 0;
      kids.forEach((el) => {
        const m = /^H([1-6])$/.exec(el.tagName);
        if (m) {
          if (cur >= 0 && !hasBody.has(cur) && Number(m[1]) > lvl) {
            hasBody.set(cur, true);
          }
          if (cur >= 0 && !hasBody.has(cur)) {
            hasBody.set(cur, false);
          }
          idx++;
          cur = idx;
          lvl = Number(m[1]);
        } else if (cur >= 0) {
          hasBody.set(cur, true);
        }
      });
      if (cur >= 0 && !hasBody.has(cur)) {
        hasBody.set(cur, false);
      }
    }
    kids.forEach((el) => {
      const m = /^H([1-6])$/.exec(el.tagName);
      if (m) {
        k++;
        const lvl = Number(m[1]);
        if (hideLevel && lvl > hideLevel) {
          el.style.display = "none";
        } else {
          hideLevel = 0;
          el.style.display = "";
        }
        const foldable = !!hasBody.get(k);
        el.classList.toggle("dv-fold", foldable);
        const isClosed = foldable && closed.current.has(k);
        el.classList.toggle("dv-fold-closed", isClosed);
        el.dataset.fold = String(k);
        if (isClosed) {
          shut++;
          if (!hideLevel) {
            hideLevel = lvl;
          }
        }
      } else {
        el.style.display = hideLevel ? "none" : "";
      }
    });
    setFoldInfo((o) => (o.total === k + 1 && o.shut === shut ? o : { total: k + 1, shut }));
  };
  useEffect(() => {
    closed.current = new Set();
    applyFold();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, source]);
  useEffect(() => {
    applyFold();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foldTick]);
  const toggleFold = (k: number) => {
    if (closed.current.has(k)) {
      closed.current.delete(k);
    } else {
      closed.current.add(k);
    }
    setFoldTick((n) => n + 1);
  };
  // gập tới cấp n: mọi heading cấp >= n đều đóng (n=0: mở hết)
  const foldToLevel = (n: number) => {
    const next = new Set<number>();
    if (n > 0 && md.current) {
      let k = -1;
      Array.from(md.current.children).forEach((el) => {
        const m = /^H([1-6])$/.exec(el.tagName);
        if (m) {
          k++;
          if (Number(m[1]) >= n) {
            next.add(k);
          }
        }
      });
    }
    closed.current = next;
    setFoldTick((n2) => n2 + 1);
  };

  const ext = (fileName.split(".").pop() || "").toLowerCase();
  const isJson = ext === "json";

  useEffect(() => {
    if (blob) {
      blob.text().then((t) => {
        if (isJson && !truncated) {
          try {
            t = JSON.stringify(JSON.parse(t), null, 2);
          } catch (e) {
            /* không phải JSON hợp lệ: giữ nguyên */
          }
        }
        setText(t);
      });
    }
  }, [blob, isJson, truncated]);

  const lines = useMemo(() => {
    if (text === null) {
      return [] as string[];
    }
    const lang = LANG_BY_EXT[ext] || ext;
    if (text.length <= HIGHLIGHT_LIMIT && hljs.getLanguage(lang)) {
      try {
        return highlightedLines(
          hljs.highlight(text, { language: lang, ignoreIllegals: true }).value,
        );
      } catch (e) {
        /* rơi xuống dạng thô */
      }
    }
    return text.split("\n").map(escapeHtml);
  }, [text, ext]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return [] as number[];
    }
    const found: number[] = [];
    (text || "").split("\n").forEach((l, i) => {
      if (l.toLowerCase().includes(q)) {
        found.push(i);
      }
    });
    return found;
  }, [query, text]);

  useEffect(() => {
    setHit(0);
  }, [query]);

  useEffect(() => {
    if (matches.length && body.current) {
      const el = body.current.querySelector(`[data-ln="${matches[hit]}"]`);
      el?.scrollIntoView({ block: "center" });
    }
  }, [hit, matches]);

  if (error) {
    return <Problem title="Không tải được file" message={error} onDownload={onDownload} />;
  }
  if (loading || text === null) {
    return <Loading />;
  }

  const q = query.trim();
  const markLine = (html: string) => {
    if (!q) {
      return html;
    }
    // đánh dấu trên văn bản thuần của dòng (bỏ qua thẻ span của highlight)
    const re = new RegExp(
      q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/&/g, "&amp;"),
      "gi",
    );
    return html.replace(/(<[^>]+>)|([^<]+)/g, (_m, tag, txt) =>
      tag ? tag : txt.replace(re, (x: string) => `<mark>${x}</mark>`),
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
      {markdown ? (
        <HeaderActions>
            <button
              className={`dv-btn ${!source ? "dv-active" : ""}`}
              onClick={() => setSource(false)}
            >
              Hiển thị
            </button>
            <button
              className={`dv-btn ${source ? "dv-active" : ""}`}
              onClick={() => setSource(true)}
            >
              Mã nguồn
            </button>
            {!source && foldInfo.total > 0 ? (
              <React.Fragment>
                <button
                  className="dv-btn"
                  title="Mở rộng tất cả các mục"
                  onClick={() => foldToLevel(0)}
                  disabled={foldInfo.shut === 0}
                >
                  ⊞<span className="dv-lbl"> Mở hết</span>
                </button>
                <button
                  className="dv-btn"
                  title="Thu gọn tất cả các mục (chỉ còn tiêu đề)"
                  onClick={() => foldToLevel(1)}
                >
                  ⊟<span className="dv-lbl"> Thu hết</span>
                </button>
                <select
                  className="dv-input"
                  title="Chỉ hiện các mục tới cấp heading này"
                  value=""
                  onChange={(e) => foldToLevel(Number(e.target.value))}
                  style={{ width: "auto" }}
                >
                  <option value="" disabled>
                    Cấp…
                  </option>
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n + 1}>
                      Hiện tới H{n}
                    </option>
                  ))}
                </select>
              </React.Fragment>
            ) : null}
          </HeaderActions>
        ) : null}
      {source ? (
        <div className="dv-toolbar">
            <button
              className={`dv-btn ${wrap ? "dv-active" : ""}`}
              onClick={() => setWrap(!wrap)}
            >
              Xuống dòng
            </button>
            <span className="dv-sep" />
            <input
              className="dv-input"
              placeholder="Tìm trong file..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matches.length) {
                  setHit((h) => (h + (e.shiftKey ? -1 : 1) + matches.length) % matches.length);
                }
              }}
            />
            <span className="dv-info">
              {q ? (matches.length ? `${hit + 1}/${matches.length}` : "Không thấy") : ""}
            </span>
            <span className="dv-info" style={{ marginLeft: "auto" }}>
              {lines.length.toLocaleString()} dòng
            </span>
        </div>
      ) : null}
      {truncated ? (
        <div className="dv-notice">
          File lớn, chỉ hiển thị 2 MB đầu tiên. Tải xuống để xem đầy đủ.
        </div>
      ) : null}
      <div className="dv-scroll" ref={body}>
        {markdown && !source ? (
          <div
            className="dv-md"
            ref={md}
            onClick={(e) => {
              const h = (e.target as HTMLElement).closest("[data-fold]") as HTMLElement | null;
              if (
                h &&
                h.classList.contains("dv-fold") &&
                !(e.target as HTMLElement).closest("a") &&
                !window.getSelection()?.toString()
              ) {
                toggleFold(Number(h.dataset.fold));
              }
            }}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          </div>
        ) : (
          <div className={`dv-text ${wrap ? "dv-wrap" : ""}`}>
            {lines.map((html, i) => (
              <div
                className="dv-line"
                key={i}
                data-ln={i}
                style={
                  matches.length && matches[hit] === i
                    ? { background: "var(--dv-hover)" }
                    : undefined
                }
              >
                <span className="dv-ln">{i + 1}</span>
                <span
                  className="dv-code"
                  dangerouslySetInnerHTML={{ __html: markLine(html) || " " }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// hljs có thể trả span kéo dài nhiều dòng: đóng/mở lại span theo từng dòng
function highlightedLines(html: string): string[] {
  const out: string[] = [];
  const open: string[] = [];
  html.split("\n").forEach((raw) => {
    let line = open.join("") + raw;
    const re = /<span[^>]*>|<\/span>/g;
    let m: RegExpExecArray | null;
    const stack: string[] = [...open];
    while ((m = re.exec(raw))) {
      if (m[0] === "</span>") {
        stack.pop();
      } else {
        stack.push(m[0]);
      }
    }
    line += "</span>".repeat(stack.length);
    open.length = 0;
    open.push(...stack);
    out.push(line);
  });
  return out;
}

export default TextViewer;
