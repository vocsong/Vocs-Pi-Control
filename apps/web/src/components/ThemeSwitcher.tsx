import { useState } from "react";
import { THEMES, applyTheme, currentTheme, type ThemeId } from "../themes";

export function ThemeSwitcher() {
  const [active, setActive] = useState<ThemeId>(currentTheme());

  const pick = (id: ThemeId) => {
    applyTheme(id);
    setActive(id);
  };

  return (
    <div className="theme-switcher" title="UI theme">
      {THEMES.map((theme) => (
        <button
          key={theme.id}
          className={`theme-switcher-btn theme-btn-${theme.id} ${active === theme.id ? "active" : ""}`}
          title={`${theme.name} — ${theme.tagline}`}
          onClick={() => pick(theme.id)}
        >
          {theme.name}
        </button>
      ))}
    </div>
  );
}
