// Package server exposes the catalog, preview meshes, original files and
// build ZIP downloads over HTTP, and serves the static web front end.
package server

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"vaultconfigurator/internal/catalog"
)

// Server wires HTTP handlers.
type Server struct {
	Cat      *catalog.Catalog
	Previews *Previews
	Web      fs.FS
}

// Handler builds the HTTP mux.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/catalog", s.catalog)
	mux.HandleFunc("GET /api/preview/{id}", s.preview)
	mux.HandleFunc("GET /api/file/{id}", s.file)
	mux.HandleFunc("GET /api/zip", s.zip)
	mux.Handle("GET /", revalidate(http.FileServerFS(s.Web)))
	return logRequests(mux)
}

// revalidate makes browsers check front-end files on every load (cheap 304s via
// Last-Modified) so edits and upgrades show up without a hard refresh.
func revalidate(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		h.ServeHTTP(w, r)
	})
}

func (s *Server) catalog(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")
	_ = json.NewEncoder(w).Encode(s.Cat)
}

func (s *Server) part(w http.ResponseWriter, r *http.Request) (*catalog.Part, bool) {
	p, ok := s.Cat.Get(r.PathValue("id"))
	if !ok {
		http.Error(w, "unknown part", http.StatusNotFound)
	}
	return p, ok
}

func (s *Server) preview(w http.ResponseWriter, r *http.Request) {
	p, ok := s.part(w, r)
	if !ok {
		return
	}
	if p.Kind != "stl" {
		http.Error(w, "not a mesh", http.StatusBadRequest)
		return
	}
	// The cache file name hashes the source file, the algorithm version and the
	// triangle budget, so it doubles as the ETag: browsers revalidate (a cheap
	// 304) and pick up regenerated previews immediately.
	etag := `"` + strings.TrimSuffix(filepath.Base(s.Previews.cachePath(p)), ".vms.gz") + `"`
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "no-cache")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	file, err := s.Previews.Get(p)
	if err != nil {
		log.Printf("preview %s: %v", p.Path, err)
		http.Error(w, "preview failed", http.StatusInternalServerError)
		return
	}
	f, err := os.Open(file)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Encoding", "gzip")
	_, _ = io.Copy(w, f)
}

func (s *Server) file(w http.ResponseWriter, r *http.Request) {
	p, ok := s.part(w, r)
	if !ok {
		return
	}
	f, err := os.Open(s.Cat.AbsPath(p))
	if err != nil {
		http.Error(w, "file missing", http.StatusNotFound)
		return
	}
	defer f.Close()
	name := path.Base(p.Path)
	disp := "inline"
	if p.Kind == "stl" || r.URL.Query().Has("download") {
		disp = "attachment"
	}
	w.Header().Set("Content-Disposition", mime.FormatMediaType(disp, map[string]string{"filename": name}))
	if p.Kind == "stl" {
		w.Header().Set("Content-Type", "model/stl")
	}
	http.ServeContent(w, r, name, p.ModTime(), f)
}

var safeName = regexp.MustCompile(`[^A-Za-z0-9 _.\-]+`)

// zip streams a ZIP of the requested parts:
//
//	/api/zip?name=my-build&items=id,id*3,id*2~Orange,...
//
// "*3" adds a print-quantity hint to the file name; "~Orange" puts the file in
// a folder for that filament color (the same file may appear in several).
func (s *Server) zip(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	name := strings.TrimSpace(safeName.ReplaceAllString(q.Get("name"), ""))
	if name == "" {
		name = "vault-build"
	}
	type item struct {
		p     *catalog.Part
		qty   int
		color string
	}
	var items []item
	seen := map[string]bool{}
	for _, tok := range strings.Split(q.Get("items"), ",") {
		tok, color, _ := strings.Cut(strings.TrimSpace(tok), "~")
		id, qs, _ := strings.Cut(tok, "*")
		color = strings.TrimSpace(safeName.ReplaceAllString(color, ""))
		if id == "" || seen[id+"~"+color] {
			continue
		}
		p, ok := s.Cat.Get(id)
		if !ok {
			http.Error(w, "unknown part "+id, http.StatusBadRequest)
			return
		}
		qty, _ := strconv.Atoi(qs)
		seen[id+"~"+color] = true
		items = append(items, item{p, max(qty, 1), color})
	}
	if len(items) == 0 {
		http.Error(w, "no items", http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name + ".zip"}))
	zw := zip.NewWriter(w)
	defer zw.Close()
	for _, it := range items {
		// Keep the original folder structure (minus the data-set folder) so
		// files with identical names (e.g. pegboard "A.stl") don't collide.
		inner := strings.Join(it.p.Folders, "/")
		base := path.Base(it.p.Path)
		if it.qty > 1 {
			ext := path.Ext(base)
			base = fmt.Sprintf("%s (print x%d)%s", strings.TrimSuffix(base, ext), it.qty, ext)
		}
		hdr := &zip.FileHeader{Name: path.Join(name, it.color, inner, base), Method: zip.Deflate, Modified: it.p.ModTime()}
		fw, err := zw.CreateHeader(hdr)
		if err != nil {
			log.Printf("zip: %v", err)
			return
		}
		f, err := os.Open(s.Cat.AbsPath(it.p))
		if err != nil {
			log.Printf("zip: %v", err)
			return
		}
		_, err = io.Copy(fw, f)
		f.Close()
		if err != nil {
			log.Printf("zip: %v", err)
			return
		}
	}
}

type statusWriter struct {
	http.ResponseWriter
	code int
}

func (w *statusWriter) WriteHeader(c int) { w.code = c; w.ResponseWriter.WriteHeader(c) }

func logRequests(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t := time.Now()
		sw := &statusWriter{ResponseWriter: w, code: 200}
		h.ServeHTTP(sw, r)
		if strings.HasPrefix(r.URL.Path, "/api/") {
			log.Printf("%s %s %d %v", r.Method, r.URL.Path, sw.code, time.Since(t).Round(time.Millisecond))
		}
	})
}
