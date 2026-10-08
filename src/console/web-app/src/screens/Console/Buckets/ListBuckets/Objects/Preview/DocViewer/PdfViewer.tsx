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

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import { Loading, Problem } from "./ViewerShell";

pdfjs.GlobalWorkerOptions.workerSrc = "./scripts/pdf.worker.min.mjs";

interface IPdfViewerProps {
  file: string | Blob;
  onDownload: () => void;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Chỉ vẽ trang khi gần vào vùng nhìn thấy để PDF dài vẫn mượt
const LazyPage = ({
  index,
  width,
  ratio,
  term,
  register,
}: {
  index: number;
  width: number;
  ratio: number;
  term: string;
  register: (i: number, el: HTMLDivElement | null) => void;
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [near, setNear] = useState(index < 2);

  useEffect(() => {
    register(index, ref.current);
    return () => register(index, null);
  }, [index, register]);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const io = new IntersectionObserver(
      (entries) => setNear(entries[0].isIntersecting),
      { rootMargin: "1200px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const textRenderer = useMemo(() => {
    if (!term) {
      return undefined;
    }
    const re = new RegExp(escapeRegex(term), "gi");
    return ({ str }: { str: string }) =>
      escapeHtml(str).replace(re, (m) => `<mark>${m}</mark>`);
  }, [term]);

  return (
    <div
      ref={ref}
      className="dv-pagebox"
      style={{ width, height: Math.round(width * ratio) }}
      data-page={index + 1}
    >
      {near ? (
        <Page
          pageNumber={index + 1}
          width={width}
          renderAnnotationLayer={false}
          renderForms={false}
          customTextRenderer={textRenderer}
        />
      ) : null}
    </div>
  );
};

const PdfViewer = ({ file, onDownload }: IPdfViewerProps) => {
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(1);
  const [ratio, setRatio] = useState(1.414);
  const [current, setCurrent] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [thumbs, setThumbs] = useState(true);
  const [boxW, setBoxW] = useState(900);
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<number[]>([]);
  const [hitIdx, setHitIdx] = useState(0);
  const [searching, setSearching] = useState(false);

  const pdfRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pageEls = useRef<Record<number, HTMLDivElement | null>>({});
  const docFile = useMemo(() => file, [file]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, [numPages]);

  const pageWidth = Math.max(240, Math.min(boxW - 48, 1000) * zoom);

  const register = useCallback((i: number, el: HTMLDivElement | null) => {
    pageEls.current[i] = el;
  }, []);

  const goTo = useCallback((p: number) => {
    const el = pageEls.current[p - 1];
    if (el) {
      el.scrollIntoView({ block: "start" });
    }
  }, []);

  const onScroll = useCallback(() => {
    const sc = scrollRef.current;
    if (!sc) {
      return;
    }
    const mid = sc.getBoundingClientRect().top + sc.clientHeight * 0.35;
    let cur = 1;
    Object.keys(pageEls.current).forEach((k) => {
      const el = pageEls.current[Number(k)];
      if (el && el.getBoundingClientRect().top <= mid) {
        cur = Math.max(cur, Number(k) + 1);
      }
    });
    setCurrent(cur);
    setPageInput(String(cur));
  }, []);

  const runSearch = async () => {
    const q = query.trim();
    setTerm(q);
    setHits([]);
    setHitIdx(0);
    if (!q || !pdfRef.current) {
      return;
    }
    setSearching(true);
    const found: number[] = [];
    const needle = q.toLowerCase();
    for (let i = 1; i <= numPages; i++) {
      const page = await pdfRef.current.getPage(i);
      const tc = await page.getTextContent();
      const text = tc.items.map((it: any) => it.str || "").join(" ");
      if (text.toLowerCase().includes(needle)) {
        found.push(i);
      }
    }
    setSearching(false);
    setHits(found);
    if (found.length) {
      goTo(found[0]);
    }
  };

  const stepHit = (d: number) => {
    if (!hits.length) {
      return;
    }
    const n = (hitIdx + d + hits.length) % hits.length;
    setHitIdx(n);
    goTo(hits[n]);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") {
        return;
      }
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        goTo(Math.min(numPages, current + 1));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        goTo(Math.max(1, current - 1));
      } else if (e.key === "+" || e.key === "=") {
        setZoom((z) => Math.min(4, +(z + 0.15).toFixed(2)));
      } else if (e.key === "-") {
        setZoom((z) => Math.max(0.4, +(z - 0.15).toFixed(2)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, numPages, goTo]);

  if (error) {
    return (
      <Problem
        title="Không hiển thị được PDF"
        message={error}
        onDownload={onDownload}
      />
    );
  }

  const indexes = Array.from({ length: numPages }, (_, i) => i);

  return (
    <Document
      file={docFile}
      loading={<Loading text="Đang mở PDF..." />}
      error={<Problem title="Không mở được PDF" onDownload={onDownload} />}
      onLoadSuccess={async (pdf) => {
        pdfRef.current = pdf;
        setNumPages(pdf.numPages);
        try {
          const first = await pdf.getPage(1);
          const vp = first.getViewport({ scale: 1 });
          setRatio(vp.height / vp.width);
        } catch (e) {
          /* giữ tỉ lệ A4 mặc định */
        }
      }}
      onLoadError={(e) => setError(e?.message || "Lỗi không xác định")}
      className="dv-body"
    >
      {numPages > 0 ? (
        <React.Fragment>
          {thumbs ? (
            <div className="dv-thumbs">
              {indexes.map((i) => (
                <button
                  key={`t${i}`}
                  className={`dv-thumb ${current === i + 1 ? "dv-active" : ""}`}
                  onClick={() => goTo(i + 1)}
                >
                  {Math.abs(current - 1 - i) < 12 ? (
                    <Page
                      pageNumber={i + 1}
                      width={110}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                    />
                  ) : (
                    <div style={{ height: 110 * ratio }} />
                  )}
                  {i + 1}
                </button>
              ))}
            </div>
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
            <div className="dv-toolbar">
              <button
                className={`dv-btn ${thumbs ? "dv-active" : ""}`}
                onClick={() => setThumbs(!thumbs)}
                title="Ẩn/hiện thumbnail"
              >
                ▤
              </button>
              <span className="dv-sep" />
              <button
                className="dv-btn"
                disabled={current <= 1}
                onClick={() => goTo(current - 1)}
              >
                ‹
              </button>
              <input
                className="dv-input dv-page"
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                onKeyDown={(e) => {
                  const n = parseInt(pageInput, 10);
                  if (e.key === "Enter" && n >= 1 && n <= numPages) {
                    goTo(n);
                  }
                }}
              />
              <span className="dv-info">/ {numPages}</span>
              <button
                className="dv-btn"
                disabled={current >= numPages}
                onClick={() => goTo(current + 1)}
              >
                ›
              </button>
              <span className="dv-sep" />
              <button
                className="dv-btn"
                onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.15).toFixed(2)))}
              >
                −
              </button>
              <span className="dv-info">{Math.round(zoom * 100)}%</span>
              <button
                className="dv-btn"
                onClick={() => setZoom((z) => Math.min(4, +(z + 0.15).toFixed(2)))}
              >
                +
              </button>
              <button className="dv-btn" onClick={() => setZoom(1)}>
                Vừa khung
              </button>
              <span className="dv-sep" />
              <input
                className="dv-input"
                placeholder="Tìm trong tài liệu..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (e.shiftKey) {
                      stepHit(-1);
                    } else if (query.trim() === term && hits.length) {
                      stepHit(1);
                    } else {
                      runSearch();
                    }
                  }
                }}
              />
              <button className="dv-btn" onClick={() => stepHit(-1)} disabled={!hits.length}>
                ↑
              </button>
              <button className="dv-btn" onClick={() => stepHit(1)} disabled={!hits.length}>
                ↓
              </button>
              <span className="dv-info">
                {searching
                  ? "Đang tìm..."
                  : term
                    ? hits.length
                      ? `Trang ${hits[hitIdx]} (${hitIdx + 1}/${hits.length})`
                      : "Không thấy"
                    : ""}
              </span>
            </div>
            <div className="dv-scroll" ref={scrollRef} onScroll={onScroll}>
              <div className="dv-pages">
                {indexes.map((i) => (
                  <LazyPage
                    key={`p${i}`}
                    index={i}
                    width={pageWidth}
                    ratio={ratio}
                    term={term}
                    register={register}
                  />
                ))}
              </div>
            </div>
          </div>
        </React.Fragment>
      ) : null}
    </Document>
  );
};

export default PdfViewer;
