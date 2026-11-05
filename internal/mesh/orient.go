package mesh

import (
	"math"
	"sort"
)

// Orientation describes the normalization applied to a preview mesh.
type Orientation struct {
	Rot    [9]float64 // row-major rotation applied to the source coordinates
	Center [3]float64 // source-space bbox center (after rotation) that was moved to the origin
	Size   [3]float64 // axis-aligned size after rotation
}

// Normalize rotates the mesh so that its tightest bounding box is axis
// aligned, then centers it at the origin.
//
// The CAD exports in the data set are scattered around one big Rhino scene and
// many parts are rotated (roofs are commonly at 45°). We search, for each
// world axis, the rotation around that axis minimizing the box volume, using
// the 2D convex hull of the projected vertices. Two greedy passes handle parts
// that were rotated around more than one axis.
//
// Which axis ends up as width / height / depth is decided later by the client,
// which knows the nominal dimensions of each part role.
func Normalize(m *Mesh) Orientation {
	rot := identity()
	for pass := 0; pass < 2; pass++ {
		best := volume(m.Pos)
		bestAxis, bestAngle := -1, 0.0
		for axis := 0; axis < 3; axis++ {
			angle, vol := bestRotation(m.Pos, axis)
			if vol < best*0.995 {
				best, bestAxis, bestAngle = vol, axis, angle
			}
		}
		if bestAxis < 0 {
			break
		}
		r := axisRotation(bestAxis, bestAngle)
		apply(m.Pos, r)
		rot = mul(r, rot)
	}
	mn, mx := bounds(m.Pos)
	var o Orientation
	o.Rot = rot
	for k := 0; k < 3; k++ {
		o.Center[k] = (mn[k] + mx[k]) / 2
		o.Size[k] = mx[k] - mn[k]
	}
	for i := 0; i < len(m.Pos); i += 3 {
		for k := 0; k < 3; k++ {
			m.Pos[i+k] -= float32(o.Center[k])
		}
	}
	return o
}

// Apply moves another mesh of the same part into this orientation's frame
// (rotated, then centred like the mesh Normalize was given), e.g. a second
// level of detail simplified from the same source.
func (o Orientation) Apply(m *Mesh) {
	apply(m.Pos, o.Rot)
	for i := 0; i < len(m.Pos); i += 3 {
		for k := 0; k < 3; k++ {
			m.Pos[i+k] -= float32(o.Center[k])
		}
	}
}

func identity() [9]float64 { return [9]float64{1, 0, 0, 0, 1, 0, 0, 0, 1} }

func mul(a, b [9]float64) (c [9]float64) {
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			for k := 0; k < 3; k++ {
				c[i*3+j] += a[i*3+k] * b[k*3+j]
			}
		}
	}
	return
}

// axisRotation returns a rotation by angle (radians) around the given axis.
func axisRotation(axis int, a float64) [9]float64 {
	c, s := math.Cos(a), math.Sin(a)
	switch axis {
	case 0:
		return [9]float64{1, 0, 0, 0, c, -s, 0, s, c}
	case 1:
		return [9]float64{c, 0, s, 0, 1, 0, -s, 0, c}
	default:
		return [9]float64{c, -s, 0, s, c, 0, 0, 0, 1}
	}
}

func apply(pos []float32, r [9]float64) {
	for i := 0; i < len(pos); i += 3 {
		x, y, z := float64(pos[i]), float64(pos[i+1]), float64(pos[i+2])
		pos[i] = float32(r[0]*x + r[1]*y + r[2]*z)
		pos[i+1] = float32(r[3]*x + r[4]*y + r[5]*z)
		pos[i+2] = float32(r[6]*x + r[7]*y + r[8]*z)
	}
}

func bounds(pos []float32) (mn, mx [3]float64) {
	mn = [3]float64{math.Inf(1), math.Inf(1), math.Inf(1)}
	mx = [3]float64{math.Inf(-1), math.Inf(-1), math.Inf(-1)}
	for i := 0; i < len(pos); i += 3 {
		for k := 0; k < 3; k++ {
			v := float64(pos[i+k])
			mn[k] = math.Min(mn[k], v)
			mx[k] = math.Max(mx[k], v)
		}
	}
	return
}

func volume(pos []float32) float64 {
	mn, mx := bounds(pos)
	return (mx[0] - mn[0]) * (mx[1] - mn[1]) * (mx[2] - mn[2])
}

// bestRotation finds the angle in [-45°, 45°) around axis that minimizes the
// bounding box volume. Returns the angle and the resulting volume.
func bestRotation(pos []float32, axis int) (float64, float64) {
	u, v := (axis+1)%3, (axis+2)%3
	pts := make([][2]float64, 0, len(pos)/3)
	lo, hi := math.Inf(1), math.Inf(-1)
	for i := 0; i < len(pos); i += 3 {
		pts = append(pts, [2]float64{float64(pos[i+u]), float64(pos[i+v])})
		w := float64(pos[i+axis])
		lo, hi = math.Min(lo, w), math.Max(hi, w)
	}
	hull := convexHull(pts)
	extent := hi - lo
	area := func(a float64) float64 {
		c, s := math.Cos(a), math.Sin(a)
		mnx, mxx, mny, mxy := math.Inf(1), math.Inf(-1), math.Inf(1), math.Inf(-1)
		for _, p := range hull {
			x := c*p[0] - s*p[1]
			y := s*p[0] + c*p[1]
			mnx, mxx = math.Min(mnx, x), math.Max(mxx, x)
			mny, mxy = math.Min(mny, y), math.Max(mxy, y)
		}
		return (mxx - mnx) * (mxy - mny)
	}
	// The optimal box has one side collinear with a hull edge, so test every
	// hull edge angle (folded into [-45°, 45°)) plus zero.
	bestA, bestArea := 0.0, area(0)
	for i := range hull {
		p, q := hull[i], hull[(i+1)%len(hull)]
		a := -math.Atan2(q[1]-p[1], q[0]-p[0])
		a = math.Mod(a, math.Pi/2)
		if a >= math.Pi/4 {
			a -= math.Pi / 2
		} else if a < -math.Pi/4 {
			a += math.Pi / 2
		}
		if ar := area(a); ar < bestArea-1e-9 {
			bestA, bestArea = a, ar
		}
	}
	// Snap tiny angles to zero to avoid needless rotation from noise.
	if math.Abs(bestA) < 0.2*math.Pi/180 {
		bestA, bestArea = 0, area(0)
	}
	// axisRotation rotates (u,v) by the angle in the right-handed sense used above.
	return bestA, bestArea * extent
}

// convexHull returns the hull in counter-clockwise order (Andrew's monotone chain).
func convexHull(p [][2]float64) [][2]float64 {
	if len(p) < 3 {
		return p
	}
	sort.Slice(p, func(i, j int) bool {
		if p[i][0] != p[j][0] {
			return p[i][0] < p[j][0]
		}
		return p[i][1] < p[j][1]
	})
	cross := func(o, a, b [2]float64) float64 {
		return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
	}
	h := make([][2]float64, 0, 2*len(p))
	for _, pt := range p {
		for len(h) >= 2 && cross(h[len(h)-2], h[len(h)-1], pt) <= 0 {
			h = h[:len(h)-1]
		}
		h = append(h, pt)
	}
	t := len(h) + 1
	for i := len(p) - 2; i >= 0; i-- {
		pt := p[i]
		for len(h) >= t && cross(h[len(h)-2], h[len(h)-1], pt) <= 0 {
			h = h[:len(h)-1]
		}
		h = append(h, pt)
	}
	return h[:len(h)-1]
}
