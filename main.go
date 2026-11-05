// Command vault-configurator serves the VAULT build configurator.
//
//	go run . -data ./Data
//
// All parts are discovered from the data folder at start-up. Preview meshes
// are generated on first request and cached in -cache.
package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"

	"vaultconfigurator/internal/catalog"
	"vaultconfigurator/internal/server"
)

//go:embed web
var embedded embed.FS

// version is set at build time by the release builder (-ldflags "-X main.version=v1.2.3").
var version = "dev"

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	data := flag.String("data", "Data", "folder containing the VAULT files")
	cache := flag.String("cache", "cache", "folder for generated preview meshes")
	webDir := flag.String("web", "", "serve front end from this folder instead of the embedded copy (for development)")
	maxTris := flag.Int("max-tris", 150000, "triangle budget per preview mesh")
	workers := flag.Int("workers", max(1, min(4, runtime.NumCPU()/2)), "concurrent preview generators")
	warm := flag.Bool("warm", false, "pre-generate all previews in the background at start-up")
	showVersion := flag.Bool("version", false, "print the version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Printf("vault-configurator %s (%s/%s)\n", version, runtime.GOOS, runtime.GOARCH)
		return
	}
	log.Printf("vault-configurator %s", version)

	set := map[string]bool{}
	flag.Visit(func(f *flag.Flag) { set[f.Name] = true })
	if !set["data"] && !set["cache"] && !catalog.Exists(*data) {
		useExecutableDir(*data)
	}

	pv, err := server.NewPreviews(*cache, *maxTris, *workers)
	if err != nil {
		log.Fatalf("preview cache %q: %v (use -cache)", *cache, err)
	}

	var web fs.FS
	if *webDir != "" {
		web = os.DirFS(*webDir)
	} else {
		web, _ = fs.Sub(embedded, "web")
	}

	// A missing data folder isn't fatal: the site explains how to set it up
	// and picks the files up with a rescan.
	s := server.New(*data, pv, web)
	if st := s.Status(); st.Error != "" {
		log.Printf("no VAULT files yet (%s: %s); the site will show setup instructions", st.Dir, st.Error)
	}
	if *warm {
		pv.Warm(s.Catalog())
	}
	log.Printf("listening on http://localhost%s", *addr)
	if err := http.ListenAndServe(*addr, s.Handler()); err != nil {
		log.Fatalf("can't serve on %s: %v (is another copy already running? pick a port with -addr)", *addr, err)
	}
}

// useExecutableDir switches to the folder holding the executable when the
// default data folder isn't in the current directory but is next to the
// program. That covers starting a downloaded release by double-clicking it
// (macOS and some Linux desktops start it in the home folder). The default
// cache folder then lands next to the program too.
func useExecutableDir(data string) {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	if real, err := filepath.EvalSymlinks(exe); err == nil {
		exe = real
	}
	dir := filepath.Dir(exe)
	if !catalog.Exists(filepath.Join(dir, data)) {
		return
	}
	if err := os.Chdir(dir); err == nil {
		log.Printf("using %s next to the program", filepath.Join(dir, data))
	}
}
