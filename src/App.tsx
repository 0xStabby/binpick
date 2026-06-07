import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEventHandler,
} from "react";
import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { ThemeSelect, defaultPalettes } from "react-theme-select";
import "./App.css";

type ConfigItem = {
  label: string;
  command: string;
  icon?: string | null;
};

type AppConfig = {
  items: ConfigItem[];
  theme?: string | null;
};

type ViewMode = "launcher" | "theme-selector";

function App() {
  const [items, setItems] = useState<ConfigItem[]>([]);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [configDir, setConfigDir] = useState("");
  const [status, setStatus] = useState("");
  const [iconCache, setIconCache] = useState<Record<string, string>>({});
  const [theme, setTheme] = useState("hacker");
  const [view, setView] = useState<ViewMode>("launcher");
  const launcherRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resizeRef = useRef<() => void>(() => undefined);
  const windowHandle = useMemo(() => getCurrentWindow(), []);

  const resetState = () => {
    setQuery("");
    setActiveIndex(0);
    setStatus("");
    setView("launcher");
  };

  const isThemeSelectorCommand = (command: string) => {
    const normalized = command.trim();
    return (
      normalized.includes("binpick-theme-selector") ||
      normalized.includes("--theme-selector")
    );
  };

  const hideAndReset = () => {
    flushSync(() => {
      resetState();
    });
    windowHandle.hide().catch(() => undefined);
  };

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) => item.label.toLowerCase().includes(term));
  }, [items, query]);

  const missingIcons = useMemo(() => {
    const missing: string[] = [];
    for (const item of filtered) {
      if (!item.icon) continue;
      if (iconCache[item.icon]) continue;
      missing.push(item.icon);
      if (missing.length >= 48) break;
    }
    return missing;
  }, [filtered, iconCache]);

  useEffect(() => {
    if (missingIcons.length === 0) return;
    let cancelled = false;

    Promise.all(
      missingIcons.map(async (path) => {
        try {
          const data = await invoke<string>("get_icon_data", { path });
          return [path, data] as const;
        } catch {
          return null;
        }
      })
    ).then((results) => {
      if (cancelled) return;
      setIconCache((prev) => {
        const next = { ...prev };
        for (const result of results) {
          if (!result) continue;
          const [path, data] = result;
          if (!next[path]) {
            next[path] = data;
          }
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [missingIcons]);

  useEffect(() => {
    let unlistenConfig: (() => void) | undefined;
    let unlistenFocus: (() => void) | undefined;
    let unlistenTheme: (() => void) | undefined;
    let unlistenLauncher: (() => void) | undefined;
    let unlistenHidden: (() => void) | undefined;

    const focusInput = () => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.select();
    };

    listen<AppConfig>("config_refreshed", (event) => {
      setItems(event.payload.items ?? []);
      if (event.payload.theme) {
        setTheme(event.payload.theme);
      }
    })
      .then((stop) => {
        unlistenConfig = stop;
      })
      .catch((err) => setStatus(String(err)));

    listen("focus_input", () => {
      focusInput();
    })
      .then((stop) => {
        unlistenFocus = stop;
      })
      .catch((err) => setStatus(String(err)));

    listen("open_theme_selector", () => {
      setView("theme-selector");
      invoke("refresh_config").catch((err) => setStatus(String(err)));
    })
      .then((stop) => {
        unlistenTheme = stop;
      })
      .catch((err) => setStatus(String(err)));

    listen("open_launcher", () => {
      setView("launcher");
      invoke("refresh_config").catch((err) => setStatus(String(err)));
    })
      .then((stop) => {
        unlistenLauncher = stop;
      })
      .catch((err) => setStatus(String(err)));

    listen("window_hidden", () => {
      resetState();
    })
      .then((stop) => {
        unlistenHidden = stop;
      })
      .catch((err) => setStatus(String(err)));

    invoke("refresh_config").catch((err) => setStatus(String(err)));

    invoke<AppConfig>("get_config")
      .then((config) => {
        setItems(config.items ?? []);
        if (config.theme) {
          setTheme(config.theme);
        }
      })
      .catch((err) => setStatus(String(err)));

    invoke<string>("get_startup_mode")
      .then((mode) => {
        if (mode === "theme-selector") {
          setView("theme-selector");
        }
      })
      .catch((err) => setStatus(String(err)));

    invoke<string>("get_config_dir")
      .then((dir) => setConfigDir(dir))
      .catch((err) => setStatus(String(err)));

    return () => {
      if (unlistenConfig) {
        unlistenConfig();
      }
      if (unlistenFocus) {
        unlistenFocus();
      }
      if (unlistenTheme) {
        unlistenTheme();
      }
      if (unlistenLauncher) {
        unlistenLauncher();
      }
      if (unlistenHidden) {
        unlistenHidden();
      }
    };
  }, []);

  useEffect(() => {
    if (view !== "launcher") return;
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.select();
    });
  }, [view]);

  useEffect(() => {
    requestAnimationFrame(() => {
      resizeRef.current();
    });
  }, [view]);

  useEffect(() => {
    const palette = defaultPalettes[theme] ?? defaultPalettes.hacker;
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.setProperty("--background", palette.background);
    root.style.setProperty("--surface", palette.surface);
    root.style.setProperty("--text", palette.text);
    root.style.setProperty("--border", palette.border);
    root.style.setProperty("--primary", palette.primary);
    root.style.setProperty("--success", palette.success);
    root.style.setProperty("--warning", palette.warning);
    root.style.setProperty("--danger", palette.danger);
    root.style.setProperty("--info", palette.info);
    root.style.setProperty("--muted", palette.muted ?? palette.text);
  }, [theme]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        hideAndReset();
      }
      if (event.key.toLowerCase() === "q" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        invoke("quit").catch(() => undefined);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [windowHandle]);

  useLayoutEffect(() => {
    const launcher = launcherRef.current;
    if (!launcher) return;

    const resize = () => {
      const rect = launcher.getBoundingClientRect();
      const width = Math.max(rect.width, launcher.scrollWidth);
      const height = Math.max(rect.height, launcher.scrollHeight);
      const nextWidth = Math.ceil(width + 2);
      const nextHeight = Math.ceil(height + 2);
      windowHandle
        .setSize(new LogicalSize(nextWidth, nextHeight))
        .catch(() => undefined);
    };

    resizeRef.current = resize;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      if (entry.contentRect.width === 0 || entry.contentRect.height === 0) {
        return;
      }
      resize();
    });

    observer.observe(launcher);
    resize();

    return () => {
      observer.disconnect();
      resizeRef.current = () => undefined;
    };
  }, []);

  useEffect(() => {
    if (activeIndex >= filtered.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, filtered.length]);

  const runItem = async (item: ConfigItem) => {
    setStatus("");
    try {
      await invoke("run_command", { command: item.command });
      if (!isThemeSelectorCommand(item.command)) {
        hideAndReset();
      }
    } catch (err) {
      setStatus(String(err));
    }
  };

  const handleKeyDown: KeyboardEventHandler<HTMLInputElement> = (event) => {
    if (filtered.length === 0 && event.key !== "Escape") {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((idx) => Math.min(idx + 1, filtered.length - 1));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((idx) => Math.max(idx - 1, 0));
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const item = filtered[activeIndex];
      if (item) {
        runItem(item);
      }
    }
    if (event.key === "Escape") {
      event.preventDefault();
      hideAndReset();
    }
  };

  const handleThemeChange = (nextTheme: string) => {
    setTheme(nextTheme);
    invoke("set_theme", { theme: nextTheme }).catch((err) => setStatus(String(err)));
  };

  return (
    <main className="app">
      <section
        className={`launcher${view === "theme-selector" ? " launcher--themes" : ""}`}
        ref={launcherRef}
      >
        {view === "theme-selector" ? (
          <div className="theme-selector">
            <ThemeSelect
              theme={theme}
              setTheme={handleThemeChange}
              availableThemes={Object.keys(defaultPalettes)}
            />
          </div>
        ) : (
          <>
        <div className="search">
          <label className="sr-only" htmlFor="launcher-input">
            Search commands
          </label>
          <input
            id="launcher-input"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search commands..."
            autoFocus
            ref={inputRef}
          />
        </div>

        <ul className="results">
          {filtered.length === 0 && (
            <li className="empty">No matches. Try another keyword.</li>
          )}
          {filtered.map((item, index) => (
            <li key={`${item.label}-${item.command}`}>
              <button
                type="button"
                className={index === activeIndex ? "active" : undefined}
                onClick={() => runItem(item)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span className="entry">
                  {item.icon && iconCache[item.icon] && (
                    <img
                      className="icon"
                      src={iconCache[item.icon]}
                      alt=""
                      loading="lazy"
                    />
                  )}
                  <span className="label">{item.label}</span>
                </span>
                <span className="command">{item.command}</span>
              </button>
            </li>
          ))}
        </ul>

        <span className="sr-only">{status || "Ready."}</span>
        <span className="sr-only">{configDir || "Config: loading..."}</span>
          </>
        )}
      </section>
    </main>
  );
}

export default App;
