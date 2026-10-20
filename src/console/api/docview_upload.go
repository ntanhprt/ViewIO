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

package api

import (
	"encoding/json"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"

	"github.com/minio/console/pkg/auth"
	"github.com/minio/minio-go/v7"
)

// ViewIO: upload file lớn theo từng phần (chunk).
//
// Đứng sau Cloudflare (hoặc proxy khác) mỗi request bị giới hạn ~100 MB, nên trình duyệt tự cắt file lớn
// thành các phần ~32 MB và gửi lần lượt; server ghép lại bằng S3 multipart (đúng quyền của người dùng):
//
//	POST /docview/upload/init?bucket=&key=            -> {"uploadId": "..."}
//	PUT  /docview/upload/part?bucket=&key=&uploadId=&part=N   (body = dữ liệu phần N)  -> {"etag": "..."}
//	POST /docview/upload/complete?bucket=&key=&uploadId=  body [{"part":1,"etag":"..."}...]
//	POST /docview/upload/abort?bucket=&key=&uploadId=
//
// Phần tối thiểu 5 MiB (trừ phần cuối), tối đa 10000 phần; mỗi phần giới hạn docviewMaxPart.

const (
	docviewUploadPrefix = "/docview/upload/"
	docviewMaxPart      = 100 << 20 // 100 MiB / request (đúng mức Cloudflare cho phép)
)

type uploadPartDone struct {
	Part int    `json:"part"`
	ETag string `json:"etag"`
}

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func uploadErr(w http.ResponseWriter, err error) {
	resp := minio.ToErrorResponse(err)
	code := resp.StatusCode
	if code < 400 || code > 599 {
		code = http.StatusBadGateway
	}
	msg := resp.Message
	if msg == "" {
		msg = err.Error()
	}
	writeJSON(w, code, map[string]string{"detailedMessage": msg})
}

func serveDocviewUpload(w http.ResponseWriter, r *http.Request) {
	principal, err := auth.GetClaimsFromTokenInRequest(r)
	if err != nil || principal == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"detailedMessage": "unauthorized"})
		return
	}
	q := r.URL.Query()
	bucket, key, uploadID := q.Get("bucket"), q.Get("key"), q.Get("uploadId")
	key = strings.TrimLeft(key, "/") // giống upload thường: bỏ '/' đầu
	if bucket == "" || key == "" || strings.HasSuffix(key, "/") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detailedMessage": "missing bucket/key"})
		return
	}
	client, err := newMinioClient(principal, getClientIP(r))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detailedMessage": "storage client error"})
		return
	}
	core := minio.Core{Client: client}
	ctx := r.Context()
	action := strings.TrimPrefix(r.URL.Path, docviewUploadPrefix)

	switch {
	case action == "init" && r.Method == http.MethodPost:
		ct := q.Get("contentType")
		if ct == "" {
			ct = mime.TypeByExtension(path.Ext(key))
		}
		id, err := core.NewMultipartUpload(ctx, bucket, key, minio.PutObjectOptions{ContentType: ct})
		if err != nil {
			uploadErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"uploadId": id})

	case action == "part" && r.Method == http.MethodPut:
		n, perr := strconv.Atoi(q.Get("part"))
		if uploadID == "" || perr != nil || n < 1 || n > 10000 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detailedMessage": "bad part"})
			return
		}
		if r.ContentLength <= 0 {
			writeJSON(w, http.StatusLengthRequired, map[string]string{"detailedMessage": "missing Content-Length"})
			return
		}
		if r.ContentLength > docviewMaxPart {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"detailedMessage": "part too large"})
			return
		}
		part, err := core.PutObjectPart(ctx, bucket, key, uploadID, n, r.Body, r.ContentLength, minio.PutObjectPartOptions{})
		if err != nil {
			uploadErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"etag": part.ETag})

	case action == "complete" && r.Method == http.MethodPost:
		var parts []uploadPartDone
		if uploadID == "" || json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20)).Decode(&parts) != nil || len(parts) == 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detailedMessage": "bad parts list"})
			return
		}
		cp := make([]minio.CompletePart, 0, len(parts))
		for _, p := range parts {
			cp = append(cp, minio.CompletePart{PartNumber: p.Part, ETag: p.ETag})
		}
		if _, err := core.CompleteMultipartUpload(ctx, bucket, key, uploadID, cp, minio.PutObjectOptions{}); err != nil {
			uploadErr(w, err)
			return
		}
		logActivity(r, bucket, "upload", key, "")
		w.WriteHeader(http.StatusNoContent)

	case action == "abort" && r.Method == http.MethodPost:
		if uploadID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detailedMessage": "missing uploadId"})
			return
		}
		if err := core.AbortMultipartUpload(ctx, bucket, key, uploadID); err != nil {
			uploadErr(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "not found", http.StatusNotFound)
	}
}
