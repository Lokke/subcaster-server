/**
 * MediaSoup WebRTC Conference Server
 * 
 * Features:
 * - Opus 320kbps audio quality
 * - Server joins as virtual "Music Player" participant
 * - All users join conference room and hear each other
 * - Mic button controls AzuraCast forwarding (not peer-to-peer)
 * - Individual volume controls for music vs voices
 * 
 * Audio Flow:
 * Server Music → All Users (always)
 * User Mics → All Users (always)
 * User Mics → AzuraCast (only when mic button active)
 */

import * as mediasoup from 'mediasoup';
import { EventEmitter } from 'events';
import { WebSocketServer } from 'ws';

class MediaSoupServer extends EventEmitter {
    constructor(audioEngine, httpServer) {
        super();
        
        this.audioEngine = audioEngine;
        this.httpServer = httpServer;
        this.worker = null;
        this.router = null;
        
        // WebSocket Server
        this.wss = null;
        
        // Participants Map: clientId → { ws, transport, producer, consumers, micButtonActive, rtpCapabilities }
        this.participants = new Map();
        
        // Server Music Producer (virtual participant)
        this.musicProducer = null;
        this.musicTransport = null;
        
        // Configuration
        this.config = {
            listenIp: '0.0.0.0',
            listenPort: 3004,
            announcedIp: null, // Auto-detect
            
            // Opus codec settings
            mediaCodecs: [
                {
                    kind: 'audio',
                    mimeType: 'audio/opus',
                    clockRate: 48000,
                    channels: 2,
                    parameters: {
                        useinbandfec: 1,
                        maxplaybackrate: 48000,
                        maxaveragebitrate: 320000, // 320 kbps!
                        stereo: 1,
                        'sprop-stereo': 1
                    }
                }
            ]
        };
    }

    /**
     * Initialize MediaSoup Worker and Router
     */
    async initialize() {
        console.log('🎙️ Initializing MediaSoup Server...');
        
        // Create worker
        this.worker = await mediasoup.createWorker({
            logLevel: 'warn',
            logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
            rtcMinPort: 40000,
            rtcMaxPort: 49999
        });

        this.worker.on('died', () => {
            console.error('💀 MediaSoup worker died! Exiting...');
            process.exit(1);
        });

        // Create router
        this.router = await this.worker.createRouter({
            mediaCodecs: this.config.mediaCodecs
        });

        console.log('✅ MediaSoup Router created');
        
        // Create server music transport (PlainTransport for PCM input)
        await this.createMusicTransport();
        
        // Setup WebSocket server
        this.setupWebSocketServer();
        
        console.log('✅ MediaSoup Server ready');
    }

    /**
     * Setup WebSocket server for client connections
     */
    setupWebSocketServer() {
        this.wss = new WebSocketServer({ noServer: true });

        this.wss.on('connection', (ws, req) => {
            const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            console.log(`📱 MediaSoup client connected: ${clientId}`);

            ws.on('message', async (message) => {
                try {
                    const data = JSON.parse(message);
                    await this.handleClientMessage(clientId, data, ws);
                } catch (error) {
                    console.error(`❌ Error handling message from ${clientId}:`, error);
                }
            });

            ws.on('close', () => {
                console.log(`📴 MediaSoup client disconnected: ${clientId}`);
                this.handleLeave(clientId);
            });

            ws.on('error', (error) => {
                console.error(`❌ WebSocket error for ${clientId}:`, error);
            });
        });

        // Register WebSocket handler for /ws/mediasoup
        if (global.wsHandlers) {
            global.wsHandlers.set('/ws/mediasoup', (request, socket, head) => {
                this.wss.handleUpgrade(request, socket, head, (ws) => {
                    this.wss.emit('connection', ws, request);
                });
            });
            console.log('✅ Registered /ws/mediasoup WebSocket handler');
        }
    }

    /**
     * Handle client messages
     */
    async handleClientMessage(clientId, data, ws) {
        switch (data.type) {
            case 'getRtpCapabilities':
                ws.send(JSON.stringify({
                    type: 'rtpCapabilities',
                    rtpCapabilities: this.getRtpCapabilities()
                }));
                break;

            case 'setRtpCapabilities':
                this.setClientRtpCapabilities(clientId, data.rtpCapabilities);
                break;

            case 'join':
                await this.handleJoin(clientId, ws);
                break;

            case 'createSendTransport':
                await this.handleCreateSendTransport(clientId, ws);
                break;

            case 'connectTransport':
                await this.handleConnectTransport(clientId, data.transportId, data.dtlsParameters, ws);
                break;

            case 'produce':
                await this.handleProduceMic(clientId, data.rtpParameters, ws);
                break;

            case 'setMicButton':
                this.handleMicButton(clientId, data.active);
                break;

            default:
                console.warn(`⚠️ Unknown message type: ${data.type}`);
        }
    }

    /**
     * Create PlainTransport for server music (replaces WebSocket audio stream)
     */
    async createMusicTransport() {
        this.musicTransport = await this.router.createPlainTransport({
            listenIp: { ip: '127.0.0.1', announcedIp: null },
            rtcpMux: false,
            comedia: true // Accept connections from any IP
        });

        // Create audio producer (music from AudioEngine)
        this.musicProducer = await this.musicTransport.produce({
            kind: 'audio',
            rtpParameters: {
                codecs: [
                    {
                        mimeType: 'audio/opus',
                        clockRate: 48000,
                        channels: 2,
                        payloadType: 111,
                        parameters: {
                            useinbandfec: 1,
                            maxaveragebitrate: 320000,
                            stereo: 1
                        }
                    }
                ],
                encodings: [{ ssrc: 11111111 }]
            }
        });

        console.log(`🎵 Music Transport: ${this.musicTransport.tuple.localIp}:${this.musicTransport.tuple.localPort}`);
        
        // Connect AudioEngine to send PCM → RTP
        this.connectAudioEngine();
    }

    /**
     * Connect AudioEngine output to MediaSoup
     */
    connectAudioEngine() {
        // TODO: Replace AudioStreamServer with RTP sender
        // AudioEngine → FFmpeg → Opus RTP → MediaSoup PlainTransport
        
        console.log('📡 Connecting AudioEngine to MediaSoup transport...');
        
        // This will replace the WebSocket audio streaming
        // FFmpeg command: 
        // ffmpeg -f s16le -ar 48000 -ac 2 -i pipe:0 \
        //        -c:a libopus -b:a 320k -application audio \
        //        -f rtp rtp://127.0.0.1:<port>
        
        this.emit('audioEngineConnected', {
            ip: this.musicTransport.tuple.localIp,
            port: this.musicTransport.tuple.localPort
        });
    }

    /**
     * Client joins conference
     */
    async handleJoin(clientId, ws) {
        console.log(`👤 Client ${clientId} joining conference...`);

        // Create WebRTC transport for client (recv transport)
        const transport = await this.router.createWebRtcTransport({
            listenIps: [{ ip: this.config.listenIp, announcedIp: this.config.announcedIp }],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            initialAvailableOutgoingBitrate: 600000
        });

        // Store participant
        if (!this.participants.has(clientId)) {
            this.participants.set(clientId, {
                ws,
                recvTransport: transport,
                sendTransport: null,
                producer: null,
                consumers: new Map(),
                micButtonActive: false,
                rtpCapabilities: null
            });
        } else {
            const participant = this.participants.get(clientId);
            participant.recvTransport = transport;
        }

        // Send transport info to client
        ws.send(JSON.stringify({
            type: 'transportCreated',
            transportId: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters
        }));

        // Subscribe to music producer
        await this.subscribeToMusic(clientId);
        
        // Subscribe to all other participants
        await this.subscribeToAllParticipants(clientId);
    }

    /**
     * Create send transport for client microphone
     */
    async handleCreateSendTransport(clientId, ws) {
        console.log(`🎤 Creating send transport for ${clientId}`);

        const transport = await this.router.createWebRtcTransport({
            listenIps: [{ ip: this.config.listenIp, announcedIp: this.config.announcedIp }],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            initialAvailableOutgoingBitrate: 300000
        });

        const participant = this.participants.get(clientId);
        if (participant) {
            participant.sendTransport = transport;
        }

        ws.send(JSON.stringify({
            type: 'sendTransportCreated',
            transportId: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters
        }));
    }

    /**
     * Subscribe client to server music
     */
    async subscribeToMusic(clientId) {
        const participant = this.participants.get(clientId);
        if (!participant || !this.musicProducer || !participant.rtpCapabilities) return;

        const consumer = await participant.recvTransport.consume({
            producerId: this.musicProducer.id,
            rtpCapabilities: participant.rtpCapabilities,
            paused: false
        });

        participant.consumers.set('music', consumer);

        participant.ws.send(JSON.stringify({
            type: 'newConsumer',
            consumerId: consumer.id,
            producerId: this.musicProducer.id,
            kind: 'audio',
            rtpParameters: consumer.rtpParameters,
            label: 'Server Music'
        }));
    }

    /**
     * Subscribe client to all other participants
     */
    async subscribeToAllParticipants(clientId) {
        const participant = this.participants.get(clientId);
        if (!participant || !participant.rtpCapabilities) return;

        for (const [peerId, peer] of this.participants) {
            if (peerId === clientId || !peer.producer) continue;

            const consumer = await participant.recvTransport.consume({
                producerId: peer.producer.id,
                rtpCapabilities: participant.rtpCapabilities,
                paused: false
            });

            participant.consumers.set(peerId, consumer);

            participant.ws.send(JSON.stringify({
                type: 'newConsumer',
                consumerId: consumer.id,
                producerId: peer.producer.id,
                kind: 'audio',
                rtpParameters: consumer.rtpParameters,
                label: `User ${peerId}`
            }));
        }
    }

    /**
     * Client connects transport (ICE/DTLS handshake)
     */
    async handleConnectTransport(clientId, transportId, dtlsParameters, ws) {
        const participant = this.participants.get(clientId);
        if (!participant) return;

        // Use transportId to identify which transport to connect
        let transport = null;
        if (participant.recvTransport && participant.recvTransport.id === transportId) {
            transport = participant.recvTransport;
        } else if (participant.sendTransport && participant.sendTransport.id === transportId) {
            transport = participant.sendTransport;
        }
        
        if (transport) {
            await transport.connect({ dtlsParameters });
            console.log(`✅ Client ${clientId} transport ${transportId.substring(0, 8)}... connected`);
        } else {
            console.error(`❌ Transport ${transportId} not found for client ${clientId}`);
            return;
        }
        
        // Send confirmation to client
        ws.send(JSON.stringify({
            type: 'transportConnected'
        }));
    }

    /**
     * Client enables microphone → creates producer
     */
    async handleProduceMic(clientId, rtpParameters, ws) {
        const participant = this.participants.get(clientId);
        if (!participant || !participant.sendTransport) return;

        participant.producer = await participant.sendTransport.produce({
            kind: 'audio',
            rtpParameters
        });

        console.log(`🎤 Client ${clientId} microphone enabled`);

        // Send producer ID back to client
        ws.send(JSON.stringify({
            type: 'produced',
            producerId: participant.producer.id
        }));

        // Broadcast to all other participants
        for (const [peerId, peer] of this.participants) {
            if (peerId === clientId || !peer.rtpCapabilities) continue;

            const consumer = await peer.recvTransport.consume({
                producerId: participant.producer.id,
                rtpCapabilities: peer.rtpCapabilities,
                paused: false
            });

            peer.consumers.set(clientId, consumer);

            peer.ws.send(JSON.stringify({
                type: 'newConsumer',
                consumerId: consumer.id,
                producerId: participant.producer.id,
                kind: 'audio',
                rtpParameters: consumer.rtpParameters,
                label: `User ${clientId}`
            }));
        }

        // Check if should forward to AzuraCast
        if (participant.micButtonActive) {
            this.forwardToAzuraCast(clientId, true);
        }
    }

    /**
     * Handle mic button toggle (AzuraCast forwarding)
     */
    handleMicButton(clientId, active) {
        const participant = this.participants.get(clientId);
        if (!participant) return;

        participant.micButtonActive = active;

        console.log(`📡 Client ${clientId} AzuraCast forwarding: ${active ? 'ON' : 'OFF'}`);

        // Enable/disable forwarding to AzuraCast
        this.forwardToAzuraCast(clientId, active);
    }

    /**
     * Forward user mic to AzuraCast output
     */
    forwardToAzuraCast(clientId, enable) {
        const participant = this.participants.get(clientId);
        if (!participant || !participant.producer) return;

        if (enable) {
            // TODO: Add this audio stream to AzuraCast mixer
            // AudioMixer should mix: ServerMusic + ActiveUserMics → AzuraCast
            console.log(`➕ Adding ${clientId} mic to AzuraCast mix`);
            this.emit('addToAzuraCastMix', clientId, participant.producer);
        } else {
            console.log(`➖ Removing ${clientId} mic from AzuraCast mix`);
            this.emit('removeFromAzuraCastMix', clientId);
        }
    }

    /**
     * Client leaves conference
     */
    async handleLeave(clientId) {
        const participant = this.participants.get(clientId);
        if (!participant) return;

        console.log(`👋 Client ${clientId} leaving conference...`);

        // Close transports
        if (participant.recvTransport) {
            participant.recvTransport.close();
        }
        if (participant.sendTransport) {
            participant.sendTransport.close();
        }

        // Remove from AzuraCast if active
        if (participant.micButtonActive) {
            this.forwardToAzuraCast(clientId, false);
        }

        // Notify other participants
        for (const [peerId, peer] of this.participants) {
            if (peerId === clientId) continue;

            const consumer = peer.consumers.get(clientId);
            if (consumer) {
                consumer.close();
                peer.consumers.delete(clientId);

                peer.ws.send(JSON.stringify({
                    type: 'consumerClosed',
                    consumerId: consumer.id
                }));
            }
        }

        this.participants.delete(clientId);
    }

    /**
     * Get RTP capabilities for client
     */
    getRtpCapabilities() {
        return this.router.rtpCapabilities;
    }

    /**
     * Store client RTP capabilities
     */
    setClientRtpCapabilities(clientId, rtpCapabilities) {
        const participant = this.participants.get(clientId);
        if (participant) {
            participant.rtpCapabilities = rtpCapabilities;
        }
    }

    /**
     * Cleanup
     */
    async cleanup() {
        console.log('🧹 MediaSoupServer cleanup');

        // Close all participants
        for (const [clientId, participant] of this.participants) {
            participant.transport.close();
        }
        this.participants.clear();

        // Close music transport
        if (this.musicTransport) {
            this.musicTransport.close();
        }

        // Close router
        if (this.router) {
            this.router.close();
        }

        // Close worker
        if (this.worker) {
            this.worker.close();
        }
    }
}

export default MediaSoupServer;
