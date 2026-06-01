#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_NODE="${CODEX_OFFICE_MAS_SOURCE_NODE:-$(command -v node || true)}"
RUNTIME_DIR="${CODEX_OFFICE_MAS_RUNTIME_OUT:-$ROOT_DIR/dist/mas-runtime/node-runtime}"
BIN_DIR="$RUNTIME_DIR/bin"
FRAMEWORKS_DIR="$RUNTIME_DIR/Frameworks"
MANIFEST_PATH="$RUNTIME_DIR/mas-runtime-manifest.json"

if [[ -z "$SOURCE_NODE" || ! -x "$SOURCE_NODE" ]]; then
  echo "Node source runtime not found. Set CODEX_OFFICE_MAS_SOURCE_NODE=/path/to/node." >&2
  exit 1
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "MAS runtime preparation is only supported on macOS." >&2
  exit 1
fi

rm -rf "$RUNTIME_DIR"
mkdir -p "$BIN_DIR" "$FRAMEWORKS_DIR"

cp "$SOURCE_NODE" "$BIN_DIR/node"
chmod 755 "$BIN_DIR/node"

resolve_dependency() {
  local dep="$1"
  local binary="$2"
  local loader_dir
  loader_dir="$(dirname "$binary")"

  if [[ "$dep" == @loader_path/* ]]; then
    local candidate="$loader_dir/${dep#@loader_path/}"
    [[ -e "$candidate" ]] && printf '%s\n' "$candidate"
    [[ -e "$candidate" ]] && return
    local name="${dep#@loader_path/}"
    for candidate in /opt/homebrew/lib/"$name" /opt/homebrew/opt/*/lib/"$name"; do
      if [[ -e "$candidate" ]]; then
        printf '%s\n' "$candidate"
        return
      fi
    done
    return
  fi

  if [[ "$dep" == @executable_path/* ]]; then
    local candidate="$BIN_DIR/${dep#@executable_path/}"
    [[ -e "$candidate" ]] && printf '%s\n' "$candidate"
    return
  fi

  if [[ "$dep" == @rpath/* ]]; then
    local name="${dep#@rpath/}"
    local rpath
    while IFS= read -r rpath; do
      local expanded="${rpath//@loader_path/$loader_dir}"
      expanded="${expanded//@executable_path/$BIN_DIR}"
      local candidate="$expanded/$name"
      if [[ -e "$candidate" ]]; then
        printf '%s\n' "$candidate"
        return
      fi
    done < <(otool -l "$binary" 2>/dev/null | awk '/cmd LC_RPATH/{flag=1} flag && /path /{print $2; flag=0}')
    for candidate in "$loader_dir/$name" "$(dirname "$SOURCE_NODE")/../lib/$name" "/opt/homebrew/lib/$name" "/opt/homebrew/opt/node/lib/$name"; do
      if [[ -e "$candidate" ]]; then
        printf '%s\n' "$candidate"
        return
      fi
    done
    return
  fi

  [[ -e "$dep" ]] && printf '%s\n' "$dep"
}

is_system_dependency() {
  case "$1" in
    /usr/lib/*|/System/Library/*) return 0 ;;
    *) return 1 ;;
  esac
}

dependency_names() {
  otool -L "$1" 2>/dev/null \
    | tail -n +2 \
    | awk '{print $1}' \
    | grep -v "^$1$" || true
}

queue=("$BIN_DIR/node")
seen=""
copied=""
unresolved=()

while [[ "${#queue[@]}" -gt 0 ]]; do
  current="${queue[0]}"
  queue=("${queue[@]:1}")
  case "$seen" in
    *"|$current|"*) continue ;;
  esac
  seen="$seen|$current|"

  while IFS= read -r dep; do
    [[ -n "$dep" ]] || continue
    is_system_dependency "$dep" && continue

    resolved="$(resolve_dependency "$dep" "$current" || true)"
    if [[ -z "$resolved" || ! -e "$resolved" ]]; then
      unresolved+=("$dep from $current")
      continue
    fi

    target="$FRAMEWORKS_DIR/$(basename "$resolved")"
    if [[ ! -e "$target" ]]; then
      cp "$resolved" "$target"
      chmod 755 "$target"
      copied="$copied|$target|"
      queue+=("$target")
    fi
  done < <(dependency_names "$current")
done

if [[ "${#unresolved[@]}" -gt 0 ]]; then
  printf 'Could not resolve MAS runtime dependencies:\n' >&2
  printf -- '- %s\n' "${unresolved[@]}" >&2
  exit 1
fi

rewrite_binary() {
  local binary="$1"
  local dep
  while IFS= read -r dep; do
    [[ -n "$dep" ]] || continue
    is_system_dependency "$dep" && continue
    /usr/bin/install_name_tool -change "$dep" "@executable_path/../Frameworks/$(basename "$dep")" "$binary" 2>/dev/null || true
  done < <(dependency_names "$binary")

  if [[ "$binary" == *.dylib ]]; then
    /usr/bin/install_name_tool -id "@executable_path/../Frameworks/$(basename "$binary")" "$binary" 2>/dev/null || true
  fi
}

rewrite_binary "$BIN_DIR/node"
while IFS= read -r dylib; do
  rewrite_binary "$dylib"
done < <(find "$FRAMEWORKS_DIR" -type f -name "*.dylib" | sort)

/usr/bin/codesign --force --sign - "$BIN_DIR/node" >/dev/null 2>&1 || true
while IFS= read -r runtime_file; do
  /usr/bin/codesign --force --sign - "$runtime_file" >/dev/null 2>&1 || true
done < <(find "$FRAMEWORKS_DIR" -type f \( -perm -0100 -o -perm -0010 -o -perm -0001 \) | sort)

if ! "$BIN_DIR/node" -e 'console.log(JSON.stringify({version: process.version, arch: process.arch, platform: process.platform}))' >/tmp/coding-yuan-mas-node-runtime.json; then
  echo "Prepared runtime did not execute successfully." >&2
  exit 1
fi

RUNTIME_DIR="$RUNTIME_DIR" \
SOURCE_NODE="$SOURCE_NODE" \
NODE_INFO="$(cat /tmp/coding-yuan-mas-node-runtime.json)" \
node --input-type=module <<'NODE'
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const runtimeDir = process.env.RUNTIME_DIR;
const files = walk(runtimeDir)
  .filter((path) => !path.endsWith("mas-runtime-manifest.json"))
  .map((path) => ({
    path: relative(runtimeDir, path),
    bytes: statSync(path).size
  }));

const manifest = {
  format: "coding-yuan-mas-runtime-v1",
  generatedAt: new Date().toISOString(),
  sourceNode: process.env.SOURCE_NODE,
  node: JSON.parse(process.env.NODE_INFO),
  executable: "bin/node",
  frameworksDir: "Frameworks",
  files
};

writeFileSync(join(runtimeDir, "mas-runtime-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
NODE

echo "$RUNTIME_DIR"
echo "$MANIFEST_PATH"
