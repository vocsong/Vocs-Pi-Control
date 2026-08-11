import { useEffect, useRef, useState } from "react";
import { usePiControl } from "../store";
import { getRealtime } from "../realtime/useRealtime";

export function Composer() {
  const activeSessionId = usePiControl((s) => s.activeSessionId);
  const sessions = usePiControl((s) => s.sessions);
  const leases = usePiControl((s) => s.leases);
  const clientId = usePiControl((s) => s.clientId);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const realtime = getRealtime();

  const session = activeSessionId ? sessions[activeSessionId] : undefined;
  const running = session?.status === "running";
  const lease = activeSessionId ? leases[activeSessionId] : undefined;
  const leaseHeldByOther = !!lease?.holder && lease.holder !== clientId;

  useEffect(() => {
    textareaRef.current?.focus();
  }, [activeSessionId]);

  if (!session) return null;

  const takeControl = async () => {
    if (!activeSessionId) return;
    try {
      await realtime.sendCommand("session.lease.take", { sessionId: activeSessionId, force: true });
    } catch (error) {
      console.error("lease take failed", error);
    }
  };

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed || !activeSessionId) return;
    setBusy(true);
    setText("");
    try {
      await realtime.sendCommand("session.prompt", { sessionId: activeSessionId, text: trimmed });
    } catch (error) {
      console.error("prompt failed", error);
    } finally {
      setBusy(false);
      textareaRef.current?.focus();
    }
  };

  const abort = async () => {
    if (!activeSessionId) return;
    try {
      await realtime.sendCommand("session.abort", { sessionId: activeSessionId });
    } catch (error) {
      console.error("abort failed", error);
    }
  };

  return (
    <footer className="composer">
      {leaseHeldByOther && (
        <div className="lease-banner">
          Another client is controlling this session.
          <button className="btn btn-small" onClick={() => void takeControl()}>
            Take control
          </button>
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={text}
        placeholder="Ask Pi…  (Enter to send, Shift+Enter for newline)"
        rows={2}
        disabled={leaseHeldByOther}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
          if (e.key === "Escape") {
            void abort();
          }
        }}
      />
      <div className="composer-actions">
        {running ? (
          <button className="btn btn-danger" onClick={() => void abort()}>
            Abort (Esc)
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => void send()} disabled={busy || !text.trim() || leaseHeldByOther}>
            Send
          </button>
        )}
      </div>
    </footer>
  );
}
