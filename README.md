# ◆ Vocs Pi Control

**Run multiple Pi coding agents in isolated, rootless, sandboxed workspaces — right on your machine. Local-first, browser-based, zero cloud.**

> Your own AI coding control plane: every Pi session runs inside its own rootless-Podman container, sees **only the folder you explicitly add**, and never touches your SSH keys, cloud credentials, or the rest of your disk. Works on Windows, macOS, and Linux.

## Setup — one command

```bash
git clone https://github.com/vocsong/Vocs-Pi-Control.git
cd Vocs-Pi-Control
npm run quickstart
```

That's it. The script installs dependencies, sets up Podman (asks first), builds the sandbox image, starts the control server + web UI, and opens your browser. Add a project folder, create a session, and start prompting a **real Pi agent inside a rootless container**.

> Prerequisites: [Node.js ≥ 22](https://nodejs.org/). Everything else is handled.

---

## Features

### 🛡️ Secure by default — real isolation, not vibes
- **Rootless Podman sandboxes** — every workspace is its own container; no privileged mode, no Docker/Podman socket, no host network, no host devices
- **Deny-by-default filesystem** — agents see only the folders you explicitly add as workspaces; your home, SSH keys, and cloud credentials are never mounted
- **One-click security self-test** — proves in seconds that host home and sockets are absent and only `/workspace` is writable
- **Local-first privacy** — the control plane binds to `127.0.0.1`, your prompts and code never leave your machine except to the LLM provider you choose

### 🤖 Real Pi agents, fully managed
- **Multiple concurrent sessions per workspace** — Lead, Tester, Reviewer: all collaborating on the same shared files, `node_modules`, `.venv`, and Git state
- **Native Pi session persistence** — sessions survive container rebuilds and can be resumed exactly where they left off
- **Live streaming** — thinking, tool calls, and answers stream to your browser in real time
- **Model & thinking controls** — pick any provider model from Pi's live catalog, tune thinking levels, compact context

### 💻 A complete agent IDE
- **Files** — full explorer + CodeMirror editor with create/rename/delete, image & Markdown previews
- **Git** — status, diff, stage/unstage, commit, branches, history
- **Git worktrees** — independent agents automatically get their own worktree, workspace, **and container**
- **Terminals** — persistent PTY tabs that survive browser refreshes
- **App runner + port exposure** — dev servers inside the sandbox open on your localhost with one click
- **Tasks** — track and assign work across sessions
- **Trace** — per-session observability timeline with tool timings

### ⚡ Power user experience
- Command palette (`Ctrl+K`), quick file open (`Ctrl+P`), transcript search (`Ctrl+F`)
- Multiple sessions side by side with editing leases — no more clobbered prompts
- Reconnect hardening — refresh your browser mid-run and nothing is lost
- PWA baseline — installable, offline-capable shell
- Environment profiles — Node, Node+Python, or Universal images with one-click rebuild that preserves your workspace and caches

---

## Documentation

- **[Implementation plan](docs/pi-control-implementation-plan.md)** — the full spec behind this project
- **[Architecture](docs/architecture/overview.md)** — how the control plane, sandbox, and agent fit together
- **[API reference](docs/api/README.md)** — REST + WebSocket protocol
- **[Security](docs/security/threat-model.md)** — threat model and sandbox policy
- **[Architecture decisions](docs/adr/)** — ADR-0001 through ADR-0010
- **[Operations](docs/operations.md)** — build, run, troubleshoot
- **[Roadmap](TODO.md)** — what's shipped and what's next

## Status

Phases 0–12 complete: foundation → rootless Podman runtime → workspace agent → real Pi SDK integration → reconnect hardening → projects/workspaces/sessions UI → files → git/worktrees → terminals/processes/ports → Pi management → power UX → environment profiles → tasks/trace. Verified on Windows 11 + WSL.

## License

[Apache-2.0](LICENSE)
