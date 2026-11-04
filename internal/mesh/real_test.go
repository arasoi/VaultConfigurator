package mesh

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRealFiles(t *testing.T) {
	files := os.Getenv("VAULT_FILES")
	if files == "" {
		t.Skip()
	}
	for _, f := range strings.Split(files, "|") {
		t0 := time.Now()
		s, err := ReadSTL(f)
		if err != nil {
			t.Fatal(err)
		}
		t1 := time.Now()
		m := Simplify(s, 150000)
		t2 := time.Now()
		o := Normalize(m)
		t3 := time.Now()
		t.Logf("%-40s src=%8d out=%7d size=(%.1f %.1f %.1f) read=%v simp=%v orient=%v", filepath.Base(f), s.Tris(), m.Tris(),
			o.Size[0], o.Size[1], o.Size[2], t1.Sub(t0).Round(time.Millisecond), t2.Sub(t1).Round(time.Millisecond), t3.Sub(t2).Round(time.Millisecond))
	}
}
