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
  swiftc $flags -parse-as-library $core $appsrc -o "$app/Contents/MacOS/ASIAIR Plan Sender"
  cp Resources/Info.plist "$app/Contents/Info.plist"
  [[ -f Resources/AppIcon.icns ]] && cp Resources/AppIcon.icns "$app/Contents/Resources/"
  xattr -cr "$app"
  # Ad-hoc signature: free, no Apple account. macOS asks once before opening it.
  codesign --force --deep --sign - "$app"
  codesign --verify --deep "$app"
  # A zip for GitHub Releases (keeps the app's structure and signature).
  ditto -c -k --keepParent "$app" "$work/ASIAIR-Plan-Sender.zip"
  rm -rf "build/ASIAIR Plan Sender.app"
  ditto "$app" "build/ASIAIR Plan Sender.app"
  cp "$work/ASIAIR-Plan-Sender.zip" build/
  echo "built build/ASIAIR Plan Sender.app and build/ASIAIR-Plan-Sender.zip"
fi
