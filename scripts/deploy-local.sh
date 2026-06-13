#!/usr/bin/env bash
# Build the app and install the freshly-built .deb over the currently installed
# one in a single step. dpkg -i replaces the package in place — no `apt remove`
# first, and it reinstalls even when the version is unchanged (apt would skip a
# same-version local .deb, which is why the old flow needed a remove).
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
DEB="release/${VERSION}/brain_${VERSION}_amd64.deb"

npm run dist

if [ ! -f "$DEB" ]; then
  echo "Build finished but $DEB was not found — check release/${VERSION}/." >&2
  exit 1
fi

echo "Installing $DEB (sudo)…"
# install-or-fix-deps in one go: if a new system dependency was ever added,
# dpkg leaves it unconfigured and `apt-get install -f` pulls it in.
sudo dpkg -i "$DEB" || sudo apt-get install -f -y

echo "Done — brain ${VERSION} installed."
