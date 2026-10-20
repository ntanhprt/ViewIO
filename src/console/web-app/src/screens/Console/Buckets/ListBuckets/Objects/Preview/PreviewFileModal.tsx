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

import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import PreviewFileContent from "./PreviewFileContent";
import { BucketObject } from "../../../../../../api/consoleApi";
import { AppState, useAppDispatch } from "../../../../../../store";
import { setSelectedPreview } from "../../../../ObjectBrowser/objectBrowserSlice";
import { downloadObject } from "../../../../ObjectBrowser/utils";
import { ViewerShell } from "./DocViewer/ViewerShell";
import { FsHit, listImages } from "../ListObjects/fileOps";

interface IPreviewFileProps {
  open: boolean;
  bucketName: string;
  actualInfo: BucketObject;
  onClosePreview: () => void;
}

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "ico", "apng"];
const isImageName = (n: string) =>
  IMAGE_EXT.includes((n.split(".").pop() || "").toLowerCase());
const dirOf = (k: string) => k.slice(0, k.lastIndexOf("/") + 1);
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const PreviewFileModal = ({
  open,
  bucketName,
  actualInfo,
  onClosePreview,
}: IPreviewFileProps) => {
  const dispatch = useAppDispatch();
  const [meta, setMeta] = useState({ badge: "", subtitle: "" });
  const records = useSelector((state: AppState) => state.objectBrowser.records);

  const name = actualInfo?.name || "";
  const dir = dirOf(name);

  // Danh sách ảnh của thư mục lấy từ máy chủ (đủ cả khi danh sách trên màn hình chưa tải hết / mở từ tìm kiếm, yêu thích)
  const [server, setServer] = useState<{ bucket: string; dir: string; items: FsHit[] } | null>(null);
  useEffect(() => {
    if (!open || !name || !isImageName(name)) {
      return;
    }
    if (server && server.bucket === bucketName && server.dir === dir) {
      return;
    }
    let alive = true;
    listImages(bucketName, dir)
      .then((items) => alive && setServer({ bucket: bucketName, dir, items }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bucketName, dir, name]);

  // Đang xem ảnh: gom các ảnh cùng thư mục (theo danh sách đang mở) để chuyển qua lại, sắp xếp theo tên (số theo giá trị)
  const siblings = useMemo(() => {
    if (!open || !name || !isImageName(name)) {
      return [] as BucketObject[];
    }
    // ưu tiên danh sách máy chủ; trong lúc chờ thì dùng danh sách đang hiển thị
    const fromServer: BucketObject[] | null =
      server && server.bucket === bucketName && server.dir === dir
        ? server.items.map((h) => ({
            name: h.key,
            size: h.size,
            last_modified: h.modified,
            version_id: "",
          }))
        : null;
    return (fromServer || (records as BucketObject[]))
      .filter(
        (o) =>
          o.name &&
          !o.name.endsWith("/") &&
          !(o as any).delete_flag &&
          dirOf(o.name) === dir &&
          isImageName(o.name),
      )
      .sort((a, b) =>
        collator.compare(a.name!.slice(dir.length), b.name!.slice(dir.length)),
      );
  }, [open, name, dir, records, server, bucketName]);
  const idx = siblings.findIndex((o) => o.name === name);

  if (!open) {
    return null;
  }

  const nav =
    idx >= 0 && siblings.length > 1
      ? {
          index: idx,
          total: siblings.length,
          prev: siblings[(idx - 1 + siblings.length) % siblings.length],
          next: siblings[(idx + 1) % siblings.length],
          go: (o: BucketObject) => dispatch(setSelectedPreview(o as any)),
        }
      : undefined;

  return (
    <ViewerShell
      title={name.split("/").pop() || name}
      subtitle={meta.subtitle}
      badge={meta.badge}
      onClose={onClosePreview}
      onDownload={() =>
        downloadObject(dispatch, bucketName, name, actualInfo)
      }
    >
      <PreviewFileContent
        key={name + (actualInfo?.version_id || "")}
        nav={nav}
        bucketName={bucketName}
        actualInfo={actualInfo}
        onResolved={setMeta}
      />
    </ViewerShell>
  );
};

export default PreviewFileModal;
