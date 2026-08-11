import { useEffect, useMemo, useRef, useState } from "react";
import { usePiControl } from "../store";
import { api } from "../api";

export interface CommandItem {
  id: string;
  title: string;
  category: string;
  keywords: string;
  run(): void | Promise<void>;
}

export function CommandPalette({
  open,
  onClose,
  commands,
  onQuickOpen,
}: {
  open: boolean;
  onClose: () => void;
  commands: CommandItem[];
  onQuickOpen: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const activeWorkspaceId = usePiControl((s) => s.activeWorkspaceId);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands.slice(0, 12);
    return commands
      .filter((c) => (c.title + " " + c.category + " " + c.keywords).toLowerCase().includes(q))
      .slice(0, 12);
  }, [commands, query]);

  if (!open) return null;

  const quickOpenCommand: CommandItem = {
    id: "quick-open",
    title: "Quick Open File…",
    category: "Files",
    keywords: "open file search ctrl-p",
    run: onQuickOpen,
  };
  const items = activeWorkspaceId ? [quickOpenCommand, ...filtered] : filtered;

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && items[0]) {
              void items[0].run();
              onClose();
            }
          }}
          placeholder="Type a command…"
        />
        <ul className="palette-list">
          {items.map((item) => (
            <li key={item.id}>
              <button
                className="palette-item"
                onClick={() => {
                  void item.run();
                  onClose();
                }}
              >
                <span className="palette-category">{item.category}</span>
                <span className="palette-title">{item.title}</span>
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="palette-empty">No matching commands</li>}
        </ul>
      </div>
    </div>
  );
}

/** Quick-open: filename search across the active workspace. */
export function QuickOpen({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (path: string) => void;
}) {
  const activeWorkspaceId = usePiControl((s) => s.activeWorkspaceId);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (open) {
      setQuery("");
      setMatches([]);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !activeWorkspaceId || query.trim().length < 1) {
      setMatches([]);
      return;
    }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void api
        .searchFiles(activeWorkspaceId, query.trim(), 30)
        .then(({ matches }) => setMatches(matches))
        .catch(() => setMatches([]));
    }, 200);
    return () => clearTimeout(timerRef.current);
  }, [query, activeWorkspaceId, open]);

  if (!open) return null;

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && matches[0]) {
              onPick(matches[0]);
              onClose();
            }
          }}
          placeholder="Search files…"
        />
        <ul className="palette-list">
          {matches.slice(0, 20).map((path) => (
            <li key={path}>
              <button
                className="palette-item"
                onClick={() => {
                  onPick(path);
                  onClose();
                }}
              >
                <span className="palette-category mono">{path.split("/").pop()}</span>
                <span className="palette-title mono">{path}</span>
              </button>
            </li>
          ))}
          {query.trim().length >= 1 && matches.length === 0 && (
            <li className="palette-empty">No files match “{query}”</li>
          )}
        </ul>
      </div>
    </div>
  );
}
