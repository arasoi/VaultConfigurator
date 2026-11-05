package mesh

import (
	"bytes"
	"encoding/binary"
	"errors"
	"math"
	"testing"
)

func binarySTL(header string, count uint32, tris [][9]float32, trailing int) []byte {
	var b bytes.Buffer
	h := make([]byte, 80)
	copy(h, header)
	b.Write(h)
	_ = binary.Write(&b, binary.LittleEndian, count)
	for _, t := range tris {
		_ = binary.Write(&b, binary.LittleEndian, [3]float32{0, 0, 1})
		_ = binary.Write(&b, binary.LittleEndian, t)
		b.Write([]byte{0, 0})
	}
	b.Write(make([]byte, trailing))
	return b.Bytes()
}

var tri1 = [9]float32{0, 0, 0, 1, 0, 0, 0, 1, 0}
var tri2 = [9]float32{0, 0, 0, 0, 1, 0, 0, 0, 1}

func TestParseSTLVariants(t *testing.T) {
	nan := float32(math.NaN())
	cases := []struct {
		name string
		data []byte
		tris int
		err  error
	}{
		{"binary", binarySTL("", 2, [][9]float32{tri1, tri2}, 0), 2, nil},
		{"binary with solid header", binarySTL("solid exported by CAD", 2, [][9]float32{tri1, tri2}, 0), 2, nil},
		{"wrong count", binarySTL("", 7, [][9]float32{tri1, tri2}, 0), 2, nil},
		{"trailing bytes", binarySTL("", 2, [][9]float32{tri1, tri2}, 13), 2, nil},
		{"NaN triangle dropped", binarySTL("", 2, [][9]float32{tri1, {nan, 0, 0, 1, 0, 0, 0, 1, 0}}, 0), 1, nil},
		{"zero triangles", binarySTL("", 0, nil, 0), 0, ErrEmpty},
		{"ascii", []byte("solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid x\n"), 1, nil},
		{"garbage", []byte("hello, this is not a mesh at all"), 0, ErrFormat},
		{"empty file", nil, 0, ErrFormat},
	}
	for _, c := range cases {
		s, err := ParseSTL(c.data)
		if !errors.Is(err, c.err) || (err == nil && s.Tris() != c.tris) {
			t.Errorf("%s: tris=%d err=%v, want tris=%d err=%v", c.name, s.Tris(), err, c.tris, c.err)
		}
	}
}

// A second level of detail simplified from the same source lands in the same
// frame as the first after Orientation.Apply.
func TestOrientationApplySameFrame(t *testing.T) {
	src := gridBox(160, 40, 10, 12)
	a := Simplify(src, 100000)
	o := Normalize(a)
	b := Simplify(src, 200)
	o.Apply(b)
	amn, amx := bounds(a.Pos)
	bmn, bmx := bounds(b.Pos)
	for k := 0; k < 3; k++ {
		if math.Abs(amn[k]-bmn[k]) > 0.01 || math.Abs(amx[k]-bmx[k]) > 0.01 {
			t.Fatalf("axis %d: full %v..%v, light %v..%v", k, amn[k], amx[k], bmn[k], bmx[k])
		}
	}
}
