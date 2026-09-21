# Planetarium dependencies

- Astronomy Engine (Don Cross, MIT): https://github.com/cosinekitty/astronomy
  Browser distribution retrieved September 21, 2026; license in astronomy.LICENSE.
  Uses Equator (topocentric, of-date, aberration corrected), Horizon (normal
  refraction), Illumination and MoonPhase. Tour predictions are restricted to
  1700–2200; older journey scenes retain the existing approximate sky.
- satellite.js 6.0.1 (MIT): https://github.com/shashwatak/satellite-js
  Vendored browser build; license in satellite.LICENSE.
- ISS orbital elements: https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE
  Requested only when tracking is enabled. SGP4 propagation is restricted to
  three days from both the present and element epoch. Earth shadow is a simple
  cylindrical approximation; this is not a precision pass-prediction service.

The Moon's fixed procedural surface texture is illustrative, not a map. The
lunar disc is enlarged for visibility. Planets are magnitude-scaled light
points, not telescope views. Text tour uses optional browser speech synthesis;
voice availability and quality depend on the device.

Historical context: https://science.nasa.gov/solar-system/comets/1p-halley/
No historical comet trajectories are rendered in this version. Date-specific
ephemerides must be supplied and verified before adding those objects.
