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
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
)

// ViewIO: các thao tác quản lý file bổ sung (xem docview_fs.go):
//
//	POST /docview/fs/mkdir    {bucket,key}      tạo thư mục (key kết thúc "/") hoặc file trống; 409 nếu đã tồn tại
//	POST /docview/fs/purge    {bucket,items}    xoá vĩnh viễn — CHỈ cho phép mục nằm trong .trash/
//	GET  /docview/fs/search   ?bucket&prefix&q&type&days&limit   tìm đệ quy theo tên file
//	GET  /docview/fs/images   ?bucket&dir      các file ảnh nằm trực tiếp trong thư mục (cho viewer ảnh chuyển trước/sau)
//	GET  /docview/fs/info     ?bucket&key       thuộc tính file / thư mục (đếm file, tổng dung lượng)
//	PUT  /docview/fs/save     ?bucket&key&etag  body = nội dung mới (text); 409 nếu etag không còn khớp (người khác đã sửa)
//	GET  /docview/fs/zip      ?bucket&key=..&key=..&name=       tải nhiều mục/thư mục thành .zip (stream)

type fsReq struct {
	Bucket string   `json:"bucket"`
	Key    string   `json:"key"`
	Items  []string `json:"items"`
}

func fsBadRequest(w http.ResponseWriter, msg string) {
	writeJSON(w, http.StatusBadRequest, map[string]string{"detailedMessage": msg})
}

func fsMkdir(w http.ResponseWriter, r *http.Request, c *minio.Client) {
	var req fsReq
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req) != nil || req.Bucket == "" {
		fsBadRequest(w, "bad request")
		return
	}
	key := strings.TrimLeft(req.Key, "/")
	name := path.Base(strings.TrimSuffix(key, "/"))
	if key == "" || name == "." || name == "/" || strings.Contains(strings.TrimSuffix(key, "/"), "//") {
		fsBadRequest(w, "tên không hợp lệ")
		return
	}
	ctx := r.Context()
	taken, err := fsExists(ctx, c, req.Bucket, key, strings.HasSuffix(key, "/"))
	if err != nil {
		uploadErr(w, err)
		return
	}
	if taken {
		writeJSON(w, http.StatusConflict, map[string]string{"detailedMessage": fmt.Sprintf("%q đã tồn tại", name)})
		return
	}
	ct := mime.TypeByExtension(path.Ext(key))
	if _, err := c.PutObject(ctx, req.Bucket, key, strings.NewReader(""), 0, minio.PutObjectOptions{ContentType: ct}); err != nil {
		uploadErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"key": key})
}

func fsPurge(w http.ResponseWriter, r *http.Request, c *minio.Client) {
	var req fsReq
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20)).Decode(&req) != nil || req.Bucket == "" || len(req.Items) == 0 {
		fsBadRequest(w, "bad request")
		return
	}
	ctx := r.Context()
	deleted, failed := 0, []string{}
	origs := map[string]bool{}
	for _, item := range req.Items {
		item = strings.TrimLeft(item, "/")
		if !strings.HasPrefix(item, fsTrashPrefix) {
			fsBadRequest(w, "chỉ được xoá vĩnh viễn mục trong thùng rác")
			return
		}
		isDir := strings.HasSuffix(item, "/")
		var vers []minio.ObjectInfo
		for o := range c.ListObjects(ctx, req.Bucket, minio.ListObjectsOptions{Prefix: item, Recursive: true, WithVersions: true}) {
			if o.Err != nil {
				uploadErr(w, o.Err)
				return
			}
			if isDir || o.Key == item {
				vers = append(vers, o)
			}
		}
		for _, o := range vers {
			if err := c.RemoveObject(ctx, req.Bucket, o.Key, minio.RemoveObjectOptions{VersionID: o.VersionID}); err != nil {
				failed = append(failed, o.Key+": "+err.Error())
			} else if !o.IsDeleteMarker {
				deleted++
				if parts := strings.SplitN(o.Key, "/", 3); len(parts) == 3 {
					origs[parts[2]] = true
				}
			}
		}
	}
	// Bucket bật versioning: "chuyển vào thùng rác" để lại delete marker + các bản cũ ở tên gốc. Xoá vĩnh viễn thì
	// dọn luôn chúng, nhưng CHỈ khi tên gốc đang ở trạng thái đã xoá (nếu đã có file mới cùng tên thì giữ nguyên).
	for orig := range origs {
		var all []minio.ObjectInfo
		for o := range c.ListObjects(ctx, req.Bucket, minio.ListObjectsOptions{Prefix: orig, Recursive: true, WithVersions: true}) {
			if o.Err == nil && o.Key == orig {
				all = append(all, o)
			}
		}
		if len(all) == 0 {
			continue
		}
		latestDeleted := false
		for _, o := range all {
			if o.IsLatest && o.IsDeleteMarker {
				latestDeleted = true
			}
		}
		if !latestDeleted {
			continue
		}
		for _, o := range all {
			_ = c.RemoveObject(ctx, req.Bucket, o.Key, minio.RemoveObjectOptions{VersionID: o.VersionID})
		}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"deleted": deleted, "failed": failed})
}

var fsTypeExts = map[string][]string{
	"image": {"png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic"},
	"doc":   {"doc", "docx", "pdf", "txt", "md", "rtf", "odt", "html", "drawio"},
	"sheet": {"xls", "xlsx", "csv", "tsv", "ods"},
	"slide": {"ppt", "pptx", "odp", "key"},
	"video": {"mp4", "mov", "mkv", "avi", "webm", "m4v"},
	"audio": {"mp3", "wav", "flac", "m4a", "ogg"},
	"code":  {"go", "py", "js", "ts", "tsx", "json", "yaml", "yml", "sh", "sql", "java", "c", "cpp", "css"},
	"zip":   {"zip", "rar", "7z", "tar", "gz", "tgz"},
}

type fsHit struct {
	Key      string    `json:"key"`
	Size     int64     `json:"size"`
	Modified time.Time `json:"modified"`
}

func fsSearch(w http.ResponseWriter, r *http.Request, c *minio.Client) {
	q := r.URL.Query()
	bucket := q.Get("bucket")
	if bucket == "" {
		fsBadRequest(w, "missing bucket")
		return
	}
	prefix := strings.TrimLeft(q.Get("prefix"), "/")
	needle := strings.ToLower(strings.TrimSpace(q.Get("q")))
	exts := fsTypeExts[q.Get("type")]
	days, _ := strconv.Atoi(q.Get("days"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit <= 0 || limit > 1000 {
		limit = 300
	}
	var since time.Time
	if days > 0 {
		since = time.Now().AddDate(0, 0, -days)
	}
	includeTrash := strings.HasPrefix(prefix, fsTrashPrefix)
	ctx := r.Context()
	hits := []fsHit{}
	truncated := false
	scanned := 0
	for o := range c.ListObjects(ctx, bucket, minio.ListObjectsOptions{Prefix: prefix, Recursive: true}) {
		if o.Err != nil {
			uploadErr(w, o.Err)
			return
		}
		scanned++
		if scanned > 200000 {
			truncated = true
			break
		}
		if strings.HasSuffix(o.Key, "/") || (!includeTrash && strings.HasPrefix(o.Key, fsTrashPrefix)) {
			continue
		}
		base := strings.ToLower(path.Base(o.Key))
		if needle != "" && !strings.Contains(base, needle) {
			continue
		}
		if len(exts) > 0 {
			e := strings.TrimPrefix(path.Ext(base), ".")
			ok := false
			for _, x := range exts {
				if x == e {
					ok = true
					break
				}
			}
			if !ok {
				continue
			}
		}
		if !since.IsZero() && o.LastModified.Before(since) {
			continue
		}
		if len(hits) >= limit {
			truncated = true
			break
		}
		hits = append(hits, fsHit{Key: o.Key, Size: o.Size, Modified: o.LastModified})
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"hits": hits, "truncated": truncated})
}

func fsInfo(w http.ResponseWriter, r *http.Request, c *minio.Client) {
	bucket := r.URL.Query().Get("bucket")
	key := strings.TrimLeft(r.URL.Query().Get("key"), "/")
	if bucket == "" || key == "" {
		fsBadRequest(w, "missing bucket/key")
		return
	}
	ctx := r.Context()
	if !strings.HasSuffix(key, "/") {
		st, err := c.StatObject(ctx, bucket, key, minio.StatObjectOptions{})
		if err != nil {
			uploadErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"dir": false, "key": key, "size": st.Size, "modified": st.LastModified,
			"contentType": st.ContentType, "etag": st.ETag,
		})
		return
	}
	var files, dirs int
	var size int64
	truncated := false
	n := 0
	for o := range c.ListObjects(ctx, bucket, minio.ListObjectsOptions{Prefix: key, Recursive: true}) {
		if o.Err != nil {
			uploadErr(w, o.Err)
			return
		}
		if n++; n > 200000 {
			truncated = true
			break
		}
		if strings.HasSuffix(o.Key, "/") {
			dirs++
		} else {
			files++
			size += o.Size
		}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"dir": true, "key": key, "files": files, "folders": dirs, "size": size, "truncated": truncated,
	})
}

func fsZip(w http.ResponseWriter, r *http.Request, c *minio.Client) {
	q := r.URL.Query()
	bucket := q.Get("bucket")
	keys := q["key"]
	if bucket == "" || len(keys) == 0 {
		fsBadRequest(w, "missing bucket/key")
		return
	}
	name := q.Get("name")
	if name == "" {
		name = path.Base(strings.TrimSuffix(keys[0], "/"))
		if len(keys) > 1 {
			name += "-etc"
		}
	}
	name = strings.NewReplacer("/", "_", "\"", "_", "\\", "_").Replace(name)
	ctx := r.Context()

	type entry struct{ key, rel string }
	var list []entry
	for _, k := range keys {
		k = strings.TrimLeft(k, "/")
		if k == "" {
			continue
		}
		parent := fsParent(k)
		if !strings.HasSuffix(k, "/") {
			list = append(list, entry{k, strings.TrimPrefix(k, parent)})
			continue
		}
		for o := range c.ListObjects(ctx, bucket, minio.ListObjectsOptions{Prefix: k, Recursive: true}) {
			if o.Err != nil {
				uploadErr(w, o.Err)
				return
			}
			list = append(list, entry{o.Key, strings.TrimPrefix(o.Key, parent)})
		}
	}
	if len(list) == 0 {
		fsBadRequest(w, "không có gì để nén")
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+url.PathEscape(name)+".zip")
	w.Header().Set("X-Accel-Buffering", "no")
	zw := zip.NewWriter(w)
	defer zw.Close()
	for _, e := range list {
		if ctx.Err() != nil {
			return
		}
		if strings.HasSuffix(e.key, "/") {
			_, _ = zw.Create(e.rel)
			continue
		}
		obj, err := c.GetObject(ctx, bucket, e.key, minio.GetObjectOptions{})
		if err != nil {
			return
		}
		st, err := obj.Stat()
		if err != nil {
			obj.Close()
			return
		}
		hdr := &zip.FileHeader{Name: e.rel, Method: zip.Deflate, Modified: st.LastModified}
		fw, err := zw.CreateHeader(hdr)
		if err == nil {
			_, err = io.Copy(fw, obj)
		}
		obj.Close()
		if err != nil {
			return
		}
	}
}

const fsMaxSave = 20 << 20 // soạn thảo trong trình duyệt: tối đa 20 MiB

func fsSave(w http.ResponseWriter, r *http.Request, c *minio.Client) {
	q := r.URL.Query()
	bucket, key, etag := q.Get("bucket"), strings.TrimLeft(q.Get("key"), "/"), strings.Trim(q.Get("etag"), "\"")
	if bucket == "" || key == "" || strings.HasSuffix(key, "/") {
		fsBadRequest(w, "missing bucket/key")
		return
	}
	if r.ContentLength < 0 {
		writeJSON(w, http.StatusLengthRequired, map[string]string{"detailedMessage": "missing Content-Length"})
		return
	}
	if r.ContentLength > fsMaxSave {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"detailedMessage": "file quá lớn để sửa trong trình duyệt"})
		return
	}
	ctx := r.Context()
	ct := mime.TypeByExtension(path.Ext(key))
	st, err := c.StatObject(ctx, bucket, key, minio.StatObjectOptions{})
	switch {
	case err == nil:
		if etag != "" && strings.Trim(st.ETag, "\"") != etag {
			writeJSON(w, http.StatusConflict, map[string]string{"detailedMessage": "file đã được người khác sửa sau khi bạn mở"})
			return
		}
		if st.ContentType != "" {
			ct = st.ContentType
		}
	case minio.ToErrorResponse(err).StatusCode == http.StatusNotFound:
		if etag != "" {
			writeJSON(w, http.StatusConflict, map[string]string{"detailedMessage": "file đã bị xoá hoặc đổi tên"})
			return
		}
	default:
		uploadErr(w, err)
		return
	}
	info, err := c.PutObject(ctx, bucket, key, r.Body, r.ContentLength, minio.PutObjectOptions{ContentType: ct})
	if err != nil {
		uploadErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"etag": info.ETag, "versionId": info.VersionID})
}

var fsImageExts = map[string]bool{"png": true, "jpg": true, "jpeg": true, "gif": true, "webp": true, "bmp": true, "svg": true, "avif": true, "ico": true, "apng": true}

// fsImages liệt kê ảnh nằm trực tiếp trong một thư mục (không đệ quy, bỏ qua thùng rác và mục đã xoá).
func fsImages(w http.ResponseWriter, r *http.Request, c *minio.Client) {
	bucket := r.URL.Query().Get("bucket")
	dir := strings.TrimLeft(r.URL.Query().Get("dir"), "/")
	if bucket == "" {
		fsBadRequest(w, "missing bucket")
		return
	}
	if dir != "" && !strings.HasSuffix(dir, "/") {
		dir += "/"
	}
	hits := []fsHit{}
	truncated := false
	for o := range c.ListObjects(r.Context(), bucket, minio.ListObjectsOptions{Prefix: dir}) {
		if o.Err != nil {
			uploadErr(w, o.Err)
			return
		}
		if strings.HasSuffix(o.Key, "/") || !fsImageExts[strings.ToLower(strings.TrimPrefix(path.Ext(o.Key), "."))] {
			continue
		}
		if len(hits) >= 5000 {
			truncated = true
			break
		}
		hits = append(hits, fsHit{Key: o.Key, Size: o.Size, Modified: o.LastModified})
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"images": hits, "truncated": truncated})
}
