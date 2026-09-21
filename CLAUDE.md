# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm start        # node server.js — serves display at / and remote at /remote.html on PORT (default 3000)
npm run dev      # node --watch server.js — auto-restart on file change
```

For LAN access from phones bind to all interfaces: `HOST=0.0.0.0 PORT=3000 npm start`. There are no tests, linter, or build step — `public/` is served verbatim and is also the artifact uploaded to GitHub Pages by `.github/workflows/deploy-pages.yml`.

## Architecture

The project ships in **two deployment modes** that share the same `public/` frontend:

1. **Node server** (`server.js`) — Express + Socket.io. Holds the canonical `environmentState`, fetches live weather from `api.open-meteo.com` every 10 min when `simulationMode === 'live'`, geocodes location queries via Open-Meteo geocoding, and on Raspberry Pi can sleep/wake the display via `xset dpms` / `vcgencmd display_power`.
2. **Static GitHub Pages** — no server exists. `public/standalone.js` runs first and installs a `window.io()` shim that emulates Socket.io. It picks a transport based on what's available:
   - **Same-device tabs**: `BroadcastChannel('nature-canopy-vibes')`.
   - **Cross-device, Supabase room** (default): WebSocket directly to Supabase Realtime (no SDK; raw Phoenix channel protocol implemented inline). Creds in `public/config.js`.
   - **Cross-device, WebRTC room**: PeerJS for legacy/QR-pairing rooms.
   - When the room is fixed by `?room=foo`, it's persisted in `localStorage` so the printed QR keeps working across reloads.

   The standalone shim **must load before `/socket.io/socket.io.js`** in `index.html` — on the real server, the real socket.io client overwrites `window.io` and the shim becomes a no-op. There's an additional inline fallback at the bottom of `index.html` that installs a fully offline mock `io()` if both the shim and the real client failed.

### State flow (single source of truth pattern)

```
remote.html  ──remote:command──►  server  ──env:sync──►  all clients (display + remote)
controls.js  ──env:update────►   server
                                   │
                                   └─ simulationTick() pulls live weather, mutates state, broadcasts
```

The server **never trusts client state**: every `remote:command` is normalized (`applyRemoteEnvPatch`, `normalizeSeason`, `normalizeAzimuthOffsetDeg`, `clampRange`, etc.), applied to `environmentState`, then rebroadcast as a fresh `env:sync`. Any mutation that came from a manual control (time/wind/cloud/weather) forces `simulationMode = 'manual'` so the next `simulationTick` doesn't overwrite it.

The frontend mirrors this: `sketch.js` defines `EnvironmentManager` (alias `env`) and on every `env:sync` diffs the previous values against the new ones to decide which subsystems to invalidate:

- `treeFrameDensity` change → `_ncvUpdateTreeCount()`
- `branchDepth` / `forceTreeType` / `forceTreeless` / location change → `_ncvRebuildCanopy()`
- constellation flags / label flags / `skyAzimuthOffsetDeg` / location change → `_ncvInvalidateSkyCache()`
- Location change → `_ncvBeginLocationTransition()` (after first sync only)

These `_ncv*` globals are the **inter-module API**. Subsystems attach their entry points to `window` rather than importing each other; `sketch.js` is the only orchestrator.

### Frontend subsystems (load order matters; see `index.html`)

0. `solar.js` — `window.NCV_SKY`: sun altitude/azimuth from latitude, local solar hour and day of year (`phase()`, cached per frame), low-precision moon RA/Dec + phase (`moonEquatorial`), and J2000→epoch-of-date precession (`precess`). **Nothing keys on clock hours any more**: night/twilight/day, sky colour, star alpha, aurora, bird/bat/cricket schedules, flocks and canopy lighting all read `NCV_SKY.phase()` (night < −9°, twilight −9…+3°, day ≥ +3°; `starK`, `sunK`, `daylight`, `twilightK`, `glowK` are smooth ramps). That is what makes polar night, midnight sun and December afternoons correct. Server mirrors the sun formula in `sunAltitudeDeg` for `liveIsDay`.
1. `stars.js` — celestial sphere, constellations, Milky Way. Catalog is J2000; `_project` precesses to `_renderJD` (set per render) so ancient dates show the right pole star. The sun and moon are placed on the same dome in `atmosphere.js` (`_sunScreenPosition`, `_moonFromTimeAndDate`) from real RA/Dec; the moon phase comes from moon–sun elongation on the scene date.
2. `murmuration.js` — starling flocks + migrating geese flyovers.
3. `canopy.js` — procedural tree/branch generation. Tree archetypes: deciduous, conifer (pine-style central trunk with whorls), birch, dead, palm (dedicated structure: trunk + crown fronds behind trunk, wind-coupled frond motion). Tree mix is **location-aware** via `estimateLocationWoodedness(lat, lon, name)` in `server.js`.
4. `creatures.js` — birds/bats.
5. `atmosphere.js` — clouds, rain, lightning, audio. `AtmosphereAudio` is fully synthesised: sources → `bus` → dry + convolver (generated impulse) → `master`. Point sounds are panned (`_panner`). Thunder synth (`_playThunderSynth`) layers crack, stereo-wandering peals, a sub-bass sine to `master` (bypasses reverb) and a tail; `distance` darkens and delays it. Recordings in `audio/thunder/` override it. Crickets follow `env.liveTemperatureC` (Dolbear). The display emits `lightning_strike {intensity, distance}` to the server for physical effects (server handler is a logging stub). Audio is the only thing that gets force-muted when `env.sleeping` flips on. Browsers need a click/keypress (or `--autoplay-policy=no-user-gesture-required`) before any sound.
6. `controls.js` — hidden-by-default on-screen panel; injects its own DOM/CSS; toggled by `C` key.
7. `sketch.js` — `setup()` builds subsystems, draw loop runs them in order, socket listeners route updates.

Plus `remote.html` + `remote.js` — phone UI, simple mode (location buttons + sky-labels toggle). Tapping the title 5× quickly unlocks the advanced row (env sliders, live location search, season select, audio sliders, "Copy URL With Selected Settings"). This is **session-only**, not persisted.

### Journey mode (time travel)

`server.js` owns a second clock, `journeyEpochMs` (true UTC ms), advanced every `JOURNEY_TICK_MS` by `journeyRate` simulated seconds per real second (negative rewinds, 0 pauses). While `journeyActive`, `simulationMode === 'journey'` and `simulationTick` returns early; `journeyTick` derives `timeOfDay` / `liveDateISO` as *local solar time* (longitude × 4 min) and broadcasts `env:sync` at 1 Hz. The client extrapolates the clock every frame in `draw()` and only accepts the server stamp when it disagrees by more than a sync interval, so the sky never stutters. `stars.js` uses `journeyEpochMs` directly for sidereal time and re-renders its cache whenever LST moves > 0.25°.

Weather while journeying (`journeyApplyWeather`): `hold` (manual edit from the remote) → Open-Meteo `archive` (1940 → about a week ago) / `forecast` (±90/16 days), hourly, cached per day in `journeyWeatherCache` → deterministic `model` seeded by place and hour. Hourly APIs are skipped above `JOURNEY_API_MAX_RATE` (2 h/s).

Commands: `journey_start|stop|toggle|now`, `journey_set_rate {rate|preset}`, `journey_scrub {sec}`, `journey_set_epoch {epoch: ISO|ms|{year,month,day,hour}, label}`, `journey_goto {id}`, `journey_weather_auto`. Same operations exist as `GET /journey/*` for microcontrollers. `set_env_values` with `timeOfDay` while journeying scrubs the clock instead of forcing manual mode; wind/cloud/weather edits set `journeyWeatherHold`. Destinations live in `JOURNEY_DESTINATIONS` (`wooded` overrides the tree mix, `sceneAudio` picks a bed, `weather` holds a fixed sky). Years ≤ 0 use expanded ISO (`-002499` = 2500 BC).

Room fields: `brightness` (final black rect in `drawBrightnessDimmer`), `overlayRotationDeg` + `overlayDual` (all on-ceiling text goes through `withOverlayOrientation`, placed on the inscribed circle so it survives any rotation/aspect), `showClock`, `showMap` (`off|auto|always`; the globe in `journeyMap` uses `vendor/world-land.js` and tweens the centre along a great circle on location change), `sceneAudio` (`fire`/`drone` synth beds or `audio/scenes/<name>.*` loops, crossfaded in `AtmosphereAudio._updateScene`).

Note: the `env:sync` diff treats a location change (lat/lon) and a date change separately — only the former fades to black and rebuilds the canopy; the latter just invalidates the sky cache.

### URL parameters

Read by `sketch.js`'s `parseStartupEnvOverrides()` and applied via a single `set_env_values` command after first connect (which also forces `simulationMode = 'manual'` if any env override was present):

- `qr=1`, `qrTimeoutMs`, `qrPersist` — QR overlay behavior on boot.
- `room=<id>` — fixed shared room ID (3-64 chars, `[A-Za-z0-9_-]`) so a printed QR survives browser restarts. Display and `/remote.html` must use the same room.
- `skyAzOffset=<deg>` — physical compass calibration; aliases `compassOffset`, `azOffset`.
- Env overrides: `tod`, `wind`, `cloud`, `star`, `weather`, `season`, `trees`, `skyOpen`, `foliage`, `branchLen`, `edgeLush`, `branchChaos`, `sndMaster`, `sndRain`, `sndWind`, `sndThunder`, `sndBirds`, `sndCrickets`, `sndNightBirds`.
- Room: `bright` (0.05–1), `clock`, `map` (`off|auto|always`), `rot` (0–359), `dual`.

Keyboard on the display (`keyPressed` in `sketch.js`) doubles as the in-room scrubber: arrows scrub/step rate, Space play/pause, `N` now, `T` clock, `M` map, `+`/`-` brightness, `R` randomise. Any USB knob that emits arrow keys works.

### Special test locations

`Conifer Test Forest` and `Palm Test Grove` set `forceTreeType` ('conifer' / 'palm') so tree-structure changes can be validated without location-mix noise. `North Pole Station` (and any `abs(lat) >= 72`) forces `forceTreeless`.

### Hardware-specific code

`setDisplayPower(on)` in `server.js` probes for `wlr-randr` (Wayland — default on Pi OS Bookworm+), then `xset` (X11), then `vcgencmd` (legacy Pi firmware) on the first call and caches the result. It runs commands with a synthesised desktop-session env (`WAYLAND_DISPLAY`/`DISPLAY`/`XDG_RUNTIME_DIR`) so it works from a systemd unit. Silently no-ops if none are available. The `/trigger_motion?duration=` HTTP endpoint is for an external PIR sensor: it wakes the display, broadcasts `toggle_sleep`, and schedules a sleep-on-timeout.

Browser dependencies (p5.js, PeerJS, qrcode) are vendored under `public/vendor/` — kiosk installs can't rely on flaky WiFi to reach a CDN. If you bump a version, replace the file in `vendor/`; there's no build step.

### Frame-rate independent timing

`setup()` calls `frameRate(30)` to cap the draw loop on Pi. To keep motion speed wall-clock-consistent at any frame rate, `draw()` exports two globals at the top of every frame:

- `window._ncvAnimT` — monotonic pseudo-frame counter. Use as the phase argument for `sin()` / `noise()` **instead of p5's `frameCount`**.
- `window._ncvAnimDt` — this frame's elapsed time in 60-fps-frame units (~1 at 60fps, ~2 at 30fps, clamped to 4 max). Multiply every per-frame delta by this: position adds (`pos += vel * dt`), countdown timers (`timer -= dt`), phase accumulators (`flapPhase += rate * dt`), and damping (`vel *= Math.pow(0.985, dt)` not `vel *= 0.985`).

When adding new animation, never use `frameCount` directly and never `--` a frame timer by 1 — both will desync from wall-clock time when the cap changes. Timer-reset constants that read `* 60` are still correct: they mean "duration in 60-fps-frames" which `_ncvAnimDt` interprets consistently.

## Gotchas

- **Live weather can fight manual edits.** Any manual override should set `simulationMode = 'manual'` — the server-side helper already does this for known fields, but if you add a new env field, plumb it through `applyRemoteEnvPatch` with the right `manual` flag or your edit will be erased on the next live tick.
- **`socket.io` is not guaranteed to exist.** Always go through `window.io()` (and ideally `window._ncvSocket`); never assume the connection is real — on GitHub Pages it isn't. Server-only features (geocoding, weather fetch, sleep) silently fall through to standalone defaults.
- **Cache invalidation is manual.** If you add a new visual state that affects the pre-rendered sky (`stars.js`) or canopy, hook into the diff block in `sketch.js`'s `env:sync` handler so it triggers `_ncvInvalidateSkyCache` / `_ncvRebuildCanopy`.
- **`env.apply` only copies keys already declared on `EnvironmentManager`.** A new server field is silently dropped on the client until you add it (with a default) to the manager in `sketch.js`.
- **`journeyEpochMs` is extrapolated client-side.** If you add a new server-driven time field, either derive it from the epoch in `draw()` or expect it to lag a second behind.
- **`config.js` is committed with live Supabase creds** (anon/publishable key only). Cross-device remote control on GitHub Pages depends on those creds resolving.
