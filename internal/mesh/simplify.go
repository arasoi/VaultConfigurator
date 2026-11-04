package mesh

import (
	"math"
)

// Mesh is an indexed triangle mesh.
type Mesh struct {
	Pos []float32 // xyz per vertex
	Idx []uint32  // 3 per triangle
}

// Tris returns the triangle count.
func (m *Mesh) Tris() int { return len(m.Idx) / 3 }

// Simplify reduces a triangle soup to at most maxTris triangles using vertex
// clustering on a uniform grid. Every vertex is snapped to a grid cell; each
// cell becomes one output vertex placed at the average of its members.
// Triangles that collapse or duplicate another are dropped.
//
// Clustering is crude compared to edge-collapse decimation, but it is fast,
// robust on the messy CAD exports in the data set, and memory-friendly on
// multi-million triangle inputs. If the input already fits, vertices are just
// welded.
func Simplify(s Soup, maxTris int) *Mesh {
	mn, mx := s.Bounds()
	diag := math.Sqrt(sq(mx[0]-mn[0]) + sq(mx[1]-mn[1]) + sq(mx[2]-mn[2]))
	if diag == 0 || s.Tris() == 0 {
		return &Mesh{}
	}
	if s.Tris() <= maxTris {
		// Weld only (tiny cell), keep all detail.
		return cluster(s, mn, diag*1e-6)
	}
	// Start at a cell size proportional to the expected surface density and
	// grow until the triangle budget is met.
	cell := diag / 600
	for i := 0; i < 12; i++ {
		m := cluster(s, mn, cell)
		if m.Tris() <= maxTris {
			return m
		}
		// Triangle count scales roughly with 1/cell².
		ratio := math.Sqrt(float64(m.Tris()) / float64(maxTris))
		cell *= math.Max(1.15, ratio*1.05)
	}
	return cluster(s, mn, cell)
}

func sq(v float64) float64 { return v * v }

func cluster(s Soup, mn [3]float64, cell float64) *Mesh {
	inv := 1 / cell
	cells := make(map[uint64]uint32, s.Tris()/2)
	var sum []float64 // xyz sums per cell
	var cnt []uint32
	key := func(x, y, z float32) uint64 {
		ix := uint64(int64((float64(x)-mn[0])*inv+0.5)) & 0x1FFFFF
		iy := uint64(int64((float64(y)-mn[1])*inv+0.5)) & 0x1FFFFF
		iz := uint64(int64((float64(z)-mn[2])*inv+0.5)) & 0x1FFFFF
		return ix | iy<<21 | iz<<42
	}
	idx := make([]uint32, 0, s.Tris()*3/4)
	seen := make(map[[3]uint32]struct{}, s.Tris()/2)
	var tri [3]uint32
	for t := 0; t < len(s); t += 9 {
		for v := 0; v < 3; v++ {
			x, y, z := s[t+v*3], s[t+v*3+1], s[t+v*3+2]
			k := key(x, y, z)
			id, ok := cells[k]
			if !ok {
				id = uint32(len(cnt))
				cells[k] = id
				sum = append(sum, 0, 0, 0)
				cnt = append(cnt, 0)
			}
			sum[id*3] += float64(x)
			sum[id*3+1] += float64(y)
			sum[id*3+2] += float64(z)
			cnt[id]++
			tri[v] = id
		}
		if tri[0] == tri[1] || tri[1] == tri[2] || tri[0] == tri[2] {
			continue
		}
		// Canonical key, independent of winding / rotation, drops duplicates.
		ck := sort3(tri)
		if _, dup := seen[ck]; dup {
			continue
		}
		seen[ck] = struct{}{}
		idx = append(idx, tri[0], tri[1], tri[2])
	}
	// Compact: only keep vertices referenced by triangles.
	remap := make([]int32, len(cnt))
	for i := range remap {
		remap[i] = -1
	}
	pos := make([]float32, 0, len(cnt)*3)
	for i, id := range idx {
		r := remap[id]
		if r < 0 {
			r = int32(len(pos) / 3)
			remap[id] = r
			c := float64(cnt[id])
			pos = append(pos, float32(sum[id*3]/c), float32(sum[id*3+1]/c), float32(sum[id*3+2]/c))
		}
		idx[i] = uint32(r)
	}
	return &Mesh{Pos: pos, Idx: idx}
}

func sort3(t [3]uint32) [3]uint32 {
	a, b, c := t[0], t[1], t[2]
	if a > b {
		a, b = b, a
	}
	if b > c {
		b, c = c, b
	}
	if a > b {
		a, b = b, a
	}
	return [3]uint32{a, b, c}
}
