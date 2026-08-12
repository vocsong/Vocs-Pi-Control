import { useState } from "react";
import { api } from "../api";
import { usePiControl } from "../store";

/**
 * Bootstrap-token login gate (ADR-0008, issue #1). Shown whenever the
 * browser has no valid session cookie; the token is printed to the server
 * console at startup and persisted in the control-plane settings table.
 */
export function LoginGate() {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmed = token.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(trimmed);
      usePiControl.getState().setAuthenticated(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-gate">
      <div className="login-card">
        <h1>Pi Control</h1>
        <p className="login-hint">
          This control plane is protected. Enter the bootstrap token printed in the server console
          to unlock it.
        </p>
        <input
          className="login-input"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          placeholder="bootstrap token"
          autoFocus
        />
        {error && <div className="login-error">{error}</div>}
        <button className="btn btn-primary" disabled={busy || !token.trim()} onClick={() => void submit()}>
          {busy ? "Unlocking…" : "Unlock"}
        </button>
      </div>
    </div>
  );
}
