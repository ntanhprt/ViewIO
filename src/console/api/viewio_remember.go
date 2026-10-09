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
	"strings"
	"time"

	"github.com/minio/console/pkg/auth"
	xnet "github.com/minio/pkg/v3/net"
)

// ViewIO: "Ghi nhớ đăng nhập".
//
// Phiên Console dựa trên khoá STS của MinIO nên chỉ sống tối đa vài giờ/ngày. Để giữ đăng nhập 1 tháng,
// khi người dùng tick "Ghi nhớ" (header X-Viewio-Remember: 1 lúc đăng nhập) server đặt thêm cookie
// HttpOnly `viewio-remember` chứa cặp key đã mã hoá (khoá = deployment ID, nên bền qua restart).
// Khi cookie phiên hết hạn, AuthenticationMiddleware tự đăng nhập lại bằng cookie này.
// Mỗi request /api, /docview có cookie đều được gia hạn thêm 30 ngày => 30 ngày tính từ lần dùng cuối.
// Chỉ áp dụng cho đăng nhập bằng user/password (không áp dụng STS thủ công hay SSO).

const (
	rememberCookieName = "viewio-remember"
	rememberHeader     = "X-Viewio-Remember"
	rememberDuration   = 30 * 24 * time.Hour
)

func newRememberCookie(value string) http.Cookie {
	return http.Cookie{
		Path:     "/",
		Name:     rememberCookieName,
		Value:    value,
		MaxAge:   int(rememberDuration.Seconds()),
		Expires:  time.Now().Add(rememberDuration),
		HttpOnly: true,
		Secure:   len(GlobalPublicCerts) > 0,
		SameSite: http.SameSiteLaxMode,
	}
}

func expireRememberCookie() http.Cookie {
	return http.Cookie{
		Path:     "/",
		Name:     rememberCookieName,
		Value:    "",
		MaxAge:   -1,
		Expires:  time.Now().Add(-100 * time.Hour),
		HttpOnly: true,
		Secure:   len(GlobalPublicCerts) > 0,
		SameSite: http.SameSiteLaxMode,
	}
}

// rememberApplies: chỉ các request cần phiên mới được tự đăng nhập lại / gia hạn.
func rememberApplies(r *http.Request) bool {
	p := r.URL.Path
	if !strings.HasPrefix(p, "/api/") && !strings.HasPrefix(p, "/docview/") {
		return false
	}
	// đăng nhập / đăng xuất tự xử lý cookie của mình
	return !strings.HasPrefix(p, "/api/v1/login") && !strings.HasPrefix(p, "/api/v1/logout")
}

// rememberSession chạy khi request không có phiên hợp lệ: nếu có cookie ghi nhớ hợp lệ thì đăng nhập
// lại và trả về token phiên mới (đã đặt cookie phiên mới vào response).
func rememberSession(w http.ResponseWriter, r *http.Request) (string, bool) {
	c, err := r.Cookie(rememberCookieName)
	if err != nil || c.Value == "" {
		return "", false
	}
	accessKey, secretKey, err := auth.DecryptRememberCredentials(c.Value)
	if err != nil {
		expired := expireRememberCookie()
		http.SetCookie(w, &expired)
		return "", false
	}
	creds, err := getConsoleCredentials(accessKey, secretKey, GetConsoleHTTPClient(getClientIP(r)))
	if err != nil {
		return "", false
	}
	token, err := login(creds, &auth.SessionFeatures{})
	if err != nil {
		// Mật khẩu đã đổi / user bị xoá => bỏ cookie ghi nhớ, bắt đăng nhập lại. Lỗi mạng thì giữ lại để thử sau.
		if !isNetworkLoginError(err) {
			expired := expireRememberCookie()
			http.SetCookie(w, &expired)
		}
		return "", false
	}
	sessionCookie := NewSessionCookieForConsole(*token)
	http.SetCookie(w, &sessionCookie)
	return *token, true
}

// rememberRefresh gia hạn cookie ghi nhớ thêm 30 ngày (giữ nguyên giá trị).
func rememberRefresh(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(rememberCookieName); err == nil && c.Value != "" {
		fresh := newRememberCookie(c.Value)
		http.SetCookie(w, &fresh)
	}
}

func isNetworkLoginError(err error) bool {
	return xnet.IsNetworkOrHostDown(err, true)
}
