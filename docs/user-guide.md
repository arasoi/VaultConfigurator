# VAULT Configurator user guide

The configurator helps you plan a VAULT storage build, see it in 3D, and download exactly the STL
files and hardware you need to print and assemble it. It reads your own copy of the VAULT files
(see [Data files](../README.md#data-files-not-included) in the README); nothing is downloaded from
the internet.

- [Getting started](#getting-started)
- [The Build tab](#the-build-tab)
  - [Build options (left panel)](#build-options-left-panel)
  - [3D view](#3d-view)
  - [Parts list and downloads (right panel)](#parts-list-and-downloads-right-panel)
- [Colours](#colours)
- [Saving and sharing builds](#saving-and-sharing-builds)
- [Gridfinity bins](#gridfinity-bins)
  - [The Bins tab](#the-bins-tab)
  - [Planning bins in a drawer or sustainer](#planning-bins-in-a-drawer-or-sustainer)
- [The Parts library tab](#the-parts-library-tab)
- [The Documentation tab](#the-documentation-tab)
- [Tips and limits](#tips-and-limits)

## Getting started

1. Start the app with your data folder, for example `vault-configurator -data Data`. See the
   README's [Installing and running](../README.md#installing-and-running) section for downloads
   and instructions for each operating system.
2. Open <http://localhost:8080>. The **Build** tab opens with an example build.
3. Change the build on the left, check it in the 3D view, then use **Download STLs** on the
   right to get a ZIP of everything to print.

The first time a large part is shown, the server prepares a lightweight preview of it, which can take
a few seconds; after that it loads instantly.

## The Build tab

![The Build tab: options on the left, 3D view in the middle, parts list on the right](images/build-trolley.png)

The Build tab has three columns: **build options** on the left, the **3D view** in the middle, and
the **parts list** on the right. Every change updates the view and the list straight away.

### Build options (left panel)

<img src="images/stack-editor.png" alt="The stack editor in the left panel" width="300" align="right">

**Name.** The name at the top is used for the ZIP and snapshot file names.

**Footprint.** Choose the **width** (S 165 mm, M 254 mm, L 330 mm, XL 419 mm) and the **depth**
in gridfinity units (3–7, from 146 mm to 314 mm). Every level in the stack shares this footprint.

**Stack.** The stack is shown top level first, like the real tower. Use **+ Add level** to add a
copy of the top level. For each level you can set:

- **Height:** 1F, 2F or 4F. Heights that don't exist for the current size or type are greyed out.
- **Layout** (L and XL only): one full-width module, an **L²/XL²** module (two drawers side by
  side in one module, drawers only), or two narrower modules side by side (**S + S** for L;
  **S + M** or **M + S** for XL).
- **Drawer or Sustainer** for each module. Drawers slide out; sustainers are boxes with a hinged,
  latched lid.
- **Interior:**
  - Drawers: empty, grid dividers, or a gridfinity baseplate (plain, or with one or two handles).
  - Sustainers: flat, gridfinity base, dividers, or sealed (L/XL only).
  - Dividers have their own counts: across, front-back, full height, or sealed rows.
- **Drawers inside** (2F/4F drawers): a tall module can hold a stack of smaller drawers instead of
  one tall one, for example 2F + 1F + 1F. In L²/XL² modules the left and right sides each get their
  own drawers and interior.
- **Level tools:** move the level up (↑) or down (↓), duplicate it (⧉) or remove it (✕).

**Roof.** Pick the roof for the top level: gridfinity, table, bowl, heavyweight (L/XL),
heavyweight cut (XL), under-table mount, or none. The gridfinity and heavyweight roofs can take the
**top carry handle**. A roof also fits on a sustainer's lid (the lid has the same alignment keys as
a module top) and lifts with the lid when it opens; choose **No roof** to leave the lid bare.

**Drawers.** Choose the drawer **handle**: a knob, or a flush **hidden key**, with one removable key
per build. Builds with grid dividers also choose loose or tight divider pins, and straight or
rounded border pieces.

**Base.** Choose no base, **base + feet** (stationary), **base + wheels** (mobile, with one foot at
the front), or **base + casters**.

**Back & mounting.**

- **Backbone:** boards across the back that reinforce and connect the modules.
- **Pull-out handle:** a trolley handle on two M16 rods. A handle lock takes the place of the top
  backbone board.
- **Stationary handle:** a fixed handle bolted to a backbone board.
- **Backbone boards:** full width, or universal (narrow boards at each side).
- **Module connectors:** pieces that tie stacked modules together at the back.
- **Wall mounts:** for hanging the stack on a wall.
- **Pegboard attachment:** IKEA Skådis or USSA pegboard plates on the backbone.

Handles and pegboards need the backbone, so it is added automatically when you pick them.

**Accessories & extras.** Add pegboard hooks, containers, container hooks, holders, or extra grid
divider pieces, with a quantity for each. They are listed separately and shown on a shelf beside the
build.

**Colors.** See [Colours](#colours) below.

**Hardware.** The bolts, rods, bearings, stoppers and heat inserts from the hardware list are drawn
in 3D in metal, each in its own hole with the head type the manual calls for (button heads for
the M4 bolts and the M6 90 foot bolts, a countersunk head for the M6 50 roof handle bolts, hex
heads for the handle lock bolts). **Screw finish** switches the bolts between **Silver**, **Brass**
and **Black**; rods, bearings and stoppers stay steel and the heat inserts brass. Untick
**Show hardware in 3D** to hide it all. Most screws sit inside the parts, so use a part's card or
the explode slider to see them; heads show on the back of a backbone and on the wheels.

**Printing.**

- **Split large prints:** uses the Part 1 / Part 2 files where they exist, for depths 6–7 that
  don't fit smaller printers.
- **Manual supports:** adds the print-aid files for tall modules.

**Build.** **Export JSON**, **Import JSON** and **Reset** (see
[Saving and sharing builds](#saving-and-sharing-builds)).

<br clear="right">

### 3D view

![Open drawers and lids with the explode slider](images/open-explode.png)

- **Rotate:** drag with the left mouse button. **Pan:** drag with the right button. **Zoom:**
  scroll.
- **Click a part** to select it (an orange outline; its row is highlighted in the parts list).
- **Right-click a part** (long-press on a touch screen) for its menu:
  - **Pull drawer out** / **Open sustainer**, on anything in a drawer or sustainer, such as a bin.
    A drawer comes all the way out on its runners; a sustainer opens its lid, and the levels above
    lift off so you can see inside, e.g. to check a bin layout. Only one opens at a time. Choose
    **Push drawer in** / **Close sustainer**, or use the button of that name in the toolbar, to put
    it back.
  - **Colour & details…** opens the part's card: the file name and path, how many to print for
    this build, its colour, a **Download STL** link, and how the part was oriented in the preview.
    While the card is open, clicking another part shows that part instead.
  - **Download STL** downloads that part's file.
- **Open drawers & lids** slides the drawers out and opens the sustainer lids. **Explode** pulls the
  levels and parts apart so you can see how they fit together.
- **Fit view** brings the whole build back into view. **Snapshot** saves the current view as a PNG.
- The overall size of the build (width × depth × height in mm) is shown in the top-left corner.
- Hover a row in the parts list to highlight that part in 3D.
- The **◐** button in the top-right switches between light and dark themes.

### Parts list and downloads (right panel)

<img src="images/parts-list.png" alt="Parts list with filament summary" width="280" align="right">

- **Totals:** the number of different files, the total number of prints, and the build height.
- **Warnings:** shown when an option was adjusted, for example backbone parts added for a handle,
  or a combination to check against the manual.
- **Download STLs (.zip)** downloads every file the build needs. Inside the ZIP, files are grouped
  in one folder per filament colour, keep the original VAULT folder structure, and are named with
  the print count, for example `My VAULT/Orange/…/Key Cap (print x2).stl`.
- **Share** copies a link to this build (see below).
- **Filament** shows how many prints you need in each colour.
- **Printed parts** are grouped by section (drawers, sustainers, roof, base, backbone and handles,
  and so on). Each row shows the quantity, the colour(s), a short note on what the part is for, and
  a **↓ STL** link for that one file. A file printed in two colours is split, for example
  "2 × Orange, 1 × Green".
- **Print aids** (manual supports, the wheel bushing jig) are listed but never drawn.

<br clear="right">

<img src="images/hardware.png" alt="Hardware list" width="260" align="right">

**Hardware** lists the bolts, threaded rods, bearings, heat inserts and stoppers to buy, with
quantities. The rod lengths match your width; the pull-out handle rods are cut to the height of
your tower.

Quantities for small universal parts are taken from the manuals as well as possible. Check them
against the Documentation tab before printing.

<br clear="right">

## Colours

![Colouring parts: presets, colour groups and the part card](images/color-card.png)

- **Preset:** start from Classic, Orange accents, Stealth, Arctic or Toy box.
- **Colour groups:** every kind of part belongs to a group, such as modules & roofs, facades, drawer
  boxes, knobs & handles, latches, hinges, base, feet & wheel hubs, tyres, backbone, or internal
  parts. Click a group's swatch to change it, and **↺** to go back to the preset colour.
- **Single parts:** right-click a part in the 3D view, choose **Colour & details…**, then **Just this part** or **All copies**
  (every copy of that file) and pick a colour. **↺ Use group color** removes the override.

The colours drive the filament summary and the folders in the ZIP download, and they are saved with
the build and in share links.

## Saving and sharing builds

- **Autosave:** your current build is saved in the browser automatically and comes back next time
  you open the app.
- **Share:** copies a link with the whole build (layout, options and colours) encoded in it.
  Opening the link loads that build.
- **Export JSON / Import JSON:** saves the build as a file and loads it again, for backups or for
  keeping several builds.
- **Reset:** goes back to the example build.

<img src="images/desk-tower.png" alt="A desk tower: M width, feet, a 4F module holding three drawers, a sustainer and two 1F drawers">

*A different build: an M-width desk tower on feet, with a 4F module holding three drawers
(2F + 1F + 1F), a 2F sustainer with a gridfinity base, a grid-divider drawer and a table roof, in
the Arctic preset.*

## Gridfinity bins

VAULT drawers and sustainers take Gridfinity baseplates. The app makes bins that fit them, keeps the
ones you save in a library on the server, and lets you lay them out in each drawer.

| Space | Cells across | Cells front to back | Tallest bin |
| --- | --- | --- | --- |
| S / M / L / XL drawer | 3 / 5 / 6 / 8 | the depth (3–7) | 1F 34.5 mm · 2F 82.5 mm · 4F 178.5 mm |
| S / M / L / XL sustainer | 3 / 5 / 7 / 9 | the depth (3–7) | 1F 52 mm · 2F 86.5 mm · 4F 182 mm |

L² and XL² drawers count each side as its own drawer (S + S, or S + M).

### The Bins tab

- **Size**: width and depth in grid cells (42 mm each; a bin is 0.5 mm smaller than its cells) and
  height in 7 mm units. The height list shows each option's real height, and the green badges
  show which drawers and sustainers it fits.
- **Features**: stacking lip (adds 4.4 mm), magnet holes (6 × 2 mm magnets) and M3 screw holes in
  every foot, a 45° label tab along the back of each compartment, and a finger scoop along the
  front of each compartment.
- **Compartments**: split the bin into a grid of compartments (at least 10 mm wide each).
- The 3D view updates as you change settings; it shows the bin's outer size, triangle count and
  roughly how much filament it would take printed solid.
- **Save to library** stores the bin (STL plus its settings) on the server, so it's ready to use in
  any build. **Download STL** saves just the file.
- **Starter set** adds five common bins (1×1, 1×2, 1×3, 2×2, 2×3, all 4 units with a lip), which fit
  every 1F drawer.
- In the **Bin library** list, click a bin to load it back into the generator (to tweak it or rename
  it), **↓** to download it, or **✕** to delete it.

The library lives in the server's `bins` folder (`-bins` option), separate from your VAULT files.
Saved bins also appear in the Parts library tab, under *Gridfinity bins*.

### Planning bins in a drawer or sustainer

Give a drawer a *Gridfinity baseplate* interior (or a sustainer a *Gridfinity base*), and a
**Bins** button appears under it, one per drawer if a tall module holds several. It opens the
planner:

- The left side lists your library. Bins that are too tall for this space are greyed out.
- The grid is the drawer seen from above, front at the bottom. Click a cell to drop the selected bin
  with its front-left corner there; a green outline shows where it will go, red if it doesn't fit.
- **Turn 90°** (or the `R` key) rotates the bin. **Fill empty cells** fills every gap with the
  selected bin. Click a placed bin to remove it.

Placed bins are drawn in the 3D view (right-click the drawer and choose **Pull drawer out** to see them), have their own
colour group, and are added to the parts list under *Gridfinity bins* and to the ZIP. If a planned
bin later doesn't fit (for example after changing the depth) or was deleted from the library, it's
left out with a warning, and comes back when it fits again.

## The Parts library tab

![The Parts library: search, folder tree and preview](images/parts-library.png)

The Parts library lists every file in your data folder, in the original folder structure.

- **Search** by name, for example `L5 2F`, `hinge` or `roof`. You can also narrow the list to one
  category.
- **Click a file** to preview it in 3D. The card shows its size in mm, its triangle count, the size,
  depth and height tags the app read from its name, and a **Download STL** button.
- **Rotate 90°** around X, Y or Z, and **Fit view**, to inspect a part from any side.

Files the app doesn't recognise still appear here, under *Other*.

## The Documentation tab

The Documentation tab lists the manuals (PDF), the reference images and any notes from your data
folder. Click one to open it in a new browser tab. The VAULT manuals are the reference for assembly,
print settings and hardware.

## Tips and limits

- **First previews are slow.** The first view of a large part takes a few seconds while its preview
  is generated. Start the server with `-warm` to prepare every preview in the background.
- **The 3D view is a guide, not CAD.** Parts are placed from the manuals and from measurements of
  the files, so small internal parts (springs, pins, runners) can be a few mm off. The parts list
  is what matters for printing.
- **Missing or damaged files** show as red boxes in the 3D view; click one to see why (file
  missing, not a valid STL, or the server couldn't be reached). The status bar above the view
  counts them and has a **Retry** button, and the parts list warns about parts with no file at
  all. ZIP downloads still work: they leave such files out and list them in `MISSING FILES.txt`.
- **Keep the data folder as it is.** The app recognises files by their original folder and file
  names, and it never changes them. If you rename or move files, they will be missed or listed
  under *Other*.
- **Licensing.** The configurator only reads the VAULT files you supply. Don't share an instance or
  the downloaded files with anyone your VAULT licence doesn't cover.
