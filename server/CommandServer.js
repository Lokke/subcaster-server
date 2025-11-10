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
import { QueueManager } from './QueueManager.js';

export class CommandServer {
  constructor(httpServer, audioEngine) {
    this.audioEngine = audioEngine;
    this.clients = new Set();
    this.session = {
      activeDJs: new Set() // Track all connected DJs (multi-DJ support)
    };
    
    // Track last loadTrack commands to prevent duplicates
    this.lastLoadTrack = new Map(); // deck -> { url, timestamp }
    this.loadTrackDebounce = 500; // 500ms debounce
    
    // Initialize Queue Manager
    this.queueManager = new QueueManager();
    
    // Listen to queue updates and broadcast to all clients
    this.queueManager.on('queueUpdate', (queue) => {
      this.broadcastQueueUpdate(queue);
    });
    
    this.queueManager.on('historyUpdate', (history) => {
      this.broadcast({
        type: 'historyUpdate',
        history
      });
    });
    
    // Create WebSocket server
    this.wss = new WebSocketServer({ 
      noServer: true
    });
    
    console.log('🔌 CommandServer WebSocketServer created (noServer mode)');
    
    // Register upgrade handler with central router
    const handleUpgrade = (request, socket, head) => {
      console.log('✅ CommandServer handling upgrade');
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request);
      });
    };
    
    if (global.wsHandlers) {
      global.wsHandlers.set('/ws/commands', handleUpgrade);
      console.log('✅ Registered /ws/commands handler');
    } else {
      console.warn('⚠️ global.wsHandlers not available - fallback to direct handling');
      httpServer.on('upgrade', (request, socket, head) => {
        if (request.url === '/ws/commands') {
          handleUpgrade(request, socket, head);
        }
      });
    }
    
    this.setupWebSocketServer();
    this.setupAudioEngineListeners();
    
    console.log('🔌 CommandServer initialized on /ws/commands');
  }

  /**
   * Setup WebSocket server
   */
  setupWebSocketServer() {
    console.log('🔧 Setting up WebSocket connection handler...');
    
    // Log any WebSocketServer errors
    this.wss.on('error', (error) => {
      console.error('❌ WebSocketServer error:', error);
    });
    
    // Log when server starts listening
    this.wss.on('listening', () => {
      console.log('✅ WebSocketServer is listening');
    });
    
    this.wss.on('connection', (ws, req) => {
      const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      console.log(`📱 New client connected: ${clientId}`);
      console.log(`   - URL: ${req.url}`);
      console.log(`   - Origin: ${req.headers.origin || 'none'}`);
      
      ws.clientId = clientId;
      this.clients.add(ws);
      
      // Send initial state
      this.sendToClient(ws, {
        type: 'welcome',
        clientId,
        state: {
          ...this.audioEngine.getAllStates(),
          queue: this.queueManager.getQueue(),
          history: this.queueManager.getHistory(),
          queueStats: this.queueManager.getStats()
        },
        session: {
          activeDJs: Array.from(this.session.activeDJs),
          djCount: this.session.activeDJs.size
        }
      });
      
      // Handle messages
      ws.on('message', (data) => {
        this.handleMessage(ws, data);
      });

      // Heartbeat (pong) support to detect dead connections
      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });
      
      // Handle disconnect
      ws.on('close', () => {
        console.log(`📴 Client disconnected: ${clientId}`);
        this.clients.delete(ws);
        
        // Remove from active DJs
        this.session.activeDJs.delete(clientId);
        this.broadcastSession();
      });
      
      // Handle errors
      ws.on('error', (error) => {
        console.error(`❌ WebSocket error for ${clientId}:`, error);
      });
    });

    // Setup periodic ping to detect and cleanup dead connections
    this.heartbeatInterval = setInterval(() => {
      for (const ws of Array.from(this.clients)) {
        try {
          if (!ws.isAlive) {
            console.log(`⏳ Terminating dead client: ${ws.clientId}`);
            try { ws.terminate(); } catch (e) {}
            this.clients.delete(ws);
            // Remove from active DJs
            this.session.activeDJs.delete(ws.clientId);
            this.broadcastSession();
            continue;
          }
          ws.isAlive = false;
          ws.ping(() => {});
        } catch (err) {
          console.error('❌ Heartbeat error:', err);
        }
      }
    }, 30000);
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
      // No more control checks - all DJs can control simultaneously!
      
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
          
        case 'queueAdd':
          this.handleQueueAdd(message.data);
          break;
          
        case 'queueRemove':
          this.handleQueueRemove(message.data);
          break;
          
        case 'queueReorder':
          this.handleQueueReorder(message.data);
          break;
          
        case 'queueClear':
          this.handleQueueClear();
          break;
          
        case 'queuePlayNext':
          this.handleQueuePlayNext(message.data);
          break;
          
        case 'queueGetNext':
          const next = this.queueManager.getNext();
          this.sendToClient(ws, {
            type: 'queueNextItem',
            item: next
          });
          break;
          
        case 'getState':
          this.sendToClient(ws, {
            type: 'state',
            data: {
              ...this.audioEngine.getAllStates(),
              queue: this.queueManager.getQueue(),
              history: this.queueManager.getHistory(),
              queueStats: this.queueManager.getStats()
            }
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
   * Handle request control (now just adds DJ to active list)
   */
  handleRequestControl(ws) {
    // Add to active DJs
    this.session.activeDJs.add(ws.clientId);
    
    console.log(`🎤 DJ ${ws.clientId} joined (${this.session.activeDJs.size} active DJs)`);
    
    this.sendToClient(ws, {
      type: 'controlGranted'
    });
    
    this.broadcastSession();
  }

  /**
   * Handle release control (removes DJ from active list)
   */
  handleReleaseControl(ws) {
    this.session.activeDJs.delete(ws.clientId);
    
    console.log(`👋 DJ ${ws.clientId} left (${this.session.activeDJs.size} active DJs)`);
    
    this.sendToClient(ws, {
      type: 'controlReleased'
    });
    
    this.broadcastSession();
  }

  /**
   * Handle load track
   */
  async handleLoadTrack(data) {
    const { deck, url, metadata } = data;
    
    // Debounce duplicate loadTrack commands
    const now = Date.now();
    const lastLoad = this.lastLoadTrack.get(deck);
    
    if (lastLoad && lastLoad.url === url && (now - lastLoad.timestamp) < this.loadTrackDebounce) {
      console.log(`⏭️ [Deck ${deck}] Ignoring duplicate loadTrack (debounced)`);
      return;
    }
    
    // Update last load timestamp
    this.lastLoadTrack.set(deck, { url, timestamp: now });
    
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
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        console.error(`❌ Failed to send to ${ws.clientId}:`, error);
        try { ws.terminate(); } catch (e) {}
        this.clients.delete(ws);
      }
    }
  }

  /**
   * Broadcast message to all clients
   */
  broadcast(message) {
    const data = JSON.stringify(message);
    // Iterate over a snapshot to avoid mutation during iteration
    Array.from(this.clients).forEach(client => {
      if (client.readyState === 1) { // OPEN
        try {
          client.send(data);
        } catch (error) {
          console.error(`❌ Error broadcasting to ${client.clientId}:`, error);
          try { client.terminate(); } catch (e) {}
          this.clients.delete(client);
        }
      } else {
        this.clients.delete(client);
      }
    });
  }

  /**
   * Broadcast session info
   */
  broadcastSession() {
    this.broadcast({
      type: 'sessionUpdate',
      session: {
        activeDJs: Array.from(this.session.activeDJs), // Convert Set to Array for JSON
        djCount: this.session.activeDJs.size
      }
    });
  }

  /**
   * Queue Management - Delegates to QueueManager
   */
  handleQueueAdd(data) {
    try {
      this.queueManager.add(data);
    } catch (error) {
      console.error('❌ Error adding to queue:', error);
      throw error;
    }
  }

  handleQueueRemove(data) {
    try {
      this.queueManager.remove(data.index);
    } catch (error) {
      console.error('❌ Error removing from queue:', error);
      throw error;
    }
  }

  handleQueueReorder(data) {
    try {
      this.queueManager.reorder(data.fromIndex, data.toIndex);
    } catch (error) {
      console.error('❌ Error reordering queue:', error);
      throw error;
    }
  }

  handleQueueClear() {
    this.queueManager.clear();
  }

  handleQueuePlayNext(data) {
    try {
      this.queueManager.playNext(data);
    } catch (error) {
      console.error('❌ Error adding play next:', error);
      throw error;
    }
  }

  broadcastQueueUpdate(queue) {
    this.broadcast({
      type: 'queueUpdate',
      queue,
      stats: this.queueManager.getStats()
    });
  }

  /**
   * Cleanup
   */
  cleanup() {
    console.log('🧹 CommandServer cleanup');
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.wss.close();
  }
}
