/**
 * AudioMixer.js - Server-Side Audio Mixing
 * 
 * Combines:
 * - 4x Audio Decks (A, B, C, D)
 * - Multiple Microphone Streams
 * 
 * Outputs:
 * - Monitor Stream (Decks only - no microphone feedback)
 * - Broadcast Stream (Decks + Microphones to AzuraCast)
 */

import { PassThrough } from 'stream';

export class AudioMixer {
  constructor(audioEngine, microphoneServer) {
    this.audioEngine = audioEngine;
    this.microphoneServer = microphoneServer;
    
    // Output streams
    this.monitorStream = new PassThrough(); // Decks only
    this.broadcastStream = new PassThrough(); // Decks + Microphones
    
    // Master volumes
    this.masterVolume = 1.0;
    this.microphoneGain = 1.0;
    
    // Audio format
    this.sampleRate = 48000;
    this.channels = 2; // Stereo
    this.bitDepth = 16;
    
    // Mixing buffer
    this.mixingActive = false;
    this.mixInterval = null;
    
    console.log('🎛️ AudioMixer initialized');
  }

  /**
   * Start mixing audio
   */
  start() {
    if (this.mixingActive) {
      console.warn('⚠️ AudioMixer already active');
      return;
    }
    
    console.log('🎛️ Starting audio mixing...');
    this.mixingActive = true;
    
    // Mix audio at 60 FPS (16.67ms intervals) for smooth playback
    this.mixInterval = setInterval(() => {
      this.mixAudioFrame();
    }, 16);
  }

  /**
   * Stop mixing audio
   */
  stop() {
    if (!this.mixingActive) {
      return;
    }
    
    console.log('🎛️ Stopping audio mixing...');
    this.mixingActive = false;
    
    if (this.mixInterval) {
      clearInterval(this.mixInterval);
      this.mixInterval = null;
    }
  }

  /**
   * Mix one audio frame (called every 16ms)
   */
  mixAudioFrame() {
    // Calculate frame size: 16ms of audio at 48kHz stereo
    const frameDuration = 0.016; // 16ms
    const samplesPerFrame = Math.floor(this.sampleRate * frameDuration);
    const frameSize = samplesPerFrame * this.channels * (this.bitDepth / 8); // Bytes
    
    try {
      // Mix decks
      const decksMix = this.mixDecks(samplesPerFrame);
      
      // Mix microphones
      const micsMix = this.mixMicrophones(samplesPerFrame);
      
      // Create monitor output (decks only)
      if (decksMix) {
        this.monitorStream.write(decksMix);
      }
      
      // Create broadcast output (decks + mics)
      if (decksMix || micsMix) {
        const broadcastMix = this.combineMixes(decksMix, micsMix, samplesPerFrame);
        this.broadcastStream.write(broadcastMix);
      }
      
    } catch (error) {
      console.error('❌ Error mixing audio frame:', error);
    }
  }

  /**
   * Mix all active decks
   */
  mixDecks(samplesPerFrame) {
    const frameSize = samplesPerFrame * this.channels * (this.bitDepth / 8);
    const mixBuffer = new Int16Array(samplesPerFrame * this.channels);
    
    let hasAudio = false;
    
    // Get all decks
    const decks = [
      this.audioEngine.decks.a,
      this.audioEngine.decks.b,
      this.audioEngine.decks.c,
      this.audioEngine.decks.d
    ];
    
    // Mix each playing deck
    for (const deck of decks) {
      if (deck.state === 'playing' && deck.audioStream) {
        const deckData = this.readAudioChunk(deck.audioStream, frameSize);
        
        if (deckData && deckData.length > 0) {
          hasAudio = true;
          
          // Convert to Int16Array
          const deckSamples = new Int16Array(
            deckData.buffer,
            deckData.byteOffset,
            deckData.byteLength / 2
          );
          
          // Mix with volume
          for (let i = 0; i < Math.min(mixBuffer.length, deckSamples.length); i++) {
            const sample = deckSamples[i] * deck.volume * this.masterVolume;
            mixBuffer[i] += sample;
          }
        }
      }
    }
    
    if (!hasAudio) {
      return null;
    }
    
    // Clamp to prevent clipping
    for (let i = 0; i < mixBuffer.length; i++) {
      mixBuffer[i] = Math.max(-32768, Math.min(32767, mixBuffer[i]));
    }
    
    return Buffer.from(mixBuffer.buffer);
  }

  /**
   * Mix all active microphones
   */
  mixMicrophones(samplesPerFrame) {
    const frameSize = samplesPerFrame * (this.bitDepth / 8); // Mono microphones
    const mixBuffer = new Int16Array(samplesPerFrame * this.channels); // Output stereo
    
    let hasAudio = false;
    
    // Get all microphone streams
    const micStreams = this.microphoneServer.getAllAudioStreams();
    
    if (micStreams.length === 0) {
      return null;
    }
    
    // Mix each microphone
    for (const micStream of micStreams) {
      const micData = this.readAudioChunk(micStream, frameSize);
      
      if (micData && micData.length > 0) {
        hasAudio = true;
        
        // Convert to Int16Array (mono)
        const micSamples = new Int16Array(
          micData.buffer,
          micData.byteOffset,
          micData.byteLength / 2
        );
        
        // Mix to stereo with gain
        for (let i = 0; i < micSamples.length; i++) {
          const sample = micSamples[i] * this.microphoneGain * this.masterVolume;
          
          // Duplicate to both channels (mono to stereo)
          mixBuffer[i * 2] += sample;
          mixBuffer[i * 2 + 1] += sample;
        }
      }
    }
    
    if (!hasAudio) {
      return null;
    }
    
    // Clamp to prevent clipping
    for (let i = 0; i < mixBuffer.length; i++) {
      mixBuffer[i] = Math.max(-32768, Math.min(32767, mixBuffer[i]));
    }
    
    return Buffer.from(mixBuffer.buffer);
  }

  /**
   * Combine deck and microphone mixes
   */
  combineMixes(decksMix, micsMix, samplesPerFrame) {
    const totalSamples = samplesPerFrame * this.channels;
    const mixBuffer = new Int16Array(totalSamples);
    
    // Add decks
    if (decksMix) {
      const deckSamples = new Int16Array(
        decksMix.buffer,
        decksMix.byteOffset,
        decksMix.byteLength / 2
      );
      
      for (let i = 0; i < Math.min(totalSamples, deckSamples.length); i++) {
        mixBuffer[i] = deckSamples[i];
      }
    }
    
    // Add microphones
    if (micsMix) {
      const micSamples = new Int16Array(
        micsMix.buffer,
        micsMix.byteOffset,
        micsMix.byteLength / 2
      );
      
      for (let i = 0; i < Math.min(totalSamples, micSamples.length); i++) {
        mixBuffer[i] += micSamples[i];
      }
    }
    
    // Clamp to prevent clipping
    for (let i = 0; i < mixBuffer.length; i++) {
      mixBuffer[i] = Math.max(-32768, Math.min(32767, mixBuffer[i]));
    }
    
    return Buffer.from(mixBuffer.buffer);
  }

  /**
   * Read audio chunk from stream (non-blocking)
   */
  readAudioChunk(stream, size) {
    try {
      const chunk = stream.read(size);
      return chunk;
    } catch (error) {
      return null;
    }
  }

  /**
   * Set master volume
   */
  setMasterVolume(volume) {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    console.log(`🔊 Master volume: ${Math.round(this.masterVolume * 100)}%`);
  }

  /**
   * Set microphone gain
   */
  setMicrophoneGain(gain) {
    this.microphoneGain = Math.max(0, Math.min(2, gain)); // Allow up to 2x gain
    console.log(`🎤 Microphone gain: ${Math.round(this.microphoneGain * 100)}%`);
  }

  /**
   * Get monitor stream (decks only, no mics)
   */
  getMonitorStream() {
    return this.monitorStream;
  }

  /**
   * Get broadcast stream (decks + mics)
   */
  getBroadcastStream() {
    return this.broadcastStream;
  }

  /**
   * Cleanup
   */
  cleanup() {
    console.log('🧹 AudioMixer cleanup');
    this.stop();
    this.monitorStream.end();
    this.broadcastStream.end();
  }
}
