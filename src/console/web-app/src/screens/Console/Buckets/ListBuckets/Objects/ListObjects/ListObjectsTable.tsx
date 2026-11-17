// This file is part of MinIO Console Server
// Copyright (c) 2022 MinIO, Inc.
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

import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { listModeColumns, rewindModeColumns } from "./ListObjectsHelpers";
import { useSelector } from "react-redux";
import { AppState, useAppDispatch } from "../../../../../../store";
import { selFeatures } from "../../../../consoleSlice";
import {
  setLoadingVersions,
  setObjectDetailsView,
  setPreviewOpen,
  setReloadObjectsList,
  setSelectedObjects,
  setSelectedObjectView,
  setSelectedPreview,
} from "../../../../ObjectBrowser/objectBrowserSlice";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import ObjectContextMenu from "./ObjectContextMenu";
import { addRecent, info as fsInfo } from "./fileOps";
import get from "lodash/get";
import { sortListObjects } from "../utils";
import { BucketObjectItem } from "./types";
import {
  IAM_SCOPES,
  permissionTooltipHelper,
} from "../../../../../../common/SecureComponent/permissions";
import { hasPermission } from "../../../../../../common/SecureComponent";
import { downloadObject } from "../../../../ObjectBrowser/utils";
import { DataTable, ItemActions } from "mds";
import ThumbnailGrid from "./ThumbnailGrid";
import CompactList from "./CompactList";
import ColumnResizeHandles from "./ColumnResizeHandles";
import { niceBytes } from "../../../../../../common/utils";
import {
  setViewState,
  SortField,
  useViewState,
} from "../../../../ObjectBrowser/viewMode";
import { BucketObject } from "api/consoleApi";

const ListObjectsTable = () => {
  const dispatch = useAppDispatch();
  const params = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // Chế độ xem + sắp xếp dùng chung với thanh công cụ (ViewIO)
  const view = useViewState();
  const sortDirection = view.sortDir;
  const currentSortField = view.sortBy;

  // Khi ẩn các thanh phía trên (view.focus > 0) đo chiều cao còn lại thật thay vì dùng công thức cố định
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const [focusHeight, setFocusHeight] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (view.focus === 0) {
      setFocusHeight(null);
      return;
    }
    const measure = () => {
      const el = tableWrapRef.current;
      if (el) {
        const top = el.getBoundingClientRect().top;
        setFocusHeight(`${Math.max(260, window.innerHeight - top - 14)}px`);
      }
    };
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
  }, [view.focus, view.mode]);

  // Độ rộng cột do người dùng kéo (nhớ trong localStorage); cột chưa kéo thì giữ mặc định của bảng
  const [colW, setColW] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(window.localStorage.getItem("docview.colw") || "{}");
    } catch {
      return {};
    }
  });
  const setColWidth = (key: string, w: number) => {
    setColW((prev) => {
      const next = { ...prev, [key]: w };
      try {
        window.localStorage.setItem("docview.colw", JSON.stringify(next));
      } catch {
        /* bỏ qua */
      }
      return next;
    });
  };

  const bucketName = params.bucketName || "";

  const detailsOpen = useSelector(
    (state: AppState) => state.objectBrowser.objectDetailsOpen,
  );

  const requestInProgress = useSelector(
    (state: AppState) => state.objectBrowser.requestInProgress,
  );

  const features = useSelector(selFeatures);
  const obOnly = !!features?.includes("object-browser-only");

  const rewindEnabled = useSelector(
    (state: AppState) => state.objectBrowser.rewind.rewindEnabled,
  );
  const records = useSelector((state: AppState) => state.objectBrowser.records);
  const searchObjects = useSelector(
    (state: AppState) => state.objectBrowser.searchObjects,
  );
  const selectedObjects = useSelector(
    (state: AppState) => state.objectBrowser.selectedObjects,
  );
  const connectionError = useSelector(
    (state: AppState) => state.objectBrowser.connectionError,
  );
  const anonymousMode = useSelector(
    (state: AppState) => state.system.anonymousMode,
  );
  const selectedInternalPaths = useSelector(
    (state: AppState) => state.objectBrowser.selectedInternalPaths,
  );

  const displayListObjects = hasPermission(bucketName, [
    IAM_SCOPES.S3_LIST_BUCKET,
    IAM_SCOPES.S3_ALL_LIST_BUCKET,
  ]);

  const plSelect = records.filter((b: BucketObjectItem) => {
    // thư mục thùng rác của ViewIO: chỉ mở qua menu chuột phải → "Thùng rác"
    if (b.name === ".trash/") {
      return false;
    }
    if (searchObjects === "") {
      return true;
    } else {
      const objectName = b.name.toLowerCase();
      return objectName.indexOf(searchObjects.toLowerCase()) >= 0;
    }
  });
  const sortASC = plSelect.sort(sortListObjects(currentSortField));

  let payload: BucketObjectItem[] = [];

  if (sortDirection === "ASC") {
    payload = sortASC;
  } else {
    payload = sortASC.reverse();
  }

  const openPath = (object: BucketObject) => {
    const idElement = object.name || "";
    const newPath = `/browser/${encodeURIComponent(bucketName)}${
      idElement ? `/${encodeURIComponent(idElement)}` : ``
    }`;

    // for anonymous start download
    if (anonymousMode && !object.name?.endsWith("/")) {
      downloadObject(dispatch, bucketName, idElement, object);
      return;
    }
    dispatch(setSelectedObjects([]));

    navigate(newPath);

    if (!anonymousMode) {
      dispatch(setObjectDetailsView(true));
      dispatch(setLoadingVersions(true));
    }
    dispatch(setSelectedObjectView(idElement));
  };
  // MinIO_TA: double-click vào dòng file -> mở thẳng viewer (click đơn vẫn mở panel chi tiết).
  // Phải chốt dòng ở lần click ĐẦU: với thư mục, click đầu đã chuyển danh sách sang thư mục con,
  // nên click thứ hai có thể rơi vào một file khác.
  const firstClickObj = useRef<BucketObjectItem | undefined>(undefined);

  const rowObject = (target: HTMLElement): BucketObjectItem | undefined => {
    if (target.closest("input, button, [role='columnheader']")) {
      return undefined;
    }
    const rowText = (
      target.closest("[role='row']") as HTMLElement | null
    )?.innerText
      .split("\n")[0]
      .trim();
    if (!rowText) {
      return undefined;
    }
    return payload.find(
      (o) => (o.name.split("/").filter(Boolean).pop() || o.name) === rowText,
    );
  };

  // Chọn đúng 1 mục (Ctrl = thêm/bớt) — dùng cho click đơn vào thư mục (giống Explorer của Windows)
  const selectOnly = (item: BucketObjectItem, additive: boolean) => {
    dispatch(setSelectedObjectView(null));
    if (additive) {
      dispatch(
        setSelectedObjects(
          selectedObjects.includes(item.name)
            ? selectedObjects.filter((n) => n !== item.name)
            : [...selectedObjects, item.name],
        ),
      );
    } else {
      dispatch(setSelectedObjects([item.name]));
    }
  };

  const rememberFirstClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.detail <= 1) {
      firstClickObj.current = rowObject(e.target as HTMLElement);
    }
    // Mọi dòng (file/thư mục): chặn click mặc định của bảng (điều hướng + mở panel làm danh sách nháy, mất chọn);
    // click đơn = chọn, double-click = mở/xem. Chi tiết file xem ở menu chuột phải → Thuộc tính
    const obj = rowObject(e.target as HTMLElement);
    if (
      !anonymousMode &&
      !rewindEnabled &&
      obj &&
      !(e.target as HTMLElement).closest("input, button, [role='columnheader']")
    ) {
      e.stopPropagation();
      if (e.detail <= 1) {
        selectOnly(obj, e.ctrlKey || e.metaKey);
      }
    }
  };

  const previewOnDoubleClick = () => {
    const obj = firstClickObj.current;
    firstClickObj.current = undefined;
    if (obj && obj.name.endsWith("/") && !anonymousMode && !rewindEnabled) {
      openPath(obj as unknown as BucketObject);
      return;
    }
    if (anonymousMode || !obj || obj.name.endsWith("/") || obj.delete_flag) {
      return;
    }
    addRecent(bucketName, obj.name);
    dispatch(setSelectedPreview(obj));
    dispatch(setPreviewOpen(true));
  };

  const tableActions: ItemActions[] = [
    {
      type: "view",
      tooltip: "View",
      onClick: openPath,
      sendOnlyId: false,
    },
  ];

  const sortChange = (sortData: any) => {
    const newSortDirection = get(sortData, "sortDirection", "DESC");
    setViewState({
      sortBy: sortData.sortBy as SortField,
      sortDir: newSortDirection === "ASC" ? "ASC" : "DESC",
    });
    dispatch(setReloadObjectsList(true));
  };

  const selectAllItems = () => {
    dispatch(setSelectedObjectView(null));

    if (selectedObjects.length === payload.length) {
      dispatch(setSelectedObjects([]));
      return;
    }

    const elements = payload.map((item) => item.name);
    dispatch(setSelectedObjects(elements));
  };

  const selectListObjects = (e: React.ChangeEvent<HTMLInputElement>) => {
    const targetD = e.target;
    const value = targetD.value;
    const checked = targetD.checked;

    let elements: string[] = [...selectedObjects]; // We clone the selectedBuckets array

    if (checked) {
      // If the user has checked this field we need to push this to selectedBucketsList
      elements.push(value);
    } else {
      // User has unchecked this field, we need to remove it from the list
      elements = elements.filter((element) => element !== value);
    }
    dispatch(setSelectedObjects(elements));
    dispatch(setSelectedObjectView(null));

    return elements;
  };

  // Chế độ thumbnail: chọn / mở / xem nhanh cho từng thẻ
  const toggleItem = (name: string, checked: boolean) => {
    const elements = checked
      ? [...selectedObjects, name]
      : selectedObjects.filter((element) => element !== name);
    dispatch(setSelectedObjects(elements));
    dispatch(setSelectedObjectView(null));
  };

  const previewItem = (item: BucketObjectItem) => {
    if (anonymousMode) {
      return;
    }
    addRecent(bucketName, item.name);
    dispatch(setSelectedPreview(item));
    dispatch(setPreviewOpen(true));
  };

  const navigateTo = (bucket: string, prefix: string) => {
    dispatch(setSelectedObjects([]));
    navigate(
      `/browser/${encodeURIComponent(bucket)}${
        prefix ? `/${encodeURIComponent(prefix)}` : ""
      }`,
    );
  };

  // Mở file theo key (từ tìm kiếm / yêu thích / gần đây): lấy thông tin rồi mở viewer; khác bucket thì chỉ mở thư mục chứa
  const previewKey = async (bucket: string, key: string) => {
    if (bucket !== bucketName) {
      navigateTo(bucket, key.slice(0, key.lastIndexOf("/") + 1));
      return;
    }
    try {
      const st = await fsInfo(bucket, key);
      addRecent(bucket, key);
      dispatch(
        setSelectedPreview({
          name: key,
          size: st.size,
          last_modified: st.modified || "",
          version_id: "",
          content_type: st.contentType,
        } as BucketObjectItem),
      );
      dispatch(setPreviewOpen(true));
    } catch {
      navigateTo(bucket, key.slice(0, key.lastIndexOf("/") + 1));
    }
  };

  let errorMessage =
    !displayListObjects && !anonymousMode
      ? permissionTooltipHelper(
          [IAM_SCOPES.S3_LIST_BUCKET, IAM_SCOPES.S3_ALL_LIST_BUCKET],
          "view Objects in this bucket",
        )
      : `This location is empty${
          !rewindEnabled ? ", please try uploading a new file" : ""
        }`;

  if (connectionError) {
    errorMessage =
      "Objects List unavailable. Please review your WebSockets configuration and try again";
  }

  let customPaperHeight = "calc(100vh - 290px)";

  if (obOnly) {
    customPaperHeight = "calc(100vh - 315px)";
  }
  if (focusHeight) {
    customPaperHeight = focusHeight;
  }

  // Menu chuột phải / Ctrl+C,X,V / F2 (ViewIO): xác định mục dưới con trỏ ở cả chế độ bảng lẫn thumbnail
  const bucketPath = `/browser/${bucketName}/`;
  const pathSegment = location.pathname.split(bucketPath);
  const currentPrefix =
    pathSegment.length === 2 ? decodeURIComponent(pathSegment[1]) : "";
  const itemFromTarget = (target: HTMLElement): string | undefined => {
    const card = target.closest("[data-vt-name]") as HTMLElement | null;
    if (card) {
      return card.dataset.vtName;
    }
    return rowObject(target)?.name;
  };
  const withMenu = (inner: React.ReactNode) =>
    anonymousMode || rewindEnabled ? (
      <>{inner}</>
    ) : (
      <ObjectContextMenu
        bucketName={bucketName}
        currentPrefix={currentPrefix}
        selected={selectedObjects}
        itemFromTarget={itemFromTarget}
        onSelect={(names) => {
          dispatch(setSelectedObjects(names));
          dispatch(setSelectedObjectView(null));
        }}
        onOpen={(name) => {
          const obj = payload.find((o) => o.name === name);
          if (!obj) {
            return;
          }
          if (name.endsWith("/")) {
            openPath(obj as unknown as BucketObject);
          } else {
            previewItem(obj);
          }
        }}
        onNavigate={navigateTo}
        onPreviewKey={previewKey}
        onDownload={(name) => {
          const obj = payload.find((o) => o.name === name);
          if (obj) {
            downloadObject(
              dispatch,
              bucketName,
              name,
              obj as unknown as BucketObject,
            );
          }
        }}
      >
        {inner}
      </ObjectContextMenu>
    );

  const tableColumns = useMemo(
    () =>
      (rewindEnabled ? rewindModeColumns : listModeColumns).map((c: any) => ({
        ...c,
        width: colW[c.elementKey] ?? c.width,
      })),
    [rewindEnabled, colW],
  );

  // Tự khớp cột theo nội dung dài nhất (đo bằng canvas)
  const autoFit = (key: string): number => {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) {
      return 200;
    }
    ctx.font = "14px system-ui, sans-serif";
    let max = 0;
    payload.forEach((o) => {
      let txt = "";
      if (key === "name") {
        txt = o.name.split("/").filter(Boolean).pop() || o.name;
      } else if (key === "size") {
        txt = o.size ? niceBytes(String(o.size)) : "";
      } else {
        txt = "00/00/0000 00:00:00";
      }
      max = Math.max(max, ctx.measureText(txt).width);
    });
    return max + (key === "name" ? 70 : 36);
  };

  if (view.mode === "thumb" && !rewindEnabled) {
    return withMenu(
      <ThumbnailGrid
        bucketName={bucketName}
        items={payload}
        selected={selectedObjects}
        activeName={selectedInternalPaths}
        size={view.size}
        remeasureKey={view.focus}
        loading={requestInProgress}
        emptyMessage={errorMessage}
        onToggle={toggleItem}
        onOpen={(item) => openPath(item as unknown as BucketObject)}
        onPreview={previewItem}
        onSelectOnly={selectOnly}
      />,
    );
  }

  if (view.mode === "compact" && !rewindEnabled) {
    return withMenu(
      <CompactList
        items={payload}
        selected={selectedObjects}
        activeName={selectedInternalPaths}
        remeasureKey={view.focus}
        loading={requestInProgress}
        emptyMessage={errorMessage}
        onSelectOnly={selectOnly}
        onActivate={(item) =>
          item.name.endsWith("/")
            ? openPath(item as unknown as BucketObject)
            : previewItem(item)
        }
      />,
    );
  }

  return withMenu(
    <div
      ref={tableWrapRef}
      style={{ position: "relative" }}
      onClickCapture={rememberFirstClick}
      onDoubleClick={previewOnDoubleClick}
    >
      <ColumnResizeHandles
        containerRef={tableWrapRef}
        cols={tableColumns.map((c: any) => ({
          key: c.elementKey,
          label: c.label,
        }))}
        onResize={setColWidth}
        onAutoFit={autoFit}
        deps={[colW, payload.length, rewindEnabled, detailsOpen]}
      />
      <DataTable
        itemActions={tableActions}
        columns={tableColumns}
        isLoading={requestInProgress}
        entityName="Objects"
        idField="name"
        records={payload}
        customPaperHeight={customPaperHeight}
        selectedItems={selectedObjects}
        onSelect={!anonymousMode ? selectListObjects : undefined}
        customEmptyMessage={errorMessage}
        sortEnabled={{
          currentSort: currentSortField,
          currentDirection: sortDirection,
          onSortClick: sortChange,
        }}
        onSelectAll={selectAllItems}
        rowStyle={({ index }) => {
          if (payload[index]?.delete_flag) {
            return "deleted";
          }

          return "";
        }}
        sx={{
          minHeight: detailsOpen ? "100%" : "initial",
        }}
        noBackground
      />
    </div>,
  );
};
export default ListObjectsTable;
