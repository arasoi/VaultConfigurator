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
