package server

import (
	"compress/gzip"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"

	"vaultconfigurator/internal/catalog"
	"vaultconfigurator/internal/mesh"
)

// algoVersion is part of the cache key; bump it when preview generation changes.
const algoVersion = "5"

// Previews generates and caches simplified preview meshes on disk.
type Previews struct {
	cat     *catalog.Catalog
	dir     string
	maxTris int
	sem     chan struct{}

	mu       sync.Mutex
	inflight map[string]*job
}

type job struct {
	done chan struct{}
	err  error
}

// NewPreviews creates a preview cache in dir. workers bounds concurrent
// generation (each worker may hold a few hundred MB for the largest files).
func NewPreviews(cat *catalog.Catalog, dir string, maxTris, workers int) (*Previews, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	if workers < 1 {
		workers = 1
	}
	return &Previews{cat: cat, dir: dir, maxTris: maxTris, sem: make(chan struct{}, workers), inflight: map[string]*job{}}, nil
}

func (pv *Previews) cachePath(p *catalog.Part) string {
	h := sha1.New()
	fmt.Fprintf(h, "%s|%d|%d|%s|%d", p.Path, p.Bytes, p.ModTime().UnixNano(), algoVersion, pv.maxTris)
	return filepath.Join(pv.dir, hex.EncodeToString(h.Sum(nil))[:20]+".vms.gz")
}

// Get returns the path of a gzip-compressed preview file, generating it if needed.
func (pv *Previews) Get(p *catalog.Part) (string, error) {
	out := pv.cachePath(p)
	if _, err := os.Stat(out); err == nil {
		return out, nil
	}
	pv.mu.Lock()
	if j, ok := pv.inflight[out]; ok {
		pv.mu.Unlock()
		<-j.done
		return out, j.err
	}
	j := &job{done: make(chan struct{})}
	pv.inflight[out] = j
	pv.mu.Unlock()

	pv.sem <- struct{}{}
	j.err = pv.generate(p, out)
	<-pv.sem

	pv.mu.Lock()
	delete(pv.inflight, out)
	pv.mu.Unlock()
	close(j.done)
	return out, j.err
}

// Cached reports whether a preview already exists.
func (pv *Previews) Cached(p *catalog.Part) bool {
	_, err := os.Stat(pv.cachePath(p))
	return err == nil
}

func (pv *Previews) generate(p *catalog.Part, out string) error {
	soup, err := mesh.ReadSTL(pv.cat.AbsPath(p))
	if err != nil {
		return fmt.Errorf("%s: %w", p.Path, err)
	}
	src := soup.Tris()
	m := mesh.Simplify(soup, pv.maxTris)
	soup = nil
	o := mesh.Normalize(m)

	tmp, err := os.CreateTemp(pv.dir, "tmp-*")
	if err != nil {
		return err
	}
	zw, _ := gzip.NewWriterLevel(tmp, gzip.BestSpeed)
	err = mesh.Encode(zw, m, o, src)
	if cerr := zw.Close(); err == nil {
		err = cerr
	}
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(tmp.Name())
		return err
	}
	return os.Rename(tmp.Name(), out)
}

// Warm generates previews for every STL in the background.
func (pv *Previews) Warm() {
	go func() {
		n := 0
		for _, p := range pv.cat.Parts {
			if p.Kind != "stl" || pv.Cached(p) {
				continue
			}
			if _, err := pv.Get(p); err != nil {
				log.Printf("warm: %v", err)
			}
			n++
			if n%50 == 0 {
				log.Printf("warm: generated %d previews", n)
			}
		}
		log.Printf("warm: done (%d generated)", n)
	}()
}
