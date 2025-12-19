import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEventHandler,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";

type ConfigItem = {
  label: string;
  command: string;
  icon?: string | null;
};

type AppConfig = {
  items: ConfigItem[];
};

function App() {
  const [items, setItems] = useState<ConfigItem[]>([]);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [configDir, setConfigDir] = useState("");
  const [status, setStatus] = useState("");
  const [iconCache, setIconCache] = useState<Record<string, string>>({});
  const launcherRef = useRef<HTMLElement | null>(null);
  const resizeRef = useRef<() => void>(() => undefined);

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
    invoke<AppConfig>("get_config")
      .then((config) => {
        setItems(config.items ?? []);
      })
      .catch((err) => setStatus(String(err)));

    invoke<string>("get_config_dir")
      .then((dir) => setConfigDir(dir))
      .catch((err) => setStatus(String(err)));
  }, []);

  useLayoutEffect(() => {
    const launcher = launcherRef.current;
    if (!launcher) return;

    const windowHandle = getCurrentWindow();
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
      await invoke("quit");
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
      invoke("quit").catch(() => undefined);
    }
  };

  return (
    <main className="app">
      <section className="launcher" ref={launcherRef}>
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
      </section>
    </main>
  );
}

export default App;
