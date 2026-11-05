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
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"time"
)

// ViewIO: CHUYỂN TIẾP CÙNG ORIGIN tới ONLYOFFICE Document Server và draw.io (chạy hoàn toàn trên máy chạy ViewIO).
//
//	/docview/office-ds/*  -> Document Server  (VIEWIO_OFFICE_INTERNAL_URL, vd http://viewio-office)
//	/docview/drawio-ds/*  -> draw.io          (VIEWIO_DRAWIO_INTERNAL_URL, mặc định http://viewio-drawio:8080)
//
// Bật bằng VIEWIO_EDITOR_PROXY=on. Khi bật, trình duyệt chỉ nói chuyện với CHÍNH địa chỉ đang dùng để vào Console
// (vd https://minioai-console.protontech.vn hoặc http://192.168.3.7:21031), KHÔNG gọi tên miền ngoài nào
// (không cần VIEWIO_OFFICE_URL / VIEWIO_DRAWIO_URL, không cần Cloudflare Tunnel, không cần tên miền/cổng riêng cho editor).
// Mọi dữ liệu tài liệu chỉ đi giữa trình duyệt <-> ViewIO <-> container office/drawio trong mạng docker của máy này.
//
// DI CHUYỂN SANG MÁY KHÁC: chỉ cần compose có hai service viewio-office, viewio-drawio cùng mạng docker với minio và
// biến môi trường của minio trỏ đúng tên service (xem docker-compose.yml, docs/INSTALL.md mục "Editor cùng origin").
// Không phụ thuộc IP/tên miền cụ thể nào: địa chỉ được suy ra từ chính trình duyệt (location.origin).
//
// Lưu ý bảo mật: editor chạy cùng origin với Console nên không còn cách ly origin như khi dùng tên miền riêng.
// Chỉ dùng cho mạng nội bộ tin cậy. Document Server vẫn chỉ nhận yêu cầu có JWT do ViewIO ký.
const (
	docviewOfficeDSPrefix = "/docview/office-ds"
	docviewDrawioDSPrefix = "/docview/drawio-ds"
)

func editorProxyOn() bool {
	return strings.EqualFold(os.Getenv("VIEWIO_EDITOR_PROXY"), "on")
}

func drawioInternalURL() string {
	if v := strings.TrimRight(os.Getenv("VIEWIO_DRAWIO_INTERNAL_URL"), "/"); v != "" {
		return v
	}
	return "http://viewio-drawio:8080"
}

func newDSProxy(target, prefix string) *httputil.ReverseProxy {
	u, err := url.Parse(target)
	if err != nil || u.Host == "" {
		return nil
	}
	rp := httputil.NewSingleHostReverseProxy(u)
	orig := rp.Director
	rp.Director = func(r *http.Request) {
		host := r.Header.Get("X-Forwarded-Host")
		if host == "" {
			host = r.Host
		}
		proto := "http"
		if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
			proto = "https"
		}
		r.URL.Path = strings.TrimPrefix(r.URL.Path, prefix)
		if r.URL.Path == "" {
			r.URL.Path = "/"
		}
		r.URL.RawPath = ""
		orig(r)
		// Document Server dựng lại mọi URL tuyệt đối theo 3 header này (nginx của nó: the_host/the_scheme/the_prefix)
		r.Header.Set("X-Forwarded-Host", host)
		r.Header.Set("X-Forwarded-Proto", proto)
		r.Header.Set("X-Forwarded-Prefix", prefix)
		r.Host = u.Host
		// không chuyển phiên đăng nhập Console sang dịch vụ phía sau
		r.Header.Del("Cookie")
		r.Header.Del("Authorization")
	}
	rp.FlushInterval = -1 // giữ WebSocket/stream
	rp.Transport = &http.Transport{
		Proxy:                 nil,
		MaxIdleConnsPerHost:   16,
		IdleConnTimeout:       60 * time.Second,
		ResponseHeaderTimeout: 120 * time.Second,
	}
	return rp
}

var (
	officeDSProxy *httputil.ReverseProxy
	drawioDSProxy *httputil.ReverseProxy
)

func serveDocviewDS(w http.ResponseWriter, r *http.Request, office bool) {
	if !editorProxyOn() {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	var rp *httputil.ReverseProxy
	if office {
		if officeDSProxy == nil {
			officeDSProxy = newDSProxy(os.Getenv("VIEWIO_OFFICE_INTERNAL_URL"), docviewOfficeDSPrefix)
		}
		rp = officeDSProxy
	} else {
		if drawioDSProxy == nil {
			drawioDSProxy = newDSProxy(drawioInternalURL(), docviewDrawioDSPrefix)
		}
		rp = drawioDSProxy
	}
	if rp == nil {
		http.Error(w, "editor service not configured", http.StatusBadGateway)
		return
	}
	// CSP của Console (script-src 'self' ...) sẽ làm hỏng giao diện editor; editor tự quản CSP của nó
	w.Header().Del("Content-Security-Policy")
	w.Header().Del("X-Frame-Options")
	rp.ServeHTTP(w, r)
}
