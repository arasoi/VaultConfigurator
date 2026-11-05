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

// Simplify reduces a triangle soup to at most maxTris triangles. If the input
// already fits, vertices are just welded. Otherwise it is welded (or, for very
// large inputs, clustered down to clusterFactor × maxTris first) and then
// decimated by quadric edge collapse, which spends the budget where the shape
// needs it: flat areas get a few large triangles, edges and fillets keep theirs.
func Simplify(s Soup, maxTris int) *Mesh {
	mn, mx := s.Bounds()
	diag := math.Sqrt(sq(mx[0]-mn[0]) + sq(mx[1]-mn[1]) + sq(mx[2]-mn[2]))
	if diag == 0 || s.Tris() == 0 {
		return &Mesh{}
	}
	weld := cluster(s, mn, diag*1e-6, false)
	if weld.Tris() <= maxTris {
		return weld
	}
	m := weld
	if limit := maxTris * clusterFactor; m.Tris() > limit {
		weld = nil
		m = clusterTo(s, mn, diag, limit)
	}
	return Decimate(m, maxTris)
}

// clusterFactor: very large inputs are first clustered to this multiple of the
// triangle budget, which keeps decimation fast and its memory bounded.
const clusterFactor = 4

// clusterTo clusters the soup on the finest grid that brings it to at most
// maxTris triangles. Every vertex is snapped to a grid cell and each cell
// becomes one vertex, placed where it best fits the original surfaces through
// the cell (quadric error minimisation, Lindstrom 2000) rather than at the
// average, so flat faces stay flat and edges stay sharp.
func clusterTo(s Soup, mn [3]float64, diag float64, maxTris int) *Mesh {
	// Start at a cell size proportional to the expected surface density and
	// grow until the triangle budget is met.
	cell := diag / 1200
	for i := 0; i < 12; i++ {
		m := cluster(s, mn, cell, true)
		if m.Tris() <= maxTris {
			return m
		}
		// Triangle count scales roughly with 1/cell².
		ratio := math.Sqrt(float64(m.Tris()) / float64(maxTris))
		cell *= math.Max(1.15, ratio*1.05)
	}
	return cluster(s, mn, cell, true)
}

func sq(v float64) float64 { return v * v }

// cluster snaps vertices to a grid of the given cell size. With fit set, each
// cell's vertex is placed by quadric error minimisation; otherwise (welding)
// at the average of its members.
func cluster(s Soup, mn [3]float64, cell float64, fit bool) *Mesh {
	inv := 1 / cell
	cells := make(map[uint64]uint32, s.Tris()/2)
	var sum []float64 // xyz sums per cell
	var cnt []uint32
	var quad []float64 // 10 quadric coefficients per cell (when fitting)
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
				if fit {
					quad = append(quad, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
				}
			}
			sum[id*3] += float64(x)
			sum[id*3+1] += float64(y)
			sum[id*3+2] += float64(z)
			cnt[id]++
			tri[v] = id
		}
		if fit {
			// Every original triangle (collapsed or not) adds its plane,
			// weighted by area, to the cells of its three corners.
			if q, ok := planeQuadric(s[t : t+9]); ok {
				for v := 0; v < 3; v++ {
					c := quad[tri[v]*10 : tri[v]*10+10]
					for k := range q {
						c[k] += q[k]
					}
				}
			}
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
			p := [3]float64{sum[id*3] / c, sum[id*3+1] / c, sum[id*3+2] / c}
			if fit {
				p = fitVertex(quad[id*10:id*10+10], p, cell)
			}
			pos = append(pos, float32(p[0]), float32(p[1]), float32(p[2]))
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

// planeQuadric returns the area-weighted quadric of a triangle's plane as the
// upper triangle of the symmetric 4x4 matrix pp^T, p = (a, b, c, d):
// [a² ab ac ad b² bc bd c² cd d²].
func planeQuadric(t []float32) ([10]float64, bool) {
	ux, uy, uz := float64(t[3]-t[0]), float64(t[4]-t[1]), float64(t[5]-t[2])
	vx, vy, vz := float64(t[6]-t[0]), float64(t[7]-t[1]), float64(t[8]-t[2])
	nx, ny, nz := uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx
	l := math.Sqrt(nx*nx + ny*ny + nz*nz)
	if l == 0 {
		return [10]float64{}, false
	}
	area := l / 2
	a, b, c := nx/l, ny/l, nz/l
	d := -(a*float64(t[0]) + b*float64(t[1]) + c*float64(t[2]))
	return [10]float64{
		area * a * a, area * a * b, area * a * c, area * a * d,
		area * b * b, area * b * c, area * b * d,
		area * c * c, area * c * d,
		area * d * d,
	}, true
}

// fitVertex returns the point minimising the quadric error, solved around the
// cell's mean with small eigenvalues truncated: on a plane it moves the mean
// onto the plane, on an edge onto the edge, in a corner to the corner. Falls
// back to the mean if the fit would leave the cell's neighbourhood.
func fitVertex(q []float64, mean [3]float64, cell float64) [3]float64 {
	A := [3][3]float64{{q[0], q[1], q[2]}, {q[1], q[4], q[5]}, {q[2], q[5], q[7]}}
	b := [3]float64{q[3], q[6], q[8]}
	// Residual of the normal equations A x = -b at the mean.
	var r [3]float64
	for i := 0; i < 3; i++ {
		r[i] = -(A[i][0]*mean[0] + A[i][1]*mean[1] + A[i][2]*mean[2] + b[i])
	}
	w, V := eigenSym3(A)
	wmax := math.Max(w[0], math.Max(w[1], w[2]))
	if wmax <= 0 {
		return mean
	}
	p := mean
	for k := 0; k < 3; k++ {
		if w[k] < wmax*1e-3 {
			continue
		}
		dot := V[0][k]*r[0] + V[1][k]*r[1] + V[2][k]*r[2]
		for i := 0; i < 3; i++ {
			p[i] += V[i][k] * dot / w[k]
		}
	}
	for i := 0; i < 3; i++ {
		if math.Abs(p[i]-mean[i]) > cell*1.5 || math.IsNaN(p[i]) {
			return mean
		}
	}
	return p
}

// eigenSym3 returns the eigenvalues and eigenvectors (columns of V) of a
// symmetric 3x3 matrix by Jacobi rotation.
func eigenSym3(a [3][3]float64) ([3]float64, [3][3]float64) {
	v := [3][3]float64{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}
	for sweep := 0; sweep < 32; sweep++ {
		off := a[0][1]*a[0][1] + a[0][2]*a[0][2] + a[1][2]*a[1][2]
		if off < 1e-30 {
			break
		}
		for p := 0; p < 2; p++ {
			for q := p + 1; q < 3; q++ {
				if math.Abs(a[p][q]) < 1e-300 {
					continue
				}
				theta := (a[q][q] - a[p][p]) / (2 * a[p][q])
				t := math.Copysign(1, theta) / (math.Abs(theta) + math.Sqrt(theta*theta+1))
				c := 1 / math.Sqrt(t*t+1)
				s := t * c
				for k := 0; k < 3; k++ {
					akp, akq := a[k][p], a[k][q]
					a[k][p] = c*akp - s*akq
					a[k][q] = s*akp + c*akq
				}
				for k := 0; k < 3; k++ {
					apk, aqk := a[p][k], a[q][k]
					a[p][k] = c*apk - s*aqk
					a[q][k] = s*apk + c*aqk
				}
				for k := 0; k < 3; k++ {
					vkp, vkq := v[k][p], v[k][q]
					v[k][p] = c*vkp - s*vkq
					v[k][q] = s*vkp + c*vkq
				}
			}
		}
	}
	return [3]float64{a[0][0], a[1][1], a[2][2]}, v
}
