package server

import (
	"compress/gzip"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"vaultconfigurator/internal/catalog"
	"vaultconfigurator/internal/mesh"
)

// algoVersion is part of the cache key; bump it when preview generation changes.
const algoVersion = "7"

// Levels of detail. Every preview is generated in both at once:
//   - LODFull: up to maxTris triangles, for looking at one part on its own.
//   - LODBuild: a budget that scales with the part's size, for the assembled
//     build where all parts are seen at the same zoom. Triangle density then
//     stays even across parts instead of a 40 mm knob getting as many
//     triangles as a 400 mm module.
const (
	LODFull  = "full"
	LODBuild = "build"
)

const (
	buildRefDiag = 500.0 // mm; parts this big or larger keep the full budget
	buildMinTris = 8000  // floor so small parts stay round
)

// BuildBudget is the build-view triangle budget for a part whose bounding box
// has the given diagonal (mm): proportional to surface area, i.e. diagonal².
func BuildBudget(diag float64, maxTris int) int {
	f := math.Min(1, (diag/buildRefDiag)*(diag/buildRefDiag))
	return min(maxTris, max(buildMinTris, int(float64(maxTris)*f)))
}

// ErrMissing means the part's source file is no longer on disk.
var ErrMissing = errors.New("source file missing")

// Previews generates and caches simplified preview meshes on disk.
type Previews struct {
	dir     string
	maxTris int
	sem     chan struct{}

	mu       sync.Mutex
	inflight map[string]*job
	failed   map[string]error // by cache key: files that can't be read as STL
}

type job struct {
	done chan struct{}
	err  error
}

// NewPreviews creates a preview cache in dir. workers bounds concurrent
// generation (each worker may hold a few hundred MB for the largest files).
func NewPreviews(dir string, maxTris, workers int) (*Previews, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	if workers < 1 {
		workers = 1
	}
	return &Previews{dir: dir, maxTris: maxTris, sem: make(chan struct{}, workers), inflight: map[string]*job{}, failed: map[string]error{}}, nil
}

// key identifies a source file version + generation settings. It changes when
// the file is replaced, so a fixed file is regenerated (and retried).
func (pv *Previews) key(p *catalog.Part) string {
	h := sha1.New()
	fmt.Fprintf(h, "%s|%d|%d|%s|%d", p.Path, p.Bytes, p.ModTime().UnixNano(), algoVersion, pv.maxTris)
	return hex.EncodeToString(h.Sum(nil))[:20]
}

// ETag for a part's preview at a level of detail.
func (pv *Previews) ETag(p *catalog.Part, lod string) string {
	return `"` + pv.key(p) + "-" + lod + `"`
}

func (pv *Previews) path(key, lod string) string {
	if lod == LODBuild {
		return filepath.Join(pv.dir, key+".build.vms.gz")
	}
	return filepath.Join(pv.dir, key+".vms.gz")
}

// Get returns the path of a gzip-compressed preview file, generating it if
// needed. abs is the source file. Errors: ErrMissing if the source is gone,
// otherwise why it couldn't be read (remembered until the file changes).
func (pv *Previews) Get(p *catalog.Part, abs, lod string) (string, error) {
	key := pv.key(p)
	out := pv.path(key, lod)
	if _, err := os.Stat(out); err == nil {
		return out, nil
	}
	if _, err := os.Stat(abs); errors.Is(err, fs.ErrNotExist) {
		return "", ErrMissing
	}
	pv.mu.Lock()
	if err := pv.failed[key]; err != nil {
		pv.mu.Unlock()
		return "", err
	}
	if j, ok := pv.inflight[key]; ok {
		pv.mu.Unlock()
		<-j.done
		return out, j.err
	}
	j := &job{done: make(chan struct{})}
	pv.inflight[key] = j
	pv.mu.Unlock()

	pv.sem <- struct{}{}
	j.err = pv.generate(abs, key)
	<-pv.sem

	pv.mu.Lock()
	delete(pv.inflight, key)
	if j.err != nil && !errors.Is(j.err, fs.ErrNotExist) {
		pv.failed[key] = j.err
	}
	pv.mu.Unlock()
	close(j.done)
	if errors.Is(j.err, fs.ErrNotExist) {
		return "", ErrMissing
	}
	return out, j.err
}

// Cached reports whether both levels of detail of a preview exist.
func (pv *Previews) Cached(p *catalog.Part) bool {
	key := pv.key(p)
	for _, lod := range []string{LODFull, LODBuild} {
		if _, err := os.Stat(pv.path(key, lod)); err != nil {
			return false
		}
	}
	return true
}

func (pv *Previews) generate(abs, key string) (err error) {
	// A malformed file must not take the server down (Warm runs outside any
	// HTTP handler, whose recovery would otherwise catch it).
	defer func() {
		if r := recover(); r != nil {
			log.Printf("preview %s: panic: %v\n%s", abs, r, debug.Stack())
			err = fmt.Errorf("could not process the mesh: %v", r)
		}
	}()
	soup, err := mesh.ReadSTL(abs)
	if err != nil {
		return err
	}
	src := soup.Tris()
	m := mesh.Simplify(soup, pv.maxTris)
	if m.Tris() == 0 {
		return mesh.ErrEmpty
	}
	o := mesh.Normalize(m)
	// The build level is simplified from the source too: decimating the
	// already decimated preview again can stall and distort thin parts
	// (facades lost up to 3 mm of width that way).
	diag := math.Sqrt(o.Size[0]*o.Size[0] + o.Size[1]*o.Size[1] + o.Size[2]*o.Size[2])
	light := m
	if budget := BuildBudget(diag, pv.maxTris); budget < m.Tris() {
		light = mesh.Simplify(soup, budget)
		o.Apply(light) // same frame as the full preview
	}
	soup = nil
	if err := pv.write(pv.path(key, LODBuild), light, o, src); err != nil {
		return err
	}
	return pv.write(pv.path(key, LODFull), m, o, src)
}

func (pv *Previews) write(out string, m *mesh.Mesh, o mesh.Orientation, src int) error {
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

var cacheFile = regexp.MustCompile(`^([0-9a-f]{20})(?:\.build)?\.vms\.gz$`)

// Prune deletes cached previews that no part in the catalog uses any more
// (older algorithm versions, changed or removed files) and stale temp files,
// so the cache doesn't grow with every upgrade.
func (pv *Previews) Prune(cat *catalog.Catalog) {
	keep := map[string]bool{}
	for _, p := range cat.Parts {
		if p.Kind == "stl" {
			keep[pv.key(p)] = true
		}
	}
	entries, err := os.ReadDir(pv.dir)
	if err != nil {
		return
	}
	n := 0
	for _, e := range entries {
		name := e.Name()
		stale := false
		if m := cacheFile.FindStringSubmatch(name); m != nil {
			stale = !keep[m[1]]
		} else if strings.HasPrefix(name, "tmp-") {
			info, err := e.Info()
			stale = err == nil && time.Since(info.ModTime()) > time.Hour
		}
		if stale && os.Remove(filepath.Join(pv.dir, name)) == nil {
			n++
		}
	}
	if n > 0 {
		log.Printf("preview cache: removed %d unused files", n)
	}
}

// Warm generates previews for every STL in the background.
func (pv *Previews) Warm(cat *catalog.Catalog) {
	go func() {
		n := 0
		for _, p := range cat.Parts {
			if p.Kind != "stl" || pv.Cached(p) {
				continue
			}
			if _, err := pv.Get(p, cat.AbsPath(p), LODFull); err != nil {
				log.Printf("warm: %s: %v", p.Path, err)
			}
			n++
			if n%50 == 0 {
				log.Printf("warm: generated %d previews", n)
			}
		}
		log.Printf("warm: done (%d generated)", n)
	}()
}
