# Hue Pilot

A Philips Hue suite built for AI control:

| Part | What it is | Where |
| --- | --- | --- |
| **Hue Pilot desktop** | Windows app (Electron) that controls the bridge over the local network, with a built-in AI assistant (Gemini, OpenAI, Anthropic, DeepSeek or OpenRouter), a system-tray menu, a local HTTP API and one-click setup of AI agents | `apps/desktop` → `release/HuePilot-Setup-1.2.0.exe`, `release/HuePilot-Portable-1.2.0.exe` |
| **Hue Pilot Android** | Native Android app (Kotlin, Jetpack Compose) with a custom "ambient" design (cards take on the colour of your lights), Hue Secure camera status, a home-screen widget suite and a voice-enabled assistant with the same five providers | `apps/android` → `release/HuePilot-android.apk` |
| **MCP server** | Exposes the Hue tools to Claude Desktop, Claude Code, Gemini CLI, Codex, Cursor, VS Code and any MCP client | `packages/hue-mcp` → `dist/hue-mcp.mjs` (bundled into the desktop installer) |
| **@hue/core** | Shared TypeScript library: CLIP v2 client, event stream, colour maths, view model, fuzzy name matching, schedules, agent tools | `packages/hue-core` |
| **Mock bridge** | A fake Hue bridge for development and tests | `packages/hue-mock-bridge` |

## Quick start (desktop)

1. Install `release/HuePilot-Setup-1.2.0.exe` (or run the portable exe).
2. The app finds the bridge on your network. Click **Connect** and press the round button on the bridge once.
3. Go to **Settings → Assistant**, pick a provider and paste its API key. Any of these work:

   | Provider | Default model | Get a key |
   | --- | --- | --- |
   | Google Gemini | `gemini-2.5-flash` | <https://aistudio.google.com/apikey> |
   | OpenAI | `gpt-5-mini` | <https://platform.openai.com/api-keys> |
   | Anthropic Claude | `claude-opus-5` | <https://console.anthropic.com/settings/keys> |
   | DeepSeek | `deepseek-chat` | <https://platform.deepseek.com/api_keys> |
   | OpenRouter | `google/gemini-2.5-flash` | <https://openrouter.ai/keys> |

   Every provider keeps its own key and model; **Fetch** lists the models your key can use. Switching provider (also possible from the Assistant page header) starts a fresh conversation.
4. Open **Assistant** and type or say: *"Please turn the lights in my office on."*

Everything the assistant can do is also available to external agents. Open **AI agents** and click **Install** for Claude Desktop, Claude Code, Gemini CLI, Codex, Cursor or VS Code. The MCP server reads the pairing from the app's config file (`%APPDATA%\hue-pilot\config.json`), so it works even when the app is closed.

## Features (desktop)

- Rooms, zones and the whole home: on/off, brightness, quick colours, live colour dots.
- Room view: group brightness, quick palette, scene carousel (static and dynamic), lights list.
- Light panel: colour wheel (gamut-aware), colour-temperature slider in Kelvin, effects (candle, fire, prism, sparkle, opal, glisten, …), identify, rename, device details.
- Scenes: activate, dynamic mode, save the current state of a room as a new scene, rename, delete.
- Automations: schedules stored on the bridge (daily, weekdays, custom days, or once) that run when the app is closed.
- Accessories: motion sensors (motion, temperature, lux, battery, enable/disable), dimmer switches, bridge info.
- Cameras: Hue Secure cameras (battery and floodlight models) with live motion state, ambient light, battery, connectivity and firmware, a motion-detection switch, inline control of the paired floodlight, and a "Recent motion" timeline of camera and sensor events collected while the app is open. See the note on video below.
- **Watch live on this PC**: the Cameras page can mirror your Android phone in a window and open the Philips Hue app on it (scrcpy, open source, downloaded on first use into the app's data folder), so the cameras' live view and clips appear on the desktop. Needs USB debugging on the phone (USB cable or Wireless debugging address); shows the connected phones, download progress and plain-language hints (accept the prompt on the phone, install the Hue app, …).
- Live updates through the bridge event stream; optimistic UI for sliders.
- System tray with quick toggles for favourite rooms; optional start with Windows; dark/light theme.
- Assistant: five providers, tool calling with 12 tools, tool calls shown inline, optional spoken replies and voice input.
- Local HTTP API (`http://127.0.0.1:8787`, bearer token in the AI agents page) for scripts and other agents.

## How the assistant talks to each provider

The chat keeps a provider-neutral history and re-encodes it per provider on every turn:

- **Gemini**: `generateContent` with function declarations; thought signatures are echoed back.
- **OpenAI, DeepSeek, OpenRouter**: Chat Completions with `tools`/`tool_choice: auto`; no `temperature` is sent (GPT-5 rejects it). OpenRouter gets the `HTTP-Referer`/`X-Title` headers and its model list is filtered to models that support tools.
- **Anthropic**: the official `@anthropic-ai/sdk` Messages API with `tools`/`input_schema`; assistant content blocks (including thinking) are echoed back unchanged, all tool results go back in one user message, and `output_config.effort: low` is set on models that support effort (light control is a simple task). Refusals are shown as a plain message.

## Agent tools

`get_home_overview`, `set_room`, `set_light`, `set_all_lights`, `activate_scene`, `set_effect`, `identify_light`, `get_sensor_readings`, `set_camera_motion_detection`, `list_schedules`, `create_schedule`, `delete_schedule`.

`get_sensor_readings` also lists Hue Secure cameras (motion, motion detection on/off, lux, battery, connectivity, last motion) and `set_camera_motion_detection` switches a camera's motion detection by name.

Names are matched fuzzily ("the office lights" → room *Office*). Colours accept names, hex and white presets (candlelight … daylight) or Kelvin. Ambiguous names return the candidates so the agent can ask.

Standalone MCP usage without the desktop app:

```
HUE_BRIDGE_HOST=192.168.1.74 HUE_APP_KEY=<key> node packages/hue-mcp/dist/hue-mcp.mjs
```

## Development

```
npm install                     # workspace install
npm test                        # core + assistant tests (mock bridge + fake provider endpoints)
npm run mock                    # mock bridge on http://localhost:8080
npm run dev                     # desktop app with hot reload
npm run build -w packages/hue-mcp
npm run dist                    # Windows installer + portable exe in release/
```

Useful environment variables for the desktop app: `HUE_PILOT_CONFIG_DIR` (alternate config folder, also isolates Electron data so a second instance can run next to the installed app), `HUE_PILOT_SCREENSHOT_DIR` + `HUE_PILOT_SCREENSHOT_ROUTES` (headless screenshots for verification), `HUE_PILOT_{GEMINI,OPENAI,ANTHROPIC,DEEPSEEK,OPENROUTER}_BASE` (fake endpoints for tests).

## Android

`release/HuePilot-android.apk` (signed release). The phone app has its own design language: a warm near-black
theme with an amber accent, "ambient" cards that take on the colour of the lights they represent, colour-filled
brightness pills, scene tiles drawn from each scene's palette, Manrope typography. It has the same features as the
desktop app (rooms, zones, lights, scenes, effects, sensors, the five-provider assistant with voice input), a
**Sensors** tab that shows the Hue Secure cameras (motion, last motion, ambient light, battery, motion-detection
switch, inline floodlight control, and a clear note that video is only available in the Philips Hue app), and a
suite of eight home-screen widgets (Rooms grid, Room control, Scenes, All lights, Light control, Ask Hue Pilot,
Sensors & security, Colour strip) that work while the app is closed, plus launcher shortcuts (voice assistant,
scenes, cameras). *Settings → Widgets* shows previews and adds them to the home screen. Details in
`apps/android/README.md`.

## Notes

- The bridge uses a private certificate authority; the apps talk to it over HTTPS without verifying the certificate (standard practice for local Hue clients).
- Schedules use the bridge's v1 API (`/api/<key>/schedules`), which the Hue Bridge Pro still supports. Sunrise/sunset automations are not included.
- Entertainment areas (light sync streaming) are out of scope.
- **Hue Secure cameras: no video through the bridge.** The local bridge API exposes motion detection, ambient light level, battery, connectivity and software version for the cameras, and the floodlight of a Secure floodlight camera as a normal light. The cameras themselves expose no local stream either (a full TCP port scan of both found nothing open). Live view and clips are end-to-end encrypted to Signify's cloud and play only in the Philips Hue app, on a Nest Hub (after linking Hue to Google Home) or an Echo Show / Fire TV (Alexa); Apple Home support was announced for early 2026 and then withdrawn. The desktop app therefore offers the phone mirror above rather than pretending to decode the stream.
