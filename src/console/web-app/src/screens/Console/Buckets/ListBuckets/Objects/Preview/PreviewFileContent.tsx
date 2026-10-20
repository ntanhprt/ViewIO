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

import React, { Fragment, useCallback, useEffect, useState } from "react";
import get from "lodash/get";
import { previewObjectType } from "../utils";
import { api } from "../../../../../../api";
import { downloadObject } from "../../../../ObjectBrowser/utils";
import { useAppDispatch } from "../../../../../../store";
import { setReloadObjectsList } from "../../../../ObjectBrowser/objectBrowserSlice";
import { BucketObject } from "../../../../../../api/consoleApi";
import { formatBytes } from "./DocViewer/useFileData";
import { Loading, Problem } from "./DocViewer/ViewerShell";
import PdfViewer from "./DocViewer/PdfViewer";
import ImageViewer from "./DocViewer/ImageViewer";
import TextViewer from "./DocViewer/TextViewer";
import TableViewer from "./DocViewer/TableViewer";
import DocxViewer from "./DocViewer/DocxViewer";
import OfficeViewer from "./DocViewer/OfficeViewer";
import HtmlViewer from "./DocViewer/HtmlViewer";
import DrawioViewer from "./DocViewer/DrawioViewer";
import TextEditor from "./DocViewer/TextEditor";
import OfficeEditorOverlay from "../ListObjects/OfficeEditorOverlay";
import { canOfficeEdit, convertOffice, drawioEnabled, info as fsInfo, isLegacyOffice, officeEnabled } from "../ListObjects/fileOps";
import { useSelector } from "react-redux";
import { AppState } from "../../../../../../store";

interface IPreviewFileProps {
  bucketName: string;
  actualInfo: BucketObject;
  // báo lên khung (Modal) để hiện loại file + dung lượng trên thanh tiêu đề
  onResolved?: (info: { badge: string; subtitle: string }) => void;
}

const BADGES: Record<string, string> = {
  image: "Ảnh",
  pdf: "PDF",
  audio: "Âm thanh",
  video: "Video",
  markdown: "Markdown",
  html: "HTML",
  drawio: "draw.io",
  code: "Văn bản",
  csv: "Bảng",
  excel: "Excel",
  docx: "Word",
  office: "Office",
  none: "",
};

const PreviewFile = ({ bucketName, actualInfo, onResolved }: IPreviewFileProps) => {
  const dispatch = useAppDispatch();
  const [metaData, setMetaData] = useState<any>(null);
  const [isMetaDataLoaded, setIsMetaDataLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [officeOn, setOfficeOn] = useState(false);
  const [drawioOn, setDrawioOn] = useState(false);
  const [drawioEditing, setDrawioEditing] = useState(false);
  const [officeEditing, setOfficeEditing] = useState(false);
  const [officeEtag, setOfficeEtag] = useState("");
  const [officeKey, setOfficeKey] = useState(""); // file thật đang sửa (khác file đang xem khi vừa chuyển từ .doc/.xls/.ppt)
  const [converting, setConverting] = useState(false);
  const [rev, setRev] = useState(0); // tăng sau khi lưu để các viewer đọc lại nội dung mới
  const anonymousMode = useSelector(
    (state: AppState) => state.system.anonymousMode,
  );

  useEffect(() => {
    officeEnabled().then(setOfficeOn);
    drawioEnabled().then(setDrawioOn);
  }, []);

  const objectName = actualInfo?.name || "";
  const fileName = objectName.split("/").pop() || objectName;

  const fetchMetadata = useCallback(() => {
    if (!isMetaDataLoaded) {
      api.buckets
        .getObjectMetadata(bucketName, {
          prefix: objectName,
          versionID: actualInfo.version_id || "",
        })
        .then((res) => {
          setMetaData(get(res.data, "objectMetadata", {}));
          setIsMetaDataLoaded(true);
        })
        .catch((err) => {
          console.error("Error Getting Metadata Status: ", err, err?.detailedError);
          setIsMetaDataLoaded(true);
        });
    }
  }, [bucketName, objectName, isMetaDataLoaded, actualInfo.version_id]);

  useEffect(() => {
    if (bucketName && objectName) {
      fetchMetadata();
    }
  }, [bucketName, objectName, fetchMetadata]);

  let path = "";
  if (actualInfo) {
    const basename = document.baseURI.replace(window.location.origin, "");
    path = `${window.location.origin}${basename}api/v1/buckets/${encodeURIComponent(bucketName)}/objects/download?preview=true&prefix=${encodeURIComponent(actualInfo.name || "")}`;
    if (actualInfo.version_id) {
      path = path.concat(`&version_id=${actualInfo.version_id}`);
    }
  }

  const objectType = previewObjectType(metaData, objectName);
  // Sửa trực tiếp: file dạng text (Markdown, code, CSV, HTML, draw.io XML); không sửa bản cũ trong lịch sử
  const editable =
    !anonymousMode &&
    ["code", "markdown", "csv", "html", "drawio"].includes(objectType) &&
    !(objectType === "drawio" && drawioOn) &&
    (actualInfo as any)?.is_latest !== false &&
    (actualInfo?.size ? Number(actualInfo.size) : 0) <= 5 * 1024 * 1024;
  const drawioEditable =
    drawioOn &&
    !anonymousMode &&
    objectType === "drawio" &&
    (actualInfo as any)?.is_latest !== false;
  const officeEditable =
    officeOn &&
    !anonymousMode &&
    ["docx", "excel", "office"].includes(objectType) &&
    (canOfficeEdit(objectName) || isLegacyOffice(objectName)) &&
    (actualInfo as any)?.is_latest !== false;
  const latestPath = `${window.location.origin}${document.baseURI.replace(window.location.origin, "")}api/v1/buckets/${encodeURIComponent(bucketName)}/objects/download?preview=true&prefix=${encodeURIComponent(objectName)}`;
  const size = actualInfo?.size ? Number(actualInfo.size) : undefined;

  useEffect(() => {
    if (isMetaDataLoaded && onResolved) {
      onResolved({
        badge: BADGES[objectType] || "",
        subtitle: [formatBytes(size), bucketName + "/" + objectName]
          .filter(Boolean)
          .join(" · "),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMetaDataLoaded, objectType]);

  const download = () => downloadObject(dispatch, bucketName, objectName, actualInfo);

  if (!isMetaDataLoaded) {
    return <Loading />;
  }

  // đóng trình soạn thảo Office: Document Server ghi về kho sau vài giây, nên đợi etag đổi rồi nạp lại viewer
  const closeOffice = async () => {
    setOfficeEditing(false);
    const before = officeEtag;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        if ((await fsInfo(bucketName, officeKey || objectName)).etag !== before) {
          setRev((n) => n + 1);
          return;
        }
      } catch {
        return;
      }
    }
  };

  if (drawioEditing) {
    return (
      <OfficeEditorOverlay
        bucket={bucketName}
        objectKey={objectName}
        kind="drawio"
        onClose={() => {
          setDrawioEditing(false);
          setRev((n) => n + 1);
        }}
      />
    );
  }

  if (officeEditing) {
    return (
      <OfficeEditorOverlay
        bucket={bucketName}
        objectKey={officeKey || objectName}
        onClose={closeOffice}
      />
    );
  }

  if (editing) {
    return (
      <TextEditor
        bucket={bucketName}
        objectKey={objectName}
        fileName={fileName}
        textPath={latestPath}
        markdown={objectType === "markdown"}
        onClose={(saved) => {
          setEditing(false);
          if (saved) {
            setRev((n) => n + 1);
          }
        }}
      />
    );
  }

  return (
    <Fragment key={rev}>
      {drawioEditable && (
        <button
          type="button"
          className="dv-edit-trigger"
          onClick={() => setDrawioEditing(true)}
          title="Sửa sơ đồ bằng draw.io"
          aria-label="Sửa"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        </button>
      )}
      {officeEditable && (
        <button
          type="button"
          className="dv-edit-trigger"
          disabled={converting}
          onClick={async () => {
            let key = objectName;
            if (isLegacyOffice(objectName)) {
              if (
                !window.confirm(
                  "File định dạng cũ cần chuyển sang định dạng mới (.docx/.xlsx/.pptx) mới sửa được.\nViewIO sẽ tạo một file mới cạnh file gốc (file gốc giữ nguyên) rồi mở để sửa. Tiếp tục?",
                )
              ) {
                return;
              }
              setConverting(true);
              try {
                key = await convertOffice(bucketName, objectName);
                dispatch(setReloadObjectsList(true));
              } catch (e: any) {
                window.alert("Không chuyển được: " + (e?.message || e));
                setConverting(false);
                return;
              }
              setConverting(false);
            }
            setOfficeKey(key);
            try {
              setOfficeEtag((await fsInfo(bucketName, key)).etag || "");
            } catch {
              setOfficeEtag("");
            }
            setOfficeEditing(true);
          }}
          title="Sửa bằng ONLYOFFICE (giữ nguyên định dạng)"
          aria-label="Sửa"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        </button>
      )}
      {editable && (
        <button
          type="button"
          className="dv-edit-trigger"
          onClick={() => setEditing(true)}
          title="Sửa nội dung file này"
          aria-label="Sửa"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        </button>
      )}
      {objectType === "pdf" && <PdfViewer file={path} onDownload={download} />}
      {objectType === "image" && <ImageViewer src={path} onDownload={download} />}
      {objectType === "video" && (
        <div className="dv-media">
          <video src={path} controls autoPlay playsInline />
        </div>
      )}
      {objectType === "audio" && (
        <div className="dv-media dv-audio">
          <audio src={path} controls autoPlay />
        </div>
      )}
      {objectType === "drawio" && (
        <DrawioViewer path={path} onDownload={download} />
      )}
      {objectType === "html" && (
        <HtmlViewer
          bucketName={bucketName}
          objectName={objectName}
          fileName={fileName}
          sourcePath={path}
          onDownload={download}
        />
      )}
      {(objectType === "code" || objectType === "markdown") && (
        <TextViewer
          path={path}
          fileName={fileName}
          markdown={objectType === "markdown"}
          onDownload={download}
        />
      )}
      {objectType === "csv" && (
        <TableViewer path={path} kind="csv" onDownload={download} />
      )}
      {objectType === "excel" && (
        <TableViewer path={path} kind="excel" onDownload={download} />
      )}
      {objectType === "docx" && <DocxViewer path={path} onDownload={download} />}
      {objectType === "office" && (
        <OfficeViewer
          path={path}
          fileName={fileName}
          size={size}
          onDownload={download}
        />
      )}
      {objectType === "none" && (
        <Problem
          title="Chưa hỗ trợ xem trước định dạng này"
          message="Hãy tải file về để mở."
          onDownload={download}
        />
      )}
    </Fragment>
  );
};

export default PreviewFile;
