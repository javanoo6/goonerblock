#!/usr/bin/env bash
set -euo pipefail

WEB_EXT_VERSION="${WEB_EXT_VERSION:-7.11.0}"
REPO_OWNER="${REPO_OWNER:-javanoo6}"
REPO_NAME="${REPO_NAME:-goonerblock}"
MODE=""
SIGN=0
WEB_EXT_IGNORE=(
  "scripts/release.sh"
  "docs/**"
  "web-ext-artifacts/**"
  ".web-extension-id"
  ".gitignore"
)

usage() {
  cat <<'EOF'
usage: scripts/release.sh <patch|minor|major|x.y.z> [--sign]

examples:
  scripts/release.sh patch
  scripts/release.sh 0.1.1
  scripts/release.sh patch --sign

env for --sign:
  AMO_JWT_ISSUER
  AMO_JWT_SECRET

output:
  Updates manifest.json and docs/updates.json, runs web-ext lint,
  optionally signs an unlisted XPI, then prints GitHub release steps.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ $# -lt 1 ]]; then
  usage
  exit 2
fi

MODE="$1"
shift

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sign)
      SIGN=1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1"
      echo "help: scripts/release.sh patch [--sign]"
      exit 2
      ;;
  esac
  shift
done

if [[ ! -f manifest.json || ! -f docs/updates.json ]]; then
  echo "error: run this script from the repository root"
  echo "help: cd /home/konkov/Desktop/theBigProjects/goonerblock && scripts/release.sh patch"
  exit 2
fi

if [[ "$SIGN" -eq 1 ]]; then
  if [[ -z "${AMO_JWT_ISSUER:-}" || -z "${AMO_JWT_SECRET:-}" ]]; then
    echo "error: --sign requires AMO_JWT_ISSUER and AMO_JWT_SECRET"
    echo "help: export AMO_JWT_ISSUER=... AMO_JWT_SECRET=..."
    exit 2
  fi
fi

release_data="$(
  RELEASE_MODE="$MODE" REPO_OWNER="$REPO_OWNER" REPO_NAME="$REPO_NAME" node <<'NODE'
const fs = require("node:fs");

const mode = process.env.RELEASE_MODE;
const repoOwner = process.env.REPO_OWNER;
const repoName = process.env.REPO_NAME;
const manifestPath = "manifest.json";
const updatesPath = "docs/updates.json";
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const updates = JSON.parse(fs.readFileSync(updatesPath, "utf8"));

function fail(message) {
  console.log(`error: ${message}`);
  process.exit(1);
}

function parseVersion(version) {
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) fail(`invalid version: ${version}`);
  return match.slice(1).map(Number);
}

const current = manifest.version;
const parts = parseVersion(current);
let next;

if (mode === "patch") {
  next = `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
} else if (mode === "minor") {
  next = `${parts[0]}.${parts[1] + 1}.0`;
} else if (mode === "major") {
  next = `${parts[0] + 1}.0.0`;
} else if (/^\d+\.\d+\.\d+$/.test(mode)) {
  next = mode;
} else {
  fail(`invalid bump mode: ${mode}`);
}

const nextParts = parseVersion(next);
if (
  nextParts[0] < parts[0] ||
  (nextParts[0] === parts[0] && nextParts[1] < parts[1]) ||
  (nextParts[0] === parts[0] && nextParts[1] === parts[1] && nextParts[2] <= parts[2])
) {
  fail(`next version ${next} must be greater than current ${current}`);
}

const addonId = manifest.browser_specific_settings?.gecko?.id;
if (!addonId) fail("manifest is missing browser_specific_settings.gecko.id");

const updateUrl = manifest.browser_specific_settings?.gecko?.update_url;
if (!updateUrl) fail("manifest is missing browser_specific_settings.gecko.update_url");

const tag = `v${next}`;
const xpiName = `${repoName}-${next}.xpi`;
const updateLink = `https://github.com/${repoOwner}/${repoName}/releases/download/${tag}/${xpiName}`;

manifest.version = next;
updates.addons = updates.addons || {};
updates.addons[addonId] = {
  updates: [
    {
      version: next,
      update_link: updateLink
    }
  ]
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(updatesPath, `${JSON.stringify(updates, null, 2)}\n`);

console.log(`current:${current}`);
console.log(`next:${next}`);
console.log(`addon_id:${addonId}`);
console.log(`update_url:${updateUrl}`);
console.log(`tag:${tag}`);
console.log(`xpi_name:${xpiName}`);
console.log(`update_link:${updateLink}`);
NODE
)"

if grep -q '^error:' <<<"$release_data"; then
  echo "$release_data"
  exit 1
fi

field_value() {
  local field="$1"
  sed -n "s/^${field}://p" <<<"$release_data"
}

current_version="$(field_value current)"
next_version="$(field_value next)"
addon_id="$(field_value addon_id)"
tag="$(field_value tag)"
xpi_name="$(field_value xpi_name)"
update_link="$(field_value update_link)"

if [[ -f .web-extension-id ]] && ! grep -qx "$addon_id" .web-extension-id; then
  echo "warning: .web-extension-id exists but does not match manifest ID"
  echo "help: it is ignored by git; remove it if AMO signing behaves strangely"
fi

npx --yes "web-ext@${WEB_EXT_VERSION}" lint \
  --source-dir . \
  --self-hosted \
  --ignore-files "${WEB_EXT_IGNORE[@]}"

if [[ "$SIGN" -eq 1 ]]; then
  npx --yes "web-ext@${WEB_EXT_VERSION}" sign \
    --source-dir . \
    --channel=unlisted \
    --api-key="$AMO_JWT_ISSUER" \
    --api-secret="$AMO_JWT_SECRET" \
    --ignore-files "${WEB_EXT_IGNORE[@]}"

  latest_xpi="$(
    find web-ext-artifacts -maxdepth 1 -type f -name '*.xpi' -printf '%T@ %p\n' \
      | sort -nr \
      | head -n 1 \
      | cut -d' ' -f2-
  )"

  if [[ -z "$latest_xpi" ]]; then
    echo "error: signing completed but no XPI was found in web-ext-artifacts/"
    echo "help: inspect web-ext output above"
    exit 1
  fi

  expected_xpi="web-ext-artifacts/${xpi_name}"
  if [[ "$latest_xpi" != "$expected_xpi" ]]; then
    cp "$latest_xpi" "$expected_xpi"
  fi
fi

cat <<EOF
release:
  previous: $current_version
  version: $next_version
  tag: $tag
  addon_id: $addon_id
  update_link: $update_link

next_steps:
  - git diff -- manifest.json docs/updates.json
  - git add manifest.json docs/updates.json
  - git commit -m "release $next_version"
  - git push
  - create GitHub release: $tag
  - upload signed artifact as: $xpi_name

note:
  If you used --sign, upload web-ext-artifacts/$xpi_name.
  If you did not use --sign, run again with --sign before uploading an XPI.
EOF
