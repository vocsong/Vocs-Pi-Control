import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { AgentProcessInfo, TerminalInfo } from "@pi-control/protocol";
import { usePiControl } from "../store";
import { getRealtime } from "../realtime/useRealtime";
import { api } from "../api";

/* ------------------------------------------------------------------ */
/* Terminal tab                                                        */
/* ------------------------------------------------------------------ */

interface TerminalSession extends TerminalInfo {
  term: Terminal;
  fit: FitAddon;
}

export function TerminalView() {
  const activeSandboxId = usePiControl((s) => s.activeSandboxId);
  const sandboxes = usePiControl((s) => s.sandboxes);
  const sandbox = activeSandboxId ? sandboxes[activeSandboxId] : undefined;
  const [sessions, setSessions] = useState<Record<string, TerminalSession>>({});
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const realtime = getRealtime();

  // Live output events → terminals.
  useEffect(() => {
    if (!activeSandboxId) return;
    const unsubscribe = realtime.onEvent((envelope) => {
      if (envelope.type === "terminal.output") {
        const payload = envelope.payload as { terminalId: string; data: string };
        const session = sessionsRef.current[payload.terminalId];
        session?.term.write(payload.data);
      }
      if (envelope.type === "terminal.closed") {
        const payload = envelope.payload as { terminalId: string };
        const session = sessionsRef.current[payload.terminalId];
        if (session) {
          session.term.dispose();
          setSessions((prev) => {
            const next = { ...prev };
            delete next[payload.terminalId];
            return next;
          });
        }
      }
    });
    return unsubscribe;
  }, [activeSandboxId, realtime]);

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  // Restore existing terminals on mount/workspace switch.
  useEffect(() => {
    if (!activeSandboxId) return;
    void api
      .listTerminals(activeSandboxId)
      .then(({ terminals }) => {
        for (const info of terminals as TerminalInfo[]) {
          if (!sessionsRef.current[info.id]) {
            const term = new Terminal({ cursorBlink: true, fontSize: 13 });
            const fit = new FitAddon();
            term.loadAddon(fit);
            term.write(info.buffer);
            term.onData((data) => {
              void realtime.sendCommand("terminal.input", { workspaceId: activeSandboxId, terminalId: info.id, data }).catch(() => undefined);
            });
            setSessions((prev) => ({ ...prev, [info.id]: { ...info, term, fit } }));
            if (!active) setActive(info.id);
          }
        }
      })
      .catch(() => undefined);
    return () => {
      // Dispose xterm instances (the AGENT terminals stay alive).
      for (const session of Object.values(sessionsRef.current)) session.term.dispose();
      setSessions({});
      setActive(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSandboxId]);

  // Attach the active terminal to the DOM + fit.
  useEffect(() => {
    if (!active || !containerRef.current) return;
    const session = sessions[active];
    if (!session) return;
    const el = containerRef.current;
    session.term.open(el);
    session.fit.fit();
    const onResize = () => session.fit.fit();
    window.addEventListener("resize", onResize);
    const observer = new ResizeObserver(() => session.fit.fit());
    observer.observe(el);
    return () => {
      window.removeEventListener("resize", onResize);
      observer.disconnect();
    };
  }, [active, sessions]);

  const openTerminal = async () => {
    if (!activeSandboxId) return;
    setError(null);
    try {
      const ack = await realtime.sendCommand("terminal.open", { workspaceId: activeSandboxId, cols: 80, rows: 24 });
      const payload = (ack.payload as { terminalId: string; terminal: TerminalInfo }).terminal;
      const terminalId = (ack.payload as { terminalId: string }).terminalId;
      const term = new Terminal({ cursorBlink: true, fontSize: 13 });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.onData((data) => {
        void realtime.sendCommand("terminal.input", { workspaceId: activeSandboxId, terminalId, data }).catch(() => undefined);
      });
      const session: TerminalSession = { ...payload, id: terminalId, term, fit };
      setSessions((prev) => ({ ...prev, [terminalId]: session }));
      setActive(terminalId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const closeTerminal = async (terminalId: string) => {
    if (!activeSandboxId) return;
    try {
      await realtime.sendCommand("terminal.close", { workspaceId: activeSandboxId, terminalId });
    } catch {
      /* the closed event will clean up */
    }
    const session = sessions[terminalId];
    session?.term.dispose();
    setSessions((prev) => {
      const next = { ...prev };
      delete next[terminalId];
      return next;
    });
  };

  if (!sandbox) {
    return <div className="files-empty">Start a sandbox to open a terminal.</div>;
  }

  return (
    <div className="terminal-view">
      <div className="terminal-tabs">
        {Object.values(sessions).map((session) => (
          <span key={session.id} className={`terminal-tab ${active === session.id ? "active" : ""}`} onClick={() => setActive(session.id)}>
            {session.shell}
            <button className="terminal-tab-close" onClick={() => void closeTerminal(session.id)}>
              ✕
            </button>
          </span>
        ))}
        <button className="btn btn-small terminal-new" onClick={() => void openTerminal()}>
          + New terminal
        </button>
        {error && <span className="form-error">{error}</span>}
      </div>
      <div className="terminal-container" ref={containerRef} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Processes tab                                                       */
/* ------------------------------------------------------------------ */

export function ProcessesView() {
  const activeSandboxId = usePiControl((s) => s.activeSandboxId);
  const sandboxes = usePiControl((s) => s.sandboxes);
  const sandbox = activeSandboxId ? sandboxes[activeSandboxId] : undefined;
  const [processes, setProcesses] = useState<AgentProcessInfo[]>([]);
  const [output, setOutput] = useState<Record<string, string[]>>({});
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [port, setPort] = useState("");
  const [ports, setPorts] = useState<Array<{ containerPort: number; url: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const realtime = getRealtime();

  const refresh = async () => {
    if (!activeSandboxId) return;
    try {
      const { processes } = await api.listProcesses(activeSandboxId);
      setProcesses(processes);
      setPorts(await api.listPorts(activeSandboxId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSandboxId]);

  // Live process output.
  useEffect(() => {
    if (!activeSandboxId) return;
    return realtime.onEvent((envelope) => {
      if (envelope.type === "process.output") {
        const payload = envelope.payload as { processId: string; text: string };
        setOutput((prev) => ({
          ...prev,
          [payload.processId]: [...(prev[payload.processId] ?? []).slice(-200), payload.text],
        }));
      }
      if (envelope.type === "process.exited") {
        const payload = envelope.payload as { processId: string; exitCode: number };
        setOutput((prev) => ({
          ...prev,
          [payload.processId]: [...(prev[payload.processId] ?? []), `\n[process exited with code ${payload.exitCode}]\n`],
        }));
        void refresh();
      }
    });
  }, [activeSandboxId, realtime]);

  const spawn = async () => {
    if (!activeSandboxId || !command.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const env = port.trim() ? { PORT: port.trim(), HOST: "0.0.0.0" } : undefined;
      await api.spawnProcess(activeSandboxId, { name: name.trim() || command.trim().split(/\s+/)[0], command: command.trim().split(/\s+/), env });
      setName("");
      setCommand("");
      setPort("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const kill = async (processId: string) => {
    if (!activeSandboxId) return;
    try {
      await api.killProcess(activeSandboxId, processId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!sandbox) {
    return <div className="files-empty">Start a sandbox to manage processes.</div>;
  }

  return (
    <div className="processes-view">
      <div className="processes-spawn">
        <input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <input
          placeholder="Command (e.g. npm run dev)"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void spawn()}
        />
        <input
          placeholder="Port (43100-43119)"
          value={port}
          onChange={(e) => setPort(e.target.value)}
          title="Ports in 43100-43119 are exposed on host loopback"
        />
        <button className="btn btn-small btn-primary" disabled={busy || !command.trim()} onClick={() => void spawn()}>
          Run
        </button>
      </div>
      {error && <div className="form-error">{error}</div>}

      {ports.length > 0 && (
        <div className="ports-bar">
          <span className="ports-label">Running apps:</span>
          {ports.map((p) => (
            <a key={p.containerPort} className="port-link" href={p.url} target="_blank" rel="noreferrer">
              ● {p.url}
            </a>
          ))}
        </div>
      )}

      <div className="processes-list">
        {processes.length === 0 && <div className="files-empty">No supervised processes.</div>}
        {processes.map((process) => (
          <div key={process.id} className="process-card">
            <div className="process-card-header">
              <span className={`status-dot status-${process.status}`}>●</span>
              <span className="process-name">{process.name}</span>
              <span className="process-meta">
                {process.status}
                {process.pid ? ` · pid ${process.pid}` : ""}
                {process.exitCode !== undefined ? ` · exit ${process.exitCode}` : ""}
              </span>
              <button className="btn btn-small btn-danger" onClick={() => void kill(process.id)}>
                Kill
              </button>
            </div>
            {(output[process.id] ?? []).length > 0 && (
              <pre className="process-output">{(output[process.id] ?? []).join("").slice(-4000)}</pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
