/**
 * AudioStreamServer.js - Monitor Audio Streaming
 * 
 * Streams mixed audio to browser for monitoring
 * Uses WebSocket for simplicity (can be upgraded to WebRTC later)
 */

import { WebSocketServer } from 'ws';

export class AudioStreamServer {
  constructor(httpServer, audioMixer) {
    this.audioMixer = audioMixer;
    this.clients = new Set();
    this.httpServer = httpServer;
    
    // Create WebSocket server for audio streaming
    this.wss = new WebSocketServer({
      noServer: true
    });
    
    console.log('🔌 AudioStreamServer WebSocketServer created (noServer mode)');
    
    // Register upgrade handler with central router
    const handleUpgrade = (request, socket, head) => {
      console.log('✅ AudioStreamServer handling upgrade');
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request);
      });
    };
    
    if (global.wsHandlers) {
      global.wsHandlers.set('/ws/audio', handleUpgrade);
      console.log('✅ Registered /ws/audio handler');
    } else {
      console.warn('⚠️ global.wsHandlers not available - fallback to direct handling');
      httpServer.on('upgrade', (request, socket, head) => {
        if (request.url === '/ws/audio') {
          handleUpgrade(request, socket, head);
        }
      });
    }
    
    this.setupWebSocketServer();
    this.startAudioStreaming();
    
    console.log('🔊 AudioStreamServer initialized on /ws/audio');
  }

  /**
   * Setup WebSocket server
   */
  setupWebSocketServer() {
    this.wss.on('connection', (ws, req) => {
      const clientId = `audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      console.log(`🎧 Audio client connected: ${clientId}`);
      
      ws.clientId = clientId;
      ws.binaryType = 'arraybuffer';
      this.clients.add(ws);
      
      // Send audio format info
      ws.send(JSON.stringify({
        type: 'audioFormat',
        sampleRate: 48000,
        channels: 2,
        bitDepth: 16
      }));
      
      // Handle disconnect
      ws.on('close', () => {
        console.log(`🎧 Audio client disconnected: ${clientId}`);
        this.clients.delete(ws);
      });
      
      // Handle errors
      ws.on('error', (error) => {
        console.error(`❌ Audio WebSocket error for ${clientId}:`, error);
      });
    });
    
    // Heartbeat support for audio clients
    this.heartbeatInterval = setInterval(() => {
      for (const ws of Array.from(this.clients)) {
        try {
          if (!ws.isAlive) {
            console.log(`⏳ Terminating dead audio client: ${ws.clientId}`);
            try { ws.terminate(); } catch (e) {}
            this.clients.delete(ws);
            continue;
          }
          ws.isAlive = false;
          ws.ping(() => {});
        } catch (err) {
          console.error('❌ Audio heartbeat error:', err);
        }
      }
    }, 30000);
  }

  /**
   * Start audio streaming
   */
  startAudioStreaming() {
    const monitorStream = this.audioMixer.getMonitorStream();
    
    if (!monitorStream) {
      console.warn('⚠️ No monitor stream available');
      return;
    }
    
    // Read PCM data and send to clients
    monitorStream.on('data', (chunk) => {
      this.broadcastAudio(chunk);
    });
    
    monitorStream.on('error', (error) => {
      console.error('❌ Monitor stream error:', error);
    });
    
    console.log('🎵 Audio streaming started');
  }

  /**
   * Broadcast audio chunk to all clients
   */
  broadcastAudio(chunk) {
    if (this.clients.size === 0) return;
    // Send to snapshot to avoid mutation while iterating
    Array.from(this.clients).forEach(client => {
      if (client.readyState === 1) { // OPEN
        try {
          client.send(chunk);
        } catch (error) {
          console.error(`❌ Error sending audio to ${client.clientId}:`, error);
          try { client.terminate(); } catch (e) {}
          this.clients.delete(client);
        }
      } else {
        this.clients.delete(client);
      }
    });
  }

  /**
   * Cleanup
   */
  cleanup() {
    console.log('🧹 AudioStreamServer cleanup');
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.wss.close();
  }
}
