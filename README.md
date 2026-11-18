# EdgeEver Flavored Markdown (OFM) Plugin

Client plugin (`com.edgeever.flavored-markdown`) bringing [Obsidian Flavored Markdown](https://obsidian.md/help/obsidian-flavored-markdown) syntax, navigation, transclusion, and inspection tools to [EdgeEver](https://github.com/tianma-if/edgeever).

## Supported OFM Syntax

- **Wikilinks**: `[[Note]]`, `[[Note|Alias]]`, `[[Note#Heading]]`, `[[Note#^block-id]]`, `[[#Local Heading]]`, and escaped table-cell pipes `[[Note\|Alias]]`
- **Embeds & Transclusions**: `![[Note]]`, `![[Note#Heading]]`, `![[Note#^block-id]]`, plus note/workspace attachment embeds `![[image.png|320]]`, `![[image.png|320x200]]`, audio, video, and files (with circular reference detection and configurable max depth)
- **Block References**: `^block-id` anchors on paragraphs, headings, lists, quotes, tables, code fences, math blocks, or standalone lines
- **Callouts**: `> [!note]`, `> [!tip]+`, `> [!warning]-` (collapsible `<details>`), nested callouts, and all standard Obsidian callout types & aliases
- **Highlights & Comments**: `==highlighted text==` and `%%inline or multi-line comments%%`
- **Footnotes**: `[^id]` references, multi-line `[^id]: ...` definitions, and `^[inline footnotes]`
- **GFM & LaTeX Math**: Tables, task lists (`- [ ]` / `- [x]` clickable in Reader), strikethrough (`~~text~~`), fenced code blocks with copy button, inline `$...$` and display `$$...$$` math (avoiding false positives on currency like `$100`)
- **Strict Obsidian HTML**: Markdown inside raw HTML elements (e.g. `<div>**not bold**</div>`) is intentionally left unparsed, while unsafe HTML/scripts are sanitized

## Panels & Commands

- **Panels**:
  - `ofm-reader` (*OFM Reader & Links*): Fullscreen preview with tabs for **Reader**, **Backlinks** (linked & unlinked mentions), **Links & Blocks**, and **OFM Syntax** guide
  - `ofm-composer` (*Insert OFM Syntax*): Builder dialog for wikilinks, embeds, callouts, footnotes, and block anchors
- **Editor Assist** (non-invasive):
  - Floating `[[` autocomplete popover for notes, headings (`#`), and block anchors (`#^`)
  - `Ctrl/Cmd + Click` on `[[Wikilinks]]` to open or create the target note
- **Toolbar Commands**:
  - Toggle `==Highlight==` / `%%Comment%%`
  - Insert Callout Block / Footnote `[^id]` / `^block-id` Anchor
  - Bidirectional converters: **OFM → EdgeEver Markdown** and **EdgeEver Markdown → OFM**

## Installation

### From GitHub (Marketplace)

Open **Plugin Marketplace** in EdgeEver and install using the GitHub repository URL:

```text
https://github.com/fdkgenie/edgeever-plugin-flavored-markdown
```

### Local Development Install (EdgeEver Monorepo)

While running EdgeEver locally (`bun run dev`), install via the Plugin Marketplace using the local manifest URL:

```text
/extensions/flavored-markdown/manifest.json
```

## Development & Release Build

```sh
bun install
bun run build
bun run typecheck
bun run lint
bun test
```

Running `bun run build` outputs the self-contained distribution bundle (`manifest.json`, `main.js`, `styles.css`) to `dist/`. When publishing a new release, ensure `manifest.json` and `package.json` versions match, then push a matching Git tag (e.g. `git tag v1.0.0 && git push origin v1.0.0`) so GitHub Actions builds and attaches the release assets automatically.

## License

Licensed under the [MIT License](LICENSE).
