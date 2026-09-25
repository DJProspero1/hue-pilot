# Hue Pilot — Android

Native Android client for Philips Hue (CLIP v2) with an AI assistant that can use Google Gemini, OpenAI,
Anthropic, DeepSeek or OpenRouter. Kotlin, Jetpack Compose, Material 3 with dynamic colour (Material You),
light/dark themes. `minSdk 26`, `targetSdk 36`.

Package: `pt.prospero.huepilot`. Single activity + Compose Navigation, OkHttp (HTTP + SSE),
kotlinx.serialization, DataStore preferences, ViewModels with StateFlow, coroutines.

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

## Features

- **Home**: rooms and zones as cards (archetype icon, lights on/total, on/off switch, brightness slider, colour
  dots of the lit lights) plus an *All lights* master switch (bridge_home grouped light). Live updates through the
  bridge event stream (`/eventstream/clip/v2`, auto-reconnect with backoff); pull-to-refresh reloads everything.
- **Room / zone**: big on/off + brightness, scene carousel with palette previews (active scene highlighted;
  tap = activate, long-press = start dynamic / rename / delete), *Save current* creates a scene from the lights'
  current state, quick colours for the whole group (grouped_light colour with per-light fallback), list of lights.
- **Light detail**: on/off, brightness, tabs for **Colour** (hue/saturation wheel on a Canvas, output clipped to
  the light's gamut), **White** (colour-temperature slider over a black-body gradient, Kelvin labels, presets) and
  **Effects** (candle, fire, prism, … using `effects_v2` when available), quick palette, identify (breathe),
  rename, and product/model/software/connectivity info. Only the controls the light supports are shown.
- **Lights**: flat list grouped by room with search. **Scenes**: all scenes by room/zone with activate/dynamic.
- **Accessories**: motion sensors (motion, temperature, lux, battery, enable toggle), switches/dimmers (last
  button event + time) and the bridge itself.
- **Assistant**: chat with the selected AI provider (see below), microphone input (`SpeechRecognizer`),
  *Speak replies* (`TextToSpeech`), suggestion chips, inline tool-call cards, quick provider switcher in the header.
- **Settings**: bridge info / forget, assistant provider selector + one card per provider (masked key, model,
  *Fetch models*, *Get a key* link), theme, default transition time.
- **Widget**: a Glance home-screen widget with on/off tiles for up to four favourite rooms (star a room in its
  screen). Compiles and is registered; it was not visually verified on the emulator.

Colour maths (sRGB ↔ CIE xy with gamut clipping, mirek ↔ Kelvin, black-body swatches) lives in
`domain/ColorMath.kt` and matches `packages/hue-core`.

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
Provider in use* selects the back-end; the Assistant header shows `<Provider> · <model>` and its arrows icon
switches provider on the spot. Changing the provider or model starts a new conversation, because the stored
history contains provider-specific payloads.

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

The tools follow the suite-wide contract shared with the desktop app and the MCP server:
`get_home_overview`, `set_room`, `set_light`, `set_all_lights`, `activate_scene`, `set_effect`,
`identify_light`, `get_sensor_readings`, `list_schedules`, `create_schedule`, `delete_schedule`.
Targets are matched by name (exact > starts-with > contains > word overlap, ids accepted); ambiguity returns
`{ ok:false, error:"ambiguous", candidates:[…] }`, misses return `{ ok:false, error:"not_found", available:[…] }`.
Colours accept names, hex or white presets; schedules are created bridge-side through the v1 API
(`W<mask>/T<HH:MM:SS>` localtime, weekday bits Mon=64 … Sun=1).

Without a key for the selected provider the chat shows a setup banner linking to Settings. Cloud LLM traffic uses
a normal certificate-verifying client; only bridge traffic uses the trust-all client pinned to the bridge host name.

## Testing

Unit tests cover the colour maths, name matching, schedule `localtime` builder, JSON deep-merge/snapshot building,
the assistant loop (fake adapter), each provider adapter against a `MockWebServer` (request shape, echo-back of
assistant payloads, tool-result messages, errors, model-list filtering/pagination) and the settings migration.
`HueToolsMockBridgeTest` runs the whole tool contract against the mock bridge and is skipped automatically when it
is not reachable:

```bash
node ../../packages/hue-mock-bridge/src/server.mjs --port 8080   # in another terminal
./gradlew testDebugUnitTest
```

Screenshots taken on an Android 16 emulator are in `screenshots/`.
