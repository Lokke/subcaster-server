/**
 * LiquidsoapController.js - Node.js Controller for Liquidsoap
 * 
 * Manages Liquidsoap process and provides high-level API for deck control
 */

import { spawn } from 'child_process';
import { createConnection } from 'net';
import { EventEmitter } from 'events';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath.path);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class LiquidsoapController extends EventEmitter {
  constructor() {
    super();
    
    this.liquidsoap = null;
    this.ffmpegReceiver = null;
    this.telnet = null;
    this.telnetConnected = false;
    this.telnetPort = 1234;
    this.telnetHost = '127.0.0.1';
    
    // Harbor Output configuration (matches radio.liq)
    this.harborHost = '127.0.0.1';
    this.monitorPort = 8002;  // DECKS ONLY for DJ monitoring
    this.broadcastPort = 8003; // DECKS + MICS for listeners
    
    // PCM output streams
    this.monitorStream = null;     // For MediaSoup (DJs)
    this.broadcastStream = null;   // For AzuraCast (Listeners)
    
    // Deck states (tracked locally)
    this.deckStates = {
      a: { state: 'empty', track: null, volume: 1.0, queue: [] },
      b: { state: 'empty', track: null, volume: 1.0, queue: [] },
      c: { state: 'empty', track: null, volume: 1.0, queue: [] },
      d: { state: 'empty', track: null, volume: 1.0, queue: [] }
    };
    
    this.queue = [];
    this.masterVolume = 1.0;
    this.microphoneVolume = 1.0;
  }

  /**
   * Start Liquidsoap process
   */
  async start() {
    console.log('🎵 Starting Liquidsoap...');
    console.log('🔍 Stack trace:', new Error().stack);
    
    // Prevent duplicate starts
    if (this.liquidsoap && !this.liquidsoap.killed) {
      console.log('⚠️  Liquidsoap already running, skipping start');
      return;
    }
    
    const scriptPath = path.join(__dirname, 'liquidsoap', 'radio.liq');
    
    this.liquidsoap = spawn('liquidsoap', [scriptPath], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    this.liquidsoap.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.log(`[Liquidsoap] ${output}`);
      }
    });
    
    this.liquidsoap.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output && !output.includes('Frame.duration')) {
        console.error(`[Liquidsoap] ${output}`);
      }
    });
    
    this.liquidsoap.on('close', (code) => {
      console.log(`❌ Liquidsoap exited with code ${code}`);
      this.emit('liquidsoap_stopped', code);
    });
    
    // Give Liquidsoap time to fully start and bind ports
    console.log('⏳ Waiting 5 seconds for Liquidsoap to initialize...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Note: We don't connect to Telnet since it's disabled
    // Commands will be sent via Harbor HTTP endpoints or other methods
    
    // Start Harbor PCM stream readers
    this.startMonitorStream();     // For MediaSoup (DJs hear decks only)
    this.startBroadcastStream();   // For AzuraCast (Listeners hear decks + mics)
    
    console.log('✅ Liquidsoap started successfully');
    this.emit('ready');
  }

  /**
   * Start Monitor stream (DECKS ONLY - for DJ WebRTC monitoring)
   */
  startMonitorStream() {
    console.log(`📡 Connecting to Monitor stream on port ${this.monitorPort}...`);
    
    // Fetch PCM stream from Harbor
    const harborUrl = `http://${this.harborHost}:${this.monitorPort}/monitor`;
    
    const req = http.get(harborUrl, (res) => {
      console.log(`✅ Connected to Monitor stream: ${harborUrl}`);
      console.log(`   Status: ${res.statusCode}`);
      console.log(`   Content-Type: ${res.headers['content-type']}`);
      
      // The response stream IS the monitor stream (DECKS ONLY)
      this.monitorStream = res;
      
      res.on('error', (err) => {
        console.error('❌ Monitor stream error:', err.message);
      });
    });
    
    req.on('error', (err) => {
      console.error('❌ Failed to connect to Monitor stream:', err.message);
    });
    
    console.log('✅ Monitor stream started (DECKS ONLY for DJ monitoring)');
  }

  /**
   * Start Broadcast stream (DECKS + MICS - for AzuraCast listeners)
   */
  startBroadcastStream() {
    console.log(`📡 Connecting to Broadcast stream on port ${this.broadcastPort}...`);
    
    // Fetch PCM stream from Harbor
    const harborUrl = `http://${this.harborHost}:${this.broadcastPort}/broadcast`;
    
    const req = http.get(harborUrl, (res) => {
      console.log(`✅ Connected to Broadcast stream: ${harborUrl}`);
      console.log(`   Status: ${res.statusCode}`);
      console.log(`   Content-Type: ${res.headers['content-type']}`);
      
      // The response stream IS the broadcast stream (DECKS + MICS)
      this.broadcastStream = res;
      
      res.on('error', (err) => {
        console.error('❌ Broadcast stream error:', err.message);
      });
    });
    
    req.on('error', (err) => {
      console.error('❌ Failed to connect to Broadcast stream:', err.message);
    });
    
    console.log('✅ Broadcast stream started (DECKS + MICS for listeners)');
  }

  /**
   * Wait for telnet port to be available (DEPRECATED - Telnet disabled)
   */
  async waitForTelnet(maxAttempts = 20, delay = 500) {
    // Telnet is disabled, so we just skip this
    console.log('ℹ️  Telnet disabled, skipping connection');
    return;
    
    for (let i = 0; i < maxAttempts; i++) {
      try {
        await this.connectTelnet();
        console.log('✅ Telnet connection established');
        return;
      } catch (err) {
        if (i < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    throw new Error('Failed to connect to Liquidsoap telnet after ' + maxAttempts + ' attempts');
  }

  /**
   * Connect to Liquidsoap telnet
   */
  connectTelnet() {
    return new Promise((resolve, reject) => {
      this.telnet = createConnection({
        host: this.telnetHost,
        port: this.telnetPort
      });
      
      this.telnet.on('connect', () => {
        this.telnetConnected = true;
        resolve();
      });
      
      this.telnet.on('error', (err) => {
        this.telnetConnected = false;
        reject(err);
      });
      
      this.telnet.on('close', () => {
        this.telnetConnected = false;
        console.log('📴 Telnet connection closed');
      });
      
      // Read welcome message
      this.telnet.once('data', () => {
        // Ignore welcome banner
      });
    });
  }

  /**
   * Send command to Liquidsoap via telnet
   */
  async sendCommand(command) {
    if (!this.telnetConnected) {
      await this.connectTelnet();
    }
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Telnet command timeout'));
      }, 5000);
      
      this.telnet.once('data', (data) => {
        clearTimeout(timeout);
        const response = data.toString().trim();
        resolve(response);
      });
      
      this.telnet.write(command + '\n');
    });
  }

  /**
   * Load track to deck
   */
  async loadTrack(deckId, uri, metadata) {
    console.log(`📀 [Deck ${deckId.toUpperCase()}] Loading: ${metadata.title}`);
    
    const deck = deckId.toLowerCase();
    
    // Update local state
    this.deckStates[deck].state = 'loading';
    this.deckStates[deck].track = metadata;
    this.emit('deckStateChange', {
      id: deck,
      state: 'loading',
      track: metadata
    });
    
    try {
      // Send to Liquidsoap
      const response = await this.sendCommand(`deck.load deck_${deck} ${uri}`);
      console.log(`✅ [Deck ${deck.toUpperCase()}] Response: ${response}`);
      
      // Update state to ready
      this.deckStates[deck].state = 'ready';
      this.emit('deckStateChange', {
        id: deck,
        state: 'ready',
        track: metadata,
        duration: metadata.duration || 0
      });
      
      return true;
    } catch (err) {
      console.error(`❌ [Deck ${deck.toUpperCase()}] Load failed:`, err);
      this.deckStates[deck].state = 'error';
      this.emit('deckStateChange', {
        id: deck,
        state: 'error',
        error: err.message
      });
      return false;
    }
  }

  /**
   * Play deck (Liquidsoap queues auto-play, this is for state tracking)
   */
  async playDeck(deckId) {
    const deck = deckId.toLowerCase();
    console.log(`▶️ [Deck ${deck.toUpperCase()}] Playing`);
    
    this.deckStates[deck].state = 'playing';
    this.emit('deckStateChange', {
      id: deck,
      state: 'playing'
    });
    
    return true;
  }

  /**
   * Pause deck (stop source)
   */
  async pauseDeck(deckId) {
    const deck = deckId.toLowerCase();
    console.log(`⏸️ [Deck ${deck.toUpperCase()}] Paused`);
    
    // Skip current track to simulate pause
    await this.sendCommand(`deck.skip deck_${deck}`);
    
    this.deckStates[deck].state = 'paused';
    this.emit('deckStateChange', {
      id: deck,
      state: 'paused'
    });
    
    return true;
  }

  /**
   * Skip current track on deck
   */
  async skipDeck(deckId) {
    const deck = deckId.toLowerCase();
    console.log(`⏭️ [Deck ${deck.toUpperCase()}] Skipping`);
    
    const response = await this.sendCommand(`deck.skip deck_${deck}`);
    console.log(`✅ Skip response: ${response}`);
    
    this.deckStates[deck].state = 'empty';
    this.deckStates[deck].track = null;
    this.emit('deckStateChange', {
      id: deck,
      state: 'empty',
      track: null
    });
    
    return true;
  }

  /**
   * Set deck volume
   */
  async setDeckVolume(deckId, volume) {
    const deck = deckId.toLowerCase();
    const clampedVolume = Math.max(0, Math.min(1, volume));
    
    console.log(`🔊 [Deck ${deck.toUpperCase()}] Volume: ${clampedVolume}`);
    
    await this.sendCommand(`var.set deck_${deck}.volume ${clampedVolume}`);
    
    this.deckStates[deck].volume = clampedVolume;
    this.emit('deckStateChange', {
      id: deck,
      volume: clampedVolume
    });
    
    return true;
  }

  /**
   * Set master volume
   */
  async setMasterVolume(volume) {
    const clampedVolume = Math.max(0, Math.min(1, volume));
    console.log(`🔊 Master Volume: ${clampedVolume}`);
    
    await this.sendCommand(`var.set master.volume ${clampedVolume}`);
    this.masterVolume = clampedVolume;
    
    return true;
  }

  /**
   * Set microphone volume
   */
  async setMicrophoneVolume(volume) {
    const clampedVolume = Math.max(0, Math.min(1, volume));
    console.log(`🎤 Microphone Volume: ${clampedVolume}`);
    
    await this.sendCommand(`var.set microphone.volume ${clampedVolume}`);
    this.microphoneVolume = clampedVolume;
    
    return true;
  }

  /**
   * Add track to main queue
   */
  async queuePush(uri, metadata) {
    console.log(`📋 Adding to queue: ${metadata.title}`);
    
    this.queue.push(metadata);
    this.emit('queueUpdate', this.queue);
    
    const response = await this.sendCommand(`queue.push ${uri}`);
    console.log(`✅ Queue response: ${response}`);
    
    return true;
  }

  /**
   * Clear main queue
   */
  async queueClear() {
    console.log(`🗑️ Clearing queue`);
    
    this.queue = [];
    this.emit('queueUpdate', this.queue);
    
    const response = await this.sendCommand('queue.clear');
    console.log(`✅ Queue cleared: ${response}`);
    
    return true;
  }

  /**
   * Get current state of all decks
   */
  getState() {
    return {
      decks: this.deckStates,
      queue: this.queue,
      volumes: {
        master: this.masterVolume,
        microphone: this.microphoneVolume
      }
    };
  }

  /**
   * Stop Liquidsoap
   */
  async stop() {
    console.log('🛑 Stopping Liquidsoap...');
    
    // Stop FFmpeg receiver
    if (this.ffmpegReceiver) {
      this.ffmpegReceiver.kill('SIGTERM');
      this.ffmpegReceiver = null;
    }
    
    if (this.broadcastStream) {
      this.broadcastStream = null;
    }
    
    if (this.telnet) {
      this.telnet.destroy();
      this.telnet = null;
    }
    
    if (this.liquidsoap) {
      this.liquidsoap.kill('SIGTERM');
      
      // Wait for graceful shutdown
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          if (this.liquidsoap) {
            this.liquidsoap.kill('SIGKILL');
          }
          resolve();
        }, 5000);
        
        this.liquidsoap.once('close', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      
      this.liquidsoap = null;
    }
    
    console.log('✅ Liquidsoap stopped');
  }

  /**
   * Get Harbor HTTP stream info for MediaSoup
   * (Previously RTP, now HTTP Harbor stream)
   */
  /**
   * Get monitor stream info (for MediaSoup - DJs hear DECKS ONLY)
   */
  getMonitorInfo() {
    return {
      host: this.harborHost,
      port: this.monitorPort,
      url: `http://${this.harborHost}:${this.monitorPort}/monitor`,
      description: 'Monitor stream (DECKS ONLY - no microphones)'
    };
  }

  /**
   * Get monitor stream (for MediaSoup WebRTC)
   * Returns the PCM/WAV stream from Harbor (DECKS ONLY)
   */
  getMonitorStream() {
    return this.monitorStream;
  }

  /**
   * Get broadcast stream info (for AzuraCast - Listeners hear DECKS + MICS)
   */
  getBroadcastInfo() {
    return {
      host: this.harborHost,
      port: this.broadcastPort,
      url: `http://${this.harborHost}:${this.broadcastPort}/broadcast`,
      description: 'Broadcast stream (DECKS + MICROPHONES)'
    };
  }

  /**
   * Get broadcast stream (for AzuraCastOutput)
   * Returns the PCM/WAV stream from Harbor (DECKS + MICS)
   */
  getBroadcastStream() {
    return this.broadcastStream;
  }

  /**
   * Get all states (for CommandServer compatibility)
   * Returns deck states, queue, and volume information
   */
  getAllStates() {
    return {
      decks: this.deckStates,
      queue: this.queue,
      masterVolume: this.masterVolume,
      microphoneVolume: this.microphoneVolume
    };
  }

  /**
   * Get RTP info (legacy compatibility - Harbor replaces RTP)
   * Returns monitor stream info instead
   */
  getRtpInfo() {
    return this.getMonitorInfo();
  }
}
