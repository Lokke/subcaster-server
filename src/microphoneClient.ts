/**
 * microphoneClient.ts - Browser Microphone Client
 * 
 * Captures microphone audio and sends to server via WebSocket
 * Part of the group call functionality
 */

export class MicrophoneClient {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private audioWorkletNode: AudioWorkletNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private isConnected: boolean = false;
  private isMuted: boolean = false;
  private clientId: string | null = null;
  private username: string;
  private participants: Array<{clientId: string, username: string, isMuted: boolean}> = [];
  
  // Reconnect management
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private baseReconnectDelay = 1000; // 1 second
  private maxReconnectDelay = 30000; // 30 seconds
  private reconnectTimer: number | null = null;
  private isIntentionalDisconnect = false;
  private lastServerUrl: string | null = null;
  
  // Event callbacks
  public onConnected?: () => void;
  public onDisconnected?: () => void;
  public onError?: (error: string) => void;
  public onParticipantsChanged?: (participants: Array<any>) => void;

  constructor(username?: string) {
    this.username = username || `User ${Math.random().toString(36).substr(2, 5)}`;
  }

  /**
   * Connect to microphone server
   */
  async connect(serverUrl?: string): Promise<void> {
    if (this.isConnected) {
      console.warn('⚠️ Already connected to microphone server');
      return;
    }

    try {
      this.isIntentionalDisconnect = false;
      
      // Build WebSocket URL
      const wsUrl = serverUrl || this.buildWebSocketUrl();
      this.lastServerUrl = wsUrl; // Remember for reconnect
      console.log(`🎤 Connecting to microphone server: ${wsUrl}`);

      // Create WebSocket connection
      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = 'arraybuffer';

      // Setup WebSocket handlers
      this.ws.onopen = () => {
        console.log('🎤 WebSocket connected');
        this.reconnectAttempts = 0; // Reset on successful connection
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        this.onError?.('WebSocket connection error');
      };

      this.ws.onclose = () => {
        console.log('🎤 WebSocket disconnected');
        this.handleDisconnect();
        
        // Auto-reconnect unless intentionally disconnected
        if (!this.isIntentionalDisconnect) {
          this.scheduleReconnect();
        }
      };

    } catch (error) {
      console.error('❌ Failed to connect:', error);
      this.onError?.(`Connection failed: ${error}`);
      
      // Auto-reconnect on connection failure
      if (!this.isIntentionalDisconnect) {
        this.scheduleReconnect();
      }
    }
  }

  /**
   * Disconnect from server
   */
  disconnect(): void {
    console.log('🎤 Disconnecting...');
    
    this.isIntentionalDisconnect = true;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Stop microphone
    this.stopMicrophone();

    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
    this.clientId = null;
    this.onDisconnected?.();
  }

  /**
   * Schedule reconnect with exponential backoff and jitter
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ Max reconnect attempts reached');
      this.onError?.('Microphone connection lost. Please refresh the page.');
      return;
    }

    // Clear any existing timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectAttempts++;

    // Calculate delay with exponential backoff: baseDelay * 2^attempts
    const exponentialDelay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );

    // Add jitter (±25% random variation)
    const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1);
    const delay = Math.max(exponentialDelay + jitter, this.baseReconnectDelay);

    console.log(`🔄 Reconnecting microphone in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(this.lastServerUrl || undefined).catch(err => {
        console.error('❌ Microphone reconnect failed:', err);
      });
    }, delay);
  }

  /**
   * Start capturing microphone
   */
  async startMicrophone(deviceId?: string): Promise<void> {
    try {
      console.log('🎤 Starting microphone...');

      // Request microphone access
      const constraints: MediaStreamConstraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000
        }
      };

      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('✅ Microphone access granted');

      // Create audio context
      this.audioContext = new AudioContext({ sampleRate: 48000 });
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Use ScriptProcessor for audio processing (works in all browsers)
      this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
      
      this.scriptProcessor.onaudioprocess = (event) => {
        if (this.isMuted || !this.isConnected) {
          return;
        }

        // Get audio data
        const inputData = event.inputBuffer.getChannelData(0);

        // Convert to Int16 PCM
        const pcmData = this.convertToPCM(inputData);

        // Send to server
        this.sendAudioData(pcmData);
      };

      source.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.audioContext.destination);

      console.log('✅ Microphone streaming started');

    } catch (error) {
      console.error('❌ Failed to start microphone:', error);
      this.onError?.(`Microphone access denied: ${error}`);
      throw error;
    }
  }

  /**
   * Stop microphone capture
   */
  stopMicrophone(): void {
    console.log('🎤 Stopping microphone...');

    // Stop script processor
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }

    // Stop audio worklet
    if (this.audioWorkletNode) {
      this.audioWorkletNode.disconnect();
      this.audioWorkletNode = null;
    }

    // Stop media stream
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    // Close audio context
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  /**
   * Mute/unmute microphone
   */
  setMuted(muted: boolean): void {
    this.isMuted = muted;
    console.log(`🎤 Microphone ${muted ? 'muted' : 'unmuted'}`);

    // Send mute state to server
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'mute',
        data: { muted }
      }));
    }
  }

  /**
   * Get available microphone devices
   */
  async getMicrophones(): Promise<MediaDeviceInfo[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(device => device.kind === 'audioinput');
    } catch (error) {
      console.error('❌ Failed to enumerate devices:', error);
      return [];
    }
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: any): void {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'welcome':
          this.handleWelcome(message);
          break;

        case 'joined':
          this.handleJoined(message);
          break;

        case 'participants':
          this.handleParticipants(message);
          break;

        case 'answer':
          this.handleAnswer(message);
          break;

        case 'error':
          console.error('❌ Server error:', message.message);
          this.onError?.(message.message);
          break;

        default:
          console.warn('⚠️ Unknown message type:', message.type);
      }

    } catch (error) {
      console.error('❌ Error handling message:', error);
    }
  }

  /**
   * Handle welcome message
   */
  private handleWelcome(message: any): void {
    this.clientId = message.clientId;
    console.log(`🎤 Connected with client ID: ${this.clientId}`);

    // Join the group call
    this.ws?.send(JSON.stringify({
      type: 'join',
      data: { username: this.username }
    }));
  }

  /**
   * Handle joined confirmation
   */
  private handleJoined(message: any): void {
    console.log(`🎤 Joined group call`);
    this.isConnected = true;
    this.participants = message.participants || [];
    this.onConnected?.();
    this.onParticipantsChanged?.(this.participants);
  }

  /**
   * Handle answer (from server about audio format)
   */
  private handleAnswer(message: any): void {
    console.log('🎤 Server audio format:', message.format);
    // Server confirmed we should send audio via WebSocket
  }

  /**
   * Handle participants list update
   */
  private handleParticipants(message: any): void {
    this.participants = message.participants || [];
    console.log(`🎤 Participants updated: ${this.participants.length} users`);
    this.onParticipantsChanged?.(this.participants);
  }

  /**
   * Handle disconnect
   */
  private handleDisconnect(): void {
    this.isConnected = false;
    this.clientId = null;
    this.stopMicrophone();
    this.onDisconnected?.();
  }

  /**
   * Send audio data to server
   */
  private sendAudioData(pcmData: Int16Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      // Send raw PCM data as binary
      this.ws.send(pcmData.buffer);
    } catch (error) {
      console.error('❌ Error sending audio data:', error);
    }
  }

  /**
   * Convert Float32 audio to Int16 PCM
   */
  private convertToPCM(float32Data: Float32Array): Int16Array {
    const pcmData = new Int16Array(float32Data.length);

    for (let i = 0; i < float32Data.length; i++) {
      const sample = Math.max(-1, Math.min(1, float32Data[i]));
      pcmData[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    }

    return pcmData;
  }

  /**
   * Build WebSocket URL from current page
   */
  private buildWebSocketUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Use same host as the web app (includes port)
    const host = window.location.host;
    return `${protocol}//${host}/ws/microphone`;
  }

  /**
   * Get connection status
   */
  isActive(): boolean {
    return this.isConnected;
  }

  /**
   * Get mute status
   */
  getMuted(): boolean {
    return this.isMuted;
  }

  /**
   * Get current participants
   */
  getParticipants(): Array<any> {
    return this.participants;
  }

  /**
   * Get client ID
   */
  getClientId(): string | null {
    return this.clientId;
  }
}
