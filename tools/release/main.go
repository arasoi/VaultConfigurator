// Command release cross-compiles vault-configurator for every platform Go
// supports and packages each build for a GitHub release:
//
//	go run ./tools/release -version v1.2.3            # all platforms into dist/
//	go run ./tools/release -version dev -only linux/amd64,windows/amd64
//
// Each archive (.zip for Windows, .tar.gz elsewhere) holds the program, the
// README and the LICENSE. SHA256SUMS.txt lists a checksum for every archive.
//
// Platforms come from `go tool dist list`, minus those that can't produce a
// usable server without cgo or a platform SDK (see skip).
package main

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

const name = "vault-configurator"

// skip lists platforms that are not released, with the reason.
var skip = map[string]string{
	"android/386":   "needs cgo (Android NDK) to link",
	"android/amd64": "needs cgo (Android NDK) to link",
	"android/arm":   "needs cgo (Android NDK) to link",
	"ios/amd64":     "needs cgo (Xcode) to link",
	"ios/arm64":     "needs cgo (Xcode) to link",
	"js/wasm":       "WebAssembly can't listen for HTTP connections",
	"wasip1/wasm":   "WebAssembly can't listen for HTTP connections",
}

// target is one build: GOOS, GOARCH and, for 32-bit ARM Linux, GOARM.
type target struct{ os, arch, arm string }

func (t target) String() string {
	s := t.os + "/" + t.arch
	if t.arm != "" {
		s += "v" + t.arm
	}
	return s
}

func (t target) archive(version string) string {
	arch := t.arch
	if t.arm != "" {
		arch += "v" + t.arm
	}
	ext := ".tar.gz"
	if t.os == "windows" {
		ext = ".zip"
	}
	return fmt.Sprintf("%s_%s_%s_%s%s", name, version, t.os, arch, ext)
}

func main() {
	version := flag.String("version", "dev", "version to stamp into the binaries and archive names")
	out := flag.String("out", "dist", "output folder (emptied first)")
	only := flag.String("only", "", "comma-separated GOOS/GOARCH list to build instead of all")
	jobs := flag.Int("j", runtime.NumCPU(), "parallel builds")
	flag.Parse()

	targets, err := listTargets(*only)
	if err != nil {
		log.Fatal(err)
	}
	if err := os.RemoveAll(*out); err != nil {
		log.Fatal(err)
	}
	if err := os.MkdirAll(*out, 0o755); err != nil {
		log.Fatal(err)
	}
	extras := map[string][]byte{}
	for _, f := range []string{"README.md", "LICENSE"} {
		b, err := os.ReadFile(f)
		if err != nil {
			log.Fatalf("%s: %v (run from the repository root)", f, err)
		}
		extras[f] = b
	}

	start := time.Now()
	var (
		mu       sync.Mutex
		failed   []string
		archives []string
		wg       sync.WaitGroup
	)
	sem := make(chan struct{}, max(1, *jobs))
	for _, t := range targets {
		wg.Add(1)
		go func(t target) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			a, err := build(t, *version, *out, extras)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				failed = append(failed, fmt.Sprintf("%s: %v", t, err))
				return
			}
			archives = append(archives, a)
			log.Printf("built %s", filepath.Base(a))
		}(t)
	}
	wg.Wait()
	if len(failed) > 0 {
		sort.Strings(failed)
		log.Fatalf("%d build(s) failed:\n  %s", len(failed), strings.Join(failed, "\n  "))
	}
	if err := writeSums(*out, archives); err != nil {
		log.Fatal(err)
	}
	log.Printf("%d archives in %s (%v)", len(archives), *out, time.Since(start).Round(time.Second))
}

// listTargets returns the platforms to build, from `go tool dist list` minus
// skip. 32-bit ARM Linux is built twice: ARMv6 (Raspberry Pi Zero/1, also
// runs on newer boards) and ARMv7.
func listTargets(only string) ([]target, error) {
	var all []string
	if only != "" {
		all = strings.Split(only, ",")
	} else {
		b, err := exec.Command("go", "tool", "dist", "list").Output()
		if err != nil {
			return nil, fmt.Errorf("go tool dist list: %w", err)
		}
		all = strings.Fields(string(b))
	}
	var ts []target
	for _, p := range all {
		p = strings.TrimSpace(p)
		if _, no := skip[p]; no && only == "" {
			continue
		}
		osName, arch, ok := strings.Cut(p, "/")
		if !ok {
			return nil, fmt.Errorf("bad platform %q (want GOOS/GOARCH)", p)
		}
		if osName == "linux" && arch == "arm" {
			ts = append(ts, target{osName, arch, "6"}, target{osName, arch, "7"})
			continue
		}
		ts = append(ts, target{os: osName, arch: arch})
	}
	return ts, nil
}

func build(t target, version, out string, extras map[string][]byte) (string, error) {
	bin := name
	if t.os == "windows" {
		bin += ".exe"
	}
	tmp, err := os.MkdirTemp("", "vc-release-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(tmp)
	exe := filepath.Join(tmp, bin)
	cmd := exec.Command("go", "build", "-trimpath", "-ldflags", "-s -w -X main.version="+version, "-o", exe, ".")
	cmd.Env = append(os.Environ(), "CGO_ENABLED=0", "GOOS="+t.os, "GOARCH="+t.arch)
	if t.arm != "" {
		cmd.Env = append(cmd.Env, "GOARM="+t.arm)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("%v: %s", err, strings.TrimSpace(stderr.String()))
	}
	prog, err := os.ReadFile(exe)
	if err != nil {
		return "", err
	}
	// Archive layout: one folder named like the archive, so extracting doesn't
	// spill files into the current directory.
	path := filepath.Join(out, t.archive(version))
	dir := strings.TrimSuffix(strings.TrimSuffix(filepath.Base(path), ".zip"), ".tar.gz")
	files := []file{{dir + "/" + bin, prog, 0o755}}
	for _, n := range []string{"README.md", "LICENSE"} {
		files = append(files, file{dir + "/" + n, extras[n], 0o644})
	}
	if t.os == "windows" {
		return path, writeZip(path, files)
	}
	return path, writeTarGz(path, files)
}

type file struct {
	name string
	data []byte
	mode int64
}

func writeZip(path string, files []file) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	zw := zip.NewWriter(f)
	for _, fl := range files {
		h := &zip.FileHeader{Name: fl.name, Method: zip.Deflate, Modified: time.Now()}
		h.SetMode(os.FileMode(fl.mode))
		w, err := zw.CreateHeader(h)
		if err != nil {
			f.Close()
			return err
		}
		if _, err := w.Write(fl.data); err != nil {
			f.Close()
			return err
		}
	}
	if err := zw.Close(); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

func writeTarGz(path string, files []file) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	gz, _ := gzip.NewWriterLevel(f, gzip.BestCompression)
	tw := tar.NewWriter(gz)
	for _, fl := range files {
		h := &tar.Header{Name: fl.name, Mode: fl.mode, Size: int64(len(fl.data)), ModTime: time.Now(), Typeflag: tar.TypeReg}
		if err := tw.WriteHeader(h); err != nil {
			f.Close()
			return err
		}
		if _, err := tw.Write(fl.data); err != nil {
			f.Close()
			return err
		}
	}
	for _, c := range []io.Closer{tw, gz, f} {
		if err := c.Close(); err != nil {
			return err
		}
	}
	return nil
}

func writeSums(out string, archives []string) error {
	sort.Strings(archives)
	var b strings.Builder
	for _, a := range archives {
		data, err := os.ReadFile(a)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(data)
		fmt.Fprintf(&b, "%s  %s\n", hex.EncodeToString(sum[:]), filepath.Base(a))
	}
	return os.WriteFile(filepath.Join(out, "SHA256SUMS.txt"), []byte(b.String()), 0o644)
}
