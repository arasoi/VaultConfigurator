package mesh

import (
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// openEdges counts edges used by exactly one triangle, and by more than two.
func openEdges(m *Mesh) (open, nonManifold int) {
	count := map[[2]uint32]int{}
	for t := 0; t+2 < len(m.Idx); t += 3 {
		for k := 0; k < 3; k++ {
			a, b := m.Idx[t+k], m.Idx[t+(k+1)%3]
			count[[2]uint32{min(a, b), max(a, b)}]++
		}
	}
	for _, n := range count {
		switch {
		case n == 1:
			open++
		case n > 2:
			nonManifold++
		}
	}
	return
}

// TestOpenEdgesReal reports open edges after each preview stage for real files
// (VAULT_FILES="a.stl|b.stl"); skipped otherwise.
func TestOpenEdgesReal(t *testing.T) {
	files := os.Getenv("VAULT_FILES")
	if files == "" {
		t.Skip()
	}
	for _, f := range strings.Split(files, "|") {
		s, err := ReadSTL(f)
		if err != nil {
			t.Fatal(err)
		}
		mn, mx := s.Bounds()
		diag := math.Sqrt(sq(mx[0]-mn[0]) + sq(mx[1]-mn[1]) + sq(mx[2]-mn[2]))
		w := cluster(s, mn, diag*1e-6, false)
		wo, wn := openEdges(w)
		fo, fn := openEdges(fillHoles(w, diag*holeExtent))
		t.Logf("%-32s src=%d weld=%d filled open=%d nm=%d", filepath.Base(f), s.Tris(), w.Tris(), fo, fn)
		if lim := 150000 * clusterFactor; w.Tris() > lim {
			c := clusterTo(s, mn, diag, lim)
			co, cn := openEdges(c)
			t.Logf("   clustered tris=%d open=%d nm=%d", c.Tris(), co, cn)
		}
		holeStats(t, w)
		p := Simplify(s, 150000)
		po, pn := openEdges(p)
		t.Logf("%-32s weld open=%d nm=%d | preview open=%d nm=%d tris=%d", filepath.Base(f), wo, wn, po, pn, p.Tris())
	}
}

func holeStats(t *testing.T, m *Mesh) {
	count := map[[2]uint32]int{}
	dir := map[[2]uint32][2]uint32{}
	for i := 0; i+2 < len(m.Idx); i += 3 {
		for k := 0; k < 3; k++ {
			a, b := m.Idx[i+k], m.Idx[i+(k+1)%3]
			key := [2]uint32{min(a, b), max(a, b)}
			count[key]++
			dir[key] = [2]uint32{a, b}
		}
	}
	bal := map[uint32]int{}
	deg := map[uint32]int{}
	for k, n := range count {
		if n == 1 {
			e := dir[k]
			bal[e[0]]++
			bal[e[1]]--
			deg[e[0]]++
			deg[e[1]]++
		}
	}
	unb, odd := 0, 0
	for v, b := range bal {
		if b != 0 {
			unb++
		}
		if deg[v]%2 != 0 {
			odd++
		}
	}
	t.Logf("   open-edge vertices=%d unbalanced=%d odd-degree=%d", len(bal), unb, odd)
}

// A cube with one face missing gets that hole closed, wound like its rim.
func TestFillHolesClosesMissingFace(t *testing.T) {
	pos := []float32{0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1}
	idx := []uint32{
		0, 2, 1, 0, 3, 2, // bottom
		4, 5, 6, 4, 6, 7, // top
		0, 1, 5, 0, 5, 4, // front
		1, 2, 6, 1, 6, 5, // right
		2, 3, 7, 2, 7, 6, // back
		// left face (3, 0, 4, 7) missing
	}
	m := &Mesh{Pos: pos, Idx: idx}
	if o, _ := openEdges(m); o != 4 {
		t.Fatalf("setup: want 4 open edges, got %d", o)
	}
	f := fillHoles(m, 10)
	if o, n := openEdges(f); o != 0 || n != 0 {
		t.Fatalf("after fill: open=%d non-manifold=%d", o, n)
	}
	if len(m.Idx) != len(idx) {
		t.Fatal("input mesh was modified")
	}
	// Too large to fill: left alone.
	if g := fillHoles(m, 0.5); len(g.Idx) != len(idx) {
		t.Fatal("hole larger than maxExtent was filled")
	}
}
