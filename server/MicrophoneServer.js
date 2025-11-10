/**
 * MicrophoneServer.js - WebRTC Microphone Group Call Server
 * 
 * Handles:
 * - WebRTC signaling (SDP offer/answer, ICE candidates)
 * - Multiple browser clients sending microphone audio
 * - Audio stream collection for mixing
 * - Group call management (join/leave/mute)
 */

import { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

export class MicrophoneServer extends EventEmitter {
  constructor(httpServer) {
    super();
    
    this.clients = new Map(); // clientId -> { ws, peerConnection, audioStream, isMuted, username }
    this.audioStreams = new Map(); // clientId -> PassThrough stream
    this.httpServer = httpServer;
    
    // Create WebSocket server for WebRTC signaling
    this.wss = new WebSocketServer({
      noServer: true
    });
    
    console.log('🔌 MicrophoneServer WebSocketServer created (noServer mode)');
    
    // Register upgrade handler with central router
    const handleUpgrade = (request, socket, head) => {
      console.log('✅ MicrophoneServer handling upgrade');
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request);
      });
    };
    
    if (global.wsHandlers) {
      global.wsHandlers.set('/ws/microphone', handleUpgrade);
      console.log('✅ Registered /ws/microphone handler');
    } else {
      console.warn('⚠️ global.wsHandlers not available - fallback to direct handling');
      httpServer.on('upgrade', (request, socket, head) => {
        if (request.url === '/ws/microphone') {
          handleUpgrade(request, socket, head);
        }
      });
    }
    
    this.setupWebSocketServer();
    
    console.log('🎤 MicrophoneServer initialized on /ws/microphone');
  }

  /**
   * Setup WebSocket signaling server
   */
  setupWebSocketServer() {
    this.wss.on('connection', (ws, req) => {
      const clientId = `mic_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      console.log(`🎤 Microphone client connected: ${clientId}`);
      
      ws.clientId = clientId;
      ws.binaryType = 'arraybuffer';
      
      // Send welcome message with client ID
      this.sendToClient(ws, {
        type: 'welcome',
        clientId
      });
      
      // Handle signaling messages
      ws.on('message', (data) => {
        // Check if it's a text message (signaling) or binary (audio data)
        if (data instanceof Buffer) {
          // Binary audio data
          this.handleAudioData(clientId, data);
        } else {
          // Text signaling message
          this.handleSignalingMessage(ws, clientId, data);
        }
      });
      
      // Handle disconnect
      ws.on('close', () => {
        console.log(`🎤 Microphone client disconnected: ${clientId}`);
        this.handleClientDisconnect(clientId);
      });
      
      // Handle errors
      ws.on('error', (error) => {
        console.error(`❌ Microphone WebSocket error for ${clientId}:`, error);
      });
    });

    // Heartbeat support for microphone signaling clients
    this.heartbeatInterval = setInterval(() => {
      for (const [clientId, client] of Array.from(this.clients.entries())) {
        const ws = client.ws;
        try {
          if (!ws.isAlive) {
            console.log(`⏳ Terminating dead mic client: ${clientId}`);
            try { ws.terminate(); } catch (e) {}
            this.handleClientDisconnect(clientId);
            continue;
          }
          ws.isAlive = false;
          ws.ping(() => {});
        } catch (err) {
          console.error('❌ Microphone heartbeat error:', err);
        }
      }
    }, 30000);
  }

  /**
   * Handle WebRTC signaling messages
   */
  async handleSignalingMessage(ws, clientId, data) {
    try {
      const message = JSON.parse(data.toString());
      console.log(`📨 Microphone signaling from ${clientId}:`, message.type);
      
      switch (message.type) {
        case 'join':
          await this.handleJoin(ws, clientId, message.data);
          break;
          
        case 'offer':
          await this.handleOffer(ws, clientId, message.data);
          break;
          
        case 'ice-candidate':
          await this.handleIceCandidate(clientId, message.data);
          break;
          
        case 'mute':
          this.handleMute(clientId, message.data.muted);
          break;
          
        case 'leave':
          this.handleClientDisconnect(clientId);
          break;
          
        default:
          console.warn(`⚠️ Unknown signaling message: ${message.type}`);
      }
      
    } catch (error) {
      console.error('❌ Error handling signaling message:', error);
      this.sendToClient(ws, {
        type: 'error',
        message: error.message
      });
    }
  }

  /**
   * Handle join request
   */
  async handleJoin(ws, clientId, data) {
    const username = data.username || `User ${clientId.substr(-4)}`;
    
    console.log(`🎤 ${username} joining microphone group call`);
    
    // Create audio stream for this client
    const audioStream = new PassThrough();
    
    // Store client info
    this.clients.set(clientId, {
      ws,
      peerConnection: null,
      audioStream,
      isMuted: false,
      username
    });
    
    this.audioStreams.set(clientId, audioStream);
    
    // Notify about new participant
    this.broadcastParticipantList();
    
    // Emit event for audio mixer
    this.emit('participantJoined', {
      clientId,
      username,
      audioStream
    });
    
    // Send ready signal
    this.sendToClient(ws, {
      type: 'joined',
      clientId,
      participants: this.getParticipantList()
    });
  }

  /**
   * Handle WebRTC offer (not used in server-receive mode, but kept for future peer-to-peer)
   * 
   * For microphone input, we use a simpler approach:
   * Browser sends audio via WebSocket as raw PCM data
   */
  async handleOffer(ws, clientId, data) {
    console.log(`📨 Received WebRTC offer from ${clientId}`);
    
    // Note: For simplicity, we'll use WebSocket PCM streaming instead of WebRTC
    // This avoids the complexity of WebRTC peer connections on the server
    // The browser will send raw audio data via WebSocket
    
    this.sendToClient(ws, {
      type: 'answer',
      useWebSocket: true, // Signal client to use WebSocket for audio
      format: {
        sampleRate: 48000,
        channels: 1, // Mono microphone
        bitDepth: 16
      }
    });
  }

  /**
   * Handle ICE candidate (for WebRTC, kept for future use)
   */
  async handleIceCandidate(clientId, data) {
    // Not used in WebSocket mode, but kept for future WebRTC implementation
    console.log(`🧊 ICE candidate from ${clientId} (ignored in WebSocket mode)`);
  }

  /**
   * Handle audio data from client
   */
  handleAudioData(clientId, audioData) {
    const client = this.clients.get(clientId);
    
    if (!client) {
      console.warn(`⚠️ Audio data from unknown client: ${clientId}`);
      return;
    }
    
    if (client.isMuted) {
      return; // Don't process muted audio
    }
    
    // Write audio to client's stream for mixing
    if (client.audioStream) {
      client.audioStream.write(audioData);
    }
  }

  /**
   * Handle mute/unmute
   */
  handleMute(clientId, muted) {
    const client = this.clients.get(clientId);
    
    if (!client) {
      return;
    }
    
    client.isMuted = muted;
    console.log(`🎤 ${client.username} ${muted ? 'muted' : 'unmuted'}`);
    
    this.broadcastParticipantList();
    
    this.emit('participantMuted', {
      clientId,
      username: client.username,
      muted
    });
  }

  /**
   * Handle client disconnect
   */
  handleClientDisconnect(clientId) {
    const client = this.clients.get(clientId);
    
    if (!client) {
      return;
    }
    
    console.log(`🎤 ${client.username} left microphone group call`);
    
    // Cleanup audio stream
    if (client.audioStream) {
      client.audioStream.end();
    }
    
    this.clients.delete(clientId);
    this.audioStreams.delete(clientId);
    
    // Notify about participant leaving
    this.broadcastParticipantList();
    
    this.emit('participantLeft', {
      clientId,
      username: client.username
    });
  }

  /**
   * Get list of participants
   */
  getParticipantList() {
    const participants = [];
    
    this.clients.forEach((client, clientId) => {
      participants.push({
        clientId,
        username: client.username,
        isMuted: client.isMuted
      });
    });
    
    return participants;
  }

  /**
   * Broadcast participant list to all clients
   */
  broadcastParticipantList() {
    const participants = this.getParticipantList();
    
    this.broadcast({
      type: 'participants',
      participants
    });
  }

  /**
   * Get all microphone audio streams for mixing
   */
  getAllAudioStreams() {
    return Array.from(this.audioStreams.values());
  }

  /**
   * Send message to specific client
   */
  sendToClient(ws, message) {
    if (ws.readyState === 1) { // OPEN
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast message to all clients
   */
  broadcast(message) {
    const data = JSON.stringify(message);
    
    // send to snapshot to avoid concurrent mutation
    Array.from(this.clients.values()).forEach((client) => {
      const ws = client.ws;
      if (ws && ws.readyState === 1) {
        try {
          ws.send(data);
        } catch (error) {
          console.error('❌ Error broadcasting to mic client:', error);
          try { ws.terminate(); } catch (e) {}
        }
      }
    });
  }

  /**
   * Cleanup
   */
  cleanup() {
    console.log('🧹 MicrophoneServer cleanup');
    
    // Close all client connections
    this.clients.forEach((client, clientId) => {
      this.handleClientDisconnect(clientId);
    });
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.wss.close();
  }
}
