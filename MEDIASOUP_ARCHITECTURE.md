# MediaSoup WebRTC Architecture

## Topology: SFU (Selective Forwarding Unit)

```
┌─────────────────────────────────────────────────────────────┐
│                    MediaSoup Server (SFU)                   │
│                         Port 3002/ws                        │
│                     Ports 40000-49999/udp                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Server Music Producer (PlainTransport)                     │
│     AudioEngine → FFmpeg → Opus 320kbps → RTP               │
│     │                                                       │
│     └──► Router ──► Distributed to ALL Browser Clients      │
│                                                             │
│  Browser A (WebRTCTransport)                                │
│     Microphone → WebRTC → Router → Distributed to ALL       │
│                                                             │
│  Browser B (WebRTCTransport)                                │
│     Microphone → WebRTC → Router → Distributed to ALL       │
│                                                             │
│  Mixer (for AzuraCast)                                      │
│     Music + (Optional: User Mics) → AzuraCast Stream        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
         ▲                    ▲                    ▲
         │                    │                    │
    WebRTC (Opus)        WebRTC (Opus)       WebRTC (Opus)
         │                    │                    │
         ▼                    ▼                    ▼
    ┌─────────┐          ┌─────────┐          ┌─────────┐
    │Browser A│          │Browser B│          │Browser C│
    │  User 1 │          │  User 2 │          │  User 3 │
    └─────────┘          └─────────┘          └─────────┘
```

## Data Flow

### All clients connect to server only (no peer-to-peer connections)

**Server Music Distribution:**
```
AudioEngine → MediaSoup → Browser A
                        → Browser B  
                        → Browser C
```

**User Microphone Distribution (Browser A):**
```
Browser A → MediaSoup → Browser B
                      → Browser C
                      → (Optional) AzuraCast
```

**User Microphone Distribution (Browser B):**
```
Browser B → MediaSoup → Browser A
                      → Browser C
                      → (Optional) AzuraCast
```

## Architecture Comparison

### SFU (Current Implementation)
- Server routes packets without modification
- Each browser sends once to server (not to each peer)
- Server forwards to all consumers
- Bandwidth efficiency: Upload 1x, Download Nx

### Mesh P2P (Not Used)
- Direct browser-to-browser connections
- With 10 users: 45 connections required
- Browser A must send microphone 9 times
- Poor scalability

### MCU (Not Used)
- Server mixes all streams into one
- High server CPU load for encoding/decoding
- No individual volume controls
- Single stream output per client

## Bandwidth Usage

**Configuration: 10 users (1 Music + 9 Microphones)**

| Architecture | Browser Upload | Browser Download | Server Load |
|-------------|----------------|------------------|-------------|
| SFU (current) | 128 kbps | 3.2 Mbps | Routing only |
| Mesh P2P | 1.15 Mbps | 1.15 Mbps | None |
| MCU | 128 kbps | 320 kbps | Encode/Decode |

## SFU Advantages

**Scalability:**
- Server routes packets only
- No encoding/decoding overhead
- Supports 2-100 participants efficiently

**Low Latency:**
- No re-encoding delays
- Direct packet forwarding
- Typical latency: 50-100ms

**Flexibility:**
- Individual volume controls per client
- Selective audio routing
- Client-side mixing

**Bandwidth Efficiency:**
- Browser sends once to server
- Server distributes to all consumers
- Optimal for conference scenarios

## Implementation Details

### Server-Side Components

**MediaSoupServer.js:**
```javascript
// Create consumer for each client to receive server music
const consumer = await participant.recvTransport.consume({
    producerId: this.musicProducer.id,
    rtpCapabilities: participant.rtpCapabilities,
    paused: false
});

// Create consumer for each client to receive all other users
for (const [peerId, peer] of this.participants) {
    if (peerId === clientId || !peer.producer) continue;
    
    const consumer = await participant.recvTransport.consume({
        producerId: peer.producer.id,
        rtpCapabilities: participant.rtpCapabilities,
        paused: false
    });
}
```

### Client-Side Components

**mediasoupClient.ts:**
```typescript
// Connect to MediaSoup server
this.ws = new WebSocket('ws://localhost:3002/ws/mediasoup');

// Create receive transport for incoming streams
this.recvTransport = this.device.createRecvTransport({
    id: data.transportId,
    iceParameters: data.iceParameters,
    iceCandidates: data.iceCandidates,
    dtlsParameters: data.dtlsParameters
});

// Create send transport for microphone
this.sendTransport = this.device.createSendTransport({
    id: data.transportId,
    iceParameters: data.iceParameters,
    iceCandidates: data.iceCandidates,
    dtlsParameters: data.dtlsParameters
});
```

## Network Topology

**Star Architecture:**
```
        Browser A ←────┐
                       │
        Browser B ←─── Server (SFU) ───→ AzuraCast
                       │
        Browser C ←────┘
```

### Connection Types

**WebRTC Transports:**
- Each client has 2 transports: recv (download) and send (upload)
- ICE/DTLS negotiation via WebSocket signaling
- RTP/RTCP media packets via UDP (ports 40000-49999)

**Server Music Transport:**
- PlainTransport for RTP input from AudioEngine
- No ICE/DTLS (local loopback connection)
- FFmpeg encodes PCM to Opus 320kbps stereo

## Audio Codecs

**Opus Configuration:**
```javascript
{
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
    parameters: {
        useinbandfec: 1,
        maxplaybackrate: 48000,
        maxaveragebitrate: 320000,  // Server Music: 320 kbps
        stereo: 1,
        'sprop-stereo': 1
    }
}
```

**User Microphones:**
- Mono audio
- 128 kbps average bitrate
- Echo cancellation enabled
- Noise suppression enabled
- Auto gain control enabled

## Performance Characteristics

**Latency:**
- Server routing: <5ms
- Network propagation: 20-50ms
- Client-side decoding: 10-30ms
- Total end-to-end: 50-100ms

**Scalability:**
- Tested: 10 simultaneous users
- Theoretical: 100+ users
- Bottleneck: Server network bandwidth (not CPU)

**Resource Usage:**
- Server CPU: <5% per user (routing only)
- Server RAM: ~50MB per user
- Client bandwidth: 128 kbps upload, N×320 kbps download

## Security

**WebRTC Security:**
- DTLS encryption for media streams
- SRTP for RTP packet encryption
- No plaintext audio transmission

**Authentication:**
- WebSocket connection via authenticated session
- Transport connection restricted to session owner
- Producer/Consumer permissions enforced server-side

## Configuration

**MediaSoup Worker:**
```javascript
{
    logLevel: 'warn',
    logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
    rtcMinPort: 40000,
    rtcMaxPort: 49999
}
```

**Router Capabilities:**
```javascript
{
    mediaCodecs: [
        {
            kind: 'audio',
            mimeType: 'audio/opus',
            clockRate: 48000,
            channels: 2,
            parameters: {
                useinbandfec: 1,
                maxplaybackrate: 48000,
                maxaveragebitrate: 320000,
                stereo: 1,
                'sprop-stereo': 1
            }
        }
    ]
}
```

## Monitoring

**Server Logs:**
```
Client connected: client_1234567890
Creating recv transport for client_1234567890
Creating send transport for client_1234567890
Client microphone enabled: client_1234567890
Subscribed client to server music
Subscribed client to all participants
```

**Client Logs:**
```
Connected to MediaSoup server
Device loaded with RTP capabilities
Transport created (recv)
Transport created (send)
Consuming: Server Music (Music)
Consuming: User client_xxx (Voice)
```

## Troubleshooting

**Connection Issues:**
- Verify UDP ports 40000-49999 are open
- Check WebSocket connection on port 3002
- Ensure no firewall blocking RTP traffic

**Audio Quality Issues:**
- Monitor network bandwidth availability
- Check packet loss via RTCP reports
- Verify Opus bitrate configuration

**Latency Issues:**
- Measure RTT between client and server
- Check server CPU load (should be <10%)
- Verify no network congestion

## References

- MediaSoup Documentation: https://mediasoup.org/
- WebRTC Specification: https://www.w3.org/TR/webrtc/
- Opus Codec: https://opus-codec.org/
- SFU Architecture: https://webrtcglossary.com/sfu/
