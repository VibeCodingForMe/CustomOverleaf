# LaTeX Studio

A local-first macOS LaTeX editor built with Tauri 2, Rust, React, TypeScript, CodeMirror 6, and PDF.js.

## Features

- Multi-file LaTeX projects with a project tree, tabs, autosave, external-change detection, and atomic writes.
- Real compilation with Tectonic, latexmk, pdfLaTeX, XeLaTeX, or LuaLaTeX.
- Continuous PDF preview with zoom, fit width/page, text search, SyncTeX forward/reverse navigation, and last-good-PDF preservation.
- Project checkpoints with content-addressed storage, date/type/file filters, colored diffs, real tree highlighting, and transactional single/full restore.
- Project Doctor static analysis and plain-language compiler diagnostics with safe, previewed fixes.
- Search and replace across the project with diff preview, confirmation, and rollback.
- Equation and table builders, snippets, contextual autocomplete, and a command palette.
- Project outline, figures/tables/equations navigation, bibliography help, and document statistics.
- English/Russian interface, dark/light/system themes, configurable shortcuts, and focus mode.
- PDF, TeX, ZIP, and Pandoc DOCX/HTML/ODT/EPUB/Markdown export.

## Development

Requirements: Node.js, Rust, Xcode Command Line Tools, and Tectonic for compilation.

```sh
npm install
npm run desktop
```

Useful checks:

```sh
npm run typecheck
npm test
cargo test --manifest-path src-tauri/Cargo.toml
```

## Build

```sh
CARGO_INCREMENTAL=0 npx tauri build --bundles app,dmg
```

The app and DMG are written to `src-tauri/target/release/bundle/`.

## Install

The built DMG contains the app and an Applications shortcut. Drag **LaTeX Studio** into Applications. See `release/README.md` for integrity and Gatekeeper notes.

Application data is stored in `~/Library/Application Support/com.latexstudio.desktop` and is preserved when the app is replaced.

## Repository layout

- `src/` — React UI, editor, PDF preview, history, search, dialogs, i18n, styles.
- `src-tauri/src/` — Rust backend for projects, compilation, diagnostics, checkpoints, SyncTeX, export, and Git.
- `src-tauri/resources/` — bundled Biber 2.17 and Latin Modern fonts.
- `PLAN.md` — product specification and implementation status.
- `REMAINING_TASKS.md` — current acceptance status and known limitations.

## Known limitations

- Project refresh uses revision polling rather than native FSEvents.
- The released macOS build is ad-hoc signed; notarization requires an Apple Developer ID.
- Full visual QA of every panel still requires a manual pass on the target display.
