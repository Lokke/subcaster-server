/**
 * MediaSoup Client for WebRTC Conference
 * 
 * Features:
 * - Receives server music stream (Opus 320kbps)
 * - Sends microphone to conference (heard by all users)
 * - Mic button controls AzuraCast forwarding
 * - Individual volume controls for music vs voices
 */

// @ts-ignore - Will be available after npm install mediasoup-client
import { Device } from 'mediasoup-client';

type Transport = any;
type Consumer = any;
type Producer = any;

interface ParticipantStream {
    consumerId: string;
    stream: MediaStream;
    audioElement: HTMLAudioElement;
    gainNode: GainNode;
    label: string;
}

export class MediaSoupClient {
    private ws: WebSocket | null = null;
    private device: Device | null = null;
    private sendTransport: Transport | null = null;
    private recvTransport: Transport | null = null;
    
    private micProducer: Producer | null = null;
    private micButtonActive: boolean = false;
    
    // Streams: 'music' or participantId → ParticipantStream
    private streams: Map<string, ParticipantStream> = new Map();
    
    private audioContext: AudioContext;
    private masterGain: GainNode;
    private musicGain: GainNode;
    private voicesGain: GainNode;
    
    private serverUrl: string;
    
    // Callbacks for UI updates
    public onParticipantJoined?: (participantId: string, isMusic: boolean) => void;
    public onParticipantLeft?: (participantId: string) => void;
    public onAudioLevel?: (participantId: string, level: number) => void;
    
    /**
     * Get all active streams (for UI)
     */
    public getStreams(): Map<string, ParticipantStream> {
        return this.streams;
    }
    
    constructor(serverUrl: string = 'ws://localhost:3004') {
        this.serverUrl = serverUrl;
        
        // Audio routing: All streams → GainNodes → Master → Destination
        // Let browser choose optimal sample rate (don't force 48000)
        this.audioContext = new AudioContext();
        console.log(`[CONFERENCE] 🎵 AudioContext created with sample rate: ${this.audioContext.sampleRate}Hz`);
        
        this.masterGain = this.audioContext.createGain();
        this.musicGain = this.audioContext.createGain();
        this.voicesGain = this.audioContext.createGain();
        
        // Default volumes
        this.musicGain.gain.value = 1.0;
        this.voicesGain.gain.value = 1.0;
        this.masterGain.gain.value = 1.0;
        
        // Connect: Music/Voices → Master → Output
        this.musicGain.connect(this.masterGain);
        this.voicesGain.connect(this.masterGain);
        this.masterGain.connect(this.audioContext.destination);
    }

    /**
     * Connect to MediaSoup server
     */
    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            // Overall timeout for connection
            const connectionTimeout = setTimeout(() => {
                console.error('❌ MediaSoup connection timeout');
                if (this.ws) {
                    this.ws.close();
                }
                reject(new Error('Connection timeout'));
            }, 15000); // 15 seconds total timeout
            
            this.ws = new WebSocket(this.serverUrl);
            
            this.ws.onopen = () => {
                console.log('✅ Connected to MediaSoup server');
                
                // Setup message handler BEFORE initializing device
                this.ws!.onmessage = (event) => {
                    this.handleMessage(JSON.parse(event.data));
                };
                
                // Initialize device (async but don't await in callback)
                this.initializeDevice()
                    .then(() => {
                        clearTimeout(connectionTimeout);
                        console.log('✅ Device initialized successfully');
                        resolve();
                    })
                    .catch((err) => {
                        clearTimeout(connectionTimeout);
                        console.error('❌ Device initialization failed:', err);
                        reject(err);
                    });
            };
            
            this.ws.onerror = (error) => {
                clearTimeout(connectionTimeout);
                console.error('❌ WebSocket error:', error);
                reject(error);
            };
            
            this.ws.onclose = () => {
                console.log('📴 Disconnected from MediaSoup server');
                this.cleanup();
            };
        });
    }

    /**
     * Initialize MediaSoup Device
     */
    private async initializeDevice(): Promise<void> {
        this.device = new Device();
        
        // Request RTP capabilities from server
        this.send({ type: 'getRtpCapabilities' });
        
        // Wait for rtpCapabilities response via handleMessage
        return new Promise((resolve, reject) => {
            // Set timeout for safety
            const timeout = setTimeout(() => {
                reject(new Error('Device initialization timeout'));
            }, 10000);
            
            // Store resolve function to be called by handleMessage
            (this as any).deviceInitResolve = () => {
                clearTimeout(timeout);
                resolve();
            };
        });
    }

    /**
     * Handle server messages
     */
    private async handleMessage(data: any): Promise<void> {
        console.log('[CONFERENCE] 📨 Received message:', data.type);
        
        switch (data.type) {
            case 'rtpCapabilities':
                console.log('[CONFERENCE] 📡 Loading RTP capabilities...');
                // Load device with router capabilities
                await this.device!.load({ routerRtpCapabilities: data.rtpCapabilities });
                console.log('[CONFERENCE] ✅ Device loaded with RTP capabilities');
                
                // Send our capabilities to server
                console.log('[CONFERENCE] 📤 Sending client RTP capabilities to server');
                this.send({
                    type: 'setRtpCapabilities',
                    rtpCapabilities: this.device!.rtpCapabilities
                });
                
                // DON'T send join yet - wait for rtpCapabilitiesSet confirmation
                console.log('[CONFERENCE] ⏳ Waiting for server to confirm RTP capabilities...');
                
                // Resolve device initialization
                if ((this as any).deviceInitResolve) {
                    (this as any).deviceInitResolve();
                    delete (this as any).deviceInitResolve;
                }
                break;
            
            case 'rtpCapabilitiesSet':
                // Server confirmed our capabilities are set, NOW we can join
                console.log('[CONFERENCE] ✅ Server confirmed RTP capabilities set');
                console.log('[CONFERENCE] 📤 Sending join request');
                this.send({ type: 'join' });
                break;
            
            case 'transportCreated':
                console.log('[CONFERENCE] 🚚 Transport created, setting up...');
                await this.createTransports(data);
                break;
            
            case 'transportConnected':
                // Call the stored callback to complete transport connection
                if ((this as any).transportConnectCallback) {
                    (this as any).transportConnectCallback();
                    delete (this as any).transportConnectCallback;
                    delete (this as any).transportConnectErrback;
                    console.log('[CONFERENCE] ✅ Recv transport connected to server');
                }
                // Also check for send transport callback
                if ((this as any).sendTransportConnectCallback) {
                    (this as any).sendTransportConnectCallback();
                    delete (this as any).sendTransportConnectCallback;
                    delete (this as any).sendTransportConnectErrback;
                    console.log('[CONFERENCE] ✅ Send transport connected to server');
                }
                break;
            
            case 'sendTransportCreated':
                console.log('[CONFERENCE] 🚚 Send transport created');
                await this.setupSendTransport(data);
                break;
            
            case 'produced':
                // Call the stored produce callback with producer ID
                if ((this as any).produceCallback) {
                    (this as any).produceCallback({ id: data.producerId });
                    delete (this as any).produceCallback;
                    delete (this as any).produceErrback;
                    console.log('[CONFERENCE] ✅ Producer created:', data.producerId);
                }
                break;
                
            case 'newConsumer':
                console.log('[CONFERENCE] 🆕 New consumer message received');
                await this.consumeStream(data);
                break;
                
            case 'consumerClosed':
                console.log('[CONFERENCE] 🚪 Consumer closed:', data.consumerId);
                this.closeConsumer(data.consumerId);
                break;
                
            default:
                console.log('[CONFERENCE] 📨 Unknown message:', data);
        }
    }

    /**
     * Create send and receive transports
     */
    private async createTransports(data: any): Promise<void> {
        // Receive Transport (for music + other users)
        this.recvTransport = this.device!.createRecvTransport({
            id: data.transportId,
            iceParameters: data.iceParameters,
            iceCandidates: data.iceCandidates,
            dtlsParameters: data.dtlsParameters
        });
        
        this.recvTransport.on('connect', ({ dtlsParameters }: any, callback: any, errback: any) => {
            // Store callback to be called when server responds
            (this as any).transportConnectCallback = callback;
            (this as any).transportConnectErrback = errback;
            
            this.send({
                type: 'connectTransport',
                transportId: this.recvTransport!.id,
                dtlsParameters
            });
        });
        
        // Send Transport (for microphone)
        // Request separate send transport
        this.send({ type: 'createSendTransport' });
    }

    /**
     * Consume incoming stream (music or user voice)
     */
    private async consumeStream(data: any): Promise<void> {
        console.log('[CONFERENCE] 📥 Received newConsumer message:', {
            consumerId: data.consumerId,
            producerId: data.producerId,
            label: data.label,
            kind: data.kind,
            hasRecvTransport: !!this.recvTransport
        });
        
        if (!this.recvTransport) {
            console.error('[CONFERENCE] ❌ No receive transport available!');
            return;
        }
        
        const consumer = await this.recvTransport.consume({
            id: data.consumerId,
            producerId: data.producerId,
            kind: data.kind,
            rtpParameters: data.rtpParameters
        });
        
        console.log('[CONFERENCE] ✅ Consumer created:', consumer.id);
        
        const stream = new MediaStream([consumer.track]);
        const audioElement = new Audio();
        audioElement.srcObject = stream;
        audioElement.autoplay = true;
        
        console.log('[CONFERENCE] 🔊 Audio element created, autoplay:', audioElement.autoplay);
        
        // Create gain node for volume control
        const source = this.audioContext.createMediaStreamSource(stream);
        const gainNode = this.audioContext.createGain();
        
        // Route to music or voices gain
        const isMusicStream = data.label === 'Server Music';
        source.connect(gainNode);
        gainNode.connect(isMusicStream ? this.musicGain : this.voicesGain);
        
        // Store stream
        const streamId = isMusicStream ? 'music' : data.producerId;
        this.streams.set(streamId, {
            consumerId: data.consumerId,
            stream,
            audioElement,
            gainNode,
            label: data.label
        });
        
        console.log('[CONFERENCE] 🎧 Stream stored:', {
            streamId,
            label: data.label,
            isMusic: isMusicStream,
            totalStreams: this.streams.size
        });
        
        console.log(`🎧 Consuming: ${data.label} (${isMusicStream ? 'Music' : 'Voice'})`);
        
        // Notify UI about new participant
        if (this.onParticipantJoined) {
            console.log('[CONFERENCE] 🔔 Calling onParticipantJoined callback');
            this.onParticipantJoined(streamId, isMusicStream);
        } else {
            console.warn('[CONFERENCE] ⚠️ No onParticipantJoined callback set!');
        }
        
        // Setup audio level monitoring for ALL streams (music + voices)
        this.monitorAudioLevel(streamId, source);
    }

    /**
     * Monitor audio levels for a stream
     */
    private monitorAudioLevel(streamId: string, sourceNode: MediaStreamAudioSourceNode): void {
        const analyser = this.audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        
        sourceNode.connect(analyser);
        
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        
        const updateLevel = () => {
            if (!this.streams.has(streamId)) return; // Stream was removed
            
            analyser.getByteFrequencyData(dataArray);
            
            // Calculate average level
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
            }
            const average = sum / dataArray.length;
            const normalized = average / 255; // 0-1 range
            
            // Notify UI
            if (this.onAudioLevel && normalized > 0.01) {
                this.onAudioLevel(streamId, normalized);
            }
            
            requestAnimationFrame(updateLevel);
        };
        
        updateLevel();
    }

    /**
     * Close consumer
     */
    private closeConsumer(consumerId: string): void {
        for (const [streamId, streamInfo] of this.streams) {
            if (streamInfo.consumerId === consumerId) {
                streamInfo.audioElement.pause();
                streamInfo.audioElement.srcObject = null;
                streamInfo.gainNode.disconnect();
                this.streams.delete(streamId);
                console.log(`❌ Consumer closed: ${streamInfo.label}`);
                
                // Notify UI about participant leaving
                if (this.onParticipantLeft) {
                    this.onParticipantLeft(streamId);
                }
                break;
            }
        }
    }

    /**
     * Enable microphone
     */
    async enableMicrophone(): Promise<void> {
        if (this.micProducer) {
            console.log('⚠️ Microphone already enabled');
            return;
        }
        
        // Get user media
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000
            }
        });
        
        const audioTrack = stream.getAudioTracks()[0];
        
        // Create send transport if not exists
        if (!this.sendTransport) {
            await this.createSendTransport();
        }
        
        // Produce microphone
        this.micProducer = await this.sendTransport!.produce({
            track: audioTrack,
            codecOptions: {
                opusStereo: false,
                opusDtx: true,
                opusFec: true,
                opusMaxAverageBitrate: 128000
            }
        });
        
        console.log('🎤 Microphone enabled');
    }

    /**
     * Setup send transport when server creates it
     */
    private async setupSendTransport(data: any): Promise<void> {
        this.sendTransport = this.device!.createSendTransport({
            id: data.transportId,
            iceParameters: data.iceParameters,
            iceCandidates: data.iceCandidates,
            dtlsParameters: data.dtlsParameters
        });
        
        this.sendTransport.on('connect', ({ dtlsParameters }: any, callback: any, errback: any) => {
            // Store callback to be called when server responds
            (this as any).sendTransportConnectCallback = callback;
            (this as any).sendTransportConnectErrback = errback;
            
            this.send({
                type: 'connectTransport',
                transportId: this.sendTransport!.id,
                dtlsParameters
            });
        });
        
        this.sendTransport.on('produce', ({ kind, rtpParameters }: any, callback: any, errback: any) => {
            // Store callback to be called when server responds with producer ID
            (this as any).produceCallback = callback;
            (this as any).produceErrback = errback;
            
            this.send({
                type: 'produce',
                transportId: this.sendTransport!.id,
                kind,
                rtpParameters
            });
        });
        
        console.log('✅ Send transport created');
    }

    /**
     * Create send transport
     */
    private async createSendTransport(): Promise<void> {
        // Just send the request - response will be handled by handleMessage
        this.send({ type: 'createSendTransport' });
    }

    /**
     * Disable microphone
     */
    disableMicrophone(): void {
        if (this.micProducer) {
            this.micProducer.close();
            this.micProducer = null;
            console.log('🎤 Microphone disabled');
        }
    }

    /**
     * Toggle mic button (AzuraCast forwarding)
     */
    setMicButtonActive(active: boolean): void {
        this.micButtonActive = active;
        
        this.send({
            type: 'setMicButton',
            active
        });
        
        console.log(`📡 AzuraCast forwarding: ${active ? 'ON' : 'OFF'}`);
    }

    /**
     * Set music volume (0.0 - 1.0)
     */
    setMusicVolume(volume: number): void {
        this.musicGain.gain.value = Math.max(0, Math.min(1, volume));
    }

    /**
     * Set voices volume (0.0 - 1.0)
     */
    setVoicesVolume(volume: number): void {
        this.voicesGain.gain.value = Math.max(0, Math.min(1, volume));
    }

    /**
     * Set master volume (0.0 - 1.0)
     */
    setMasterVolume(volume: number): void {
        this.masterGain.gain.value = Math.max(0, Math.min(1, volume));
    }

    /**
     * Send message to server
     */
    private send(data: any): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    /**
     * Cleanup
     */
    private cleanup(): void {
        // Close all streams
        for (const [streamId, streamInfo] of this.streams) {
            streamInfo.audioElement.pause();
            streamInfo.audioElement.srcObject = null;
            streamInfo.gainNode.disconnect();
        }
        this.streams.clear();
        
        // Close transports
        if (this.sendTransport) {
            this.sendTransport.close();
            this.sendTransport = null;
        }
        
        if (this.recvTransport) {
            this.recvTransport.close();
            this.recvTransport = null;
        }
        
        // Close audio context
        this.audioContext.close();
    }

    /**
     * Disconnect from server
     */
    disconnect(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}
