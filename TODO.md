# SubCaster Server - TODO List

**Projekt:** Server-basierte DJ-Applikation mit persistenter Audio-Verarbeitung  
**Stand:** 9. November 2025

---

## 🔥 KRITISCH - Sofort erledigen

### [ ] 1. unified-server.js Integration
**Priorität:** CRITICAL  
**Geschätzte Zeit:** 15 Minuten  
**Dateien:** `unified-server.js`

**Schritte:**
1. Backup ist bereits erstellt: `unified-server.js.original`
2. Öffne `unified-server.js`
3. Füge Imports ganz oben hinzu:
   ```javascript
   import { AudioEngine } from './server/AudioEngine.js';
   import { CommandServer } from './server/CommandServer.js';
   import { AudioStreamServer } from './server/AudioStreamServer.js';
   import { createServer } from 'http';
   ```
4. Ersetze die letzte Sektion (ca. Zeile 290+) wie in `server/unified-server-patch.txt` beschrieben
5. Teste: `npm run dev`
6. Prüfe WebSocket Endpoints:
   - `ws://localhost:5173/ws/commands`
   - `ws://localhost:5173/ws/audio`

**Erfolgskriterium:** Server startet ohne Fehler, WebSocket Endpoints antworten

---

## 🎯 HOCH - Phase 2 (Basis-Funktionalität)

### [ ] 2. Audio Mixer Implementation
**Priorität:** HIGH  
**Geschätzte Zeit:** 4-6 Stunden  
**Dateien:** `server/AudioMixer.js` (neu), `server/AudioEngine.js` (modifizieren)

**Ziel:** Mehrere PCM Audio-Streams in Echtzeit mischen

**Anforderungen:**
- Mix von 4 Deck-Streams + 1 Mikrofon-Stream
- Individuelle Volume Controls pro Stream
- Master Volume Control
- Sample-genaue Synchronisation
- Latenz < 50ms

**Technischer Ansatz:**
```javascript
// Pseudo-Code
class AudioMixer {
  constructor() {
    this.inputs = new Map(); // id → { stream, volume, active }
    this.outputStream = new PassThrough();
    this.sampleRate = 48000;
    this.channels = 2;
    this.bufferSize = 4096;
  }
  
  addInput(id, stream, volume = 1.0) {
    // Subscribe to stream chunks
    stream.on('data', (chunk) => {
      this.mixChunk(id, chunk);
    });
  }
  
  mixChunk(id, chunk) {
    // Convert Buffer to Int16Array
    const samples = new Int16Array(chunk.buffer);
    
    // Mix with existing buffer (additive mixing)
    for (let i = 0; i < samples.length; i++) {
      this.mixBuffer[i] += samples[i] * this.volumes.get(id);
    }
    
    // Clamp to prevent clipping
    // Write to output stream
  }
}
```

**Libraries evaluieren:**
- `pcm-mixer` - https://www.npmjs.com/package/pcm-mixer
- `audio-mixer` - https://www.npmjs.com/package/audio-mixer
- Custom Implementation (bevorzugt für volle Kontrolle)

**Integration:**
1. Erstelle `server/AudioMixer.js`
2. In `AudioEngine.js`: Erstelle Mixer-Instanz
3. Verbinde alle Deck-Streams mit Mixer
4. Leite Mixer-Output an:
   - AudioStreamServer (Monitor Audio)
   - AzuraCastOutput (später)

**Testing:**
- Lade 2 Tracks in Deck A und B
- Spiele beide gleichzeitig
- Prüfe: Beide Tracks hörbar im Monitor Audio
- Teste Volume Controls (Deck A lauter/leiser)
- Teste Master Volume

**Erfolgskriterium:** 4 Decks können gleichzeitig spielen, individuell gemischt

---

### [ ] 3. AzuraCast Output Integration
**Priorität:** HIGH  
**Geschätzte Zeit:** 3-4 Stunden  
**Dateien:** `server/AzuraCastOutput.js` (neu)

**Ziel:** Gemischtes Audio zu AzuraCast streamen

**Referenz:** `src/azuracast.ts` (Lines 150-250) - aktuelle Browser-Implementation

**Anforderungen:**
- Verbindung zu AzuraCast WebSocket
- PCM → Opus Encoding (128 kbps)
- Persistent Connection mit Auto-Reconnect
- Livestream Metadata Updates

**Technischer Ansatz:**
```javascript
import { OpusEncoder } from '@discordjs/opus';
import WebSocket from 'ws';

class AzuraCastOutput {
  constructor(config) {
    this.serverUrl = config.serverUrl;
    this.username = config.username;
    this.password = config.password;
    this.bitrate = config.bitrate || 128;
    
    this.encoder = new OpusEncoder(48000, 2); // 48kHz stereo
    this.socket = null;
  }
  
  async connect() {
    // WebSocket zu: wss://server/api/live/dj/1
    // Basic Auth Header
  }
  
  streamAudio(pcmStream) {
    pcmStream.on('data', (chunk) => {
      const encoded = this.encoder.encode(chunk);
      if (this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(encoded);
      }
    });
  }
}
```

**Dependencies installieren:**
```bash
npm install @discordjs/opus
```

**Integration:**
1. Erstelle `server/AzuraCastOutput.js`
2. In `unified-server.js`: Initialisiere AzuraCastOutput
3. Verbinde Mixer-Output mit AzuraCast
4. Environment Variables:
   - `STREAM_SERVER` (bereits vorhanden)
   - `STREAM_PORT` (bereits vorhanden)
   - `STREAM_USERNAME`
   - `STREAM_PASSWORD`
   - `STREAM_BITRATE` (bereits vorhanden)

**Testing:**
- Starte Server
- Spiele Track
- Prüfe AzuraCast Admin: Stream aktiv?
- Höre Stream auf AzuraCast Radio

**Erfolgskriterium:** Audio wird live zu AzuraCast gestreamt, hörbar im Radio-Stream

---

## 🎤 MITTEL - Phase 3 (Mikrofon)

### [ ] 4. Microphone Input via WebSocket
**Priorität:** MEDIUM  
**Geschätzte Zeit:** 4-5 Stunden  
**Dateien:** `server/MicrophoneInput.js` (neu), `src/microphone-sender.ts` (neu)

**Problem:** Native WebRTC (`wrtc` npm package) failed to install

**Lösung:** WebSocket-basiertes Microphone Streaming

**Browser-Side (src/microphone-sender.ts):**
```typescript
class MicrophoneSender {
  private ws: WebSocket;
  private mediaRecorder: MediaRecorder;
  
  async start() {
    // Get microphone
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Option A: Send Opus-encoded
    this.mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus',
      audioBitsPerSecond: 128000
    });
    
    this.mediaRecorder.ondataavailable = (event) => {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(event.data); // Binary Opus
      }
    };
    
    // Connect to server
    this.ws = new WebSocket('ws://localhost:5173/ws/microphone');
    this.mediaRecorder.start(100); // 100ms chunks
  }
}
```

**Server-Side (server/MicrophoneInput.js):**
```javascript
import { OpusDecoder } from '@discordjs/opus';
import { WebSocketServer } from 'ws';

class MicrophoneInput {
  constructor(httpServer) {
    this.wss = new WebSocketServer({ 
      server: httpServer,
      path: '/ws/microphone'
    });
    
    this.decoder = new OpusDecoder(48000, 2);
    this.outputStream = new PassThrough();
    
    this.wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        // Decode Opus → PCM
        const pcm = this.decoder.decode(data);
        this.outputStream.write(pcm);
      });
    });
  }
  
  getAudioStream() {
    return this.outputStream;
  }
}
```

**Integration:**
1. Erstelle `server/MicrophoneInput.js`
2. Erstelle `src/microphone-sender.ts`
3. In `unified-server.js`: Init MicrophoneInput
4. In `AudioMixer.js`: Füge Microphone als Input hinzu
5. UI: Microphone On/Off Button

**Testing:**
- Klicke "Microphone On" in Browser
- Sprich ins Mikrofon
- Prüfe: Audio im Monitor Stream hörbar
- Prüfe: Audio im AzuraCast Stream hörbar

**Erfolgskriterium:** Mikrofon-Audio wird zum Server gestreamt und gemischt

---

### [ ] 5. Microphone Effects Chain
**Priorität:** MEDIUM  
**Geschätzte Zeit:** 3-4 Stunden  
**Dateien:** `server/MicrophoneProcessor.js` (neu)

**Ziel:** Server-Side Mikrofon-Effekte (Compressor, EQ, Limiter)

**Referenz:** `src/audio/MicManager.ts` - aktuelle Browser-Implementation

**Effekte portieren:**
1. High-Pass Filter (80 Hz)
2. Pre-Amp (Gain Control)
3. Compressor (Threshold, Ratio, Attack, Release)
4. 4-Band Parametric EQ
5. Limiter (-1 dB)

**Libraries:**
- `audio-graph` - Audio processing graph
- `web-audio-api` (Node.js port) - Falls möglich
- Custom DSP implementation

**Alternative:** FFmpeg Audio Filters
```javascript
ffmpeg(micInputStream)
  .audioFilters([
    'highpass=f=80',
    'volume=2.0', // Pre-amp
    'acompressor=threshold=-20dB:ratio=4:attack=5:release=50',
    'equalizer=f=100:width_type=q:width=1:g=3', // Bass
    'alimiter=level_in=1:level_out=0.9:limit=-1dB'
  ])
  .format('s16le')
  .pipe(outputStream);
```

**Erfolgskriterium:** Mikrofon hat professionelle Audio-Verarbeitung wie im Browser

---

## 🖥️ MITTEL - Phase 4 (Browser UI)

### [ ] 6. Browser Remote Control Client
**Priorität:** MEDIUM  
**Geschätzte Zeit:** 6-8 Stunden  
**Dateien:** `src/server-client.ts` (neu), `src/main.ts` (modifizieren)

**Ziel:** Browser als Remote Control (kein lokales Audio-Processing)

**Schritte:**

#### 6.1 WebSocket Client erstellen
**Datei:** `src/server-client.ts`
```typescript
export class ServerClient {
  private commandWs: WebSocket;
  private reconnectInterval: number = 5000;
  
  async connect() {
    this.commandWs = new WebSocket('ws://localhost:5173/ws/commands');
    
    this.commandWs.onopen = () => {
      console.log('🔗 Connected to server');
      this.requestControl(); // Auto-request DJ control
    };
    
    this.commandWs.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      this.handleMessage(msg);
    };
    
    this.commandWs.onclose = () => {
      console.log('❌ Disconnected from server');
      setTimeout(() => this.connect(), this.reconnectInterval);
    };
  }
  
  // Command methods
  async loadTrack(deck: DeckSide, song: OpenSubsonicSong) { }
  play(deck: DeckSide) { }
  pause(deck: DeckSide) { }
  seek(deck: DeckSide, position: number) { }
  setVolume(deck: DeckSide, volume: number) { }
  
  // State handlers
  private handleMessage(msg: any) {
    switch (msg.type) {
      case 'deckStateChange':
        this.updateDeckState(msg.data);
        break;
      case 'deckPosition':
        this.updateDeckPosition(msg.data);
        break;
    }
  }
}
```

#### 6.2 main.ts umbauen
**Dateien:** `src/main.ts`

**Änderungen:**
```typescript
// ALT:
// audioManager.loadTrack('left', song);

// NEU:
serverClient.loadTrack('left', song);

// ALT:
// audioManager.play('left');

// NEU:
serverClient.play('left');
```

**Strategie:**
- Erstelle `ServerClient` Singleton
- Ersetze alle `audioManager.*` Calls mit `serverClient.*`
- Behalte `audioManager` Code für Fallback/lokalen Modus

#### 6.3 State Synchronization
**Ziel:** UI zeigt Server-State

**Ansatz:**
- Server sendet `deckStateChange` bei jeder Änderung
- Browser-UI updated basierend auf Events
- Keine lokale State-Verwaltung mehr

**UI Updates:**
- Deck State (empty/loading/ready/playing/paused)
- Position/Duration Anzeige
- Waveform Position Marker
- Volume Slider Sync

#### 6.4 Monitor Audio Player
**Datei:** `src/monitor-audio.ts` (neu)
```typescript
export class MonitorAudioPlayer {
  private audioWs: WebSocket;
  private audioContext: AudioContext;
  private sourceNode: AudioBufferSourceNode;
  
  async connect() {
    this.audioWs = new WebSocket('ws://localhost:5173/ws/audio');
    this.audioWs.binaryType = 'arraybuffer';
    
    this.audioContext = new AudioContext();
    
    this.audioWs.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.playPCM(event.data);
      }
    };
  }
  
  private playPCM(arrayBuffer: ArrayBuffer) {
    const pcm = new Int16Array(arrayBuffer);
    const float = new Float32Array(pcm.length);
    
    // Convert PCM to Float32
    for (let i = 0; i < pcm.length; i++) {
      float[i] = pcm[i] / 32768.0;
    }
    
    // Play via Web Audio API
    const audioBuffer = this.audioContext.createBuffer(2, float.length / 2, 48000);
    audioBuffer.getChannelData(0).set(float.filter((_, i) => i % 2 === 0));
    audioBuffer.getChannelData(1).set(float.filter((_, i) => i % 2 === 1));
    
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);
    source.start();
  }
}
```

**UI Integration:**
- "Monitor Audio: On/Off" Toggle
- Volume Slider (nur lokal, Server-Mix unverändert)

**Erfolgskriterium:** Browser steuert Server, Audio läuft auf Server, Monitor Audio funktioniert

---

## 📊 NIEDRIG - Phase 5 (Optimierungen)

### [ ] 7. Waveform Server-Side Generation
**Priorität:** LOW  
**Geschätzte Zeit:** 4-5 Stunden

**Ziel:** Server generiert Waveform-Daten, Browser zeigt nur an

**Vorteile:**
- Keine doppelte Audio-Dekodierung (Browser + Server)
- Konsistente Waveforms für alle Clients
- Reduzierte Browser-Last

**Ansatz:**
```javascript
// server/WaveformGenerator.js
class WaveformGenerator {
  async generate(audioUrl, samples = 1000) {
    // Decode audio mit FFmpeg
    // Extrahiere Peak-Werte
    // Return: { peaks: Float32Array, duration: number }
  }
}
```

**Integration:**
- Bei `loadTrack`: Server generiert Waveform
- Sende Waveform-Daten via Command WebSocket
- Browser rendert mit empfangenen Daten

**Library:** `audiowaveform` oder Custom FFmpeg Pipeline

---

### [ ] 8. Queue Management Server-Side
**Priorität:** LOW  
**Geschätzte Zeit:** 3-4 Stunden

**Ziel:** Queue läuft auf Server, persistent über Browser-Sessions

**Features:**
- Persistent Queue Storage (JSON file)
- Auto-Queue Logic auf Server
- Multi-Client Queue Synchronization
- History/Played Tracks

**Dateien:**
- `server/QueueManager.js`
- `data/queue.json` (persistence)

---

### [ ] 9. Performance Optimierungen
**Priorität:** LOW  
**Geschätzte Zeit:** 2-3 Stunden

**Maßnahmen:**
- **Monitor Audio Encoding:** PCM → Opus (reduziert Bandwidth von ~1.5 Mbps auf ~128 kbps)
- **FFmpeg Memory Optimization:** Begrenze Buffer-Größen
- **Stream Buffering:** Adjustable Buffer Size basierend auf Netzwerk-Latenz
- **Connection Pooling:** Reuse FFmpeg Processes wenn möglich

---

## 🐛 BUGS & FIXES

### [ ] 10. Error Handling verbessern
**Priorität:** MEDIUM  
**Geschätzte Zeit:** 2 Stunden

**Bereiche:**
- FFmpeg Process Crashes
- WebSocket Disconnect Handling
- Track Load Failures (404, Timeout)
- Audio Stream Errors

**Strategie:**
- Try-Catch um alle async Operations
- Graceful Degradation
- User-Feedback via UI
- Automatic Retry mit Exponential Backoff

---

### [ ] 11. Memory Leaks fixen
**Priorität:** MEDIUM  
**Geschätzte Zeit:** 2-3 Stunden

**Potentielle Probleme:**
- FFmpeg Processes nicht richtig beendet
- WebSocket Connections nicht cleaned up
- Stream Listeners nicht removed
- Audio Buffers nicht freigegeben

**Tools:**
- Node.js `--inspect` mit Chrome DevTools
- `process.memoryUsage()` Monitoring
- Heap Snapshots vergleichen

---

## 🧪 TESTING

### [ ] 12. Integration Tests
**Priorität:** MEDIUM  
**Geschätzte Zeit:** 4-5 Stunden

**Test-Szenarien:**
- Multi-Deck Playback gleichzeitig
- Deck-Wechsel während Playback
- WebSocket Reconnect
- Server Restart (Client Reconnect)
- Mehrere Browser-Clients gleichzeitig
- DJ Control Handover

**Framework:** Jest oder Mocha

---

### [ ] 13. Load Testing
**Priorität:** LOW  
**Geschätzte Zeit:** 2-3 Stunden

**Ziele:**
- Max. gleichzeitige Clients
- Server CPU/Memory Usage unter Last
- Audio Quality bei High Load

**Tools:** Artillery oder k6

---

## 📚 DOKUMENTATION

### [✅] 14. PROJECT_STATUS.md ✅
**Status:** DONE  
Vollständige Projekt-Übersicht und Roadmap erstellt.

---

### [✅] 15. TODO.md ✅
**Status:** DONE  
Diese Datei - detaillierte Task-Liste.

---

### [ ] 16. API Documentation
**Priorität:** LOW  
**Geschätzte Zeit:** 2-3 Stunden

**Erstelle:** `API.md`

**Inhalt:**
- WebSocket Command Protocol (vollständig)
- Audio Stream Protocol
- Microphone Input Protocol
- Error Codes & Messages
- Code Examples in JavaScript & TypeScript

---

### [ ] 17. Deployment Guide
**Priorität:** LOW  
**Geschätzte Zeit:** 2 Stunden

**Erstelle:** `DEPLOYMENT.md`

**Inhalt:**
- Production Build
- Environment Variables
- Docker Setup (optional)
- Reverse Proxy (nginx)
- SSL/TLS Configuration
- Process Manager (PM2)

---

## 🔄 WORKFLOW

### Empfohlene Reihenfolge:
1. ✅ unified-server.js Integration (CRITICAL)
2. ✅ Audio Mixer Implementation (HIGH)
3. ✅ AzuraCast Output (HIGH)
4. ✅ Testing: Multi-Deck + AzuraCast Stream
5. ⏸️ Microphone Input (MEDIUM)
6. ⏸️ Browser Remote Control (MEDIUM)
7. ⏸️ Microphone Effects (MEDIUM)
8. ⏸️ Error Handling (MEDIUM)
9. ⏸️ Performance Optimizations (LOW)
10. ⏸️ Waveform Generation (LOW)

### Checkpoints:
- **Checkpoint 1:** Server mit 4 Decks spielbar, Audio gemischt ✅
- **Checkpoint 2:** Audio streamt zu AzuraCast ✅
- **Checkpoint 3:** Mikrofon funktioniert ⏳
- **Checkpoint 4:** Browser als Remote Control komplett ⏳
- **Checkpoint 5:** Production-Ready ⏳

---

## 📞 Support & Fragen

**Bei Problemen:**
1. Check `PROJECT_STATUS.md` für technische Details
2. Check `SERVER_README.md` für API-Referenz
3. Review Original Code in `src/audio/` für Referenz
4. FFmpeg Docs: https://ffmpeg.org/documentation.html

**Git Workflow:**
```bash
git add .
git commit -m "feat: [describe feature]"
git push
```

---

**Letzte Aktualisierung:** 9. November 2025  
**Nächster Task:** #1 unified-server.js Integration
