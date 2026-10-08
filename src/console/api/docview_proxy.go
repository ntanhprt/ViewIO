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
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/minio/console/pkg/auth"
	"github.com/minio/pkg/v3/env"
)

// MinIO_TA: proxy cùng origin tới dịch vụ chuyển đổi tài liệu Office -> PDF (LibreOffice)
// để viewer của Console xem được docx/pptx/xlsx... mà không vướng CSP connect-src 'self'.
// Cấu hình: DOCVIEW_CONVERTER_URL (mặc định http://docview-converter:8080, "off" để tắt).

const (
	docviewConverterEnv     = "DOCVIEW_CONVERTER_URL"
	docviewDefaultConverter = "http://docview-converter:8080"
	docviewMaxBody          = 100 << 20
)

var docviewClient = &http.Client{Timeout: 150 * time.Second}

// serveDocview điều phối các đường /docview/* (ViewIO).
func serveDocview(w http.ResponseWriter, r *http.Request) {
	switch {
	case strings.HasPrefix(r.URL.Path, docviewRawPrefix):
		serveDocviewRaw(w, r)
	case r.URL.Path == "/docview/thumb":
		serveDocviewThumb(w, r)
	default:
		serveDocviewConvert(w, r)
	}
}

func serveDocviewConvert(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost || r.URL.Path != "/docview/convert" {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	// chỉ cho người đã đăng nhập Console
	token, err := auth.GetTokenFromRequest(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if session, derr := auth.DecryptToken(token); derr != nil || len(session) == 0 {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	base := strings.TrimRight(env.Get(docviewConverterEnv, docviewDefaultConverter), "/")
	if base == "" || base == "off" {
		http.Error(w, "document converter is disabled", http.StatusServiceUnavailable)
		return
	}
	if r.ContentLength <= 0 {
		http.Error(w, "missing Content-Length", http.StatusLengthRequired)
		return
	}
	if r.ContentLength > docviewMaxBody {
		http.Error(w, "file too large", http.StatusRequestEntityTooLarge)
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, base+"/convert",
		http.MaxBytesReader(w, r.Body, docviewMaxBody))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	req.ContentLength = r.ContentLength
	req.Header.Set("X-File-Name", r.Header.Get("X-File-Name"))

	resp, err := docviewClient.Do(req)
	if err != nil {
		http.Error(w, "document converter unavailable", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
	if cl := resp.Header.Get("Content-Length"); cl != "" {
		w.Header().Set("Content-Length", cl)
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}
