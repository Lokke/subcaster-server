// Server-Side Audio Engine Integration
import { AudioEngine } from './server/AudioEngine.js';
import { CommandServer } from './server/CommandServer.js';
import { AudioStreamServer } from './server/AudioStreamServer.js';
import { createServer } from 'http';

// Initialize Audio Engine
console.log('🎛️ Initializing Server-Side Audio Engine...');
const audioEngine = new AudioEngine();

// Create HTTP server (for WebSocket upgrade)
const httpServer = createServer(app);

// Initialize Command Server (WebSocket for control)
const commandServer = new CommandServer(httpServer, audioEngine);

// Initialize Audio Stream Server (WebSocket for monitor audio)
const audioStreamServer = new AudioStreamServer(httpServer, audioEngine);

// Cleanup on exit
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received, cleaning up...');
  await audioEngine.cleanup();
  commandServer.cleanup();
  audioStreamServer.cleanup();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 SIGINT received, cleaning up...');
  await audioEngine.cleanup();
  commandServer.cleanup();
  audioStreamServer.cleanup();
  process.exit(0);
});

// Use httpServer instead of app.listen
httpServer.listen(PORT, () => {
  console.log(`🚀 SubCaster Server-Side Audio Engine running on port ${PORT}`);
  console.log(`   📡 Command WebSocket: ws://localhost:${PORT}/ws/commands`);
  console.log(`   🔊 Audio Stream: ws://localhost:${PORT}/ws/audio`);
  console.log(`   🌐 Web Interface: http://localhost:${PORT}`);
});
