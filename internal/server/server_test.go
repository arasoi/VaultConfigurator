package server

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"testing/fstest"

	"vaultconfigurator/internal/catalog"
)

// tinySTL is a valid one-triangle binary STL.
func tinySTL() []byte {
	var b bytes.Buffer
	b.Write(make([]byte, 80))
	_ = binary.Write(&b, binary.LittleEndian, uint32(1))
	_ = binary.Write(&b, binary.LittleEndian, [12]float32{0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0})
	b.Write([]byte{0, 0})
	return b.Bytes()
}

func testServer(t *testing.T) (*Server, *catalog.Catalog) {
	t.Helper()
	root := t.TempDir()
	for _, rel := range []string{"VAULT/01. DRAWERS/07. Universal/Springs.stl", "VAULT/01. DRAWERS/07. Universal/Latch.stl"} {
		p := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, tinySTL(), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	cat, err := catalog.Scan(root)
	if err != nil {
		t.Fatal(err)
	}
	pv, err := NewPreviews(cat, t.TempDir(), 1000, 1)
	if err != nil {
		t.Fatal(err)
	}
	return &Server{Cat: cat, Previews: pv, Web: fstest.MapFS{"index.html": {Data: []byte("ok")}}}, cat
}

func idOf(cat *catalog.Catalog, name string) string {
	for _, p := range cat.Parts {
		if p.Name == name {
			return p.ID
		}
	}
	return ""
}

func TestZipColorFolders(t *testing.T) {
	s, cat := testServer(t)
	springs, latch := idOf(cat, "Springs"), idOf(cat, "Latch")
	items := springs + "*2~Orange," + springs + "~" + url.QueryEscape("Light Grey") + "," + latch
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest("GET", "/api/zip?name=test&items="+items, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	body, _ := io.ReadAll(rec.Body)
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, f := range zr.File {
		names = append(names, f.Name)
	}
	sort.Strings(names)
	want := []string{
		"test/DRAWERS/Universal/Latch.stl",
		"test/Light Grey/DRAWERS/Universal/Springs.stl",
		"test/Orange/DRAWERS/Universal/Springs (print x2).stl",
	}
	if len(names) != len(want) {
		t.Fatalf("got %v", names)
	}
	for i := range want {
		if names[i] != want[i] {
			t.Errorf("entry %d: got %q want %q", i, names[i], want[i])
		}
	}
}

func TestZipRejectsUnknownAndStaticRevalidates(t *testing.T) {
	s, _ := testServer(t)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest("GET", "/api/zip?items=nope~Orange", nil))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("unknown id: status %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest("GET", "/index.html", nil))
	if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
		t.Errorf("static Cache-Control = %q", got)
	}
}
