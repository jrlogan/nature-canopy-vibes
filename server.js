// ============================================================
// server.js — Nature Canopy Vibes | Backend Bridge
// Phase 1: Express + Socket.io foundation
// ============================================================

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

const PORT = process.env.PORT || 3000;

// ----------------------------------------------------------
// Static file serving
// All files inside /public are served at the root URL.
// index.html, sketch.js, and any future assets live here.
// ----------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------------------------------------------
// Socket.io — WebSocket layer
// Each browser tab that loads the page opens one socket.
// ----------------------------------------------------------
io.on('connection', (socket) => {
  console.log(`[socket] Client connected    → id: ${socket.id}`);

  // Notify the client what server-side environment state is
  // (placeholder — will carry real EnvironmentManager state
  // once Phase 3 adds server-driven simulation).
  socket.emit('env:sync', {
    timeOfDay:      12,
    windSpeed:      0.1,
    currentWeather: 'clear',
  });

  socket.on('disconnect', (reason) => {
    console.log(`[socket] Client disconnected  → id: ${socket.id} | reason: ${reason}`);
  });
});

// ----------------------------------------------------------
// Start listening
// ----------------------------------------------------------
server.listen(PORT, () => {
  console.log(`[server] Nature Canopy Vibes running → http://localhost:${PORT}`);
});
