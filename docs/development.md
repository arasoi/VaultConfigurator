# Development notes

Technical reference for working on the VAULT Configurator: how it is built, why, and the
measurements and fixes behind how each part is placed. For using the app, see the
[README](../README.md) and the [user guide](user-guide.md).

- [Stack and design decisions](#stack-and-design-decisions)
- [Development setup](#development-setup)
- [How it works](#how-it-works)
- [Project layout](#project-layout)
- [API](#api)
- [Colours](#colours)
- [Orienting parts](#orienting-parts)
- [Part placement notes](#part-placement-notes)
- [Parts coverage](#parts-coverage)
- [Known gaps](#known-gaps)

## Stack and design decisions

- **Front end:** plain HTML, CSS and JavaScript (ES modules). No framework, no build step.
  three.js is vendored in `web/vendor/three` so nothing loads from a CDN.
- **Back end:** a single Go binary using only the standard library. It indexes the data folder,
  serves the site, generates lightweight 3D previews of the STLs, and streams ZIP downloads.

### Why Go (and not .NET)

Both would work. Go fits this project better:

- **Self-hosting is one file.** `go build` gives a static binary with the website embedded. No
  runtime to install, trivial to cross-compile for Linux/ARM/Windows, ~15 MB Docker image.
  .NET needs the runtime (or a much larger self-contained / AOT publish).
- **The heavy work is simple number crunching.** The STLs are 26 GB in total and individual files
  reach 360 MB / 7 M triangles. Parsing and simplifying them is plain loops over float arrays,
  which Go does fast with low memory overhead and no tuning.
- **Standard library covers everything:** HTTP routing (`net/http` path patterns), gzip, zip
  streaming, embedding files. Zero third-party dependencies.

.NET would be the better pick if you wanted an ORM/database-heavy app, user accounts with
ASP.NET Identity, or a team already living in C#.

## Development setup

Use `-web web` so front-end edits only need a browser refresh (otherwise the embedded copy is
served):

```bash
go run . -data Data -web web
```

`.claude/launch.json` starts the same command for the Claude Code preview. Run the Go tests with
`go test ./...`. `internal/mesh/real_test.go` also runs on real files when `VAULT_FILES` is set
to `|`-separated absolute STL paths, and logs the simplification time per file.

The data folder is the source of truth: never modify, move or add files in it. If a file isn't
recognised or placed correctly, fix it in code. If a future VAULT release changes names, the
rules to update are in `internal/catalog/catalog.go` (file classification) and `web/js/rules.js`
(which files a build uses).

### CI and releases

- **CI** (`.github/workflows/ci.yml`, on pushes to `main` and pull requests): `go vet` and
  `go test` on Linux, Windows and macOS, with both the Go version from `go.mod` and the latest
  stable Go. A second job checks `gofmt`, builds and packages a few platforms with the release
  builder, and runs the Linux binary with `-version`.
- **Releases** (`.github/workflows/release.yml`): push a tag starting with `v` to publish a
  GitHub release with a build for every platform. Tags containing `-` (e.g. `v1.0.0-rc1`) are
  marked as pre-releases. The workflow can also be run by hand for an existing tag; it re-uploads
  the files.

  ```bash
  git tag v1.0.0
  git push origin v1.0.0
  ```

- **Release builder** (`tools/release`): cross-compiles with `CGO_ENABLED=0` for every
  platform in `go tool dist list`, stamps the version (`-X main.version`, shown by `-version`
  and in the start-up log), and packages each build with the README and licence: `.zip` for
  Windows, `.tar.gz` elsewhere, plus `SHA256SUMS.txt`. 32-bit ARM Linux is built for ARMv6 and
  ARMv7. It skips platforms that can't produce a usable server: Android on 386/amd64/arm and iOS
  need cgo and a platform SDK to link, and `js/wasm` / `wasip1/wasm` can't listen for HTTP
  connections. Run it locally with `go run ./tools/release -version v1.0.0` (or `-only
  linux/amd64,windows/amd64` for a quick test). All platforms build in about 15 seconds.

**Screenshots** for the README and user guide live in `docs/images`. To regenerate them after UI
changes, run the app and `node docs/capture-screenshots.mjs`. It drives headless Chrome over the
DevTools protocol (Node 22+, no packages); see the comment at the top of the script for options.

## How it works

```
Data/  ──scan──▶  catalog (tags parsed from file names)  ──▶  /api/catalog
  │
  └─ *.stl ──read──▶ simplify (quadric edge collapse) ──▶ orient (min bounding box) ──▶ cache/*.vms.gz ──▶ /api/preview/{id}
```

1. **Catalog** (`internal/catalog`): every file under `-data` is classified from its path, e.g.
   `01. DRAWERS/01. S Families/S5/Modules/S5 Module 2F.stl` becomes
   `{category: drawers, group: Modules, sizes: [S], depth: 5, heights: [2]}`. Shared parts like
   `S-M 2-4F Hinge` get several sizes/heights. Adding files to the data folder needs only a restart.
2. **Previews** (`internal/mesh`): the original STLs are far too big for a browser, and they come
   from one big CAD scene, so they're scattered and often rotated (e.g. roofs at 45°). On first
   request each file is simplified to ≤150k triangles, rotated so its tightest bounding box is
   axis-aligned, centered, and cached as a compact binary (`VMS1`, see `format.go`).
   Simplification is quadric edge collapse (`decimate.go`), which collapses the edges that change
   the shape least, so flat areas get a few large triangles and edges, fillets and small features
   keep theirs. Inputs above 4× the budget are first clustered on a grid, each cell's vertex placed
   on the original surfaces, not averaged. A 7 M-triangle module takes ~7 s and a typical part
   1–2 s the first time; after that they load instantly (`-warm` pre-generates them all).
   Previews are served with an ETag from the cache key, which includes `algoVersion` in
   `previews.go`, so bumping it reaches browsers immediately. The viewer shades with smooth
   normals that keep edges sharper than 35°.
3. **Rules** (`web/js/rules.js`): the VAULT system knowledge lives here — sizes (S 164.8, M 254,
   L 329.6 = S+S, XL 418.8 = S+M mm), depths (42 mm gridfinity units), heights (1F/2F/4F on a 48 mm
   pitch), which files make up each drawer/sustainer, roofs, bases, backbone, handles, and the
   hardware list from the manual. `resolve()` turns a build into a print list + 3D placements;
   `layout()` positions them.
4. **Viewer** (`web/js/viewer.js`): loads previews, matches each mesh's axes to its role's expected
   width/height/depth, and stacks everything. Click a part to see its file and quantity.

## Project layout

```
main.go                     flags, start-up, embeds web/
internal/catalog/           data folder scanner + file-name tagging (with tests)
internal/mesh/              STL reader, simplifier, orientation, preview format (with tests)
internal/server/            HTTP API, preview cache, ZIP streaming
web/index.html              page shell
web/css/app.css             all styles (light/dark tokens)
web/js/main.js              wiring: tabs, state, panels
web/js/rules.js             VAULT system rules  ← most refinement happens here
web/js/configurator.js      left panel + build persistence (localStorage, share links)
web/js/bom.js               right panel: parts list, hardware, ZIP download
web/js/viewer.js            three.js scene
web/js/orient.js            orientation from connection interfaces and mount faces
web/js/colors.js            filament palette, colour groups, presets
web/js/library.js           Parts library tab
web/js/docs.js              Documentation tab
web/vendor/three/           three.js r170 (MIT)
docs/user-guide.md          user documentation
docs/development.md         this file
docs/images/                screenshots used by the README and user guide
docs/capture-screenshots.mjs  regenerates docs/images from the running app (headless Chrome)
tools/release/              cross-compiles and packages every platform for a release
.github/workflows/          CI (vet + tests) and the tag-triggered release
```

## API

| Endpoint                                   | Returns                                                 |
| ------------------------------------------ | ------------------------------------------------------- |
| `GET /api/catalog`                         | All files with tags                                     |
| `GET /api/preview/{id}`                    | Simplified, oriented mesh (gzip `VMS1`)                 |
| `GET /api/file/{id}[?download]`            | Original file                                           |
| `GET /api/zip?name=x&items=id,id*3~Orange,…` | ZIP of originals; `*3` adds “(print x3)”, `~Orange` puts it in an `Orange/` folder |

## Colours

Every part can be colored (`web/js/colors.js`). A part's color comes from, most specific first:
an override for that one part (click it in 3D → *Just this part*), an override for every copy of
its STL file (*All copies*), its **color group** (Modules & roofs, Facades, Drawer boxes, Knobs,
Latches, Hinges, …, plus *Internal parts* for things that aren't drawn), then the chosen preset
(Classic, Orange accents, Stealth, Arctic, Toy box). Colors are saved with the build and in
share links.

The parts list shows each file's colors (a file printed in two colors is split, e.g.
"2 × Orange, 1 × Green") and a filament summary; the ZIP download puts files in one folder per
filament (`My VAULT/Orange/…/Key Cap (print x2).stl`). The palette lives in `FILAMENTS`, groups in
`COLOR_GROUPS`, presets in `PRESETS`.

## Orienting parts

### From their connection geometry

The STL files come from one CAD scene with arbitrary flips, so after matching width/height/depth a
part can still be upside down or back to front (this differs file by file — e.g. S roofs are
flipped, L4 table roof is not). Stacking parts are therefore oriented from how they connect
(`web/js/orient.js`):

1. For each footprint (size + depth) the 1F sustainer is turned so its floor is down (most
   horizontal area low) and its front wall is the one with the facade screw holes. Its underside
   is the **bottom interface** — the pad pattern under anything that sits on a module.
2. The 1F drawer module is turned so its underside matches that; its top is the **top interface**.
3. Each module, roof, lid and base is tried in four orientations (as-is, flipped about Z, flipped
   about X, turned about Y) and scored by how well its connecting face's contact pattern overlaps
   the reference (bottom face → bottom interface for modules/roofs; top face → top interface for
   lids/bases). The interfaces are front/back asymmetric, so this fixes both up/down and front/back.

Matches score 0.54–1.00 against ≤0.3 for wrong orientations. If a match isn't confident the static
fallback in `ORIENT_BY_ROLE` is used. Click a part in the 3D view to see which was used.

### How every part is oriented

Each placed part is oriented by one of four methods (click a part to see which was used):

1. **Connection interface** — modules, roofs, lids, bases (see above).
2. **Measured file coordinates** — hinges, latches, geared racks, wheels, lock pins: positioned
   from the screw holes, knuckles, bores and pivots measured in the STLs and their hosts.
3. **Mount face** — parts screwed or resting against something are turned so their flattest face
   is the one against the host: feet (top), backbone boards, pegboard plates, wall mounts, handle
   locks (front), labels (back), baseplates, dividers, latch, L² strips, top handle, shelf items
   (bottom). Two handles are checked on the side away from the host, because their mounting side
   is only two small leg pads: the stationary handle's grip faces out (back) and the pull-out
   handle's grip is on top. `MOUNT_FACE` in `web/js/orient.js`.
4. **Static rules** — facades, keys and the rest, checked against the manual's pictures
   (`ORIENT_BY_ROLE` in `web/js/rules.js`).

The embossed "UP ↑" markers on parts such as the lock holder and lever show which way they are
installed; use them when checking an orientation.

## Part placement notes

Measurements taken from the STLs (hole, bore and pocket detection on the preview meshes) and
checked against the manuals. The constants live in `web/js/rules.js` next to the code that uses
them.

### Top handle

Only roofs with a handle mount take one. Every Grid roof file has two M6 holes 48.4 mm apart for
the Top Handle (9.8 mm back on S3/M3); the heavyweight roofs take the heavyweight handle + insert.
Table, bowl and under-table roofs have no mount, so the option is hidden for them and a build that
asks for it gets a warning instead of a handle.

### Drawer facades

Screw holes at x = ±51.5 mm, plus ±92.5 (M), ±130.3 (L) or ±169.6 (XL); 2F/4F facades add an
outer pair in the top row. Every hole takes an M4 14mm bolt; all but one get a **Facade Cap** —
the last one sits under the **Label** (bottom-left). The **Key** (knob) and **Key Cap** sit in the
bottom row (centre on 1F), or a flush **Hidden Key** if chosen. S: 1 cap (1F) / 3 caps (2F, 4F).
M, L, XL: 3 caps (1F) / 5 caps (2F, 4F).

### Sustainer hinges and latches

Two hinges at the back, and latches on the facade — one centred on S/M, two on L (±82.4 mm) and
XL (±127 mm). Bolts: 8 × M4 10mm (hinges), 8 + 4 per latch × M4 14mm, 7 × M4 20mm.

- **Hinges** are placed from measured geometry. The Hinge file is both bottom leaves (screwed
  inside the back wall, 2×2 holes), the Hinge Top file is the lid side (one central plate on S/M,
  two plates on L/XL), the Rods file is both pins. All knuckles share one axis at rim height
  ~8 mm behind the back wall, and the lid pivots on it.
- **Latches** are four parts: Lock Holder, Lock Inner Part (link), Lock Outer Part (lever, 1F or
  2-4F to match the sustainer's height) and a set of pins. They are placed from measured geometry
  and the parts' "UP" markers.
  - Each facade has a 4.1 mm latch pocket on its front, notched at the top edge. That is why the
    sustainer facade is turned about z, not x: the pocket must face out.
  - The holder plate sits behind the facade, where the module's front wall is cut away, screwed
    through its 61.4 × 9 mm holes (11.5 mm below the top on 1F, 17.5 mm on 2F/4F). Its pivot boss
    comes forward through the notch.
  - The link hangs from the boss's pivot and pins between the lever's side walls.
  - The pin file holds four pins, drawn separately: two plain 18.2 mm pins through the link's ears
    into the boss, and two stepped 21.4 mm pins through the lever's walls into the link's bar.
  - The lever is a tray whose walls rest in the pocket, and its hook reaches back over the lid's
    front edge.
  - The latch is hinged and the STLs are modelled closed (the 1F lever centred on the holder). In
    that position the hook's tooth sits 4.4 mm inside the lid's catch, so the lever is lifted
    4.4 mm to rest on it. The 2-4F lever is 3 mm longer at each end, so it sits 3 mm higher again.
  - Known mismatch: with the lever on the catch, the link's bar sits 2.9 mm past the lever's pin
    holes (the link is rigid; it's hidden inside the lever).

### Backbone and handles

- **Pull-out handle:** the handle lock takes the place of the top 1F backbone board, and the M16
  rods (x = ±40 / 85 / 123 / 167 mm for S / M / L / XL, measured) run through it and the boards
  below. The handle is an upside-down U on the rods. Knobs sit disc-first in pockets 17.5 mm
  inboard of each rod, with the grip sleeve over the stem; S has one knob, in its Lock Part 2.
- **Stationary handle:** bolts to the topmost backbone board, below the lock. Its legs face the
  board and the grip faces out.

### Wheels

Wheels sit on the M16 rod through the base's bore (20.1 mm above its bottom, 30 mm from its back
edge, the same on every base). From the base's side face outwards: the bushing (33 mm), then the
disk with its flange side against the base, then the cover with its cap facing out, mirrored per
side. The 6205 bearing sits in the pockets of disk and cover (5.9 + 8.9 mm), and the tyre
(Ø160 × 40.6) wraps both. The base sits so the tyres touch the ground; the front foot tucks
2.1 mm further into the base to match.

## Parts coverage

Every printed file in a build is both in the parts list **and** drawn in 3D (so it can be colored
and counted), except print aids (manual supports, the wheel jig), which are listed under
*Print aids* and never drawn. This was checked by resolving ~7,900 builds covering every size,
depth, layout, height, interior, roof, base and back option: 0 errors, 0 mismatches between
drawn copies and print quantities, and nothing drawn that isn't in the list.

What gets drawn, beyond modules/boxes/facades/roofs/lids:

- **Drawers:** knob + key cap (or hidden key; the removable key is one per build and sits on the
  shelf beside the build), screw-hole caps, label, springs (one file = both springs), latch
  (module floor), geared rails (always fitted; one file = the upper 6.2 mm + lower 4.8 mm rack,
  drawn separately in the two tunnels of the box's front wall), runners at **every height level**:
  per side one guide in the module channel, one slide on the box and one stopper clicked into the
  module's side-wall slot (1F = 2 of each, 2F = 4, 4F = 8; in L²/XL² modules each box has guides
  on both sides, including the middle, while stoppers only go in the module's outer side walls),
  gridfinity baseplate, grid dividers (across / front-back counts, T-joint segments, border
  pieces, pins), L² accessories.
- **Sustainers:** hinges, latches (holder, link, lever, four pins), label, gridfinity baseplate,
  dividers with counts (across, front-back, sealed rows).
- **Base & back:** base connector (split bases), feet, tyres, hubs (disk, cover, bushing),
  backbone boards (full width or universal), module connectors, pegboard attachments, wall
  mounts + wall plates, pull-out handle + rods, handle lock + knobs, stationary handle,
  heavyweight roof handle + insert.
- **Accessories & extras:** any pegboard hook, container, container hook or holder, and any
  grid divider piece for custom layouts, with quantities; shown on a shelf beside the build.

**Drawers inside tall modules:** a 2F or 4F drawer module can hold a stack of smaller boxes that
fills its height (bottom to top), e.g. 4F = 4F, 2F + 2F, 2F + 1F + 1F (any order) or 4 × 1F. Each box
gets its own facade, knob, caps, label, springs, latch and geared rails, and slides at each of its
levels; the module's guides and stoppers stay one per level per side. L² and XL² modules have a
Left and a Right panel, so each side gets its own drawers and interior.

Files that hold more than one part (geared rails, springs, hinge pins, lock pins) are counted once
per set; when the parts are drawn separately each counts as a fraction of the file and they share
one color, since they print together.

Files intentionally not used by any build: `02. SUSTAINERS/05. Universal/Facades/*` are
geometrically identical to the facades in the family folders (same holes and recesses, only a
different mesh resolution).

## Known gaps

- Quantities for small universal parts (runners, locks, hinges, dividers) are best-effort readings
  of the manuals — worth a review against a real build.
- 3D fit offsets (`FIT` in `rules.js`) are approximations; parts sit in the right place but
  interlocking features may overlap or gap by a few mm.
- Small internal parts (springs, pins, runners, racks) are placed by measurement and the manual
  pictures; they're right to within a few mm, not CAD-exact.
- Hinge leaves are placed by inference from the manual photos; they look right with the lid open
  but the exact knuckle position hasn't been verified against a physical build.
- Sustainer latch link: see the known mismatch under [latches](#sustainer-hinges-and-latches).
