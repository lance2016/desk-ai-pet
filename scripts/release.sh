#!/usr/bin/env bash
# Builds AI Pet.app, installs it into /Applications and restarts it.
#
#   scripts/release.sh            build + install + publish a release the app can update to
#   scripts/release.sh --local    build + install only (no git checks, no publish)
#
# The release version is the "version" field of package.json; tauri.conf.json reads it from there.
# Releases go to RELEASES_REPO, which must be public: the app reads latest.json from its latest
# release (plugins.updater.endpoints in tauri.conf.json) and checks the update against the public
# key there, so the private key below must never be lost.
# Release notes: add the version to src/update/releaseNotes.json (a test fails without it).
# RELEASE_NOTES="..." scripts/release.sh replaces them with plain text.
set -euo pipefail

cd "$(dirname "$0")/.."

APP_NAME="AI Pet"
BUNDLE="src-tauri/target/release/bundle/macos/${APP_NAME}.app"
INSTALLED="/Applications/${APP_NAME}.app"
EXECUTABLE="${INSTALLED}/Contents/MacOS/ai-pet"

MODE="publish"
case "${1:-}" in
  "") ;;
  --local) MODE="local" ;;
  *) echo "Usage: $0 [--local]" >&2; exit 2 ;;
esac

fail() { echo "error: $*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }

VERSION="$(node -p 'require("./package.json").version')"
TAG="v${VERSION}"
ZIP="src-tauri/target/release/bundle/macos/AI-Pet-${TAG}-macos-$(uname -m).zip"
RELEASES_REPO="lance2016/desk-ai-pet"
UPDATER_KEY="${AI_PET_UPDATER_KEY:-$HOME/.tauri/ai-pet-updater.key}"
UPDATE_ASSET="AI-Pet-${TAG}-macos-$(uname -m).app.tar.gz"
UPDATE_DIR="src-tauri/target/release/bundle/updater"
case "$(uname -m)" in
  arm64) UPDATE_PLATFORM="darwin-aarch64" ;;
  x86_64) UPDATE_PLATFORM="darwin-x86_64" ;;
  *) fail "unsupported architecture: $(uname -m)" ;;
esac

# Checked before the slow build, so a mistake fails in seconds rather than minutes.
if [[ "$MODE" == "publish" ]]; then
  step "Checking that ${TAG} can be published"
  command -v gh >/dev/null || fail "GitHub CLI (gh) is not installed"
  gh auth status >/dev/null 2>&1 || fail "gh is not logged in; run: gh auth login"
  [[ -z "$(git status --porcelain)" ]] || fail "working tree has uncommitted changes; commit them first"
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  git fetch --quiet origin "$BRANCH"
  [[ "$(git rev-parse HEAD)" == "$(git rev-parse "origin/${BRANCH}")" ]] \
    || fail "HEAD is not the same as origin/${BRANCH}; push (or pull) first"
  [[ -f "$UPDATER_KEY" ]] || fail "updater signing key not found at ${UPDATER_KEY}"
  gh repo view "$RELEASES_REPO" >/dev/null 2>&1 || fail "release repository ${RELEASES_REPO} does not exist"
  if gh release view "$TAG" --repo "$RELEASES_REPO" >/dev/null 2>&1 || [[ -n "$(git ls-remote --tags origin "refs/tags/${TAG}")" ]]; then
    fail "release ${TAG} already exists; bump \"version\" in package.json and src-tauri/Cargo.toml"
  fi
fi

step "Running tests"
pnpm test
(cd src-tauri && cargo test --quiet)

# An ad-hoc signature changes with every build, so the Keychain treats each build as a new app
# and asks again for the saved API keys. A real certificate keeps "Always Allow" across builds.
if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  APPLE_SIGNING_IDENTITY="$(security find-identity -v -p codesigning | awk '/"Apple Development: / { print $2; exit }')"
fi
if [[ -n "$APPLE_SIGNING_IDENTITY" ]]; then
  export APPLE_SIGNING_IDENTITY
else
  echo "warning: no Apple Development certificate found; the app is signed ad hoc and the Keychain will ask again after this build" >&2
fi

step "Building ${APP_NAME}.app ${TAG}"
if [[ "$MODE" == "publish" ]]; then
  # Also builds "AI Pet.app.tar.gz" and its signature, which the app's updater downloads and checks.
  TAURI_SIGNING_PRIVATE_KEY="$(cat "$UPDATER_KEY")" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" \
    pnpm tauri build --bundles app --config '{"bundle":{"createUpdaterArtifacts":true}}'
else
  pnpm tauri build --bundles app
fi

step "Installing into /Applications"
# Check the new bundle before the old one goes: a wrong path must not leave the user with no app at all.
[[ -x "${BUNDLE}/Contents/MacOS/${EXECUTABLE##*/}" ]] || fail "no built app at ${BUNDLE}; the installed one is left in place"
if pgrep -f "$EXECUTABLE" >/dev/null; then
  osascript -e "quit app \"${APP_NAME}\"" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5; do pgrep -f "$EXECUTABLE" >/dev/null || break; sleep 1; done
  pkill -f "$EXECUTABLE" 2>/dev/null || true
fi
rm -rf "$INSTALLED"
ditto "$BUNDLE" "$INSTALLED"
open "$INSTALLED"
echo "Installed and started ${INSTALLED}"

if [[ "$MODE" == "local" ]]; then
  exit 0
fi

step "Publishing ${TAG} to ${RELEASES_REPO}"
rm -f "$ZIP"
# ditto keeps the bundle's symlinks and extended attributes, which plain zip would break.
ditto -c -k --keepParent "$BUNDLE" "$ZIP"
rm -rf "$UPDATE_DIR" && mkdir -p "$UPDATE_DIR"
cp "${BUNDLE}.tar.gz" "${UPDATE_DIR}/${UPDATE_ASSET}"
# Notes come from src/update/releaseNotes.json, which the app's "新功能" sheet shows too. latest.json
# gets one line (an older app shows it in the "有新版本" row); the release page gets the full list.
release_notes() {
  VERSION="$VERSION" FORMAT="$1" node -e '
    const { VERSION, FORMAT } = process.env;
    const entry = require("./src/update/releaseNotes.json")[VERSION];
    if (!entry) { process.stdout.write("修复问题、改进体验"); process.exit(0); }
    const text = FORMAT === "line"
      ? entry.features.map((feature) => feature.title).join("；")
      : ["## 新功能", "", ...entry.features.map((feature) => `- **${feature.title}**　${feature.detail}`), ...(entry.more ? ["", entry.more] : [])].join("\n");
    process.stdout.write(text);
  '
}
NOTES="${RELEASE_NOTES:-$(release_notes line)}"
PAGE_NOTES="${RELEASE_NOTES:-$(release_notes page)}"
NOTES="$NOTES" VERSION="$VERSION" PLATFORM="$UPDATE_PLATFORM" \
  SIGNATURE="$(cat "${BUNDLE}.tar.gz.sig")" \
  URL="https://github.com/${RELEASES_REPO}/releases/download/${TAG}/${UPDATE_ASSET}" \
  node -e '
    const { NOTES, VERSION, PLATFORM, SIGNATURE, URL } = process.env;
    const pubDate = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const manifest = { version: VERSION, notes: NOTES, pub_date: pubDate, platforms: { [PLATFORM]: { signature: SIGNATURE, url: URL } } };
    process.stdout.write(JSON.stringify(manifest, null, 2));
  ' > "${UPDATE_DIR}/latest.json"
gh release create "$TAG" "$ZIP" "${UPDATE_DIR}/${UPDATE_ASSET}" "${UPDATE_DIR}/latest.json" \
  --repo "$RELEASES_REPO" \
  --title "${APP_NAME} ${TAG}" \
  --notes "$PAGE_NOTES" \
  --target "$(git rev-parse HEAD)" \
  --latest
echo "Published: $(gh release view "$TAG" --repo "$RELEASES_REPO" --json url --jq .url)"
