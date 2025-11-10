# MediaSoup WebRTC Conference Integration

## 🎯 Übersicht

SubCaster nutzt jetzt **MediaSoup** für hochqualitative Audio-Konferenzen mit **Opus 320kbps**.

### Architektur

```
┌─────────────────────────────────────────────────────────────┐
│                    MediaSoup SFU Server                      │
│                     (Port 3004 WebSocket)                    │
│                     (Ports 40000-49999 RTP)                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  🎵 Server Music Stream                                      │
│     AudioEngine → FFmpeg → Opus RTP → PlainTransport        │
│     → Alle Browser Clients (320kbps Stereo)                 │
│                                                              │
│  👤 User Microphones                                         │
│     Browser → WebRTC → MediaSoup Router → Alle User         │
│                                                              │
│  📡 AzuraCast Output                                         │
│     Music + (User Mics mit Mic-Button) → AzuraCast Stream   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## 🔧 Installation

```bash
# MediaSoup benötigt Build-Tools
sudo apt install -y python3 python3-pip build-essential

# MediaSoup installieren (dauert ~5-10 Minuten, kompiliert C++)
npm install mediasoup mediasoup-client
```

## 🚀 Features

### Opus 320kbps Qualität
- **Server Music**: Stereo 320kbps → Alle Hörer
- **User Voices**: Mono 128kbps → Untereinander hörbar
- **Gesamtbandbreite**: ~450kbps (statt 1.5Mbps bei PCM WebSocket)

### Mic-Button Logik
- **Aus** (Default): User hören sich gegenseitig, NICHT in AzuraCast
- **An**: User-Mikrofon wird zusätzlich in AzuraCast-Stream übertragen
- Wichtig: Nutzer hören sich **immer** untereinander (unabhängig vom Button)

### Volume Controls
```typescript
const client = new MediaSoupClient();

// Musik leiser (0.0 - 1.0)
client.setMusicVolume(0.7);

// Stimmen lauter
client.setVoicesVolume(1.2);

// Master Volume
client.setMasterVolume(0.9);
```

## 📡 Server Integration

### MediaSoupServer starten

```javascript
const MediaSoupServer = require('./server/MediaSoupServer');
const AudioEngine = require('./server/AudioEngine');

const audioEngine = new AudioEngine();
const mediaSoupServer = new MediaSoupServer(audioEngine);

await mediaSoupServer.initialize();

// Server gibt RTP-Port für AudioEngine zurück
mediaSoupServer.on('audioEngineConnected', ({ ip, port }) => {
    console.log(`📡 Send audio to: rtp://${ip}:${port}`);
    
    // AudioEngine muss jetzt RTP statt WebSocket senden
    audioEngine.setOutputRTP(ip, port);
});
```

### AudioEngine → RTP Output

Bisheriger Flow:
```
AudioEngine → PCM Stream → WebSocket → Browser
```

Neuer Flow:
```
AudioEngine → FFmpeg → Opus RTP → MediaSoup PlainTransport → Browser
```

FFmpeg Command:
```bash
ffmpeg -f s16le -ar 48000 -ac 2 -i pipe:0 \
       -c:a libopus -b:a 320k -application audio \
       -f rtp rtp://127.0.0.1:<mediasoup_port>
```

## 🌐 Client Integration

### In main.ts einbinden

```typescript
import { MediaSoupClient } from './mediasoupClient';

let mediaSoupClient: MediaSoupClient | null = null;

// Server Audio initialisieren
async function initializeServerAudio() {
    // Alte WebSocket-Verbindung entfernen
    // if (serverClient) { ... }
    
    // Neue MediaSoup-Verbindung
    mediaSoupClient = new MediaSoupClient('ws://localhost:3004');
    await mediaSoupClient.connect();
    
    console.log('✅ MediaSoup conference joined');
}

// Mikrofon aktivieren
async function enableMicrophone() {
    if (mediaSoupClient) {
        await mediaSoupClient.enableMicrophone();
    }
}

// Mic-Button für AzuraCast
function toggleAzuraCastMic(active: boolean) {
    if (mediaSoupClient) {
        mediaSoupClient.setMicButtonActive(active);
    }
}
```

### UI Controls hinzufügen

```html
<!-- Volume Sliders -->
<div class="volume-controls">
    <label>Music Volume</label>
    <input type="range" id="musicVolume" min="0" max="100" value="100">
    
    <label>Voices Volume</label>
    <input type="range" id="voicesVolume" min="0" max="100" value="100">
</div>

<!-- Mic Button -->
<button id="azuracastMicBtn" class="mic-button">
    📡 Send to AzuraCast
</button>
```

```typescript
document.getElementById('musicVolume')?.addEventListener('input', (e) => {
    const vol = (e.target as HTMLInputElement).value;
    mediaSoupClient?.setMusicVolume(Number(vol) / 100);
});

document.getElementById('voicesVolume')?.addEventListener('input', (e) => {
    const vol = (e.target as HTMLInputElement).value;
    mediaSoupClient?.setVoicesVolume(Number(vol) / 100);
});

document.getElementById('azuracastMicBtn')?.addEventListener('click', () => {
    const active = !mediaSoupClient?.micButtonActive;
    mediaSoupClient?.setMicButtonActive(active);
    // Update button style
});
```

## 🔧 Migration von WebSocket zu MediaSoup

### Server-Änderungen

1. **AudioStreamServer.js**: Ersetzen durch MediaSoup RTP output
2. **CommandServer.js**: Bleibt für deck control
3. **MicrophoneServer.js**: Entfernen (MediaSoup übernimmt)

### Client-Änderungen

1. **serverClient.ts**: Nur noch für Commands nutzen
2. **mediasoupClient.ts**: Neu für Audio
3. **microphoneClient.ts**: Entfernen

### Compatibility

Während Migration:
- WebSocket Commands bleiben aktiv
- Audio läuft über MediaSoup
- Alte Clients funktionieren weiter (bis Migration komplett)

## 📊 Performance

### Bandbreite

| Stream Type | Old (WebSocket) | New (MediaSoup) | Savings |
|-------------|----------------|-----------------|---------|
| Server Music | 1.5 Mbps PCM | 320 kbps Opus | 78% |
| User Voice (each) | - | 128 kbps Opus | - |
| **Total (3 users)** | **4.5 Mbps** | **~700 kbps** | **85%** |

### Latenz

- **WebSocket PCM**: ~200ms (Buffering + Network)
- **MediaSoup Opus**: ~50-100ms (WebRTC optimiert)

### Qualität

- **Opus 320kbps**: Indistinguishable from uncompressed
- **Echo Cancellation**: Browser-native (WebRTC)
- **Noise Suppression**: Browser-native

## 🐛 Troubleshooting

### MediaSoup kompiliert nicht

```bash
# Dependencies installieren
sudo apt install -y python3 python3-pip build-essential

# Neuversuch
rm -rf node_modules package-lock.json
npm install
```

### RTP Ports blockiert

```bash
# Firewall-Ports öffnen
sudo ufw allow 40000:49999/udp

# Oder in docker-compose.yml:
ports:
  - "3004:3004"  # WebSocket
  - "40000-49999:40000-49999/udp"  # RTP
```

### Audio kommt nicht an

1. Check MediaSoup logs: `console.log` in `MediaSoupServer.js`
2. Check Browser Console: DevTools → Network → WS
3. Check RTP: `tcpdump -i lo port <rtp_port>`

### Kein Echo Cancellation

```typescript
// Ensure getUserMedia uses proper constraints
const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
        echoCancellation: true,  // ← Important!
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48000
    }
});
```

## 🔐 Security

### Production Setup

```javascript
// Use SSL for WebSocket
const mediaSoupClient = new MediaSoupClient('wss://your-domain.com:3004');

// Firewall: Only allow RTP from known IPs
// iptables -A INPUT -p udp --dport 40000:49999 -s <allowed_ip> -j ACCEPT
```

### Authentication

```javascript
// Add token to WebSocket connection
mediaSoupClient.connect(authToken);

// Server validates token before joining
if (!validateToken(authToken)) {
    ws.close(4001, 'Unauthorized');
}
```

## 📝 TODO

- [ ] AudioEngine RTP output implementieren
- [ ] Server-side Audio Mixing für AzuraCast (Music + Active User Mics)
- [ ] UI Controls für Volume Sliders
- [ ] Mic Button UI + State Management
- [ ] Migration: WebSocket Commands behalten, Audio migrieren
- [ ] Testing mit mehreren Usern
- [ ] Docker-Integration (Ports exponieren)
- [ ] Production SSL/HTTPS Setup

## 📚 Resources

- [MediaSoup Documentation](https://mediasoup.org/)
- [Opus Codec](https://opus-codec.org/)
- [WebRTC Samples](https://webrtc.github.io/samples/)
