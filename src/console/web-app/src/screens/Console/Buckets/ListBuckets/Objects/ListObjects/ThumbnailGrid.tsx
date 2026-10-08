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
  ReactNode,
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { FixedSizeList } from "react-window";
import { DateTime } from "luxon";
import { BucketObjectItem } from "./types";
import { displayFileIconName } from "./utils";
import { niceBytes } from "../../../../../../common/utils";
import { ThumbSize } from "../../../../ObjectBrowser/viewMode";
import "./ThumbnailGrid.css";

// Chiều rộng thẻ theo cỡ; ảnh thumbnail tỉ lệ 4:3
const CARD_W: Record<ThumbSize, number> = { s: 128, m: 176, l: 248 };
const GAP = 12;
const LABEL_H = 50;

// Phải khớp với danh sách ở api/docview_thumb.go (định dạng khác dùng icon luôn, không gọi server)
const THUMB_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "webp",
  "tif",
  "tiff",
  "ico",
  "jfif",
  "jpe",
  "pdf",
  "doc",
  "dot",
  "docx",
  "docm",
  "rtf",
  "odt",
  "xls",
  "xlsx",
  "xlsm",
  "ods",
  "ppt",
  "pptx",
  "pps",
  "ppsx",
  "odp",
  "mp4",
  "mov",
  "avi",
  "mkv",
  "webm",
  "mpeg",
  "mpg",
  "m4v",
  "wmv",
  "flv",
  "txt",
  "log",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "jsonl",
  "yaml",
  "yml",
  "xml",
  "html",
  "htm",
  "css",
  "js",
  "jsx",
  "ts",
  "tsx",
  "py",
  "java",
  "go",
  "rs",
  "c",
  "h",
  "cpp",
  "hpp",
  "cs",
  "php",
  "rb",
  "sh",
  "bash",
  "sql",
  "ini",
  "conf",
  "cfg",
  "toml",
  "env",
  "properties",
  "gradle",
  "kt",
  "swift",
  "lua",
  "vue",
  "scss",
  "r",
]);

const canThumb = (name: string) => {
  if (name.endsWith("/")) {
    return false;
  }
  const i = name.lastIndexOf(".");
  return i >= 0 && THUMB_EXT.has(name.slice(i + 1).toLowerCase());
};

const thumbUrl = (bucket: string, item: BucketObjectItem) => {
  const basename = document.baseURI.replace(window.location.origin, "");
  const q = new URLSearchParams({ bucket, prefix: item.name });
  if (item.version_id && item.version_id !== "null") {
    q.set("version_id", item.version_id);
  }
  return `${window.location.origin}${basename}docview/thumb?${q.toString()}`;
};

interface ICardProps {
  bucket: string;
  item: BucketObjectItem;
  width: number;
  selected: boolean;
  active: boolean;
  onToggle: (name: string, checked: boolean) => void;
  onClickItem: (item: BucketObjectItem, detail: number) => void;
}

const Card = memo(
  ({
    bucket,
    item,
    width,
    selected,
    active,
    onToggle,
    onClickItem,
  }: ICardProps) => {
    const isFolder = item.name.endsWith("/");
    const wantsThumb = canThumb(item.name);
    const [status, setStatus] = useState<"load" | "ok" | "fail">(
      wantsThumb ? "load" : "fail",
    );
    const base = item.name.split("/").filter(Boolean).pop() || item.name;

    const meta = isFolder
      ? "Thư mục"
      : [
          item.size ? niceBytes(String(item.size)) : "",
          item.last_modified
            ? DateTime.fromISO(item.last_modified).toFormat("dd/LL/yyyy HH:mm")
            : "",
        ]
          .filter(Boolean)
          .join(" · ");

    return (
      <div
        className={`vt-card ${selected ? "vt-sel" : ""} ${active ? "vt-active" : ""}`}
        style={{ width }}
        title={`${base}\n${meta}`}
        data-vt-name={item.name}
        onClick={(e) => onClickItem(item, e.detail)}
      >
        <input
          type="checkbox"
          className="vt-check"
          checked={selected}
          value={item.name}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onToggle(item.name, e.target.checked)}
        />
        <div
          className="vt-thumb"
          style={{ height: Math.round((width * 3) / 4) }}
        >
          {status !== "ok" ? (
            <div className="vt-icon" style={{ width: "100%", height: "100%" }}>
              {displayFileIconName(item.name, true)}
            </div>
          ) : null}
          {wantsThumb && status !== "fail" ? (
            <img
              src={thumbUrl(bucket, item)}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              style={{ opacity: status === "ok" ? 1 : 0 }}
              onLoad={() => setStatus("ok")}
              onError={() => setStatus("fail")}
            />
          ) : null}
        </div>
        <div className="vt-label">
          <div className="vt-name">{base}</div>
          <div className="vt-meta">{meta}</div>
        </div>
      </div>
    );
  },
);

interface IRowData {
  bucket: string;
  items: BucketObjectItem[];
  perRow: number;
  cardW: number;
  selectedSet: Set<string>;
  activeName: string | null;
  onToggle: (name: string, checked: boolean) => void;
  onClickItem: (item: BucketObjectItem, detail: number) => void;
}

// Phải là component cố định (không tạo lại mỗi lần render) để React không gỡ/dựng lại cả lưới
const Row = ({
  index,
  style,
  data,
}: {
  index: number;
  style: React.CSSProperties;
  data: IRowData;
}) => (
  <div className="vt-row" style={style}>
    {data.items
      .slice(index * data.perRow, (index + 1) * data.perRow)
      .map((item) => (
        <Card
          key={item.name + (item.version_id || "")}
          bucket={data.bucket}
          item={item}
          width={data.cardW}
          selected={data.selectedSet.has(item.name)}
          active={data.activeName === item.name}
          onToggle={data.onToggle}
          onClickItem={data.onClickItem}
        />
      ))}
  </div>
);

interface IThumbnailGridProps {
  bucketName: string;
  items: BucketObjectItem[];
  selected: string[];
  activeName: string | null;
  size: ThumbSize;
  loading: boolean;
  emptyMessage?: ReactNode;
  onToggle: (name: string, checked: boolean) => void;
  onOpen: (item: BucketObjectItem) => void;
  onPreview: (item: BucketObjectItem) => void;
}

const ThumbnailGrid = ({
  bucketName,
  items,
  selected,
  activeName,
  size,
  loading,
  emptyMessage,
  onToggle,
  onOpen,
  onPreview,
}: IThumbnailGridProps) => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 800, h: 480 });
  // Nhận diện double-click theo vị trí con trỏ + thời gian ở lần nhấn ĐẦU: danh sách có thể tải lại
  // ngay sau click đầu (mở panel/chuyển thư mục) nên không thể dựa vào sự kiện dblclick của thẻ.
  const lastDown = useRef<{
    t: number;
    x: number;
    y: number;
    item: BucketObjectItem | null;
  } | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) {
      return;
    }
    const measure = () => {
      const top = el.getBoundingClientRect().top;
      setBox({
        w: el.clientWidth,
        h: Math.max(260, window.innerHeight - top - 34),
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const cardW = CARD_W[size];
  const cardH = Math.round((cardW * 3) / 4) + LABEL_H;
  const perRow = Math.max(1, Math.floor((box.w - 8 + GAP) / (cardW + GAP)));
  const rowCount = Math.ceil(items.length / perRow);
  const selectedSet = new Set(selected);

  const handleClick = (item: BucketObjectItem, detail: number) => {
    if (detail <= 1) {
      onOpen(item);
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (e.button !== 0 || target.closest("input")) {
      return;
    }
    const now = Date.now();
    const last = lastDown.current;
    if (
      last &&
      now - last.t < 450 &&
      Math.hypot(e.clientX - last.x, e.clientY - last.y) < 8
    ) {
      lastDown.current = null;
      if (
        last.item &&
        !last.item.name.endsWith("/") &&
        !last.item.delete_flag
      ) {
        onPreview(last.item);
      }
      return;
    }
    const card = target.closest("[data-vt-name]") as HTMLElement | null;
    const name = card?.dataset.vtName;
    lastDown.current = {
      t: now,
      x: e.clientX,
      y: e.clientY,
      item: name ? items.find((i) => i.name === name) || null : null,
    };
  };

  const itemData: IRowData = {
    bucket: bucketName,
    items,
    perRow,
    cardW,
    selectedSet,
    activeName,
    onToggle,
    onClickItem: handleClick,
  };

  return (
    <div
      ref={wrapRef}
      className={`vt-wrap ${selected.length > 0 ? "vt-anysel" : ""}`}
      onMouseDownCapture={handleMouseDown}
    >
      {items.length === 0 ? (
        <div className="vt-empty">
          {loading ? "Đang tải..." : emptyMessage || "Thư mục trống"}
        </div>
      ) : (
        <FixedSizeList
          height={box.h}
          width={box.w}
          itemCount={rowCount}
          itemSize={cardH + GAP}
          itemData={itemData}
          overscanCount={2}
        >
          {Row}
        </FixedSizeList>
      )}
    </div>
  );
};

export default ThumbnailGrid;
