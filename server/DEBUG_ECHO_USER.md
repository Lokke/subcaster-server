# Debug Echo User

Ein Server-seitiger Test-Teilnehmer für die MediaSoup WebRTC-Konferenz, der eingehende Mikrofon-Audio zurückspiegelt.

## Zweck

Der Echo User dient zum Testen von:
- Mikrofon-Eingängen von DJs
- WebRTC-Verbindungen
- MediaSoup Consumer/Producer Setup
- Audio-Latenz und Qualität

## Aktivierung

### In .env:
```bash
DEBUG_ECHO_USER=true
```

### Manuell im Code:
```javascript
import { createEchoUser } from './server/debug-echo-user.js';

const echoUser = await createEchoUser(mediaSoupServer);
```

## Funktionsweise

1. **Beitritt zur Konferenz**: Der Echo User tritt automatisch der MediaSoup-Konferenz bei
2. **Audio Consumption**: Konsumiert Audio von allen Teilnehmern (DJs mit aktiviertem Mikrofon)
3. **Statistiken**: Loggt alle 5 Sekunden Statistiken über empfangenes Audio
4. **Echo (geplant)**: Zukünftig wird das Audio zurückgesendet

## Logs

Der Echo User gibt folgende Logs aus:

```
🔊 [ECHO-USER] Debug echo user created
🔊 [ECHO-USER] Joining conference...
🔊 [ECHO-USER] ✅ Transport created
🔊 [ECHO-USER] ✅ Joined conference, ready to echo
🔊 [ECHO-USER] 🎤 New producer from client_xxx
🔊 [ECHO-USER] ✅ Consuming audio from client_xxx
🔊 [ECHO-USER] 📊 Stats: {...}
```

## API

### DebugEchoUser Class

#### Constructor
```javascript
const echoUser = new DebugEchoUser(mediaSoupServer);
```

#### Methods

**join()**: Beitritt zur Konferenz
```javascript
await echoUser.join();
```

**leave()**: Verlassen der Konferenz
```javascript
await echoUser.leave();
```

**getStats()**: Audio-Statistiken abrufen
```javascript
const stats = await echoUser.getStats();
// Returns: { active, consumersCount, consumers: [...] }
```

**getStatus()**: Aktueller Status
```javascript
const status = echoUser.getStatus();
// Returns: { userId, active, transportId, consumersCount, participants }
```

#### Events

**audioReceived**: Wird gefeuert wenn Audio empfangen wird
```javascript
echoUser.on('audioReceived', ({ participantId, consumer, producer }) => {
  console.log(`Audio from ${participantId}`);
});
```

## Architektur

```
DJ Browser                    Echo User                MediaSoup Server
    |                            |                           |
    |--- Mic Audio (WebRTC) --->|                           |
    |                            |                           |
    |                            |--- consume(producer) ---->|
    |                            |<-- Consumer --------------|
    |                            |                           |
    |                            |--- RTP packets ---------->|
    |                            |<-- RTP packets -----------|
    |                            |                           |
    |<--- Echo Audio (planned) --|                           |
```

## Zukünftige Erweiterungen

- [ ] Echo-Back Implementierung (Audio zurücksenden)
- [ ] Latenz-Messung
- [ ] Audio-Buffer Analyse
- [ ] Frequenz-Spektrum Anzeige
- [ ] Automatische Qualitätstests
- [ ] WebUI für Echo User Statistiken

## Debugging

Aktiviere detaillierte Logs:
```javascript
echoUser.on('audioReceived', async ({ participantId, consumer }) => {
  const stats = await consumer.getStats();
  console.log('Detailed stats:', stats);
});
```

## Cleanup

Der Echo User wird automatisch beim Server-Shutdown sauber beendet:
- Alle Consumer werden geschlossen
- Transport wird freigegeben
- Event Listener werden entfernt
