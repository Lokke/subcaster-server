/**
 * AudioEngine.js - Server-Side Audio Processing Engine
 * 
 * Manages:
 * - 4x Audio Decks (A, B, C, D)
 * - Audio Mixing (Decks + Microphone)
 * - Streaming Output (to AzuraCast + Monitor)
 * - Persistent playback (independent of browser)
 */

import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { spawn, execSync } from 'child_process';
import { promises as fs, createWriteStream } from 'fs';
import https from 'https';
import http from 'http';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

// Check if sox is available
let soxAvailable = false;
try {
  execSync('which sox', { stdio: 'ignore' });
  soxAvailable = true;
  console.log('✅ Using system sox for audio playback');
} catch (error) {
  console.error('❌ sox not found! Please install: sudo apt-get install sox libsox-fmt-mp3');
  console.error('   Playback will not work without sox!');
}

/**
 * Download a track from URL to temporary file
 */
async function downloadTrack(url, trackId) {
  return new Promise((resolve, reject) => {
    // Create unique filename
    const fileName = `track_${trackId}_${crypto.randomBytes(8).toString('hex')}.mp3`;
    const tempDir = os.tmpdir();
    const filePath = path.join(tempDir, fileName);

    console.log(`📥 Downloading track to: ${filePath}`);

    // Choose http or https module based on URL
    const client = url.startsWith('https:') ? https : http;

    const request = client.get(url, {
      headers: {
        'User-Agent': 'SubCaster/1.0'
      },
      timeout: 30000 // 30 second timeout
    }, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }

      const fileStream = createWriteStream(filePath);
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        console.log(`✅ Download complete: ${filePath} (${response.headers['content-length'] || 'unknown'} bytes)`);
        resolve(filePath);
      });

      fileStream.on('error', (err) => {
        console.error(`❌ File write error:`, err);
        // Clean up partial file
        fs.unlink(filePath).catch(() => {});
        reject(err);
      });
    });

    request.on('error', (err) => {
      console.error(`❌ Download error:`, err);
      reject(err);
    });

    request.on('timeout', () => {
      request.destroy();
      console.error(`⏰ Download timeout`);
      reject(new Error('Download timeout'));
    });
  });
}

/**
 * Single Audio Deck
 */
class AudioDeck extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.state = 'empty'; // empty, loading, ready, playing, paused, ended, error
    this.currentTrack = null;
    this.soxProcess = null;          // sox playback process
    this.audioStream = null;
    this.downloadedFilePath = null;  // Path to downloaded MP3 file
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
    
    // Clean up any existing sox process before loading new track
    if (this.soxProcess) {
      console.log(`🧹 [Deck ${this.id}] Stopping previous sox process`);
      try {
        this.soxProcess.kill('SIGTERM');
      } catch (err) {
        console.warn(`⚠️ [Deck ${this.id}] Error stopping sox:`, err.message);
      }
      this.soxProcess = null;
    }
    
    if (this.audioStream) {
      try {
        this.audioStream.destroy();
      } catch (err) {
        console.warn(`⚠️ [Deck ${this.id}] Error destroying stream:`, err.message);
      }
      this.audioStream = null;
    }

    // Clean up old downloaded file if exists
    if (this.downloadedFilePath) {
      try {
        await fs.unlink(this.downloadedFilePath);
        console.log(`🗑️ [Deck ${this.id}] Cleaned up old file: ${this.downloadedFilePath}`);
      } catch (err) {
        // Ignore if file doesn't exist
      }
      this.downloadedFilePath = null;
    }
    
    this.state = 'loading';
    this.currentTrack = metadata;
    this.emit('stateChange', { deck: this.id, state: this.state, track: metadata });

    try {
      // Extract original URL from proxy URL if present
      // Format: /api/opensubsonic-stream?url=<encoded-original-url>
      let downloadUrl = url;
      
      if (url.includes('/api/opensubsonic-stream?url=')) {
        try {
          // Extract the 'url' parameter from the proxy URL
          const urlMatch = url.match(/[?&]url=([^&]+)/);
          if (urlMatch && urlMatch[1]) {
            const decodedUrl = decodeURIComponent(urlMatch[1]);
            downloadUrl = decodedUrl;
            console.log(`🔧 [Deck ${this.id}] Extracted original URL from proxy`);
            console.log(`   Proxy: ${url}`);
            console.log(`   Original: ${downloadUrl}`);
          }
        } catch (err) {
          console.warn(`⚠️ [Deck ${this.id}] Failed to extract original URL, using as-is:`, err.message);
        }
      } else if (url.startsWith('/')) {
        // Relative URL - prepend localhost:3002
        downloadUrl = `http://localhost:3002${url}`;
        console.log(`🔧 [Deck ${this.id}] Normalized relative URL: ${url} → ${downloadUrl}`);
      }
      
      // ========================================
      // STEP 1: Download the MP3 file
      // ========================================
      console.log(`📥 [Deck ${this.id}] Downloading track...`);
      this.emit('stateChange', { deck: this.id, state: this.state, track: metadata, progress: 'downloading' });
      
      const localFilePath = await downloadTrack(downloadUrl, metadata.id || this.id);
      this.downloadedFilePath = localFilePath;
      console.log(`✅ [Deck ${this.id}] Download complete: ${localFilePath}`);
      
      // ========================================
      // STEP 2: Get duration from downloaded file (probe with ffmpeg)
      // ========================================
      console.log(`🔍 [Deck ${this.id}] Reading track metadata...`);
      this.emit('stateChange', { deck: this.id, state: this.state, track: metadata, progress: 'probing' });
      
      try {
        // Use ffprobe to get duration WITHOUT starting playback
        const duration = await this.probeDuration(localFilePath);
        this.duration = duration;
        console.log(`⏱️ [Deck ${this.id}] Duration: ${this.duration}s`);
      } catch (err) {
        console.warn(`⚠️ [Deck ${this.id}] Could not probe duration:`, err.message);
        this.duration = metadata.duration || 0; // Fallback to metadata
      }
      
      // ========================================
      // READY STATE: File downloaded, waiting for play command
      // ========================================
      this.state = 'ready';
      this.currentTrack = metadata;
      this.currentTrack.duration = this.duration; // Update with real duration
      this.emit('stateChange', { 
        deck: this.id, 
        state: this.state, 
        track: this.currentTrack,
        duration: this.duration 
      });
      
      console.log(`✅ [Deck ${this.id}] Ready to play (${this.duration}s)`);
      return true;

    } catch (error) {
      console.error(`❌ [Deck ${this.id}] Load failed:`, error);
      this.state = 'error';
      this.emit('stateChange', { deck: this.id, state: this.state, error: error.message });
      
      // Clean up downloaded file on error
      if (this.downloadedFilePath) {
        fs.unlink(this.downloadedFilePath).catch(() => {});
        this.downloadedFilePath = null;
      }
      
      return false;
    }
  }

  /**
   * Probe duration from file using sox
   */
  probeDuration(filePath) {
    return new Promise((resolve, reject) => {
      // Use soxi to get duration (sox info utility)
      const soxi = spawn('soxi', ['-D', filePath]);
      
      let output = '';
      soxi.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      soxi.on('close', (code) => {
        if (code === 0) {
          const duration = parseFloat(output.trim());
          if (!isNaN(duration)) {
            resolve(duration);
          } else {
            reject(new Error('Could not parse duration'));
          }
        } else {
          reject(new Error(`soxi exited with code ${code}`));
        }
      });
      
      soxi.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Play the loaded track
   */
  async play() {
    if (this.state !== 'ready' && this.state !== 'paused') {
      console.warn(`⚠️ [Deck ${this.id}] Cannot play, state: ${this.state}`);
      return false;
    }

    // If this is first play (not resume from pause), start sox
    if (this.state === 'ready' && !this.soxProcess && this.downloadedFilePath) {
      console.log(`🎵 [Deck ${this.id}] Starting sox for playback...`);
      
      if (!soxAvailable) {
        console.error(`❌ [Deck ${this.id}] sox is not available!`);
        this.state = 'error';
        this.emit('stateChange', { deck: this.id, state: this.state, error: 'sox not installed' });
        return false;
      }
      
      try {
        // Create audio stream
        this.audioStream = new PassThrough();
        
        // Start sox process
        // sox input.mp3 -t raw -r 48000 -e signed -b 16 -c 2 - (outputs PCM to stdout)
        this.soxProcess = spawn('sox', [
          this.downloadedFilePath,  // Input file
          '-t', 'raw',              // Output type: raw PCM
          '-r', '48000',            // Sample rate: 48kHz
          '-e', 'signed',           // Encoding: signed integer
          '-b', '16',               // Bit depth: 16-bit
          '-c', '2',                // Channels: stereo
          '-'                       // Output to stdout
        ]);
        
        // Pipe sox output to our audio stream
        this.soxProcess.stdout.pipe(this.audioStream);
        
        this.soxProcess.stderr.on('data', (data) => {
          // Sox outputs progress info to stderr, we can ignore it
          // console.log(`[Deck ${this.id}] sox: ${data.toString().trim()}`);
        });
        
        this.soxProcess.on('error', (err) => {
          console.error(`❌ [Deck ${this.id}] sox error:`, err);
          this.state = 'error';
          this.emit('stateChange', { deck: this.id, state: this.state, error: err.message });
        });
        
        this.soxProcess.on('close', (code) => {
          if (code === 0) {
            console.log(`🏁 [Deck ${this.id}] Track ended`);
            this.state = 'ended';
            this.emit('stateChange', { deck: this.id, state: this.state });
            this.emit('ended');
          } else if (code !== null) {
            console.error(`❌ [Deck ${this.id}] sox exited with code ${code}`);
            this.state = 'error';
            this.emit('stateChange', { deck: this.id, state: this.state, error: `sox exited with code ${code}` });
          }
          
          // Clean up downloaded file after playback ends
          if (this.downloadedFilePath) {
            fs.unlink(this.downloadedFilePath).then(() => {
              console.log(`🗑️ [Deck ${this.id}] Cleaned up: ${this.downloadedFilePath}`);
            }).catch(() => {});
            this.downloadedFilePath = null;
          }
        });
        
      } catch (error) {
        console.error(`❌ [Deck ${this.id}] Failed to start sox:`, error);
        this.state = 'error';
        this.emit('stateChange', { deck: this.id, state: this.state, error: error.message });
        return false;
      }
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
    
    if (this.soxProcess) {
      this.soxProcess.kill('SIGKILL');
      this.soxProcess = null;
    }
    
    if (this.audioStream) {
      this.audioStream.destroy();
      this.audioStream = null;
    }
    
    // Clean up downloaded file
    if (this.downloadedFilePath) {
      try {
        await fs.unlink(this.downloadedFilePath);
        console.log(`🗑️ [Deck ${this.id}] Cleaned up: ${this.downloadedFilePath}`);
      } catch (err) {
        // Ignore if file doesn't exist
      }
      this.downloadedFilePath = null;
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
    
    // Monitor output stream (for browser playback) - DEPRECATED
    this.monitorStream = new PassThrough();
    
    // RTP Output to MediaSoup
    this.rtpProcess = null;
    this.rtpOutputActive = false;
    this.rtpTargetIp = null;
    this.rtpTargetPort = null;
    
    // Mixing stream (combines all playing decks)
    this.mixerStream = new PassThrough();
    this.startMixing();
    
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
   * @deprecated Use MediaSoup WebRTC instead
   */
  getMonitorStream() {
    return this.monitorStream;
  }

  /**
   * Start RTP output to MediaSoup
   */
  startRTPOutput(targetIp, targetPort) {
    if (this.rtpOutputActive) {
      console.log('⚠️ RTP output already active');
      return;
    }

    this.rtpTargetIp = targetIp;
    this.rtpTargetPort = targetPort;

    console.log(`📡 Starting RTP output to ${targetIp}:${targetPort}`);

    // Create FFmpeg process: PCM → Opus → RTP
    this.rtpProcess = ffmpeg()
      .input('pipe:0') // Read from stdin (mixer stream)
      .inputFormat('s16le') // PCM signed 16-bit little-endian
      .inputOptions([
        '-ar 48000', // 48kHz sample rate
        '-ac 2'      // Stereo
      ])
      .audioCodec('libopus')
      .audioChannels(2)
      .audioFrequency(48000)
      .audioBitrate('320k') // 320 kbps Opus
      .outputOptions([
        '-application audio', // Optimize for music
        '-frame_duration 20', // 20ms frames
        '-vbr off',          // Constant bitrate
        '-packet_loss 0',    // No packet loss assumed (local)
        '-f rtp',            // RTP output format
        `-sdp_file /tmp/mediasoup_${targetPort}.sdp` // SDP file for debugging
      ])
      .output(`rtp://${targetIp}:${targetPort}`)
      .on('start', (commandLine) => {
        console.log(`🔧 FFmpeg RTP started: ${commandLine}`);
      })
      .on('error', (err) => {
        console.error('❌ FFmpeg RTP error:', err);
        this.rtpOutputActive = false;
      })
      .on('end', () => {
        console.log('🏁 FFmpeg RTP ended');
        this.rtpOutputActive = false;
      });

    // Pipe mixer stream to FFmpeg
    this.mixerStream.pipe(this.rtpProcess.stdin);
    this.rtpProcess.run();

    this.rtpOutputActive = true;
    console.log('✅ RTP output started');
  }

  /**
   * Stop RTP output
   */
  stopRTPOutput() {
    if (!this.rtpOutputActive || !this.rtpProcess) {
      return;
    }

    console.log('🛑 Stopping RTP output');
    
    try {
      this.rtpProcess.kill('SIGTERM');
    } catch (err) {
      console.warn('⚠️ Error stopping RTP process:', err.message);
    }
    
    this.rtpProcess = null;
    this.rtpOutputActive = false;
    console.log('✅ RTP output stopped');
  }

  /**
   * Start mixing all playing decks into single stream
   */
  startMixing() {
    // This creates a continuous stream that mixes all playing decks
    // Every 20ms (48000 samples/sec × 2 channels × 2 bytes × 0.02s = 3840 bytes)
    const CHUNK_SIZE = 3840;
    const INTERVAL_MS = 20;
    
    this.mixingInterval = setInterval(() => {
      const buffer = Buffer.alloc(CHUNK_SIZE);
      let hasAudio = false;

      // Mix all playing decks
      for (const deck of Object.values(this.decks)) {
        if (deck.state === 'playing' && deck.audioStream) {
          const chunk = deck.audioStream.read(CHUNK_SIZE);
          if (chunk && chunk.length === CHUNK_SIZE) {
            hasAudio = true;
            
            // Mix by averaging samples with volume adjustment
            for (let i = 0; i < CHUNK_SIZE; i += 2) {
              // Read 16-bit sample
              const sample = chunk.readInt16LE(i);
              const volumeAdjusted = Math.round(sample * deck.volume * this.masterVolume);
              
              // Mix with existing buffer (sum and clamp)
              const existing = buffer.readInt16LE(i);
              const mixed = Math.max(-32768, Math.min(32767, existing + volumeAdjusted));
              buffer.writeInt16LE(mixed, i);
            }
          }
        }
      }

      // Write silence or mixed audio
      if (hasAudio || this.rtpOutputActive) {
        this.mixerStream.write(buffer);
        this.monitorStream.write(buffer); // Also for legacy monitor
      }
    }, INTERVAL_MS);

    console.log('🎚️ Audio mixer started');
  }

  /**
   * Stop mixing
   */
  stopMixing() {
    if (this.mixingInterval) {
      clearInterval(this.mixingInterval);
      this.mixingInterval = null;
    }
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
    
    // Stop RTP output
    this.stopRTPOutput();
    
    // Stop mixing
    this.stopMixing();
    
    // Clear all decks
    await Promise.all([
      this.decks.a.clear(),
      this.decks.b.clear(),
      this.decks.c.clear(),
      this.decks.d.clear()
    ]);
  }
}
