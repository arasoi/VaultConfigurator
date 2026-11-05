package mesh

import (
	"container/heap"
	"math"
)

// Decimate reduces an indexed mesh to at most maxTris triangles by quadric
// edge collapse (Garland & Heckbert 1997): edges are collapsed cheapest
// first, the cost being the squared distance of the merged vertex to the
// original surfaces around it. Flat areas end up with a few large triangles
// and the budget goes to edges, fillets and small features. Collapses that
// would flip or squash a neighbouring triangle are skipped.
func Decimate(m *Mesh, maxTris int) *Mesh {
	nv := len(m.Pos) / 3
	nt := len(m.Idx) / 3
	if nt <= maxTris || nv == 0 {
		return m
	}
	d := &decimator{
		pos:   make([]float64, nv*3),
		q:     make([][10]float64, nv),
		tris:  make([][3]int32, nt),
		alive: make([]bool, nt),
		vtris: make([][]int32, nv),
		ver:   make([]uint32, nv),
		dead:  make([]bool, nv),
	}
	for i, v := range m.Pos {
		d.pos[i] = float64(v)
	}
	for t := 0; t < nt; t++ {
		tri := [3]int32{int32(m.Idx[3*t]), int32(m.Idx[3*t+1]), int32(m.Idx[3*t+2])}
		d.tris[t] = tri
		d.alive[t] = true
		for _, v := range tri {
			d.vtris[v] = append(d.vtris[v], int32(t))
		}
		if q, ok := d.planeQ(tri); ok {
			for _, v := range tri {
				addQ(&d.q[v], &q)
			}
		}
	}
	d.addBorderQuadrics()
	for t := 0; t < nt; t++ {
		tri := d.tris[t]
		for k := 0; k < 3; k++ {
			a, b := tri[k], tri[(k+1)%3]
			if a < b { // each edge once (from one of its triangles)
				d.push(a, b)
			}
		}
	}
	live := nt
	for live > maxTris && d.h.Len() > 0 {
		c := heap.Pop(&d.h).(cand)
		if d.dead[c.a] || d.dead[c.b] || c.va != d.ver[c.a] || c.vb != d.ver[c.b] {
			continue // stale
		}
		if !d.canCollapse(c.a, c.b, c.p) {
			continue
		}
		live -= d.collapse(c.a, c.b, c.p)
	}
	return d.output()
}

type decimator struct {
	pos   []float64
	q     [][10]float64
	tris  [][3]int32
	alive []bool
	vtris [][]int32
	ver   []uint32
	dead  []bool
	h     candHeap
}

type cand struct {
	cost   float64
	a, b   int32
	va, vb uint32
	p      [3]float64
}

type candHeap []cand

func (h candHeap) Len() int           { return len(h) }
func (h candHeap) Less(i, j int) bool { return h[i].cost < h[j].cost }
func (h candHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *candHeap) Push(x any)        { *h = append(*h, x.(cand)) }
func (h *candHeap) Pop() any {
	old := *h
	c := old[len(old)-1]
	*h = old[:len(old)-1]
	return c
}

func addQ(dst, src *[10]float64) {
	for k := range dst {
		dst[k] += src[k]
	}
}

func (d *decimator) p3(v int32) [3]float64 {
	return [3]float64{d.pos[3*v], d.pos[3*v+1], d.pos[3*v+2]}
}

// planeQ is the area-weighted plane quadric of a triangle (see planeQuadric).
func (d *decimator) planeQ(t [3]int32) ([10]float64, bool) {
	a, b, c := d.p3(t[0]), d.p3(t[1]), d.p3(t[2])
	return planeQuadric([]float32{
		float32(a[0]), float32(a[1]), float32(a[2]),
		float32(b[0]), float32(b[1]), float32(b[2]),
		float32(c[0]), float32(c[1]), float32(c[2]),
	})
}

// addBorderQuadrics pins open borders: for every edge used by one triangle
// only, a plane through the edge perpendicular to the triangle is added
// (heavily weighted), so borders don't shrink.
func (d *decimator) addBorderQuadrics() {
	type edge struct{ a, b int32 }
	count := map[edge]int{}
	owner := map[edge]int32{}
	for t, tri := range d.tris {
		for k := 0; k < 3; k++ {
			a, b := tri[k], tri[(k+1)%3]
			e := edge{min(a, b), max(a, b)}
			count[e]++
			owner[e] = int32(t)
		}
	}
	for e, n := range count {
		if n != 1 {
			continue
		}
		tri := d.tris[owner[e]]
		pa, pb, pc := d.p3(tri[0]), d.p3(tri[1]), d.p3(tri[2])
		fn := cross(sub(pb, pa), sub(pc, pa))
		ea, eb := d.p3(e.a), d.p3(e.b)
		dir := sub(eb, ea)
		n := cross(dir, fn)
		l := math.Sqrt(dot(n, n))
		if l == 0 {
			continue
		}
		n = [3]float64{n[0] / l, n[1] / l, n[2] / l}
		w := 100 * dot(dir, dir)
		dd := -dot(n, ea)
		q := [10]float64{
			w * n[0] * n[0], w * n[0] * n[1], w * n[0] * n[2], w * n[0] * dd,
			w * n[1] * n[1], w * n[1] * n[2], w * n[1] * dd,
			w * n[2] * n[2], w * n[2] * dd,
			w * dd * dd,
		}
		addQ(&d.q[e.a], &q)
		addQ(&d.q[e.b], &q)
	}
}

func qError(q *[10]float64, p [3]float64) float64 {
	x, y, z := p[0], p[1], p[2]
	return q[0]*x*x + 2*q[1]*x*y + 2*q[2]*x*z + 2*q[3]*x +
		q[4]*y*y + 2*q[5]*y*z + 2*q[6]*y +
		q[7]*z*z + 2*q[8]*z + q[9]
}

// push queues the collapse of edge a-b at its best position.
func (d *decimator) push(a, b int32) {
	var q [10]float64
	q = d.q[a]
	addQ(&q, &d.q[b])
	pa, pb := d.p3(a), d.p3(b)
	mid := [3]float64{(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2}
	l := math.Sqrt(dot(sub(pb, pa), sub(pb, pa)))
	best := fitVertex(q[:], mid, l)
	cost := qError(&q, best)
	for _, p := range [][3]float64{pa, pb, mid} {
		if c := qError(&q, p); c < cost {
			best, cost = p, c
		}
	}
	heap.Push(&d.h, cand{cost: math.Max(cost, 0), a: a, b: b, va: d.ver[a], vb: d.ver[b], p: best})
}

// canCollapse rejects collapses that would flip or squash a surviving
// triangle around a or b.
func (d *decimator) canCollapse(a, b int32, p [3]float64) bool {
	// Link condition: a and b may only share the neighbours of the triangles
	// on edge a-b. Otherwise the collapse would pinch the surface into a
	// non-manifold edge or tear a hole next to it.
	shared := 0
	na := map[int32]bool{}
	for _, t := range d.vtris[a] {
		if d.alive[t] {
			for _, w := range d.tris[t] {
				na[w] = true
			}
		}
	}
	common := map[int32]bool{}
	for _, t := range d.vtris[b] {
		if !d.alive[t] {
			continue
		}
		tri := d.tris[t]
		if tri[0] == a || tri[1] == a || tri[2] == a {
			shared++
		}
		for _, w := range tri {
			if w != a && w != b && na[w] {
				common[w] = true
			}
		}
	}
	if shared == 0 || len(common) != shared {
		return false
	}
	for _, v := range [2]int32{a, b} {
		for _, t := range d.vtris[v] {
			if !d.alive[t] {
				continue
			}
			tri := d.tris[t]
			hasA, hasB := false, false
			for _, w := range tri {
				hasA = hasA || w == a
				hasB = hasB || w == b
			}
			if hasA && hasB {
				continue // removed by the collapse
			}
			var before, after [3][3]float64
			for k, w := range tri {
				before[k] = d.p3(w)
				after[k] = before[k]
				if w == v {
					after[k] = p
				}
			}
			n0 := cross(sub(before[1], before[0]), sub(before[2], before[0]))
			n1 := cross(sub(after[1], after[0]), sub(after[2], after[0]))
			l0, l1 := math.Sqrt(dot(n0, n0)), math.Sqrt(dot(n1, n1))
			if l1 == 0 {
				return false
			}
			if l0 > 0 && dot(n0, n1) < 0.2*l0*l1 {
				return false // flips or turns sharply
			}
			// Reject slivers: area tiny relative to the longest edge.
			e := math.Max(dot(sub(after[1], after[0]), sub(after[1], after[0])),
				math.Max(dot(sub(after[2], after[1]), sub(after[2], after[1])), dot(sub(after[0], after[2]), sub(after[0], after[2]))))
			if l1 < 1e-3*e {
				return false
			}
		}
	}
	return true
}

// collapse merges b into a at p and returns how many triangles died.
func (d *decimator) collapse(a, b int32, p [3]float64) int {
	d.pos[3*a], d.pos[3*a+1], d.pos[3*a+2] = p[0], p[1], p[2]
	addQ(&d.q[a], &d.q[b])
	died := 0
	for _, t := range d.vtris[b] {
		if !d.alive[t] {
			continue
		}
		tri := &d.tris[t]
		hasA := tri[0] == a || tri[1] == a || tri[2] == a
		if hasA {
			d.alive[t] = false
			died++
			continue
		}
		for k := range tri {
			if tri[k] == b {
				tri[k] = a
			}
		}
		d.vtris[a] = append(d.vtris[a], t)
	}
	d.dead[b] = true
	d.vtris[b] = nil
	// Drop dead triangles from a's list, then requeue a's edges.
	keep := d.vtris[a][:0]
	for _, t := range d.vtris[a] {
		if d.alive[t] {
			keep = append(keep, t)
		}
	}
	d.vtris[a] = keep
	// Only a moved and changed its quadric: its queued edges go stale (and
	// the ones to b are dead), so requeue a's edges. Edges between other
	// vertices are unaffected.
	d.ver[a]++
	seen := map[int32]bool{}
	for _, t := range d.vtris[a] {
		for _, w := range d.tris[t] {
			if w != a && !seen[w] {
				seen[w] = true
				d.push(a, w)
			}
		}
	}
	return died
}

func (d *decimator) output() *Mesh {
	remap := make([]int32, len(d.dead))
	for i := range remap {
		remap[i] = -1
	}
	out := &Mesh{}
	seen := map[[3]uint32]bool{}
	for t, tri := range d.tris {
		if !d.alive[t] || tri[0] == tri[1] || tri[1] == tri[2] || tri[0] == tri[2] {
			continue
		}
		key := sort3([3]uint32{uint32(tri[0]), uint32(tri[1]), uint32(tri[2])})
		if seen[key] {
			continue
		}
		seen[key] = true
		for _, v := range tri {
			if remap[v] < 0 {
				remap[v] = int32(len(out.Pos) / 3)
				out.Pos = append(out.Pos, float32(d.pos[3*v]), float32(d.pos[3*v+1]), float32(d.pos[3*v+2]))
			}
			out.Idx = append(out.Idx, uint32(remap[v]))
		}
	}
	return out
}

func sub(a, b [3]float64) [3]float64 { return [3]float64{a[0] - b[0], a[1] - b[1], a[2] - b[2]} }
func dot(a, b [3]float64) float64    { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2] }
func cross(a, b [3]float64) [3]float64 {
	return [3]float64{a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]}
}
