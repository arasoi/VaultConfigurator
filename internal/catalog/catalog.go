// Package catalog scans the VAULT data folder and turns the file tree into a
// structured list of parts (STL files) and documents, tagging each part with
// the size / depth / height / variant information encoded in its path.
package catalog

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Part is one file in the data folder.
type Part struct {
	ID       string   `json:"id"`
	Path     string   `json:"path"`              // relative to the data root, forward slashes
	Name     string   `json:"name"`              // file name without extension, cleaned
	Kind     string   `json:"kind"`              // stl | pdf | image | text
	Category string   `json:"category"`          // drawers | sustainers | modifications | pegboard | documentation | other
	Group    string   `json:"group,omitempty"`   // e.g. Modules, Roofs, Boxes, Facades, Baseplates, Universal
	Folders  []string `json:"folders"`           // cleaned folder chain (numeric prefixes removed)
	Sizes    []string `json:"sizes,omitempty"`   // S, M, L, XL, L2, XL2 (several for shared parts like "S-M Rods")
	Depth    int      `json:"depth,omitempty"`   // 3..7 (gridfinity units)
	Heights  []int    `json:"heights,omitempty"` // 1, 2, 4 (F units)
	Variant  string   `json:"variant,omitempty"` // grid, table, bowl, heavyweight, flat, sealed, dividers, ...
	Piece    string   `json:"piece,omitempty"`   // whole | 1 | 2 for split prints
	Bytes    int64    `json:"bytes"`
	// Bin: settings of a generated Gridfinity bin (category "bins"), for the front end.
	Bin json.RawMessage `json:"bin,omitempty"`

	modTime time.Time
	abs     string // file outside the data folder (generated bins)
}

// ModTime returns the file modification time (used for cache keys).
func (p *Part) ModTime() time.Time { return p.modTime }

// Catalog is the full scanned data set.
type Catalog struct {
	Root    string           `json:"-"`
	Parts   []*Part          `json:"parts"`
	Scanned time.Time        `json:"scanned"`
	Skipped []string         `json:"skipped,omitempty"` // entries that couldn't be read (permissions, broken links)
	byID    map[string]*Part `json:"-"`
}

// Empty returns a catalog without parts (used when the data folder is missing).
func Empty(root string) *Catalog {
	return &Catalog{Root: root, Parts: []*Part{}, Scanned: time.Now(), byID: map[string]*Part{}}
}

// Get looks up a part by ID.
func (c *Catalog) Get(id string) (*Part, bool) {
	p, ok := c.byID[id]
	return p, ok
}

// AbsPath returns the absolute file system path for a part.
func (c *Catalog) AbsPath(p *Part) string {
	if p.abs != "" {
		return p.abs
	}
	return filepath.Join(c.Root, filepath.FromSlash(p.Path))
}

var kindByExt = map[string]string{
	".stl": "stl", ".pdf": "pdf", ".png": "image", ".jpg": "image", ".jpeg": "image", ".txt": "text",
}

// Scan walks root and builds a catalog. Hidden files (.DS_Store etc.) are skipped.
func Scan(root string) (*Catalog, error) {
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if real, err := filepath.EvalSymlinks(root); err == nil {
		root = real
	}
	c := Empty(root)
	// Walk through os.DirFS so the data folder itself may be a symlink or a
	// Windows junction (e.g. to a NAS or another drive): DirFS opens the root by
	// following it, where filepath.WalkDir would treat a linked root as a file.
	// Links inside the folder are still not followed.
	err = fs.WalkDir(os.DirFS(root), ".", func(rel string, d fs.DirEntry, err error) error {
		if err != nil {
			if rel == "." {
				return err // the data folder itself can't be read
			}
			// One unreadable folder or file shouldn't hide the rest.
			c.Skipped = append(c.Skipped, rel+": "+errReason(err))
			if d != nil && d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if strings.HasPrefix(d.Name(), ".") {
			if d.IsDir() && rel != "." {
				return fs.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return nil
		}
		kind, ok := kindByExt[strings.ToLower(path.Ext(rel))]
		if !ok {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			c.Skipped = append(c.Skipped, rel+": "+errReason(err))
			return nil
		}
		part := Classify(rel)
		part.Kind = kind
		part.Bytes = info.Size()
		part.modTime = info.ModTime()
		c.Parts = append(c.Parts, part)
		c.byID[part.ID] = part
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(c.Parts, func(i, j int) bool { return c.Parts[i].Path < c.Parts[j].Path })
	return c, nil
}

// errReason is the short reason of a file system error, without the path.
func errReason(err error) string {
	var pe *fs.PathError
	if errors.As(err, &pe) {
		return pe.Err.Error()
	}
	return err.Error()
}

// MakeID derives a short stable ID from a relative path.
func MakeID(rel string) string {
	h := sha1.Sum([]byte(rel))
	return hex.EncodeToString(h[:6])
}

var (
	// "01. DRAWERS", "2_Depth_50mm" — but not "34.5MM TALL".
	numPrefix   = regexp.MustCompile(`^\d+(?:\.\s+|_)`)
	sizeDepth   = regexp.MustCompile(`^(XL|L|M|S)([3-7])(²)?(?:[^0-9Ff]|$)`)
	sizeOnly    = regexp.MustCompile(`^(XL|L|M|S)(?:-(XL|L|M|S))?(?:\s|-?[124]F|$)`)
	runnerDepth = regexp.MustCompile(`(?i)^x([3-7])\b`)
	heightRange = regexp.MustCompile(`(?i)\b([124])-([124])F\b`)
	heightOne   = regexp.MustCompile(`(?i)(?:^|[\s\-SMLX])([124])F\b`)
	pieceRe     = regexp.MustCompile(`(?i)\bpart\s*([12])\b`)
	spaces      = regexp.MustCompile(`\s+`)
)

// CleanFolder strips ordering prefixes like "01. " from a folder name.
func CleanFolder(s string) string {
	return strings.TrimSpace(numPrefix.ReplaceAllString(s, ""))
}

// Classify derives all tags for a relative path. It does not touch the file system.
func Classify(rel string) *Part {
	dir, file := path.Split(rel)
	name := strings.TrimSuffix(file, path.Ext(file))
	name = strings.TrimSpace(spaces.ReplaceAllString(name, " "))
	p := &Part{ID: MakeID(rel), Path: rel, Name: name, Folders: []string{}}

	for _, f := range strings.Split(strings.Trim(dir, "/"), "/") {
		if f == "" {
			continue
		}
		p.Folders = append(p.Folders, CleanFolder(f))
	}
	// The first folder is the data-set name (e.g. VAULT_USSA) when the root
	// points one level up; skip anything before the numbered category folder.
	cat := ""
	start := 0
	for i, f := range p.Folders {
		if c := categoryOf(f); c != "" {
			cat, start = c, i
			break
		}
	}
	if cat == "" {
		cat = "other"
	} else {
		p.Folders = p.Folders[start:]
	}
	p.Category = cat
	if len(p.Folders) > 1 {
		p.Group = groupOf(p.Folders[1:])
	}
	if p.Group == "" {
		ln := strings.ToLower(name)
		switch {
		case strings.Contains(ln, "module"):
			p.Group = "Modules"
		case strings.Contains(ln, "facade"):
			p.Group = "Facades"
		}
	}

	n := strings.ReplaceAll(name, "'", "")

	// Size + depth from the file name, e.g. "S3 Box 1F", "L3² Module 2F", "XL7 Base Whole".
	if m := sizeDepth.FindStringSubmatch(n); m != nil {
		sz := m[1]
		if m[3] != "" {
			sz += "2"
		}
		p.Sizes = []string{sz}
		p.Depth, _ = strconv.Atoi(m[2])
	} else if m := sizeOnly.FindStringSubmatch(n); m != nil {
		p.Sizes = expandSizes(m[1], m[2])
	}
	// Folder context: "S Families", "L² Families", "Base/L", "Baseplates/S", "S3".
	if len(p.Sizes) == 0 || p.Depth == 0 {
		for _, f := range p.Folders {
			if m := sizeDepth.FindStringSubmatch(f + " "); m != nil && p.Depth == 0 {
				p.Depth, _ = strconv.Atoi(m[2])
				if len(p.Sizes) == 0 {
					sz := m[1]
					if m[3] != "" {
						sz += "2"
					}
					p.Sizes = []string{sz}
				}
			}
			if len(p.Sizes) == 0 {
				if s := familySize(f); s != "" {
					p.Sizes = []string{s}
				}
			}
		}
	}
	if p.Depth == 0 {
		if m := runnerDepth.FindStringSubmatch(n); m != nil {
			p.Depth, _ = strconv.Atoi(m[1])
		}
	}
	// XL runners live in "Runners/XL Runners".
	if len(p.Sizes) == 0 && strings.HasSuffix(strings.ToUpper(n), " XL") {
		p.Sizes = []string{"XL"}
	}

	// Heights.
	if m := heightRange.FindStringSubmatch(n); m != nil {
		a, _ := strconv.Atoi(m[1])
		b, _ := strconv.Atoi(m[2])
		for _, h := range []int{1, 2, 4} {
			if h >= a && h <= b {
				p.Heights = append(p.Heights, h)
			}
		}
	} else if m := heightOne.FindStringSubmatch(n); m != nil {
		h, _ := strconv.Atoi(m[1])
		p.Heights = []int{h}
	}

	// Split prints.
	if m := pieceRe.FindStringSubmatch(n); m != nil {
		p.Piece = m[1]
	} else if strings.Contains(strings.ToLower(n), "whole") {
		p.Piece = "whole"
	}

	p.Variant = variantOf(p, strings.ToLower(n))
	return p
}

func categoryOf(folder string) string {
	switch strings.ToUpper(folder) {
	case "DRAWERS":
		return "drawers"
	case "SUSTAINERS":
		return "sustainers"
	case "MODIFICATIONS":
		return "modifications"
	case "PEGBOARD":
		return "pegboard"
	case "DOCUMENTATION":
		return "documentation"
	}
	return ""
}

func familySize(folder string) string {
	f := strings.TrimSpace(strings.TrimSuffix(folder, "Families"))
	switch f {
	case "S", "M", "L", "XL":
		return f
	case "L²":
		return "L2"
	case "XL²":
		return "XL2"
	}
	return ""
}

func expandSizes(a, b string) []string {
	order := []string{"S", "M", "L", "XL"}
	if b == "" {
		return []string{a}
	}
	var out []string
	in := false
	for _, s := range order {
		if s == a {
			in = true
		}
		if in {
			out = append(out, s)
		}
		if s == b {
			break
		}
	}
	return out
}

// groupOf picks the most meaningful folder for grouping in the UI.
func groupOf(folders []string) string {
	known := map[string]string{
		"modules": "Modules", "roofs": "Roofs", "roof": "Roofs", "boxes": "Boxes",
		"gridfinity baseplate": "Baseplates", "baseplates": "Baseplates", "facades": "Facades",
		"universal": "Universal",
	}
	// Prefer the deepest known folder name.
	for i := len(folders) - 1; i >= 0; i-- {
		if g, ok := known[strings.ToLower(folders[i])]; ok {
			return g
		}
	}
	// Otherwise the first folder that is not a family / size folder.
	for _, f := range folders {
		if familySize(f) != "" || sizeDepth.MatchString(f+" ") {
			continue
		}
		return f
	}
	return ""
}

func variantOf(p *Part, n string) string {
	has := func(s string) bool { return strings.Contains(n, s) }
	switch {
	case has("under table"):
		return "under-table"
	case has("heavyweight roof cut"):
		return "heavyweight-cut"
	case has("heawyweight roof") || has("heavyweight roof"):
		return "heavyweight"
	case has("bowl roof"):
		return "bowl"
	case has("grid roof"):
		return "grid"
	case has("table roof"):
		return "table"
	case has("baseplate_with 2"):
		return "baseplate-2-handles"
	case has("baseplate_with 1"):
		return "baseplate-1-handle"
	case has("back panel"):
		return "back-panel"
	case has("dividers module"):
		return "dividers"
	case has("flat module"):
		return "flat"
	case has("sealed module"):
		return "sealed"
	case has("connector for split roof"):
		return "roof-connector"
	}
	return ""
}

// Exists reports whether a directory exists.
func Exists(dir string) bool {
	st, err := os.Stat(dir)
	return err == nil && st.IsDir()
}
