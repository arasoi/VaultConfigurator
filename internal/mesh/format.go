package mesh

import (
	"bytes"
	"encoding/binary"
	"io"
)

// Preview binary layout (little endian), read by web/js/meshformat.js:
//
//	0   [4]byte  magic "VMS1"
//	4   uint32   vertex count
//	8   uint32   triangle count
//	12  uint32   source triangle count
//	16  [3]f32   size (axis-aligned extents, mm)
//	28  [9]f32   rotation applied to source coordinates (row-major)
//	64  [3]f32   source-space center that was moved to the origin
//	76  f32 * 3 * vertexCount  positions
//	..  u32 * 3 * triCount     indices
const Magic = "VMS1"

// Encode writes the preview format.
func Encode(w io.Writer, m *Mesh, o Orientation, srcTris int) error {
	var buf bytes.Buffer
	buf.WriteString(Magic)
	le := binary.LittleEndian
	_ = binary.Write(&buf, le, uint32(len(m.Pos)/3))
	_ = binary.Write(&buf, le, uint32(len(m.Idx)/3))
	_ = binary.Write(&buf, le, uint32(srcTris))
	for _, v := range o.Size {
		_ = binary.Write(&buf, le, float32(v))
	}
	for _, v := range o.Rot {
		_ = binary.Write(&buf, le, float32(v))
	}
	for _, v := range o.Center {
		_ = binary.Write(&buf, le, float32(v))
	}
	if _, err := w.Write(buf.Bytes()); err != nil {
		return err
	}
	if err := binary.Write(w, le, m.Pos); err != nil {
		return err
	}
	return binary.Write(w, le, m.Idx)
}
