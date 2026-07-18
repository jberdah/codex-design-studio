#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
staging="$root/out/dmg-staging"
application="$root/out/Codex Design Studio-darwin-x64/Codex Design Studio.app"
destination="$root/out/make/Codex Design Studio-0.1.0-x64.dmg"

test -d "$application"
rm -rf "$staging"
mkdir -p "$staging"
cp -R "$application" "$staging/"
ln -s /Applications "$staging/Applications"
hdiutil create -volname "Codex Design Studio" -srcfolder "$staging" -ov -format UDZO "$destination"
rm -rf "$staging"
