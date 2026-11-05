package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"vaultconfigurator/internal/catalog"
	"vaultconfigurator/internal/mesh"
)

// Bin library: Gridfinity bins generated in the browser are saved here as
// STL + settings, in the -bins folder (never in the data folder).

const (
	maxBinSTL    = 64 << 20 // bytes
	maxBinParams = 16 << 10
	maxBinTris   = 2_000_000
)

var errBinsOff = errors.New("saving bins is turned off on this server (start it with -bins <folder>)")

// refreshBins rebuilds the catalog from the last data scan plus the bins folder.
func (s *Server) refreshBins() {
	s.scanMu.Lock()
	defer s.scanMu.Unlock()
	s.publish(s.dataCat)
}

// publish stores data + bins as the current catalog (scanMu held).
func (s *Server) publish(data *catalog.Catalog) {
	s.dataCat = data
	cat := data
	if s.binsDir != "" {
		bins, err := catalog.ScanBins(s.binsDir)
		if err != nil {
			log.Printf("bins folder %s: %v", s.binsDir, err)
		}
		cat = data.WithParts(bins)
	}
	s.cat.Store(cat)
}

func (s *Server) binError(w http.ResponseWriter, code int, err error) {
	http.Error(w, err.Error(), code)
}

// saveBin stores a bin: multipart form with "meta" (JSON: key, name, params)
// and "stl" (the file). Without "stl" it only updates the name/settings of an
// existing bin. Answers with the updated catalog.
func (s *Server) saveBin(w http.ResponseWriter, r *http.Request) {
	if s.binsDir == "" {
		s.binError(w, http.StatusForbidden, errBinsOff)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBinSTL+maxBinParams+1<<20)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		s.binError(w, http.StatusBadRequest, fmt.Errorf("bad upload: %w", err))
		return
	}
	defer r.MultipartForm.RemoveAll()
	var meta catalog.BinMeta
	if err := json.Unmarshal([]byte(r.FormValue("meta")), &meta); err != nil {
		s.binError(w, http.StatusBadRequest, fmt.Errorf("bad bin settings: %w", err))
		return
	}
	if !catalog.BinKey.MatchString(meta.Key) || len(meta.Params) == 0 || len(meta.Params) > maxBinParams || !json.Valid(meta.Params) {
		s.binError(w, http.StatusBadRequest, errors.New("bad bin settings"))
		return
	}
	meta.Name = catalog.CleanBinName(meta.Name)
	if meta.Name == "" {
		meta.Name = "Bin " + meta.Key
	}
	if err := os.MkdirAll(s.binsDir, 0o755); err != nil {
		s.binError(w, http.StatusInternalServerError, err)
		return
	}
	stlPath := filepath.Join(s.binsDir, meta.Key+".stl")
	jsonPath := filepath.Join(s.binsDir, meta.Key+".json")
	meta.Created = time.Now().UTC()
	if old, err := os.ReadFile(jsonPath); err == nil {
		var prev catalog.BinMeta
		if json.Unmarshal(old, &prev) == nil && !prev.Created.IsZero() {
			meta.Created = prev.Created // keep the original date on rename
		}
	}

	f, _, err := r.FormFile("stl")
	switch {
	case errors.Is(err, http.ErrMissingFile):
		if _, err := os.Stat(stlPath); err != nil {
			s.binError(w, http.StatusBadRequest, errors.New("no STL for a new bin"))
			return
		}
	case err != nil:
		s.binError(w, http.StatusBadRequest, err)
		return
	default:
		data, err := io.ReadAll(io.LimitReader(f, maxBinSTL+1))
		f.Close()
		if err != nil || len(data) > maxBinSTL {
			s.binError(w, http.StatusRequestEntityTooLarge, errors.New("STL too large"))
			return
		}
		// Only real meshes go into the library.
		soup, err := mesh.ParseSTL(data)
		if err != nil || soup.Tris() > maxBinTris {
			s.binError(w, http.StatusBadRequest, fmt.Errorf("not a usable STL: %v", err))
			return
		}
		if err := writeAtomic(stlPath, data); err != nil {
			s.binError(w, http.StatusInternalServerError, err)
			return
		}
	}
	b, _ := json.MarshalIndent(meta, "", "  ")
	if err := writeAtomic(jsonPath, b); err != nil {
		s.binError(w, http.StatusInternalServerError, err)
		return
	}
	s.refreshBins()
	s.catalog(w, r)
}

// deleteBin removes a bin from the library.
func (s *Server) deleteBin(w http.ResponseWriter, r *http.Request) {
	if s.binsDir == "" {
		s.binError(w, http.StatusForbidden, errBinsOff)
		return
	}
	key := r.PathValue("key")
	if !catalog.BinKey.MatchString(key) {
		s.binError(w, http.StatusBadRequest, errors.New("bad bin key"))
		return
	}
	for _, ext := range []string{".json", ".stl"} {
		if err := os.Remove(filepath.Join(s.binsDir, key+ext)); err != nil && !errors.Is(err, os.ErrNotExist) {
			s.binError(w, http.StatusInternalServerError, err)
			return
		}
	}
	s.refreshBins()
	s.catalog(w, r)
}

func writeAtomic(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	_, err = tmp.Write(data)
	if err == nil {
		err = tmp.Chmod(0o644) // CreateTemp makes 0600 files
	}
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Rename(tmp.Name(), path)
	}
	if err != nil {
		os.Remove(tmp.Name())
	}
	return err
}
