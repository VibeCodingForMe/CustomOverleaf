# LaTeX Studio 1.0.0

macOS LaTeX editor with real Tectonic compilation, PDF preview, project checkpoints,
SyncTeX, diagnostics, exports, and English/Russian interface.

## Install

1. Open `LaTeX Studio_1.0.0_aarch64.dmg`.
2. Drag **LaTeX Studio** onto the **Applications** shortcut.
3. Launch it from Applications.

The build is ad-hoc signed for local use. If macOS blocks the app after copying it
from another machine, open **System Settings → Privacy & Security** and choose
**Open Anyway**, or run:

```sh
xattr -dr com.apple.quarantine "$HOME/Applications/LaTeX Studio.app"
```

## Requirements

- macOS 11 or newer on Apple Silicon.
- Tectonic 0.17 or newer installed and available in `PATH` for compilation.
- Pandoc is optional and only needed for DOCX/HTML/ODT/EPUB/Markdown export.

The app bundles Biber 2.17, Latin Modern Mono, and Latin Modern Math and installs
them into the user's application data/font directories on first launch.

## Integrity

```sh
shasum -a 256 -c SHA256SUMS.txt
```

Application data is stored in:

```text
~/Library/Application Support/com.latexstudio.desktop
```

Removing the app does not remove projects, settings, or checkpoint history.

## Known limitations

- Project refresh uses a lightweight revision poll rather than FSEvents.
- Visual QA of the latest panels still needs a manual pass on the target display.
- Notarization requires an Apple Developer ID; this build is ad-hoc signed.
