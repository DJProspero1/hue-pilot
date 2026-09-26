# Hue Pilot — Android

Native Android client for Philips Hue (CLIP v2) with an AI assistant that can use Google Gemini, OpenAI,
Anthropic, DeepSeek or OpenRouter. Kotlin, Jetpack Compose, Material 3, light/dark themes.
`minSdk 26`, `targetSdk 36`.

Package: `pt.prospero.huepilot`. Single activity + Compose Navigation, OkHttp (HTTP + SSE),
kotlinx.serialization, DataStore preferences, ViewModels with StateFlow, coroutines, Glance widgets.

## Design

The app has its own design language ("Hue Pilot", in `ui/theme/Theme.kt`) instead of stock Material:

- A warm near-black dark theme and a warm off-white light theme with a single amber accent (`HuePalette`).
  Material You wallpaper colours are opt-in (*Settings → Appearance → Wallpaper colours*).
- **Ambient surfaces**: every room, light and camera card takes on the colour of what it represents
  (`AmbientCard` / `ambientBrush`, animated). Off rooms stay neutral, a room lit in blue is tinted blue,
  a camera that sees motion turns red.
- **Colour-filled brightness pills** (`FillSlider`): the bar fills with the light's own colour; drag or tap,
  the light follows the finger (throttled) and the final value is sent on release.
- **Scene artwork** (`SceneArt`): each scene's palette rendered as a gradient tile with the name overlaid;
  the active scene shows a check.
- Manrope (variable font, bundled in `res/font`) for all text; 24 dp cards, pill tabs (`PillTabs`),
  glowing icons (`GlowIcon`), status pills, big screen headers with a greeting on Home.

## Build

Requirements: JDK 17 and an Android SDK with platform 36 / build-tools 36. No Android Studio needed.

```bash
# Windows (Git Bash)
export JAVA_HOME="/c/Program Files/Microsoft/jdk-17.0.20.101-hotspot"
cd apps/android
./gradlew assembleDebug            # app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease          # signed + R8-minified: app/build/outputs/apk/release/app-release.apk
./gradlew testDebugUnitTest        # unit tests (+ mock-bridge integration tests when the mock is running)
./gradlew lintDebug
```

`local.properties` must point at the SDK (`sdk.dir=...`). The release build is signed with
`keystore/hue-pilot.jks` (alias/passwords in `keystore.properties`; personal project, kept in the repo).

Notes for this machine: `gradle.properties` sets `android.overridePathCheck=true` (the checkout path contains
non-ASCII characters) and `org.gradle.vfs.watch=false` (file-system watching missed changes under that path).
A release-signed install must be uninstalled before a debug build can be installed over it.

## Install

```bash
adb install -r app/build/outputs/apk/release/app-release.apk
# or the copy at ../../release/HuePilot-android.apk
```

First launch shows the onboarding screen: bridges are discovered via `discovery.meethue.com` and mDNS
(`_hue._tcp.`); you can also type an IP. *Advanced* lets you choose `http`/`https` and a custom port (useful for
the mock bridge: from an emulator use `10.0.2.2`, http, port `8080`). Press *Connect*, then the link button on the
bridge; the app polls `POST /api` every 1.5 s for 60 s. Credentials are stored in DataStore
(*Settings → Forget bridge* removes them).

### Debug launch extras and deep links

Debug builds accept a pre-paired bridge so emulator runs skip onboarding:

```bash
adb shell am start -n pt.prospero.huepilot/.MainActivity \
  --es hue_host 10.0.2.2 --ei hue_port 8080 --ez hue_https false --es hue_key mock --es hue_name "Mock"
```

Every build accepts `--es open <route>` (`home`, `lights`, `scenes`, `accessories`/`cameras`, `assistant`,
`settings`, `room/<id>`, `light/<id>`) and `--ez listen true` (start voice input on the Assistant tab), and the same
through `huepilot://<route>?listen=1` VIEW intents. Widgets and shortcuts use these.

## Features

- **Home**: greeting header with the live-connection dot, an *All lights* ambient card (colour dots of everything
  that is on), a security strip (cameras + motion sensors: "All clear" or "Motion at …", tap → Sensors), rooms and
  zones as ambient cards (archetype icon, on/off switch, "3 of 3 on · 67%", brightness pill while on). Live updates
  through the bridge event stream (`/eventstream/clip/v2`, auto-reconnect with backoff); pull-to-refresh.
- **Room / zone**: hero card with state, big brightness pill and an edge-to-edge quick-colour strip; scene tiles
  (tap = activate, long-press = play dynamic / rename / delete); *Save current* creates a scene from the lights'
  current state; the room's lights as ambient rows with their own brightness pills.
- **Light detail**: hero card, pill tabs for **Colour** (hue/saturation wheel on a Canvas, clipped to the light's
  gamut, plus swatches), **White** (colour-temperature pill with a ring handle over a black-body gradient, Kelvin
  labels, presets) and **Effects** (tile grid with icons; candle, fire, prism, sparkle, … via `effects_v2` when
  available, plus *Stop effect*), identify (blink), rename, and an *About this light* card.
- **Lights**: search pill, lights grouped by room with sticky headers and per-room *All on/off*.
- **Scenes**: scene artwork grid with room filter pills.
- **Sensors**: **Cameras** (Hue Secure battery and floodlight cameras: motion state, last motion, ambient light,
  battery, connectivity, a *Motion detection* switch that writes `camera_motion.enabled`, and the paired
  floodlight's on/off + brightness inline; a note explains that live video is only available in the Philips Hue app
  with an *Open the Hue app* button), motion sensors (motion, temperature, lux, battery, enable toggle), switches
  and dimmers (last button event + time), and the bridge itself.
- **Assistant**: chat with the selected AI provider (see below), microphone input (`SpeechRecognizer`), *Speak
  replies* (`TextToSpeech`), suggestion cards, inline tool-call cards, provider switcher in the header.
- **Settings**: bridge card with connection status and details, assistant providers as selectable rows that expand
  into key/model editors (*Fetch* lists models), theme pill tabs, wallpaper colours, default transition time,
  widgets gallery, about.
- **Widgets**: see the Widgets section below.

Colour maths (sRGB ↔ CIE xy with gamut clipping, mirek ↔ Kelvin, black-body swatches) lives in
`domain/ColorMath.kt` and matches `packages/hue-core`.

### Cameras and the data model

`SnapshotBuilder` treats a device as a camera when its motion service is a `camera_motion` resource (or the product
name contains "camera" / the model id starts with `CMB`/`CMW`). `AccessoryUi.kind` is then `"camera"` and
`HomeSnapshot.cameras` / `motionSensors` / `switches` split the accessories. A floodlight camera (`CMW002`) is paired
with its floodlight, which the bridge exposes as a separate light device (archetype `hue_floodlight_camera`): 1:1
when there is one of each, otherwise by name similarity (`AccessoryUi.floodlightLightId`). The bridge exposes no
video for Hue Secure cameras; the app says so instead of pretending.

## How the assistant works

### Providers

| Provider | Default model | API | Get a key |
|---|---|---|---|
| Google Gemini | `gemini-2.5-flash` | `generateContent` REST (function calling) | https://aistudio.google.com/apikey |
| OpenAI | `gpt-5-mini` | Chat Completions `https://api.openai.com/v1` | https://platform.openai.com/api-keys |
| Anthropic Claude | `claude-opus-5` | Messages API `https://api.anthropic.com/v1/messages` | https://console.anthropic.com/settings/keys |
| DeepSeek | `deepseek-chat` | Chat Completions `https://api.deepseek.com/v1` | https://platform.deepseek.com/api_keys |
| OpenRouter | `google/gemini-2.5-flash` | Chat Completions `https://openrouter.ai/api/v1` | https://openrouter.ai/keys |

Each provider has its own API key and model (stored in DataStore as `provider_<id>_key` / `provider_<id>_model`;
the pre-multi-provider Gemini key/model are migrated into the gemini slot automatically). *Settings → Assistant →
Provider in use* selects the back-end; the Assistant header shows `<Provider> · <model>` and tapping it switches
provider on the spot. Changing the provider or model starts a new conversation, because the stored history
contains provider-specific payloads.

### Engine

`assistant/AssistantEngine.kt` keeps a provider-neutral history (`Turn.User`, `Turn.Assistant` with `text`,
`toolCalls[{id,name,args}]` and a provider-specific `raw` payload, `Turn.ToolResults[{id,name,result,isError}]`)
and runs the function-calling loop: ask the adapter → if the model requested tools, execute them locally against
the bridge with `assistant/HueTools.kt`, append the results and repeat → until a text answer or 8 tool rounds.
Every executed tool shows up in the chat as a small card ("Office turned on at 60%").

Adapters (`assistant/*Adapter.kt`) convert the neutral history into each API's request and the response back:

- **Gemini**: `systemInstruction` + `contents`; assistant turns are echoed back as the exact `content` object
  returned by the API (so `thoughtSignature` parts survive); tool results go back as `functionResponse` parts
  with role `user`.
- **OpenAI-compatible** (OpenAI, DeepSeek, OpenRouter): `messages` with `system`/`user`/`assistant`
  (`content` or `null` + `tool_calls` whose `arguments` are JSON strings)/`tool` (`tool_call_id`, JSON-string
  content), `tools:[{type:"function",function:{…}}]`, `tool_choice:"auto"`, never `temperature`. OpenRouter also
  gets `HTTP-Referer: https://hue-pilot.local` and `X-Title: Hue Pilot`. `finish_reason: tool_calls` continues
  the loop; `{error:{message}}` replies are surfaced.
- **Anthropic**: `system`, `max_tokens: 16000`, `tools` with `input_schema`; assistant turns echo the response
  `content` array verbatim (including `thinking` blocks); all tool results of a round go back in ONE user
  message of `tool_result` blocks (`is_error` only for bridge/exception failures). `output_config.effort: low`
  is sent only for models matching `claude-(opus-(4-[5678]|5)|sonnet-(4-6|5)|fable|mythos)`. `stop_reason`
  `tool_use` continues, `max_tokens` appends a note, `refusal` shows "The model declined this request" (with
  `stop_details.explanation` when present); HTTP 401 is reported as an invalid key.

*Fetch models* lists: Gemini models supporting `generateContent`; OpenAI ids starting with `gpt-`/`o1`/`o3`/`o4`/
`chatgpt-` minus audio/realtime/tts/transcribe/embedding/image/search/instruct/moderation/codex variants; every
DeepSeek id; OpenRouter models whose `supported_parameters` include `tools` (capped at 300, sorted by id);
Anthropic `/v1/models` following `has_more`/`last_id` pagination.

The tools follow the suite-wide contract shared with the desktop app and the MCP server (12 tools):
`get_home_overview`, `set_room`, `set_light`, `set_all_lights`, `activate_scene`, `set_effect`,
`identify_light`, `get_sensor_readings` (now also lists cameras with motion / detection state / lux / battery),
`set_camera_motion_detection`, `list_schedules`, `create_schedule`, `delete_schedule`.
Targets are matched by name (exact > starts-with > contains > word overlap, ids accepted); ambiguity returns
`{ ok:false, error:"ambiguous", candidates:[…] }`, misses return `{ ok:false, error:"not_found", available:[…] }`.
Colours accept names, hex or white presets; schedules are created bridge-side through the v1 API
(`W<mask>/T<HH:MM:SS>` localtime, weekday bits Mon=64 … Sun=1).

Without a key for the selected provider the chat shows a setup banner linking to Settings. Cloud LLM traffic uses
a normal certificate-verifying client; only bridge traffic uses the trust-all client pinned to the bridge host name.

## Widgets

(See below — filled in with the widget suite.)

## Testing

Unit tests cover the colour maths, name matching, schedule `localtime` builder, JSON deep-merge/snapshot building,
camera detection and floodlight pairing with real Hue Bridge Pro resource shapes (`CameraSnapshotTest`), the
assistant loop (fake adapter), each provider adapter against a `MockWebServer` (request shape, echo-back of
assistant payloads, tool-result messages, errors, model-list filtering/pagination) and the settings migration.
`HueToolsMockBridgeTest` runs the whole tool contract against the mock bridge and is skipped automatically when it
is not reachable:

```bash
node ../../packages/hue-mock-bridge/src/server.mjs --port 8080   # in another terminal
./gradlew testDebugUnitTest
```

Screenshots taken on an Android 16 emulator are in `screenshots/`.
