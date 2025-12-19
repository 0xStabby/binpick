# binpick

binpick is a lightweight, Tauri + React launcher meant as a dmenu alternative.
It lists executables from your `PATH`, lets you filter quickly, and launches
the selected command.

## Features

- Pulls command list from `PATH`
- Optional icons from `.desktop` files
- Keyboard-driven UI (arrow keys + enter + esc)
- Config stored in XDG config home

## Config

The config file lives at:

- `$XDG_CONFIG_HOME/binpick/config.json`
- or `$HOME/.config/binpick/config.json` if `XDG_CONFIG_HOME` is not set

You can add custom entries like:

```json
{
  "items": [
    { "label": "My Script", "command": "/home/me/bin/my-script" }
  ]
}
```

Icons can be added per entry with an `icon` path.

## Development

```sh
pnpm install
pnpm tauri:dev
```

## Build + install

```sh
pnpm tauri:build
```

Install the built binary into `~/.local/bin`:

```sh
pnpm install:local
```
