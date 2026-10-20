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
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"path"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/minio/console/pkg/auth"
	"github.com/minio/minio-go/v7"
)

// ViewIO: thao tác kiểu Windows Explorer — copy / di chuyển / đổi tên file và thư mục (S3 copy phía server,
// dữ liệu không đi qua trình duyệt) và liệt kê thư mục con cho hộp thoại chọn đích.
//
//	GET  /docview/fs/list?bucket=&prefix=   -> {"buckets":[..]} (khi thiếu bucket) | {"folders":["a/","b/"]}
//	POST /docview/fs/transfer               body fsTransferReq, trả về luồng NDJSON (giữ kết nối sống qua Cloudflare)

const (
	docviewFsPrefix = "/docview/fs/"
	fsCopyLimit     = 5<<30 - 1 // CopyObject đơn lẻ tối đa 5 GiB, lớn hơn dùng ComposeObject (copy multipart)
)

type fsTransferReq struct {
	Op         string   `json:"op"`         // copy | move | trash (chuyển vào .trash/) | restore (khôi phục từ .trash/)
	Bucket     string   `json:"bucket"`     // bucket nguồn
	Items      []string `json:"items"`      // key nguồn; thư mục kết thúc bằng "/"
	DestBucket string   `json:"destBucket"` // mặc định = bucket nguồn
	DestPrefix string   `json:"destPrefix"` // "" hoặc "a/b/"
	NewName    string   `json:"newName"`    // đổi tên (chỉ khi có đúng 1 item)
	Conflict   string   `json:"conflict"`   // keep (mặc định, thêm " (1)") | overwrite | skip | fail
}

type fsLine struct {
	Done    int      `json:"done,omitempty"`
	Total   int      `json:"total,omitempty"`
	HB      bool     `json:"hb,omitempty"`
	Result  bool     `json:"result,omitempty"`
	OK      int      `json:"ok,omitempty"`
	Skipped int      `json:"skipped,omitempty"`
	Failed  []string `json:"failed,omitempty"`
	Moves   []fsMove `json:"moves,omitempty"` // mục cấp cao nhất: nguồn -> đích thực tế (để hoàn tác)
}

type fsMove struct {
	From string `json:"from"`
	To   string `json:"to"`
}

const fsTrashPrefix = ".trash/"

type fsSrc struct {
	key  string // key nguồn
	dest string // key đích
	size int64
}

func serveDocviewFs(w http.ResponseWriter, r *http.Request) {
	principal, err := auth.GetClaimsFromTokenInRequest(r)
	if err != nil || principal == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"detailedMessage": "unauthorized"})
		return
	}
	client, err := newMinioClient(principal, getClientIP(r))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detailedMessage": "storage client error"})
		return
	}
	action := strings.TrimPrefix(r.URL.Path, docviewFsPrefix)
	switch {
	case action == "activity" && r.Method == http.MethodGet:
		fsActivity(w, r, client)
	case action == "prefs" && (r.Method == http.MethodGet || r.Method == http.MethodPut):
		fsPrefs(w, r, principal.AccountAccessKey)
	case action == "list" && r.Method == http.MethodGet:
		fsList(w, r, client)
	case action == "transfer" && r.Method == http.MethodPost:
		fsTransfer(w, r, client)
	case action == "mkdir" && r.Method == http.MethodPost:
		fsMkdir(w, r, client)
	case action == "newdoc" && r.Method == http.MethodPost:
		fsNewDoc(w, r, client)
	case action == "purge" && r.Method == http.MethodPost:
		fsPurge(w, r, client)
	case action == "images" && r.Method == http.MethodGet:
		fsImages(w, r, client)
	case action == "search" && r.Method == http.MethodGet:
		fsSearch(w, r, client)
	case action == "info" && r.Method == http.MethodGet:
		fsInfo(w, r, client)
	case action == "save" && r.Method == http.MethodPut:
		fsSave(w, r, client)
	case action == "zip" && r.Method == http.MethodGet:
		fsZip(w, r, client)
	default:
		http.Error(w, "not found", http.StatusNotFound)
	}
}

func fsList(w http.ResponseWriter, r *http.Request, client *minio.Client) {
	ctx := r.Context()
	bucket := r.URL.Query().Get("bucket")
	if bucket == "" {
		bs, err := client.ListBuckets(ctx)
		if err != nil {
			uploadErr(w, err)
			return
		}
		names := make([]string, 0, len(bs))
		for _, b := range bs {
			names = append(names, b.Name)
		}
		sort.Strings(names)
		writeJSON(w, http.StatusOK, map[string][]string{"buckets": names})
		return
	}
	prefix := strings.TrimLeft(r.URL.Query().Get("prefix"), "/")
	if prefix != "" && !strings.HasSuffix(prefix, "/") {
		prefix += "/"
	}
	folders := []string{}
	for o := range client.ListObjects(ctx, bucket, minio.ListObjectsOptions{Prefix: prefix}) {
		if o.Err != nil {
			uploadErr(w, o.Err)
			return
		}
		if strings.HasSuffix(o.Key, "/") && o.Key != prefix {
			folders = append(folders, o.Key)
		}
	}
	sort.Strings(folders)
	writeJSON(w, http.StatusOK, map[string][]string{"folders": folders})
}

func fsExistsExact(ctx context.Context, c *minio.Client, bucket, key string, isDir bool) (bool, error) {
	if !isDir {
		_, err := c.StatObject(ctx, bucket, key, minio.StatObjectOptions{})
		if err == nil {
			return true, nil
		}
		if minio.ToErrorResponse(err).StatusCode == http.StatusNotFound {
			return false, nil
		}
		return false, err
	}
	for o := range c.ListObjects(ctx, bucket, minio.ListObjectsOptions{Prefix: key, MaxKeys: 1}) {
		if o.Err != nil {
			return false, o.Err
		}
		return true, nil
	}
	return false, nil
}

// fsExists coi tên là bị chiếm nếu đã có file HOẶC thư mục cùng tên: ghi file "b/a" khi đang có thư mục "b/a/"
// sẽ làm MinIO xoá mất thư mục đó.
func fsExists(ctx context.Context, c *minio.Client, bucket, key string, isDir bool) (bool, error) {
	base := strings.TrimSuffix(key, "/")
	for _, dir := range []bool{false, true} {
		k := base
		if dir {
			k += "/"
		}
		ok, err := fsExistsExact(ctx, c, bucket, k, dir)
		if err != nil || ok {
			return ok, err
		}
	}
	return false, nil
}

// fsFreeName trả về tên chưa bị chiếm trong thư mục đích: "a.txt" -> "a (1).txt", "dir" -> "dir (1)".
func fsFreeName(ctx context.Context, c *minio.Client, bucket, prefix, name string, isDir bool) (string, error) {
	ext := ""
	base := name
	if !isDir {
		ext = path.Ext(name)
		base = strings.TrimSuffix(name, ext)
	}
	cand := name
	for i := 1; i < 1000; i++ {
		key := prefix + cand
		if isDir {
			key += "/"
		}
		ok, err := fsExists(ctx, c, bucket, key, isDir)
		if err != nil {
			return "", err
		}
		if !ok {
			return cand, nil
		}
		cand = fmt.Sprintf("%s (%d)%s", base, i, ext)
	}
	return "", fmt.Errorf("không tìm được tên trống cho %q", name)
}

func fsCopyOne(ctx context.Context, c *minio.Client, sb, s, db, d string, size int64) error {
	dst := minio.CopyDestOptions{Bucket: db, Object: d}
	src := minio.CopySrcOptions{Bucket: sb, Object: s}
	var err error
	if size > fsCopyLimit {
		_, err = c.ComposeObject(ctx, dst, src)
	} else {
		_, err = c.CopyObject(ctx, dst, src)
	}
	return err
}

func fsTransfer(w http.ResponseWriter, r *http.Request, client *minio.Client) {
	var req fsTransferReq
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20)).Decode(&req) != nil ||
		(req.Op != "copy" && req.Op != "move" && req.Op != "trash" && req.Op != "restore") || req.Bucket == "" || len(req.Items) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detailedMessage": "bad request"})
		return
	}
	if req.DestBucket == "" || req.Op == "trash" || req.Op == "restore" {
		req.DestBucket = req.Bucket
	}
	req.DestPrefix = strings.TrimLeft(req.DestPrefix, "/")
	if req.DestPrefix != "" && !strings.HasSuffix(req.DestPrefix, "/") {
		req.DestPrefix += "/"
	}
	if req.NewName != "" && (len(req.Items) != 1 || strings.Contains(req.NewName, "/")) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detailedMessage": "invalid new name"})
		return
	}
	if req.Conflict == "" {
		req.Conflict = "keep"
	}
	ctx := r.Context()
	sameBucket := req.Bucket == req.DestBucket

	// Lập kế hoạch: mỗi item -> danh sách (nguồn, đích)
	var plan []fsSrc
	var moves []fsMove
	stamp := time.Now().UTC().Format("20060102T150405Z")
	for _, item := range req.Items {
		item = strings.TrimLeft(item, "/")
		if item == "" {
			continue
		}
		isDir := strings.HasSuffix(item, "/")
		name := req.NewName
		if name == "" {
			name = path.Base(strings.TrimSuffix(item, "/"))
		}
		dp := req.DestPrefix
		switch req.Op {
		case "trash":
			if strings.HasPrefix(item, fsTrashPrefix) {
				writeJSON(w, http.StatusBadRequest, map[string]string{"detailedMessage": "mục này đã ở trong thùng rác"})
				return
			}
			dp = fsTrashPrefix + stamp + "/" + fsParent(item)
		case "restore":
			parts := strings.SplitN(item, "/", 3) // ".trash", "<stamp>", "<đường dẫn gốc>"
			if len(parts) < 3 || parts[0]+"/" != fsTrashPrefix || parts[2] == "" {
				writeJSON(w, http.StatusBadRequest, map[string]string{"detailedMessage": "không phải mục trong thùng rác"})
				return
			}
			dp = fsParent(parts[2])
		}
		if isDir && sameBucket && strings.HasPrefix(dp+name+"/", item) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detailedMessage": "không thể chuyển/sao chép thư mục vào chính nó"})
			return
		}
		target := dp + name
		if isDir {
			target += "/"
		}
		if req.Op != "copy" && sameBucket && target == item {
			continue // chuyển về đúng chỗ cũ: không làm gì
		}
		switch req.Conflict {
		case "keep":
			ok, err := fsExists(ctx, client, req.DestBucket, target, isDir)
			if err != nil {
				uploadErr(w, err)
				return
			}
			if ok {
				free, err := fsFreeName(ctx, client, req.DestBucket, dp, name, isDir)
				if err != nil {
					uploadErr(w, err)
					return
				}
				name = free
				target = dp + name
				if isDir {
					target += "/"
				}
			}
		case "fail":
			ok, err := fsExists(ctx, client, req.DestBucket, target, isDir)
			if err != nil {
				uploadErr(w, err)
				return
			}
			if ok {
				writeJSON(w, http.StatusConflict, map[string]string{"detailedMessage": fmt.Sprintf("%q đã tồn tại ở đích", name)})
				return
			}
		}
		moves = append(moves, fsMove{From: item, To: target})
		if !isDir {
			st, err := client.StatObject(ctx, req.Bucket, item, minio.StatObjectOptions{})
			if err != nil {
				uploadErr(w, err)
				return
			}
			plan = append(plan, fsSrc{key: item, dest: target, size: st.Size})
			continue
		}
		found := false
		for o := range client.ListObjects(ctx, req.Bucket, minio.ListObjectsOptions{Prefix: item, Recursive: true}) {
			if o.Err != nil {
				uploadErr(w, o.Err)
				return
			}
			found = true
			plan = append(plan, fsSrc{key: o.Key, dest: target + strings.TrimPrefix(o.Key, item), size: o.Size})
		}
		if !found { // thư mục "ảo" rỗng: tạo dấu thư mục ở đích
			plan = append(plan, fsSrc{key: "", dest: target})
		}
	}

	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	var mu sync.Mutex
	emit := func(l fsLine) {
		mu.Lock()
		defer mu.Unlock()
		_ = json.NewEncoder(w).Encode(l)
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
	}
	// Copy file lớn có thể im lặng hàng phút: gửi nhịp tim để Cloudflare không cắt kết nối (idle ~100s).
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		t := time.NewTicker(15 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				emit(fsLine{HB: true})
			case <-stop:
				return
			}
		}
	}()

	res := fsLine{Result: true}
	for i, p := range plan {
		if ctx.Err() != nil {
			break
		}
		if req.Conflict == "skip" && p.key != "" {
			if ok, _ := fsExistsExact(ctx, client, req.DestBucket, p.dest, false); ok {
				res.Skipped++
				emit(fsLine{Done: i + 1, Total: len(plan)})
				continue
			}
		}
		var err error
		if p.key == "" {
			_, err = client.PutObject(ctx, req.DestBucket, p.dest, strings.NewReader(""), 0, minio.PutObjectOptions{})
		} else {
			err = fsCopyOne(ctx, client, req.Bucket, p.key, req.DestBucket, p.dest, p.size)
			if err == nil && req.Op != "copy" {
				err = client.RemoveObject(ctx, req.Bucket, p.key, minio.RemoveObjectOptions{})
			}
		}
		if err != nil {
			msg := minio.ToErrorResponse(err).Message
			if msg == "" {
				msg = err.Error()
			}
			res.Failed = append(res.Failed, p.key+": "+msg)
		} else {
			res.OK++
		}
		emit(fsLine{Done: i + 1, Total: len(plan)})
	}
	res.Moves = moves
	if res.OK > 0 {
		for _, m := range moves {
			switch req.Op {
			case "copy":
				logActivity(r, req.DestBucket, "copy", m.From, m.To)
			case "move":
				op := "move"
				if req.NewName != "" && fsParent(m.From) == fsParent(m.To) {
					op = "rename"
				}
				logActivity(r, req.Bucket, op, m.From, m.To)
			default:
				logActivity(r, req.Bucket, req.Op, m.From, m.To)
			}
		}
	}
	emit(res)
}

// fsParent: "a/b/c.txt" -> "a/b/", "a/b/" -> "a/", "c.txt" -> "".
func fsParent(key string) string {
	k := strings.TrimSuffix(key, "/")
	i := strings.LastIndex(k, "/")
	if i < 0 {
		return ""
	}
	return k[:i+1]
}
