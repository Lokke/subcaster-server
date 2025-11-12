/**
 * serverClient.ts - Client for server-side audio engine
 * 
 * Communicates with server via WebSocket to control decks
 * Receives monitor audio stream from server
 */

export interface DeckState {
  id: string;
  state: 'empty' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error';
  track: {
    id?: string;
    title: string;
    artist: string;
    album: string;
    duration: number;
    coverArt?: string;
  } | null;
  volume: number;
  position: number;
  duration: number;
}

export interface AllStates {
  decks: {
    a: DeckState;
    b: DeckState;
    c: DeckState;
    d: DeckState;
  };
  volumes: {
    master: number;
    stream: number;
    microphone: number;
  };
}

export class ServerClient {
  private commandWs: WebSocket | null = null;
  // audioWs removed - audio now via MediaSoup WebRTC
  private audioContext: AudioContext | null = null; // Kept for compatibility, not used
  private clientId: string | null = null;
  private isControlGranted: boolean = false;
  private audioReconnectTimeout: number | null = null; // Kept for compatibility

  // Reconnect management
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private baseReconnectDelay = 1000; // 1 second
  private maxReconnectDelay = 30000; // 30 seconds
  private reconnectTimer: number | null = null;
  private isIntentionalDisconnect = false;

  // Event callbacks
  public onConnected?: () => void;
  public onDisconnected?: () => void;
  public onStateChange?: (state: DeckState) => void;
  public onPositionUpdate?: (deck: string, position: number) => void;
  public onControlGranted?: () => void;
  public onControlDenied?: () => void;
  public onError?: (error: string) => void;
  public onQueueUpdate?: (queue: any[]) => void;
  public onInitialStateSync?: (state: any) => void;

  constructor() {}

  /**
   * Connect to server
   */
  async connect(): Promise<void> {
    try {
      this.isIntentionalDisconnect = false;
      console.log('[WS-CLIENT] 🔌 Connecting to command server...');

      // Connect to command WebSocket
      const commandUrl = this.buildWebSocketUrl('/ws/commands');
      this.commandWs = new WebSocket(commandUrl);

      this.commandWs.onopen = () => {
        console.log('[WS-CLIENT] ✅ Connected to command server');
        this.reconnectAttempts = 0; // Reset on successful connection
      };

      this.commandWs.onmessage = (event) => {
        this.handleCommandMessage(event.data);
      };

      this.commandWs.onerror = (error) => {
        console.error('[WS-CLIENT] ❌ Command WebSocket error:', error);
        this.onError?.('Command connection error');
      };

      this.commandWs.onclose = (event) => {
        console.log('[WS-CLIENT] 📴 Disconnected from command server (code: ' + event.code + ', reason: ' + event.reason + ')');
        this.onDisconnected?.();
        
        // Auto-reconnect unless intentionally disconnected
        if (!this.isIntentionalDisconnect) {
          this.scheduleReconnect();
        }
      };

      // Audio is now handled by MediaSoup (not via WebSocket)
      // Legacy audio WebSocket connection removed

    } catch (error) {
      console.error('[WS-CLIENT] ❌ Failed to connect:', error);
      this.onError?.(`Connection failed: ${error}`);
      
      // Auto-reconnect on connection failure
      if (!this.isIntentionalDisconnect) {
        this.scheduleReconnect();
      }
    }
  }

  /**
   * Connect to audio stream
   * @deprecated Audio is now handled by MediaSoup WebRTC
   */
  private async connectAudioStream(): Promise<void> {
    // Audio streaming is now handled by MediaSoup
    // This method is deprecated and does nothing
    console.log('ℹ️ Audio streaming via MediaSoup (not WebSocket)');
  }

  /**
   * Disconnect from server
   */
  disconnect(): void {
    console.log('🔌 Disconnecting from server...');
    
    this.isIntentionalDisconnect = true;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.audioReconnectTimeout) {
      clearTimeout(this.audioReconnectTimeout);
      this.audioReconnectTimeout = null;
    }

    if (this.commandWs) {
      this.commandWs.close();
      this.commandWs = null;
    }

    // Audio is now handled by MediaSoup, no audioWs to close
    
    // AudioContext is no longer used (MediaSoup handles audio)
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.isControlGranted = false;
    this.clientId = null;
  }

  /**
   * Schedule reconnect with exponential backoff and jitter
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WS-CLIENT] ❌ Max reconnect attempts reached');
      this.onError?.('Connection lost. Please refresh the page.');
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

    console.log(`[WS-CLIENT] 🔄 Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(err => {
        console.error('[WS-CLIENT] ❌ Reconnect failed:', err);
      });
    }, delay);
  }

  /**
   * Request DJ control
   */
  requestControl(): void {
    this.sendCommand({ type: 'requestControl' });
  }

  /**
   * Release DJ control
   */
  releaseControl(): void {
    this.sendCommand({ type: 'releaseControl' });
  }

  /**
   * Load track to deck
   */
  loadTrack(deck: string, url: string, metadata: any): void {
    this.sendCommand({
      type: 'loadTrack',
      data: { deck, url, metadata }
    });
  }

  /**
   * Play deck
   */
  play(deck: string): void {
    this.sendCommand({
      type: 'play',
      data: { deck }
    });
  }

  /**
   * Pause deck
   */
  pause(deck: string): void {
    this.sendCommand({
      type: 'pause',
      data: { deck }
    });
  }

  /**
   * Seek deck
   */
  seek(deck: string, time: number): void {
    this.sendCommand({
      type: 'seek',
      data: { deck, time }
    });
  }

  /**
   * Set deck volume
   */
  setVolume(deck: string, volume: number): void {
    this.sendCommand({
      type: 'setVolume',
      data: { deck, volume }
    });
  }

  /**
   * Clear deck
   */
  clear(deck: string): void {
    this.sendCommand({
      type: 'clear',
      data: { deck }
    });
  }

  /**
   * Get current state
   */
  getState(): void {
    this.sendCommand({ type: 'getState' });
  }

  /**
   * Queue Management
   */
  queueAdd(item: any): void {
    this.sendCommand({
      type: 'queueAdd',
      data: item
    });
  }

  queueRemove(index: number): void {
    this.sendCommand({
      type: 'queueRemove',
      data: { index }
    });
  }

  queueReorder(fromIndex: number, toIndex: number): void {
    this.sendCommand({
      type: 'queueReorder',
      data: { fromIndex, toIndex }
    });
  }

  queueClear(): void {
    this.sendCommand({ type: 'queueClear' });
  }

  queuePlayNext(item: any): void {
    this.sendCommand({
      type: 'queuePlayNext',
      data: item
    });
  }

  queueGetNext(): void {
    this.sendCommand({ type: 'queueGetNext' });
  }

  /**
   * Send command to server
   */
  private sendCommand(message: any): void {
    if (!this.commandWs || this.commandWs.readyState !== WebSocket.OPEN) {
      console.warn('⚠️ Command WebSocket not connected');
      return;
    }

    try {
      this.commandWs.send(JSON.stringify(message));
    } catch (error) {
      console.error('❌ Error sending command:', error);
      this.onError?.(`Failed to send command: ${error}`);
    }
  }

  /**
   * Handle command message
   */
  private handleCommandMessage(data: any): void {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'welcome':
          this.handleWelcome(message);
          break;

        case 'deckStateChange':
          this.onStateChange?.(message.data);
          break;

        case 'deckPosition':
          this.onPositionUpdate?.(message.data.deck, message.data.position);
          break;

        case 'controlGranted':
          this.isControlGranted = true;
          this.onControlGranted?.();
          break;

        case 'controlDenied':
          this.isControlGranted = false;
          this.onControlDenied?.();
          break;

        case 'error':
          console.error('❌ Server error:', message.message);
          this.onError?.(message.message);
          break;

        case 'queueUpdate':
          console.log('📋 Queue update from server:', message.queue.length, 'items');
          this.onQueueUpdate?.(message.queue);
          break;

        default:
          console.log('📨 Server message:', message.type);
      }

    } catch (error) {
      console.error('❌ Error handling command message:', error);
    }
  }

  /**
   * Handle welcome message
   */
  private handleWelcome(message: any): void {
    this.clientId = message.clientId;
    console.log(`[WS-CLIENT] 🔌 Connected with client ID: ${this.clientId}`);
    console.log('[WS-CLIENT] 📊 Initial state:', message.state);
    
    // Trigger complete state sync (decks + queue)
    if (message.state) {
      console.log('[WS-CLIENT] 🔄 Syncing initial state from server...');
      this.onInitialStateSync?.(message.state);
      
      // Apply initial deck states
      if (message.state.decks) {
        for (const [deckName, deckState] of Object.entries(message.state.decks)) {
          this.onStateChange?.(deckState as DeckState);
        }
      }
      
      // Apply initial queue
      if (message.state.queue) {
        this.onQueueUpdate?.(message.state.queue);
      }
    }
    
    // Notify connection established
    this.onConnected?.();
    
    // Automatically request DJ control after connection is established
    console.log('[WS-CLIENT] 🎛️ Automatically requesting DJ control...');
    this.requestControl();
  }

  /**
   * Handle audio message
   */
  private async handleAudioMessage(data: any): Promise<void> {
    // First message is JSON with audio format
    if (typeof data === 'string') {
      const format = JSON.parse(data);
      console.log('🔊 Audio format:', format);

      // Initialize Web Audio API
      this.audioContext = new AudioContext({ sampleRate: format.sampleRate });
      return;
    }

    // Binary data is PCM audio
    if (!this.audioContext) {
      return;
    }

    try {
      // Convert Int16 PCM to Float32 for Web Audio API
      const pcmData = new Int16Array(data);
      const float32Data = new Float32Array(pcmData.length);

      for (let i = 0; i < pcmData.length; i++) {
        float32Data[i] = pcmData[i] / 32768.0;
      }

      // Play audio chunk
      await this.playAudioChunk(float32Data);

    } catch (error) {
      console.error('❌ Error playing audio:', error);
    }
  }

  /**
   * Play audio chunk
   */
  private async playAudioChunk(float32Data: Float32Array): Promise<void> {
    if (!this.audioContext) {
      return;
    }

    try {
      // Create audio buffer (stereo)
      const channels = 2;
      const samplesPerChannel = float32Data.length / channels;
      const audioBuffer = this.audioContext.createBuffer(
        channels,
        samplesPerChannel,
        this.audioContext.sampleRate
      );

      // Fill buffer with interleaved data
      const leftChannel = audioBuffer.getChannelData(0);
      const rightChannel = audioBuffer.getChannelData(1);

      for (let i = 0; i < samplesPerChannel; i++) {
        leftChannel[i] = float32Data[i * 2];
        rightChannel[i] = float32Data[i * 2 + 1];
      }

      // Create buffer source and play
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);
      source.start();

    } catch (error) {
      console.error('❌ Error in playAudioChunk:', error);
    }
  }

  /**
   * Build WebSocket URL
   */
  private buildWebSocketUrl(path: string): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Use same host as the web app (includes port)
    const host = window.location.host;
    return `${protocol}//${host}${path}`;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.commandWs !== null && this.commandWs.readyState === WebSocket.OPEN;
  }

  /**
   * Check if control is granted
   */
  hasControl(): boolean {
    return this.isControlGranted;
  }
}
