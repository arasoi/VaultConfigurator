// Package mesh reads STL files and produces small, orientation-normalized
// preview meshes suitable for streaming to a browser.
package mesh

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"strconv"
	"strings"
)

// Soup is a raw triangle list: 9 float32 per triangle (x0,y0,z0, x1,y1,z1, x2,y2,z2).
type Soup []float32

// Tris returns the triangle count.
func (s Soup) Tris() int { return len(s) / 9 }

// ErrFormat is returned for files that are neither binary nor ASCII STL.
var ErrFormat = errors.New("stl: unrecognized format")

// ErrEmpty is returned for STL files without any usable triangle.
var ErrEmpty = errors.New("stl: no triangles")

// ReadSTL loads a binary or ASCII STL file into a triangle soup. The file is
// streamed, so memory use is the soup itself rather than the file plus the
// soup (the largest VAULT files are ~360 MB).
func ReadSTL(path string) (Soup, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil, err
	}
	return readSTL(bufio.NewReaderSize(f, 1<<20), st.Size())
}

// ParseSTL parses STL bytes (binary or ASCII).
func ParseSTL(data []byte) (Soup, error) {
	return readSTL(bufio.NewReader(bytes.NewReader(data)), int64(len(data)))
}

func readSTL(r *bufio.Reader, size int64) (Soup, error) {
	head, _ := r.Peek(int(min(size, 1024)))
	var s Soup
	var err error
	if n, ok := binaryCount(head, size); ok {
		s, err = readBinary(r, n)
	} else if isASCII(head) {
		s, err = parseASCII(r)
	} else {
		return nil, ErrFormat
	}
	if err == nil && len(s) == 0 {
		err = ErrEmpty
	}
	return s, err
}

func isASCII(head []byte) bool {
	return bytes.HasPrefix(bytes.TrimLeft(head, " \t\r\n"), []byte("solid")) && bytes.Contains(head, []byte("facet"))
}

// binaryCount decides whether the data is binary STL and how many triangles to
// read. Exporters get this wrong in several ways, so it is lenient: binary
// files whose header starts with "solid", a wrong triangle count, or trailing
// bytes after the triangles are all accepted.
func binaryCount(head []byte, size int64) (int, bool) {
	if size < 84 || len(head) < 84 {
		return 0, false
	}
	n := int64(binary.LittleEndian.Uint32(head[80:84]))
	switch {
	case 84+n*50 == size:
		return int(n), true
	case isASCII(head):
		return 0, false
	case (size-84)%50 == 0:
		return int((size - 84) / 50), true // count field wrong
	case n > 0 && 84+n*50 < size:
		return int(n), true // trailing bytes
	}
	return 0, false
}

func readBinary(r *bufio.Reader, n int) (Soup, error) {
	if _, err := r.Discard(84); err != nil {
		return nil, err
	}
	out := make(Soup, 0, n*9)
	var rec [50]byte
	var tri [9]float32
	for t := 0; t < n; t++ {
		if _, err := io.ReadFull(r, rec[:]); err != nil {
			if len(out) > 0 && (err == io.EOF || err == io.ErrUnexpectedEOF) {
				break // truncated file: keep what was read
			}
			return nil, err
		}
		ok := true
		for k := 0; k < 9; k++ {
			v := math.Float32frombits(binary.LittleEndian.Uint32(rec[12+k*4:]))
			if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
				ok = false
			}
			tri[k] = v
		}
		if ok {
			out = append(out, tri[:]...)
		}
	}
	return out, nil
}

func parseASCII(r io.Reader) (Soup, error) {
	var out Soup
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 1<<16), 1<<20)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if !strings.HasPrefix(line, "vertex") {
			continue
		}
		f := strings.Fields(line)
		if len(f) != 4 {
			return nil, fmt.Errorf("stl: bad vertex line %q", line)
		}
		for _, s := range f[1:] {
			v, err := strconv.ParseFloat(s, 32)
			if err != nil {
				return nil, fmt.Errorf("stl: bad vertex line %q", line)
			}
			out = append(out, float32(v))
		}
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	out = out[:len(out)/9*9] // drop a trailing incomplete facet
	// Drop facets with non-finite coordinates.
	j := 0
	for i := 0; i < len(out); i += 9 {
		ok := true
		for _, v := range out[i : i+9] {
			if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
				ok = false
			}
		}
		if ok {
			copy(out[j:], out[i:i+9])
			j += 9
		}
	}
	return out[:j], nil
}

// Bounds returns min and max corners of the soup.
func (s Soup) Bounds() (mn, mx [3]float64) {
	mn = [3]float64{math.Inf(1), math.Inf(1), math.Inf(1)}
	mx = [3]float64{math.Inf(-1), math.Inf(-1), math.Inf(-1)}
	for i := 0; i < len(s); i += 3 {
		for k := 0; k < 3; k++ {
			v := float64(s[i+k])
			if v < mn[k] {
				mn[k] = v
			}
			if v > mx[k] {
				mx[k] = v
			}
		}
	}
	return
}
