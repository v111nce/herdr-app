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
(`~/Library/Application Support/Herdr Local`) and core session (`hl`).
The short session name keeps the core socket path within macOS's 103-byte limit.
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

## Fresh manual test window

For a disposable test environment rather than the persistent Herdr Local data:

```sh
python3 scripts/open-test.command --check
python3 scripts/open-test.command
```

Build first with `bash scripts/build-local-macos`. The launcher finds the debug
binary relative to this checkout (or `CARGO_TARGET_DIR`); use `--binary` for a
different build. It clears inherited `HC_*` connections and creates a new
`/var/tmp/herdr-manual-*` directory for each run, with separate app/core state.
The printed directory contains `run.json` and `app.log`. Quit the test window
with Cmd+Q; the launcher then closes only its own terminals/core and keeps logs.
It does not copy daily settings or migrate sessions.

Manual acceptance for the included patches:

- Rime: in Chinese mode without a candidate popup, enter Chinese text, press
  Shift+Enter, then type again. Chinese mode should remain active. Also check
  the normal Shift language switch, candidate confirmation and navigation.
- Copy feedback: open Pi or Kimi with Cmd+T, select text and release the mouse.
  Check the clipboard and the hint above the input box; it should disappear
  after two seconds. Repeated copies refresh the timer. Check multiline input
  and both light/dark themes. Input-box placement is a cell-style heuristic.
- Codex/Claude program-initiated copies retain their own feedback. Holding
  Shift to force app selection uses the app hint. With `copy_on_select: false`,
  selecting does not copy/show feedback; explicit copy still does.

The two patch commits are already on `local`: `c35b1af` (macOS input routing)
and `0b7041e` (terminal copy feedback). Their upstream PRs are
[#1117](https://github.com/herdrdev/herdr-app/pull/1117) and
[#1118](https://github.com/herdrdev/herdr-app/pull/1118).
