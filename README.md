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

## Build

```sh
pnpm tauri:build
```

## Install from a GitHub release

```sh
tar -xzf binpick-0.0.1-linux-x86_64.tar.gz
cd binpick-0.0.1-linux-x86_64
bash scripts/release-install.sh
```

Verify release downloads with:

```sh
sha256sum -c SHA256SUMS
```

## GitHub releases

Installable builds are published by the `Release` GitHub Actions workflow.
To create a release, push a version tag:

```sh
git tag v0.0.1
git push origin v0.0.1
```

You can also run the workflow manually from GitHub Actions and provide the
release tag.
