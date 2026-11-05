package server

import (
	"archive/zip"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"testing/fstest"
)

func get(t *testing.T, h http.Handler, path string, hdr ...string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest("GET", path, nil)
	for i := 0; i+1 < len(hdr); i += 2 {
		req.Header.Set(hdr[i], hdr[i+1])
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func catalogJSON(t *testing.T, body []byte) (parts int, data DataStatus) {
	t.Helper()
	var c struct {
		Parts []json.RawMessage `json:"parts"`
		Data  DataStatus        `json:"data"`
	}
	if err := json.Unmarshal(body, &c); err != nil {
		t.Fatalf("catalog JSON: %v (%s)", err, body)
	}
	if c.Parts == nil {
		t.Fatal(`catalog "parts" must be a list, not null`)
	}
	return len(c.Parts), c.Data
}

// A missing data folder must not stop the server: the catalog is empty and
// says why, and a rescan picks the files up once they are there.
func TestMissingDataFolderThenRescan(t *testing.T) {
	root := filepath.Join(t.TempDir(), "Data")
	pv, err := NewPreviews(t.TempDir(), 1000, 1)
	if err != nil {
		t.Fatal(err)
	}
	s := New(root, "", pv, fstest.MapFS{"index.html": {Data: []byte("ok")}})
	h := s.Handler()

	n, data := catalogJSON(t, get(t, h, "/api/catalog").Body.Bytes())
	if n != 0 || data.Found || data.Error == "" || data.Dir != root {
		t.Fatalf("missing folder: parts=%d data=%+v", n, data)
	}

	p := filepath.Join(root, "VAULT", "01. DRAWERS", "07. Universal", "Latch.stl")
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, tinySTL(), 0o644); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("POST", "/api/rescan", nil))
	n, data = catalogJSON(t, rec.Body.Bytes())
	if n != 1 || !data.Found || data.Error != "" {
		t.Fatalf("after rescan: parts=%d data=%+v", n, data)
	}
	if rec := get(t, h, "/api/preview/"+idOf(s.Catalog(), "Latch")); rec.Code != http.StatusOK {
		t.Errorf("preview after rescan: %d %s", rec.Code, rec.Body.String())
	}
}

// Previews explain failures: 404 when the file is gone, 422 when it isn't an
// STL. Other parts keep working.
func TestPreviewFailures(t *testing.T) {
	s, cat, root := testServerAt(t)
	h := s.Handler()
	if err := os.Remove(filepath.Join(root, "VAULT/01. DRAWERS/07. Universal/Springs.stl")); err != nil {
		t.Fatal(err)
	}
	rec := get(t, h, "/api/preview/"+idOf(cat, "Springs"))
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "missing") {
		t.Errorf("deleted file: %d %q", rec.Code, rec.Body.String())
	}
	if err := os.WriteFile(filepath.Join(root, "VAULT/01. DRAWERS/07. Universal/Latch.stl"), []byte("this is not an STL file"), 0o644); err != nil {
		t.Fatal(err)
	}
	for range 2 { // the second answer comes from the remembered failure
		rec = get(t, h, "/api/preview/"+idOf(cat, "Latch"))
		if rec.Code != http.StatusUnprocessableEntity || !strings.Contains(rec.Body.String(), "STL") {
			t.Errorf("corrupt file: %d %q", rec.Code, rec.Body.String())
		}
	}
	if rec := get(t, h, "/api/preview/000000000000"); rec.Code != http.StatusNotFound {
		t.Errorf("unknown id: %d", rec.Code)
	}
}

// Both levels of detail are served, with distinct ETags.
func TestPreviewLevels(t *testing.T) {
	s, cat := testServer(t)
	h := s.Handler()
	id := idOf(cat, "Springs")
	full := get(t, h, "/api/preview/"+id)
	build := get(t, h, "/api/preview/"+id+"?lod=build")
	if full.Code != 200 || build.Code != 200 {
		t.Fatalf("status full=%d build=%d", full.Code, build.Code)
	}
	if full.Header().Get("ETag") == build.Header().Get("ETag") {
		t.Error("levels share an ETag")
	}
	if b := BuildBudget(40, 150000); b != buildMinTris {
		t.Errorf("small part budget %d", b)
	}
	if b := BuildBudget(900, 150000); b != 150000 {
		t.Errorf("large part budget %d", b)
	}
}

// A ZIP with missing or unknown parts still downloads, with the rest of the
// files and a note saying what was left out.
func TestZipWithMissingFiles(t *testing.T) {
	s, cat, root := testServerAt(t)
	if err := os.Remove(filepath.Join(root, "VAULT/01. DRAWERS/07. Universal/Springs.stl")); err != nil {
		t.Fatal(err)
	}
	rec := get(t, s.Handler(), "/api/zip?name=b&items="+idOf(cat, "Springs")+","+idOf(cat, "Latch")+",ffffffffffff")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.Bytes()
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatal(err)
	}
	files := map[string]string{}
	for _, f := range zr.File {
		rc, _ := f.Open()
		b, _ := io.ReadAll(rc)
		rc.Close()
		files[f.Name] = string(b)
	}
	if _, ok := files["b/DRAWERS/Universal/Latch.stl"]; !ok {
		t.Errorf("present file not zipped: %v", files)
	}
	note := files["b/MISSING FILES.txt"]
	if !strings.Contains(note, "Springs.stl") || !strings.Contains(note, "ffffffffffff") {
		t.Errorf("missing-files note: %q", note)
	}
}

// Text responses are gzipped for clients that accept it; embedded front-end
// files (no modification time) revalidate by content hash.
func TestCompressionAndStaticETag(t *testing.T) {
	s, _ := testServer(t)
	h := s.Handler()
	rec := get(t, h, "/api/catalog", "Accept-Encoding", "gzip")
	if rec.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("catalog not gzipped: %v", rec.Header())
	}
	zr, err := gzip.NewReader(rec.Body)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(zr)
	if n, _ := catalogJSON(t, b); n != 2 {
		t.Errorf("parts %d", n)
	}
	if rec := get(t, h, "/api/catalog"); rec.Header().Get("Content-Encoding") != "" {
		t.Error("gzipped without Accept-Encoding")
	}

	rec = get(t, h, "/")
	etag := rec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("no ETag on an embedded file")
	}
	if rec := get(t, h, "/", "If-None-Match", etag); rec.Code != http.StatusNotModified {
		t.Errorf("revalidation: %d", rec.Code)
	}
}

// An unreadable folder is skipped and reported; the rest is still scanned.
func TestUnreadableFolderSkipped(t *testing.T) {
	if runtime.GOOS == "windows" || os.Getuid() == 0 {
		t.Skip("needs POSIX permissions and a non-root user")
	}
	s, _, root := testServerAt(t)
	locked := filepath.Join(root, "VAULT", "locked")
	if err := os.MkdirAll(locked, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(locked, 0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(locked, 0o755) })
	cat := s.Rescan()
	if len(cat.Parts) != 2 || len(cat.Skipped) != 1 || s.Status().Skipped != 1 {
		t.Errorf("parts=%d skipped=%v", len(cat.Parts), cat.Skipped)
	}
}
