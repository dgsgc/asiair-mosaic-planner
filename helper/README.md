# ASIAIR Plan Sender

A small Mac app that puts complete plans from the [ASIAIR Mosaic Planner](../README.md) into the ASIAIR app for Mac: every mosaic panel as a target, with its exposure lines. Each planner target becomes its own ASIAIR plan. You can do it in daylight with the ASIAIR on a desk; nothing is ever started.

It works the ASIAIR app the way you would, through macOS accessibility: it creates the plan, pastes the panels with the app's own Import, adds the exposure lines to the first panel, and lets the app apply them to all the panels. ZWO's app does the actual saving to the ASIAIR.

Unofficial. Not made or supported by ZWO.

## What you need

- A Mac with Apple silicon (M1 or later), macOS 13 or later. The ASIAIR app only runs on these.
- The ASIAIR app for Mac, from the App Store, connected to your ASIAIR. Tested with ASIAIR app 3.0.0 and ASIAIR firmware 14.39.
- A send file (`.asiairplan`) saved from the planner.

## Install

1. Download `ASIAIR-Plan-Sender.zip` from the Releases page, unzip it, and move **ASIAIR Plan Sender** to Applications.
2. **First opening:** the app isn't signed with a paid Apple developer certificate, so macOS warns about it. Right-click (or Control-click) the app and choose **Open**, then **Open** again. On recent macOS versions you may instead need System Settings → Privacy & Security → **Open Anyway**. You only do this once.
3. **Allow it to operate other apps:** the first time, Plan Sender shows a button to open the right settings page. In System Settings → Privacy & Security → **Accessibility**, turn on **ASIAIR Plan Sender**. macOS may ask again after you install a new version.

Prefer to build it yourself? See [Building](#building) below.

## Using it

1. In the planner, set up your targets and exposure lines, then press **Send file: this target** or **Send file: all for <rig>**.
2. Open the ASIAIR app and connect it to the ASIAIR the plans are for (check you picked the right rig in the planner).
3. Open the send file in Plan Sender: double-click it, drop it on the window, or use **Open…**. Untick any plans you don't want.
4. Press **Send to ASIAIR**. Plan Sender brings the ASIAIR app to the front and works through each plan, about a minute per plan.
   - **Don't use the mouse or keyboard until it says it's done.** A few of the app's buttons only respond to a real click, so Plan Sender moves the pointer.
   - Keep the Mac unlocked. Plan Sender keeps the screen awake while it works.
5. Check the plans in the ASIAIR app, then start one when you're ready, as usual.

If the ASIAIR app is on its main screen in another mode (Preview, Live…), Plan Sender switches it to Plan mode and opens the plan page first.

## What it does and doesn't do

For each plan in the file it:

1. refuses to start if the ASIAIR already has a plan with that name
2. creates a new plan with that name (plan options are left at the app's defaults)
3. imports the panels with the app's **Import**
4. adds each exposure line (type, exposure, gain, count, binning) to the first panel, and checks each line on screen
5. answers the app's "Apply current sequence and settings to all importing targets" with **Apply**, so every panel gets the same lines

It never starts a plan, never presses the shutter or any mount, guiding, focus or camera control, and never changes or deletes your existing plans. It stops at the first thing it doesn't expect and says what happened. When it stops, it saves a description of the screen to your Desktop (`plan-sender-debug-….txt`), which helps if you report a problem.

## Known limits

- **Filter wheels:** the planner doesn't have a filter per exposure line yet. On rigs with a filter wheel the app's exposure dialog has a filter choice, which Plan Sender leaves as it is. Not yet tested with a filter wheel.
- **Plan options** (auto guiding, meridian flip, cooling, start and end times, end-of-plan actions) are left at the app's defaults. Set them in the app afterwards.
- **Pop-ups:** if the ASIAIR app shows a message while Plan Sender works (for example "Device Changed"), Plan Sender stops. Close the message, delete the half-made plan in the app, and send again.
- **Updates to the ASIAIR app** can move or rename its controls. If Plan Sender stops working after an update, please report it.
- The ASIAIR app's window should stay its normal size.

## Building

You need Apple's command line tools (`xcode-select --install`).

```bash
./build.sh
```

This builds `build/ASIAIR Plan Sender.app` and a command-line version, `build/asiair-send`:

```bash
build/asiair-send check my-plans.asiairplan   # show what would be sent
build/asiair-send send my-plans.asiairplan    # send it (add --verbose for detail)
build/asiair-send plans                       # list the plans on the ASIAIR
build/asiair-send dump                        # list the ASIAIR app's controls (read-only)
```

The command-line version needs the same Accessibility permission, given to the Terminal app you run it from.

## How it finds things

- **Named controls:** most of the ASIAIR app's controls have accessibility names ("Import", "Confirm", "Bin2", "plan copy"…), and Plan Sender only presses those.
- **Unnamed buttons:** the two that have no name (the plan-page button and the plan-list button) are found by their exact place next to named ones. After each press, Plan Sender checks that the expected screen appeared.
- **Pop-ups:** the app's pop-ups are invisible to accessibility, so their buttons are tapped at their measured spot, only while the page underneath shows that the pop-up should be there.
