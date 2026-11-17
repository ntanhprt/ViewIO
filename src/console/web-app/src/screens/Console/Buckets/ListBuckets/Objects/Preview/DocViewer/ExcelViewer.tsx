// ViewIO: xem file Excel (.xlsx) giống Excel.
// 1) Có ONLYOFFICE (Document Server): nhúng trình bảng tính với ĐỦ công cụ như Excel (kéo giãn cột/dòng,
//    xuống dòng trong ô, bỏ cố định hàng/cột, lọc/sắp xếp, tìm kiếm, thu phóng, nhiều sheet, in...) nhưng là
//    phiên xem tạm: mọi thay đổi chỉ nằm trên màn hình, KHÔNG ghi về kho (muốn lưu thì bấm "Sửa").
// 2) Không có ONLYOFFICE: dùng FortuneSheet + @corbe30/fortune-excel (đọc .xlsx bằng exceljs).
// 3) Cả hai lỗi: bảng đơn giản (TableViewer).

import React, { useEffect, useRef, useState } from "react";
import { Workbook } from "@fortune-sheet/react";
import "@fortune-sheet/react/dist/index.css";
import { transformExcelToFortune } from "@corbe30/fortune-excel";
import { useFileData } from "./useFileData";
import { Loading } from "./ViewerShell";
import TableViewer from "./TableViewer";
import { officeEnabled, officeEditorUrl } from "../../ListObjects/fileOps";

interface IExcelViewerProps {
  bucket: string;
  objectKey: string;
  latest: boolean; // đang xem bản mới nhất (ONLYOFFICE chỉ mở được bản mới nhất)
  path: string;
  fileName?: string;
  onDownload: () => void;
}

const ExcelViewer = ({
  bucket,
  objectKey,
  latest,
  path,
  fileName,
  onDownload,
}: IExcelViewerProps) => {
  const [office, setOffice] = useState<boolean | null>(null);
  useEffect(() => {
    officeEnabled().then(setOffice);
  }, []);
  const useOffice = office === true && latest;
  const { blob, loading, error } = useFileData(useOffice ? "" : path, 0);
  const sheetRef = useRef<any>(null);
  const [sheets, setSheets] = useState<any[] | null>(null);
  const [key, setKey] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!blob || useOffice) {
      return;
    }
    let cancelled = false;
    setFailed(false);
    (async () => {
      try {
        const file = new File([blob], fileName || "sheet.xlsx", {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        await transformExcelToFortune(
          file,
          (s: any[]) => {
            if (!cancelled) {
              setSheets(s);
            }
          },
          (k: any) => {
            if (!cancelled) {
              setKey(typeof k === "function" ? (p: number) => k(p) : k);
            }
          },
          sheetRef,
        );
      } catch (e) {
        if (!cancelled) {
          setFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blob, fileName, useOffice]);

  if (office === null) {
    return <Loading text="Đang mở bảng tính..." />;
  }
  if (useOffice) {
    return (
      <iframe
        title={fileName || objectKey}
        src={`${officeEditorUrl(bucket, objectKey)}&mode=view`}
        style={{ flex: 1, width: "100%", border: 0, minHeight: 0 }}
        allow="clipboard-read; clipboard-write; fullscreen"
      />
    );
  }
  if (error || failed) {
    // không đọc được bằng thư viện bảng tính: dùng bảng đơn giản
    return <TableViewer path={path} kind="excel" onDownload={onDownload} />;
  }
  if (loading || !sheets) {
    return <Loading text="Đang đọc bảng tính..." />;
  }

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: "relative" }}>
      <div style={{ position: "absolute", inset: 0 }}>
      <Workbook
        key={key}
        ref={sheetRef}
        data={sheets}
        allowEdit={false}
        showToolbar={false}
        showFormulaBar={true}
        showSheetTabs={true}
      />
      </div>
    </div>
  );
};

export default ExcelViewer;
