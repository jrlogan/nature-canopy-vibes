# Nature Canopy Vibes

Procedural ceiling-projection scene with location-aware sky, weather, seasons, and tree ecology.

🌟 **[Try the Live Web Demo here!](https://jrlogan.github.io/nature-canopy-vibes/)** 🌟
🌟 **[Kiosk Start (auto-show QR on boot)](https://jrlogan.github.io/nature-canopy-vibes/?qr=1)** 🌟

*Note: The web demo runs fully in your browser! Once you open the demo, press `L` on your keyboard to open the location control remote in a new tab, or press `Q` to show a QR code you can scan with your phone to control the scene remotely!*
For keyboard-less installs, use the kiosk link above with `?qr=1` so the QR screen appears automatically at startup.
You can also add `&qrTimeoutMs=60000` (1 minute) or `&qrPersist=1` (no auto-timeout).
To keep one printed QR code stable across browser restarts, add a fixed room ID:
`?qr=1&room=my-install-01`
Use only letters, numbers, `_`, and `-` (3-64 chars).
For a matching phone remote URL, use:
`/remote.html?room=my-install-01`

## Recommended Usage

### Showing a friend on a phone

Phones automatically show a small demo toolbar: **Another place**, **Controls**,
and **Share scene**. Sharing captures location and visual settings as a manual
preview; it does not join the original display's controller room or reproduce
the exact randomly generated trees. Use `?demo=1` to show the toolbar on desktop,
or `?demo=0` to hide it for an installation.

Scene changes crossfade over about two seconds (shortened with the system's
reduced-motion preference). Regional tree mixes and seasonal colour are visual
approximations, not live foliage observations. Portrait displays scale branches
and leaf clusters to screen width to preserve an opening onto the sky.

The remote reports a connection only after it receives display state. With
Supabase unconfigured, cross-device QR control uses PeerJS/WebRTC and depends on
network connectivity; keep the display open and scan its current QR code.

This project is designed as an ambient **ceiling projection** experience:

- Main display runs on a small computer (Raspberry Pi or mini PC) connected to a projector.
- The projector points upward at the ceiling.
- People in the room use phones to change location from a simple remote panel.

### Typical setup flow

1. Boot the projector computer directly into the full-screen display scene.
2. Keep on-screen control panel hidden for public use (default behavior).
3. Share a QR code linking to the phone remote panel.
4. Guests switch locations; scene updates weather/time/season/tree mix for that location.

### Local network control model

- Display and phones must be on the same Wi-Fi/LAN.
- Projector computer hosts both pages:
  - Display page: `/`
  - Phone remote page: `/remote.html`
- Recommended launch host binding:
  - `HOST=0.0.0.0 PORT=3000`
- Remote URL format:
  - `http://<device-lan-ip>:3000/remote.html`

### Signage recommendation

Post a small sign near the installation with:

- Wi-Fi SSID and password
- QR code to `http://<device-lan-ip>:3000/remote.html`
- Short instruction: `Scan to change location`

For a stable printed QR that survives browser restarts, include the same fixed room on both pages:

- Display: `http://<device-lan-ip>:3000/?qr=1&room=my-install-01`
- Phone: `http://<device-lan-ip>:3000/remote.html?room=my-install-01`

## Run

```bash
npm install
npm start
```

Open:

- Main display: `http://localhost:3000/`
- Phone remote: `http://localhost:3000/remote.html`

## Raspberry Pi Boot To Display (Kiosk)

Use this if you want the Pi to auto-start the scene on boot and show it full-screen on the projector.

### 1) Auto-start the Node server with systemd

Create `/etc/systemd/system/nature-canopy.service`:

```ini
[Unit]
Description=Nature Canopy Vibes Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/nature-canopy-vibes
Environment=HOST=0.0.0.0
Environment=PORT=3000
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable nature-canopy.service
sudo systemctl start nature-canopy.service
```

### 2) Auto-open fullscreen Chromium on login

Browsers only start audio after a click or key press. A kiosk that boots with no
input never gets one, so pass `--autoplay-policy=no-user-gesture-required` (it is
in the launch line below). For a hand-started install, one click on the page is
enough.

Create `~/.config/autostart/nature-canopy-kiosk.desktop` for the desktop user:

```ini
[Desktop Entry]
Type=Application
Name=Nature Canopy Kiosk
Exec=sh -c "(command -v xset >/dev/null && xset s off && xset -dpms && xset s noblank); chromium --kiosk --incognito --noerrdialogs --disable-infobars --autoplay-policy=no-user-gesture-required --use-gl=egl --ignore-gpu-blocklist --enable-gpu-rasterization --enable-zero-copy --disable-features=UseChromeOSDirectVideoDecoder http://localhost:3000/"
X-GNOME-Autostart-enabled=true
```

GPU flags worth keeping (biggest single perf win on a Pi — Chromium otherwise tends to fall back to software compositing):

- `--use-gl=egl` — use EGL/GLES on the Pi GPU instead of software rasterizer (swiftshader).
- `--ignore-gpu-blocklist` — Chromium ships a blocklist that conservatively disables GPU on many ARM SoCs; override it.
- `--enable-gpu-rasterization` — rasterize canvas/CSS layers on the GPU.
- `--enable-zero-copy` — skip the CPU staging buffer for GPU texture uploads.

Verify after first boot: open `chrome://gpu` once and confirm "Canvas: Hardware accelerated" and "Compositing: Hardware accelerated". If they say Software, double-check the flags landed.

Notes for modern Raspberry Pi OS (Bookworm and later):

- The binary is `chromium`, not `chromium-browser`.
- The default session is Wayland; `xset` is X11-only and silently no-ops, which is fine (the `command -v` guard skips it). Screen blanking on Wayland is controlled by the compositor — under labwc/wlroots, install `wlr-randr` so the server can blank the display from motion events:

  ```bash
  sudo apt install wlr-randr
  ```

  The server probes for `wlr-randr` → `xset` → `vcgencmd` in that order on first sleep/wake.

### 3) Set desktop auto-login

In `raspi-config`:

- `System Options` -> `Boot / Auto Login` -> `Desktop Autologin`

### 4) Reboot test

```bash
sudo reboot
```

After reboot, the projector should open directly to the display scene.

### Optional: LAN control from phones

- Keep `HOST=0.0.0.0` in service env.
- Phones on same Wi-Fi can open:
  - `http://<pi-lan-ip>:3000/remote.html`
- Put that URL in a QR code on your sign.

## Important Defaults

- Control panel is hidden on startup.
- Debug HUD is off on startup.
- Keyboard (also the "scrubber in the room": any USB knob that emits arrow keys works):
  - `←` / `→` scrub the journey clock 10 min (hold `Shift` for 1 hour)
  - `↑` / `↓` step the journey speed (day/s ← hour/s ← min/s ← real ← pause → …)
  - `Space` play / pause the journey, `N` jump to now
  - `T` clock on the ceiling, `M` cycle the map (off / on location change / always)
  - `+` / `-` room brightness
  - `R` randomise time, wind and weather
  - `D` toggles debug HUD
  - `L` opens the location control remote
  - `C` toggles panel
  - `Q` toggles the QR overlay

## Journey Mode (Time Travel)

The scene can run its own clock instead of live weather. From the phone remote's
**Journey Through Time** panel (or the keys above, or the HTTP API below):

- **Speed**: real time, a minute per second, an hour per second (a day in 24 s),
  a day per second (a year in about six minutes), forwards or in reverse, or paused.
- **Go To A Date**: year / month / day / hour in local time at the current place.
  Negative years are BC. Type a birthday and watch that night's sky.
- **Real historical weather**: for dates from 1940 onward the server pulls that
  day's hourly weather from the Open-Meteo archive (or the forecast API for the
  last 90 days and next 16), so Woodstock really rains. Older dates and speeds
  above two hours per second use a deterministic weather model seeded by place
  and hour, so rewinding replays the same sky.
- **Destinations**: curated place-and-time stops (Stonehenge at the 2500 BC
  midsummer sunrise, an ice-age hearth, Giza, Kyoto in blossom, Woodstock,
  Serengeti tonight, Tromsø's polar night, Mauna Kea under the Milky Way…).
  Edit `JOURNEY_DESTINATIONS` in `server.js` to add your own.
- **Scene sound**: destinations can carry an ambient bed. `fire` (crackling
  hearth) and `drone` (distant chant) are synthesised; drop a loop at
  `public/audio/scenes/<name>.mp3` (or `.ogg`/`.wav`) and set `sceneAudio=<name>`
  to use a recording instead.
- **Clock and map on the ceiling**: the clock card shows solar time, date,
  place and speed. The globe appears for 15 s whenever the location changes
  and draws the great-circle hop from the previous place. Because a ceiling has
  no "up", set **Text faces** to the wall people's feet point at, and turn on
  **Mirror Text 180°** if people lie in two rows facing each other.
- **Brightness**: a global dimmer for dark rooms; on-ceiling text compensates
  so it stays readable.

The sky is astronomically honest: day, twilight and night come from the sun's
real altitude for the place and date (so Tromsø gets its blue polar noon and
McMurdo its midnight sun), the sun and moon sit where they really are with the
right phase, and star positions are precessed to the date, so at Stonehenge in
2500 BC the pole star is Thuban, not Polaris.

Journey mode needs the Node server (it owns the clock and fetches weather); the
static GitHub Pages build ignores journey commands.

### Journey HTTP API (for a knob, an ESP32, or a shell script)

```
GET /journey/destinations          list of stops
GET /journey/state                 current clock, rate, label
GET /journey/scrub?sec=600         nudge the clock (negative = back)
GET /journey/rate?preset=hour      realtime | minute | hour | day | pause, or ?value=<sec per sec>
GET /journey/toggle                play / pause
GET /journey/goto?id=stonehenge    jump to a destination
```

A rotary encoder on a Raspberry Pi Pico running a USB-HID keyboard sketch that
sends `←`/`→` on rotation and `Space` on press needs no server code at all.

### Room URL parameters

`bright=0.6`, `clock=1`, `map=auto|always|off`, `rot=90`, `dual=1` seed the room
controls at boot, e.g. `http://<host>:3000/?bright=0.7&clock=1&rot=90`.

## Remote (Simple Mode)

Remote intentionally has:

- City/location buttons
- One toggle: `Constellations & Labels`

Changing location also re-randomizes tree/canopy settings using location-aware woodedness.
When a location is selected from phone remote, the QR overlay on display auto-hides.

## Hidden Advanced Menu (Phone)

The phone remote includes an advanced row that is hidden by default.

How to open:

1. Open `/remote.html` on phone.
2. Tap the `Nature Canopy` title 5 times quickly.
3. Advanced controls appear for that session only.

Advanced controls:

- `Compass Overlay`: shows/hides directional compass markers on the display.
- `Lightning Flash`: triggers a manual lightning flash effect.
- `Live Location Search`: type any place and apply it directly from phone.
- Weather quick buttons: `Clear`, `Rain`, `Storm`.
- Environment sliders: time of day, wind speed, cloud cover, star brightness.
- Canopy sliders: tree count, sky opening, foliage density, branch length, edge lushness, branch chaos.
- `Season` select: auto/spring/summer/fall/winter.
- Audio sliders: master, rain, wind, thunder, birds, crickets, night birds.
- `Copy URL With Selected Settings`: choose exactly which settings to persist into the generated display URL.

Calibration URL parameters:

- `room`: fixed shared room ID for stable reconnection (`room=my-install-01`)
- `skyAzOffset`: initial sky azimuth calibration in degrees (`skyAzOffset=15`)
- Optional persisted display tuning params:
  - `tod`, `wind`, `weather`, `season`, `star`, `cloud`
  - `trees`, `skyOpen`, `foliage`, `branchLen`, `edgeLush`, `branchChaos`
  - `sndMaster`, `sndRain`, `sndWind`, `sndThunder`, `sndBirds`, `sndCrickets`, `sndNightBirds`

Example calibrated kiosk URL:

`https://jrlogan.github.io/nature-canopy-vibes/?qr=1&room=my-install-01&skyAzOffset=15`

Notes:

- Re-scanning the same fixed-room QR reconnects quickly if phone/browser backgrounding interrupts the session.
- Weather fetch requests were updated to avoid stale error states from unsupported query combos.

## Sound

All ambience is synthesised, stereo, through a generated outdoor reverb:
gusting wind, rain with individual drops, birds with per-individual song
patterns and a dawn chorus, owls, and crickets whose chirp rate follows the
temperature (Dolbear's law; they go quiet below about 10 °C). Thunder is layered
(crack, rolling peals that move across the stereo field, a 27–42 Hz sub layer
for a subwoofer or bass shaker, long tail) and gets darker and later with
distance. Drop real recordings in `public/audio/thunder/thunder-1..4.mp3` to
replace the synthesised thunder; they are picked up automatically.

## Special Test Locations

- `Conifer Test Forest` forces conifer trees.
- `Palm Test Grove` forces palm trees.

These are useful for validating tree-structure work without location-mix noise.

## Location/Season Notes

- `North Pole Station` is forced treeless.
- Auto-season uses location + date, with temperate spring leaf-out delayed (e.g., New Haven in early March stays near late-winter transition).
- Tree mix is location-aware (deciduous/conifer/birch/dead/palm), with cold zones leaning conifer and tropical zones supporting palms.

## Current Tree Modeling Notes

- Conifers are mostly pine style (dominant central trunk with radiating whorls).
- Palms use a dedicated structure/render path:
  - single trunk
  - crown fronds attached at top
  - fronds rendered behind trunk
  - wind-coupled independent frond motion

## Main Files

- Server/state/socket: `server.js`
- Main loop/environment sync: `public/sketch.js`
- Canopy/tree generation and rendering: `public/canopy.js`
- Stars/constellations: `public/stars.js`
- Atmosphere/weather visuals/sound: `public/atmosphere.js`
- Creature behavior (birds/bats): `public/creatures.js`
- Murmurations + migration geese: `public/murmuration.js`
- On-screen control panel: `public/controls.js`
- Phone remote UI: `public/remote.html`, `public/remote.js`
