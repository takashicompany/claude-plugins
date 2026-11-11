#!/bin/bash
# HTMLReveal.app をビルドして ~/Applications に置き、htmlreveal:// の受け口として登録する。
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
app="$HOME/Applications/HTMLReveal.app"
mkdir -p "$app/Contents/MacOS"
cp "$here/Info.plist" "$app/Contents/Info.plist"
swiftc -O -o "$app/Contents/MacOS/HTMLReveal" "$here/main.swift"
codesign --force --sign - "$app" >/dev/null 2>&1 || true
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$app"
echo "installed: $app"
