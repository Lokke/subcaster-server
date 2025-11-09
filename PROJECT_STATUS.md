# SubCaster Server - Project Status & Roadmap

**Erstellt:** 9. November 2025  
**Repository:** https://github.com/Lokke/subcaster-server  
**Parent Project:** https://github.com/Lokke/subcaster (webdj)

## 🎯 Projektziel

Umwandlung von SubCaster von einer Browser-basierten zu einer Server-basierten DJ-Applikation mit folgenden Hauptzielen:

1. **Persistent Audio Playback** - Audio läuft auf dem Server, Browser kann geschlossen werden
2. **Multi-DJ Support** - Mehrere DJs können Session übernehmen ohne Stream-Unterbrechung
3. **Server-Side Mixing** - Alle Audio-Verarbeitung (Decks, Mikrofon, Effekte) auf dem Server
4. **Browser als Remote Control** - UI zeigt nur Status, sendet Commands, kein lokales Audio-Processing
5. **Monitor Audio via WebSocket/WebRTC** - DJ kann Mix hören (gespielte Lieder)
6. **Microphone Streaming** - Mikrofon vom Browser zum Server via WebRTC

## 📊 Architektur

### Vorher (Browser-basiert)
```
Browser:
  HTMLAudioElement → Web Audio API → MediaRecorder → WebSocket → AzuraCast
  Problem: Browser muss offen bleiben, keine Persistenz
```

### Nachher (Server-basiert)
```
Browser (Remote Control):
  UI (Decks, Queue, Waveforms)
  ↓ WebSocket Commands
  ↓ WebRTC Microphone →

Node.js Server (Audio Engine):
  - 4x Audio Decks (FFmpeg decode)
  - Audio Mixer (Decks + Mic)
  - Effects Processing
  - Persistent Playback
  ↓ Opus Encoding
  ↓ WebSocket → AzuraCast
  ↓ WebSocket Monitor Audio → Browser (zum Hören)
```

## ✅ Implementierter Status (Phase 1)

### 1. Server-Side Audio Engine ✅
**Datei:** `server/AudioEngine.js` (445 Zeilen)

**Features:**
- `AudioDeck` Klasse für einzelne Decks (A, B, C, D)
- FFmpeg Integration für Audio-Dekodierung
- PCM Audio-Streaming (48kHz, Stereo, 16-bit)
- Playback Controls: play(), pause(), seek(), setVolume(), clear()
- Position Tracking (100ms Update-Interval)
- Event System für State Changes
- Automatische Track-Ende-Erkennung

**API:**
```javascript
const audioEngine = new AudioEngine();

// Load track
await audioEngine.loadTrack('a', 'https://music-server.com/stream/123', {
  title: 'Song Title',
  artist: 'Artist',
  album: 'Album',
  duration: 180
});

// Control playback
audioEngine.playDeck('a');
audioEngine.pauseDeck('a');
audioEngine.seekDeck('a', 45.5);
audioEngine.setDeckVolume('a', 0.8);
await audioEngine.clearDeck('a');

// Get state
const state = audioEngine.getAllStates();
```

**Event System:**
```javascript
audioEngine.on('deckStateChange', (state) => {
  // state: { deck, state, track, volume, position, duration }
});

audioEngine.on('deckPosition', (pos) => {
  // pos: { deck, position }
});

audioEngine.on('deckEnded', (data) => {
  // data: { deck }
});
```

### 2. WebSocket Command Server ✅
**Datei:** `server/CommandServer.js` (282 Zeilen)

**Features:**
- WebSocket Server auf `/ws/commands`
- Command Routing (loadTrack, play, pause, seek, setVolume, clear)
- Real-time State Broadcasting an alle Clients
- Session Management (DJ Lock/Release)
- Multi-Client Support
- Error Handling

**Command Format:**
```javascript
// Client → Server
{
  type: 'loadTrack',
  data: {
    deck: 'a',
    url: 'https://...',
    metadata: { title, artist, album, duration }
  }
}

// Server → Client
{
  type: 'deckStateChange',
  data: {
    deck: 'A',
    state: 'playing',
    track: { title, artist, album },
    volume: 0.8,
    position: 45.5,
    duration: 180
  }
}
```

**Session Management:**
```javascript
// Request DJ control
{ type: 'requestControl' }
// Response: { type: 'controlGranted' }

// Release control
{ type: 'releaseControl' }
// Response: { type: 'controlReleased' }

// Session locked by other DJ
{ type: 'controlDenied', message: 'Session locked by another DJ' }
```

### 3. Monitor Audio Streaming ✅
**Datei:** `server/AudioStreamServer.js` (95 Zeilen)

**Features:**
- WebSocket Server auf `/ws/audio`
- Binary PCM Audio Streaming
- Multi-Client Support
- Format: 48kHz, Stereo, 16-bit PCM

**Client-Side Integration:**
```javascript
const audioWs = new WebSocket('ws://localhost:5173/ws/audio');
audioWs.binaryType = 'arraybuffer';

audioWs.onmessage = (event) => {
  if (typeof event.data === 'string') {
    // Format info: { type: 'audioFormat', sampleRate: 48000, channels: 2, bitDepth: 16 }
  } else {
    // PCM audio data (Int16Array)
    const pcmData = new Int16Array(event.data);
    // Play via Web Audio API
  }
};
```

### 4. Dependencies ✅
**Installiert:**
- `fluent-ffmpeg` - FFmpeg wrapper für Audio-Dekodierung
- `@ffmpeg-installer/ffmpeg` - FFmpeg binaries
- `ws` - WebSocket server
- `audiobuffer-to-wav` - Audio format conversion
- `pcm-convert` - PCM conversion utilities
- `stream-buffers` - Stream handling

## 🚧 Offene Tasks (Phase 2-6)

### Phase 2: unified-server.js Integration 🔨
**Status:** Vorbereitet, muss ausgeführt werden  
**Datei:** `server/unified-server-patch.txt` enthält alle Änderungen

**Was zu tun ist:**
1. Öffne `unified-server.js`
2. Füge ganz oben hinzu:
   ```javascript
   import { AudioEngine } from './server/AudioEngine.js';
   import { CommandServer } from './server/CommandServer.js';
   import { AudioStreamServer } from './server/AudioStreamServer.js';
   import { createServer } from 'http';
   ```

3. Ersetze die letzte Sektion (ab `const server = app.listen(PORT, '0.0.0.0', () => {`) mit:
   ```javascript
   // Initialize Audio Engine
   console.log('🎛️ Initializing Server-Side Audio Engine...');
   const audioEngine = new AudioEngine();
   
   // Create HTTP server
   const httpServer = createServer(app);
   
   // Initialize servers
   const commandServer = new CommandServer(httpServer, audioEngine);
   const audioStreamServer = new AudioStreamServer(httpServer, audioEngine);
   
   // Cleanup handlers
   process.on('SIGTERM', async () => {
     await audioEngine.cleanup();
     commandServer.cleanup();
     audioStreamServer.cleanup();
     process.exit(0);
   });
   
   process.on('SIGINT', async () => {
     await audioEngine.cleanup();
     commandServer.cleanup();
     audioStreamServer.cleanup();
     process.exit(0);
   });
   
   // Start server
   httpServer.listen(PORT, '0.0.0.0', () => {
     console.log(`🚀 SubCaster Server-Side Audio Engine running on Port ${PORT}`);
     console.log(`   🌐 Web Interface: http://localhost:${PORT}`);
     console.log(`   📡 Command WebSocket: ws://localhost:${PORT}/ws/commands`);
     console.log(`   🔊 Audio Stream: ws://localhost:${PORT}/ws/audio`);
     console.log(`🎯 Target: ${process.env.STREAM_SERVER || 'funkturm.radio-endstation.de'}:${process.env.STREAM_PORT || '8015'}`);
   });
   
   httpServer.on('error', (error) => {
     console.error('❌ Server error:', error);
   });
   ```

4. Teste: `npm run dev`
5. WebSocket Endpoints sollten verfügbar sein:
   - `ws://localhost:5173/ws/commands`
   - `ws://localhost:5173/ws/audio`

### Phase 3: Audio Mixer Implementation 🎛️
**Status:** Noch nicht implementiert  
**Priorität:** HOCH

**Ziel:** Mehrere Audio-Streams mischen (4 Decks + Mikrofon)

**Erstelle:** `server/AudioMixer.js`

**Requirements:**
```javascript
class AudioMixer {
  constructor() {
    this.inputs = new Map(); // deck-id → audio stream
    this.outputStream = new PassThrough();
    this.volumes = new Map(); // deck-id → volume (0-1)
    this.masterVolume = 1.0;
  }
  
  // Add audio input
  addInput(id, audioStream, volume = 1.0) {
    // Mix PCM streams in real-time
  }
  
  // Remove input
  removeInput(id) {}
  
  // Set input volume
  setInputVolume(id, volume) {}
  
  // Set master volume
  setMasterVolume(volume) {}
  
  // Get mixed output stream
  getOutputStream() {
    return this.outputStream;
  }
}
```

**Integration:**
- AudioEngine nutzt Mixer für alle Deck-Streams
- Monitor Audio kommt von Mixer Output
- AzuraCast Stream kommt von Mixer Output

**Libraries zu evaluieren:**
- `pcm-mixer` - PCM audio mixing
- `audio-mixer` - Node.js audio mixer
- Oder: Custom Implementation mit Buffer-Mixing

### Phase 4: AzuraCast Output Integration 📡
**Status:** Noch nicht implementiert  
**Priorität:** HOCH

**Ziel:** Gemischtes Audio zu AzuraCast streamen

**Erstelle:** `server/AzuraCastOutput.js`

**Requirements:**
```javascript
class AzuraCastOutput {
  constructor(config) {
    this.config = config; // { serverUrl, username, password, bitrate }
    this.encoder = null; // Opus encoder
    this.socket = null; // WebSocket to AzuraCast
  }
  
  async connect() {
    // Verbinde zu AzuraCast WebSocket
    // Siehe: src/azuracast.ts (Zeile 150-200) für Referenz
  }
  
  streamAudio(pcmStream) {
    // PCM → Opus → WebSocket
  }
  
  disconnect() {}
}
```

**Integration:**
- Nutze Mixer Output als Input
- Encode zu Opus (128kbps)
- Sende via WebSocket an AzuraCast
- Persistente Verbindung (Auto-Reconnect)

**Referenz:** `src/azuracast.ts` (aktuelle Implementation)

### Phase 5: Microphone Input via WebRTC 🎤
**Status:** Noch nicht implementiert  
**Priorität:** MITTEL

**Problem:** `wrtc` NPM package installation failed (native module)

**Alternative Lösungen:**

**Option A: WebRTC via Browser MediaRecorder**
```javascript
// Browser sendet Opus-encoded Audio via WebSocket
const mediaRecorder = new MediaRecorder(micStream, {
  mimeType: 'audio/webm;codecs=opus'
});

mediaRecorder.ondataavailable = (event) => {
  ws.send(event.data); // Binary Opus data
};
```

**Option B: Raw PCM via WebSocket**
```javascript
// Browser sendet Raw PCM via WebSocket
const audioContext = new AudioContext();
const processor = audioContext.createScriptProcessor(4096, 1, 1);
processor.onaudioprocess = (e) => {
  const pcmData = e.inputBuffer.getChannelData(0);
  ws.send(pcmData); // Float32Array
};
```

**Server-Side:**
```javascript
// MicrophoneInput.js
class MicrophoneInput {
  constructor() {
    this.wss = new WebSocketServer({ path: '/ws/microphone' });
    this.currentStream = null;
  }
  
  handleConnection(ws) {
    ws.on('message', (data) => {
      // Decode Opus or process PCM
      // Feed to Mixer as 'microphone' input
    });
  }
  
  getAudioStream() {
    return this.currentStream;
  }
}
```

**Integration:**
- Erstelle `/ws/microphone` WebSocket endpoint
- Decode Opus oder verarbeite PCM
- Füge zu Mixer als "microphone" Input hinzu
- Erlaube Mikrofoneffekte (Compressor, EQ, Limiter)

### Phase 6: Browser UI Migration 🖥️
**Status:** Noch nicht implementiert  
**Priorität:** MITTEL

**Ziel:** Browser von Audio-Processing zu Remote Control umbauen

**Hauptaufgaben:**

1. **WebSocket Command Client erstellen**
   - Datei: `src/server-client.ts` (neu)
   - Verbindung zu `/ws/commands`
   - Command Sending
   - State Updates empfangen

2. **Audio Code entfernen/deaktivieren**
   - `src/audio/` Module: Behalten für Referenz, aber nicht nutzen
   - `src/main.ts`: Playback-Code durch Commands ersetzen
   - HTMLAudioElement: Nur für Waveform-Display, nicht für Playback

3. **Monitor Audio Player implementieren**
   - Datei: `src/monitor-audio.ts` (neu)
   - Verbindung zu `/ws/audio`
   - PCM → Web Audio API playback
   - Volume control (nur lokal)

4. **State Synchronization**
   - Server-State ist Source of Truth
   - UI zeigt nur Server-State
   - User Actions → Commands → Server

**Code-Beispiel:**
```typescript
// src/server-client.ts
class ServerClient {
  private commandWs: WebSocket;
  private audioWs: WebSocket;
  
  async connect() {
    this.commandWs = new WebSocket('ws://localhost:5173/ws/commands');
    this.audioWs = new WebSocket('ws://localhost:5173/ws/audio');
    
    this.commandWs.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      this.handleServerMessage(msg);
    };
  }
  
  // Send commands
  async loadTrack(deck: DeckSide, song: OpenSubsonicSong) {
    const url = openSubsonicClient.getStreamUrl(song.id);
    this.sendCommand({
      type: 'loadTrack',
      data: {
        deck,
        url,
        metadata: {
          title: song.title,
          artist: song.artist,
          album: song.album,
          duration: song.duration
        }
      }
    });
  }
  
  play(deck: DeckSide) {
    this.sendCommand({ type: 'play', data: { deck } });
  }
  
  pause(deck: DeckSide) {
    this.sendCommand({ type: 'pause', data: { deck } });
  }
  
  // Handle server updates
  private handleServerMessage(msg: any) {
    switch (msg.type) {
      case 'deckStateChange':
        this.updateDeckUI(msg.data);
        break;
      case 'deckPosition':
        this.updatePositionUI(msg.data);
        break;
    }
  }
}
```

### Phase 7: Waveform Generation Server-Side 📊
**Status:** Noch nicht implementiert  
**Priorität:** NIEDRIG

**Ziel:** Server generiert Waveform-Daten, Browser zeigt nur an

**Ansatz:**
- Server dekodiert Track zu PCM
- Berechne Peaks (z.B. 1000 Samples)
- Sende Peaks an Browser via Command WebSocket
- Browser rendert mit WaveSurfer.js oder Custom Canvas

**Library:** `audiowaveform` (C++ tool, kann in Node.js integriert werden)

### Phase 8: Queue Management Server-Side 📝
**Status:** Noch nicht implementiert  
**Priorität:** NIEDRIG

**Ziel:** Queue läuft auf Server, persistent

**Features:**
- Auto-Queue Logic auf Server
- Persistent Queue Storage (JSON file oder DB)
- Multi-DJ Queue sharing
- Browser zeigt nur Queue-State

## 🔧 Entwicklungs-Workflow

### 1. Server starten
```bash
cd /mnt/c/Users/felix/Documents/git/subcaster-server
npm run dev
```

### 2. Testen der WebSocket Endpoints

**Command Server Test:**
```bash
# Install wscat: npm install -g wscat
wscat -c ws://localhost:5173/ws/commands
```

**Audio Stream Test:**
```bash
wscat -c ws://localhost:5173/ws/audio -b
```

### 3. Client-Side Integration testen
```javascript
// Browser Console
const ws = new WebSocket('ws://localhost:5173/ws/commands');
ws.onopen = () => console.log('Connected');
ws.onmessage = (e) => console.log('Message:', JSON.parse(e.data));

// Request control
ws.send(JSON.stringify({ type: 'requestControl' }));

// Load track (need valid OpenSubsonic URL)
ws.send(JSON.stringify({
  type: 'loadTrack',
  data: {
    deck: 'a',
    url: 'https://your-music-server.com/stream/123',
    metadata: { title: 'Test', artist: 'Test', album: 'Test', duration: 180 }
  }
}));

// Play
ws.send(JSON.stringify({ type: 'play', data: { deck: 'a' } }));
```

## 📝 Wichtige Erkenntnisse

### 1. FFmpeg PCM Streaming
- Format: `s16le` (signed 16-bit little-endian)
- Sample Rate: 48000 Hz
- Channels: 2 (Stereo)
- Node.js PassThrough Stream für Piping

### 2. WebSocket Binary Streaming
- `binaryType = 'arraybuffer'` im Client setzen
- Server sendet direkt PCM Buffers
- Conversion zu Float32Array für Web Audio API:
  ```javascript
  const pcm = new Int16Array(arrayBuffer);
  const float = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    float[i] = pcm[i] / 32768.0;
  }
  ```

### 3. Aktuelle Limitationen
- **Kein Audio Mixing:** Nur ein Deck kann spielen (Mixer fehlt)
- **Kein Microphone Input:** WebRTC Integration fehlt
- **Kein AzuraCast Output:** Server streamt noch nicht zu AzuraCast
- **Browser spielt noch lokal:** Migration zu Remote Control fehlt

### 4. Performance Considerations
- FFmpeg Memory Usage: ~50-100MB pro Deck
- WebSocket Bandwidth: ~1.5 Mbps pro Client (48kHz Stereo PCM)
- Kann optimiert werden mit Opus Encoding (128kbps)

## 🔗 Wichtige Dateien & Referenzen

### Server-Side (subcaster-server)
- `server/AudioEngine.js` - Core audio engine
- `server/CommandServer.js` - WebSocket command API
- `server/AudioStreamServer.js` - Monitor audio streaming
- `unified-server.js` - Main server (muss noch integriert werden)
- `SERVER_README.md` - Technische Dokumentation

### Client-Side (Original subcaster - Referenz)
- `src/audio/AudioManager.ts` - Aktuelle Browser Audio-Architektur
- `src/audio/Deck.ts` - Deck-Klasse (Referenz für Server)
- `src/audio/Mixer.ts` - Mixer-Logik (Referenz für Server)
- `src/audio/MicManager.ts` - Mikrofon-Processing (für Server)
- `src/azuracast.ts` - AzuraCast WebSocket Integration (Referenz)
- `src/opensubsonic.ts` - OpenSubsonic Client (für Stream URLs)

### Konfiguration
- `.env` - Environment variables
- `package.json` - Dependencies
- `vite.config.js` - Build config

## 🎓 Nächster Entwickler: Wo anfangen?

### Quick Start:
1. **Repository klonen:**
   ```bash
   git clone https://github.com/Lokke/subcaster-server.git
   cd subcaster-server
   npm install
   ```

2. **unified-server.js integrieren** (siehe Phase 2 oben)

3. **Server testen:**
   ```bash
   npm run dev
   # In Browser Console: WebSocket Test (siehe oben)
   ```

4. **Audio Mixer implementieren** (siehe Phase 3)
   - Erstelle `server/AudioMixer.js`
   - Integriere in AudioEngine
   - Teste mit mehreren Decks gleichzeitig

5. **AzuraCast Output** (siehe Phase 4)
   - Portiere Logic aus `src/azuracast.ts`
   - Verbinde mit Mixer Output

### Bei Fragen/Problemen:
- **FFmpeg Errors:** Prüfe FFmpeg Installation: `ffmpeg -version`
- **WebSocket Connection Failed:** Firewall/Port 5173 blockiert?
- **Audio nicht hörbar:** Browser Console für WebSocket Errors checken
- **Memory Issues:** Begrenze gleichzeitige Decks, optimiere Stream buffering

## 📚 Zusätzliche Ressourcen

### Dokumentation
- [FFmpeg Formats](https://ffmpeg.org/ffmpeg-formats.html)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [fluent-ffmpeg](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg)

### Ähnliche Projekte
- [Icecast](https://icecast.org/) - Streaming server reference
- [Liquidsoap](https://www.liquidsoap.info/) - Audio streaming language
- [WebRTC samples](https://webrtc.github.io/samples/)

---

**Last Updated:** 9. November 2025  
**Version:** 0.1.0 (Alpha)  
**Status:** Phase 1 Complete, Phase 2-8 Pending
