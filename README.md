# WakaTime for Pi

Track your Pi usage, lines of code generated, time spent prompting the agent, and file activity with WakaTime.

[WakaTime](https://wakatime.com/) is an open source plugin ecosystem for metrics, insights, and automatic time tracking generated from your programming activity.

This project is intentionally modeled after [wakatime/claude-code-wakatime](https://github.com/wakatime/claude-code-wakatime), adapted for Pi's extension event model.

## Installation

```bash
pi install npm:pi-wakatime
```

Then add your [WakaTime API key](https://wakatime.com/settings/api-key) to `~/.wakatime.cfg`:

```ini
[settings]
api_key = your_wakatime_api_key
```

## How It Works

Because Pi uses extension lifecycle events instead of Claude hook scripts, this plugin maps Pi events onto the same heartbeat concepts where possible:

- `turn_start` → prompt / AI activity heartbeat
- `tool_call` → pre-tool activity heartbeat
- `tool_result` → post-tool activity heartbeat
- `session_before_compact` → pre-compact activity heartbeat
- `session_shutdown` → session end heartbeat
- `read` / `write` / `edit` tool results → file heartbeats

The plugin also:

- finds a global `wakatime-cli` when available
- installs a local `wakatime-cli` into `$WAKATIME_HOME/.wakatime/` when `WAKATIME_HOME` is set, otherwise `~/.wakatime/`
- checks for updates to the local CLI periodically
- respects WakaTime `proxy` and `no_ssl_verify` settings
- stores throttle state in `$WAKATIME_HOME/.wakatime/pi-wakatime-state/` when `WAKATIME_HOME` is set, otherwise `~/.wakatime/pi-wakatime-state/`
- writes extension logs to `$WAKATIME_HOME/.wakatime/pi-wakatime.log` when `WAKATIME_HOME` is set, otherwise `~/.wakatime/pi-wakatime.log`

## Usage

Open Pi as usual and work normally. Once your API key is configured, heartbeats are sent in the background.

You should see activity on your [WakaTime dashboard](https://wakatime.com/) for:

- your current project folder
- `.pi-session` synthetic session activity
- individual files read or modified by Pi
- AI-assisted line changes for `write` and `edit`

## Development

Run the test suite:

```bash
npm test
```

## Troubleshooting

Check that Pi can load the extension:

```bash
pi -e ./src/index.ts
```

Enable debug logging in `~/.wakatime.cfg`:

```ini
[settings]
debug = true
```

Then inspect logs:

```bash
tail -f ~/.wakatime/pi-wakatime.log
# or, when WAKATIME_HOME is set:
tail -f "$WAKATIME_HOME/.wakatime/pi-wakatime.log"
```

If no activity appears in WakaTime:

1. verify `~/.wakatime.cfg` contains a valid `api_key` (or `$WAKATIME_HOME/.wakatime.cfg` when `WAKATIME_HOME` is set)
2. inspect `~/.wakatime/pi-wakatime.log` (or `$WAKATIME_HOME/.wakatime/pi-wakatime.log`)
3. check whether `~/.wakatime/wakatime-cli` exists (or `$WAKATIME_HOME/.wakatime/wakatime-cli`)
4. confirm Pi is actually loading the extension

If `wakatime-cli` download fails:

- verify network access to GitHub releases
- verify proxy settings in `~/.wakatime.cfg` (or `$WAKATIME_HOME/.wakatime.cfg`)
- install `wakatime-cli` globally as a fallback

## Credits

- Inspired by [wakatime/claude-code-wakatime](https://github.com/wakatime/claude-code-wakatime)
- Built for [Pi Coding Agent](https://github.com/earendil-works/pi-mono)
