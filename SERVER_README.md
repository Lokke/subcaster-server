# SubCaster Server - Server-Side Audio Engine

Fork of SubCaster with server-side audio processing for persistent DJ sessions.

## Architecture

```
┌─────────────────────────────────────────────┐
│ Browser (Remote Control UI)                 │
│ - UI: Decks, Queue, Waveforms              │
│ - WebSocket Commands → Server               │
│ - WebSocket Audio ← Server (Monitor)        │
│ - WebRTC Microphone → Server                │
└─────────────────────────────────────────────┘
          ↓ Commands       ↑ State/Audio
┌─────────────────────────────────────────────┐
│ Node.js Server (Audio Engine)               │
│                                              │
│ AudioEngine:                                 │
│ ├─ 4x Audio Decks (A/B/C/D)                │
│ ├─ FFmpeg Audio Decoding                    │
│ ├─ Audio Mixing                             │
│ └─ Persistent Playback                      │
│                                              │
│ CommandServer:                               │
│ ├─ WebSocket Command API                    │
│ ├─ Session Management                       │
│ └─ Multi-DJ Lock/Release                    │
│                                              │
│ AudioStreamServer:                           │
│ ├─ Monitor Audio Stream                     │
│ └─ WebSocket PCM Streaming                  │
│                                              │
│ Output:                                      │
│ ├─ AzuraCast Broadcast Stream               │
│ └─ Monitor Stream to Browser                │
└─────────────────────────────────────────────┘
```

## Features

### ✅ Implemented

- **Server-Side Audio Engine**
  - 4 independent audio decks
  - FFmpeg-based audio decoding
  - Real-time audio mixing
  - Persistent playback (browser can be closed)

- **WebSocket Command API**
  - Load tracks from URLs
  - Play/Pause/Seek controls
  - Volume control
  - Real-time state synchronization

- **Session Management**
  - DJ control lock/release
  - Multi-DJ support
  - Session handover

- **Monitor Audio Streaming**
  - WebSocket-based PCM streaming
  - Browser playback of mixed audio
  - Low-latency monitoring

### 🚧 Todo

- [ ] WebRTC Microphone Input (Browser → Server)
- [ ] Audio Mixer (combine decks + mic)
- [ ] AzuraCast Output Integration
- [ ] Waveform generation server-side
- [ ] Queue management server-side
- [ ] Persistent session storage

## Installation

```bash
cd subcaster-server
npm install
```

## Running

```bash
npm run dev
```

Server will start on:
- **Web Interface:** http://localhost:5173
- **Command WebSocket:** ws://localhost:5173/ws/commands
- **Audio Stream:** ws://localhost:5173/ws/audio

## WebSocket Command API

### Connect to Command Server

```javascript
const ws = new WebSocket('ws://localhost:5173/ws/commands');

ws.onopen = () => {
  console.log('Connected to command server');
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Server message:', message);
};
```

### Commands

#### Request DJ Control
```javascript
ws.send(JSON.stringify({
  type: 'requestControl'
}));
```

#### Load Track
```javascript
ws.send(JSON.stringify({
  type: 'loadTrack',
  data: {
    deck: 'a', // 'a', 'b', 'c', or 'd'
    url: 'https://music-server.com/stream/123',
    metadata: {
      title: 'Song Title',
      artist: 'Artist Name',
      album: 'Album Name',
      duration: 180
    }
  }
}));
```

#### Play Deck
```javascript
ws.send(JSON.stringify({
  type: 'play',
  data: { deck: 'a' }
}));
```

#### Pause Deck
```javascript
ws.send(JSON.stringify({
  type: 'pause',
  data: { deck: 'a' }
}));
```

#### Seek
```javascript
ws.send(JSON.stringify({
  type: 'seek',
  data: { 
    deck: 'a',
    time: 45.5 // seconds
  }
}));
```

#### Set Volume
```javascript
ws.send(JSON.stringify({
  type: 'setVolume',
  data: { 
    deck: 'a',
    volume: 0.8 // 0-1
  }
}));
```

#### Clear Deck
```javascript
ws.send(JSON.stringify({
  type: 'clear',
  data: { deck: 'a' }
}));
```

### Server Events

#### State Change
```javascript
{
  type: 'deckStateChange',
  data: {
    deck: 'A',
    state: 'playing', // 'empty', 'loading', 'ready', 'playing', 'paused', 'ended', 'error'
    track: { title, artist, album },
    volume: 0.8,
    position: 45.5,
    duration: 180
  }
}
```

#### Position Update
```javascript
{
  type: 'deckPosition',
  data: {
    deck: 'A',
    position: 45.5
  }
}
```

#### Track Ended
```javascript
{
  type: 'deckEnded',
  data: { deck: 'A' }
}
```

## Monitor Audio Streaming

### Connect to Audio Stream

```javascript
const audioWs = new WebSocket('ws://localhost:5173/ws/audio');
audioWs.binaryType = 'arraybuffer';

let audioContext;
let sourceNode;

audioWs.onmessage = async (event) => {
  if (typeof event.data === 'string') {
    // Audio format message
    const format = JSON.parse(event.data);
    console.log('Audio format:', format);
    
    // Initialize Web Audio API
    audioContext = new AudioContext({ sampleRate: format.sampleRate });
    
  } else {
    // PCM audio data
    const pcmData = new Int16Array(event.data);
    
    // Convert to Float32Array for Web Audio API
    const float32Data = new Float32Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
      float32Data[i] = pcmData[i] / 32768.0;
    }
    
    // Play audio
    playAudioChunk(float32Data, audioContext);
  }
};
```

## Development Roadmap

### Phase 1: Core Audio Engine ✅
- [x] AudioDeck class
- [x] FFmpeg integration
- [x] Basic playback controls
- [x] Volume control
- [x] Position tracking

### Phase 2: Command API ✅
- [x] WebSocket server
- [x] Command routing
- [x] State broadcasting
- [x] Session management

### Phase 3: Monitor Streaming ✅
- [x] Audio streaming server
- [x] WebSocket PCM streaming
- [x] Browser playback

### Phase 4: Audio Mixing 🚧
- [ ] Mix multiple deck streams
- [ ] Master volume control
- [ ] Microphone input mixing
- [ ] Effects processing

### Phase 5: Integration 🚧
- [ ] AzuraCast output
- [ ] OpenSubsonic integration
- [ ] Discord bot integration
- [ ] Queue management

### Phase 6: Browser UI 🚧
- [ ] Remove client-side audio code
- [ ] Implement command sending
- [ ] Real-time state display
- [ ] WebRTC microphone streaming

## License

Same as SubCaster parent project.
