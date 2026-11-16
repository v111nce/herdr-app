# Personal fork development

This checkout uses `origin` for `v111nce/herdr-app` and `upstream` for
`herdrdev/herdr-app`. Work on `local`, which combines the two submitted patches
with personal development. Keep upstream contributions on separate branches.

Build a development app on macOS:

```sh
bash scripts/build-local-macos
open "dist/Herdr Local.app"
```

Use `bash scripts/build-local-macos --release` for an optimized build. The script
uses Rust 1.95.0 and Zig 0.16.0, matching upstream CI. Set `ZIG` to its executable
if it is not on PATH or in this machine's developer-tool cache. Initialize
submodules with `git submodule update --init` on a fresh clone.

The resulting app has its own bundle identifier, data directory
(`~/Library/Application Support/Herdr Local`) and core session (`herdr-local`).
The launcher clears inherited `HC_*` connection variables before starting.
Existing sessions and settings are not migrated. Building does not launch or
install the app, change the `herdr-app` CLI link, or quit a running app.
The official `just install` recipe targets `~/Applications/Herdr.app`; use the
local build script for this separate app instead. Source builds do not self-update.

Update the personal branch from upstream:

```sh
git fetch upstream
git switch local
git merge upstream/master
# Resolve conflicts if necessary, review and test, then:
git push origin local
bash scripts/build-local-macos
```

Follow the repository's `AGENTS.md` for tests and app/core isolation. Run GUI
tests with a scratch app home and a separate core session. When upstream adopts
a patch, inspect the actual diff while integrating the update; do not assume
the upstream squash commit has the same SHA as the submitted commit.
