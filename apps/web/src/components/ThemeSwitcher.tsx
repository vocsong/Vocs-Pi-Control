import { useEffect, useRef, useState } from "react";
import { THEMES, applyTheme, currentTheme, type ThemeId } from "../themes";

export function ThemeSwitcher() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<ThemeId>(currentTheme());
  const rootRef = useRef<HTMLDivElement>(null);

  const activeInfo = THEMES.find((t) => t.id === active) ?? THEMES[2]!;

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (id: ThemeId) => {
    applyTheme(id);
    setActive(id);
    setOpen(false);
  };

  return (
    <div className="theme-switcher" ref={rootRef}>
      <button className="theme-trigger" onClick={() => setOpen((v) => !v)} title="Choose UI theme">
        <span className="theme-trigger-dot" aria-hidden="true" />
        Theme {open ? "▴" : "▾"}
      </button>
      {open && (
        <div className="theme-menu">
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              className={`theme-menu-item theme-btn-${theme.id} ${active === theme.id ? "active" : ""}`}
              onClick={() => pick(theme.id)}
            >
              <span className="theme-menu-swatch" aria-hidden="true" />
              <span className="theme-menu-name">{theme.name}</span>
              <span className="theme-menu-tagline">{theme.tagline}</span>
              {active === theme.id && <span className="theme-menu-check">✓</span>}
            </button>
          ))}
        </div>
      )}
      <span className="theme-current" title="Active theme">
        {activeInfo.name}
      </span>
    </div>
  );
}
