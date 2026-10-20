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
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// ViewIO: yêu thích / gần đây lưu theo tài khoản (đồng bộ giữa các máy), thay cho localStorage của từng trình duyệt.
//
//	GET /docview/fs/prefs   -> {"fav":[{bucket,key}],"recent":[{bucket,key,t}]}
//	PUT /docview/fs/prefs   body như trên
//
// Lưu ở $VIEWIO_PREFS_DIR (mặc định $HOME/viewio-prefs); trong compose của ViewIO $HOME là volume nên giữ được qua
// lần tạo lại container. Không ghi được thì trả 503 và giao diện tự quay về localStorage.

type prefRef struct {
	Bucket string `json:"bucket"`
	Key    string `json:"key"`
	T      int64  `json:"t,omitempty"`
}

type prefsDoc struct {
	Fav    []prefRef `json:"fav"`
	Recent []prefRef `json:"recent"`
}

func prefsPath(account string) (string, error) {
	dir := os.Getenv("VIEWIO_PREFS_DIR")
	if dir == "" {
		home := os.Getenv("HOME")
		if home == "" {
			home = os.TempDir()
		}
		dir = filepath.Join(home, "viewio-prefs")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(account))
	return filepath.Join(dir, hex.EncodeToString(sum[:16])+".json"), nil
}

func cleanRefs(in []prefRef, max int) []prefRef {
	out := make([]prefRef, 0, len(in))
	for _, r := range in {
		if r.Bucket == "" || r.Key == "" || len(r.Bucket) > 200 || len(r.Key) > 1024 || strings.ContainsRune(r.Key, 0) {
			continue
		}
		out = append(out, r)
		if len(out) >= max {
			break
		}
	}
	return out
}

func fsPrefs(w http.ResponseWriter, r *http.Request, account string) {
	p, err := prefsPath(account)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"detailedMessage": "không có chỗ lưu tuỳ chọn"})
		return
	}
	switch r.Method {
	case http.MethodGet:
		doc := prefsDoc{Fav: []prefRef{}, Recent: []prefRef{}}
		if b, err := os.ReadFile(p); err == nil {
			_ = json.Unmarshal(b, &doc)
		}
		writeJSON(w, http.StatusOK, doc)
	case http.MethodPut:
		var doc prefsDoc
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&doc) != nil {
			fsBadRequest(w, "bad request")
			return
		}
		doc.Fav = cleanRefs(doc.Fav, 500)
		doc.Recent = cleanRefs(doc.Recent, 30)
		b, _ := json.Marshal(doc)
		tmp := p + ".tmp"
		if err := os.WriteFile(tmp, b, 0o600); err != nil || os.Rename(tmp, p) != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"detailedMessage": "không ghi được tuỳ chọn"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}
