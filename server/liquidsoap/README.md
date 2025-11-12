# Liquidsoap Audio Engine

## Architektur

SubCaster nutzt **Liquidsoap** als professionelle Audio-Engine für DJ-Funktionalität.

### Features

- **4 Decks** (A, B, C, D) - Unabhängige Request Queues
- **Main Queue** - AutoQueue System für automatisches Playback
- **Microphone Input** - Live-Audio via Harbor (Port 8001)
- **Mixing** - Fallback-basiertes Mischen aller Quellen
- **Volume Control** - Individuelle Volume für jede Quelle + Master
- **Telnet Control** - Remote-Steuerung via Telnet (Port 1234)
- **Multi-Output** - WebRTC, Icecast, Monitor

## Installation

```bash
# Liquidsoap installieren (Ubuntu/Debian)
sudo apt-get install liquidsoap

# Oder mit OPAM (neueste Version)
opam install liquidsoap
```

## Starten

```bash
liquidsoap server/liquidsoap/radio.liq
```

## Telnet Control

Verbinde via Telnet für Live-Control:

```bash
telnet localhost 1234
```

### Wichtige Commands

```bash
# Track zu Deck laden
deck.load deck_a /tmp/track.mp3

# Track zu Queue hinzufügen
queue.push /tmp/track.mp3

# Track skippen
deck.skip deck_a

# Volume ändern
var.set deck_a.volume 0.8
var.set master.volume 1.0

# Aktuelle Queues anzeigen
request.queue.queue deck_a
request.queue.queue main_queue

# Queue leeren
queue.clear

# Hilfe
help
```

## Outputs

**RTP Opus Output** - RTP stream (Opus @ 48kHz) zu `127.0.0.1:5004`
  - Für **MediaSoup WebRTC** (Browser-Monitoring für DJs)
  - Für **AzuraCast Streaming** (via FFmpeg Transcoding)

**Monitor Stream** (Optional) - `http://localhost:8002/monitor` (MP3 @ 128kbps)
  - Für lokales Monitoring/Debugging ohne WebRTC

## Streaming-Architektur

### Komplett in Liquidsoap gemischt!

**Liquidsoap** übernimmt das komplette Audio-Mixing:

```
Liquidsoap Inputs:
  ├─ Deck A/B/C/D (Request Queues)
  ├─ Main Queue (AutoQueue)
  └─ Microphones (Harbor Input @ port 8001)

Liquidsoap Mixing:
  → Fallback-Chain (Decks)
  → Add Microphones on top
  → Master Volume Control

Liquidsoap Output:
  └─ RTP Opus (port 5004) - ALLES gemischt!
```

### 1. WebRTC Conference (DJ Monitoring)
```
Liquidsoap → RTP Opus (port 5004) → MediaSoup PlainTransport → WebRTC → Browser
```

MediaSoup empfängt direkt den RTP-Stream von Liquidsoap (Musik + Mikrofone gemischt) und verteilt ihn via WebRTC an alle verbundenen DJs.

### 2. AzuraCast Streaming (Public Broadcast)
```
Liquidsoap → RTP Opus (port 5004) → FFmpeg Receiver → PCM → AzuraCastOutput → AzuraCast
```

LiquidsoapController startet einen FFmpeg-Prozess, der:
- RTP Opus von port 5004 empfängt (Musik + Mikrofone gemischt)
- Zu PCM s16le decodiert
- Als Stream für AzuraCastOutput bereitstellt
- AzuraCastOutput encodiert zu MP3 und streamt zu AzuraCast

### 3. Mikrofon-Integration

Die DJs senden ihre Mikrofone via WebRTC/WebSocket zu MicrophoneServer. Dieser encodiert sie und sendet sie zu Liquidsoap Harbor Input:

```
Browser Mikrofon → WebRTC → MicrophoneServer → FFmpeg → HTTP/Icecast → Liquidsoap Harbor (port 8001)
```

In Liquidsoap werden die Mikrofone dann mit der Musik gemischt:

```liquidsoap
mic = input.harbor("live", port=8001)
radio = add(normalize=false, [mic, radio])
```

Die AzuraCast Server-Konfiguration wird aus `.env` geladen:
```bash
VITE_AZURACAST_SERVERS=https://funkturm.radio-endstation.de,https://radio.krawallradio.com
AZURACAST_DJ_USERNAME=dj_username
AZURACAST_DJ_PASSWORD=dj_password
```

## Inputs

- **Microphone** - Harbor input auf `http://localhost:8001/live`
  - Sende Audio via: `ffmpeg -re -i input.mp3 -f mp3 http://localhost:8001/live`

## Architektur-Flow

```
┌─────────────┐
│ Frontend UI │
└──────┬──────┘
       │ WebSocket Commands
┌──────▼──────────────────┐
│ LiquidsoapController.js │
└──────┬──────────────────┘
       │ Telnet (Port 1234)
┌──────▼──────────────────┐
│   Liquidsoap Process    │
│                         │
│  ┌─────────────────┐   │
│  │ Deck A (Queue)  │   │
│  │ Deck B (Queue)  │   │
│  │ Deck C (Queue)  │───┤
│  │ Deck D (Queue)  │   │    ┌─────────────────┐
│  │ Main Queue      │   │    │ DJ Mikrofone    │
│  └─────────────────┘   │    │ (WebRTC)        │
│           │             │    └────────┬────────┘
│           ▼             │             │
│      ┌─────────┐        │    ┌────────▼────────┐
│      │ Mixing  │◄───────┼────┤ MicrophoneServer│
│      └────┬────┘        │    │ + FFmpeg Encoder│
│           │             │    └─────────────────┘
│           │             │    HTTP/Icecast (port 8001)
│  ┌────────▼────────┐   │
│  │ Microphone Mix  │   │
│  │ (Harbor Input)  │───┤
│  └─────────────────┘   │
└──────┬──────────────────┘
       │ RTP Opus (port 5004)
       │ [Musik + Mikrofone GEMISCHT]
       │
       ├──────────────────────────┐
       │                          │
┌──────▼──────────────────┐  ┌───▼────────────────┐
│ MediaSoup PlainTransport│  │ FFmpeg RTP Receiver│
│  (WebRTC Conference)    │  │ (PCM Decoder)      │
└──────┬──────────────────┘  └───┬────────────────┘
       │ WebRTC                   │ PCM Stream
┌──────▼──────────────────┐  ┌───▼────────────────┐
│    Browser (DJs)        │  │ AzuraCastOutput.js │
│  (Real-time Monitoring) │  │ (FFmpeg Encoding)  │
└─────────────────────────┘  └───┬────────────────┘
                                 │ Icecast Protocol
                            ┌────▼───────────────┐
                            │  AzuraCast Servers │
                            │ (funkturm, etc.)   │
                            └────┬───────────────┘
                                 │ HTTP Stream
                            ┌────▼───────────────┐
                            │    Listeners       │
                            └────────────────────┘
```

**Wichtig:** Liquidsoap macht das **komplette Audio-Mixing**! 
- Musik (4 Decks + Queue)
- Mikrofone (Harbor Input)
→ Alles wird in **einem Stream** gemischt
→ Dieser Stream geht zu MediaSoup UND AzuraCast

## Development

### Debugging

```bash
# Liquidsoap mit Debug-Output starten
liquidsoap --verbose server/liquidsoap/radio.liq

# Log-Level erhöhen
liquidsoap --debug server/liquidsoap/radio.liq
```

### Testing Telnet Commands

```bash
# Einzelner Command
echo "help" | nc localhost 1234

# Track laden testen
echo "deck.load deck_a /tmp/test.mp3" | nc localhost 1234
```

## Erweiterungen

### Crossfading aktivieren

Im Script die auskommentierte Zeile aktivieren:

```liquidsoap
radio = crossfade(
  duration=3.0,
  fade_in=1.5,
  fade_out=1.5,
  radio
)
```

### Audio-Effekte hinzufügen

```liquidsoap
# Beispiel: Kompressor auf Deck A
deck_a = compress(deck_a)

# Beispiel: EQ auf Microphone
mic = filter.iir.eq.high(freq=80.0, mic)  # High-pass
mic = filter.iir.eq.peak(freq=3000.0, q=1.0, gain=3.0, mic)  # Presence boost
```

## Troubleshooting

### "Address already in use"
```bash
# Port 1234 freigeben
sudo lsof -i :1234
kill <PID>
```

### "Cannot open output file"
```bash
# Permissions prüfen
sudo chown $USER /tmp/liquidsoap_output.wav
```

### Keine Audio-Ausgabe
```bash
# Queue-Status prüfen
echo "request.queue.queue deck_a" | nc localhost 1234

# Volume-Levels prüfen
echo "var.get deck_a.volume" | nc localhost 1234
echo "var.get master.volume" | nc localhost 1234
```
