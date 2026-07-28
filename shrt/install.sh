#!/usr/bin/env sh
set -eu

version="0.1.2"
base_url="${SHRT_BASE_URL:-https://antonveselskyi.com/shrt/downloads}"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT HUP INT TERM

archive="$temporary/shrt-$version-linux-x64.tar.gz"
if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$base_url/shrt-$version-linux-x64.tar.gz" -o "$archive"
elif command -v wget >/dev/null 2>&1; then
    wget -q "$base_url/shrt-$version-linux-x64.tar.gz" -O "$archive"
else
    printf '%s\n' 'SHRT installer needs curl or wget.' >&2
    exit 1
fi

tar -xzf "$archive" -C "$temporary"
PREFIX="${SHRT_PREFIX:-$HOME/.local}" "$temporary/shrt-$version-linux-x64/install.sh"
printf '%s\n' 'Open a new shell or restart your editor, then run: shrt --version'
