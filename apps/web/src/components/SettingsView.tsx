import { useCallback, useEffect, useState } from "react";
import { usePiControl } from "../store";
import { api } from "../api";

const PROVIDER_LABELS: Record<string, string> = {
  ANTHROPIC_API_KEY: "Anthropic (Claude)",
  OPENAI_API_KEY: "OpenAI (GPT)",
  DEEPSEEK_API_KEY: "DeepSeek",
  GEMINI_API_KEY: "Google Gemini",
  GROQ_API_KEY: "Groq",
  XAI_API_KEY: "xAI (Grok)",
  OPENROUTER_API_KEY: "OpenRouter",
  MISTRAL_API_KEY: "Mistral",
  COHERE_API_KEY: "Cohere",
  TOGETHER_API_KEY: "Together AI",
  PERPLEXITY_API_KEY: "Perplexity",
};

export function SettingsView() {
  const activeSandboxId = usePiControl((s) => s.activeSandboxId);
  const sandboxes = usePiControl((s) => s.sandboxes);
  const [providers, setProviders] = useState<Array<{ key: string; configured: boolean }>>([]);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [defaultModel, setDefaultModel] = useState("");
  const [defaultThinking, setDefaultThinking] = useState("");
  const showThinkingByDefault = usePiControl((s) => s.showThinkingByDefault);
  const setShowThinkingByDefault = usePiControl((s) => s.setShowThinkingByDefault);
  const [rootFolder, setRootFolder] = useState("");
  const [models, setModels] = useState<Array<{ provider: string; id: string }>>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { settings } = await api.getSettings();
      setProviders(settings.providers);
      setDefaultModel(settings.defaults.defaultModel ?? "");
      setDefaultThinking(settings.defaults.defaultThinkingLevel ?? "");
      setRootFolder(settings.rootFolder ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    if (activeSandboxId) {
      try {
        const { models: m } = await api.listModels(activeSandboxId);
        setModels(m);
      } catch {
        /* agent offline */
      }
    }
  }, [activeSandboxId]);

  useEffect(() => {
    void load();
  }, [activeSandboxId, load]);

  const saveProviders = async () => {
    setError(null);
    try {
      await api.saveProviderKeys(keys);
      setKeys({});
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const saveRoot = async () => {
    setError(null);
    try {
      const { rootFolder: updated } = await api.saveRootFolder(rootFolder || null);
      setRootFolder(updated ?? "");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const saveDefaults = async () => {
    setError(null);
    try {
      await api.saveDefaults({ defaultModel: defaultModel || null, defaultThinkingLevel: defaultThinking || null });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const sandbox = activeSandboxId ? sandboxes[activeSandboxId] : undefined;

  return (
    <div className="settings-view">
      <section className="settings-section">
        <h2>Workspace root</h2>
        <p className="settings-hint">
          Everything Pi Control works on lives inside this folder — every workspace you add is created
          here (default: root/name). Folders outside the root are rejected.
        </p>
        <label className="settings-row">
          <span className="settings-label">Root folder</span>
          <input placeholder="C:/pi-control-workspaces" value={rootFolder} onChange={(e) => setRootFolder(e.target.value)} />
        </label>
        <div className="settings-actions">
          <button className="btn btn-primary" onClick={() => void saveRoot()}>
            Save root folder
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2>Providers & Authentication</h2>
        <p className="settings-hint">
          Keys are stored locally in the control plane (never returned by the API) and forwarded to workspace agents.
        </p>
        {providers.map((provider) => (
          <label key={provider.key} className="settings-row">
            <span className="settings-label">
              {PROVIDER_LABELS[provider.key] ?? provider.key}
              <span className={`provider-dot ${provider.configured ? "ok" : ""}`}>
                {provider.configured ? "● configured" : "○ not set"}
              </span>
            </span>
            <input
              type="password"
              placeholder={provider.configured ? "•••••••• (set a new key to replace)" : "Paste API key"}
              value={keys[provider.key] ?? ""}
              onChange={(e) => setKeys((k) => ({ ...k, [provider.key]: e.target.value }))}
            />
          </label>
        ))}
        <div className="settings-actions">
          <button className="btn btn-primary" onClick={() => void saveProviders()} disabled={Object.keys(keys).length === 0}>
            Save provider keys
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2>Session defaults</h2>
        <label className="settings-row">
          <span className="settings-label">Default model (provider/id)</span>
          <select value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)}>
            <option value="">(auto — Pi picks the default)</option>
            {models.map((m) => (
              <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
                {m.provider}/{m.id}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-row">
          <span className="settings-label">Default thinking level</span>
          <select value={defaultThinking} onChange={(e) => setDefaultThinking(e.target.value)}>
            <option value="">(Pi default)</option>
            {["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-row">
          <span className="settings-label">Show thinking blocks expanded by default</span>
          <input
            type="checkbox"
            checked={showThinkingByDefault}
            onChange={(e) => setShowThinkingByDefault(e.target.checked)}
          />
        </label>
        <div className="settings-actions">
          <button className="btn btn-primary" onClick={() => void saveDefaults()}>
            Save defaults
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2>Models</h2>
        {sandbox ? (
          <p className="settings-hint">
            Model catalog for sandbox <strong>{sandbox.name}</strong> (auth-filtered by configured keys):
          </p>
        ) : (
          <p className="settings-hint">Start a sandbox to see its model catalog.</p>
        )}
        <ul className="settings-models">
          {models.map((m) => (
            <li key={`${m.provider}/${m.id}`}>
              <span className="trace-type">{m.provider}</span>
              <span>{m.id}</span>
            </li>
          ))}
          {models.length === 0 && <li className="settings-hint">No models available — configure a provider key above.</li>}
        </ul>
      </section>

      {saved && <div className="settings-saved">✓ Saved</div>}
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}
