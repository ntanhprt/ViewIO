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
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/minio/pkg/v3/env"
)

// ViewIO: CHIA SẺ ĐỂ XEM — link công khai (không cần đăng nhập) mở ra trang xem tài liệu, không tự tải về.
//
//	Có đăng nhập (qua /docview/fs/...):
//	  POST /docview/fs/share    {bucket,key,hours,download}  -> {token, ...}   tạo link
//	  GET  /docview/fs/shares   ?bucket&key                  -> danh sách link của file
//	  POST /docview/fs/unshare  {token}                      thu hồi
//	Công khai (token ngẫu nhiên 192 bit là "chìa khoá"):
//	  GET /docview/s/<token>            trang xem
//	  GET /docview/s/<token>/raw        nội dung file (hiển thị tại chỗ, có Range)
//	  GET /docview/s/<token>/pdf        bản PDF của Word/Excel/PowerPoint (qua dịch vụ converter nội bộ, không gọi ra ngoài)
//	  GET /docview/s/<token>/download   tải về (403 nếu link tạo ra không cho tải)
//
// CẤU HÌNH / DI CHUYỂN SANG MÁY KHÁC:
//   - Danh sách link lưu ở <thư mục prefs>/shares.json (VIEWIO_PREFS_DIR hoặc $HOME/viewio-prefs, xem docview_prefs.go),
//     phải nằm trên volume để giữ qua lần tạo lại container.
//   - Link công khai đọc file bằng tài khoản gốc của MinIO (MINIO_ROOT_USER / MINIO_ROOT_PASSWORD của chính container),
//     nhưng CHỈ đúng bucket/key đã ghi trong link (người tạo phải có quyền đọc file đó lúc tạo). Thiếu hai biến này
//     thì tính năng tự tắt (trả 503).
//   - Office -> PDF dùng DOCVIEW_CONVERTER_URL (cùng dịch vụ converter của viewer).
//   - Địa chỉ link = địa chỉ trình duyệt đang dùng để vào Console (location.origin), không ghi cứng domain nào.
//   - Mọi thứ chạy trên máy này, không gọi dịch vụ bên ngoài.
//
// Bảo mật: file được phục vụ cùng origin với Console nên luôn kèm CSP chặn script (sandbox) và nosniff, HTML/SVG
// không bao giờ được trả dưới dạng trang chạy được. "Không cho tải" chỉ ẩn nút/chặn /download, người xem vẫn thấy nội dung.

const (
	docviewSharePrefix = "/docview/s/"
	shareMaxHours      = 24 * 90
	sharePreviewMax    = 2 << 20 // văn bản hiển thị tối đa 2MB
)

type shareRec struct {
	Token    string `json:"token"`
	Bucket   string `json:"bucket"`
	Key      string `json:"key"`
	By       string `json:"by"`
	Account  string `json:"account"`
	Created  int64  `json:"created"`
	Expires  int64  `json:"expires"` // unix giây, 0 = không hết hạn
	Download bool   `json:"download"`
	Views    int    `json:"views"`
	LastView int64  `json:"lastView"`
}

var shareMu sync.Mutex

func sharesFile() (string, error) {
	d, err := activityDir() // cùng thư mục prefs
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(d), "shares.json"), nil
}

func shareLoad() (map[string]*shareRec, error) {
	f, err := sharesFile()
	if err != nil {
		return nil, err
	}
	m := map[string]*shareRec{}
	b, err := os.ReadFile(f)
	if err != nil {
		if os.IsNotExist(err) {
			return m, nil
		}
		return nil, err
	}
	if len(b) > 0 {
		if err := json.Unmarshal(b, &m); err != nil {
			return nil, err
		}
	}
	return m, nil
}

func shareSave(m map[string]*shareRec) error {
	f, err := sharesFile()
	if err != nil {
		return err
	}
	b, _ := json.Marshal(m)
	tmp := f + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, f)
}

func shareRootClient() (*minio.Client, error) {
	u, p := os.Getenv("MINIO_ROOT_USER"), os.Getenv("MINIO_ROOT_PASSWORD")
	if u == "" || p == "" {
		return nil, fmt.Errorf("no root credentials")
	}
	return minio.New(getMinIOEndpoint(), &minio.Options{
		Creds:     credentials.NewStaticV4(u, p, ""),
		Secure:    getMinIOEndpointIsSecure(),
		Transport: GetConsoleHTTPClient("").Transport,
	})
}

// ---------- phía có đăng nhập ----------

func fsShareCreate(w http.ResponseWriter, r *http.Request, c *minio.Client) {
	var req struct {
		Bucket   string `json:"bucket"`
		Key      string `json:"key"`
		Hours    int    `json:"hours"`
		Download bool   `json:"download"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		fsBadRequest(w, "invalid body")
		return
	}
	key := strings.TrimLeft(req.Key, "/")
	if req.Bucket == "" || key == "" || strings.HasSuffix(key, "/") || strings.HasPrefix(key, fsTrashPrefix) {
		fsBadRequest(w, "chỉ chia sẻ được file")
		return
	}
	if req.Hours < 0 || req.Hours > shareMaxHours {
		fsBadRequest(w, "thời hạn không hợp lệ")
		return
	}
	if os.Getenv("MINIO_ROOT_USER") == "" || os.Getenv("MINIO_ROOT_PASSWORD") == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"detailedMessage": "Chia sẻ để xem chưa bật (thiếu MINIO_ROOT_USER/PASSWORD trong container)"})
		return
	}
	if _, err := c.StatObject(r.Context(), req.Bucket, key, minio.StatObjectOptions{}); err != nil {
		uploadErr(w, err) // người tạo phải đọc được file
		return
	}
	nb := make([]byte, 24)
	_, _ = rand.Read(nb)
	rec := &shareRec{
		Token: base64.RawURLEncoding.EncodeToString(nb), Bucket: req.Bucket, Key: key,
		By: actorName(r), Account: activityAccount(r), Created: time.Now().Unix(), Download: req.Download,
	}
	if req.Hours > 0 {
		rec.Expires = time.Now().Add(time.Duration(req.Hours) * time.Hour).Unix()
	}
	shareMu.Lock()
	defer shareMu.Unlock()
	m, err := shareLoad()
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"detailedMessage": "không đọc được kho link chia sẻ"})
		return
	}
	now := time.Now().Unix()
	for t, s := range m { // dọn link đã hết hạn quá 7 ngày
		if s.Expires > 0 && s.Expires < now-7*86400 {
			delete(m, t)
		}
	}
	m[rec.Token] = rec
	if err := shareSave(m); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"detailedMessage": "không ghi được kho link chia sẻ"})
		return
	}
	logActivity(r, req.Bucket, "share", key, "")
	writeJSON(w, http.StatusOK, rec)
}

func fsShareList(w http.ResponseWriter, r *http.Request, c *minio.Client) {
	bucket, key := r.URL.Query().Get("bucket"), strings.TrimLeft(r.URL.Query().Get("key"), "/")
	if bucket == "" || key == "" {
		fsBadRequest(w, "missing bucket/key")
		return
	}
	if _, err := c.StatObject(r.Context(), bucket, key, minio.StatObjectOptions{}); err != nil {
		uploadErr(w, err)
		return
	}
	shareMu.Lock()
	m, err := shareLoad()
	shareMu.Unlock()
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"detailedMessage": "không đọc được kho link chia sẻ"})
		return
	}
	out := []*shareRec{}
	for _, s := range m {
		if s.Bucket == bucket && s.Key == key {
			out = append(out, s)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Created > out[j].Created })
	writeJSON(w, http.StatusOK, map[string]interface{}{"shares": out})
}

func fsShareRevoke(w http.ResponseWriter, r *http.Request, c *minio.Client) {
	var req struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<12)).Decode(&req); err != nil || req.Token == "" {
		fsBadRequest(w, "invalid body")
		return
	}
	shareMu.Lock()
	defer shareMu.Unlock()
	m, err := shareLoad()
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"detailedMessage": "không đọc được kho link chia sẻ"})
		return
	}
	s, ok := m[req.Token]
	if !ok {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	if _, err := c.StatObject(r.Context(), s.Bucket, s.Key, minio.StatObjectOptions{}); err != nil {
		uploadErr(w, err) // phải có quyền đọc file mới thu hồi được
		return
	}
	delete(m, req.Token)
	if err := shareSave(m); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"detailedMessage": "không ghi được kho link chia sẻ"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ---------- phía công khai ----------

func shareKind(name string) string {
	switch strings.ToLower(strings.TrimPrefix(path.Ext(name), ".")) {
	case "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "ico":
		return "image"
	case "pdf":
		return "pdf"
	case "mp4", "webm", "mov", "m4v", "ogv":
		return "video"
	case "mp3", "wav", "ogg", "m4a", "flac", "aac":
		return "audio"
	case "doc", "docx", "odt", "rtf", "xls", "xlsx", "ods", "ppt", "pptx", "odp":
		return "office"
	case "txt", "md", "markdown", "csv", "tsv", "json", "xml", "yaml", "yml", "log", "ini", "toml", "py", "js", "ts", "go", "java", "sql", "sh", "css", "html", "htm", "c", "cpp", "h", "rs", "tex":
		return "text"
	}
	return "other"
}

func shareRawType(name string) string {
	ext := strings.ToLower(path.Ext(name))
	switch shareKind(name) {
	case "image":
		if ext == ".svg" {
			return "image/svg+xml"
		}
		if t := mime.TypeByExtension(ext); t != "" {
			return t
		}
		return "application/octet-stream"
	case "pdf":
		return "application/pdf"
	case "video", "audio":
		if t := mime.TypeByExtension(ext); t != "" {
			return t
		}
	case "text":
		return "text/plain; charset=utf-8"
	}
	return "application/octet-stream"
}

func shareGone(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
	w.WriteHeader(http.StatusGone)
	fmt.Fprintf(w, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link không dùng được</title>
<style>body{font:16px system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#f5f6f8;color:#222}
@media(prefers-color-scheme:dark){body{background:#15171a;color:#e6e6e6}}div{text-align:center;padding:24px}h1{font-size:20px}</style>
<div><h1>%s</h1><p>Hãy nhờ người chia sẻ gửi lại link mới.</p></div>`, html.EscapeString(msg))
}

func shareLookup(token string) (*shareRec, bool) {
	if len(token) < 20 || len(token) > 64 {
		return nil, false
	}
	shareMu.Lock()
	defer shareMu.Unlock()
	m, err := shareLoad()
	if err != nil {
		return nil, false
	}
	s, ok := m[token]
	if !ok || (s.Expires > 0 && s.Expires < time.Now().Unix()) {
		return nil, false
	}
	return s, true
}

func shareTouch(token string) {
	shareMu.Lock()
	defer shareMu.Unlock()
	m, err := shareLoad()
	if err != nil {
		return
	}
	if s, ok := m[token]; ok {
		s.Views++
		s.LastView = time.Now().Unix()
		_ = shareSave(m)
	}
}

func serveDocviewShare(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, docviewSharePrefix)
	token, action, _ := strings.Cut(rest, "/")
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	cl, err := shareRootClient()
	if err != nil {
		http.Error(w, "share disabled", http.StatusServiceUnavailable)
		return
	}
	s, ok := shareLookup(token)
	if !ok {
		shareGone(w, "Link đã hết hạn hoặc đã bị thu hồi")
		return
	}
	name := path.Base(s.Key)
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")

	switch action {
	case "":
		st, err := cl.StatObject(r.Context(), s.Bucket, s.Key, minio.StatObjectOptions{})
		if err != nil {
			shareGone(w, "File không còn tồn tại")
			return
		}
		shareTouch(token)
		sharePage(w, r, s, name, st)
	case "raw", "download":
		if action == "download" && !s.Download {
			http.Error(w, "download disabled", http.StatusForbidden)
			return
		}
		obj, err := cl.GetObject(r.Context(), s.Bucket, s.Key, minio.GetObjectOptions{})
		if err != nil {
			uploadErr(w, err)
			return
		}
		defer obj.Close()
		st, err := obj.Stat()
		if err != nil {
			shareGone(w, "File không còn tồn tại")
			return
		}
		if action == "download" {
			w.Header().Set("Content-Type", "application/octet-stream")
			w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
			w.Header().Set("Content-Security-Policy", "sandbox")
		} else {
			w.Header().Set("Content-Type", shareRawType(name))
			w.Header().Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": name}))
			if shareKind(name) == "pdf" {
				w.Header().Set("Content-Security-Policy", "default-src 'none'; object-src 'self'")
			} else {
				w.Header().Set("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox")
			}
		}
		http.ServeContent(w, r, name, st.LastModified, obj)
	case "pdf":
		sharePDF(w, r, cl, s, name)
	default:
		http.Error(w, "not found", http.StatusNotFound)
	}
}

func sharePDF(w http.ResponseWriter, r *http.Request, cl *minio.Client, s *shareRec, name string) {
	if shareKind(name) != "office" {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	base := strings.TrimRight(env.Get(docviewConverterEnv, docviewDefaultConverter), "/")
	if base == "" || base == "off" {
		http.Error(w, "converter disabled", http.StatusServiceUnavailable)
		return
	}
	obj, err := cl.GetObject(r.Context(), s.Bucket, s.Key, minio.GetObjectOptions{})
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
	if st.Size > docviewMaxBody {
		http.Error(w, "file too large", http.StatusRequestEntityTooLarge)
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, base+"/convert", obj)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	req.ContentLength = st.Size
	req.Header.Set("X-File-Name", name)
	resp, err := docviewClient.Do(req)
	if err != nil {
		http.Error(w, "converter unavailable", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		http.Error(w, "convert failed", http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": name + ".pdf"}))
	w.Header().Set("Content-Security-Policy", "default-src 'none'; object-src 'self'")
	_, _ = io.Copy(w, resp.Body)
}

func shareSize(n int64) string {
	switch {
	case n >= 1<<30:
		return fmt.Sprintf("%.1f GB", float64(n)/(1<<30))
	case n >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(n)/(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%.0f KB", float64(n)/(1<<10))
	}
	return fmt.Sprintf("%d B", n)
}

func sharePage(w http.ResponseWriter, r *http.Request, s *shareRec, name string, st minio.ObjectInfo) {
	kind := shareKind(name)
	tokenPath := docviewSharePrefix + url.PathEscape(s.Token)
	body := ""
	switch kind {
	case "image":
		body = fmt.Sprintf(`<div class="c"><img src="%s/raw" alt="%s"></div>`, tokenPath, html.EscapeString(name))
	case "pdf":
		body = fmt.Sprintf(`<iframe class="f" src="%s/raw" title="%s"></iframe>`, tokenPath, html.EscapeString(name))
	case "office":
		body = fmt.Sprintf(`<iframe class="f" src="%s/pdf" title="%s"></iframe>`, tokenPath, html.EscapeString(name))
	case "video":
		body = fmt.Sprintf(`<div class="c"><video controls preload="metadata" src="%s/raw"></video></div>`, tokenPath)
	case "audio":
		body = fmt.Sprintf(`<div class="c"><audio controls preload="metadata" src="%s/raw"></audio></div>`, tokenPath)
	case "text":
		cl, err := shareRootClient()
		if err == nil {
			obj, err := cl.GetObject(r.Context(), s.Bucket, s.Key, minio.GetObjectOptions{})
			if err == nil {
				defer obj.Close()
				b, _ := io.ReadAll(io.LimitReader(obj, sharePreviewMax+1))
				txt := strings.ToValidUTF8(string(b), "�")
				note := ""
				if len(b) > sharePreviewMax {
					txt = txt[:sharePreviewMax]
					note = `<p class="n">Chỉ hiển thị 2 MB đầu của file.</p>`
				}
				body = `<pre class="t">` + html.EscapeString(txt) + `</pre>` + note
			}
		}
	}
	if body == "" {
		body = `<div class="c"><p>Định dạng này chưa xem trực tiếp được.</p></div>`
	}
	dl := ""
	if s.Download {
		dl = fmt.Sprintf(`<a class="b" href="%s/download">Tải xuống</a>`, tokenPath)
	}
	exp := "Không hết hạn"
	if s.Expires > 0 {
		exp = "Hết hạn " + time.Unix(s.Expires, 0).Format("02/01/2006 15:04")
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
	fmt.Fprintf(w, `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>%s</title>
<style>:root{--bg:#f5f6f8;--fg:#1f2328;--bar:#fff;--bd:#d8dce1;--mu:#667}
@media(prefers-color-scheme:dark){:root{--bg:#15171a;--fg:#e6e6e6;--bar:#1e2125;--bd:#33383d;--mu:#9aa}}
*{box-sizing:border-box}html,body{height:100%%;margin:0}body{display:flex;flex-direction:column;background:var(--bg);color:var(--fg);font:14px system-ui,sans-serif}
header{display:flex;align-items:center;gap:12px;padding:8px 14px;background:var(--bar);border-bottom:1px solid var(--bd)}
.nm{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mt{color:var(--mu);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sp{flex:1}.b{background:#2563eb;color:#fff;text-decoration:none;padding:6px 14px;border-radius:6px;white-space:nowrap}
main{flex:1;min-height:0;display:flex;flex-direction:column}.f{flex:1;border:0;width:100%%;background:#fff}
.c{flex:1;display:flex;align-items:center;justify-content:center;padding:16px;min-height:0}.c img,.c video{max-width:100%%;max-height:100%%}
.t{margin:0;padding:16px;overflow:auto;flex:1;white-space:pre-wrap;word-break:break-word;font:13px/1.5 ui-monospace,Consolas,monospace}.n{padding:0 16px 12px;color:var(--mu)}
</style></head><body><header><div style="min-width:0"><div class="nm">%s</div><div class="mt">%s · Chia sẻ bởi %s · %s</div></div><span class="sp"></span>%s</header>
<main>%s</main></body></html>`,
		html.EscapeString(name), html.EscapeString(name), shareSize(st.Size), html.EscapeString(s.By), html.EscapeString(exp), dl, body)
}
