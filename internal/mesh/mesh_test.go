package mesh

import (
	"bytes"
	"math"
	"testing"
)

// box returns a unit-cube-ish soup scaled to w,h,d and rotated around z.
func box(w, h, d, angle float64) Soup {
	c := [8][3]float64{}
	for i := 0; i < 8; i++ {
		c[i] = [3]float64{float64(i&1) * w, float64(i>>1&1) * h, float64(i>>2&1) * d}
	}
	faces := [][4]int{{0, 1, 3, 2}, {4, 6, 7, 5}, {0, 4, 5, 1}, {2, 3, 7, 6}, {0, 2, 6, 4}, {1, 5, 7, 3}}
	r := axisRotation(2, angle)
	var s Soup
	put := func(i int) {
		x, y, z := c[i][0], c[i][1], c[i][2]
		s = append(s, float32(r[0]*x+r[1]*y+r[2]*z), float32(r[3]*x+r[4]*y+r[5]*z), float32(r[6]*x+r[7]*y+r[8]*z))
	}
	for _, f := range faces {
		put(f[0])
		put(f[1])
		put(f[2])
		put(f[0])
		put(f[2])
		put(f[3])
	}
	return s
}

func TestNormalizeRotatedBox(t *testing.T) {
	for _, deg := range []float64{0, 10, 33, 45, -20} {
		m := Simplify(box(164.8, 20.7, 230, deg*math.Pi/180), 1000)
		if m.Tris() != 12 {
			t.Fatalf("tris=%d", m.Tris())
		}
		o := Normalize(m)
		got := []float64{o.Size[0], o.Size[1], o.Size[2]}
		// Either w,h or h,w in the plane, depending on fold direction.
		okA := math.Abs(got[0]-164.8) < 0.05 && math.Abs(got[1]-20.7) < 0.05
		okB := math.Abs(got[0]-20.7) < 0.05 && math.Abs(got[1]-164.8) < 0.05
		if !(okA || okB) || math.Abs(got[2]-230) > 0.05 {
			t.Errorf("deg=%v size=%v", deg, got)
		}
	}
}

func TestEncode(t *testing.T) {
	m := Simplify(box(10, 20, 30, 0), 100)
	o := Normalize(m)
	var b bytes.Buffer
	if err := Encode(&b, m, o, 12); err != nil {
		t.Fatal(err)
	}
	if want := 76 + 8*12 + 12*12; b.Len() != want {
		t.Errorf("len=%d want %d", b.Len(), want)
	}
}

// gridBox returns a box whose faces are each split into n×n quads, so
// clustering has many vertices per cell to merge.
func gridBox(w, h, d float64, n int) Soup {
	var s Soup
	face := func(o, u, v [3]float64) {
		p := func(i, j int) [3]float64 {
			a, b := float64(i)/float64(n), float64(j)/float64(n)
			return [3]float64{o[0] + a*u[0] + b*v[0], o[1] + a*u[1] + b*v[1], o[2] + a*u[2] + b*v[2]}
		}
		put := func(q [3]float64) { s = append(s, float32(q[0]), float32(q[1]), float32(q[2])) }
		for i := 0; i < n; i++ {
			for j := 0; j < n; j++ {
				put(p(i, j))
				put(p(i+1, j))
				put(p(i+1, j+1))
				put(p(i, j))
				put(p(i+1, j+1))
				put(p(i, j+1))
			}
		}
	}
	face([3]float64{0, 0, 0}, [3]float64{0, h, 0}, [3]float64{w, 0, 0})
	face([3]float64{0, 0, d}, [3]float64{w, 0, 0}, [3]float64{0, h, 0})
	face([3]float64{0, 0, 0}, [3]float64{w, 0, 0}, [3]float64{0, 0, d})
	face([3]float64{0, h, 0}, [3]float64{0, 0, d}, [3]float64{w, 0, 0})
	face([3]float64{0, 0, 0}, [3]float64{0, 0, d}, [3]float64{0, h, 0})
	face([3]float64{w, 0, 0}, [3]float64{0, h, 0}, [3]float64{0, 0, d})
	return s
}

// Clustering must keep flat faces flat and corners sharp: the simplified box
// keeps its full size and every vertex stays on the box surface.
func TestSimplifyKeepsShape(t *testing.T) {
	const w, h, d = 100.0, 40.0, 70.0
	s := gridBox(w, h, d, 60)
	m := Simplify(s, 2000)
	if m.Tris() > 2000 || m.Tris() < 12 {
		t.Fatalf("tris=%d", m.Tris())
	}
	mn := [3]float64{math.Inf(1), math.Inf(1), math.Inf(1)}
	mx := [3]float64{math.Inf(-1), math.Inf(-1), math.Inf(-1)}
	worst := 0.0
	for i := 0; i < len(m.Pos); i += 3 {
		p := [3]float64{float64(m.Pos[i]), float64(m.Pos[i+1]), float64(m.Pos[i+2])}
		size := [3]float64{w, h, d}
		off := math.Inf(1) // distance to the nearest face plane
		for k := 0; k < 3; k++ {
			mn[k] = math.Min(mn[k], p[k])
			mx[k] = math.Max(mx[k], p[k])
			off = math.Min(off, math.Min(math.Abs(p[k]), math.Abs(p[k]-size[k])))
		}
		worst = math.Max(worst, off)
	}
	for k, want := range []float64{w, h, d} {
		if got := mx[k] - mn[k]; math.Abs(got-want) > 0.01 {
			t.Errorf("axis %d size %.3f, want %.1f", k, got, want)
		}
	}
	if worst > 0.01 {
		t.Errorf("a vertex is %.3f mm off the box surface", worst)
	}
}

// sphere returns a UV sphere soup of radius r.
func sphere(r float64, nu, nv int) Soup {
	pt := func(i, j int) [3]float64 {
		th, ph := 2*math.Pi*float64(i)/float64(nu), math.Pi*float64(j)/float64(nv)
		return [3]float64{r * math.Sin(ph) * math.Cos(th), r * math.Sin(ph) * math.Sin(th), r * math.Cos(ph)}
	}
	var s Soup
	put := func(q [3]float64) { s = append(s, float32(q[0]), float32(q[1]), float32(q[2])) }
	for i := 0; i < nu; i++ {
		for j := 0; j < nv; j++ {
			a, b, c, d := pt(i, j), pt(i+1, j), pt(i+1, j+1), pt(i, j+1)
			if j > 0 {
				put(a)
				put(b)
				put(c)
			}
			if j < nv-1 {
				put(a)
				put(c)
				put(d)
			}
		}
	}
	return s
}

// Decimation keeps curved surfaces close to the original and hits the budget.
func TestDecimateSphere(t *testing.T) {
	const r = 50.0
	s := sphere(r, 240, 120)
	m := Simplify(s, 3000)
	if m.Tris() > 3000 || m.Tris() < 2500 {
		t.Fatalf("tris=%d", m.Tris())
	}
	worst := 0.0
	for i := 0; i < len(m.Pos); i += 3 {
		d := math.Sqrt(sq(float64(m.Pos[i])) + sq(float64(m.Pos[i+1])) + sq(float64(m.Pos[i+2])))
		worst = math.Max(worst, math.Abs(d-r))
	}
	if worst > 0.25 {
		t.Errorf("a vertex is %.3f mm off the sphere", worst)
	}
}
