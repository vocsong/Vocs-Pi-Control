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

  // Initial load: health + persisted sessions.
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
  }, []);

  // Subscribe to the active session whenever the connection (re)opens.
  useEffect(() => {
    if (connection === "open" && activeSessionId) {
      const state = usePiControl.getState();
      void getRealtime()
        .sendCommand("session.subscribe", {
          sessionId: activeSessionId,
          lastSeq: state.lastSeq,
        })
        .catch(() => undefined);
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
