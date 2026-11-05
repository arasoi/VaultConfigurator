// Package server exposes the catalog, preview meshes, original files and
// build ZIP downloads over HTTP, and serves the static web front end.
package server

import (
	"archive/zip"
	"compress/flate"
	"compress/gzip"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
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
	"sync"
	"sync/atomic"
	"time"

	"vaultconfigurator/internal/catalog"
)

// Server wires HTTP handlers.
type Server struct {
	Previews *Previews
	Web      fs.FS

	dataDir string
	binsDir string                          // generated bins ("" = saving off)
	dataCat *catalog.Catalog                // last data folder scan (scanMu)
	cat     atomic.Pointer[catalog.Catalog] // data + bins
	status  atomic.Pointer[DataStatus]
	scanMu  sync.Mutex
	etags   map[string]string // embedded front end: path -> ETag
}

// DataStatus describes the data folder for the front end, so it can explain
// what's wrong instead of showing an empty configurator.
type DataStatus struct {
	Dir     string `json:"dir"`             // absolute path that was scanned
	Found   bool   `json:"found"`           // the folder exists and could be read
	Error   string `json:"error,omitempty"` // why not
	Parts   int    `json:"parts"`           // files found
	Skipped int    `json:"skipped"`         // entries that couldn't be read
	Bins    bool   `json:"bins"`            // bins can be saved (-bins set)
}

// New scans dataDir and returns a server. A missing or unreadable data folder
// is not fatal: the site starts and explains how to set it up, and
// POST /api/rescan picks the files up once they are there. Generated bins are
// saved in binsDir ("" turns saving off).
func New(dataDir, binsDir string, pv *Previews, web fs.FS) *Server {
	s := &Server{Previews: pv, Web: web, dataDir: dataDir, binsDir: binsDir}
	s.etags = staticETags(web)
	s.Rescan()
	return s
}

// Catalog returns the current catalog.
func (s *Server) Catalog() *catalog.Catalog { return s.cat.Load() }

// Status returns the current data folder status.
func (s *Server) Status() DataStatus { return *s.status.Load() }

// Rescan reads the data folder again and swaps in the new catalog.
func (s *Server) Rescan() *catalog.Catalog {
	s.scanMu.Lock()
	defer s.scanMu.Unlock()
	abs, err := filepath.Abs(s.dataDir)
	if err != nil {
		abs = s.dataDir
	}
	st := &DataStatus{Dir: abs, Bins: s.binsDir != ""}
	t := time.Now()
	cat, err := catalog.Scan(s.dataDir)
	switch {
	case err != nil:
		cat = catalog.Empty(abs)
		st.Error = errText(err)
		log.Printf("data folder %s: %v", abs, err)
	case len(cat.Parts) == 0:
		st.Found = true
		st.Error = "the folder has no STL, PDF or image files"
		log.Printf("data folder %s is empty", abs)
	default:
		st.Found = true
		log.Printf("catalog: %d files from %s in %v", len(cat.Parts), cat.Root, time.Since(t).Round(time.Millisecond))
	}
	for _, sk := range cat.Skipped {
		log.Printf("catalog: skipped %s", sk)
	}
	st.Parts, st.Skipped = len(cat.Parts), len(cat.Skipped)
	s.publish(cat)
	s.status.Store(st)
	if s.Previews != nil && st.Error == "" {
		go s.Previews.Prune(s.Catalog())
	}
	return s.Catalog()
}

func errText(err error) string {
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return "the folder doesn't exist"
	case errors.Is(err, fs.ErrPermission):
		return "permission denied"
	}
	return err.Error()
}

// Handler builds the HTTP mux.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /api/catalog", compress(http.HandlerFunc(s.catalog)))
	mux.Handle("POST /api/rescan", compress(http.HandlerFunc(s.rescan)))
	mux.HandleFunc("GET /api/preview/{id}", s.preview)
	mux.HandleFunc("GET /api/file/{id}", s.file)
	mux.HandleFunc("GET /api/zip", s.zip)
	mux.Handle("POST /api/bins", compress(http.HandlerFunc(s.saveBin)))
	mux.Handle("DELETE /api/bins/{key}", compress(http.HandlerFunc(s.deleteBin)))
	mux.Handle("GET /", compress(s.static(http.FileServerFS(s.Web))))
	return logRequests(mux)
}

// static makes browsers check front-end files on every load so edits and
// upgrades show up without a hard refresh. That check is a cheap 304: by
// Last-Modified for a folder (-web), by content hash for the embedded copy,
// whose files carry no modification time.
func (s *Server) static(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if p == "" {
			p = "index.html"
		}
		if tag, ok := s.etags[p]; ok {
			w.Header().Set("ETag", tag)
		}
		h.ServeHTTP(w, r)
	})
}

// staticETags hashes files that have no modification time (an embed.FS).
func staticETags(web fs.FS) map[string]string {
	tags := map[string]string{}
	if web == nil {
		return tags
	}
	_ = fs.WalkDir(web, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if info, err := d.Info(); err != nil || !info.ModTime().IsZero() {
			return nil
		}
		b, err := fs.ReadFile(web, p)
		if err != nil {
			return nil
		}
		sum := sha1.Sum(b)
		tags[p] = `W/"` + hex.EncodeToString(sum[:8]) + `"`
		return nil
	})
	return tags
}

type catalogResponse struct {
	*catalog.Catalog
	Data DataStatus `json:"data"`
}

func (s *Server) catalog(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")
	_ = json.NewEncoder(w).Encode(catalogResponse{s.Catalog(), s.Status()})
}

func (s *Server) rescan(w http.ResponseWriter, r *http.Request) {
	s.Rescan()
	s.catalog(w, r)
}

func (s *Server) part(w http.ResponseWriter, r *http.Request) (*catalog.Part, bool) {
	p, ok := s.Catalog().Get(r.PathValue("id"))
	if !ok {
		http.Error(w, "This part isn't in the data folder (it may have been renamed or removed).", http.StatusNotFound)
	}
	return p, ok
}

// preview serves a part's preview mesh. ?lod=build gets the lighter level of
// detail used in the assembled build. Failures answer with a short plain-text
// reason the viewer shows on the part: 404 when the file is gone, 422 when
// it isn't a usable STL.
func (s *Server) preview(w http.ResponseWriter, r *http.Request) {
	p, ok := s.part(w, r)
	if !ok {
		return
	}
	if p.Kind != "stl" {
		http.Error(w, "not a mesh", http.StatusBadRequest)
		return
	}
	lod := LODFull
	if r.URL.Query().Get("lod") == LODBuild {
		lod = LODBuild
	}
	// The ETag is the cache key (source file version, algorithm version,
	// triangle budget), so browsers revalidate with a cheap 304 and pick up
	// regenerated previews immediately.
	etag := s.Previews.ETag(p, lod)
	w.Header().Set("Cache-Control", "no-cache")
	if r.Header.Get("If-None-Match") == etag {
		w.Header().Set("ETag", etag)
		w.WriteHeader(http.StatusNotModified)
		return
	}
	file, err := s.Previews.Get(p, s.Catalog().AbsPath(p), lod)
	if errors.Is(err, ErrMissing) {
		http.Error(w, "The file is missing from the data folder (moved or deleted since the app started).", http.StatusNotFound)
		return
	}
	if err != nil {
		log.Printf("preview %s: %v", p.Path, err)
		http.Error(w, "The file couldn't be read as an STL: "+err.Error(), http.StatusUnprocessableEntity)
		return
	}
	f, err := os.Open(file)
	if err != nil {
		http.Error(w, "preview cache: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer f.Close()
	w.Header().Set("ETag", etag)
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Encoding", "gzip")
	_, _ = io.Copy(w, f)
}

func (s *Server) file(w http.ResponseWriter, r *http.Request) {
	p, ok := s.part(w, r)
	if !ok {
		return
	}
	f, err := os.Open(s.Catalog().AbsPath(p))
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
// Parts that are unknown or missing on disk don't fail the download: the rest
// are zipped and "MISSING FILES.txt" lists what was left out and why.
func (s *Server) zip(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	name := strings.TrimSpace(safeName.ReplaceAllString(q.Get("name"), ""))
	if name == "" {
		name = "vault-build"
	}
	cat := s.Catalog()
	type item struct {
		p     *catalog.Part
		qty   int
		color string
	}
	var items []item
	var missing []string
	seen := map[string]bool{}
	for _, tok := range strings.Split(q.Get("items"), ",") {
		tok, color, _ := strings.Cut(strings.TrimSpace(tok), "~")
		id, qs, _ := strings.Cut(tok, "*")
		color = strings.TrimSpace(safeName.ReplaceAllString(color, ""))
		if id == "" || seen[id+"~"+color] {
			continue
		}
		seen[id+"~"+color] = true
		p, ok := cat.Get(id)
		if !ok {
			missing = append(missing, fmt.Sprintf("part %s: not in the data folder (renamed or removed?)", id))
			continue
		}
		if _, err := os.Stat(cat.AbsPath(p)); err != nil {
			missing = append(missing, fmt.Sprintf("%s: %s", p.Path, errText(err)))
			continue
		}
		qty, _ := strconv.Atoi(qs)
		items = append(items, item{p, max(qty, 1), color})
	}
	if len(items) == 0 && len(missing) == 0 {
		http.Error(w, "no items", http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name + ".zip"}))
	zw := zip.NewWriter(w)
	// STLs are big; the fastest deflate level is several times quicker than
	// the default and the files come out only slightly larger.
	zw.RegisterCompressor(zip.Deflate, func(out io.Writer) (io.WriteCloser, error) {
		return flate.NewWriter(out, flate.BestSpeed)
	})
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
		f, err := os.Open(cat.AbsPath(it.p))
		if err != nil {
			missing = append(missing, fmt.Sprintf("%s: %s", it.p.Path, errText(err)))
			continue
		}
		hdr := &zip.FileHeader{Name: path.Join(name, it.color, inner, base), Method: zip.Deflate, Modified: it.p.ModTime()}
		fw, err := zw.CreateHeader(hdr)
		if err == nil {
			_, err = io.Copy(fw, f)
		}
		f.Close()
		if err != nil {
			// Most likely the browser cancelled the download; nothing more
			// can be sent either way.
			log.Printf("zip: %v", err)
			return
		}
	}
	if len(missing) > 0 {
		fw, err := zw.Create(path.Join(name, "MISSING FILES.txt"))
		if err != nil {
			return
		}
		fmt.Fprintf(fw, "These files are part of the build but couldn't be included:\r\n\r\n")
		for _, m := range missing {
			fmt.Fprintf(fw, "  %s\r\n", m)
		}
		fmt.Fprintf(fw, "\r\nCheck the data folder (%s), then reload the configurator and download again.\r\n", s.Status().Dir)
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

// compress gzips text responses (front end, catalog JSON) for clients that
// accept it. Responses that are already encoded or not text pass through.
func compress(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") || r.Header.Get("Range") != "" {
			h.ServeHTTP(w, r)
			return
		}
		w.Header().Add("Vary", "Accept-Encoding")
		gw := &gzipWriter{ResponseWriter: w}
		defer gw.close()
		h.ServeHTTP(gw, r)
	})
}

var gzipPool = sync.Pool{New: func() any { w, _ := gzip.NewWriterLevel(io.Discard, gzip.DefaultCompression); return w }}

type gzipWriter struct {
	http.ResponseWriter
	gz      *gzip.Writer
	decided bool
}

func compressible(ct string) bool {
	ct, _, _ = strings.Cut(ct, ";")
	switch strings.TrimSpace(ct) {
	case "text/html", "text/css", "text/javascript", "application/javascript", "application/json", "image/svg+xml", "text/plain", "application/wasm":
		return true
	}
	return false
}

func (g *gzipWriter) WriteHeader(code int) {
	if !g.decided {
		g.decided = true
		hd := g.Header()
		if code == http.StatusOK && hd.Get("Content-Encoding") == "" && compressible(hd.Get("Content-Type")) {
			hd.Set("Content-Encoding", "gzip")
			hd.Del("Content-Length")
			g.gz = gzipPool.Get().(*gzip.Writer)
			g.gz.Reset(g.ResponseWriter)
		}
	}
	g.ResponseWriter.WriteHeader(code)
}

func (g *gzipWriter) Write(b []byte) (int, error) {
	if !g.decided {
		if g.Header().Get("Content-Type") == "" {
			g.Header().Set("Content-Type", http.DetectContentType(b))
		}
		g.WriteHeader(http.StatusOK)
	}
	if g.gz != nil {
		return g.gz.Write(b)
	}
	return g.ResponseWriter.Write(b)
}

func (g *gzipWriter) close() {
	if g.gz != nil {
		_ = g.gz.Close()
		g.gz.Reset(io.Discard)
		gzipPool.Put(g.gz)
	}
}
