#!/bin/zsh
# Double-click to open the ASIAIR Mosaic Planner in your browser (macOS).
#
# Serves this folder at http://localhost:8077 and opens it. The address stays
# the same every time, because the browser keeps your rigs and targets per
# address. Only this Mac can reach it (127.0.0.1). It keeps running in the
# background; run this again any time, it reuses the running copy.
#
# Opening the planner from http://localhost (not by double-clicking
# index.html) is also what lets "Send to rig" reach a Star Adventurer
# controller on your network.

cd "$(dirname "$0")"
PORT=8077
URL="http://localhost:$PORT/"

if curl -fsS --max-time 2 "$URL" 2>/dev/null | grep -q "ASIAIR Mosaic Planner"; then
  [[ -z "${NO_OPEN:-}" ]] && open "$URL"
  exit 0
fi

if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is used by another program, so the planner can't start."
  echo "Close that program and try again."
  read -k1 "?Press any key to close."
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1 || ! python3 -c 'pass' >/dev/null 2>&1; then
  echo "The planner needs Python 3 to serve its page."
  echo "macOS will offer to install Apple's command line tools (which include it): run  xcode-select --install"
  read -k1 "?Press any key to close."
  exit 1
fi

# A plain file server, but telling the browser to check for newer files each
# time, so an updated planner shows up straight away.
SERVER='
import http.server, sys
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()
http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
'
nohup python3 -c "$SERVER" $PORT >/dev/null 2>&1 &
disown
for _ in {1..40}; do
  curl -fsS --max-time 1 "$URL" >/dev/null 2>&1 && break
  sleep 0.25
done
[[ -z "${NO_OPEN:-}" ]] && open "$URL"
# Close this Terminal window (the planner keeps running).
[[ -z "${NO_OPEN:-}" ]] && osascript -e 'tell application "Terminal" to close (every window whose name contains "Open Planner")' >/dev/null 2>&1 &
exit 0
