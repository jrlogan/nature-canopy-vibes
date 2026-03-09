(function() {
  if (typeof window !== 'undefined' && typeof window.io !== 'undefined') {
    return; // Real socket.io is loaded, do nothing
  }

  console.log('[standalone] Socket.io not found. Initialising standalone mode.');
  window.__ncvStandaloneMode = true;
  window.__ncvSupabaseHostEnabled = false;

  const hasBroadcastChannel = typeof BroadcastChannel !== 'undefined';
  const channel = hasBroadcastChannel ? new BroadcastChannel('nature-canopy-vibes') : null;
  if (!hasBroadcastChannel) {
    console.warn('[standalone] BroadcastChannel unavailable; cross-tab sync disabled.');
  }
  const channelPost = (payload) => {
    if (channel) channel.postMessage(payload);
  };
  const clientListeners = {};
  let clientSocket = null;
  const isServerTab = !window.location.pathname.includes('remote');

  // Client mock socket
  window.io = function() {
    if (clientSocket) return clientSocket;

    clientSocket = {
      id: 'standalone-' + Math.random().toString(36).substr(2, 9),
      connected: true,
      on: function(event, callback) {
        if (!clientListeners[event]) clientListeners[event] = [];
        clientListeners[event].push(callback);
      },
      emit: function(event, data) {
        // In the host tab, route directly to the in-page server (same-tab path).
        // In remote tabs, there is no in-page server; use channel/network transports only.
        if (isServerTab) {
          handleClientMessage({ type: 'client_emit', event, data, socketId: clientSocket.id });
        }
        // Also broadcast so any other open tabs (remote.html) receive it.
        channelPost({ type: 'client_emit', event, data, socketId: clientSocket.id });
      }
    };

    // Trigger 'connect' callback asynchronously (mimics real socket.io behaviour).
    setTimeout(function() {
      if (clientListeners['connect']) {
        clientListeners['connect'].forEach(function(cb) { cb(); });
      }
      // Announce to the in-page server that this client has connected.
      if (isServerTab) {
        handleClientMessage({ type: 'client_connect', socketId: clientSocket.id });
      }
      channelPost({ type: 'client_connect', socketId: clientSocket.id });
    }, 10);

    return clientSocket;
  };

  // ── Minimal Supabase Realtime WebSocket client (no SDK needed) ──────────────
  // Implements just enough of the Phoenix channel protocol to send/receive
  // Broadcast events. Replaces the @supabase/supabase-js CDN dependency entirely.
  function createSbChannel(supabaseUrl, anonKey, channelName) {
    const wsUrl = supabaseUrl.replace(/^https?:\/\//, 'wss://')
      + '/realtime/v1/websocket?apikey=' + encodeURIComponent(anonKey) + '&vsn=1.0.0';
    let ws = null;
    let refN = 0;
    let joinRef = null;
    let subscribed = false;
    const listeners = {};
    let heartbeatTimer = null;

    const nextRef = () => String(++refN);

    const sendRaw = function(msg) {
      if (ws && ws.readyState === 1 /* OPEN */) {
        try { ws.send(JSON.stringify(msg)); } catch(e) {}
      }
    };

    const doJoin = function() {
      joinRef = nextRef();
      sendRaw({
        topic: 'realtime:' + channelName,
        event: 'phx_join',
        payload: { config: { broadcast: { self: false } }, access_token: anonKey },
        ref: joinRef,
        join_ref: joinRef
      });
    };

    const connect = function() {
      try { ws = new WebSocket(wsUrl); } catch(e) {
        console.warn('[supabase-ws] WebSocket connect failed:', e);
        setTimeout(connect, 5000);
        return;
      }
      ws.onopen = function() {
        doJoin();
        heartbeatTimer = setInterval(function() {
          sendRaw({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: nextRef(), join_ref: null });
        }, 25000);
      };
      ws.onmessage = function(e) {
        var msg;
        try { msg = JSON.parse(e.data); } catch(ex) { return; }
        if (msg.event === 'phx_reply' && msg.ref === joinRef && msg.payload && msg.payload.status === 'ok') {
          subscribed = true;
          console.log('[supabase-ws] Subscribed to channel:', channelName);
          (listeners['_sub'] || []).forEach(function(cb) { try { cb('SUBSCRIBED'); } catch(ex) {} });
        }
        if (msg.event === 'broadcast' && msg.payload && msg.payload.event) {
          var evName = msg.payload.event;
          (listeners[evName] || []).forEach(function(cb) { try { cb({ payload: msg.payload.payload }); } catch(ex) {} });
        }
      };
      ws.onclose = function(e) {
        subscribed = false;
        clearInterval(heartbeatTimer);
        console.warn('[supabase-ws] closed code=' + e.code + ' reason=' + (e.reason || 'none'));
        setTimeout(connect, 3000);
      };
      ws.onerror = function(e) { console.warn('[supabase-ws] WebSocket error (check Network tab for details)'); };
    };

    connect();

    return {
      on: function(type, filter, cb) {
        var evName = (filter && filter.event) ? filter.event : type;
        if (!listeners[evName]) listeners[evName] = [];
        listeners[evName].push(cb);
        return this;
      },
      subscribe: function(cb) {
        if (!listeners['_sub']) listeners['_sub'] = [];
        listeners['_sub'].push(cb);
        if (subscribed) setTimeout(function() { try { cb('SUBSCRIBED'); } catch(e) {} }, 0);
        return this;
      },
      send: function(msg) {
        sendRaw({
          topic: 'realtime:' + channelName,
          event: 'broadcast',
          payload: { type: 'broadcast', event: msg.event, payload: msg.payload },
          ref: nextRef(),
          join_ref: joinRef
        });
        return Promise.resolve();
      }
    };
  }

  // Optional WebRTC support using PeerJS
  let peer = null;
  let webrtcConn = null;

  // If we are NOT the server tab, connect to the host via the best available transport.
  if (!isServerTab) {
    const urlParams = new URLSearchParams(window.location.search);
    const room = urlParams.get('room');
    const _cfg = window.NCV_CONFIG || {};

    console.log('[standalone] room param:', room || '(none)', '| config url set:', !!_cfg.supabaseUrl, '| key set:', !!_cfg.supabaseAnonKey);

    // ── Option 1: Supabase Realtime via raw WebSocket (no SDK dependency) ──
    if (room && _cfg.supabaseUrl && _cfg.supabaseAnonKey) {
      console.log('[standalone] Connecting via Supabase WS to room:', room);
      const socket = window.io();

      try {
        const sbCh = createSbChannel(_cfg.supabaseUrl, _cfg.supabaseAnonKey, room);

        // Receive env:sync from host and dispatch to registered listeners (e.g. remote.js)
        sbCh.on('broadcast', { event: 'env:sync' }, function({ payload }) {
          if (clientListeners['env:sync']) {
            clientListeners['env:sync'].forEach(function(cb) {
              try { cb(payload); } catch(e) { console.error(e); }
            });
          }
        });

        sbCh.subscribe(function(status) {
          if (status !== 'SUBSCRIBED') return;
          console.log('[supabase] Remote connected to room:', room);
          // Fire connect callbacks so remote.js shows "Connected" status
          if (clientListeners['connect']) {
            clientListeners['connect'].forEach(function(cb) { try { cb(); } catch(e) {} });
          }
          // Ask host for an immediate state snapshot
          sbCh.send({ type: 'broadcast', event: 'remote:joined', payload: {} });
          // Retry once in case host wasn't subscribed yet
          setTimeout(function() {
            sbCh.send({ type: 'broadcast', event: 'remote:joined', payload: {} });
          }, 2000);
        });

        // Route all socket.emit calls to the Supabase channel
        socket.emit = function(event, data) {
          sbCh.send({ type: 'broadcast', event: event, payload: data });
          // Also try BroadcastChannel so same-device tabs still work
          channelPost({ type: 'client_emit', event, data, socketId: socket.id });
        };

      } catch(e) {
        console.warn('[supabase] Remote init failed, falling back to BroadcastChannel:', e);
      }

    // ── Option 2: WebRTC via PeerJS (fallback when Supabase is not configured) ──
    } else if (room && typeof Peer !== 'undefined') {
      console.log('[standalone] Found room param, attempting WebRTC to:', room);
      const socket = window.io();
      peer = new Peer();

      peer.on('open', (id) => {
        console.log('[standalone] WebRTC peer open, id:', id);
        webrtcConn = peer.connect(room);

        webrtcConn.on('open', () => {
          console.log('[standalone] WebRTC connected to host!');
          webrtcConn.send({ type: 'client_connect', socketId: socket.id });
        });

        webrtcConn.on('data', (msg) => {
          if (msg.type === 'server_emit') {
            if (clientListeners[msg.event]) {
              clientListeners[msg.event].forEach(cb => {
                try { cb(msg.data); } catch (e) { console.error(e); }
              });
            }
          }
        });
      });

      const origEmit = socket.emit;
      socket.emit = function(event, data) {
        if (webrtcConn && webrtcConn.open) {
          webrtcConn.send({ type: 'client_emit', event, data, socketId: socket.id });
        } else {
          origEmit.call(socket, event, data);
        }
      };

    // ── Option 3: BroadcastChannel — same device, same browser only ──
    } else {
      if (channel) {
        channel.onmessage = function(msg) {
          const { type, event, data } = msg.data;
          if (type === 'server_emit') {
            if (clientListeners[event]) {
              clientListeners[event].forEach(cb => {
                try { cb(data); } catch (e) { console.error(e); }
              });
            }
          }
        };
      }
    }
    return; // Stop here for remote tab, don't run server logic
  }

  // ==== SERVER LOGIC BEGINS ====
  // Persist the room ID in localStorage so the phone URL stays valid across
  // canvas refreshes — no need to re-scan the QR every time.
  var _storedRoom = null;
  try { _storedRoom = localStorage.getItem('ncv-room-id'); } catch(e) {}
  if (!_storedRoom) {
    _storedRoom = 'ncv-' + Math.random().toString(36).substr(2, 12);
    try { localStorage.setItem('ncv-room-id', _storedRoom); } catch(e) {}
  }
  window.__supabaseRoomId = _storedRoom;

  const serverIoListeners = {};
  const serverIo = {
    emit: function(event, data) {
      // Emit to local client
      if (clientListeners[event]) {
        clientListeners[event].forEach(cb => {
          try { cb(data); } catch(e) { console.error(e); }
        });
      }
      // Emit to remote clients
      channelPost({ type: 'server_emit', event, data });
    },
    on: function(event, callback) {
      if (!serverIoListeners[event]) serverIoListeners[event] = [];
      serverIoListeners[event].push(callback);
    }
  };

  // Forward emits to WebRTC peers
  const webrtcPeers = new Set();

  const handleClientMessage = function(msg, originConn = null) {
    const { type, event, data, socketId } = msg;

    if (type === 'client_emit') {
       const socket = getOrCreateFakeSocket(socketId, originConn);
       socket._trigger(event, data);
    } else if (type === 'client_connect') {
       const socket = getOrCreateFakeSocket(socketId, originConn);
       if (serverIoListeners['connection']) {
          serverIoListeners['connection'].forEach(cb => cb(socket));
       }
    }
  };

  if (channel) {
    channel.onmessage = function(msg) {
      handleClientMessage(msg.data);
    };
  }

  // Host WebRTC setup
  if (typeof Peer !== 'undefined') {
    peer = new Peer();
    peer.on('open', (id) => {
      console.log('[standalone] WebRTC Host Peer ID:', id);
      window.__webrtcHostId = id; // Make it available to sketch.js for QR code
    });

    peer.on('connection', (conn) => {
      console.log('[standalone] WebRTC incoming connection from:', conn.peer);
      webrtcPeers.add(conn);

      conn.on('data', (data) => {
        handleClientMessage(data, conn);
      });

      conn.on('close', () => {
        webrtcPeers.delete(conn);
      });
    });
  }

  const origEmit = serverIo.emit;
  serverIo.emit = function(event, data) {
    origEmit(event, data);
    // Also send to all connected WebRTC peers
    webrtcPeers.forEach(conn => {
      if (conn.open) {
        conn.send({ type: 'server_emit', event, data });
      }
    });
  };

  const fakeSockets = {};
  function getOrCreateFakeSocket(id, originConn = null) {
    if (fakeSockets[id]) {
      if (originConn) fakeSockets[id]._webrtcConn = originConn;
      return fakeSockets[id];
    }

    const socketListeners = {};
    const socket = {
      id: id,
      _webrtcConn: originConn,
      on: function(event, callback) {
        if (!socketListeners[event]) socketListeners[event] = [];
        socketListeners[event].push(callback);
      },
      emit: function(event, data) {
        if (this._webrtcConn) {
           this._webrtcConn.send({ type: 'server_emit', event, data });
        } else if (clientSocket && clientSocket.id === id) {
           if (clientListeners[event]) {
             clientListeners[event].forEach(cb => cb(data));
           }
        } else {
           channelPost({ type: 'server_emit', event, data });
        }
      },
      _trigger: function(event, data) {
        if (socketListeners[event]) {
          socketListeners[event].forEach(cb => {
            try { cb(data); } catch(e) { console.error(e); }
          });
        }
      }
    };
    fakeSockets[id] = socket;
    return socket;
  }

  const io = serverIo;

  // Mocks for server dependencies
  const process = { env: {} };
  function setDisplayPower(on) {
    console.log('[standalone] Mock setDisplayPower: ' + (on ? 'ON' : 'OFF'));
  }

  const TICK_MS = 60 * 1000;
const LIVE_FETCH_MS = 10 * 60 * 1000;

// Shared environment state for all connected clients.
const environmentState = {
  timeOfDay:      21.2,
  windSpeed:      0.22,
  liveWindKph:    10,
  liveTemperatureC: 8,
  liveCloudCoverPct: 28,
  liveIsDay: false,
  liveSeasonLabel: 'Late Winter',
  currentWeather: 'clear',
  starBrightness: 1.1,
  constellationBrightness: 1.0,
  showConstellations: false,
  showConstellationLabels: false,
  showPlantLabels: false,
  forceTreeType: '',
  forceTreeless: false,
  cloudCover: 0.28,
  skyBlur: 1.0,
  leafSoftness: 0.45,
  soundMaster: 0.5,
  soundCrickets: 0.35,
  soundThunder: 0.9,
  soundBirds: 0.35,
  soundRain: 0.55,
  soundWind: 0.45,
  soundNightBirds: 0.25,
  canopyCoverage: 0.34,
  canopyTreeCount: 0.92,
  canopyDensity: 0.9,
  canopyPerspective: 0.92,
  canopyEdgeLushness: 0.95,
  branchSpread: 0.66,
  branchDepth: 5,
  simulationMode: 'live', // manual | random | live
  season: 'auto', // auto | spring | summer | fall | winter
  liveDateISO: new Date().toISOString(),
  liveLocationName: 'New Haven, CT',
  liveLocationLat: 41.3083,
  liveLocationLon: -72.9279,
  performanceMode: 'auto',
  sleeping: false,
  lightningIntensity: 0.0, // 0.0 to 1.0 based on real-world data
};

let lastLiveFetchAt = 0;

// const { exec } = require('child_process');
function setDisplayPower(on) {
  console.log(`[power] Setting display power: ${on ? 'ON' : 'OFF'} (Mocked in standalone mode)`);
  // Try DPMS (X11)
  /*
  exec(on ? 'xset dpms force on' : 'xset dpms force off', (err) => {
    if (err) {
      // Fallback: Try vcgencmd (Raspberry Pi legacy)
      exec(`vcgencmd display_power ${on ? 1 : 0}`, (err2) => {
        if (err2) {
          // Fallback: Try wayland/wlr-randr or similar if needed,
          // but for now we'll just log and rely on the web overlay.
          console.log('[power] Hardware display control not available or failed.');
        }
      });
    }
  });
  */
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function setApproxLocalTimeFromLon(lon) {
  if (!Number.isFinite(lon)) return;
  const utcNow = new Date();
  const localMs = utcNow.getTime() + lon * 240000; // 1° lon ~= 4 minutes
  const d = new Date(localMs);
  const hh = d.getUTCHours();
  const mm = d.getUTCMinutes();
  const ss = d.getUTCSeconds();
  environmentState.timeOfDay = hh + mm / 60 + ss / 3600;
  environmentState.liveDateISO = d.toISOString();
}

function mapWeatherCode(code = 0) {
  if (code >= 95) return 'storm';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  return 'clear';
}

function fracHash(n) {
  const x = Math.sin(n) * 43758.5453123;
  return x - Math.floor(x);
}

function deriveSeasonLabel(dateISO, lat, seasonMode = 'auto') {
  const forced = String(seasonMode || 'auto').toLowerCase();
  if (forced === 'spring' || forced === 'summer' || forced === 'fall' || forced === 'winter') {
    return forced[0].toUpperCase() + forced.slice(1);
  }
  const dRaw = dateISO ? new Date(dateISO) : new Date();
  const d = Number.isFinite(dRaw.getTime()) ? dRaw : new Date();
  const hemiSouth = Number.isFinite(lat) && lat < 0;
  let m = d.getMonth() + 1;
  let day = d.getDate();
  if (hemiSouth) {
    m += 6;
    if (m > 12) m -= 12;
  }
  const season = (m === 12 || m <= 2)
    ? 'Winter'
    : (m <= 5 ? 'Spring' : (m <= 8 ? 'Summer' : 'Fall'));
  let phase = 'Mid';
  if (day <= 10) phase = 'Early';
  else if (day >= 21) phase = 'Late';
  return `${phase} ${season}`;
}

function applyLocationBaselineClimate() {
  const lat = Number(environmentState.liveLocationLat);
  const lon = Number(environmentState.liveLocationLon);
  const tod = Number(environmentState.timeOfDay);
  const absLat = Math.abs(Number.isFinite(lat) ? lat : 0);
  const dateISO = environmentState.liveDateISO || new Date().toISOString();
  const dRaw = new Date(dateISO);
  const d = Number.isFinite(dRaw.getTime()) ? dRaw : new Date();
  const month = d.getUTCMonth() + 1;
  const hemiSouth = Number.isFinite(lat) && lat < 0;
  const seasonalCos = Math.cos((((month - (hemiSouth ? 1 : 7)) / 12) * Math.PI * 2));
  const seasonal = seasonalCos * (10 + absLat * 0.08);
  const baseline = 27 - absLat * 0.48;
  const daily = Number.isFinite(tod) ? Math.sin(((tod - 7) / 24) * Math.PI * 2) * 4.5 : 0;
  const noise = (fracHash((lat || 0) * 17.7 + (lon || 0) * 9.2 + d.getUTCDate() * 1.31) - 0.5) * 2.2;
  environmentState.liveTemperatureC = baseline + seasonal + daily + noise;
  const windBase = 7 + absLat * 0.17;
  const windNoise = (fracHash((lat || 0) * 3.1 + (lon || 0) * 1.7 + d.getUTCDate() * 0.71) - 0.5) * 5.0;
  environmentState.liveWindKph = Math.max(1, windBase + windNoise);
  environmentState.liveCloudCoverPct = Math.round(environmentState.cloudCover * 100);
  environmentState.liveIsDay = !(environmentState.timeOfDay < 6.5 || environmentState.timeOfDay > 20.5);
}

function refreshDerivedLiveFields() {
  if (!Number.isFinite(environmentState.liveTemperatureC)) environmentState.liveTemperatureC = 8;
  if (!Number.isFinite(environmentState.liveWindKph)) environmentState.liveWindKph = Math.max(1, environmentState.windSpeed * 45);
  if (!Number.isFinite(environmentState.liveCloudCoverPct)) environmentState.liveCloudCoverPct = Math.round(environmentState.cloudCover * 100);
  environmentState.liveIsDay = !(environmentState.timeOfDay < 6.5 || environmentState.timeOfDay > 20.5);
  environmentState.liveSeasonLabel = deriveSeasonLabel(
    environmentState.liveDateISO,
    Number(environmentState.liveLocationLat),
    environmentState.season,
  );
}

async function fetchLiveWeather() {
  const lat = environmentState.liveLocationLat;
  const lon = environmentState.liveLocationLon;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current=temperature_2m,weather_code,cloud_cover,wind_speed_10m,is_day,time&minutely_15=lightning_potential,cape&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`live weather fetch failed: ${res.status}`);
  const data = await res.json();
  const cur = data.current || {};
  const m15 = data.minutely_15 || {};

  // Extract latest (first) 15-minute slot values
  const lpi  = (m15.lightning_potential || [])[0] || 0;
  const cape = (m15.cape || [])[0] || 0;

  // LPI (Lightning Potential Index) is 0–100% in models like ICON/HRRR.
  // CAPE (Convective Available Potential Energy) is 0–3000+ J/kg.
  // We'll blend them: if LPI is high, intensity is high. If LPI is null/0, use CAPE as a proxy.
  let intensity = 0.0;
  if (lpi > 0) {
    intensity = clamp01(lpi / 100);
  } else if (cape > 0) {
    // CAPE thresholds: 500 (weak), 1500 (moderate), 2500+ (extreme)
    intensity = clamp01(cape / 2500);
  }
  environmentState.lightningIntensity = intensity;

  if (typeof cur.time === 'string' && cur.time.length >= 16) {
    const hh = Number(cur.time.slice(11, 13));
    const mm = Number(cur.time.slice(14, 16));
    const tod = (Number.isFinite(hh) ? hh : 0) + (Number.isFinite(mm) ? mm / 60 : 0);
    if (Number.isFinite(tod)) environmentState.timeOfDay = tod;
    environmentState.liveDateISO = `${cur.time}:00`;
  }
  environmentState.cloudCover = clamp01((cur.cloud_cover ?? 30) / 100);
  environmentState.liveCloudCoverPct = Math.round(cur.cloud_cover ?? (environmentState.cloudCover * 100));
  environmentState.windSpeed = clamp01((cur.wind_speed_10m ?? 8) / 45);
  environmentState.liveWindKph = Number.isFinite(cur.wind_speed_10m) ? cur.wind_speed_10m : Math.round(environmentState.windSpeed * 45);
  environmentState.liveTemperatureC = Number.isFinite(cur.temperature_2m) ? cur.temperature_2m : environmentState.liveTemperatureC;
  environmentState.liveIsDay = (cur.is_day ?? 0) === 1;
  environmentState.currentWeather = mapWeatherCode(cur.weather_code ?? 0);
  refreshDerivedLiveFields();
  if (environmentState.currentWeather === 'storm') {
    environmentState.cloudCover = Math.max(environmentState.cloudCover, 0.75);
  }
}

async function geocodeLocation(query) {
  const q = String(query || '').trim();
  if (!q) throw new Error('empty location');
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`geocode failed: ${res.status}`);
  const data = await res.json();
  if (!data.results || !data.results.length) throw new Error('location not found');
  const hit = data.results[0];
  environmentState.liveLocationName = [hit.name, hit.admin1, hit.country_code].filter(Boolean).join(', ');
  environmentState.liveLocationLat = hit.latitude;
  environmentState.liveLocationLon = hit.longitude;
}

function tickRandomSimulation() {
  const baseDate = environmentState.liveDateISO ? new Date(environmentState.liveDateISO) : new Date();
  const month = (Number.isFinite(baseDate.getTime()) ? baseDate : new Date()).getMonth() + 1;
  const season = (() => {
    const s = String(environmentState.season || 'auto').toLowerCase();
    if (s === 'spring' || s === 'summer' || s === 'fall' || s === 'winter') return s;
    if (month === 12 || month <= 2) return 'winter';
    if (month <= 5) return 'spring';
    if (month <= 10) return 'summer';
    return 'fall';
  })();

  environmentState.timeOfDay = (environmentState.timeOfDay + 0.12) % 24;
  const windDelta = season === 'winter' ? 0.16 : (season === 'summer' ? 0.10 : 0.12);
  const cloudDelta = season === 'winter' ? 0.20 : (season === 'summer' ? 0.14 : 0.18);
  environmentState.windSpeed = clamp01(environmentState.windSpeed + (Math.random() - 0.5) * windDelta);
  environmentState.cloudCover = clamp01(environmentState.cloudCover + (Math.random() - 0.5) * cloudDelta);
  environmentState.liveCloudCoverPct = Math.round(environmentState.cloudCover * 100);
  environmentState.liveWindKph = Math.round(environmentState.windSpeed * 45);
  environmentState.liveIsDay = !(environmentState.timeOfDay < 6.5 || environmentState.timeOfDay > 20.5);
  const dailyHeat = Math.sin(((environmentState.timeOfDay - 6) / 24) * Math.PI * 2) * 5;
  const seasonBase = season === 'winter' ? 2 : (season === 'spring' ? 10 : (season === 'fall' ? 11 : 22));
  environmentState.liveTemperatureC = seasonBase + dailyHeat + (Math.random() * 1.4 - 0.7);

  const roll = Math.random();
  const stormP = season === 'summer' ? 0.07 : (season === 'winter' ? 0.03 : 0.05);
  const rainP = season === 'spring' ? 0.26 : (season === 'fall' ? 0.24 : (season === 'winter' ? 0.18 : 0.20));
  if (roll < stormP) environmentState.currentWeather = 'storm';
  else if (roll < rainP) environmentState.currentWeather = 'rain';
  else if (roll > (season === 'summer' ? 0.68 : 0.75)) environmentState.currentWeather = 'clear';

  if (environmentState.currentWeather === 'storm') {
    environmentState.cloudCover = Math.max(environmentState.cloudCover, 0.7);
    environmentState.windSpeed = Math.max(environmentState.windSpeed, 0.45);
  } else if (environmentState.currentWeather === 'rain') {
    environmentState.cloudCover = Math.max(environmentState.cloudCover, 0.5);
    environmentState.windSpeed = Math.max(environmentState.windSpeed, 0.25);
  }
  refreshDerivedLiveFields();
}

function applyScenePreset(preset) {
  if (preset === 'wooded') {
    environmentState.treeSkyOpen = 1.0;
    environmentState.treeFrameDensity = 14;
    environmentState.treeFoliageMass = 1.0;
    environmentState.treeBranchReach = 0.56;
    environmentState.treeBranchChaos = 0.74;
    environmentState.canopyEdgeLushness = 1.25;
    environmentState.branchDepth = 5;
    return true;
  }
  if (preset === 'clearing') {
    environmentState.treeSkyOpen = 1.48;
    environmentState.treeFrameDensity = 4;
    environmentState.treeFoliageMass = 0.08;
    environmentState.treeBranchReach = 0.24;
    environmentState.treeBranchChaos = 0.42;
    environmentState.canopyEdgeLushness = 0.0;
    environmentState.branchDepth = 3;
    return true;
  }
  return false;
}

function randomizeSceneSliders() {
  environmentState.treeSkyOpen = 1 + Math.random() * 0.5;
  environmentState.treeFrameDensity = Math.round(4 + Math.random() * 12);
  environmentState.treeFoliageMass = clamp01(0.1 + Math.random() * 0.9);
  environmentState.treeBranchReach = clamp01(0.1 + Math.random() * 0.9);
  environmentState.treeBranchChaos = clamp01(0.05 + Math.random() * 0.95);
  environmentState.canopyEdgeLushness = 0.1 + Math.random() * 1.4;
  environmentState.branchDepth = 3 + Math.floor(Math.random() * 3);
  environmentState.windSpeed = clamp01(Math.random());
  environmentState.cloudCover = clamp01(Math.random());
  environmentState.currentWeather = ['clear', 'rain', 'storm'][Math.floor(Math.random() * 3)];
  environmentState.timeOfDay = Math.random() * 24;
}

function estimateLocationWoodedness(lat, lon, name = '') {
  const absLat = Math.abs(Number(lat) || 0);
  let wooded = 0.56;
  const q = String(name || '').toLowerCase();

  // Polar cap / arctic stations should be effectively treeless.
  if (absLat >= 72 || q.includes('north pole')) return 0.0;

  if (absLat < 12) wooded = 0.84;
  else if (absLat < 23) wooded = 0.74;
  else if (absLat < 35) wooded = 0.52;
  else if (absLat < 50) wooded = 0.62;
  else if (absLat < 62) wooded = 0.54;
  else wooded = 0.42;
  const aridHints = ['phoenix', 'las vegas', 'doha', 'cairo', 'riyadh', 'dubai', 'abu dhabi', 'marrakesh', 'sahara'];
  const humidHints = ['rainforest', 'manaus', 'singapore', 'quito', 'vancouver', 'seattle', 'portland', 'honolulu'];
  if (aridHints.some((k) => q.includes(k))) wooded -= 0.20;
  if (humidHints.some((k) => q.includes(k))) wooded += 0.14;

  if (Number.isFinite(lon)) {
    // Small stable noise by coordinates so nearby regions vary subtly.
    const n = Math.sin((lat * 12.9898) + (lon * 78.233)) * 43758.5453;
    const frac = n - Math.floor(n);
    wooded += (frac - 0.5) * 0.08;
  }
  return clamp01(wooded);
}

function randomizeCanopyForLocation() {
  const lat = Number(environmentState.liveLocationLat);
  const lon = Number(environmentState.liveLocationLon);
  const wooded = estimateLocationWoodedness(lat, lon, environmentState.liveLocationName);
  const winterK = (() => {
    const s = String(environmentState.season || 'auto').toLowerCase();
    if (s === 'winter') return 0.62;
    if (s === 'fall') return 0.84;
    if (s === 'spring') return 0.92;
    return 1.0;
  })();
  const w = wooded * winterK;
  const treeless = w <= 0.03;

  environmentState.forceTreeless = treeless;
  if (treeless) {
    environmentState.treeFrameDensity = 4;
    environmentState.treeFoliageMass = 0;
    environmentState.treeBranchReach = 0;
    environmentState.treeSkyOpen = 1.5;
    environmentState.canopyEdgeLushness = 0;
    environmentState.treeBranchChaos = 0.35;
    environmentState.branchDepth = 3;
    return;
  }

  environmentState.treeFrameDensity = Math.max(4, Math.min(16, Math.round(4 + w * 12 + (Math.random() * 2 - 1))));
  environmentState.treeFoliageMass = clamp01(0.18 + w * 0.78 + (Math.random() * 0.14 - 0.07));
  environmentState.treeBranchReach = clamp01(0.26 + w * 0.34 + (Math.random() * 0.10 - 0.05));
  environmentState.treeSkyOpen = Math.max(1.0, Math.min(1.5, 1.42 - w * 0.34 + (Math.random() * 0.10 - 0.05)));
  environmentState.canopyEdgeLushness = Math.max(0, Math.min(1.5, w * 1.18 + (Math.random() * 0.18 - 0.09)));
  environmentState.treeBranchChaos = clamp01(0.42 + Math.random() * 0.46);
}

function normalizeForcedTreeType(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'conifer' || s === 'palm') return s;
  return '';
}

async function simulationTick() {
  try {
    if (environmentState.simulationMode === 'random') {
      tickRandomSimulation();
      io.emit('env:sync', environmentState);
      return;
    }

    if (environmentState.simulationMode === 'live') {
      const now = Date.now();
      if (now - lastLiveFetchAt >= LIVE_FETCH_MS) {
        await fetchLiveWeather();
        lastLiveFetchAt = now;
        io.emit('env:sync', environmentState);
      }
    }
  } catch (err) {
    console.warn(`[sim] ${err.message}`);
  }
}

// ----------------------------------------------------------
// Static file serving
// All files inside /public are served at the root URL.
// index.html, sketch.js, and any future assets live here.
// ----------------------------------------------------------
io.on('connection', (socket) => {
  console.log(`[socket] Client connected    → id: ${socket.id}`);

  // Send current canonical environment snapshot on connect.
  socket.emit('env:sync', environmentState);

  // Local panel controls can still push full environment updates.
  socket.on('env:update', (nextState = {}) => {
    Object.assign(environmentState, nextState);
    io.emit('env:sync', environmentState);
  });

  socket.on('sim:setMode', (payload = {}) => {
    const mode = payload.mode;
    if (!['manual', 'random', 'live'].includes(mode)) return;
    environmentState.simulationMode = mode;
    io.emit('env:sync', environmentState);
  });

  socket.on('sim:setLocation', async (payload = {}) => {
    if (typeof payload.query !== 'string') return;
    try {
      const lat = Number(payload.lat);
      const lon = Number(payload.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        environmentState.liveLocationName = String(payload.name || payload.query || environmentState.liveLocationName);
        environmentState.liveLocationLat = lat;
        environmentState.liveLocationLon = lon;
        environmentState.forceTreeType = normalizeForcedTreeType(payload.forceTreeType);
        setApproxLocalTimeFromLon(lon);
        applyLocationBaselineClimate();
      } else {
        await geocodeLocation(payload.query);
        environmentState.forceTreeType = '';
        setApproxLocalTimeFromLon(environmentState.liveLocationLon);
        applyLocationBaselineClimate();
      }
      environmentState.simulationMode = 'live';
      randomizeCanopyForLocation();
      refreshDerivedLiveFields();
      // Always push new location immediately so clients rerender stars/season by location.
      if (!environmentState.liveDateISO) environmentState.liveDateISO = new Date().toISOString();
      io.emit('env:sync', environmentState);

      await fetchLiveWeather();
      lastLiveFetchAt = Date.now();
      io.emit('env:sync', environmentState);
    } catch (err) {
      socket.emit('sim:error', { message: err.message });
      // Still broadcast location state in case weather fetch failed but location changed.
      io.emit('env:sync', environmentState);
    }
  });

  // Mobile remote commands are normalized here and rebroadcast.
  socket.on('remote:command', async (payload = {}) => {
    const command = typeof payload === 'string' ? payload : payload.command;
    const data = payload && typeof payload === 'object' ? (payload.data || {}) : {};
    if (!command) return;

    switch (command) {
      case 'toggle_sleep':
        const nextSleep = data.value !== undefined ? !!data.value : !environmentState.sleeping;
        environmentState.sleeping = nextSleep;
        setDisplayPower(!nextSleep);
        break;
      case 'set_location': {
        try {
          const lat = Number(data.lat);
          const lon = Number(data.lon);
          const query = String(data.query || data.name || '').trim();
          if (Number.isFinite(lat) && Number.isFinite(lon)) {
            environmentState.liveLocationName = String(data.name || query || environmentState.liveLocationName);
            environmentState.liveLocationLat = lat;
            environmentState.liveLocationLon = lon;
            environmentState.forceTreeType = normalizeForcedTreeType(data.forceTreeType);
            setApproxLocalTimeFromLon(lon);
            applyLocationBaselineClimate();
          } else if (query) {
            await geocodeLocation(query);
            environmentState.forceTreeType = '';
            setApproxLocalTimeFromLon(environmentState.liveLocationLon);
            applyLocationBaselineClimate();
          } else {
            return;
          }
          environmentState.simulationMode = 'live';
          randomizeCanopyForLocation();
          refreshDerivedLiveFields();
          io.emit('remote:command', { command, data });
          io.emit('env:sync', environmentState);
          await fetchLiveWeather();
          lastLiveFetchAt = Date.now();
          io.emit('env:sync', environmentState);
        } catch (err) {
          socket.emit('sim:error', { message: err.message });
          io.emit('env:sync', environmentState);
        }
        return;
      }
      case 'trigger_storm':
        environmentState.currentWeather = 'storm';
        break;
      case 'clear_weather':
        environmentState.currentWeather = 'clear';
        break;
      case 'day_mode':
        environmentState.timeOfDay = 12;
        break;
      case 'night_mode':
        environmentState.timeOfDay = 23;
        break;
      case 'reseed_trees':
        break;
      case 'preset_wooded':
        applyScenePreset('wooded');
        break;
      case 'preset_clearing':
        applyScenePreset('clearing');
        break;
      case 'randomize_scene':
        randomizeSceneSliders();
        break;
      case 'toggle_constellations':
        environmentState.showConstellations = !!data.value;
        break;
      case 'toggle_sky_labels':
        environmentState.showConstellations = !!data.value;
        environmentState.showConstellationLabels = !!data.value;
        environmentState.showPlantLabels = !!data.value;
        break;
      case 'toggle_labels':
        environmentState.showConstellationLabels = !!data.value;
        environmentState.showPlantLabels = !!data.value;
        break;
      default:
        console.log(`[socket] Unknown remote command: ${command}`);
        return;
    }

    io.emit('remote:command', { command, data });
    io.emit('env:sync', environmentState);
  });

  socket.on('lightning_strike', () => {
    console.log('FLASH RELAY: Triggering 5V GPIO for strobe light!');
  });

  socket.on('disconnect', (reason) => {
    console.log(`[socket] Client disconnected  → id: ${socket.id} | reason: ${reason}`);
  });
});


// ── Supabase Realtime Broadcast — host side ──────────────────────────────────
// Generates a room ID, publishes env:sync to it, and receives remote commands.
// Only activates when config.js has valid Supabase credentials.
(function initSupabaseHost() {
  const _cfg = window.NCV_CONFIG || {};
  console.log('[supabase:host] config url set:', !!_cfg.supabaseUrl, '| key set:', !!_cfg.supabaseAnonKey);
  if (!_cfg.supabaseUrl || !_cfg.supabaseAnonKey) {
    window.__ncvSupabaseHostEnabled = false;
    console.warn('[supabase:host] Credentials missing — cross-device remote disabled. Check config.js.');
    return;
  }
  window.__ncvSupabaseHostEnabled = true;

  const roomId = window.__supabaseRoomId; // already generated synchronously above

  try {
    const sbCh = createSbChannel(_cfg.supabaseUrl, _cfg.supabaseAnonKey, roomId);

    // Ensure the fake server-side socket for Supabase remotes is fully initialised
    // (connection handlers registered) before we dispatch any commands to it.
    function ensureSupabaseRemoteConnected() {
      if (fakeSockets['supabase-remote']) return;
      handleClientMessage({ type: 'client_connect', socketId: 'supabase-remote' });
    }

    // Receive commands from remote phone
    sbCh.on('broadcast', { event: 'remote:command' }, function({ payload }) {
      ensureSupabaseRemoteConnected();
      handleClientMessage({
        type: 'client_emit', event: 'remote:command',
        data: payload, socketId: 'supabase-remote'
      });
    });

    // When a new remote client joins, immediately send current state
    sbCh.on('broadcast', { event: 'remote:joined' }, function() {
      ensureSupabaseRemoteConnected();
      sbCh.send({ type: 'broadcast', event: 'env:sync', payload: environmentState });
    });

    sbCh.subscribe(function(status) {
      if (status !== 'SUBSCRIBED') return;
      console.log('[supabase] Host room ready — share this room ID:', roomId);
      // Send initial state in case a remote is already waiting
      sbCh.send({ type: 'broadcast', event: 'env:sync', payload: environmentState });
    });

    // Patch serverIo.emit so every env:sync is also broadcast to remote phones
    const _origEmit = serverIo.emit.bind(serverIo);
    serverIo.emit = function(event, data) {
      _origEmit(event, data);
      if (event === 'env:sync') {
        sbCh.send({ type: 'broadcast', event: 'env:sync', payload: data });
      }
    };

  } catch(e) {
    console.warn('[supabase] Host init failed:', e);
  }
}());

setInterval(simulationTick, TICK_MS);
simulationTick();

  // ----------------------------------------------------

})();
