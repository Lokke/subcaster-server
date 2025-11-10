# SubCaster Server - Schnellstart-Anleitung

## 🚀 In 5 Minuten zum Laufen bringen

### 1. Installation

```bash
cd subcaster-server
npm install
```

### 2. Konfiguration

Erstelle eine `.env` Datei:

```bash
cp .env.example .env
```

Fülle mindestens diese Werte aus:

```env
PORT=3002

# Dein AzuraCast/Icecast Server
STREAM_SERVER=dein-server.com
STREAM_PORT=8000
AZURACAST_DJ_PASSWORD=dein-passwort
AZURACAST_MOUNT=/live

# Deine Musikbibliothek
VITE_OPENSUBSONIC_URL=https://deine-musik.com
OPENSUBSONIC_USERNAME=user
OPENSUBSONIC_PASSWORD=password
```

### 3. Starten

```bash
npm run dev
```

### 4. Browser öffnen

Öffne `http://localhost:3002`

## ✅ Was funktioniert jetzt?

### 🎛️ Deck-Kontrolle (4 Decks)
- Musik laden von deiner Bibliothek
- Play/Pause/Seek
- Volume-Kontrolle
- Läuft serverseitig weiter (auch ohne Browser)

### 🎤 Mikrofon (Multi-User Group Call)
- Mehrere Nutzer können gleichzeitig sprechen
- Jeder kann sein Mikrofon mute/unmute
- Teilnehmerliste in Echtzeit

### 🔊 Monitor Audio
- Hörst die Decks im Browser
- **KEIN Mikrofon-Feedback** (hörst dich selbst nicht)
- Niedrige Latenz

### 📡 AzuraCast Streaming
- Automatisches Streaming zu Icecast
- Enthält Decks + alle Mikrofone
- Auto-Reconnect bei Verbindungsabbruch

## 🎯 Typische Nutzung

### Als DJ

1. **Browser öffnen:** `http://localhost:3002`
2. **DJ Control anfordern:** Button klicken
3. **Tracks laden:** Aus Bibliothek auf Decks ziehen
4. **Abspielen:** Play-Button drücken
5. **Mikrofon aktivieren:** Mikrofon-Button klicken

### Als Co-Host

1. **Browser öffnen:** `http://localhost:3002`
2. **Mikrofon aktivieren:** Mikrofon-Button klicken
3. **In Stream sprechen:** Los gehts!
4. **Mute wenn nötig:** Mute-Button

### Zuhören

Hörer können über AzuraCast/Icecast den Stream empfangen:
- `http://dein-server.com:8000/live`

## 🔧 Entwicklung

### Server Code ändern

```bash
# Server-Komponenten in server/
server/AudioEngine.js
server/AudioMixer.js
server/MicrophoneServer.js
server/CommandServer.js
server/AudioStreamServer.js
server/AzuraCastOutput.js
```

### Client Code ändern

```bash
# Browser-Komponenten in src/
src/serverClient.ts
src/microphoneClient.ts
src/main.ts
```

### Logs anschauen

```bash
npm run dev
```

Alle Komponenten loggen ausführlich:
- 🎵 AudioEngine
- 🎤 MicrophoneServer
- 🎛️ AudioMixer
- 🔌 CommandServer
- 🔊 AudioStreamServer
- 📡 AzuraCastOutput

## 🐛 Probleme?

### Server startet nicht
```bash
# Port bereits belegt?
lsof -i :3002
kill -9 <PID>
```

### Keine Verbindung zu AzuraCast
```bash
# .env Werte prüfen
cat .env | grep STREAM

# Server-Logs checken
# Suche nach "AzuraCast" in der Konsole
```

### Mikrofon funktioniert nicht
```bash
# Browser-Konsole öffnen (F12)
# Mikrofon-Berechtigung erteilen
# WebSocket Connection prüfen
```

### Monitor Audio knistert
```bash
# Samplerate in .env anpassen
VITE_STREAM_SAMPLE_RATE=48000
```

## 📚 Weitere Dokumentation

- **SERVER_README.md** - Vollständige API-Dokumentation
- **SERVER_IMPLEMENTATION.md** - Implementierungs-Details
- **README.md** - Allgemeine Projekt-Dokumentation

## 🎉 Viel Erfolg!

Bei Fragen oder Problemen:
1. Logs checken
2. Browser Console checken
3. Dokumentation lesen
4. GitHub Issues erstellen

Happy Streaming! 🚀🎵
