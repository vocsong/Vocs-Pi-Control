import { useEffect, useState } from "react";
import { usePiControl } from "./store";
import { getRealtime } from "./realtime/useRealtime";
import { api, type HealthInfo } from "./api";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { Composer } from "./components/Composer";
import { StatusBar } from "./components/StatusBar";

export function App() {
  const connection = usePiControl((s) => s.connection);
  const activeSessionId = usePiControl((s) => s.activeSessionId);
  const [health, setHealth] = useState<HealthInfo | null>(null);

  // Connect the realtime socket once.
  useEffect(() => {
    const client = getRealtime();
    client.connect();
    return () => client.disconnect();
  }, []);

  // Initial load: health + persisted sessions + hierarchy + sandbox status.
  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
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
      .listProjects()
      .then(({ projects }) => {
        usePiControl.setState({
          projects: Object.fromEntries(projects.map((p) => [p.id, p])),
          projectOrder: projects.map((p) => p.id),
        });
      })
      .catch(() => undefined);
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
      void getRealtime()
        .sendCommand("session.subscribe", {
          sessionId: activeSessionId,
          lastSeq: state.lastSeq,
        })
        .then(() => getRealtime().sendCommand("session.lease.take", { sessionId: activeSessionId }))
        .catch(() => undefined);
      const heartbeat = setInterval(() => {
        const current = usePiControl.getState().activeSessionId;
        if (current) {
          void getRealtime().sendCommand("session.lease.heartbeat", { sessionId: current }).catch(() => undefined);
        }
      }, 20_000);
      return () => {
        clearInterval(heartbeat);
        void getRealtime().sendCommand("session.lease.release", { sessionId: activeSessionId }).catch(() => undefined);
      };
    }
  }, [connection, activeSessionId]);

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-logo">◆</span>
        <span className="app-title">Vocs Pi Control</span>
        <span className="app-subtitle">local-first control plane for Pi</span>
      </header>
      <div className="app-body">
        <Sidebar />
        <div className="main-column">
          <ChatView />
          <Composer />
        </div>
      </div>
      <StatusBar health={health} />
    </div>
  );
}
