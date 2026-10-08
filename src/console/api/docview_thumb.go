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
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/minio/console/pkg/auth"
	"github.com/minio/minio-go/v7"
	"github.com/minio/pkg/v3/env"
)

// ViewIO: thumbnail cho chế độ xem lưới của Object Browser.
//
//	GET /docview/thumb?bucket=<b>&prefix=<object>&version_id=<v>
//	  200 image/webp   thumbnail lấy từ nội dung file
//	  204              không tạo được (định dạng chưa hỗ trợ / file quá lớn) -> giao diện dùng icon
//
// Quyền truy cập: dùng chính thông tin đăng nhập của người dùng để StatObject/GetObject,
// nên chỉ người có quyền đọc file mới thấy thumbnail. Ảnh được cache ở dịch vụ converter theo
// khóa = sha256(bucket, object, version, etag, size), nên file đổi nội dung thì tự tạo lại.

const (
	thumbKeyVersion = "v2" // đổi khi đổi kích thước/định dạng thumbnail để bỏ cache cũ
	thumbCacheTTL   = 24 * time.Hour
	thumbTextBytes  = 4096
	thumbVideoBytes = 24 << 20
)

var (
	thumbImageExt  = setOf("png", "jpg", "jpeg", "gif", "bmp", "webp", "tif", "tiff", "ico", "jfif", "jpe")
	thumbPDFExt    = setOf("pdf")
	thumbOfficeExt = setOf("doc", "dot", "docx", "docm", "rtf", "odt", "xls", "xlsx", "xlsm", "ods",
		"ppt", "pptx", "pps", "ppsx", "odp")
	thumbVideoExt = setOf("mp4", "mov", "avi", "mkv", "webm", "mpeg", "mpg", "m4v", "wmv", "flv")
	thumbTextExt  = setOf("txt", "log", "md", "markdown", "csv", "tsv", "json", "jsonl", "yaml", "yml",
		"xml", "html", "htm", "css", "js", "jsx", "ts", "tsx", "py", "java", "go", "rs", "c", "h", "cpp",
		"hpp", "cs", "php", "rb", "sh", "bash", "sql", "ini", "conf", "cfg", "toml", "env", "properties",
		"gradle", "kt", "swift", "lua", "vue", "scss", "r")
)

func setOf(items ...string) map[string]bool {
	m := make(map[string]bool, len(items))
	for _, i := range items {
		m[i] = true
	}
	return m
}

// thumbPlan trả về (kiểu, số byte tối đa cần đọc, đọc theo range?) hoặc kind=="" nếu không hỗ trợ.
func thumbPlan(name string, size int64) (kind string, limit int64, ranged bool) {
	ext := strings.ToLower(strings.TrimPrefix(path.Ext(name), "."))
	switch {
	case thumbImageExt[ext]:
		return "image", 25 << 20, false
	case thumbPDFExt[ext]:
		return "pdf", 40 << 20, false
	case thumbOfficeExt[ext]:
		return "office", 25 << 20, false
	case thumbVideoExt[ext]:
		return "video", thumbVideoBytes, size > thumbVideoBytes
	case thumbTextExt[ext]:
		return "text", thumbTextBytes, size > thumbTextBytes
	}
	return "", 0, false
}

func thumbNoContent(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.WriteHeader(http.StatusNoContent)
}

func serveDocviewThumb(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	principal, err := auth.GetClaimsFromTokenInRequest(r)
	if err != nil || principal == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	q := r.URL.Query()
	bucket, object, versionID := q.Get("bucket"), q.Get("prefix"), q.Get("version_id")
	if bucket == "" || object == "" || strings.HasSuffix(object, "/") {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	base := strings.TrimRight(env.Get(docviewConverterEnv, docviewDefaultConverter), "/")
	if base == "" || base == "off" {
		thumbNoContent(w)
		return
	}

	// Quyết định theo đuôi file TRƯỚC khi gọi MinIO để định dạng không hỗ trợ trả về ngay.
	if kind, _, _ := thumbPlan(object, 0); kind == "" {
		thumbNoContent(w)
		return
	}

	ctx := r.Context()
	client, err := newMinioClient(principal, getClientIP(r))
	if err != nil {
		http.Error(w, "storage client error", http.StatusInternalServerError)
		return
	}
	st, err := client.StatObject(ctx, bucket, object, minio.StatObjectOptions{VersionID: versionID})
	if err != nil {
		resp := minio.ToErrorResponse(err)
		code := resp.StatusCode
		if code < 400 || code > 599 {
			code = http.StatusBadGateway
		}
		http.Error(w, http.StatusText(code), code)
		return
	}

	kind, limit, ranged := thumbPlan(object, st.Size)
	if kind == "" || (!ranged && st.Size > limit) || st.Size == 0 {
		thumbNoContent(w) // quá lớn (video/text đã đọc theo range nên không rơi vào đây)
		return
	}

	sum := sha256.Sum256([]byte(strings.Join([]string{
		thumbKeyVersion, bucket, object, versionID, st.ETag, strconv.FormatInt(st.Size, 10),
	}, "\x00")))
	key := hex.EncodeToString(sum[:])
	etag := `"` + key[:32] + `"`
	if r.Header.Get("If-None-Match") == etag {
		w.Header().Set("ETag", etag)
		w.Header().Set("Cache-Control", "private, max-age=86400")
		w.WriteHeader(http.StatusNotModified)
		return
	}

	// 1) Có sẵn trong cache của converter?
	if resp, gerr := docviewClient.Get(base + "/thumb?key=" + key); gerr == nil {
		defer resp.Body.Close()
		switch resp.StatusCode {
		case http.StatusOK:
			writeThumb(w, resp.Body, etag)
			return
		case http.StatusNoContent:
			thumbNoContent(w)
			return
		}
	} else {
		thumbNoContent(w) // converter không chạy: giao diện dùng icon
		return
	}

	// 2) Chưa có: đọc nội dung (hoặc phần đầu) rồi nhờ converter tạo
	opts := minio.GetObjectOptions{VersionID: versionID}
	if ranged {
		if err := opts.SetRange(0, limit-1); err != nil {
			http.Error(w, "range error", http.StatusInternalServerError)
			return
		}
	}
	obj, err := client.GetObject(ctx, bucket, object, opts)
	if err != nil {
		http.Error(w, "cannot read object", http.StatusBadGateway)
		return
	}
	defer obj.Close()
	data, err := io.ReadAll(io.LimitReader(obj, limit+1))
	if err != nil || int64(len(data)) == 0 {
		http.Error(w, "cannot read object", http.StatusBadGateway)
		return
	}
	if int64(len(data)) > limit {
		data = data[:limit]
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/thumb", bytes.NewReader(data))
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	req.ContentLength = int64(len(data))
	req.Header.Set("X-File-Name", url.PathEscape(path.Base(object)))
	req.Header.Set("X-Cache-Key", key)
	resp, err := docviewClient.Do(req)
	if err != nil {
		thumbNoContent(w)
		return
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusOK:
		writeThumb(w, resp.Body, etag)
	case http.StatusUnprocessableEntity:
		thumbNoContent(w)
	default:
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 300))
		http.Error(w, fmt.Sprintf("thumbnail service: %s", strings.TrimSpace(string(msg))), http.StatusBadGateway)
	}
}

func writeThumb(w http.ResponseWriter, body io.Reader, etag string) {
	w.Header().Set("Content-Type", "image/webp")
	w.Header().Set("Cache-Control", "private, max-age="+strconv.Itoa(int(thumbCacheTTL.Seconds())))
	w.Header().Set("ETag", etag)
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, body)
}
