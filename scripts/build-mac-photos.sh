#!/bin/bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="$repo_dir/apps/macos-photos"
build_dir="$repo_dir/artifacts/local/mac-photos-build"
app_dir="$repo_dir/artifacts/local/Afterglow Photos.app"
sdk_path="$(xcrun --sdk macosx --show-sdk-path)"
architecture="$(uname -m)"

mkdir -p "$build_dir/module-cache" "$app_dir/Contents/MacOS"
plutil -lint "$source_dir/Info.plist" "$source_dir/AfterglowPhotos.entitlements"
xcrun swiftc "$source_dir/AfterglowPhotos.swift" \
  -parse-as-library -swift-version 5 -O \
  -target "$architecture-apple-macosx14.0" -sdk "$sdk_path" \
  -module-cache-path "$build_dir/module-cache" \
  -framework SwiftUI -framework AppKit -framework Photos -framework ImageIO \
  -framework UniformTypeIdentifiers -o "$build_dir/AfterglowPhotos"
cp "$build_dir/AfterglowPhotos" "$app_dir/Contents/MacOS/AfterglowPhotos"
cp "$source_dir/Info.plist" "$app_dir/Contents/Info.plist"
chmod 755 "$app_dir/Contents/MacOS/AfterglowPhotos"
codesign --force --sign - --identifier com.afterglow.photos.local \
  --entitlements "$source_dir/AfterglowPhotos.entitlements" "$app_dir"
codesign --verify --strict --verbose=2 "$app_dir"
printf 'Built and signed: %s\n' "$app_dir"
printf 'The app has not been launched and Photos permission has not been requested.\n'
