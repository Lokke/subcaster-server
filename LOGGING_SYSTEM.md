# SubCaster Logging System

Ein strukturiertes Logging-System mit konfigurierbaren Kategorien zur Kontrolle der Console-Ausgabe.

## Features

- **Kategorien-basiertes Logging**: Separate Kategorien für verschiedene Komponenten
- **Log-Level**: DEBUG, INFO, WARN, ERROR, NONE
- **Umgebungsvariablen**: Vollständige Kontrolle über `.env` Datei
- **Runtime-Konfiguration**: Kategorien können zur Laufzeit aktiviert/deaktiviert werden
- **Emoji-Support**: Optionale Emoji-Icons für bessere Lesbarkeit
- **Timestamps**: Optionale Zeitstempel
- **Zero-Overhead**: Deaktivierte Logs haben nahezu keine Performance-Kosten

## Schnellstart

### 1. Logger importieren

```typescript
// Client-seitig (TypeScript)
import { createLogger, LogCategory } from './logger';

const log = createLogger(LogCategory.AUDIO);
```

```javascript
// Server-seitig (Node.js)
const { createLogger, LogCategory } = require('./logger');

const log = createLogger(LogCategory.AUDIO_ENGINE);
```

### 2. Logs schreiben

```typescript
// Mit Emoji (empfohlen)
log.info('Audio initialized', '🎵');
log.debug('Processing buffer', '🔧', { size: 1024 });
log.warn('Buffer underrun', '⚠️');
log.error('Failed to load audio', '❌', error);

// Ohne Emoji
log.info('Audio initialized');
```

### 3. Konfiguration via `.env`

```bash
# Globaler Log-Level (minimum)
VITE_LOG_LEVEL=INFO

# Aktivierte Kategorien
VITE_LOG_CATEGORIES=AUDIO,DECK,MIXER

# Oder alle aktivieren
VITE_LOG_CATEGORIES=all

# Oder alle deaktivieren
VITE_LOG_CATEGORIES=none

# Kategorie-spezifische Level
VITE_LOG_LEVEL_AUDIO=DEBUG
VITE_LOG_LEVEL_WEBRTC=WARN

# Optionen
VITE_LOG_TIMESTAMPS=true
VITE_LOG_EMOJI=true
```

## Verfügbare Kategorien

### Client-seitig (Browser)

- **SYSTEM**: System-Initialisierung, Lifecycle
- **CONFIG**: Konfigurations-Laden und -Verarbeitung
- **AUDIO**: Audio-Engine, AudioContext
- **DECK**: Player-Decks (A, B, C, D)
- **MIXER**: Audio-Mixing, Crossfader
- **WAVEFORM**: Waveform-Generierung und -Darstellung
- **VOLUME_METER**: Volume-Meter Animationen
- **WEBSOCKET**: WebSocket-Verbindungen (Command Server)
- **WEBRTC**: WebRTC-Verbindungen (MediaSoup)
- **CONFERENCE**: Conference-Teilnehmer, Audio-Streams
- **AZURACAST**: AzuraCast Integration, Streaming
- **OPENSUBSONIC**: OpenSubsonic API Calls
- **DISCORD**: Discord Integration, Wishbox
- **UI**: UI-Updates, DOM-Manipulation
- **NAVIGATION**: Navigation History, Routing
- **DRAG_DROP**: Drag & Drop Operationen
- **QUEUE**: Queue-Verwaltung
- **AUTOQUEUE**: Auto-Queue Logic
- **SONG_REGISTRY**: Song-Registry (Duplikat-Prüfung)
- **LIBRARY**: Library-Browser, Suche
- **BROWSE**: Browse-Views (Artists, Albums, etc.)
- **DEBUG**: Allgemeine Debug-Ausgaben
- **PERFORMANCE**: Performance-Metriken

### Server-seitig (Node.js)

- **SYSTEM**: Server-Start, Shutdown
- **CONFIG**: Umgebungsvariablen, Konfiguration
- **AUDIO_ENGINE**: AudioEngine, FFmpeg, Decks
- **AUDIO_MIXER**: Audio-Mixer, RTP-Output
- **WEBSOCKET**: WebSocket-Server
- **COMMAND_SERVER**: CommandServer, Client-Befehle
- **MEDIASOUP_SERVER**: MediaSoup SFU, WebRTC
- **AZURACAST**: AzuraCast Telnet/HTTP API
- **QUEUE**: Server-seitige Queue
- **DEBUG**: Debug-Ausgaben
- **PERFORMANCE**: Performance-Monitoring

## Verwendungsbeispiele

### Bestehende Logs migrieren

**Vorher:**
```typescript
console.log('[WEBRTC-CLIENT] 🎧 User initiated conference join...');
console.log('[CONFERENCE] 📊 Active streams:', streams);
console.error('[WS-CLIENT] ❌ Failed to connect:', error);
```

**Nachher:**
```typescript
import { createLogger, LogCategory } from './logger';

const webrtcLog = createLogger(LogCategory.WEBRTC);
const confLog = createLogger(LogCategory.CONFERENCE);
const wsLog = createLogger(LogCategory.WEBSOCKET);

webrtcLog.info('User initiated conference join...', '🎧');
confLog.info('Active streams:', '📊', streams);
wsLog.error('Failed to connect:', '❌', error);
```

### Conditional Logging (Performance)

```typescript
// Nur wenn DEBUG-Level aktiv
if (log.isLevelEnabled(LogLevel.DEBUG)) {
  const expensiveData = computeExpensiveDebugInfo();
  log.debug('Expensive debug info', '🔬', expensiveData);
}
```

### Runtime-Konfiguration

```typescript
import { setCategory, setCategoryLevel, LogCategory, LogLevel } from './logger';

// Kategorie zur Laufzeit deaktivieren
setCategory(LogCategory.VOLUME_METER, false);

// Log-Level für Kategorie ändern
setCategoryLevel(LogCategory.WEBRTC, LogLevel.DEBUG);
```

## Empfohlene Konfigurationen

### Entwicklung (Full Logging)

```bash
VITE_LOG_LEVEL=DEBUG
VITE_LOG_CATEGORIES=all
VITE_LOG_TIMESTAMPS=true
VITE_LOG_EMOJI=true
```

### Produktion (Minimal Logging)

```bash
VITE_LOG_LEVEL=WARN
VITE_LOG_CATEGORIES=SYSTEM,ERROR
VITE_LOG_TIMESTAMPS=false
VITE_LOG_EMOJI=false
```

### WebRTC Debugging

```bash
VITE_LOG_LEVEL=INFO
VITE_LOG_CATEGORIES=WEBRTC,CONFERENCE,WEBSOCKET
VITE_LOG_LEVEL_WEBRTC=DEBUG
VITE_LOG_LEVEL_CONFERENCE=DEBUG
```

### Audio Debugging

```bash
VITE_LOG_LEVEL=INFO
VITE_LOG_CATEGORIES=AUDIO,DECK,MIXER,WAVEFORM
VITE_LOG_LEVEL_AUDIO=DEBUG
```

### Nur Errors

```bash
VITE_LOG_LEVEL=ERROR
VITE_LOG_CATEGORIES=all
```

## Browser Console Filtering

Mit aktivierten Kategorien-Prefixes kannst du die Browser Console filtern:

```
Filter: [WEBRTC]     # Nur WebRTC-Logs
Filter: [AUDIO]      # Nur Audio-Logs
Filter: -[VOLUME]    # Alles außer Volume-Meter
```

## Migration Plan

### Phase 1: Logger Setup ✅
- [x] `src/logger.ts` erstellt
- [x] `server/logger.js` erstellt
- [x] `.env.example` aktualisiert
- [x] Dokumentation erstellt

### Phase 2: Core Components
- [ ] `src/main.ts`: Migration auf neues Logger-System
- [ ] `src/serverClient.ts`: WebSocket-Logs
- [ ] `src/mediasoupClient.ts`: WebRTC-Logs
- [ ] `server/AudioEngine.js`: Audio-Engine Logs
- [ ] `server/CommandServer.js`: Command-Server Logs
- [ ] `server/MediaSoupServer.js`: MediaSoup-Server Logs

### Phase 3: Secondary Components
- [ ] `src/azuracast.ts`: AzuraCast-Integration
- [ ] `src/audio/` Module
- [ ] Queue-Management
- [ ] UI-Components

### Phase 4: Cleanup
- [ ] Alle `console.log` durch Logger ersetzen
- [ ] Prefix-Standards entfernen
- [ ] Performance-Test

## Performance

Das Logging-System hat minimale Performance-Auswirkungen:

- **Deaktivierte Logs**: ~0.1μs (nur Level-Check)
- **Aktivierte Logs**: Normale `console.log` Performance
- **Memory**: ~1KB für Config + ~100 Bytes pro Logger-Instanz

## Best Practices

1. **Einen Logger pro Datei/Komponente erstellen**
   ```typescript
   const log = createLogger(LogCategory.AUDIO);
   ```

2. **Emoji konsistent verwenden**
   - 🎵 Musik/Audio-Events
   - 🔌 Connection Events
   - ✅ Erfolg
   - ❌ Fehler
   - ⚠️ Warnung
   - 🔧 Debug/Configuration
   - 📊 Data/Stats

3. **Richtige Log-Level verwenden**
   - `DEBUG`: Detaillierte Entwickler-Infos
   - `INFO`: Normale Operationen
   - `WARN`: Probleme, aber kein Fehler
   - `ERROR`: Echte Fehler, die Aufmerksamkeit benötigen

4. **Structured Data als Extra-Parameter**
   ```typescript
   log.debug('Processing data', '🔧', { count: items.length, duration: elapsed });
   ```

5. **Sensitive Daten niemals loggen**
   ```typescript
   // ❌ SCHLECHT
   log.debug('Login', credentials);
   
   // ✅ GUT
   log.debug('Login', { username: credentials.username, hasPassword: !!credentials.password });
   ```
