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

Create `~/.config/autostart/nature-canopy-kiosk.desktop` for the desktop user:

```ini
[Desktop Entry]
Type=Application
Name=Nature Canopy Kiosk
Exec=sh -c "xset s off && xset -dpms && xset s noblank && chromium-browser --kiosk --incognito --noerrdialogs --disable-infobars http://localhost:3000/"
X-GNOME-Autostart-enabled=true
```

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
- Keyboard:
  - `D` toggles debug HUD
  - `L` opens the location control remote
  - `C` toggles panel
  - `Q` toggles the QR overlay

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
3. Advanced controls appear and remain enabled on that phone (saved in local storage).

Advanced controls:

- `Compass Overlay`: shows/hides directional compass markers on the display.
- `Sky Offset` slider: rotates sky projection azimuth for projector calibration.
- `Copy Cal URL`: copies a display URL that includes the current calibration offset.
- `Lighting Flash`: triggers a manual lightning flash effect.

Calibration URL parameters:

- `room`: fixed shared room ID for stable reconnection (`room=my-install-01`)
- `skyAzOffset`: initial sky azimuth calibration in degrees (`skyAzOffset=15`)

Example calibrated kiosk URL:

`https://jrlogan.github.io/nature-canopy-vibes/?qr=1&room=my-install-01&skyAzOffset=15`

Notes:

- Re-scanning the same fixed-room QR reconnects quickly if phone/browser backgrounding interrupts the session.
- Weather fetch requests were updated to avoid stale error states from unsupported query combos.

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
