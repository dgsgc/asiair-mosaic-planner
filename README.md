# ASIAIR Mosaic Planner

Plan single targets and mosaics for ZWO ASIAIR rigs on real sky images, during the day, then paste the panels into the ASIAIR app's plan.

It's a single web page with no server of its own. Your rigs and targets stay in your browser. It never connects to an ASIAIR.

## What it does

- **Rigs:** add each rig's focal length and camera (common ZWO cameras are listed), or type the field of view from a plate solve, which is more exact. Each rig gets a colour, so several rigs can be planned side by side.
- **Targets:** search by name (M31, NGC 7000, Veil Nebula, anything SIMBAD, NED or VizieR know) or type "RA, Dec". The rig's frame is drawn on sky survey images (DSS, Pan-STARRS and others).
- **Framing by dragging:** the selected target's frame or mosaic stays in the middle of the sky view; drag the sky underneath it to frame the shot. Tick "Lock position" once you're happy, so later panning doesn't move it.
- **Mosaics:** set columns, rows, overlap (15% by default, as the ASIAIR app recommends) and angle. The panel centres and each panel's own angle are worked out on the sky, not on a flat grid.
- **Exposures:** give each target its exposure lines (type, exposure, gain, count, binning) and see the time per panel and for the whole mosaic.
- **Into the ASIAIR app:** "Copy this target" or "Copy all for <rig>" puts the panels on the clipboard in the ASIAIR app's own plan text format (the one its Share button writes). Paste it with Import on the app's Plan screen. Panels are named the way the app names its own mosaics, for example `NGC 7000_1-2`.
- **Plan files:** save and open your rigs and targets as a JSON file, to move them to another computer.

## Using it

**On a Mac:** double-click **Open Planner.command**. It serves the planner on this Mac at <http://localhost:8077> and opens it in your browser. The first time, macOS may ask whether to open it: right-click it, choose **Open**, then **Open** again.
- **Same address every time:** your rigs and targets are kept by your browser for that address, so always open the planner the same way.
- **Running in the background:** the planner keeps running after the Terminal window closes, and double-clicking again reuses it.
- **Python:** it needs Python 3. If it's missing, macOS offers to install Apple's command line tools, which include it.

**Anywhere else:** serve the folder with any web server (browsers don't load the planner's modules from `file://`), for example:

```bash
python3 -m http.server 8077 --bind 127.0.0.1
```

then go to <http://localhost:8077>. It can also be hosted as-is on GitHub Pages; that copy can do everything except **Send to rig**.

## Sending plans to the ASIAIR

The planner can't write to an ASIAIR itself (the ASIAIR only takes plans from ZWO's app). Two ways to get a plan in:

- **ASIAIR Plan Sender** (Mac, Apple silicon): save a send file with "Send file: this target" or "Send file: all for <rig>", then open it in the [Plan Sender](helper/README.md) with the ASIAIR app open. Each target becomes its own ASIAIR plan, exposures included.
- **By hand:** copy the panels, paste them with Import in the ASIAIR app's plan, and add the exposure lines in the app.

## Sending plans to a Star Adventurer controller

A rig can instead be set to **Controller: Star Adventurer controller** (in the rig's settings), with the controller's address (default `http://rig.local`). Its targets then get **Send to rig: this target** and **Send to rig: all for <rig>**, which POST the same send file the Plan Sender uses to `<address>/plan`. The controller stores the panels and the first Light exposure line; nothing moves or shoots until you start it there. The controller's reply lists what it took and any notes (other exposure lines ignored, a plan made for a different field of view).

For these rigs:
- **Overlap:** new targets start with 20% overlap.
- **Exposure lines:** the exposures section says which line the controller will shoot, and warns when other lines will be ignored. Totals count only that line.
- **Camera angle:** the send file carries the camera angle (as the ASIAIR shows it), both the rig's (`rig.angle`) and each plan's own (`plans[].angle`). The controller can then warn when the camera is turned differently.

Browsers only let a page send to a device on your network when the page itself is local, so open the planner from your computer (`http://localhost`, see [Using it](#using-it)). From an https copy, use **Save send file** and load the file on the controller's page instead.

## What the ASIAIR app does with the pasted text

Checked with ASIAIR app 3.0.0:

- **Paste adds targets to the open plan.** Make or open the plan first.
- **Exposures can't be pasted.** The app ignores any extra columns, so add the exposure lines to one panel in the app, then use that panel's copy button, "Copy Schedule to All".
- **Coordinates are J2000.** The app shows them precessed to today's date, so they look a little different. That's expected.
- **No camera angle is stored** for pasted targets. Plate-solve one frame before the first night and set the camera angle to match the angle here.
- **Angles are the ASIAIR's.** Every angle in the planner is the number the ASIAIR shows after a plate solve (or as "Rotation" in its sky atlas). The ASIAIR measures the other way round from a position angle: the frame's top points to 180° − angle, east of north.
- **Panel names:** `_<row>-<col>`, with row 1 along the frame's top and column 1 on its left (at ASIAIR angle 180°, top is north and left is east).
- The app is fussy about the format: Dec must use °, ′ and ″, not ' and ".

## Development

```bash
npm test
```

runs the geometry tests (Node 20 or later, no packages needed). One test checks the output against a real Telescopius export.

- `src/mosaic.js` — the geometry and CSV format, with no browser code.
- `src/app.js` — the page: rigs, targets, the sky view and copying.
- Sky view: [Aladin Lite](https://aladin.cds.unistra.fr/AladinLite/) 3.8.2 from jsDelivr. Survey images come from CDS HiPS servers and their mirrors; the page picks a copy that's answering. Names are looked up with the CDS Sesame service (CDS and Harvard copies).

## Not affiliated

This is an unofficial tool. It isn't made or supported by ZWO. ASIAIR is a ZWO trademark.
