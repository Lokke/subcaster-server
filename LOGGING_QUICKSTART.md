# Logging System - Quick Reference

## 🚀 Setup (einmalig)

1. **`.env` Datei erstellen** (falls noch nicht vorhanden):
   ```bash
   cp .env.example .env
   ```

2. **Logging konfigurieren** in `.env`:
   ```bash
   # Produktiv (nur Warnungen und Fehler)
   VITE_LOG_LEVEL=WARN
   VITE_LOG_CATEGORIES=SYSTEM,ERROR
   
   # Entwicklung (alle Logs)
   VITE_LOG_LEVEL=DEBUG
   VITE_LOG_CATEGORIES=all
   
   # WebRTC Debugging
   VITE_LOG_CATEGORIES=WEBRTC,CONFERENCE,WEBSOCKET
   VITE_LOG_LEVEL_WEBRTC=DEBUG
   ```

3. **Server neu starten** um Änderungen zu übernehmen

## 📝 Verwendung

### In neuen Dateien

```typescript
import { createLogger, LogCategory } from './logger';

const log = createLogger(LogCategory.AUDIO); // Kategorie wählen

// Logs schreiben
log.info('Audio initialized', '🎵');
log.debug('Processing...', '🔧', { detail: 'value' });
log.warn('Buffer underrun', '⚠️');
log.error('Failed to load', '❌', error);
```

### Bestehende Logs konvertieren

**Vorher:**
```typescript
console.log('[WEBRTC-CLIENT] 🎧 Connecting...');
```

**Nachher:**
```typescript
const log = createLogger(LogCategory.WEBRTC);
log.info('Connecting...', '🎧');
```

## 🎯 Verfügbare Kategorien

| Kategorie | Verwendung |
|-----------|------------|
| `SYSTEM` | System-Start, Initialisierung |
| `AUDIO` | Audio-Engine, AudioContext |
| `DECK` | Player-Decks (A, B, C, D) |
| `WEBRTC` | WebRTC-Verbindungen |
| `CONFERENCE` | Conference Audio-Streams |
| `WEBSOCKET` | WebSocket Command-Server |
| `AZURACAST` | AzuraCast Streaming |
| `UI` | UI-Updates, DOM |
| `QUEUE` | Queue-Management |
| `DEBUG` | Allgemeine Debug-Ausgaben |

Vollständige Liste: Siehe `LOGGING_SYSTEM.md`

## 🔧 Häufige Szenarien

### Nur Audio-Logs sehen
```bash
VITE_LOG_CATEGORIES=AUDIO,DECK,MIXER,WAVEFORM
```

### Nur WebRTC Debugging
```bash
VITE_LOG_CATEGORIES=WEBRTC,CONFERENCE
VITE_LOG_LEVEL_WEBRTC=DEBUG
```

### Alles deaktivieren (Produktion)
```bash
VITE_LOG_LEVEL=ERROR
VITE_LOG_CATEGORIES=SYSTEM
```

### Browser Console Filtern

In Chrome DevTools Console:
- `[WEBRTC]` - nur WebRTC-Logs
- `[AUDIO]` - nur Audio-Logs
- `-[VOLUME]` - alles außer Volume-Meter

## 📊 Log Levels

| Level | Wann verwenden |
|-------|----------------|
| `DEBUG` | Detaillierte Entwickler-Informationen |
| `INFO` | Normale Operationen, Status-Updates |
| `WARN` | Probleme, aber kein Fehler |
| `ERROR` | Echte Fehler, die behoben werden müssen |

## 💡 Tipps

- **Performance**: Deaktivierte Logs haben fast keinen Performance-Impact
- **Produktion**: Setze `LOG_LEVEL=WARN` für bessere Performance
- **Debugging**: Aktiviere nur benötigte Kategorien
- **Browser**: Nutze Console-Filter für übersichtlichere Logs

## 📚 Weitere Infos

Siehe `LOGGING_SYSTEM.md` für vollständige Dokumentation.
