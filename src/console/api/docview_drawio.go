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
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"

	"github.com/minio/console/pkg/auth"
	"github.com/minio/minio-go/v7"
)

// ViewIO: sửa sơ đồ draw.io trực quan bằng draw.io tự host (container riêng, chế độ nhúng).
//
//	GET /docview/drawio/status                 -> {"enabled":bool}
//	GET /docview/drawio/editor?bucket=&key=    -> trang HTML nhúng draw.io; nạp/lưu file qua postMessage + /docview/fs/save
//
// Cấu hình: VIEWIO_DRAWIO_URL (địa chỉ công khai của draw.io cho trình duyệt; trống = tắt),
// VIEWIO_DRAWIO_LAN_PORT (cổng khi vào ViewIO bằng IP/LAN, mặc định 21033).
// Trang soạn thảo có CSP riêng (nonce) và draw.io chạy ở origin khác, nên nội dung sơ đồ không chạm được phiên Console.

const (
	docviewDrawioPrefix = "/docview/drawio/"
	drawioMaxLoad       = 10 << 20
	drawioBlankXML      = `<mxfile host="viewio"><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>`
)

func drawioConf() (pub, lan string, ok bool) {
	pub = strings.TrimRight(os.Getenv("VIEWIO_DRAWIO_URL"), "/")
	lan = os.Getenv("VIEWIO_DRAWIO_LAN_PORT")
	if lan == "" {
		lan = "21033"
	}
	return pub, lan, pub != ""
}

func serveDocviewDrawio(w http.ResponseWriter, r *http.Request) {
	pub, lan, ok := drawioConf()
	action := strings.TrimPrefix(r.URL.Path, docviewDrawioPrefix)
	if action == "status" && r.Method == http.MethodGet {
		if _, err := auth.GetClaimsFromTokenInRequest(r); err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detailedMessage": "unauthorized"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"enabled": ok})
		return
	}
	if !ok || action != "editor" || r.Method != http.MethodGet {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	principal, err := auth.GetClaimsFromTokenInRequest(r)
	if err != nil || principal == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	bucket, key := r.URL.Query().Get("bucket"), strings.TrimLeft(r.URL.Query().Get("key"), "/")
	ext := strings.ToLower(path.Ext(key))
	if bucket == "" || key == "" || (ext != ".drawio" && ext != ".dio") {
		http.Error(w, "chỉ sửa được file .drawio / .dio", http.StatusBadRequest)
		return
	}
	client, err := newMinioClient(principal, getClientIP(r))
	if err != nil {
		http.Error(w, "storage client error", http.StatusInternalServerError)
		return
	}
	ctx := r.Context()
	st, err := client.StatObject(ctx, bucket, key, minio.StatObjectOptions{})
	if err != nil {
		http.Error(w, minio.ToErrorResponse(err).Message, http.StatusNotFound)
		return
	}
	if st.Size > drawioMaxLoad {
		http.Error(w, "sơ đồ lớn hơn 10 MB, hãy tải về để sửa", http.StatusRequestEntityTooLarge)
		return
	}
	obj, err := client.GetObject(ctx, bucket, key, minio.GetObjectOptions{})
	if err != nil {
		uploadErr(w, err)
		return
	}
	defer obj.Close()
	data, err := io.ReadAll(io.LimitReader(obj, drawioMaxLoad+1))
	if err != nil {
		uploadErr(w, err)
		return
	}
	xml := string(data)
	if strings.TrimSpace(xml) == "" {
		xml = drawioBlankXML
	}

	// draw.io cho trình duyệt: vào bằng tên miền công khai thì dùng URL công khai, vào bằng IP/LAN thì cùng host + cổng riêng
	base := pub
	host := r.Header.Get("X-Forwarded-Host")
	if host == "" {
		host = r.Host
	}
	if h := officeHostOnly(host); isLANHost(h) {
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		}
		base = scheme + "://" + h + ":" + lan
	}
	origin := base
	if u, err := url.Parse(base); err == nil {
		origin = u.Scheme + "://" + u.Host
	}
	frameURL := base + "/?" + url.Values{
		"embed": {"1"}, "proto": {"json"}, "spin": {"1"}, "lang": {"vi"}, "offline": {"1"},
		"saveAndExit": {"0"}, "noSaveBtn": {"0"}, "configure": {"1"}, "dark": {"auto"},
	}.Encode()

	cfg, _ := json.Marshal(map[string]interface{}{
		"bucket": bucket, "key": key, "etag": strings.Trim(st.ETag, "\""), "xml": xml,
		"title": path.Base(key), "origin": origin, "who": strings.TrimSpace(r.URL.Query().Get("who")),
	})
	cfgs := strings.NewReplacer("<", "\\u003c", ">", "\\u003e", "&", "\\u0026").Replace(string(cfg))
	nb := make([]byte, 16)
	_, _ = rand.Read(nb)
	nonce := b64(nb)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", fmt.Sprintf(
		"default-src 'none'; script-src 'nonce-%s'; frame-src %s; connect-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'",
		nonce, origin))
	fmt.Fprintf(w, drawioPage, htmlEscape(path.Base(key)), htmlEscape(frameURL), nonce, cfgs)
}

func officeHostOnly(hostport string) string {
	if i := strings.LastIndex(hostport, ":"); i > 0 && !strings.Contains(hostport[i:], "]") {
		return hostport[:i]
	}
	return hostport
}

func isLANHost(h string) bool {
	return !strings.Contains(h, ".") || strings.HasSuffix(h, ".local") || h == "localhost" || isIPv4(h)
}

func isIPv4(h string) bool {
	parts := strings.Split(h, ".")
	if len(parts) != 4 {
		return false
	}
	for _, p := range parts {
		if p == "" || len(p) > 3 {
			return false
		}
		for _, c := range p {
			if c < '0' || c > '9' {
				return false
			}
		}
	}
	return true
}

// Trang nhúng: nói chuyện với draw.io bằng giao thức postMessage (proto=json).
const drawioPage = `<!doctype html><html><head><meta charset="utf-8"><title>%s</title>
<style>html,body,iframe{height:100%%;width:100%%;margin:0;border:0}body{font:14px system-ui,sans-serif}
#msg{position:fixed;left:50%%;bottom:14px;transform:translateX(-50%%);background:#222;color:#fff;padding:6px 14px;border-radius:6px;font-size:13px;display:none}</style></head>
<body><iframe id="f" src="%s"></iframe><div id="msg"></div>
<script nonce="%s">
var C = %s;
var f = document.getElementById("f"), msgEl = document.getElementById("msg");
function say(t){ msgEl.textContent = t; msgEl.style.display = "block"; clearTimeout(say.t); say.t = setTimeout(function(){ msgEl.style.display = "none"; }, 3000); }
function send(o){ f.contentWindow.postMessage(JSON.stringify(o), C.origin); }
var etag = C.etag, dirty = false;
function put(xml, tag){
  return fetch("../fs/save?" + new URLSearchParams({bucket: C.bucket, key: C.key, etag: tag}), {
    method: "PUT", credentials: "same-origin", headers: {"Content-Type": "application/xml; charset=utf-8", "X-Viewio-User": encodeURIComponent(C.who || "")}, body: xml
  });
}
async function save(xml){
  var r = await put(xml, etag);
  if (r.status === 409) {
    if (!confirm("Sơ đồ đã được người khác sửa sau khi bạn mở.\nGhi đè bằng bản của bạn? (bản của họ vẫn còn trong lịch sử phiên bản nếu bucket bật versioning)")) { throw new Error("conflict"); }
    var i = await (await fetch("../fs/info?" + new URLSearchParams({bucket: C.bucket, key: C.key}), {credentials: "same-origin"})).json();
    r = await put(xml, i.etag || "");
  }
  var d = await r.json().catch(function(){ return {}; });
  if (!r.ok) { throw new Error(d.detailedMessage || ("Lỗi " + r.status)); }
  etag = d.etag;
}
window.addEventListener("message", async function(ev){
  if (ev.origin !== C.origin || ev.source !== f.contentWindow) { return; }
  var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
  switch (m.event) {
    case "configure": send({action: "configure", config: {compressXml: false}}); break;
    case "init": send({action: "load", xml: C.xml, autosave: 1, title: C.title}); break;
    case "load": break;
    case "autosave": case "save":
      try { await save(m.xml); dirty = false; send({action: "status", message: "Đã lưu " + new Date().toLocaleTimeString(), modified: false}); }
      catch (e) { dirty = true; send({action: "status", message: "Không lưu được: " + e.message, modified: true}); say("Không lưu được: " + e.message); }
      break;
    case "exit":
      if (dirty && !confirm("Còn thay đổi chưa lưu. Đóng và bỏ thay đổi?")) { break; }
      parent.postMessage({viewioClose: true}, location.origin);
      break;
  }
});
</script></body></html>`
