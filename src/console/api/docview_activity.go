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
	"bufio"
	"crypto/subtle"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/minio/console/pkg/auth"
	"github.com/minio/minio-go/v7"
)

// ViewIO: nhật ký hoạt động ("Thông báo") — ai vừa làm gì với file nào, mới nhất ở trên, cho nhóm nhiều người dùng chung
// một tài khoản. Nguồn ghi:
//
//  1. Thao tác qua ViewIO (di chuyển/sao chép/xoá/khôi phục/tạo/sửa/upload/ONLYOFFICE/draw.io): ghi kèm TÊN NGƯỜI do giao diện gửi
//     trong header X-Viewio-User (mỗi người tự đặt tên hiển thị trên trình duyệt của mình).
//  2. Ghi/xoá bằng S3 API (mc, boto3, Claude...): MinIO gọi webhook POST /docview/events (cần VIEWIO_EVENTS_TOKEN và
//     `mc event add <bucket> arn:minio:sqs::VIEWIO:webhook --event put,delete`); sự kiện trùng với thao tác đã ghi ở mục 1 bị bỏ.
//
//	GET /docview/fs/activity?since=<ms>&limit=  -> {"entries":[...], "now":<ms>}  gộp các bucket người dùng truy cập được
//
// Lưu ở $VIEWIO_PREFS_DIR/activity/<bucket>.jsonl (giữ ~1000 dòng mới nhất mỗi bucket).

type activityEntry struct {
	T       int64  `json:"t"` // ms
	Bucket  string `json:"bucket"`
	Actor   string `json:"actor"`
	Op      string `json:"op"` // upload|edit|delete|move|copy|trash|restore|rename|mkdir|create|purge
	Key     string `json:"key"`
	To      string `json:"to,omitempty"`
	Via     string `json:"via,omitempty"` // viewio | s3
	Account string `json:"account,omitempty"`
}

var (
	activityMu     sync.Mutex
	activityWrites = map[string]int{}
)

func activityDir() (string, error) {
	p, err := prefsPath("x")
	if err != nil {
		return "", err
	}
	d := filepath.Join(filepath.Dir(p), "activity")
	return d, os.MkdirAll(d, 0o700)
}

func activityFile(bucket string) (string, error) {
	d, err := activityDir()
	if err != nil {
		return "", err
	}
	safe := strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r == 0 {
			return '_'
		}
		return r
	}, bucket)
	return filepath.Join(d, safe+".jsonl"), nil
}

func recordActivity(e activityEntry) {
	if e.Bucket == "" || e.Key == "" || strings.HasPrefix(e.Key, fsTrashPrefix) && e.Op != "trash" && e.Op != "restore" && e.Op != "purge" {
		return
	}
	if e.T == 0 {
		e.T = time.Now().UnixMilli()
	}
	if e.Actor == "" {
		e.Actor = "Ẩn danh"
	}
	f, err := activityFile(e.Bucket)
	if err != nil {
		return
	}
	activityMu.Lock()
	defer activityMu.Unlock()
	fh, err := os.OpenFile(f, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	b, _ := json.Marshal(e)
	_, _ = fh.Write(append(b, '\n'))
	_ = fh.Close()
	if activityWrites[e.Bucket]++; activityWrites[e.Bucket]%100 == 0 {
		activityTrim(f)
	}
}

func activityTrim(f string) {
	lines := activityTail(f, 100000)
	if len(lines) <= 1000 {
		return
	}
	lines = lines[len(lines)-1000:]
	var sb strings.Builder
	for _, l := range lines {
		b, _ := json.Marshal(l)
		sb.Write(b)
		sb.WriteByte('\n')
	}
	_ = os.WriteFile(f+".tmp", []byte(sb.String()), 0o600)
	_ = os.Rename(f+".tmp", f)
}

func activityTail(f string, max int) []activityEntry {
	fh, err := os.Open(f)
	if err != nil {
		return nil
	}
	defer fh.Close()
	var out []activityEntry
	sc := bufio.NewScanner(fh)
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	for sc.Scan() {
		var e activityEntry
		if json.Unmarshal(sc.Bytes(), &e) == nil {
			out = append(out, e)
		}
	}
	if len(out) > max {
		out = out[len(out)-max:]
	}
	return out
}

// actorName lấy tên người từ header X-Viewio-User (giao diện gửi encodeURIComponent(tên)).
func actorName(r *http.Request) string {
	v := r.Header.Get("X-Viewio-User")
	if v == "" {
		return ""
	}
	if d, err := url.QueryUnescape(v); err == nil {
		v = d
	}
	v = strings.TrimSpace(strings.Map(func(r rune) rune {
		if r < 32 {
			return -1
		}
		return r
	}, v))
	if rs := []rune(v); len(rs) > 60 {
		v = string(rs[:60])
	}
	return v
}

func activityAccount(r *http.Request) string {
	if p, err := auth.GetClaimsFromTokenInRequest(r); err == nil && p != nil {
		return p.AccountAccessKey
	}
	return ""
}

// logActivity ghi một thao tác do người dùng thực hiện qua ViewIO.
func logActivity(r *http.Request, bucket, op, key, to string) {
	recordActivity(activityEntry{Bucket: bucket, Actor: actorName(r), Op: op, Key: key, To: to, Via: "viewio", Account: activityAccount(r)})
}

// ---- thao tác qua Console gốc (upload thường, xoá...) ----

type statusWriter struct {
	http.ResponseWriter
	code int
}

func (s *statusWriter) WriteHeader(c int) {
	s.code = c
	s.ResponseWriter.WriteHeader(c)
}

func (s *statusWriter) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// withConsoleActivity ghi nhật ký cho upload / xoá của Console gốc (các đường /api/v1/buckets/<b>/objects...).
func withConsoleActivity(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if !strings.HasPrefix(p, "/api/v1/buckets/") || (r.Method != http.MethodPost && r.Method != http.MethodDelete) {
			next.ServeHTTP(w, r)
			return
		}
		rest := strings.TrimPrefix(p, "/api/v1/buckets/")
		i := strings.Index(rest, "/")
		if i < 0 {
			next.ServeHTTP(w, r)
			return
		}
		bucket, tail := rest[:i], rest[i:]
		op, key := "", ""
		switch {
		case r.Method == http.MethodPost && tail == "/objects/upload":
			op, key = "upload", r.URL.Query().Get("prefix")
		case r.Method == http.MethodDelete && tail == "/objects":
			op, key = "delete", r.URL.Query().Get("prefix")
		case r.Method == http.MethodPost && tail == "/delete-objects":
			op, key = "delete", "(nhiều mục)"
		}
		if op == "" || key == "" {
			next.ServeHTTP(w, r)
			return
		}
		actor, account := actorName(r), activityAccount(r)
		sw := &statusWriter{ResponseWriter: w, code: http.StatusOK}
		next.ServeHTTP(sw, r)
		if sw.code < 300 {
			recordActivity(activityEntry{Bucket: bucket, Actor: actor, Op: op, Key: strings.TrimLeft(key, "/"), Via: "viewio", Account: account})
		}
	})
}

// ---- webhook sự kiện của MinIO (ghi/xoá bằng S3 API) ----

type minioEvent struct {
	Records []struct {
		EventName string `json:"eventName"`
		Request   struct {
			SourceIP string `json:"sourceIPAddress"`
		} `json:"requestParameters"`
		UserIdentity struct {
			PrincipalID string `json:"principalId"`
		} `json:"userIdentity"`
		S3 struct {
			Bucket struct {
				Name string `json:"name"`
			} `json:"bucket"`
			Object struct {
				Key string `json:"key"`
			} `json:"object"`
		} `json:"s3"`
		Source struct {
			UserAgent string `json:"userAgent"`
		} `json:"source"`
	} `json:"Records"`
}

func serveDocviewEvents(w http.ResponseWriter, r *http.Request) {
	tok := os.Getenv("VIEWIO_EVENTS_TOKEN")
	got := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer"))
	if r.Method != http.MethodPost || tok == "" || subtle.ConstantTimeCompare([]byte(got), []byte(tok)) != 1 {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	raw, _ := io.ReadAll(io.LimitReader(r.Body, 4<<20))
	var ev minioEvent
	if json.Unmarshal(raw, &ev) != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	for _, rec := range ev.Records {
		key, err := url.QueryUnescape(rec.S3.Object.Key)
		if err != nil {
			key = rec.S3.Object.Key
		}
		bucket := rec.S3.Bucket.Name
		if bucket == "" || key == "" || strings.HasPrefix(key, fsTrashPrefix) {
			continue
		}
		op := "upload"
		switch {
		case strings.Contains(rec.EventName, "ObjectRemoved") || strings.Contains(rec.EventName, "DeleteMarker"):
			op = "delete"
		case strings.Contains(rec.EventName, "Copy"):
			op = "copy"
		}
		ua := rec.Source.UserAgent
		viaConsole := strings.Contains(ua, "MinIO Console")
		short := ua
		if i := strings.IndexAny(short, " ("); i > 0 {
			short = short[:i]
		}
		actor := "S3 API"
		if short != "" {
			actor += " (" + short + ")"
		}
		if rec.UserIdentity.PrincipalID != "" {
			actor += " · " + rec.UserIdentity.PrincipalID
		}
		e := activityEntry{T: time.Now().UnixMilli(), Bucket: bucket, Actor: actor, Op: op, Key: key, Via: "s3"}
		if viaConsole {
			e.Actor, e.Via = "Console", "viewio"
		}
		// Đợi vài giây để thao tác qua ViewIO (kèm tên người) ghi trước, rồi bỏ sự kiện trùng
		go func(e activityEntry) {
			time.Sleep(4 * time.Second)
			f, err := activityFile(e.Bucket)
			if err == nil {
				for _, x := range activityTail(f, 60) {
					if x.Via != "viewio" {
						continue // chỉ bỏ sự kiện trùng với thao tác đã ghi từ ViewIO (có tên người)
					}
					if (x.Key == e.Key || x.To == e.Key) && abs64(x.T-e.T) < 15000 {
						return
					}
					// thao tác thư mục/nhiều mục của ViewIO bao trùm khóa này
					if strings.HasSuffix(x.Key, "/") && strings.HasPrefix(e.Key, x.Key) && abs64(x.T-e.T) < 60000 {
						return
					}
					if strings.HasSuffix(x.To, "/") && strings.HasPrefix(e.Key, x.To) && abs64(x.T-e.T) < 60000 {
						return
					}
				}
			}
			recordActivity(e)
		}(e)
	}
	w.WriteHeader(http.StatusOK)
}

func abs64(a int64) int64 {
	if a < 0 {
		return -a
	}
	return a
}

// ---- đọc thông báo ----

func fsActivity(w http.ResponseWriter, r *http.Request, c *minio.Client) {
	q := r.URL.Query()
	var since int64
	if v := q.Get("since"); v != "" {
		for _, ch := range v {
			if ch < '0' || ch > '9' {
				since = 0
				break
			}
			since = since*10 + int64(ch-'0')
		}
	}
	limit := 100
	bs, err := c.ListBuckets(r.Context())
	if err != nil {
		uploadErr(w, err)
		return
	}
	var all []activityEntry
	for _, b := range bs {
		f, err := activityFile(b.Name)
		if err != nil {
			continue
		}
		for _, e := range activityTail(f, 200) {
			if e.T > since {
				all = append(all, e)
			}
		}
	}
	sort.Slice(all, func(i, j int) bool { return all[i].T > all[j].T })
	if len(all) > limit {
		all = all[:limit]
	}
	for i := range all {
		all[i].Account = "" // không lộ tên tài khoản cho người khác
	}
	if all == nil {
		all = []activityEntry{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"entries": all, "now": time.Now().UnixMilli()})
}

var _ = path.Base
