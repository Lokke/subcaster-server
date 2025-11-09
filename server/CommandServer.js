/**
 * CommandServer.js - WebSocket Command API
 * 
 * Handles:
 * - WebSocket connections from browser clients
 * - Command routing to AudioEngine
 * - State broadcasting to all clients
 * - Session management
 */

import { WebSocketServer } from 'ws';

export class CommandServer {
  constructor(httpServer, audioEngine) {
    this.audioEngine = audioEngine;
    this.clients = new Set();
    this.session = {
      activeDJ: null,
      locked: false
    };
    
    // Create WebSocket server
    this.wss = new WebSocketServer({ 
      server: httpServer,
      path: '/ws/commands'
    });
    
    this.setupWebSocketServer();
    this.setupAudioEngineListeners();
    
    console.log('🔌 CommandServer initialized on /ws/commands');
  }

  /**
   * Setup WebSocket server
   */
  setupWebSocketServer() {
    this.wss.on('connection', (ws, req) => {
      const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      console.log(`📱 New client connected: ${clientId}`);
      
      ws.clientId = clientId;
      this.clients.add(ws);
      
      // Send initial state
      this.sendToClient(ws, {
        type: 'welcome',
        clientId,
        state: this.audioEngine.getAllStates(),
        session: this.session
      });
      
      // Handle messages
      ws.on('message', (data) => {
        this.handleMessage(ws, data);
      });
      
      // Handle disconnect
      ws.on('close', () => {
        console.log(`📴 Client disconnected: ${clientId}`);
        this.clients.delete(ws);
        
        // Release DJ lock if this was the active DJ
        if (this.session.activeDJ === clientId) {
          this.session.activeDJ = null;
          this.session.locked = false;
          this.broadcastSession();
        }
      });
      
      // Handle errors
      ws.on('error', (error) => {
        console.error(`❌ WebSocket error for ${clientId}:`, error);
      });
    });
  }

  /**
   * Setup Audio Engine event listeners
   */
  setupAudioEngineListeners() {
    // Broadcast deck state changes
    this.audioEngine.on('deckStateChange', (state) => {
      this.broadcast({
        type: 'deckStateChange',
        data: state
      });
    });
    
    // Broadcast deck position updates
    this.audioEngine.on('deckPosition', (position) => {
      this.broadcast({
        type: 'deckPosition',
        data: position
      });
    });
    
    // Broadcast deck ended
    this.audioEngine.on('deckEnded', (data) => {
      this.broadcast({
        type: 'deckEnded',
        data
      });
    });
  }

  /**
   * Handle incoming message
   */
  async handleMessage(ws, data) {
    try {
      const message = JSON.parse(data.toString());
      console.log(`📨 Command from ${ws.clientId}:`, message.type);
      
      // Check DJ lock for control commands
      const controlCommands = ['loadTrack', 'play', 'pause', 'seek', 'setVolume', 'clear'];
      if (controlCommands.includes(message.type)) {
        if (this.session.locked && this.session.activeDJ !== ws.clientId) {
          this.sendToClient(ws, {
            type: 'error',
            message: 'Session locked by another DJ'
          });
          return;
        }
      }
      
      // Handle commands
      switch (message.type) {
        case 'requestControl':
          this.handleRequestControl(ws);
          break;
          
        case 'releaseControl':
          this.handleReleaseControl(ws);
          break;
          
        case 'loadTrack':
          await this.handleLoadTrack(message.data);
          break;
          
        case 'play':
          this.handlePlay(message.data);
          break;
          
        case 'pause':
          this.handlePause(message.data);
          break;
          
        case 'seek':
          this.handleSeek(message.data);
          break;
          
        case 'setVolume':
          this.handleSetVolume(message.data);
          break;
          
        case 'clear':
          await this.handleClear(message.data);
          break;
          
        case 'getState':
          this.sendToClient(ws, {
            type: 'state',
            data: this.audioEngine.getAllStates()
          });
          break;
          
        default:
          console.warn(`⚠️ Unknown command: ${message.type}`);
      }
      
    } catch (error) {
      console.error('❌ Error handling message:', error);
      this.sendToClient(ws, {
        type: 'error',
        message: error.message
      });
    }
  }

  /**
   * Handle request control
   */
  handleRequestControl(ws) {
    if (this.session.locked && this.session.activeDJ !== ws.clientId) {
      this.sendToClient(ws, {
        type: 'controlDenied',
        message: 'Session locked by another DJ'
      });
      return;
    }
    
    this.session.activeDJ = ws.clientId;
    this.session.locked = true;
    
    console.log(`🎤 DJ control granted to ${ws.clientId}`);
    
    this.sendToClient(ws, {
      type: 'controlGranted'
    });
    
    this.broadcastSession();
  }

  /**
   * Handle release control
   */
  handleReleaseControl(ws) {
    if (this.session.activeDJ === ws.clientId) {
      this.session.activeDJ = null;
      this.session.locked = false;
      
      console.log(`🎤 DJ control released by ${ws.clientId}`);
      
      this.sendToClient(ws, {
        type: 'controlReleased'
      });
      
      this.broadcastSession();
    }
  }

  /**
   * Handle load track
   */
  async handleLoadTrack(data) {
    const { deck, url, metadata } = data;
    await this.audioEngine.loadTrack(deck, url, metadata);
  }

  /**
   * Handle play
   */
  handlePlay(data) {
    const { deck } = data;
    this.audioEngine.playDeck(deck);
  }

  /**
   * Handle pause
   */
  handlePause(data) {
    const { deck } = data;
    this.audioEngine.pauseDeck(deck);
  }

  /**
   * Handle seek
   */
  handleSeek(data) {
    const { deck, time } = data;
    this.audioEngine.seekDeck(deck, time);
  }

  /**
   * Handle set volume
   */
  handleSetVolume(data) {
    const { deck, volume } = data;
    this.audioEngine.setDeckVolume(deck, volume);
  }

  /**
   * Handle clear
   */
  async handleClear(data) {
    const { deck } = data;
    await this.audioEngine.clearDeck(deck);
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
    this.clients.forEach(client => {
      if (client.readyState === 1) { // OPEN
        client.send(data);
      }
    });
  }

  /**
   * Broadcast session info
   */
  broadcastSession() {
    this.broadcast({
      type: 'sessionUpdate',
      session: this.session
    });
  }

  /**
   * Cleanup
   */
  cleanup() {
    console.log('🧹 CommandServer cleanup');
    this.wss.close();
  }
}
