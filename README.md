# VAULT Configurator

A self-hosted web app for planning VAULT modular storage builds:
pick a footprint, stack drawers and sustainers, add a roof, base, wheels, backbone, handles and
pegboards, see the assembled build in 3D (bolts, rods and bearings included, in silver, brass or
black), and download exactly the STL files (plus a hardware list) you need to print it.

![The Build tab: build options, 3D view and parts list](docs/images/build-trolley.png)

> [!IMPORTANT]
> **This repository does not include any VAULT files.** VAULT is a paid 3D-print design owned by
> its creator. To use this app you must already have your own copy of the VAULT STL files and
> documentation, **and a license to them** from the designer. The app only reads files you supply;
> it doesn't download, unlock or redistribute anything. Don't commit the data folder to a fork or
> host a public instance that serves files you aren't licensed to share. See
> [Data files (not included)](#data-files-not-included).
>
> This is an unofficial fan project, not affiliated with or endorsed by USSA.

**How to use it:** see the [user guide](docs/user-guide.md).

## Screenshots

| | |
| --- | --- |
| ![Drawers and lids opened, parts exploded](docs/images/open-explode.png) | ![Colour groups, presets and the part card](docs/images/color-card.png) |
| Open drawers & lids, and explode the parts to see how they fit | Colour presets, colour groups, and per-part colours from the 3D view |
| ![An M-width desk tower on feet](docs/images/desk-tower.png) | ![Parts library with search and preview](docs/images/parts-library.png) |
| Any footprint and stack, e.g. a desk tower with three drawers in one 4F module | Browse, preview and download every file in your data folder |

The screenshots show renders of the VAULT parts as the app draws them, from the designer's STL
files (not included here).

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
or moved files won't be recognised, or will be put in the wrong place. The app only reads the
folder; it never changes it.

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

Files the app doesn't recognise still appear in the **Parts library** tab, under *Other*.

## Installing and running

The app is a single program with the website built in. Download a ready-made build for your
system from the [Releases page](https://github.com/arasoi/VaultConfigurator/releases), or
[build it from source](#building-from-source). Either way, it needs the
[data folder](#data-files-not-included) described above.

Once it's running, open <http://localhost:8080> in your browser. The first time a large part is
shown, the app prepares a lightweight 3D preview of it, which can take a few seconds; after that it
loads instantly. Use `-warm` to prepare every preview in the background at start-up.

### Which file to download

| Your computer | Download |
| --- | --- |
| Windows 10/11 PC (Intel or AMD) | `vault-configurator_<version>_windows_amd64.zip` |
| Windows on ARM (Snapdragon laptops, Surface Pro X) | `…_windows_arm64.zip` |
| 32-bit Windows | `…_windows_386.zip` |
| Mac with Apple silicon (M1 and later) | `…_darwin_arm64.tar.gz` |
| Mac with an Intel processor | `…_darwin_amd64.tar.gz` |
| Linux PC or server (Intel or AMD), most x86 NAS boxes | `…_linux_amd64.tar.gz` |
| Raspberry Pi 3/4/5 with a 64-bit OS, other 64-bit ARM boards and NAS boxes | `…_linux_arm64.tar.gz` |
| Raspberry Pi 2/3/4 with a 32-bit OS | `…_linux_armv7.tar.gz` |
| Raspberry Pi Zero / 1 | `…_linux_armv6.tar.gz` |
| FreeBSD (also TrueNAS CORE), OpenBSD, NetBSD, DragonFly BSD | `…_freebsd_amd64.tar.gz`, `…_openbsd_amd64.tar.gz`, … |
| Other systems and processors | Every platform Go supports has a build, including illumos, Solaris, AIX, Plan 9, Android (Termux), and Linux on RISC-V, LoongArch, MIPS, PowerPC and s390x. Pick the one named after your system and processor. |

Each archive holds the program, this README and the licence. To check a download, compare it
against `SHA256SUMS.txt` on the release page (for example `sha256sum -c SHA256SUMS.txt
--ignore-missing` on Linux, or `Get-FileHash` in PowerShell).

If you start the program without `-data`, it looks for a `Data` folder in the current folder,
then next to the program itself. Putting `Data` next to the program therefore works even when
you start it by double-clicking.

### Windows

1. Extract the zip (right-click, **Extract All…**).
2. Put your `Data` folder next to `vault-configurator.exe`, or note where it is.
3. Start it:
   - double-click `vault-configurator.exe`. A console window opens and shows the log; closing
     the window stops the app.
   - or in PowerShell, from the extracted folder:

     ```powershell
     .\vault-configurator.exe -data "D:\VAULT\Data"
     ```

4. Open <http://localhost:8080>.

The program isn't code-signed, so Windows SmartScreen may say "Windows protected your PC": click
**More info**, then **Run anyway**. Windows Firewall may ask whether to allow network access.
Allow it on private networks if you want to use the app from other devices; for this computer
only, cancel the prompt and start the app with `-addr 127.0.0.1:8080`.

### macOS

1. Double-click the `.tar.gz` to extract it, or in Terminal:

   ```bash
   tar -xzf vault-configurator_*_darwin_arm64.tar.gz
   cd vault-configurator_*_darwin_arm64
   ```

2. The program isn't signed or notarised, so macOS blocks it the first time. Clear the download
   quarantine in Terminal, from the extracted folder:

   ```bash
   xattr -d com.apple.quarantine vault-configurator
   ```

   Or try to open it once, then go to **System Settings → Privacy & Security** and click
   **Open Anyway**.
3. Start it from Terminal, then open <http://localhost:8080>:

   ```bash
   ./vault-configurator -data ~/VAULT/Data
   ```

   With the `Data` folder next to the program, you can also double-click it in Finder. It opens
   in a Terminal window; closing that window stops the app.

### Linux (including Raspberry Pi and NAS boxes)

```bash
tar -xzf vault-configurator_*_linux_amd64.tar.gz
cd vault-configurator_*_linux_amd64
./vault-configurator -data /path/to/Data
```

Use the archive that matches your machine (see [the table](#which-file-to-download); on a
Raspberry Pi, `uname -m` prints `aarch64` for arm64 or `armv7l` for armv7). Open
<http://localhost:8080>, or `http://<machine-ip>:8080` from another computer on your network.

To keep it running in the background and start it at boot, install it as a systemd service.
Copy the program to `/opt/vault-configurator/`, then create
`/etc/systemd/system/vault-configurator.service`:

```ini
[Unit]
Description=VAULT Configurator
After=network.target

[Service]
ExecStart=/opt/vault-configurator/vault-configurator -data /srv/vault/Data -cache /var/cache/vault-configurator -warm
DynamicUser=yes
CacheDirectory=vault-configurator
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now vault-configurator
journalctl -u vault-configurator -f    # follow the log
```

`DynamicUser` runs the app as a throwaway user, so the data folder must be readable by everyone.
Replace it with `User=yourname` if your files are private.

### FreeBSD, OpenBSD, NetBSD and other Unix systems

These run the same way as on Linux: extract the archive, then run
`./vault-configurator -data /path/to/Data`. To keep it running after you log out on FreeBSD, use
`daemon(8)`:

```bash
daemon -f -o /var/log/vault-configurator.log /usr/local/bin/vault-configurator -data /path/to/Data
```

### Android (Termux)

In [Termux](https://termux.dev), extract the `android_arm64` archive and run
`termux-setup-storage` once, so the app can read your VAULT files from shared storage. Then run
`./vault-configurator -data ~/storage/shared/VAULT/Data` and open <http://localhost:8080> in your
phone's browser.

### Docker

Data is mounted read-only and the preview cache is kept in a volume:

```bash
docker build -t vault-configurator .
docker run -p 8080:8080 -v "$PWD/Data:/data:ro" -v vault-cache:/cache vault-configurator
```

### Building from source

Requires [Go](https://go.dev/dl/) 1.24 or newer.

```bash
go run . -data Data
```

Build a single self-contained binary (the web front end is embedded):

```bash
go build -o vault-configurator .
./vault-configurator -data /path/to/Data
```

Cross-compile for another system by setting `GOOS` and `GOARCH`, for example a 64-bit Raspberry
Pi:

```bash
GOOS=linux GOARCH=arm64 go build -o vault-configurator-linux-arm64 .
```

To build every release archive at once, run `go run ./tools/release -version v1.0.0`. The
archives go to `dist/`.

### Options

| Flag        | Default | Purpose                                                                 |
| ----------- | ------- | ----------------------------------------------------------------------- |
| `-data`     | `Data`  | Folder with the VAULT files (scanned recursively at start-up)           |
| `-addr`     | `:8080` | Listen address; `127.0.0.1:8080` keeps it to this computer              |
| `-cache`    | `cache` | Where generated preview meshes are stored                               |
| `-warm`     | `false` | Pre-generate every preview in the background at start-up                |
| `-workers`  | half the CPUs, up to 4 | Concurrent preview generators (each can use a few hundred MB on big files) |
| `-max-tris` | 150000  | Triangle budget per preview mesh                                        |
| `-version`  |         | Print the version and exit                                              |

## Limitations

- Quantities for small universal parts (runners, locks, hinges, dividers) are best-effort readings
  of the manuals. Check them against the manuals in the Documentation tab before printing.
- The 3D view is a guide, not CAD: parts are placed from the manuals and measurements of the files,
  so small internal parts can be a few mm off. The parts list is what matters for printing.

## Development

Architecture, design decisions, the API and the notes behind how each part is placed are in
[docs/development.md](docs/development.md).

## License

The code in this repository is released under the [MIT License](LICENSE). three.js in `web/vendor/three` is MIT licensed
(see its `LICENSE`). The VAULT design, its STL files, manuals and images belong to their creator,
aren't covered by this repository, and need their own license.
