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
	"io/fs"
	"log"
	"net/http"
	"os"
	"runtime"
	"time"

	"vaultconfigurator/internal/catalog"
	"vaultconfigurator/internal/server"
)

//go:embed web
var embedded embed.FS

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	data := flag.String("data", "Data", "folder containing the VAULT files")
	cache := flag.String("cache", "cache", "folder for generated preview meshes")
	webDir := flag.String("web", "", "serve front end from this folder instead of the embedded copy (for development)")
	maxTris := flag.Int("max-tris", 150000, "triangle budget per preview mesh")
	workers := flag.Int("workers", max(1, min(4, runtime.NumCPU()/2)), "concurrent preview generators")
	warm := flag.Bool("warm", false, "pre-generate all previews in the background at start-up")
	flag.Parse()

	if !catalog.Exists(*data) {
		log.Fatalf("data folder %q not found (use -data)", *data)
	}
	t := time.Now()
	cat, err := catalog.Scan(*data)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("catalog: %d files from %s in %v", len(cat.Parts), cat.Root, time.Since(t).Round(time.Millisecond))

	pv, err := server.NewPreviews(cat, *cache, *maxTris, *workers)
	if err != nil {
		log.Fatal(err)
	}
	if *warm {
		pv.Warm()
	}

	var web fs.FS
	if *webDir != "" {
		web = os.DirFS(*webDir)
	} else {
		web, _ = fs.Sub(embedded, "web")
	}

	s := &server.Server{Cat: cat, Previews: pv, Web: web}
	log.Printf("listening on http://localhost%s", *addr)
	log.Fatal(http.ListenAndServe(*addr, s.Handler()))
}
