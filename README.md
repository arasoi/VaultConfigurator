# VAULT Configurator

A self-hosted web app for planning VAULT modular storage builds:
pick a footprint, stack drawers and sustainers, add a roof, base, wheels, backbone, handles and
pegboards, see the assembled build in 3D, and download exactly the STL files (plus a hardware list)
you need to print it.

> [!IMPORTANT]
> **This repository does not include any VAULT files.** VAULT is a paid 3D-print design owned by
> its creator. To use this app you must already have your own copy of the VAULT STL files and
> documentation, **and a license to them** from the designer. The app only reads files you supply;
> it doesn't download, unlock or redistribute anything. Don't commit the data folder to a fork or
> host a public instance that serves files you aren't licensed to share. See
> [Data files (not included)](#data-files-not-included).
>
> This is an unofficial fan project, not affiliated with or endorsed by the VAULT designer.

- **Front end:** plain HTML, CSS and JavaScript (ES modules). No framework, no build step.
  three.js is vendored in `web/vendor/three` so nothing loads from a CDN.
- **Back end:** a single Go binary using only the standard library. It indexes the data folder,
  serves the site, generates lightweight 3D previews of the STLs, and streams ZIP downloads.

## Data files (not included)

You need:

1. **The VAULT files**: the STL set plus the documentation PDFs, as you received them from the
   designer (about 26 GB unzipped).
2. **A license that covers your use.** A personal license covers running this app for yourself.
   Check your license terms before you share an instance with anyone else, because the app serves
   the original STLs for download.

Put the files in a folder named `Data` next to the app, or anywhere else and pass `-data /path`.
The folder is git-ignored. The app scans it recursively at start-up and works out what each
file is from its folder and file names, so **keep the original folder and file names**. Renamed
or moved files won't be recognised, or will be put in the wrong place.

Expected layout (the top folder name, here `VAULT_USSA`, can be anything; the numbered category
folders are what the scanner looks for):

```
Data/
└── VAULT_USSA/
    ├── 01. DRAWERS/
    │   ├── 01. S Families/
    │   │   ├── Facades/                     S1F / S2F / S4F facades
    │   │   ├── S3/ … S7/                    one folder per depth
    │   │   │   ├── Boxes/                   S4 Box 1F.stl, 2F, 4F
    │   │   │   ├── Gridfinity Baseplate/    S4 Baseplate*.stl
    │   │   │   ├── Modules/                 S4 Module 1F.stl, 2F, 4F
    │   │   │   └── Roofs/                   Grid, Table, Bowl, Under Table Mount
    │   ├── 02. M Families/                  same layout as S (M3 … M7)
    │   ├── 03. L Families/                  same layout as S (L3 … L7)
    │   ├── 04. L² Families/
    │   │   └── L3² … L7²/                   L4² Module 1F.stl, 2F, 4F
    │   ├── 05. XL Families/                 same layout as S (XL3 … XL7)
    │   ├── 06. XL² Families/
    │   │   └── XL3² … XL7²/
    │   └── 07. Universal/
    │       ├── Geared Rails/
    │       ├── Grid Dividers/               20MM TALL, 34.5MM TALL…, 82.5MM TALL…, 01. INSTRUCTIONS
    │       ├── L² Accessories/
    │       ├── Manual Supports/
    │       ├── Runners/                     (+ XL Runners/)
    │       └── …                            keys, caps, label, springs, latch, top handle
    ├── 02. SUSTAINERS/
    │   ├── 01. S Families/ … 04. XL Families/
    │   │   ├── Facades/
    │   │   └── S3/ … S7/                    Modules/ and Roof/ or Roofs/
    │   └── 05. Universal/
    │       ├── Baseplates/                  01. S, 02. M, 03. L, 04. XL
    │       ├── Dividers/                    S, M, L Width/Depth/Seal, XL Depth
    │       ├── Facades/
    │       ├── Hinges/
    │       ├── Locks/
    │       └── Rods/
    ├── 03. MODIFICATIONS/
    │   ├── Backbone/
    │   ├── Base/                            S, M, L, XL
    │   ├── Feet/
    │   ├── Pegboard Attachment/             IKEA Skadis Pegboard, USSA Pegboard
    │   ├── Pull-out Handle/
    │   ├── Stationary Handle/
    │   ├── Wall Mounts/
    │   └── Wheels/
    ├── 04. PEGBOARD/
    │   ├── CONTAINERS/                      2_Depth_50mm … 5_Depth_125mm / Width_2 … 10 inches,
    │   │                                    HOOKs for containers
    │   └── HOOKS/                           20mm … 100mm
    └── 05. Documentation/                   the manuals (PDF) and reference images
```

Files the app doesn't recognise still appear in the **Parts library** tab, under *Other*. If a
future VAULT release changes names, the rules to update are in `internal/catalog/catalog.go`
(file classification) and `web/js/rules.js` (which files a build uses).

## Running

Requires Go 1.22+ and the data folder described above.

```bash
go run . -data Data
```

Open <http://localhost:8080>.

Build a single self-contained binary (the web front end is embedded):

```bash
go build -o vault-configurator .
./vault-configurator -data /path/to/Data -addr :8080
```

Cross-compile for a NAS / Raspberry Pi / Windows box, for example:

```bash
GOOS=linux GOARCH=arm64 go build -o vault-configurator-linux-arm64 .
```

Or with Docker (data mounted read-only, preview cache in a volume):

```bash
docker build -t vault-configurator .
docker run -p 8080:8080 -v "$PWD/Data:/data:ro" -v vault-cache:/cache vault-configurator
```

### Flags

| Flag        | Default | Purpose                                                                 |
| ----------- | ------- | ----------------------------------------------------------------------- |
| `-data`     | `Data`  | Folder with the VAULT files (scanned recursively at start-up)           |
| `-addr`     | `:8080` | Listen address                                                          |
| `-cache`    | `cache` | Where generated preview meshes are stored                               |
| `-warm`     | `false` | Pre-generate every preview in the background at start-up                |
| `-workers`  | ½ CPUs  | Concurrent preview generators (each can use a few hundred MB on big files) |
| `-max-tris` | 150000  | Triangle budget per preview mesh                                        |
| `-web`      | —       | Serve the front end from a folder instead of the embedded copy (dev)    |

During development use `-web web` so front-end edits only need a browser refresh:

```bash
go run . -data Data -web web
```

## Why Go (and not .NET)

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

## How it works

```
Data/  ──scan──▶  catalog (tags parsed from file names)  ──▶  /api/catalog
  │
  └─ *.stl ──read──▶ simplify (vertex clustering) ──▶ orient (min bounding box) ──▶ cache/*.vms.gz ──▶ /api/preview/{id}
```

1. **Catalog** (`internal/catalog`): every file under `-data` is classified from its path, e.g.
   `01. DRAWERS/01. S Families/S5/Modules/S5 Module 2F.stl` becomes
   `{category: drawers, group: Modules, sizes: [S], depth: 5, heights: [2]}`. Shared parts like
   `S-M 2-4F Hinge` get several sizes/heights. Adding files to the data folder needs only a restart.
2. **Previews** (`internal/mesh`): the original STLs are far too big for a browser, and they come
   from one big CAD scene, so they're scattered and often rotated (e.g. roofs at 45°). On first
   request each file is simplified to ≤150k triangles, rotated so its tightest bounding box is
   axis-aligned, centered, and cached as a compact binary (`VMS1`, see `format.go`). Large files
   take ~1–2 s the first time, then load instantly.
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
web/js/library.js           Parts library tab
web/js/docs.js              Documentation tab
web/vendor/three/           three.js r170 (MIT)
```

## API

| Endpoint                                   | Returns                                                 |
| ------------------------------------------ | ------------------------------------------------------- |
| `GET /api/catalog`                         | All files with tags                                     |
| `GET /api/preview/{id}`                    | Simplified, oriented mesh (gzip `VMS1`)                 |
| `GET /api/file/{id}[?download]`            | Original file                                           |
| `GET /api/zip?name=x&items=id,id*3~Orange,…` | ZIP of originals; `*3` adds “(print x3)”, `~Orange` puts it in an `Orange/` folder |

## Colors

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

## Orienting parts from their connection geometry

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

## How every part is oriented

Each placed part is oriented by one of four methods (click a part to see which was used):

1. **Connection interface** — modules, roofs, lids, bases (see above).
2. **Measured file coordinates** — hinges, latches, geared racks: positioned from the screw holes,
   knuckles and pivots measured in the STLs and their hosts.
3. **Mount face** — parts screwed or resting against something are turned so their flattest face
   is the one against the host: feet (top), backbone boards, pegboard plates, wall mounts, handle
   locks (front), labels (back), baseplates, dividers, latch, L² strips, top handle, shelf items
   (bottom). Two handles are checked on the side away from the host, because their mounting side
   is only two small leg pads: the stationary handle's grip faces out (back) and the pull-out
   handle's grip is on top. `MOUNT_FACE` in `web/js/orient.js`.
4. **Static rules** — facades, keys and the rest, checked against the manual's pictures
   (`ORIENT_BY_ROLE` in `web/js/rules.js`).

**Top handle compatibility:** only roofs with a handle mount take one. Every Grid roof file has two
M6 holes 48.4 mm apart for the Top Handle (9.8 mm back on S3/M3); the heavyweight roofs take the
heavyweight handle + insert. Table, bowl and under-table roofs have no mount, so the option is
hidden for them and a build that asks for it gets a warning instead of a handle.

## Facade, handle and latch geometry

Measured from the STLs (hole detection on the facade meshes) and checked against the manual:

- **Drawer facades:** screw holes at x = ±51.5 mm, plus ±92.5 (M), ±130.3 (L) or ±169.6 (XL);
  2F/4F facades add an outer pair in the top row. Every hole takes an M4 14mm bolt; all but one get
  a **Facade Cap** — the last one sits under the **Label** (bottom-left). The **Key** (knob) and
  **Key Cap** sit in the bottom row (centre on 1F), or a flush **Hidden Key** if chosen.
  S: 1 cap (1F) / 3 caps (2F, 4F). M, L, XL: 3 caps (1F) / 5 caps (2F, 4F).
- **Sustainers:** two hinges at the back, and
  latches on the facade — one centred on S/M, two on L (±82.4 mm) and XL (±127 mm). Each latch is
  a Lock Holder, Lock Inner Part, Lock Outer Part (1F or 2-4F) and a set of pins.
  Bolts: 8 × M4 10mm (hinges), 8 + 4 per latch × M4 14mm, 7 × M4 20mm.

## Parts coverage

Every printed file in a build is both in the parts list **and** drawn in 3D (so it can be colored
and counted), except print aids (manual supports, the wheel jig), which are listed under
*Print aids* and never drawn. This was checked by resolving ~7,900 builds covering every size,
depth, layout, height, interior, roof, base and back option: 0 errors, 0 mismatches between
drawn copies and print quantities, and nothing drawn that isn't in the list.

What gets drawn, beyond modules/boxes/facades/roofs/lids:

- **Drawers:** knob + key cap (or hidden key; the removable key is one per build and sits on the
  shelf beside the build), screw-hole
  caps, label, springs (one file = both springs), latch (module floor), geared rails (always fitted;
  one file = the upper 6.2 mm + lower 4.8 mm rack, drawn separately in the two tunnels of the box's
  front wall), runners at **every height level**: per side one guide in the module channel, one
  slide on the box and one stopper clicked into the module's side-wall slot (1F = 2 of each,
  2F = 4, 4F = 8; in L²/XL² modules each box has guides on both sides, including the middle, while
stoppers only go in the module's outer side walls), gridfinity
  baseplate, grid dividers (across / front-back counts, T-joint segments, border pieces, pins),
  L² accessories.

**Drawers inside tall modules:** a 2F or 4F drawer module can hold a stack of smaller boxes that
fills its height (bottom to top), e.g. 4F = 4F, 2F + 2F, 2F + 1F + 1F (any order) or 4 × 1F. Each box
gets its own facade, knob, caps, label, springs, latch and geared rails, and slides at each of its
levels; the module's guides and stoppers stay one per level per side. Pick it per drawer column
under *Drawers inside*. L² and XL² modules have a Left and a Right panel, so each side gets its own
drawers and interior (e.g. an L² 4F with 2F + 1F + 1F on the left and one 4F drawer on the right).

Files that hold more than one part (geared rails, springs, hinge pins, lock pins) are counted once
per set; when the parts are drawn separately each counts as a fraction of the file and they share
one color, since they print together.
- **Sustainers:** hinges placed from measured geometry — the Hinge file is both bottom leaves
  (screwed inside the back wall, 2×2 holes), the Hinge Top file is the lid side (one central plate
  on S/M, two plates on L/XL), the Rods file is both pins; all knuckles share one axis at rim
  height ~8 mm behind the back wall, and the lid pivots on it. Latches are placed from measured
  geometry and the parts' embossed "UP" markers. Each facade has a 4.1 mm latch pocket on its
  front, notched at the top edge. The holder plate sits behind the facade, screwed through its
  61.4 × 9 mm holes, and its pivot boss comes forward through the notch. The link hangs from the
  boss's pivot and pins between the lever's side walls. The pin file holds four pins, drawn
  separately: two short ones through the link's ears into the boss, and two stepped long ones
  through the lever's walls into the link's bar. The lever is a tray whose walls rest in the
  pocket, and its hook reaches back over the lid's front edge. The latch is hinged and the STLs are
  modelled closed (the 1F lever centred on the holder), but in that position the hook's tooth sits
  4.4 mm inside the lid's catch, so the lever is lifted 4.4 mm to rest on it. The 2-4F lever is 3 mm
  longer at each end, so it sits 3 mm higher again.
  Label,
  gridfinity baseplate, dividers with counts (across, front-back, sealed rows).
- **Base & back:** base connector (split bases), feet, tyres, hubs (disk, cover, bushing),
  backbone boards (full width or universal), module connectors, pegboard attachments, wall
  mounts + wall plates, pull-out handle + rods, handle lock + knobs, stationary handle,
  heavyweight roof handle + insert. The handle lock takes the place of the top 1F backbone
  board, and the M16 rods (x = ±40 / 85 / 123 / 167 mm for S / M / L / XL, measured) run through
  it and the boards below. Knobs sit in pockets 17.5 mm inboard of each rod; S has one knob, in
  its Lock Part 2. The stationary handle bolts to the topmost backbone board, below the lock.
- **Accessories & extras:** any pegboard hook, container, container hook or holder, and any
  grid divider piece for custom layouts, with quantities; shown on a shelf beside the build.

Files intentionally not used by any build: `02. SUSTAINERS/05. Universal/Facades/*` are
geometrically identical to the facades in the family folders (same holes and recesses, only a
different mesh resolution).

## Known gaps / next steps

- Quantities for small universal parts (runners, locks, hinges, dividers) are best-effort readings
  of the manuals — worth a review against a real build.
- 3D fit offsets (`FIT` in `rules.js`) are approximations; parts sit in the right place but
  interlocking features may overlap or gap by a few mm.
- Small internal parts (springs, pins, runners, racks) are placed by measurement and the manual
  pictures; they're right to within a few mm, not CAD-exact.
- Hinge leaves are placed by inference from the manual photos; they look right with the lid open
  but the exact knuckle position hasn't been verified against a physical build.
- The `Data/` folder (≈26 GB) is git-ignored and must never be committed. Keep it next to the
  binary or point `-data` at it.

## License

The code in this repository is released under the [MIT License](LICENSE). three.js in `web/vendor/three` is MIT licensed
(see its `LICENSE`). The VAULT design, its STL files, manuals and images belong to their creator,
aren't covered by this repository, and need their own license.
