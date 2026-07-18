#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
assets="$root/desktop/assets"
iconset="$assets/icon.iconset"

rm -rf "$iconset"
mkdir -p "$iconset"
sips -s format png "$assets/icon.svg" --out "$assets/icon-1024.png" >/dev/null

for size in 16 32 128 256 512; do
  double=$((size * 2))
  sips -z "$size" "$size" "$assets/icon-1024.png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
  sips -z "$double" "$double" "$assets/icon-1024.png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil -c icns "$iconset" -o "$assets/icon.icns"
rm -rf "$iconset" "$assets/icon-1024.png"
