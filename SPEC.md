# Perfect Front — Product and Architecture Specification

## 1. Summary

Perfect Front is a local visual review tool for web projects. It lets you open an application in Chrome, enable a comment layer over the rendered page, select elements, and record observations without modifying the code or installing components inside the project under review.

The main experience starts from the root of any project:

```bash
comment
```

The command detects the project type, finds or starts its development server, temporarily registers the relationship between the URL and the local folder, opens the application in Chrome, and connects the Perfect Front extension.

Each comment belongs to the reviewed project and is persisted inside it as an independent JSON file. Perfect Front does not use an external database as its source of truth.

## 2. Goals

Perfect Front must allow you to:

1. Run `comment` from a project root.
2. Detect Vite, Next.js, Angular, and static HTML projects.
3. Connect to a server that is already running or start a new one.
4. Open the project in Chrome.
5. Toggle between the normal view and comment mode from an extension.
6. Select any visible element regardless of framework.
7. Create element-level or full-page comments.
8. Save each comment inside the reviewed project.
9. Read, edit, organize, move, and resolve comments from a local web application.
10. Let a person or a coding agent process pending comments.
11. Keep enough context to find the element again even if the application changes partially.
12. Work without adding imports, plugins, or components to the observed application.

## 3. Product principles

### 3.1 The project owns its comments

Comments live in the folder of the project being reviewed. The extension and the local server only create, read, and organize them.

This allows you to:

- keep feedback next to the code;
- process it with any editor or agent;
- decide whether to version it with Git or ignore it;
- move the project without losing its comments;
- avoid a mandatory account, cloud, or database.

### 3.2 A comment is a file

A single `comments.json` with a giant array will not be used. Each comment gets its own JSON file.

Benefits:

- no text delimiters are needed;
- moving a comment is the same as moving a file;
- write and Git conflicts are reduced;
- an agent can process comments individually;
- attachments and history can be linked through a stable ID.

### 3.3 The extension is the interaction layer

The Chrome extension selects elements and captures context. It does not manage processes or write directly to the filesystem.

### 3.4 The local server is the bridge

A local Node.js process maps URLs to folders, manages development servers, and performs filesystem operations.

### 3.5 The dashboard is a web app

Perfect Front does not require Electron. Project and comment management happens in a local web application served by the Perfect Front process itself.

## 4. System architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│ Chrome                                                          │
│                                                                 │
│  ┌─────────────────────┐      ┌───────────────────────────────┐ │
│  │ Reviewed application│      │ Perfect Front dashboard       │ │
│  │ localhost:5173      │      │ localhost:45800               │ │
│  │                     │      │                               │ │
│  │ + injected overlay  │      │ projects and comments         │ │
│  └──────────┬──────────┘      └───────────────┬───────────────┘ │
│             │ MV3 extension                   │ HTTP/WebSocket   │
└─────────────┼─────────────────────────────────┼─────────────────┘
              └────────────────┬────────────────┘
                               ▼
                   ┌────────────────────────┐
                   │ Local server           │
                   │ Perfect Front          │
                   │                        │
                   │ processes · API · FS   │
                   └───────────┬────────────┘
                               ▼
                   ┌────────────────────────┐
                   │ Project root           │
                   │ .perfect-front/        │
                   └────────────────────────┘
```

### 4.1 Components

#### `comment` CLI

Responsibilities:

- use the current directory as the default root;
- locate the real root when run from a subdirectory;
- detect the framework, package manager, and development command;
- detect an existing server;
- start the Perfect Front local server if it is not running;
- start the project server when needed;
- register the project, process, port, and URL;
- open Chrome or print the URL;
- provide commands to list, move, and resolve comments.

#### Local server

Responsibilities:

- serve the dashboard;
- expose a local HTTP API;
- emit changes over WebSocket or Server-Sent Events;
- keep the registry of projects for the session;
- start, observe, and stop child processes;
- write comments atomically;
- validate all paths before accessing the filesystem;
- accept requests only from authorized local origins.

#### Chrome extension

Responsibilities:

- detect whether the tab belongs to a registered project;
- toggle between normal mode and comment mode;
- inject the overlay using Manifest V3;
- isolate its interface inside Shadow DOM;
- highlight the element under the cursor;
- capture DOM and visual context;
- send comments to the local server;
- link to the dashboard and the active project.

#### Overlay

Responsibilities:

- element selection;
- navigation between element, parent, and child;
- comments on an element or the entire view;
- capture of selector, text, HTML, and geometry;
- comment form;
- save confirmation;
- not interfering with application events while disabled.

#### Dashboard

Responsibilities:

- list known and active projects;
- start, stop, and restart managed projects;
- open their URLs;
- show basic logs;
- list comments by collection and status;
- read and edit comments;
- move comments between collections;
- mark comments as pending, in progress, resolved, or ignored;
- open the route related to a comment;
- display the screenshot, selector, and HTML context;
- export optional reports.

## 5. Main flow

### 5.1 Starting from a project

```powershell
cd Z:\Dev\my-vite-project
comment
```

Perfect Front must:

1. Resolve `Z:\Dev\my-vite-project` as the root.
2. Read the local configuration if it exists.
3. Detect that the project uses Vite.
4. Detect `pnpm`, `npm`, `yarn`, or `bun` from the lockfile and `packageManager`.
5. Look for a compatible server that is already running.
6. Run the project's `dev` script if needed.
7. Wait until the URL responds.
8. Register the relationship between the URL and the local root.
9. Open the URL in Chrome.
10. Tell the extension that the tab belongs to the project.

Expected output:

```text
Perfect Front

✓ Project: my-vite-project
✓ Detected: Vite + React
✓ Command: pnpm dev
✓ Application: http://localhost:5173
✓ Comments: .perfect-front/comments/inbox/
✓ Dashboard: http://localhost:45800

Opening Chrome…
```

### 5.2 Creating a comment

1. The user opens the extension popup.
2. They turn on “Comment on this page”.
3. The overlay starts inspecting elements.
4. The user selects an element.
5. They write the comment.
6. The extension captures the context.
7. It sends the payload to the local server.
8. The server identifies the project from the URL and the session registry.
9. It validates that the root is a registered folder.
10. It creates a stable ID.
11. It writes the JSON atomically into `inbox/`.
12. It notifies the dashboard.
13. The extension confirms the save.

### 5.3 Resolution

A comment can be resolved manually or by an agent.

Expected flow:

```text
pending → in_progress → resolved → archived
```

When resolving, the following must be recorded:

- resolution date;
- summary of the change;
- modified files, if known;
- optional identity of the person responsible;
- verification notes;
- optional commit.

The JSON is moved to the `resolved/` collection or to the collection configured by the user.

## 6. Persistence

### 6.1 Per-project structure

```text
my-project/
└── .perfect-front/
    ├── project.json
    ├── comments/
    │   ├── inbox/
    │   │   ├── pf_01K7A.json
    │   │   └── pf_01K7B.json
    │   ├── mobile/
    │   │   └── pf_01K6Z.json
    │   ├── redesign/
    │   ├── resolved/
    │   └── archived/
    └── attachments/
        ├── pf_01K7A.png
        └── pf_01K7B.png
```

Folders under `comments/` are collections. `inbox`, `resolved`, and `archived` exist by default. The user can create others, such as `mobile`, `checkout`, or `release-2`.

### 6.2 Project configuration

Example `.perfect-front/project.json`:

```json
{
  "version": 1,
  "name": "My project",
  "command": "pnpm dev",
  "url": "http://localhost:5173",
  "defaultCollection": "inbox",
  "resolvedCollection": "resolved",
  "captureScreenshots": true,
  "openBrowser": true
}
```

All fields except `version` can be created automatically. Explicit configuration takes precedence over detection.

### 6.3 Comment schema

Example `.perfect-front/comments/inbox/pf_01K7A.json`:

```json
{
  "version": 1,
  "id": "pf_01K7A",
  "status": "pending",
  "collection": "inbox",
  "scope": "element",
  "comment": "This button should take the full width on mobile.",
  "project": {
    "name": "My project",
    "relativeRoot": "."
  },
  "location": {
    "url": "http://localhost:5173/pricing",
    "route": "/pricing",
    "title": "Pricing",
    "selector": "main > section.pricing button.buy",
    "selectorCandidates": [
      "[data-testid=\"buy-button\"]",
      "main > section.pricing button.buy"
    ],
    "text": "Buy",
    "html": "<button class=\"buy\">Buy</button>",
    "componentHint": null
  },
  "viewport": {
    "width": 390,
    "height": 844,
    "devicePixelRatio": 2,
    "scrollX": 0,
    "scrollY": 726
  },
  "elementRect": {
    "x": 20,
    "y": 601,
    "width": 350,
    "height": 44
  },
  "environment": {
    "framework": "vite-react",
    "browser": "Chrome",
    "colorScheme": "dark"
  },
  "attachments": [
    "attachments/pf_01K7A.png"
  ],
  "createdAt": "2026-10-03T15:30:00.000Z",
  "updatedAt": "2026-10-03T15:30:00.000Z",
  "resolution": null
}
```

### 6.4 Full-view comment

When `scope` is `view`, `selector`, `html`, and `elementRect` may be null. The route, the viewport, the screenshot, and the comment remain required according to the configuration.

### 6.5 Resolution

Example of the `resolution` block:

```json
{
  "resolvedAt": "2026-10-03T17:10:00.000Z",
  "resolvedBy": "codex",
  "summary": "Applied full width to the button at the mobile breakpoint.",
  "filesChanged": [
    "src/components/BuyButton.tsx"
  ],
  "verification": [
    "pnpm test",
    "visual check at 390x844"
  ],
  "commit": null
}
```

### 6.6 Atomic operations

To avoid partial files:

1. write to a temporary file inside `.perfect-front/`;
2. validate the resulting JSON;
3. rename the temporary file over the destination;
4. emit the update event after the rename.

## 7. Moving and organizing

Moving a comment means physically moving its JSON between collections.

```text
Before:
.perfect-front/comments/inbox/pf_01K7A.json

After:
.perfect-front/comments/mobile/pf_01K7A.json
```

During the operation:

1. the ID is preserved;
2. `collection` and `updatedAt` are updated;
3. attachments are not duplicated;
4. no two copies of the comment remain;
5. the dashboard receives a move event.

The dashboard must support individual and batch moves.

Planned commands:

```bash
comment list
comment move pf_01K7A --to mobile
comment move pf_01K7A pf_01K7B --to resolved
comment collection create checkout
comment collection list
```

## 8. Markdown and exports

JSON is the only source of truth. Markdown is not maintained in parallel because it would cause duplication and drift.

A report can be generated when needed:

```bash
comment export --format md
comment export --format md --collection inbox
comment export --format json
```

Example output:

```text
.perfect-front/exports/comments-2026-10-03.md
```

Editing the report must not alter the original comments. A future import feature must be explicit and validate IDs.

## 9. Project detection

### 9.1 Priority

1. `.perfect-front/project.json`.
2. The `packageManager` field of `package.json`.
3. Lockfiles.
4. Framework-specific files.
5. `package.json` scripts.
6. Interactive configuration as a last resort.

### 9.2 Vite

Indicators:

- `vite` dependency;
- `vite.config.ts`, `.js`, `.mts`, or `.mjs`;
- `dev` script that runs Vite.

Typical command:

```bash
pnpm dev
```

Perfect Front must not modify `vite.config.*`, `main.*`, or the component tree.

### 9.3 Next.js

Indicators:

- `next` dependency;
- `next.config.*`;
- `dev` script that runs `next dev`.

### 9.4 Angular

Indicators:

- `angular.json`;
- `@angular/core` dependency;
- script that runs `ng serve`.

### 9.5 Static HTML

If `index.html` exists and no runnable framework is identified, Perfect Front starts its own static server. It must not alter the HTML files.

**Selection rules:**

- `index.html` is always the served page if it exists.
- If `index.html` does not exist and there are multiple HTML files in the root, Perfect Front:
  - shows an interactive selector to the user (`--page`, `--choose`);
  - remembers the selection in `.perfect-front/project.json` only with explicit user confirmation.

### 9.6 Existing server

If the server is already running:

- another process must not be started;
- it must be registered as an external process;
- `comment stop` must not terminate external processes unless an explicit option is given;
- the user can provide the URL:

```bash
comment --url http://localhost:4000
```

## 10. Server discovery

The extension is not the source of truth for local processes.

The local server knows with certainty:

- processes started by Perfect Front;
- the URL declared by configuration;
- ports confirmed during startup;
- projects registered in the session.

The extension discovers local Perfect Front servers automatically:

- it scans ports 45800–45820;
- it queries `GET /api/health` on each port;
- it gets the project list with `GET /api/projects` on live servers;
- when a project is tapped in the popup, it opens its URL in a new tab (focusing the existing one if already open).

There is no code pairing or interactive association. The server identifies the extension solely by its origin (`chrome-extension://<EXTENSION_ID>`), which the browser enforces and a web page cannot forge.

## 11. Planned CLI

```bash
comment
comment open
comment status
comment start
comment stop
comment restart
comment logs
comment list
comment show <id>
comment move <id...> --to <collection>
comment edit <id>
comment resolve <id>
comment ignore <id>
comment reopen <id>
comment collection create <name>
comment collection list
comment export --format md
comment --url <url>
comment --no-start
comment --no-open
```

### 11.1 `comment`

Main command. Equivalent to detect, register, start or connect, and open.

### 11.1.1 Execution mode

The `perfect-front` process runs in the **foreground**. Ctrl+C shuts down everything:

- all servers started by Perfect Front;
- the dashboard;
- the local server itself;
- the project's development processes (if they were started by Perfect Front).

The user must explicitly confirm if there are unsaved pending comments.

### 11.2 `comment resolve`

Without an ID, it can open an interactive selection of pending comments. With an ID, it marks the comment as resolved after requesting or receiving the required resolution data.

For agent integration, a machine-readable output must exist:

```bash
comment list --status pending --json
comment show pf_01K7A --json
comment resolve pf_01K7A --summary "..." --file src/App.tsx
```

## 12. Initial local API

Suggested base:

```text
http://127.0.0.1:45800
```

Conceptual routes:

```text
GET    /api/health
GET    /api/projects
POST   /api/projects/register
POST   /api/projects/:id/start
POST   /api/projects/:id/stop
GET    /api/projects/:id/logs
GET    /api/projects/:id/comments
POST   /api/projects/:id/comments
GET    /api/projects/:id/comments/:commentId
PATCH  /api/projects/:id/comments/:commentId
POST   /api/projects/:id/comments/:commentId/move
POST   /api/projects/:id/comments/:commentId/resolve
GET    /api/projects/:id/collections
POST   /api/projects/:id/collections
GET    /api/events
```

The API must not accept absolute paths sent by the overlay. It must receive a `projectId` and resolve the registered root internally.

## 13. Chrome extension

### 13.1 Manifest V3

Planned minimum permissions:

- `activeTab`;
- `scripting`;
- `storage`;
- optional permissions for local hosts when needed.

Global access to all sites must not be requested if the flow can work through temporary authorization of the active tab.

### 13.2 States

```text
OFF        normal view
SELECTING  visual inspection active
EDITING    comment form open
SAVING     sending to the local server
SAVED      brief confirmation
ERROR      recoverable error
```

### 13.3 Isolation

The overlay UI must live in a Shadow Root. Its styles must not depend on the site's CSS. It must use a controlled top layer and avoid blocking the application when the mode is off.

### 13.4 Initial shortcuts

Shortcuts will be configurable. Initial proposal:

```text
Alt + C       enable or disable comments
Escape        cancel selection or close the form
Enter         save when the form is active
```

Shortcuts must not fire while the user is typing, except Escape and explicit combinations.

### 13.5 Comment layer on by default

The comment layer is **on by default** on pages of registered projects. The popup has a global switch to turn it on or off (a persistent preference in `storage.local`). When turned off:

- the overlay is completely hidden;
- shortcuts do not run;
- the page can be used normally without interference.

Toggling is instant through messages between the content script and the service worker.

### 13.6 Selection and future localization

The MVP will be framework-agnostic and will use the DOM. It must keep multiple hints:

- `data-testid`, `id`, and ARIA attributes;
- structural CSS selector;
- normalized text;
- tag name;
- HTML fragment;
- route;
- approximate geometry;
- screenshot.

In later phases, adapters may be added to locate the source file in React, Angular, or other frameworks. This capability is not a requirement of the first MVP.

## 14. Dashboard

### 14.1 Visual layout

```text
┌ Projects ───────┬ Comments ──────────────────┬ Detail ──────────────┐
│ ContentOEP   7  │ Home                   3   │ Reduce spacing       │
│ ACME          2 │ Plans                  4   │                      │
│ Portfolio     0 │ Login                  2   │ screenshot & context │
│                 │                           │ status and actions    │
└─────────────────┴───────────────────────────┴───────────────────────┘
```

The comment's preview or context must be the protagonist. The side panels may collapse. The interface must not turn into a generic card grid.

### 14.2 Minimum capabilities

- project selection;
- server status;
- link to open the application;
- collection selector;
- search by text, route, and ID;
- status filters;
- comment editor;
- moving between collections;
- resolving and reopening;
- screenshot;
- safe display of HTML as text;
- real-time updates.

## 15. Security

Perfect Front can write to repositories and run commands, so it must be treated as a privileged local tool.

Minimum rules:

1. Listen only on `127.0.0.1` by default.
2. Do not accept LAN connections unless explicitly configured.
3. Recognize the official extension by its fixed ID (`Origin: chrome-extension://<EXTENSION_ID>`), enforced by the browser. No token for that role; it can only query health and list projects, comments, and events.
4. Issue a local session token at startup for the CLI and dashboard; required to register projects, control processes, and use administrative functions. Any other extension origin receives 403.
5. Validate `Origin` and `Host`.
6. Do not receive arbitrary filesystem paths from observed pages.
7. Resolve all destinations under the registered root.
8. Reject traversals such as `../` and links that escape the root.
9. Sanitize HTML and display it as code, never execute it.
10. Limit the sizes of comments, HTML, and screenshots.
11. Do not run scripts sent by a page or a comment.
12. Distinguish processes started by Perfect Front from external processes.

Messages coming from content scripts must be considered untrusted and validated again on the local server.

### 15.1 Trust model

There is no code pairing. The server recognizes the official extension solely by its fixed ID (`OFFICIAL_EXTENSION_ID` in `packages/shared/src/messages.ts`). The `chrome-extension://<ID>` origin is enforced by the browser and a web page cannot forge it.

**Accepted residual risk:** A local process run by the same user (not a browser) could forge the `Origin` header to access read-only endpoints (health, list projects, comments, events). That process already has the user's privileges over the project files, so the additional risk is minimal. Administrative endpoints (register, control processes) require a session token.

**Development IDs:** Only through explicit configuration in `PF_EXTENSION_IDS` (environment variable or `.perfect-front/config.json` file). They are not detected automatically.

## 16. Process management

Each managed process must record:

- project ID;
- PID;
- command and arguments, separated;
- working directory;
- start time;
- confirmed URL;
- port;
- status;
- last lines of output;
- whether it was started by Perfect Front.

The server must terminate only the processes it started, unless there is explicit confirmation for an external process.

When closing Perfect Front, a configurable policy will be defined:

- keep servers running;
- stop the servers started by Perfect Front;
- ask from the dashboard.

## 17. Initial compatibility and limits

### Included in the MVP

- Windows as the primary platform;
- Chrome or compatible Chromium browsers;
- Vite projects;
- Next.js;
- Angular;
- static HTML;
- local HTTP servers;
- element and view comments;
- one JSON per comment;
- physical collections;
- local dashboard;
- Markdown export.

### Out of the MVP

- automatic editing of classes or content;
- direct code modification from the overlay;
- React Fiber and precise component resolution;
- advanced source maps;
- cloud sync;
- multi-user collaboration;
- remote authentication;
- mandatory publication on the Chrome Web Store;
- guaranteed support for cross-origin iframes;
- remote applications that have no associated local folder.

## 18. Future repository structure

The repository is initially empty except for this specification. When implemented, the proposed structure is:

```text
perfect-front/
├── apps/
│   ├── dashboard/
│   └── extension/
├── packages/
│   ├── cli/
│   ├── local-server/
│   ├── overlay/
│   ├── project-detector/
│   ├── comment-storage/
│   └── shared/
├── SPEC.md
└── package.json
```

A valid alternative is to start with fewer packages and split responsibilities when the code justifies it. The logical architecture is mandatory; the exact physical fragmentation may evolve.

## 19. Implementation phases

### Phase 1 — Local core

- `comment` CLI;
- root detection;
- Vite detection;
- local server;
- project registration;
- one-JSON-per-comment storage;
- comment endpoints;
- minimal read-only dashboard.

### Phase 2 — Extension and overlay

- Manifest V3 extension loadable as unpacked;
- per-tab activation;
- overlay with Shadow DOM;
- element selection;
- comment creation;
- optional capture;
- real-time updates.

### Phase 3 — Full management

- editing;
- collections;
- individual and batch moves;
- resolving, reopening, and ignoring;
- search and filters;
- Markdown export;
- navigation from a comment to its route.

### Phase 4 — More project types

- Next.js;
- Angular;
- static HTML;
- existing servers and manual configuration;
- improved URL and port detection.

### Phase 5 — Agent integration

- JSON CLI output;
- non-interactive commands;
- contract for claiming and resolving comments;
- recording of modified files and verifications;
- optional adapters to locate source files.

## 20. Acceptance criteria for the first MVP

The MVP is considered functional when:

1. In a new Vite project, running `comment` starts or detects Vite.
2. The application opens in Chrome.
3. The extension can enable and disable the overlay.
4. An element can be selected and a comment written.
5. Exactly one valid JSON file is created in `comments/inbox/`.
6. The dashboard shows the comment without a manual reload.
7. The comment can be edited.
8. It can be moved to another collection without being duplicated.
9. It can be marked as resolved and keep its resolution data.
10. Restarting Perfect Front does not lose configured projects or comments.
11. The Vite application requires no code or configuration changes.
12. Perfect Front does not write outside `.perfect-front/` except for explicitly authorized future actions.

## 21. Confirmed decisions

### Architecture and product

- The product runs in the browser, not in Electron.
- A Chrome extension exists to toggle the comment layer.
- A local Node.js server exists for processes and the filesystem.
- A local web dashboard exists on a stable port.
- The main command is called `comment`.
- `comment` is run from the project root.
- Vite is a priority compatibility target.
- The observed application is not modified to install the overlay.
- Comments live inside the observed project.
- JSON is the source of truth.
- Each comment lives in a separate JSON file.
- Collections are physical folders.
- Moving a comment moves its file, without copying it.
- Markdown is an optional export, not parallel storage.
- The first version comments; it does not automatically edit the visual code.

### Technical decisions confirmed during implementation

| Decision | Choice | Rationale |
|---|---|---|
| HTTP server | Hono + @hono/node-server | Lightweight, Web Standards, local Node process. |
| Bundler (MV3 extension and dashboard) | Vite | Same bundler for the whole toolchain. |
| Event channel | Server-Sent Events (SSE) | One-way simplicity, no bidirectional need identified. |
| Schema validation | Zod 4 with inferred types | Declarative syntax, type inference in packages/shared. |
| Unit and integration testing | Vitest | Modern ecosystem, TypeScript support. |
| E2E testing | Playwright | Pending implementation (phase 7). |
| Monorepo orchestration | Recursive pnpm | No Turbo for now; scalable when needed. |
| Linter | ESLint flat config + typescript-eslint | TypeScript 6.x (v7 is not yet supported by typescript-eslint). |
| UI styles | packages/design-tokens | Single source: CSS tokens (--pf-*), utility classes (.pf-*), Shadow DOM isolation in the overlay. |
| CLI in development | node --import tsx | Until an optimized build exists (phase 11). |
| Extension authentication | Fixed ID + Origin, no token | The browser enforces `Origin: chrome-extension://<ID>`, which the web cannot forge; the extension role has no administrative privileges. |
| Server discovery | Port scan 45800–45820, GET /api/health | No code pairing; automatic, decentralized. |
| Comment layer | On by default, persistent global switch | Better UX on registered pages; the user chooses to turn it off. |
| Static HTML | index.html first; selector if multiple | Determinism without manual configuration when index.html exists. |
| Execution mode | Foreground, Ctrl+C shuts everything down | Operational simplicity; no initial daemonization. |

## 22. Open decisions for implementation

These decisions do not block the conceptual specification, but must be settled before or during scaffolding:

1. Publishable npm package name and availability of the `comment` binary.
2. Final fixed port or fallback strategy if `45800` is taken.
3. ✓ **Resolved:** Use Server-Sent Events (SSE) as the event channel.
4. ✓ **Resolved:** Exact dashboard framework: React + Vite.
5. ✓ **Resolved:** Extension build tool: Vite.
6. Default `.gitignore` policy for `.perfect-front/`.
7. Whether screenshots are enabled by default.
8. Strategy for stable project identification across sessions.
9. Behavior when a collection is renamed while the dashboard is open.
10. Initial extension distribution: unpacked, ZIP package, or Chrome Web Store.

## 23. Future vision

After the MVP, Perfect Front can become a common communication layer between the rendered interface and development tools. Optional adapters could locate components and source files, open the editor at a specific line, or deliver structured comments to agents. These capabilities must be built on top of the stable comment format, without replacing it or coupling the core to a specific framework.

---

> **Status:** v2 overlay schema (§6.3) lives on branch `feat/overlay-v2` and is not yet merged.
