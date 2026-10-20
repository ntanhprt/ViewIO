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

import React, { Fragment, useState } from "react";
import { ErrorResponseHandler } from "../../../../../../common/types";
import ConfirmDialog from "../../../../Common/ModalWrapper/ConfirmDialog";
import useApi from "../../../../Common/Hooks/useApi";
import { ConfirmDeleteIcon, Switch } from "mds";
import { setErrorSnackMessage } from "../../../../../../systemSlice";
import { AppState, useAppDispatch } from "../../../../../../store";
import { hasPermission } from "../../../../../../common/SecureComponent";
import { IAM_SCOPES } from "../../../../../../common/SecureComponent/permissions";
import { useSelector } from "react-redux";
import { isVersionedMode } from "../../../../../../utils/validationFunctions";
import { transfer } from "./fileOps";
import { BucketVersioningResponse } from "api/consoleApi";

interface IDeleteObjectProps {
  closeDeleteModalAndRefresh: (refresh: boolean) => void;
  deleteOpen: boolean;
  selectedObject: string;
  selectedBucket: string;

  versioningInfo: BucketVersioningResponse | undefined;
  selectedVersion?: string;
}

const DeleteObject = ({
  closeDeleteModalAndRefresh,
  deleteOpen,
  selectedBucket,
  selectedObject,
  versioningInfo,
  selectedVersion = "",
}: IDeleteObjectProps) => {
  const dispatch = useAppDispatch();
  const onDelSuccess = () => closeDeleteModalAndRefresh(true);
  const onDelError = (err: ErrorResponseHandler) => {
    dispatch(setErrorSnackMessage(err));

    // We close the modal box on access denied.
    if (err.detailedError === "Access Denied.") {
      closeDeleteModalAndRefresh(true);
    }
  };
  const onClose = () => closeDeleteModalAndRefresh(false);

  const [deleteLoading, invokeDeleteApi] = useApi(onDelSuccess, onDelError);
  const [deleteVersions, setDeleteVersions] = useState<boolean>(false);
  const [permanent, setPermanent] = useState<boolean>(false);
  const [trashing, setTrashing] = useState<boolean>(false);
  const [bypassGovernance, setBypassGovernance] = useState<boolean>(false);

  const retentionConfig = useSelector(
    (state: AppState) => state.objectBrowser.retentionConfig,
  );

  const canBypass =
    hasPermission(
      [selectedBucket],
      [IAM_SCOPES.S3_BYPASS_GOVERNANCE_RETENTION],
    ) && retentionConfig?.mode === "governance";

  if (!selectedObject) {
    return null;
  }
  const onConfirmDelete = () => {
    // mặc định chuyển vào Thùng rác (khôi phục được); xoá một phiên bản cụ thể / mọi phiên bản / "vĩnh viễn" thì xoá thẳng
    if (
      !permanent &&
      !deleteVersions &&
      selectedVersion === "" &&
      !selectedObject.startsWith(".trash/")
    ) {
      setTrashing(true);
      transfer({
        op: "trash",
        bucket: selectedBucket,
        items: [selectedObject],
        destBucket: selectedBucket,
        destPrefix: "",
      })
        .then((r) => {
          if (r.failed.length > 0) {
            dispatch(
              setErrorSnackMessage({
                errorMessage: `Không chuyển vào thùng rác được: ${r.failed[0]}`,
                detailedError: "",
              }),
            );
          }
          onDelSuccess();
        })
        .catch((e) =>
          dispatch(
            setErrorSnackMessage({
              errorMessage: e?.message || String(e),
              detailedError: "",
            }),
          ),
        )
        .finally(() => setTrashing(false));
      return;
    }
    const recursive = selectedObject.endsWith("/");
    invokeDeleteApi(
      "DELETE",
      `/api/v1/buckets/${encodeURIComponent(selectedBucket)}/objects?prefix=${encodeURIComponent(selectedObject)}${
        selectedVersion !== ""
          ? `&version_id=${encodeURIComponent(selectedVersion)}`
          : `&recursive=${recursive}&all_versions=${deleteVersions}`
      }${bypassGovernance ? "&bypass=true" : ""}`,
    );
  };

  return (
    <ConfirmDialog
      title={`Delete Object`}
      confirmText={"Delete"}
      isOpen={deleteOpen}
      titleIcon={<ConfirmDeleteIcon />}
      isLoading={deleteLoading || trashing}
      onConfirm={onConfirmDelete}
      onClose={onClose}
      confirmationContent={
        <Fragment>
          Are you sure you want to delete: <br />
          <b>{selectedObject}</b>{" "}
          {selectedVersion !== "" ? (
            <Fragment>
              <br />
              <br />
              Version ID:
              <br />
              <strong>{selectedVersion}</strong>
            </Fragment>
          ) : (
            ""
          )}
          ? <br />
          <br />
          {selectedVersion === "" && (
            <Fragment>
              <Switch
                label={"Xoá vĩnh viễn (không vào Thùng rác)"}
                indicatorLabels={["Có", "Không"]}
                checked={permanent}
                value={"permanent"}
                id="delete-permanent"
                name="delete-permanent"
                onChange={() => setPermanent(!permanent)}
                description=""
              />
              {!permanent && !deleteVersions ? (
                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                  Mục sẽ được chuyển vào Thùng rác (chuột phải ở chỗ trống → Thùng rác để khôi phục).
                </div>
              ) : null}
              <br />
            </Fragment>
          )}
          {isVersionedMode(versioningInfo?.status) &&
            selectedVersion === "" && (
              <Fragment>
                <Switch
                  label={"Delete All Versions"}
                  indicatorLabels={["Yes", "No"]}
                  checked={deleteVersions}
                  value={"delete_versions"}
                  id="delete-versions"
                  name="delete-versions"
                  onChange={(e) => {
                    setDeleteVersions(!deleteVersions);
                  }}
                  description=""
                />
              </Fragment>
            )}
          {canBypass && (deleteVersions || selectedVersion !== "") && (
            <Fragment>
              <div
                style={{
                  marginTop: 10,
                }}
              >
                <Switch
                  label={"Bypass Governance Mode"}
                  indicatorLabels={["Yes", "No"]}
                  checked={bypassGovernance}
                  value={"bypass_governance"}
                  id="bypass_governance"
                  name="bypass_governance"
                  onChange={(e) => {
                    setBypassGovernance(!bypassGovernance);
                  }}
                  description=""
                />
              </div>
            </Fragment>
          )}
          {deleteVersions && (
            <Fragment>
              <div
                style={{
                  marginTop: 10,
                  border: "#c83b51 1px solid",
                  borderRadius: 3,
                  padding: 5,
                  backgroundColor: "#c83b5120",
                  color: "#c83b51",
                }}
              >
                This will remove the object as well as all of its versions,{" "}
                <br />
                This action is irreversible.
              </div>
              <br />
              Are you sure you want to continue?
            </Fragment>
          )}
        </Fragment>
      }
    />
  );
};

export default DeleteObject;
