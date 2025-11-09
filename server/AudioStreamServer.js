/**
 * AudioStreamServer.js - Monitor Audio Streaming
 * 
 * Streams mixed audio to browser for monitoring
 * Uses WebSocket for simplicity (can be upgraded to WebRTC later)
 */

import { WebSocketServer } from 'ws';

export class AudioStreamServer {
  constructor(httpServer, audioEngine) {
    this.audioEngine = audioEngine;
    this.clients = new Set();
    
    // Create WebSocket server for audio streaming
    this.wss = new WebSocketServer({
      server: httpServer,
      path: '/ws/audio'
    });
    
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
  }

  /**
   * Start audio streaming
   */
  startAudioStreaming() {
    const monitorStream = this.audioEngine.getMonitorStream();
    
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
    
    this.clients.forEach(client => {
      if (client.readyState === 1) { // OPEN
        try {
          client.send(chunk);
        } catch (error) {
          console.error('❌ Error sending audio to client:', error);
        }
      }
    });
  }

  /**
   * Cleanup
   */
  cleanup() {
    console.log('🧹 AudioStreamServer cleanup');
    this.wss.close();
  }
}
