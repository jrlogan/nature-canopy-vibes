# Sky modes

The display is menu-free by default. Pair using its small Phone remote / QR
button (or press Q); that button hides after a remote command. All experience
selection controls are in remote.html. Telescope and record imagery can still
be projected, but their controls stay on the phone. Explicit `?demo=1` retains
local menus for a single-device demo. Browser autoplay rules may require a
one-time click/tap on the display before remote audio playback will work.
Playback failure is reported on the phone; the phone does not claim it started.

Switching experience categories, starting another experience, or using scene /
time commands cancels the previous Cape replay. Stop experience returns to
Ambient and stops experience audio and projections. The independent shared
time-flow clock remains controlled by its own Pause / Live time buttons.

Ambient leaves the environment alone. Explore opens the existing explanatory
cards and an illustrative telescope. Experiences offers explicitly started
archive listening, a Voyager reflection, and a synthetic launch. Modes are local
to the display, not remote/shared room settings. Returning to Ambient stops
experience audio, narration and launch effects and removes the local date override.
Hiding the experience panel keeps archive audio playing. Escape hides panels;
it does not end listening. No audio autoplays on entry.
Time-flow buttons are the exception to local-only controls: they change the
shared journey clock, just like the QR remote. That clock can keep flowing in
Ambient; select Live time to end time travel.

## Sources and limitations

- Wildlife conversations are synthesized sketches, not species recordings or
  claims of current wildlife presence. Daytime woodland birds / tropical bird
  duets and temperate nighttime owl-like calls are selected conservatively;
  automatic wolves require a location named Yellowstone. Treeless, polar and
  storm settings suppress automatic exchanges. Phone previews intentionally
  bypass habitat selection so users can audition each profile. Stereo callers
  differ in pitch, level and timing, with 35–90 seconds between exchanges.
  The audio clock is independent of accelerated sky time. Mute, sleep, hidden
  pages, location/day-night changes and active experiences cancel queued calls.
  The phone's conversation-level slider controls this layer separately.

- Flying bird silhouettes face along their velocity (local head axis is -Y).
  Movement and wingbeats use elapsed time, with distance-based arrival duration.
  Powered departures no longer decay to a stationary hover. The renderer targets
  60 fps, subject to device capability; adaptive canopy detail omits small
  decorations under load. Rounded leaf outlines are cached without changing
  branch reach or main cluster placement. Flock neighbor search keeps only seven
  nearest entries rather than allocating and partially sorting full arrays.

- The Cape replay uses three curated launches, not a full launch database:
  Apollo 11 (1969-07-16 13:32 UTC, pad 39A), STS-1 (1981-04-12
  12:00:03 UTC, pad 39A), and Artemis I (2022-11-16 06:47 UTC, minute
  precision, pad 39B). NASA source links appear per chapter. STS-1's local
  7 a.m. is EST: daylight saving did not start until April 26 that year.
  The approximate Titusville observer and pad coordinates set the starting
  bearing only. Ascent paths and relative glow profiles are artistic. This
  initial replay is silent. It accelerates the half-hour approach, slows for
  countdown/ascent, and skips years between chapters. Weather/trees are not
  reconstructed. Ending it restores the underlying location and clock.
- Continuous time flow works on the display and QR remote, including GitHub
  Pages. Its in-page host owns the clock; the display extrapolates between
  one-second syncs. Static hosting holds weather and supports 1700–2200;
  the server retains its broader journey and weather features.

- NASA Apollo 11 audio highlights:
  https://www.nasa.gov/history/apollo-11-audio-highlights/
  Audio is streamed from NASA only when requested. Day-five highlights are edited;
  they must not drive a synchronized mission clock. The optional sky holds the
  touchdown epoch, 1969-07-20 20:17:40 UTC, at the user's current location.
  Weather is not reconstructed. Longer continuous listening is linked externally
  to https://apolloinrealtime.org/11/ . Legacy Lunar Surface Journal continuous-loop
  MP3 URLs returned 404 during implementation, so are not used as playback sources.
- Golden Record cover and explanation, NASA/JPL:
  https://science.nasa.gov/mission/voyager/golden-record-cover/
  The image loads externally when its section is approached. The exact Sagan /
  Druyan archival conversation has not been identified and is not included.
- Telescope surfaces and Saturn ring orientation are procedural illustrations,
  not spacecraft imagery or an exact telescope simulation. Illumination fraction
  uses Astronomy Engine at the scene date. No Galilean moon positions are shown.
- Launch trajectory and roar are original artistic effects, not historical data.
  Sound is separately opt-in; stop, mode changes and page hiding cancel the launch.

## Manual checks

At 360×640 and desktop sizes: switch all modes; open/close telescope; check no
horizontal overflow; hide/reopen Experiences without stopping archive audio;
start/stop launch with and without sound; return to Ambient and verify audio stops
and the normal clock resumes. Test archive failure offline and use source links.
Check below-horizon and unsupported-year telescope messages. Verify that opening
these local panels does not change another remote-connected display's settings.

## Future concept (not implemented)

A consent-based group show could accept optional nickname, birthplace, birth date
and time via QR, move between participants' skies, reunite at the present, then
enter a clearly labeled imagined future. Historical weather needs a separate
validated data source; future rockets/traffic must not be presented as predictions.
Personal entries should be ephemeral with remove/skip controls.
