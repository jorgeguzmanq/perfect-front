<div align="center">

# Perfect Front

**Local visual review for web projects.**
Open your app, tap an element, say what should change. Each comment lands as a JSON file inside your project, ready for a person or a coding agent to process.

[Site](https://jorgeguzmanq.github.io/perfect-front/) · [Usage manual](https://jorgeguzmanq.github.io/perfect-front/manual.html) · [Specification](./SPEC.md) · [Plan](./PLAN.md)

</div>

---

## Why

Visual feedback usually lives far from the code: screenshots in a chat, loose notes, tickets with no context. Perfect Front captures it **where it happens** (on the rendered page) and stores it **where it is used** (in the project folder).

- **No changes to your app.** No imports, plugins, or components to add to the observed project.
- **Any framework.** Vite, Next.js, Angular, or static HTML.
- **The project owns its comments.** One comment = one file in `.perfect-front/`. No cloud, no account, no external database.
- **Built for agents.** CLI with stable `--json` output, optimistic locking, and documented exit codes.
- **Enough context to find the element again:** selector, file and line, route, and an optional screenshot.

## How it works

```text
 your dev server ──► local proxy ──► browser
                       │  injects /__pf/overlay.js
                       ▼
                 local server ──► <project>/.perfect-front/*.json
                       ▲
          dashboard · CLI · agents
```

1. `perfect-front` (alias `comment`) detects the project, starts or reuses its dev server, and brings up the local server.
2. A proxy sits in front of the dev server and injects the comment layer into the HTML.
3. Alt+click on an element (or <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd>) opens the editor.
4. The comment is saved as JSON in the project. The dashboard and the CLI let you read, organize, and resolve it.

## Quick start

Requirements: **Node.js ≥ 22** and **pnpm ≥ 11**.

```bash
git clone https://github.com/jorgeguzmanq/perfect-front.git
cd perfect-front
pnpm install
pnpm build
```

From the root of the project you want to review:

```bash
perfect-front            # or: comment
```

Useful options: `--no-open`, `--no-proxy`, `--server-port <n>`, `--detach`. Subcommands: `start`, `stop`, `status`, `logs`, `list`, `show`, `claim`, `resolve`, `export`. Details in [`packages/cli`](./packages/cli/README.md). The full walkthrough is in the [Usage manual](https://jorgeguzmanq.github.io/perfect-front/manual.html).

### In-layer flow

| Action | Result |
|---|---|
| Alt+click / <kbd>Ctrl/Cmd+Shift+C</kbd> | Selection mode |
| ↑ / ↓ | Parent / child of the element |
| <kbd>Ctrl/Cmd+Enter</kbd> | Save |
| **Save** | Saves, and the layer is ready to pick **another** element with no extra steps |
| **Delete element** | Saves a "delete this element" comment (with an optional note); it never edits your code |
| **Capture ▾ → Selected node** / <kbd>Alt+Shift+S</kbd> | Node capture at 1×–4× (one or several scales), showing the real pixel size of each |
| Paste / drop / **Open…** | Attach images (up to 20 per comment) |
| <kbd>Esc</kbd> | Exit |

Capture details:

- Each scale is **re-rendered** at that pixel density, not upscaled from a smaller image.
- Capture is flicker-free: the layer hides itself while capturing so it never appears in the image.
- Captures can be **copied to the clipboard** or **downloaded** as PNG, and attached to the comment like any other image.
- A single comment can hold **several sections**, so one note can cover different parts of the page.

## Working with coding agents

Comments are processed without a server or a browser:

```bash
perfect-front list --json
perfect-front claim <id>
perfect-front resolve <id>
```

The full contract and a block to paste into your project's `CLAUDE.md` are in [`packages/cli/AGENTS.md`](./packages/cli/AGENTS.md).

## Repository layout

```text
apps/dashboard            Web hub for projects and comments
apps/extension            Chrome extension (Manifest V3)
packages/cli              perfect-front / comment binary
packages/local-server     Local API, events, and processes
packages/proxy            Proxy that injects the layer
packages/overlay          Visual layer injected into pages
packages/project-detector Framework, command, and port detection
packages/comment-storage  Comment and collection persistence
packages/shared           Shared contracts and schemas
packages/design-tokens    Tokens and base styles
```

## Roadmap: overlay v2

Branch: `feat/overlay-v2` (not yet merged). Its rule: **every zone answers a single question**, and features appear only when they make sense. The [Usage manual](https://jorgeguzmanq.github.io/perfect-front/manual.html) shows the layer in action.

| Verb | Question | Features |
|---|---|---|
| **Point** | Which nodes do I mean? | 4-direction navigation, multi-select, reorder siblings (as a proposal), copy location |
| **Describe** | What should change? | text and i18n proposals (before → after), **images** (paste, drop, open; up to 20), node capture 1×–4×, style proposals, several sections per comment |
| **Organize** | Which others does it belong with? | groups, reading queue, comments drawer |

Principles: changes are **proposed** (before → after) and never modify your code; everything is previewable and reversible; styles distinguish *editable* from *foundation* depending on where each rule comes from.

## Development

```bash
pnpm dev          # development servers
pnpm typecheck
pnpm lint
pnpm test
```

More in [`CONTRIBUTING.md`](./CONTRIBUTING.md). Product and architecture decisions live in [`SPEC.md`](./SPEC.md).

## Status

Under active development. The CLI, local server, proxy, layer, dashboard, and extension work; overlay v2 is on the `feat/overlay-v2` branch and is not yet merged.

---

Made by Jorge Guzmán — https://www.jorgegz.com
