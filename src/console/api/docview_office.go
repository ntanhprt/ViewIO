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
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/minio/console/models"
	"github.com/minio/console/pkg/auth"
	"github.com/minio/minio-go/v7"
)

// ViewIO: sửa Word / Excel / PowerPoint bằng ONLYOFFICE Document Server (chạy container riêng).
//
//	GET  /docview/office/status                    -> {"enabled":bool}
//	GET  /docview/office/editor?bucket=&key=       -> trang HTML nhúng trình soạn thảo (cần đăng nhập Console)
//	GET  /docview/office/file?t=<token>            -> Document Server tải file về (token ký, không dùng cookie)
//	POST /docview/office/callback?t=<token>        -> Document Server báo lưu; ViewIO tải bản mới về và ghi lại bằng
//	                                                  ĐÚNG quyền của người đang sửa (bucket bật versioning thì giữ bản cũ)
//	POST /docview/fs/newdoc                        -> tạo Word/Excel/PowerPoint trống (theo đuôi file)
//
// Cấu hình (biến môi trường của Console):
//
//	VIEWIO_OFFICE_URL           địa chỉ công khai của Document Server cho trình duyệt (vd https://office.aisolutions.vn); để trống = tắt
//	VIEWIO_OFFICE_INTERNAL_URL  địa chỉ Document Server mà ViewIO với tới trong mạng docker (vd http://viewio-office)
//	VIEWIO_OFFICE_CALLBACK_URL  địa chỉ ViewIO mà Document Server với tới trong mạng docker (vd http://minio:9001)
//	VIEWIO_OFFICE_JWT_SECRET    khoá JWT chung với Document Server (JWT_SECRET)
//	VIEWIO_OFFICE_LAN_PORT      cổng Document Server khi truy cập qua LAN/IP (mặc định 21032)
//
// Khoá tài liệu (document key) gắn với (bucket, key, etag lúc mở) và được giữ chung trong lúc còn người đang sửa, nên
// nhiều người mở cùng file sẽ cùng một phiên đồng soạn thảo. Nếu file trong kho bị đổi từ nơi khác (upload...) giữa
// chừng thì bản sửa được lưu thành file "(bản sửa xung đột)" bên cạnh, không đè lên.

const docviewOfficePrefix = "/docview/office/"

//go:embed officetpl/*
var officeTemplates embed.FS

type officeConfig struct {
	pub, internal, callback, secret, lanPort string
}

func officeConf() (officeConfig, bool) {
	c := officeConfig{
		pub:      strings.TrimRight(os.Getenv("VIEWIO_OFFICE_URL"), "/"),
		internal: strings.TrimRight(os.Getenv("VIEWIO_OFFICE_INTERNAL_URL"), "/"),
		callback: strings.TrimRight(os.Getenv("VIEWIO_OFFICE_CALLBACK_URL"), "/"),
		secret:   os.Getenv("VIEWIO_OFFICE_JWT_SECRET"),
		lanPort:  os.Getenv("VIEWIO_OFFICE_LAN_PORT"),
	}
	if c.lanPort == "" {
		c.lanPort = "21032"
	}
	return c, c.pub != "" && c.internal != "" && c.callback != "" && c.secret != ""
}

// ---- JWT HS256 tối giản (khớp với JWT của ONLYOFFICE) ----

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func jwtSign(secret string, claims map[string]interface{}) string {
	head := b64([]byte(`{"alg":"HS256","typ":"JWT"}`))
	body, _ := json.Marshal(claims)
	msg := head + "." + b64(body)
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(msg))
	return msg + "." + b64(m.Sum(nil))
}

func jwtVerify(secret, token string) (map[string]interface{}, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, errors.New("bad token")
	}
	hb, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, errors.New("bad token")
	}
	var h struct{ Alg string }
	if json.Unmarshal(hb, &h) != nil || h.Alg != "HS256" {
		return nil, errors.New("bad alg")
	}
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(parts[0] + "." + parts[1]))
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !hmac.Equal(sig, m.Sum(nil)) {
		return nil, errors.New("bad signature")
	}
	bb, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, errors.New("bad token")
	}
	claims := map[string]interface{}{}
	if json.Unmarshal(bb, &claims) != nil {
		return nil, errors.New("bad token")
	}
	if exp, ok := claims["exp"].(float64); ok && time.Now().Unix() > int64(exp) {
		return nil, errors.New("token expired")
	}
	return claims, nil
}

// ---- trạng thái phiên đang sửa (trong bộ nhớ; ViewIO chạy một bản) ----

type officeActive struct {
	docKey string
	t      time.Time
}

var (
	officeMu      sync.Mutex
	officeActives = map[string]officeActive{} // "bucket|key" -> khoá đang dùng
	officeWritten = map[string]string{}       // docKey -> etag do chính ViewIO vừa ghi (để không tự báo xung đột)
)

func officeDocKey(bucket, key, etag string) string {
	bk := bucket + "|" + key
	officeMu.Lock()
	defer officeMu.Unlock()
	for k, a := range officeActives {
		if time.Since(a.t) > 24*time.Hour {
			delete(officeActives, k)
		}
	}
	if a, ok := officeActives[bk]; ok {
		return a.docKey
	}
	h := sha1.Sum([]byte(bk + "|" + etag + "|" + time.Now().Format(time.RFC3339Nano)))
	dk := hex.EncodeToString(h[:])
	officeActives[bk] = officeActive{docKey: dk, t: time.Now()}
	return dk
}

func officeClear(bucket, key string) {
	officeMu.Lock()
	delete(officeActives, bucket+"|"+key)
	officeMu.Unlock()
}

// ---- các loại file ----

func officeKind(ext string) (docType string, editable bool) {
	switch ext {
	case "docx", "odt":
		return "word", true
	case "xlsx", "ods":
		return "cell", true
	case "pptx", "odp":
		return "slide", true
	}
	return "", false
}

// officeBase: địa chỉ Document Server cho TRÌNH DUYỆT của yêu cầu này. Vào qua tên miền công khai thì dùng URL công khai;
// vào qua IP/LAN (http) thì dùng cùng host với cổng riêng, tránh lỗi mixed-content.
func officeBase(r *http.Request, c officeConfig) string {
	host := r.Header.Get("X-Forwarded-Host")
	if host == "" {
		host = r.Host
	}
	h, _, err := net.SplitHostPort(host)
	if err != nil {
		h = host
	}
	if net.ParseIP(h) != nil || !strings.Contains(h, ".") || strings.HasSuffix(h, ".local") || h == "localhost" {
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		}
		return scheme + "://" + h + ":" + c.lanPort
	}
	return c.pub
}

func serveDocviewOffice(w http.ResponseWriter, r *http.Request) {
	c, ok := officeConf()
	action := strings.TrimPrefix(r.URL.Path, docviewOfficePrefix)
	if action == "status" && r.Method == http.MethodGet {
		if _, err := auth.GetClaimsFromTokenInRequest(r); err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detailedMessage": "unauthorized"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"enabled": ok})
		return
	}
	if !ok {
		http.Error(w, "office editing is not configured", http.StatusNotFound)
		return
	}
	switch {
	case action == "editor" && r.Method == http.MethodGet:
		officeEditor(w, r, c)
	case action == "file" && (r.Method == http.MethodGet || r.Method == http.MethodHead):
		officeFile(w, r, c)
	case action == "callback" && r.Method == http.MethodPost:
		officeCallback(w, r, c)
	default:
		http.Error(w, "not found", http.StatusNotFound)
	}
}

func officeEditor(w http.ResponseWriter, r *http.Request, c officeConfig) {
	principal, err := auth.GetClaimsFromTokenInRequest(r)
	if err != nil || principal == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	sess, _ := auth.GetTokenFromRequest(r)
	bucket, key := r.URL.Query().Get("bucket"), strings.TrimLeft(r.URL.Query().Get("key"), "/")
	ext := strings.ToLower(strings.TrimPrefix(path.Ext(key), "."))
	docType, editable := officeKind(ext)
	if bucket == "" || key == "" || !editable {
		http.Error(w, "định dạng này không sửa được bằng ONLYOFFICE", http.StatusBadRequest)
		return
	}
	client, err := newMinioClient(principal, getClientIP(r))
	if err != nil {
		http.Error(w, "storage client error", http.StatusInternalServerError)
		return
	}
	st, err := client.StatObject(r.Context(), bucket, key, minio.StatObjectOptions{})
	if err != nil {
		http.Error(w, minio.ToErrorResponse(err).Message, http.StatusNotFound)
		return
	}
	if st.Size > 200<<20 {
		http.Error(w, "file lớn hơn 200 MB, hãy tải về để sửa", http.StatusRequestEntityTooLarge)
		return
	}
	uid := principal.AccountAccessKey
	tok := jwtSign(c.secret, map[string]interface{}{
		"b": bucket, "k": key, "e": strings.Trim(st.ETag, "\""), "s": sess, "u": uid,
		"exp": time.Now().Add(24 * time.Hour).Unix(),
	})
	dk := officeDocKey(bucket, key, st.ETag)
	cfg := map[string]interface{}{
		"documentType": docType,
		"width":        "100%",
		"height":       "100%",
		"document": map[string]interface{}{
			"fileType": ext,
			"key":      dk,
			"title":    path.Base(key),
			"url":      c.callback + "/docview/office/file?t=" + url.QueryEscape(tok),
			"permissions": map[string]interface{}{
				"edit": true, "download": true, "print": true, "copy": true,
			},
		},
		"editorConfig": map[string]interface{}{
			"callbackUrl": c.callback + "/docview/office/callback?t=" + url.QueryEscape(tok),
			"lang":        "vi",
			"mode":        "edit",
			"user":        map[string]interface{}{"id": uid, "name": uid},
			"customization": map[string]interface{}{
				"autosave": true, "forcesave": true, "compactHeader": true, "uiTheme": "default-light",
				"spellcheck": false, // tắt gạch đỏ kiểm tra chính tả (không có từ điển tiếng Việt)
			},
		},
	}
	cfg["token"] = jwtSign(c.secret, cfg)
	cj, _ := json.Marshal(cfg)
	cjs := strings.NewReplacer("<", "\\u003c", ">", "\\u003e", "&", "\\u0026").Replace(string(cj))

	base := officeBase(r, c)
	nb := make([]byte, 16)
	_, _ = rand.Read(nb)
	nonce := b64(nb)
	origin := base
	if u, err := url.Parse(base); err == nil {
		origin = u.Scheme + "://" + u.Host
	}
	ws := strings.Replace(strings.Replace(origin, "https://", "wss://", 1), "http://", "ws://", 1)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", fmt.Sprintf(
		"default-src 'none'; script-src 'nonce-%s' %s; frame-src %s; connect-src %s %s; style-src 'unsafe-inline'; img-src * data: blob:; font-src * data:; frame-ancestors 'self'",
		nonce, origin, origin, origin, ws))
	fmt.Fprintf(w, `<!doctype html><html><head><meta charset="utf-8"><title>%s</title>
<style>html,body,#ed{height:100%%;margin:0}body{font:14px system-ui,sans-serif}#err{padding:24px;color:#b00}</style>
<script nonce="%s" src="%s/web-apps/apps/api/documents/api.js"></script></head>
<body><div id="ed"></div>
<script nonce="%s">
if (typeof DocsAPI === "undefined") {
  document.getElementById("ed").innerHTML = '<div id="err">Không kết nối được máy chủ soạn thảo Office (%s). Hãy báo quản trị.</div>';
} else {
  new DocsAPI.DocEditor("ed", %s);
}
</script></body></html>`, htmlEscape(path.Base(key)), nonce, base, nonce, htmlEscape(origin), cjs)
}

func htmlEscape(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;").Replace(s)
}

func principalFromClaims(tc *auth.TokenClaims) *models.Principal {
	return &models.Principal{
		STSAccessKeyID:     tc.STSAccessKeyID,
		STSSecretAccessKey: tc.STSSecretAccessKey,
		STSSessionToken:    tc.STSSessionToken,
		AccountAccessKey:   tc.AccountAccessKey,
	}
}

func officePrincipal(claims map[string]interface{}, r *http.Request) (*minio.Client, string, string, string, error) {
	sess, _ := claims["s"].(string)
	b, _ := claims["b"].(string)
	k, _ := claims["k"].(string)
	e, _ := claims["e"].(string)
	tc, err := auth.SessionTokenAuthenticate(sess)
	if err != nil {
		return nil, "", "", "", err
	}
	p := principalFromClaims(tc)
	cl, err := newMinioClient(p, getClientIP(r))
	return cl, b, k, e, err
}

func officeFile(w http.ResponseWriter, r *http.Request, c officeConfig) {
	claims, err := jwtVerify(c.secret, r.URL.Query().Get("t"))
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	cl, bucket, key, _, err := officePrincipal(claims, r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	obj, err := cl.GetObject(r.Context(), bucket, key, minio.GetObjectOptions{})
	if err != nil {
		uploadErr(w, err)
		return
	}
	defer obj.Close()
	st, err := obj.Stat()
	if err != nil {
		uploadErr(w, err)
		return
	}
	if st.ContentType != "" {
		w.Header().Set("Content-Type", st.ContentType)
	}
	http.ServeContent(w, r, path.Base(key), st.LastModified, obj)
}

type officeCallbackBody struct {
	Status int    `json:"status"`
	URL    string `json:"url"`
	Key    string `json:"key"`
	Token  string `json:"token"`
}

func officeCallback(w http.ResponseWriter, r *http.Request, c officeConfig) {
	reply := func(code int) {
		writeJSON(w, http.StatusOK, map[string]int{"error": code})
	}
	claims, err := jwtVerify(c.secret, r.URL.Query().Get("t"))
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		reply(1)
		return
	}
	var body officeCallbackBody
	_ = json.Unmarshal(raw, &body)
	// Document Server ký callback bằng cùng khoá: token ở header Authorization hoặc trong body
	tok := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer"))
	if tok == "" {
		tok = body.Token
	}
	dsClaims, err := jwtVerify(c.secret, tok)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if p, ok := dsClaims["payload"]; ok { // token ở header bọc body trong "payload"
		pb, _ := json.Marshal(p)
		body = officeCallbackBody{}
		_ = json.Unmarshal(pb, &body)
	}
	cl, bucket, key, etag0, err := officePrincipal(claims, r)
	if err != nil {
		log.Printf("viewio-office: callback: phiên đã hết hạn (%s/%s): %v", bucket, key, err)
		reply(1)
		return
	}
	switch body.Status {
	case 4: // đóng, không có thay đổi
		officeClear(bucket, key)
		reply(0)
	case 2, 6: // 2: đóng và có thay đổi, 6: lưu giữa chừng (forcesave)
		if err := officeSave(r, cl, c, bucket, key, etag0, body); err != nil {
			log.Printf("viewio-office: lưu %s/%s thất bại: %v", bucket, key, err)
			reply(1)
			return
		}
		if body.Status == 2 {
			officeClear(bucket, key)
		}
		reply(0)
	case 3, 7:
		log.Printf("viewio-office: Document Server báo lỗi lưu %s/%s (status %d)", bucket, key, body.Status)
		reply(0)
	default:
		reply(0)
	}
}

func officeSave(r *http.Request, cl *minio.Client, c officeConfig, bucket, key, etag0 string, body officeCallbackBody) error {
	// Document Server trả URL theo tên miền công khai: đổi sang địa chỉ nội bộ để không đi vòng qua Internet
	u, err := url.Parse(body.URL)
	if err != nil || body.URL == "" {
		return errors.New("callback không có url")
	}
	src := c.internal + u.EscapedPath()
	if u.RawQuery != "" {
		src += "?" + u.RawQuery
	}
	req, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, src, nil)
	if c.secret != "" {
		req.Header.Set("Authorization", "Bearer "+jwtSign(c.secret, map[string]interface{}{"payload": map[string]string{"url": body.URL}}))
	}
	resp, err := (&http.Client{Timeout: 20 * time.Minute}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("tải bản sửa từ Document Server: HTTP %d", resp.StatusCode)
	}
	ctx := r.Context()
	target := key
	ct := ""
	if st, err := cl.StatObject(ctx, bucket, key, minio.StatObjectOptions{}); err == nil {
		ct = st.ContentType
		cur := strings.Trim(st.ETag, "\"")
		officeMu.Lock()
		mine := officeWritten[body.Key]
		officeMu.Unlock()
		if cur != etag0 && cur != mine {
			// file trong kho đã bị đổi từ nơi khác: không đè, lưu bản sửa bên cạnh
			ext := path.Ext(key)
			target = strings.TrimSuffix(key, ext) + " (bản sửa xung đột " + time.Now().Format("2006-01-02 15-04") + ")" + ext
		}
	} else if minio.ToErrorResponse(err).StatusCode != http.StatusNotFound {
		return err
	}
	info, err := cl.PutObject(ctx, bucket, target, resp.Body, -1, minio.PutObjectOptions{ContentType: ct, PartSize: 16 << 20})
	if err != nil {
		return err
	}
	if target == key {
		officeMu.Lock()
		officeWritten[body.Key] = strings.Trim(info.ETag, "\"")
		officeMu.Unlock()
	}
	return nil
}

// fsNewDoc tạo Word/Excel/PowerPoint trống từ mẫu của ONLYOFFICE.
func fsNewDoc(w http.ResponseWriter, r *http.Request, c *minio.Client) {
	var req fsReq
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req) != nil || req.Bucket == "" {
		fsBadRequest(w, "bad request")
		return
	}
	key := strings.TrimLeft(req.Key, "/")
	ext := strings.ToLower(strings.TrimPrefix(path.Ext(key), "."))
	var data []byte
	switch ext {
	case "docx", "xlsx", "pptx":
		var err error
		if data, err = officeTemplates.ReadFile("officetpl/new." + ext); err != nil {
			fsBadRequest(w, "không có mẫu")
			return
		}
	case "drawio":
		data = []byte(drawioBlankXML)
	default:
		fsBadRequest(w, "chỉ hỗ trợ .docx .xlsx .pptx .drawio")
		return
	}
	ctx := r.Context()
	taken, err := fsExists(ctx, c, req.Bucket, key, false)
	if err != nil {
		uploadErr(w, err)
		return
	}
	if taken {
		writeJSON(w, http.StatusConflict, map[string]string{"detailedMessage": fmt.Sprintf("%q đã tồn tại", path.Base(key))})
		return
	}
	ct := map[string]string{
		"docx":   "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"xlsx":   "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		"pptx":   "application/vnd.openxmlformats-officedocument.presentationml.presentation",
		"drawio": "application/vnd.jgraph.mxfile",
	}[ext]
	if _, err := c.PutObject(ctx, req.Bucket, key, strings.NewReader(string(data)), int64(len(data)), minio.PutObjectOptions{ContentType: ct}); err != nil {
		uploadErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"key": key})
}
