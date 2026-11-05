package catalog

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Generated Gridfinity bins live in their own folder, apart from the licensed
// VAULT files: <key>.stl plus <key>.json with the settings they were made
// from. They join the catalog as parts of category "bins", so previews,
// downloads and ZIPs treat them like any other part.

// BinKey is a bin's file name stem (generated from its settings by the front end).
var BinKey = regexp.MustCompile(`^[0-9A-Za-z]{1,64}$`)

// BinMeta is the JSON stored next to a bin's STL. Params is opaque to the
// server: the front end defines and reads it.
type BinMeta struct {
	Key     string          `json:"key"`
	Name    string          `json:"name"`
	Params  json.RawMessage `json:"params"`
	Created time.Time       `json:"created"`
}

var unsafeName = regexp.MustCompile(`[^\p{L}\p{N} _.,()×+\-]+`)

// CleanBinName makes a bin name safe to use as a file name.
func CleanBinName(s string) string {
	s = strings.Join(strings.Fields(unsafeName.ReplaceAllString(s, " ")), " ")
	if r := []rune(s); len(r) > 80 {
		s = strings.TrimSpace(string(r[:80]))
	}
	return s
}

// ScanBins reads the bins folder. A missing folder is simply empty.
func ScanBins(dir string) ([]*Part, error) {
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var parts []*Part
	for _, e := range entries {
		key, ok := strings.CutSuffix(e.Name(), ".json")
		if !ok || !BinKey.MatchString(key) {
			continue
		}
		b, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		var meta BinMeta
		if json.Unmarshal(b, &meta) != nil {
			continue
		}
		stl := filepath.Join(dir, key+".stl")
		info, err := os.Stat(stl)
		if err != nil {
			continue
		}
		name := CleanBinName(meta.Name)
		if name == "" {
			name = "Bin " + key
		}
		raw, _ := json.Marshal(struct {
			Key     string          `json:"key"`
			Params  json.RawMessage `json:"params"`
			Created time.Time       `json:"created"`
		}{key, meta.Params, meta.Created})
		parts = append(parts, &Part{
			ID:       "bin-" + key,
			Path:     "Bins/" + name + ".stl",
			Name:     name,
			Kind:     "stl",
			Category: "bins",
			Group:    "Bins",
			Folders:  []string{"Bins"},
			Bytes:    info.Size(),
			Bin:      raw,
			modTime:  info.ModTime(),
			abs:      stl,
		})
	}
	// Two bins with the same name get their key added so ZIP paths stay unique.
	seen := map[string]int{}
	for _, p := range parts {
		seen[p.Path]++
	}
	for _, p := range parts {
		if seen[p.Path] > 1 {
			key := strings.TrimPrefix(p.ID, "bin-")
			p.Path = fmt.Sprintf("Bins/%s (%s).stl", p.Name, key)
		}
	}
	sort.Slice(parts, func(i, j int) bool { return parts[i].Path < parts[j].Path })
	return parts, nil
}

// WithParts returns a copy of the catalog with extra parts added.
func (c *Catalog) WithParts(extra []*Part) *Catalog {
	out := *c
	out.Parts = append(append([]*Part{}, c.Parts...), extra...)
	out.byID = make(map[string]*Part, len(out.Parts))
	for _, p := range out.Parts {
		out.byID[p.ID] = p
	}
	return &out
}
