# Hue Pilot — Android

Native Android client for Philips Hue (CLIP v2) with a Gemini-powered assistant. Kotlin, Jetpack Compose,
Material 3 with dynamic colour (Material You), light/dark themes. `minSdk 26`, `targetSdk 36`.

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
- **Assistant**: chat with Google Gemini (see below), microphone input (`SpeechRecognizer`), *Speak replies*
  (`TextToSpeech`), suggestion chips, inline tool-call cards.
- **Settings**: bridge info / forget, Gemini key + model (with *Fetch models*), theme, default transition time.
- **Widget**: a Glance home-screen widget with on/off tiles for up to four favourite rooms (star a room in its
  screen). Compiles and is registered; it was not visually verified on the emulator.

Colour maths (sRGB ↔ CIE xy with gamut clipping, mirek ↔ Kelvin, black-body swatches) lives in
`domain/ColorMath.kt` and matches `packages/hue-core`.

## How the assistant works

`assistant/GeminiClient.kt` calls `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=…`
directly (no Firebase) with a `systemInstruction` describing the home (rooms, lights, scenes, sensors, current
state) and `tools: [{ functionDeclarations }]`. `assistant/AssistantEngine.kt` runs the function-calling loop:
the model's `functionCall` parts are executed locally against the bridge by `assistant/HueTools.kt`, the results
are sent back as `functionResponse` parts (role `user`), and the loop repeats until the model answers with text
(max 8 iterations). Each executed tool is shown in the chat as a small card ("Office turned on at 60%").

The tools follow the suite-wide contract shared with the desktop app and the MCP server:
`get_home_overview`, `set_room`, `set_light`, `set_all_lights`, `activate_scene`, `set_effect`,
`identify_light`, `get_sensor_readings`, `list_schedules`, `create_schedule`, `delete_schedule`.
Targets are matched by name (exact > starts-with > contains > word overlap, ids accepted); ambiguity returns
`{ ok:false, error:"ambiguous", candidates:[…] }`, misses return `{ ok:false, error:"not_found", available:[…] }`.
Colours accept names, hex or white presets; schedules are created bridge-side through the v1 API
(`W<mask>/T<HH:MM:SS>` localtime, weekday bits Mon=64 … Sun=1).

Enter the API key and model in *Settings* (default `gemini-2.5-flash`). Without a key the chat shows a setup
message linking to Settings. Gemini traffic uses a normal certificate-verifying client; only bridge traffic uses
the trust-all client pinned to the bridge host name.

## Testing

Unit tests cover the colour maths, name matching, schedule `localtime` builder, JSON deep-merge/snapshot building
and the assistant loop. `HueToolsMockBridgeTest` runs the whole tool contract against the mock bridge and is
skipped automatically when it is not reachable:

```bash
node ../../packages/hue-mock-bridge/src/server.mjs --port 8080   # in another terminal
./gradlew testDebugUnitTest
```

Screenshots taken on an Android 16 emulator are in `screenshots/`.
