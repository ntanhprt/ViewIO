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
	"mime"
	"net/http"
	"net/url"
	"path"
	"strings"

	"github.com/minio/console/models"
	"github.com/minio/console/pkg/auth"
	"github.com/minio/minio-go/v7"
)

// ViewIO: xem trang HTML như web thật.
//
//	GET /docview/raw/<bucket>/<đường/dẫn/tới/file>
//
// Phục vụ nội dung object theo một URL "thật", nên khi trang HTML nằm ở
// /docview/raw/<bucket>/web/index.html thì <img src="anh/a.png"> tự trỏ tới
// /docview/raw/<bucket>/web/anh/a.png (base URL = thư mục đang duyệt). Có Range (video/audio).
//
// An toàn: nội dung do người khác tải lên nên MỌI phản hồi mang
//
//	Content-Security-Policy: sandbox allow-same-origin; ...; script-src 'none'
//
// => không chạy được script, không gửi form, không mở popup; cookie chỉ để tải tài nguyên
// của chính bucket theo quyền của người đang xem.

const docviewRawPrefix = "/docview/raw/"

// CSP cho nội dung người dùng: tài nguyên (ảnh, css, font, media) tải từ bất kỳ đâu như web thật,
// nhưng tuyệt đối không có script và sandbox không có allow-scripts.
const docviewRawCSP = "sandbox allow-same-origin; default-src * data: blob: 'unsafe-inline'; script-src 'none'; object-src 'none'; frame-ancestors 'self'"

func docviewRawContentType(name string, fallback string) string {
	switch strings.ToLower(path.Ext(name)) {
	case ".html", ".htm", ".xhtml":
		return "text/html; charset=utf-8"
	case ".js", ".mjs":
		return "text/javascript; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".svg":
		return "image/svg+xml"
	case ".json":
		return "application/json; charset=utf-8"
	case ".txt", ".log", ".md":
		return "text/plain; charset=utf-8"
	}
	if t := mime.TypeByExtension(path.Ext(name)); t != "" {
		return t
	}
	if fallback != "" {
		return fallback
	}
	return "application/octet-stream"
}

// docviewServeObject đọc và phục vụ một object bằng quyền của người dùng.
// quietMiss=true: nếu không có object thì KHÔNG ghi gì và trả false (để chuyển sang xử lý khác).
func docviewServeObject(w http.ResponseWriter, r *http.Request, principal *models.Principal, bucket, key string, quietMiss bool) bool {
	client, err := newMinioClient(principal, getClientIP(r))
	if err != nil {
		http.Error(w, "storage client error", http.StatusInternalServerError)
		return true
	}
	ctx := r.Context()

	st, err := client.StatObject(ctx, bucket, key, minio.StatObjectOptions{})
	if err != nil && strings.HasSuffix(key, "/") {
		// thư mục -> thử index.html (như một web server)
		key += "index.html"
		st, err = client.StatObject(ctx, bucket, key, minio.StatObjectOptions{})
	}
	if err != nil {
		resp := minio.ToErrorResponse(err)
		if quietMiss && (resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusForbidden || resp.Code == "NoSuchKey") {
			return false
		}
		code := resp.StatusCode
		if code < 400 || code > 599 {
			code = http.StatusBadGateway
		}
		http.Error(w, http.StatusText(code), code)
		return true
	}

	obj, err := client.GetObject(ctx, bucket, key, minio.GetObjectOptions{})
	if err != nil {
		http.Error(w, "cannot read object", http.StatusBadGateway)
		return true
	}
	defer obj.Close()

	h := w.Header()
	h.Set("Content-Type", docviewRawContentType(key, st.ContentType))
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", docviewRawCSP)
	h.Set("X-Frame-Options", "SAMEORIGIN")  // cho phép nhúng trong viewer (Console mặc định cấm)
	h.Set("Referrer-Policy", "same-origin") // để tài nguyên tương đối/gốc-tương-đối biết đang ở bucket nào
	h.Set("Cache-Control", "private, no-cache")
	http.ServeContent(w, r, path.Base(key), st.LastModified, obj)
	return true
}

func serveDocviewRaw(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	principal, err := auth.GetClaimsFromTokenInRequest(r)
	if err != nil || principal == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, docviewRawPrefix)
	bucket, key, ok := strings.Cut(rest, "/")
	if !ok || bucket == "" || key == "" {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	docviewServeObject(w, r, principal, bucket, key, false)
}

// serveDocviewRootRelative xử lý tài nguyên dạng gốc-tương-đối (vd <img src="/img/a.png">) của một trang HTML
// đang xem trong viewer: dựa vào Referer = /docview/raw/<bucket>/... để hiểu "/" là gốc của bucket đó.
// Trả true nếu đã phục vụ; false nếu không liên quan/không có object (để Console xử lý như bình thường).
func serveDocviewRootRelative(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	p := strings.TrimPrefix(r.URL.Path, "/")
	if p == "" || strings.HasPrefix(p, "docview/") || strings.HasPrefix(p, "api/") {
		return false
	}
	ref, err := url.Parse(r.Referer())
	if err != nil || ref.Host != r.Host || !strings.HasPrefix(ref.Path, docviewRawPrefix) {
		return false
	}
	bucket, _, ok := strings.Cut(strings.TrimPrefix(ref.Path, docviewRawPrefix), "/")
	if !ok || bucket == "" {
		return false
	}
	principal, err := auth.GetClaimsFromTokenInRequest(r)
	if err != nil || principal == nil {
		return false
	}
	return docviewServeObject(w, r, principal, bucket, p, true)
}
