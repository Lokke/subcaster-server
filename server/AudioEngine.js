/**
 * AudioEngine.js - Server-Side Audio Processing Engine
 * 
 * Manages:
 * - 4x Audio Decks (A, B, C, D)
 * - Audio Mixing (Decks + Microphone)
 * - Streaming Output (to AzuraCast + Monitor)
 * - Persistent playback (independent of browser)
 */

import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath.path);

/**
 * Single Audio Deck
 */
class AudioDeck extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.state = 'empty'; // empty, loading, ready, playing, paused, ended, error
    this.currentTrack = null;
    this.ffmpegProcess = null;
    this.audioStream = null;
    this.volume = 1.0;
    this.position = 0;
    this.duration = 0;
    this.startTime = null;
  }

  /**
   * Load a track from URL
   */
  async load(url, metadata) {
    console.log(`🎵 [Deck ${this.id}] Loading: ${metadata.title}`);
    this.state = 'loading';
    this.currentTrack = metadata;
    this.emit('stateChange', { deck: this.id, state: this.state, track: metadata });

    try {
      // Create audio stream from URL using ffmpeg
      this.audioStream = new PassThrough();
      
      this.ffmpegProcess = ffmpeg(url)
        .format('s16le') // PCM signed 16-bit little-endian
        .audioChannels(2) // Stereo
        .audioFrequency(48000) // 48kHz
        .on('start', (commandLine) => {
          console.log(`🔧 [Deck ${this.id}] FFmpeg started: ${commandLine}`);
        })
        .on('codecData', (data) => {
          this.duration = this.parseDuration(data.duration);
          console.log(`⏱️ [Deck ${this.id}] Duration: ${this.duration}s`);
        })
        .on('error', (err) => {
          console.error(`❌ [Deck ${this.id}] FFmpeg error:`, err);
          this.state = 'error';
          this.emit('stateChange', { deck: this.id, state: this.state, error: err.message });
        })
        .on('end', () => {
          console.log(`🏁 [Deck ${this.id}] Track ended`);
          this.state = 'ended';
          this.emit('stateChange', { deck: this.id, state: this.state });
          this.emit('ended');
        });

      // Pipe to PassThrough stream
      this.ffmpegProcess.pipe(this.audioStream, { end: true });

      this.state = 'ready';
      this.emit('stateChange', { deck: this.id, state: this.state });
      
      console.log(`✅ [Deck ${this.id}] Ready to play`);
      return true;

    } catch (error) {
      console.error(`❌ [Deck ${this.id}] Load failed:`, error);
      this.state = 'error';
      this.emit('stateChange', { deck: this.id, state: this.state, error: error.message });
      return false;
    }
  }

  /**
   * Play the loaded track
   */
  play() {
    if (this.state !== 'ready' && this.state !== 'paused') {
      console.warn(`⚠️ [Deck ${this.id}] Cannot play, state: ${this.state}`);
      return false;
    }

    console.log(`▶️ [Deck ${this.id}] Playing`);
    this.state = 'playing';
    this.startTime = Date.now() - (this.position * 1000);
    this.emit('stateChange', { deck: this.id, state: this.state });
    
    // Start position update interval
    this.startPositionTracking();
    
    return true;
  }

  /**
   * Pause playback
   */
  pause() {
    if (this.state !== 'playing') {
      return false;
    }

    console.log(`⏸️ [Deck ${this.id}] Paused`);
    this.state = 'paused';
    this.position = (Date.now() - this.startTime) / 1000;
    this.stopPositionTracking();
    this.emit('stateChange', { deck: this.id, state: this.state, position: this.position });
    
    return true;
  }

  /**
   * Seek to position
   */
  seek(time) {
    console.log(`⏩ [Deck ${this.id}] Seek to ${time}s`);
    this.position = Math.max(0, Math.min(time, this.duration));
    
    if (this.state === 'playing') {
      this.startTime = Date.now() - (this.position * 1000);
    }
    
    this.emit('stateChange', { deck: this.id, state: this.state, position: this.position });
    return true;
  }

  /**
   * Set volume (0-1)
   */
  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    console.log(`🔊 [Deck ${this.id}] Volume: ${Math.round(this.volume * 100)}%`);
    this.emit('stateChange', { deck: this.id, volume: this.volume });
    return true;
  }

  /**
   * Clear deck
   */
  async clear() {
    console.log(`🧹 [Deck ${this.id}] Clearing`);
    
    this.stopPositionTracking();
    
    if (this.ffmpegProcess) {
      this.ffmpegProcess.kill('SIGKILL');
      this.ffmpegProcess = null;
    }
    
    if (this.audioStream) {
      this.audioStream.destroy();
      this.audioStream = null;
    }
    
    this.state = 'empty';
    this.currentTrack = null;
    this.position = 0;
    this.duration = 0;
    this.startTime = null;
    
    this.emit('stateChange', { deck: this.id, state: this.state });
    return true;
  }

  /**
   * Get current playback position
   */
  getPosition() {
    if (this.state === 'playing') {
      return (Date.now() - this.startTime) / 1000;
    }
    return this.position;
  }

  /**
   * Start tracking position
   */
  startPositionTracking() {
    if (this.positionInterval) {
      clearInterval(this.positionInterval);
    }
    
    this.positionInterval = setInterval(() => {
      if (this.state === 'playing') {
        this.position = this.getPosition();
        this.emit('position', { deck: this.id, position: this.position });
        
        // Check if track ended
        if (this.position >= this.duration && this.duration > 0) {
          this.pause();
          this.state = 'ended';
          this.emit('ended');
        }
      }
    }, 100); // Update every 100ms
  }

  /**
   * Stop tracking position
   */
  stopPositionTracking() {
    if (this.positionInterval) {
      clearInterval(this.positionInterval);
      this.positionInterval = null;
    }
  }

  /**
   * Parse duration string to seconds
   */
  parseDuration(duration) {
    if (!duration) return 0;
    const parts = duration.split(':');
    if (parts.length === 3) {
      return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
    }
    return parseFloat(duration);
  }

  /**
   * Get audio stream for mixing
   */
  getAudioStream() {
    return this.audioStream;
  }

  /**
   * Get current state
   */
  getState() {
    return {
      id: this.id,
      state: this.state,
      track: this.currentTrack,
      volume: this.volume,
      position: this.getPosition(),
      duration: this.duration
    };
  }
}

/**
 * Audio Engine - Main Controller
 */
export class AudioEngine extends EventEmitter {
  constructor() {
    super();
    
    // Create 4 decks
    this.decks = {
      a: new AudioDeck('A'),
      b: new AudioDeck('B'),
      c: new AudioDeck('C'),
      d: new AudioDeck('D')
    };
    
    // Microphone stream
    this.microphoneStream = null;
    this.microphoneVolume = 1.0;
    
    // Master volumes
    this.masterVolume = 1.0;
    this.streamVolume = 1.0;
    
    // Monitor output stream (for browser playback)
    this.monitorStream = new PassThrough();
    
    // Setup deck event listeners
    Object.values(this.decks).forEach(deck => {
      deck.on('stateChange', (state) => {
        this.emit('deckStateChange', state);
      });
      deck.on('position', (pos) => {
        this.emit('deckPosition', pos);
      });
      deck.on('ended', () => {
        this.emit('deckEnded', { deck: deck.id });
      });
    });
    
    console.log('🎛️ AudioEngine initialized');
  }

  /**
   * Load track to deck
   */
  async loadTrack(deckId, url, metadata) {
    const deck = this.decks[deckId.toLowerCase()];
    if (!deck) {
      throw new Error(`Invalid deck: ${deckId}`);
    }
    return await deck.load(url, metadata);
  }

  /**
   * Play deck
   */
  playDeck(deckId) {
    const deck = this.decks[deckId.toLowerCase()];
    if (!deck) {
      throw new Error(`Invalid deck: ${deckId}`);
    }
    return deck.play();
  }

  /**
   * Pause deck
   */
  pauseDeck(deckId) {
    const deck = this.decks[deckId.toLowerCase()];
    if (!deck) {
      throw new Error(`Invalid deck: ${deckId}`);
    }
    return deck.pause();
  }

  /**
   * Seek deck
   */
  seekDeck(deckId, time) {
    const deck = this.decks[deckId.toLowerCase()];
    if (!deck) {
      throw new Error(`Invalid deck: ${deckId}`);
    }
    return deck.seek(time);
  }

  /**
   * Set deck volume
   */
  setDeckVolume(deckId, volume) {
    const deck = this.decks[deckId.toLowerCase()];
    if (!deck) {
      throw new Error(`Invalid deck: ${deckId}`);
    }
    return deck.setVolume(volume);
  }

  /**
   * Clear deck
   */
  async clearDeck(deckId) {
    const deck = this.decks[deckId.toLowerCase()];
    if (!deck) {
      throw new Error(`Invalid deck: ${deckId}`);
    }
    return await deck.clear();
  }

  /**
   * Get monitor audio stream (for browser playback)
   */
  getMonitorStream() {
    return this.monitorStream;
  }

  /**
   * Get all deck states
   */
  getAllStates() {
    return {
      decks: {
        a: this.decks.a.getState(),
        b: this.decks.b.getState(),
        c: this.decks.c.getState(),
        d: this.decks.d.getState()
      },
      volumes: {
        master: this.masterVolume,
        stream: this.streamVolume,
        microphone: this.microphoneVolume
      }
    };
  }

  /**
   * Cleanup
   */
  async cleanup() {
    console.log('🧹 AudioEngine cleanup');
    await Promise.all([
      this.decks.a.clear(),
      this.decks.b.clear(),
      this.decks.c.clear(),
      this.decks.d.clear()
    ]);
  }
}
