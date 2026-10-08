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

import React, { useState } from "react";
import PreviewFileContent from "./PreviewFileContent";
import { BucketObject } from "../../../../../../api/consoleApi";
import { useAppDispatch } from "../../../../../../store";
import { downloadObject } from "../../../../ObjectBrowser/utils";
import { ViewerShell } from "./DocViewer/ViewerShell";

interface IPreviewFileProps {
  open: boolean;
  bucketName: string;
  actualInfo: BucketObject;
  onClosePreview: () => void;
}

const PreviewFileModal = ({
  open,
  bucketName,
  actualInfo,
  onClosePreview,
}: IPreviewFileProps) => {
  const dispatch = useAppDispatch();
  const [meta, setMeta] = useState({ badge: "", subtitle: "" });

  if (!open) {
    return null;
  }

  const name = actualInfo?.name || "";

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
        bucketName={bucketName}
        actualInfo={actualInfo}
        onResolved={setMeta}
      />
    </ViewerShell>
  );
};

export default PreviewFileModal;
