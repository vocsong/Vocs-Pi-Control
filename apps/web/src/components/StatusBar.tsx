import { usePiControl } from "../store";

export function StatusBar({ health }: { health: { version: string; runtime: string } | null }) {
  const connection = usePiControl((s) => s.connection);
  const lastSeq = usePiControl((s) => s.lastSeq);

  return (
    <footer className="statusbar">
      <span className={`conn conn-${connection}`} title={`WebSocket: ${connection}`}>
        {connection === "open" ? "● connected" : connection === "connecting" ? "◌ connecting" : "○ disconnected"}
      </span>
      <span className="statusbar-item">seq {lastSeq}</span>
      <span className="statusbar-item">runtime {health?.runtime ?? "…"}</span>
      <span className="statusbar-item">v{health?.version ?? "…"}</span>
      <span className="statusbar-spacer" />
      <span className="statusbar-item">Vocs Pi Control</span>
    </footer>
  );
}
