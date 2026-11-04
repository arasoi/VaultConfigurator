// Package mesh reads STL files and produces small, orientation-normalized
// preview meshes suitable for streaming to a browser.
package mesh

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"
)

// Soup is a raw triangle list: 9 float32 per triangle (x0,y0,z0, x1,y1,z1, x2,y2,z2).
type Soup []float32

// Tris returns the triangle count.
func (s Soup) Tris() int { return len(s) / 9 }

// ReadSTL loads a binary or ASCII STL file into a triangle soup.
func ReadSTL(path string) (Soup, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return ParseSTL(data)
}

// ParseSTL parses STL bytes (binary or ASCII).
func ParseSTL(data []byte) (Soup, error) {
	if len(data) >= 84 {
		n := int(binary.LittleEndian.Uint32(data[80:84]))
		if 84+n*50 == len(data) {
			return parseBinary(data, n), nil
		}
	}
	if bytes.HasPrefix(bytes.TrimLeft(data, " \t\r\n"), []byte("solid")) {
		return parseASCII(data)
	}
	return nil, errors.New("stl: unrecognized format")
}

func parseBinary(data []byte, n int) Soup {
	out := make(Soup, n*9)
	off := 84
	for t := 0; t < n; t++ {
		p := off + 12 // skip normal
		for k := 0; k < 9; k++ {
			out[t*9+k] = math.Float32frombits(binary.LittleEndian.Uint32(data[p+k*4:]))
		}
		off += 50
	}
	return out
}

func parseASCII(data []byte) (Soup, error) {
	var out Soup
	sc := bufio.NewScanner(bytes.NewReader(data))
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
				return nil, err
			}
			out = append(out, float32(v))
		}
	}
	if len(out)%9 != 0 {
		return nil, errors.New("stl: vertex count not a multiple of 3")
	}
	return out, sc.Err()
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
