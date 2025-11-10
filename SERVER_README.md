# SubCaster Server - Server-Side Audio Engine

Fork of SubCaster with complete server-side audio processing for persistent DJ sessions with multi-user microphone group calls.

## Architecture

```
┌─────────────────────────────────────────────┐
│ Browser Clients (Multiple Users)            │
│                                              │
│ DJ Control Client:                          │
│ - UI: Decks, Queue, Waveforms              │
│ - WebSocket Commands → Server               │
│ - WebSocket Audio ← Server (Monitor)        │
│                                              │
│ Microphone Clients (Group Call):            │
│ - WebSocket Audio → Server (Mic Input)      │
│ - Mute/Unmute Controls                      │
│ - Participant List                          │
└─────────────────────────────────────────────┘
          ↓ Commands       ↑ Monitor Audio
          ↓ Microphone     
┌─────────────────────────────────────────────┐
│ Node.js Server (Audio Engine)               │
│                                              │
│ AudioEngine:                                 │
│ ├─ 4x Audio Decks (A/B/C/D)                │
│ ├─ FFmpeg Audio Decoding                    │
│ ├─ Individual Deck Mixing                   │
│ └─ Persistent Playback                      │
│                                              │
│ MicrophoneServer:                            │
│ ├─ WebSocket Signaling                      │
│ ├─ Multi-User Microphone Input              │
│ ├─ Group Call Management                    │
│ └─ Per-User Mute/Unmute                     │
│                                              │
│ AudioMixer:                                  │
│ ├─ Mix 4 Decks + Microphones               │
│ ├─ Monitor Output (Decks Only)             │
│ └─ Broadcast Output (Decks + Mics)         │
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
│ AzuraCastOutput:                             │
│ ├─ FFmpeg Encoding (MP3/OGG/Opus)          │
│ ├─ Icecast/SHOUTcast Protocol               │
│ └─ Auto-Reconnect                           │
└─────────────────────────────────────────────┘
          ↓ Broadcast Stream (Decks + Mics)
┌─────────────────────────────────────────────┐
│ AzuraCast / Icecast Server                  │
│ - Receives broadcast stream                 │
│ - Distributes to listeners                  │
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
  - Browser playback of mixed audio (decks only)
  - Low-latency monitoring
  - **No microphone feedback** - users hear decks but not their own voice

- **Multi-User Microphone Group Call**
  - WebSocket-based audio streaming
  - Multiple users can speak simultaneously
  - Per-user mute/unmute
  - Participant list management
  - Real-time participant updates

- **Advanced Audio Mixing**
  - Mix 4 decks with multiple microphones
  - Separate monitor and broadcast streams
  - Master volume and microphone gain controls
  - Anti-clipping protection

- **AzuraCast Output**
  - FFmpeg encoding (MP3/OGG/Opus/AAC)
  - Icecast/SHOUTcast streaming protocol
  - Configurable bitrate and quality
  - Auto-reconnect on connection loss
  - Stream metadata support

## Installation

```bash
cd subcaster-server
npm install
```

## Configuration

Configure the server via environment variables. Create a `.env` file in the project root:

```env
# Server Port
PORT=3002

# AzuraCast/Icecast Streaming
STREAM_SERVER=your-azuracast-server.com
STREAM_PORT=8000
AZURACAST_DJ_PASSWORD=your-dj-password
AZURACAST_MOUNT=/live
STREAM_FORMAT=mp3
VITE_STREAM_BITRATE=128
VITE_STREAM_SAMPLE_RATE=48000
AZURACAST_AUTO_START=true

# AzuraCast API (optional, for metadata)
VITE_AZURACAST_SERVERS=https://your-azuracast-server.com
VITE_AZURACAST_STATION_ID=1
AZURACAST_DJ_USERNAME=dj
AZURACAST_DJ_PASSWORD=password

# OpenSubsonic (for music library)
VITE_OPENSUBSONIC_URL=https://your-music-server.com
OPENSUBSONIC_USERNAME=user
OPENSUBSONIC_PASSWORD=password
```

## Running

```bash
npm run dev
```

Server will start on:
- **Web Interface:** http://localhost:3002
- **Command WebSocket:** ws://localhost:3002/ws/commands
- **Audio Stream:** ws://localhost:3002/ws/audio
- **Microphone:** ws://localhost:3002/ws/microphone

## WebSocket Command API

### Connect to Command Server

```javascript
const ws = new WebSocket('ws://localhost:3002/ws/commands');

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

The monitor stream contains **only deck audio** - no microphone feedback. This allows users to hear what's playing without hearing their own voice.

### Connect to Audio Stream

```javascript
const audioWs = new WebSocket('ws://localhost:3002/ws/audio');
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

## Microphone Group Call

Multiple users can join the stream with their microphones. The microphone audio is mixed into the broadcast stream (to AzuraCast) but **NOT** into the monitor stream, preventing feedback.

### Connect to Microphone Server

```javascript
const micWs = new WebSocket('ws://localhost:3002/ws/microphone');

micWs.onopen = () => {
  console.log('Connected to microphone server');
  
  // Join the group call
  micWs.send(JSON.stringify({
    type: 'join',
    data: { username: 'DJ Mike' }
  }));
};

micWs.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  switch (message.type) {
    case 'welcome':
      console.log('Client ID:', message.clientId);
      break;
      
    case 'joined':
      console.log('Joined group call');
      console.log('Participants:', message.participants);
      break;
      
    case 'participants':
      console.log('Participant list updated:', message.participants);
      break;
  }
};
```

### Send Microphone Audio

```javascript
// Get microphone access
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: 48000
  }
});

// Setup audio processing
const audioContext = new AudioContext({ sampleRate: 48000 });
const source = audioContext.createMediaStreamSource(stream);
const processor = audioContext.createScriptProcessor(4096, 1, 1);

processor.onaudioprocess = (event) => {
  const inputData = event.inputBuffer.getChannelData(0);
  
  // Convert Float32 to Int16 PCM
  const pcmData = new Int16Array(inputData.length);
  for (let i = 0; i < inputData.length; i++) {
    const sample = Math.max(-1, Math.min(1, inputData[i]));
    pcmData[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
  }
  
  // Send to server (binary)
  if (micWs.readyState === WebSocket.OPEN) {
    micWs.send(pcmData.buffer);
  }
};

source.connect(processor);
processor.connect(audioContext.destination);
```

### Mute/Unmute

```javascript
// Mute microphone
micWs.send(JSON.stringify({
  type: 'mute',
  data: { muted: true }
}));

// Unmute microphone
micWs.send(JSON.stringify({
  type: 'mute',
  data: { muted: false }
}));
```

### Leave Group Call

```javascript
micWs.send(JSON.stringify({
  type: 'leave'
}));

micWs.close();
```

## Using the Client Libraries

The project includes ready-to-use TypeScript clients:

### Server Client (Deck Control + Monitor Audio)

```typescript
import { ServerClient } from './serverClient';

const client = new ServerClient();

// Setup callbacks
client.onConnected = () => {
  console.log('Connected to server');
  client.requestControl(); // Request DJ control
};

client.onControlGranted = () => {
  console.log('DJ control granted');
  
  // Load and play a track
  client.loadTrack('a', 'https://music-server.com/stream/123', {
    title: 'Song Title',
    artist: 'Artist Name',
    album: 'Album Name',
    duration: 180
  });
  
  // Play after loading
  setTimeout(() => client.play('a'), 2000);
};

client.onStateChange = (state) => {
  console.log('Deck state changed:', state);
};

// Connect
await client.connect();
```

### Microphone Client (Group Call)

```typescript
import { MicrophoneClient } from './microphoneClient';

const micClient = new MicrophoneClient('DJ Mike');

// Setup callbacks
micClient.onConnected = () => {
  console.log('Joined group call');
  micClient.startMicrophone(); // Start sending audio
};

micClient.onParticipantsChanged = (participants) => {
  console.log('Participants:', participants);
};

// Connect
await micClient.connect();

// Mute/unmute
micClient.setMuted(true);  // Mute
micClient.setMuted(false); // Unmute

// Get available microphones
const mics = await micClient.getMicrophones();
console.log('Available microphones:', mics);

// Switch microphone
await micClient.stopMicrophone();
await micClient.startMicrophone(mics[1].deviceId);
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
- [x] Monitor stream without microphone feedback

### Phase 4: Microphone Group Call ✅
- [x] WebSocket microphone server
- [x] Multi-user audio input
- [x] Per-user mute/unmute
- [x] Participant management
- [x] Browser client library

### Phase 5: Audio Mixing ✅
- [x] Mix multiple deck streams
- [x] Master volume control
- [x] Microphone input mixing
- [x] Separate monitor and broadcast outputs
- [x] Anti-clipping protection

### Phase 6: AzuraCast Integration ✅
- [x] FFmpeg encoding (MP3/OGG/Opus/AAC)
- [x] Icecast/SHOUTcast streaming
- [x] Auto-reconnect
- [x] Stream metadata
- [x] Configurable bitrate and quality

### Phase 7: Browser UI Integration 🚧
- [ ] Integrate ServerClient into main.ts
- [ ] Integrate MicrophoneClient into main.ts
- [ ] Remove client-side audio playback code
- [ ] Add microphone controls to UI
- [ ] Show participant list
- [ ] Add streaming status indicators

### Phase 8: Advanced Features 🚧
- [ ] Server-side waveform generation
- [ ] Persistent session storage
- [ ] Multi-DJ queue management
- [ ] Audio effects (EQ, compressor, limiter)
- [ ] Recording functionality
- [ ] Playlist automation

## License

Same as SubCaster parent project.
