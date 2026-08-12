import { useEffect, useState } from "react";
import { usePiControl } from "./store";
import { getRealtime } from "./realtime/useRealtime";
import { api, type HealthInfo } from "./api";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { Composer } from "./components/Composer";
import { FilesView } from "./components/FilesView";
import { GitView } from "./components/GitView";
import { ProcessesView, TerminalView } from "./components/TerminalView";
import { TasksView } from "./components/TasksView";
import { LogView } from "./components/LogView";
import { SettingsView } from "./components/SettingsView";
import { TraceView } from "./components/TraceView";
import { CommandPalette, QuickOpen, type CommandItem } from "./components/CommandPalette";
import { ThemeSwitcher } from "./components/ThemeSwitcher";
import { StatusBar } from "./components/StatusBar";
import { LoginGate } from "./components/LoginGate";

type Tab = "chat" | "files" | "git" | "terminal" | "processes" | "tasks" | "trace" | "log" | "settings";

export function App() {
  const connection = usePiControl((s) => s.connection);
  const authenticated = usePiControl((s) => s.authenticated);
  const activeSessionId = usePiControl((s) => s.activeSessionId);
  const activeWorkspaceId = usePiControl((s) => s.activeWorkspaceId);
  const activeSandboxId = usePiControl((s) => s.activeSandboxId);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [tab, setTab] = useState<Tab>("chat");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Connect the realtime socket once the session is confirmed; the socket
  // itself reports 4401 if the cookie expires later (#1).
  useEffect(() => {
    if (authenticated !== true) return;
    const client = getRealtime();
    client.connect();
    return () => client.disconnect();
  }, [authenticated]);

  // Auth probe on mount (before any data loads).
  useEffect(() => {
    let cancelled = false;
    api
      .authStatus()
      .then(({ authenticated: ok }) => {
        if (!cancelled) usePiControl.getState().setAuthenticated(ok);
      })
      .catch(() => {
        if (!cancelled) usePiControl.getState().setAuthenticated(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (authenticated === false) {
    return <LoginGate />;
  }

  // Initial load: health + persisted sessions + hierarchy + sandbox status.
  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch(() => setHealth(null));
    void usePiControl.getState().loadSettings();
    api
      .listSessions()
      .then(({ sessions }) => {
        usePiControl.setState({
          sessions: Object.fromEntries(sessions.map((s) => [s.id, s])),
          sessionOrder: sessions.map((s) => s.id),
        });
        const state = usePiControl.getState();
        if (!state.activeSessionId && sessions.length > 0) {
          state.setActive(sessions[0]!.id);
        }
      })
      .catch(() => {
        /* server may not be up yet; the socket will surface it */
      });
    api
      .listWorkspaces()
      .then(({ workspaces }) => {
        usePiControl.setState({
          workspaces: Object.fromEntries(workspaces.map((w) => [w.id, w])),
          workspaceOrder: workspaces.map((w) => w.id),
        });
      })
      .catch(() => undefined);
    api
      .listSandboxes()
      .then(({ sandboxes }) => {
        usePiControl.setState({
          sandboxes: Object.fromEntries(sandboxes.map((sb) => [sb.id, sb])),
          sandboxOrder: sandboxes.map((sb) => sb.id),
        });
      })
      .catch(() => undefined);
    api
      .sandboxStatus()
      .then(({ status }) => usePiControl.setState({ sandbox: status }))
      .catch(() => undefined);
  }, []);

  // Subscribe to the active session whenever the connection (re)opens, and
  // manage the editing lease (plan §27): take on subscribe, heartbeat while
  // active, release when switching away.
  useEffect(() => {
    if (connection === "open" && activeSessionId) {
      const state = usePiControl.getState();
      usePiControl.setState({ replaying: true });
      void getRealtime()
        .sendCommand("session.subscribe", {
          sessionId: activeSessionId,
          lastSeq: state.lastSeq,
        })
        .then(() => getRealtime().sendCommand("session.lease.take", { sessionId: activeSessionId }))
        .catch(() => usePiControl.setState({ replaying: false }));
      const heartbeat = setInterval(() => {
        const current = usePiControl.getState().activeSessionId;
        if (current) {
          void getRealtime().sendCommand("session.lease.heartbeat", { sessionId: current }).catch(() => undefined);
        }
      }, 20_000);
      return () => {
        clearInterval(heartbeat);
        usePiControl.setState({ replaying: false });
        void getRealtime().sendCommand("session.lease.release", { sessionId: activeSessionId }).catch(() => undefined);
      };
    }
  }, [connection, activeSessionId]);

  // Command palette + keyboard shortcuts (plan §33).
  const commands: CommandItem[] = [
    {
      id: "new-session",
      title: "New Session",
      category: "Sessions",
      keywords: "create chat mock",
      run: () => void usePiControl.getState().createSession(),
    },
    {
      id: "new-workspace",
      title: "Add Workspace…",
      category: "Workspaces",
      keywords: "add folder sandbox",
      run: () => setSidebarOpen(true),
    },
    { id: "switch-chat", title: "Chat", category: "View", keywords: "session prompt", run: () => setTab("chat") },
    { id: "switch-files", title: "Files", category: "View", keywords: "explorer editor", run: () => setTab("files") },
    { id: "switch-git", title: "Git", category: "View", keywords: "status diff commit", run: () => setTab("git") },
    { id: "switch-terminal", title: "Terminal", category: "View", keywords: "shell pty", run: () => setTab("terminal") },
    { id: "switch-processes", title: "Processes", category: "View", keywords: "apps runner ports", run: () => setTab("processes") },
    {
      id: "prepare-sandbox",
      title: "Prepare Sandbox",
      category: "Sandbox",
      keywords: "podman machine rootless",
      run: () => void usePiControl.getState().prepareSandbox(),
    },
    {
      id: "sandbox-selftest",
      title: "Run Sandbox Self-Test",
      category: "Sandbox",
      keywords: "isolation security",
      run: () => void usePiControl.getState().runSelfTest(),
    },
    {
      id: "abort-agent",
      title: "Abort Agent",
      category: "Session",
      keywords: "stop escape",
      run: () => {
        const state = usePiControl.getState();
        if (state.activeSessionId) {
          void getRealtime().sendCommand("session.abort", { sessionId: state.activeSessionId }).catch(() => undefined);
        }
      },
    },
    {
      id: "compact-context",
      title: "Compact Context",
      category: "Session",
      keywords: "summarize tokens",
      run: () => {
        const state = usePiControl.getState();
        const session = state.activeSessionId ? state.sessions[state.activeSessionId] : undefined;
        if (state.activeSessionId && session?.workspaceId) {
          void api.compactSession(state.activeSessionId).catch(() => undefined);
        }
      },
    },
  ];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (mod && event.key.toLowerCase() === "p") {
        event.preventDefault();
        if (usePiControl.getState().activeSandboxId) setQuickOpenOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Live workspace detection: poll so folders added to the root folder
  // appear without a manual refresh.
  useEffect(() => {
    const load = () => {
      api
        .listWorkspaces()
        .then(({ workspaces }) => {
          usePiControl.setState({
            workspaces: Object.fromEntries(workspaces.map((w) => [w.id, w])),
            workspaceOrder: workspaces.map((w) => w.id),
          });
        })
        .catch(() => undefined);
      api
        .listSandboxes()
        .then(({ sandboxes }) => {
          usePiControl.setState({
            sandboxes: Object.fromEntries(sandboxes.map((sb) => [sb.id, sb])),
            sandboxOrder: sandboxes.map((sb) => sb.id),
          });
        })
        .catch(() => undefined);
    };
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, []);

  // Baseline notification: flash the title when an assistant run finishes.
  useEffect(() => {
    return getRealtime().onEvent((envelope) => {
      if (envelope.type === "session.state" && (envelope.payload as { status?: string }).status === "idle") {
        const original = document.title;
        document.title = "● Pi Control";
        setTimeout(() => {
          document.title = original;
        }, 2000);
      }
    });
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <button className="btn btn-icon sidebar-toggle" onClick={() => setSidebarOpen((v) => !v)} title="Toggle sidebar">
          ☰
        </button>
        <span className="app-logo">◆</span>
        <span className="app-title">Vocs Pi Control</span>
        <span className="app-subtitle">local-first control plane for Pi</span>
        <span className="app-shortcuts">
          <kbd>Ctrl K</kbd> palette · <kbd>Ctrl P</kbd> files
        </span>
        <ThemeSwitcher />
        <button className="btn btn-icon" title="Settings: providers, models, defaults" onClick={() => setTab("settings")}>
          ⚙
        </button>
      </header>
      <div className={`app-body ${sidebarOpen ? "sidebar-visible" : ""}`}>
        <Sidebar />
        <div className="main-column">
          <div className="tabbar">
            <button className={`tab ${tab === "chat" ? "active" : ""}`} onClick={() => setTab("chat")}>
              Chat
            </button>
            <button
              className={`tab ${tab === "files" ? "active" : ""} ${!activeSandboxId ? "disabled" : ""}`}
              disabled={!activeWorkspaceId}
              onClick={() => setTab("files")}
              title={activeSandboxId ? "Sandbox files" : "Start a sandbox first"}
            >
              Files
            </button>
            <button
              className={`tab ${tab === "git" ? "active" : ""} ${!activeSandboxId ? "disabled" : ""}`}
              disabled={!activeWorkspaceId}
              onClick={() => setTab("git")}
            >
              Git
            </button>
            <button
              className={`tab ${tab === "terminal" ? "active" : ""} ${!activeSandboxId ? "disabled" : ""}`}
              disabled={!activeWorkspaceId}
              onClick={() => setTab("terminal")}
            >
              Terminal
            </button>
            <button
              className={`tab ${tab === "processes" ? "active" : ""} ${!activeSandboxId ? "disabled" : ""}`}
              disabled={!activeWorkspaceId}
              onClick={() => setTab("processes")}
            >
              Processes
            </button>
            <button
              className={`tab ${tab === "tasks" ? "active" : ""} ${!activeSandboxId ? "disabled" : ""}`}
              disabled={!activeWorkspaceId}
              onClick={() => setTab("tasks")}
            >
              Tasks
            </button>
            <button className={`tab ${tab === "trace" ? "active" : ""}`} onClick={() => setTab("trace")}>
              Trace
            </button>
            <button className={`tab ${tab === "log" ? "active" : ""}`} onClick={() => setTab("log")}>
              Log
            </button>
            <button className={`tab ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")}>
              Settings
            </button>
          </div>
          {tab === "chat" && (
            <>
              <ChatView />
              <Composer />
            </>
          )}
          {tab === "files" && <FilesView />}
          {tab === "git" && <GitView />}
          {tab === "terminal" && <TerminalView />}
          {tab === "processes" && <ProcessesView />}
          {tab === "tasks" && <TasksView />}
          {tab === "trace" && <TraceView />}
          {tab === "log" && <LogView />}
          {tab === "settings" && <SettingsView />}
        </div>
      </div>
      <StatusBar health={health} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
        onQuickOpen={() => setQuickOpenOpen(true)}
      />
      <QuickOpen
        open={quickOpenOpen}
        onClose={() => setQuickOpenOpen(false)}
        onPick={(path) => {
          usePiControl.getState().setRequestedFile(path);
          setTab("files");
        }}
      />
    </div>
  );
}
