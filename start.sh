#!/usr/bin/env bash
# SysDesign Studio launcher.
# Drag this file into a terminal and press Enter (or run: bash start.sh).
# It finds Node (nvm / fnm / volta / asdf / mise / Homebrew / system), installs
# dependencies if missing, serves the app on a free port and opens the browser.
#
# Options:  PORT=4000 bash start.sh     use a specific port
#           NO_OPEN=1 bash start.sh     don't open the browser
#           bash start.sh --dev         dev mode with hot reload (slower page loads)
#           bash start.sh --webpack     dev mode with webpack instead of Turbopack
# Default is the fast mode: build once (only again after code changes), then serve prebuilt pages.

set -u

APP_NAME="SysDesign Studio"
MIN_NODE_MAJOR=18
MIN_NODE_MINOR=18          # Next.js 15 needs Node >= 18.18
PREFERRED_NODE=22          # also written in .nvmrc

# --- go to the project folder, wherever this script was called from ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
cd "$SCRIPT_DIR" || { echo "Cannot cd into $SCRIPT_DIR"; exit 1; }

say()  { printf '\033[1;36m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*"; exit 1; }

# --- make common install locations visible (GUI-launched shells often lack them)
for p in /opt/homebrew/bin /usr/local/bin "$HOME/.volta/bin" "$HOME/.local/bin" \
         "$HOME/.fnm" "$HOME/.local/share/fnm" "$HOME/n/bin" "$HOME/.asdf/shims" \
         "$HOME/.local/share/mise/shims"; do
  [ -d "$p" ] && case ":$PATH:" in *":$p:"*) ;; *) PATH="$p:$PATH" ;; esac
done
export PATH

# --- try version managers, in order; each one is optional ---------------------
use_version_manager() {
  # nvm
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  local nvm_sh=""
  for f in "$NVM_DIR/nvm.sh" /opt/homebrew/opt/nvm/nvm.sh /usr/local/opt/nvm/nvm.sh; do
    [ -s "$f" ] && { nvm_sh="$f"; break; }
  done
  if [ -n "$nvm_sh" ]; then
    # shellcheck disable=SC1090
    . "$nvm_sh" --no-use
    if nvm use >/dev/null 2>&1 || nvm use "$PREFERRED_NODE" >/dev/null 2>&1; then
      say "Using nvm ($(node -v))"; return
    fi
    say "Installing Node $PREFERRED_NODE with nvm…"
    nvm install "$PREFERRED_NODE" >/dev/null && nvm use "$PREFERRED_NODE" >/dev/null && {
      say "Using nvm ($(node -v))"; return; }
  fi

  # fnm
  if command -v fnm >/dev/null 2>&1; then
    eval "$(fnm env --shell bash 2>/dev/null)"
    if fnm use --install-if-missing >/dev/null 2>&1 \
       || fnm use --install-if-missing "$PREFERRED_NODE" >/dev/null 2>&1; then
      say "Using fnm ($(node -v))"; return
    fi
  fi

  # volta (pins per project via package.json; otherwise uses its default)
  if command -v volta >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then
    say "Using volta ($(node -v))"; return
  fi

  # mise / asdf (read .nvmrc / .tool-versions themselves)
  if command -v mise >/dev/null 2>&1; then
    eval "$(mise activate bash 2>/dev/null)"; mise install -y node >/dev/null 2>&1 || true
  elif [ -s "$HOME/.asdf/asdf.sh" ]; then
    # shellcheck disable=SC1091
    . "$HOME/.asdf/asdf.sh"
  fi
}

use_version_manager

command -v node >/dev/null 2>&1 || die "Node.js not found. Install Node $PREFERRED_NODE from https://nodejs.org (or via nvm/fnm) and run this again."
command -v npm  >/dev/null 2>&1 || die "npm not found (it ships with Node.js). Reinstall Node $PREFERRED_NODE from https://nodejs.org."

NODE_VER="$(node -p 'process.versions.node')"
NODE_MAJOR="${NODE_VER%%.*}"
NODE_MINOR="$(echo "$NODE_VER" | cut -d. -f2)"
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ] || { [ "$NODE_MAJOR" -eq "$MIN_NODE_MAJOR" ] && [ "$NODE_MINOR" -lt "$MIN_NODE_MINOR" ]; }; then
  die "Node $NODE_VER is too old (need ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}+, $PREFERRED_NODE recommended). Upgrade, e.g. 'nvm install $PREFERRED_NODE'."
fi
say "Node $NODE_VER · npm $(npm -v)"

# --- install dependencies only if they aren't there yet ------------------------
# (after pulling new dependencies, run `npm install` yourself)
if [ ! -x node_modules/.bin/next ]; then
  say "Installing dependencies (first run takes a minute)…"
  if [ -f package-lock.json ]; then npm ci || npm install || die "npm install failed"
  else npm install || die "npm install failed"; fi
fi

# --- pick a free port ----------------------------------------------------------
port_busy() {
  if command -v lsof >/dev/null 2>&1; then lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else (echo >/dev/tcp/127.0.0.1/"$1") >/dev/null 2>&1; fi
}
PORT="${PORT:-3000}"
start_port="$PORT"
while port_busy "$PORT"; do
  PORT=$((PORT + 1))
  [ "$PORT" -gt $((start_port + 20)) ] && die "No free port between $start_port and $PORT."
done
[ "$PORT" != "$start_port" ] && warn "Port $start_port is busy, using $PORT."
URL="http://localhost:$PORT"

# --- open the browser once the server answers ----------------------------------
open_browser() {
  if [ "$(uname)" = "Darwin" ]; then open "$1"
  elif command -v wslview  >/dev/null 2>&1; then wslview "$1"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1
  elif command -v cmd.exe  >/dev/null 2>&1; then cmd.exe /c start "" "$1"
  elif command -v start    >/dev/null 2>&1; then start "" "$1"
  else warn "Open $1 in your browser."; fi
}

if [ "${NO_OPEN:-0}" != "1" ]; then
  (
    for _ in $(seq 1 180); do      # up to ~3 min for the first compile
      if curl -s -o /dev/null --max-time 2 "$URL" 2>/dev/null; then
        say "Opening $URL"; open_browser "$URL"; exit 0
      fi
      sleep 1
    done
    warn "Server didn't answer yet; open $URL yourself."
  ) &
  OPENER_PID=$!
fi

cleanup() { [ -n "${OPENER_PID:-}" ] && kill "$OPENER_PID" 2>/dev/null; }
trap cleanup EXIT INT TERM

case "${1:-}" in
  --dev|--webpack)
    # Hot reload for editing code. Every page compiles on its first visit (slow on low-RAM machines).
    SCRIPT="dev"; [ "$1" = "--webpack" ] && SCRIPT="dev:webpack"
    say "Starting $APP_NAME in DEV mode at $URL  (Ctrl+C to stop; each page compiles on first visit)"
    npm run "$SCRIPT" -- --port "$PORT"
    ;;
  *)
    # Fast mode: a prebuilt production server. Pages are pre-rendered, so they load in milliseconds.
    # Built into .next-prod (never the dev server's .next). Progress still goes to data/profile.json.
    export NEXT_DIST_DIR=".next-prod"
    export NEXT_PUBLIC_PROGRESS_STORAGE="file"
    stale=0
    if [ ! -f .next-prod/BUILD_ID ]; then
      stale=1
    elif [ -n "$(find src public package.json package-lock.json next.config.mjs postcss.config.mjs tsconfig.json \
                  -newer .next-prod/BUILD_ID -type f 2>/dev/null | head -1)" ]; then
      stale=1
    fi
    if [ "$stale" -eq 1 ]; then
      say "Building the fast version (only after code changes; takes a minute or two)…"
      # next build rewrites next-env.d.ts to point at .next-prod; put it back so git stays clean.
      env_backup="$(cat next-env.d.ts 2>/dev/null)"
      npx next build; build_status=$?
      [ -n "$env_backup" ] && printf '%s\n' "$env_backup" > next-env.d.ts
      [ "$build_status" -eq 0 ] || die "Build failed (see above). Try: bash start.sh --dev"
    else
      say "Build is up to date, skipping it."
    fi
    say "Starting $APP_NAME at $URL  (Ctrl+C to stop; use --dev for hot reload while editing)"
    npx next start --port "$PORT"
    ;;
esac
