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
import { Loading, Problem } from "./ViewerShell";

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
      <div className="dv-toolbar">
        {markdown ? (
          <React.Fragment>
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
            <span className="dv-sep" />
          </React.Fragment>
        ) : null}
        {source ? (
          <React.Fragment>
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
          </React.Fragment>
        ) : null}
      </div>
      {truncated ? (
        <div className="dv-notice">
          File lớn, chỉ hiển thị 2 MB đầu tiên. Tải xuống để xem đầy đủ.
        </div>
      ) : null}
      <div className="dv-scroll" ref={body}>
        {markdown && !source ? (
          <div className="dv-md">
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
