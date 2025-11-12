/**
 * AzuraCastOutput.js - Stream Output to AzuraCast
 * 
 * Takes the broadcast stream from Liquidsoap (music + microphones mixed)
 * and streams it to AzuraCast using Icecast/SHOUTcast protocol
 */

import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import net from 'net';

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath.path);

export class AzuraCastOutput {
  constructor(liquidsoapController, config) {
    this.liquidsoapController = liquidsoapController;
    this.config = {
      server: config.server || 'localhost',
      port: config.port || 8000,
      password: config.password || 'hackme',
      mount: config.mount || '/live',
      format: config.format || 'mp3',
      bitrate: config.bitrate || 128,
      sampleRate: config.sampleRate || 48000,
      channels: config.channels || 2,
      ...config
    };
    
    this.ffmpegProcess = null;
    this.isStreaming = false;
    this.reconnectTimeout = null;
    this.reconnectDelay = 5000; // 5 seconds
    
    console.log('📡 AzuraCastOutput initialized');
    console.log(`   Server: ${this.config.server}:${this.config.port}`);
    console.log(`   Mount: ${this.config.mount}`);
    console.log(`   Format: ${this.config.format} @ ${this.config.bitrate}kbps`);
  }

  /**
   * Start streaming to AzuraCast
   */
  start() {
    if (this.isStreaming) {
      console.warn('⚠️ AzuraCast streaming already active');
      return;
    }
    
    console.log('📡 Starting AzuraCast streaming...');
    
    try {
      const broadcastStream = this.liquidsoapController.getBroadcastStream();
      
      if (!broadcastStream) {
        throw new Error('No broadcast stream available from Liquidsoap');
      }
      
      // Create Icecast URL
      const icecastUrl = `icecast://:${this.config.password}@${this.config.server}:${this.config.port}${this.config.mount}`;
      
      // Start FFmpeg encoding and streaming
      this.ffmpegProcess = ffmpeg()
        .input(broadcastStream)
        .inputFormat('s16le') // PCM signed 16-bit little-endian
        .inputOptions([
          '-ar', this.config.sampleRate.toString(),
          '-ac', this.config.channels.toString()
        ])
        .audioCodec(this.getAudioCodec())
        .audioBitrate(this.config.bitrate)
        .format(this.getFormat())
        .outputOptions(this.getOutputOptions())
        .output(icecastUrl)
        .on('start', (commandLine) => {
          console.log(`🔧 FFmpeg streaming started: ${commandLine}`);
          this.isStreaming = true;
        })
        .on('error', (err, stdout, stderr) => {
          console.error(`❌ FFmpeg streaming error:`, err.message);
          console.error(`   stdout:`, stdout);
          console.error(`   stderr:`, stderr);
          this.isStreaming = false;
          
          // Try to reconnect
          this.scheduleReconnect();
        })
        .on('end', () => {
          console.log(`🏁 FFmpeg streaming ended`);
          this.isStreaming = false;
          
          // Try to reconnect
          this.scheduleReconnect();
        });
      
      // Run the process
      this.ffmpegProcess.run();
      
      console.log('✅ AzuraCast streaming started');
      
    } catch (error) {
      console.error('❌ Failed to start AzuraCast streaming:', error);
      this.isStreaming = false;
      
      // Try to reconnect
      this.scheduleReconnect();
    }
  }

  /**
   * Stop streaming
   */
  stop() {
    if (!this.isStreaming) {
      return;
    }
    
    console.log('📡 Stopping AzuraCast streaming...');
    
    // Cancel reconnect
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    // Kill FFmpeg process
    if (this.ffmpegProcess) {
      this.ffmpegProcess.kill('SIGTERM');
      this.ffmpegProcess = null;
    }
    
    this.isStreaming = false;
    console.log('✅ AzuraCast streaming stopped');
  }

  /**
   * Schedule reconnect attempt
   */
  scheduleReconnect() {
    if (this.reconnectTimeout) {
      return; // Already scheduled
    }
    
    console.log(`🔄 Scheduling reconnect in ${this.reconnectDelay / 1000}s...`);
    
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      console.log('🔄 Attempting to reconnect...');
      this.start();
    }, this.reconnectDelay);
  }

  /**
   * Get audio codec based on format
   */
  getAudioCodec() {
    switch (this.config.format) {
      case 'mp3':
        return 'libmp3lame';
      case 'ogg':
        return 'libvorbis';
      case 'opus':
        return 'libopus';
      case 'aac':
        return 'aac';
      default:
        return 'libmp3lame';
    }
  }

  /**
   * Get output format
   */
  getFormat() {
    switch (this.config.format) {
      case 'mp3':
        return 'mp3';
      case 'ogg':
        return 'ogg';
      case 'opus':
        return 'opus';
      case 'aac':
        return 'adts'; // AAC in ADTS container
      default:
        return 'mp3';
    }
  }

  /**
   * Get format-specific output options
   */
  getOutputOptions() {
    const options = [
      '-ice_name', this.config.name || 'SubCaster Live',
      '-ice_description', this.config.description || 'SubCaster DJ Stream',
      '-ice_genre', this.config.genre || 'Various'
    ];
    
    // Add format-specific options
    if (this.config.format === 'opus') {
      options.push('-application', 'audio'); // Optimize for music
    }
    
    return options;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    const wasStreaming = this.isStreaming;
    
    // Stop if streaming
    if (wasStreaming) {
      this.stop();
    }
    
    // Update config
    this.config = {
      ...this.config,
      ...newConfig
    };
    
    console.log('📡 AzuraCast configuration updated');
    
    // Restart if was streaming
    if (wasStreaming) {
      this.start();
    }
  }

  /**
   * Get streaming status
   */
  getStatus() {
    return {
      isStreaming: this.isStreaming,
      server: this.config.server,
      port: this.config.port,
      mount: this.config.mount,
      format: this.config.format,
      bitrate: this.config.bitrate
    };
  }

  /**
   * Cleanup
   */
  cleanup() {
    console.log('🧹 AzuraCastOutput cleanup');
    this.stop();
  }
}
