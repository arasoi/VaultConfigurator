package server

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func binRequest(t *testing.T, meta string, stl []byte) *http.Request {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	_ = mw.WriteField("meta", meta)
	if stl != nil {
		fw, _ := mw.CreateFormFile("stl", "bin.stl")
		fw.Write(stl)
	}
	mw.Close()
	req := httptest.NewRequest("POST", "/api/bins", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return req
}

func do(h http.Handler, req *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

type catalogBin struct {
	ID       string          `json:"id"`
	Name     string          `json:"name"`
	Path     string          `json:"path"`
	Category string          `json:"category"`
	Bin      json.RawMessage `json:"bin"`
}

func bins(t *testing.T, body []byte) []catalogBin {
	t.Helper()
	var c struct {
		Parts []catalogBin `json:"parts"`
	}
	if err := json.Unmarshal(body, &c); err != nil {
		t.Fatal(err)
	}
	var out []catalogBin
	for _, p := range c.Parts {
		if p.Category == "bins" {
			out = append(out, p)
		}
	}
	return out
}

func TestBinLibrary(t *testing.T) {
	s, _ := testServer(t)
	h := s.Handler()
	meta := `{"key":"2x1x6Lc1x1","name":"Screws / small","params":{"w":2,"d":1,"h":6}}`
	rec := do(h, binRequest(t, meta, tinySTL()))
	if rec.Code != http.StatusOK {
		t.Fatalf("save: %d %s", rec.Code, rec.Body.String())
	}
	got := bins(t, rec.Body.Bytes())
	if len(got) != 1 || got[0].ID != "bin-2x1x6Lc1x1" || got[0].Name != "Screws small" || got[0].Path != "Bins/Screws small.stl" || !strings.Contains(string(got[0].Bin), `"w":2`) {
		t.Fatalf("catalog bins: %+v", got)
	}
	// Served like any part: preview, file, ZIP.
	if rec := get(t, h, "/api/preview/bin-2x1x6Lc1x1?lod=build"); rec.Code != 200 {
		t.Errorf("preview: %d %s", rec.Code, rec.Body.String())
	}
	if rec := get(t, h, "/api/zip?name=z&items=bin-2x1x6Lc1x1*3"); rec.Code != 200 || !strings.Contains(rec.Body.String(), "z/Bins/Screws small (print x3).stl") {
		t.Errorf("zip: %d", rec.Code)
	}
	// Rename without re-uploading.
	rec = do(h, binRequest(t, `{"key":"2x1x6Lc1x1","name":"Bits","params":{"w":2,"d":1,"h":6}}`, nil))
	if got := bins(t, rec.Body.Bytes()); rec.Code != 200 || len(got) != 1 || got[0].Name != "Bits" {
		t.Errorf("rename: %d %+v", rec.Code, got)
	}
	// Bad input is refused.
	for name, req := range map[string]*http.Request{
		"bad key":     binRequest(t, `{"key":"../x","name":"x","params":{}}`, tinySTL()),
		"not an STL":  binRequest(t, `{"key":"abc","name":"x","params":{"w":1}}`, []byte("hello")),
		"new, no STL": binRequest(t, `{"key":"abc","name":"x","params":{"w":1}}`, nil),
		"no params":   binRequest(t, `{"key":"abc","name":"x"}`, tinySTL()),
	} {
		if rec := do(h, req); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d %s", name, rec.Code, rec.Body.String())
		}
	}
	// Delete.
	rec = do(h, httptest.NewRequest("DELETE", "/api/bins/2x1x6Lc1x1", nil))
	if rec.Code != 200 || len(bins(t, rec.Body.Bytes())) != 0 {
		t.Errorf("delete: %d", rec.Code)
	}
	if rec := get(t, h, "/api/preview/bin-2x1x6Lc1x1"); rec.Code != http.StatusNotFound {
		t.Errorf("deleted bin still served: %d", rec.Code)
	}
}

func TestBinSavingOff(t *testing.T) {
	root := t.TempDir()
	pv, _ := NewPreviews(t.TempDir(), 1000, 1)
	s := New(root, "", pv, nil)
	rec := do(s.Handler(), binRequest(t, `{"key":"abc","name":"x","params":{"w":1}}`, tinySTL()))
	if rec.Code != http.StatusForbidden {
		t.Errorf("saving off: %d", rec.Code)
	}
}
