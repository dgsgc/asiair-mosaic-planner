#!/bin/zsh
# Build the ASIAIR Plan Sender: the command-line tool and the Mac app.
# Needs Apple's command line tools (xcode-select --install). Apple Silicon only,
# like the ASIAIR app for Mac.
#
#     ./build.sh            → build/asiair-send and build/ASIAIR Plan Sender.app
set -eu
cd "$(dirname "$0")"
mkdir -p build

flags=(-O -target arm64-apple-macos13)
core=(Sources/Core/*.swift)

ui=(Sources/SenderUI/*.swift)

# Signing. With a code-signing certificate of your own (SIGN_IDENTITY, or the
# local one tools/make-signing-cert.sh makes in ~/.asiair-signing), macOS
# recognises each new build as the same app, so permissions such as
# Accessibility survive updates. Without one, the apps get an ad-hoc signature
# and macOS asks again after every build.
sign_id="-"
local_kc="$HOME/.asiair-signing/signing.keychain-db"
if [[ -n "${SIGN_IDENTITY:-}" ]]; then
  sign_id="$SIGN_IDENTITY"
elif [[ -f "$local_kc" && -f "$HOME/.asiair-signing/password" ]]; then
  security unlock-keychain -p "$(cat "$HOME/.asiair-signing/password")" "$local_kc"
  sign_id="ASIAIR Mosaic Planner local signing"
fi
echo "signing with: ${sign_id/#-/ad-hoc signature}"
swiftc $flags $core Sources/CLI/main.swift -o build/asiair-send
echo "built build/asiair-send"

appsrc=(Sources/App/*.swift(N))
if (( ${#appsrc} )); then
  # Assemble and sign outside synced folders (iCloud adds file attributes
  # that codesign refuses), then copy the results into build/.
  work="${TMPDIR:-/tmp}/asiair-plan-sender-build"
  rm -rf "$work"; mkdir -p "$work"
  app="$work/ASIAIR Plan Sender.app"
  mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
  swiftc $flags -parse-as-library $core $ui $appsrc -o "$app/Contents/MacOS/ASIAIR Plan Sender"
  cp Resources/Info.plist "$app/Contents/Info.plist"
  [[ -f Resources/AppIcon.icns ]] && cp Resources/AppIcon.icns "$app/Contents/Resources/"
  xattr -cr "$app"
  codesign --force --deep --sign "$sign_id" "$app"
  codesign --verify --deep "$app"
  # A zip for GitHub Releases (keeps the app's structure and signature).
  ditto -c -k --keepParent "$app" "$work/ASIAIR-Plan-Sender.zip"
  rm -rf "build/ASIAIR Plan Sender.app"
  ditto "$app" "build/ASIAIR Plan Sender.app"
  cp "$work/ASIAIR-Plan-Sender.zip" build/
  echo "built build/ASIAIR Plan Sender.app and build/ASIAIR-Plan-Sender.zip"
fi

# The ASIAIR Mosaic Planner app: the planner page (index.html, src, data from
# the folder above) bundled with the Plan Sender built in.
plannersrc=(Sources/Planner/*.swift(N))
if (( ${#plannersrc} )); then
  work="${TMPDIR:-/tmp}/asiair-mosaic-planner-build"
  rm -rf "$work"; mkdir -p "$work"
  app="$work/ASIAIR Mosaic Planner.app"
  mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/planner"
  swiftc $flags -parse-as-library $core $ui $plannersrc -o "$app/Contents/MacOS/ASIAIR Mosaic Planner"
  cp Resources/Planner-Info.plist "$app/Contents/Info.plist"
  # Icons: drawn by tools/make_icon.swift (PlannerIcon without, AppIcon with the send badge).
  [[ -f Resources/PlannerIcon.icns ]] && cp Resources/PlannerIcon.icns "$app/Contents/Resources/AppIcon.icns"
  cp ../index.html "$app/Contents/Resources/planner/"
  cp -R ../src ../data "$app/Contents/Resources/planner/"
  xattr -cr "$app"
  codesign --force --deep --sign "$sign_id" "$app"
  codesign --verify --deep "$app"
  ditto -c -k --keepParent "$app" "$work/ASIAIR-Mosaic-Planner.zip"
  rm -rf "build/ASIAIR Mosaic Planner.app"
  ditto "$app" "build/ASIAIR Mosaic Planner.app"
  cp "$work/ASIAIR-Mosaic-Planner.zip" build/
  echo "built build/ASIAIR Mosaic Planner.app and build/ASIAIR-Mosaic-Planner.zip"
fi
