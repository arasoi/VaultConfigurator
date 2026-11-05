package mesh

import "math"

// fillHoles closes small holes: connected groups of open edges (edges used by
// one triangle) whose extent is at most maxExtent. Some source STLs are missing
// a strip of faces, often next to overlapping faces, so the rim isn't always a
// clean loop (a slicer repairs all that silently); drawn as-is, such a gap
// shows as a see-through slit. Each group gets a fan around its centroid, each
// fan triangle wound to match the triangle on its rim edge. Larger openings
// are left alone.
func fillHoles(m *Mesh, maxExtent float64) *Mesh {
	type dedge struct{ a, b uint32 }
	count := map[[2]uint32]int{}
	owner := map[[2]uint32]dedge{} // directed as in its (only) triangle
	for t := 0; t+2 < len(m.Idx); t += 3 {
		for k := 0; k < 3; k++ {
			a, b := m.Idx[t+k], m.Idx[t+(k+1)%3]
			key := [2]uint32{min(a, b), max(a, b)}
			count[key]++
			owner[key] = dedge{a, b}
		}
	}
	var open []dedge
	for key, n := range count {
		if n == 1 {
			open = append(open, owner[key])
		}
	}
	if len(open) == 0 {
		return m
	}
	// Group open edges into loops (connected through shared vertices).
	parent := map[uint32]uint32{}
	var find func(v uint32) uint32
	find = func(v uint32) uint32 {
		p, ok := parent[v]
		if !ok || p == v {
			parent[v] = v
			return v
		}
		r := find(p)
		parent[v] = r
		return r
	}
	for _, e := range open {
		ra, rb := find(e.a), find(e.b)
		if ra != rb {
			parent[rb] = ra
		}
	}
	groups := map[uint32][]dedge{}
	for _, e := range open {
		r := find(e.a)
		groups[r] = append(groups[r], e)
	}
	out := &Mesh{Pos: m.Pos, Idx: m.Idx}
	copied := false
	p := func(v uint32) [3]float64 {
		return [3]float64{float64(m.Pos[3*v]), float64(m.Pos[3*v+1]), float64(m.Pos[3*v+2])}
	}
	for _, es := range groups {
		if len(es) < 2 {
			continue
		}
		lo := [3]float64{math.Inf(1), math.Inf(1), math.Inf(1)}
		hi := [3]float64{math.Inf(-1), math.Inf(-1), math.Inf(-1)}
		var c [3]float64
		seen := map[uint32]bool{}
		for _, e := range es {
			for _, v := range [2]uint32{e.a, e.b} {
				if seen[v] {
					continue
				}
				seen[v] = true
				q := p(v)
				for k := 0; k < 3; k++ {
					lo[k] = math.Min(lo[k], q[k])
					hi[k] = math.Max(hi[k], q[k])
					c[k] += q[k]
				}
			}
		}
		if math.Sqrt(sq(hi[0]-lo[0])+sq(hi[1]-lo[1])+sq(hi[2]-lo[2])) > maxExtent {
			continue
		}
		n := float64(len(seen))
		ci := uint32(len(out.Pos) / 3)
		if !copied { // never append into the input's backing arrays
			out.Pos = append([]float32(nil), m.Pos...)
			out.Idx = append([]uint32(nil), m.Idx...)
			copied = true
		}
		out.Pos = append(out.Pos, float32(c[0]/n), float32(c[1]/n), float32(c[2]/n))
		for _, e := range es {
			out.Idx = append(out.Idx, e.b, e.a, ci) // reverse of the rim triangle's edge
		}
	}
	return out
}
