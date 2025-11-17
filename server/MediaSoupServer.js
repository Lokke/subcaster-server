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
import { networkInterfaces } from 'os';

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
            // Use public IP from env, fallback to detected local IP
            announcedIp: process.env.PUBLIC_IP || this.getLocalIp(),
            
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
     * Get local network IP address
     */
    getLocalIp() {
        const nets = networkInterfaces();
        
        for (const name of Object.keys(nets)) {
            for (const net of nets[name]) {
                // Skip internal (loopback) and non-IPv4 addresses
                if (net.family === 'IPv4' && !net.internal) {
                    const detectedIp = net.address;
                    console.log(`🌐 Detected local IP for WebRTC: ${detectedIp} (interface: ${name})`);
                    return detectedIp;
                }
            }
        }
        
        console.warn('⚠️ Could not detect local IP, using localhost');
        return '127.0.0.1';
    }

    /**
     * Get public IP address from external service
     */
    async getPublicIp() {
        try {
            // Try multiple services for reliability
            const services = [
                'https://api.ipify.org',
                'https://icanhazip.com',
                'https://ifconfig.me/ip'
            ];

            for (const service of services) {
                try {
                    const response = await fetch(service, { timeout: 3000 });
                    if (response.ok) {
                        const ip = (await response.text()).trim();
                        if (this.isValidIp(ip)) {
                            console.log(`🌍 Detected public IP for WebRTC: ${ip}`);
                            return ip;
                        }
                    }
                } catch (err) {
                    console.warn(`⚠️ Failed to get IP from ${service}:`, err.message);
                }
            }
            
            throw new Error('All IP detection services failed');
        } catch (error) {
            console.error('❌ Failed to detect public IP:', error.message);
            return null;
        }
    }

    /**
     * Validate IP address format
     */
    isValidIp(ip) {
        const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
        if (!ipv4Regex.test(ip)) return false;
        
        const parts = ip.split('.');
        return parts.every(part => {
            const num = parseInt(part, 10);
            return num >= 0 && num <= 255;
        });
    }

    /**
     * Initialize MediaSoup Worker and Router
     */
    async initialize() {
        console.log('🎙️ Initializing MediaSoup Server...');
        
        // Get announced IP (public IP with fallback to local)
        if (!this.config.announcedIp) {
            console.log('🔍 No PUBLIC_IP set, detecting automatically...');
            const publicIp = await this.getPublicIp();
            this.config.announcedIp = publicIp || this.getLocalIp();
        }
        console.log(`📡 WebRTC will announce IP: ${this.config.announcedIp}`);
        
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
        // Ensure participant exists with ws reference on first message
        if (!this.participants.has(clientId)) {
            console.log(`[MEDIASOUP-SERVER] 🆕 Creating initial participant entry for ${clientId}`);
            this.participants.set(clientId, {
                ws,
                recvTransport: null,
                sendTransport: null,
                producer: null,
                consumers: new Map(),
                micButtonActive: false,
                rtpCapabilities: null,
                username: `User ${clientId.split('_')[2]}` // Simple username from timestamp
            });
        } else if (!this.participants.get(clientId).ws) {
            // Update ws reference if participant was created early (shouldn't happen now)
            console.log(`[MEDIASOUP-SERVER] 🔄 Adding ws reference to existing participant ${clientId}`);
            this.participants.get(clientId).ws = ws;
        }

        switch (data.type) {
            case 'getRtpCapabilities':
                ws.send(JSON.stringify({
                    type: 'rtpCapabilities',
                    rtpCapabilities: this.getRtpCapabilities()
                }));
                break;

            case 'setRtpCapabilities':
                await this.setClientRtpCapabilities(clientId, data.rtpCapabilities);
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
     * Connect Liquidsoap output to MediaSoup
     */
    connectAudioEngine() {
        // Liquidsoap → RTP Opus (port 5004) → MediaSoup PlainTransport
        
        console.log('📡 Connecting Liquidsoap RTP to MediaSoup transport...');
        
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
        console.log(`[MEDIASOUP-SERVER] 👤 Client ${clientId} joining conference...`);

        // Create WebRTC transport for client (recv transport)
        const transport = await this.router.createWebRtcTransport({
            listenIps: [{ ip: this.config.listenIp, announcedIp: this.config.announcedIp }],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            initialAvailableOutgoingBitrate: 600000
        });
        
        // Log ICE connection events
        transport.on('icestatechange', (iceState) => {
            console.log(`🔌 Transport ${transport.id} ICE state: ${iceState}`);
        });

        transport.on('iceselectedtuplechange', (tuple) => {
            console.log(`✅ Transport ${transport.id} ICE candidate selected:`);
            console.log(`   Local:  ${tuple.localIp}:${tuple.localPort} (${tuple.protocol})`);
            console.log(`   Remote: ${tuple.remoteIp}:${tuple.remotePort}`);
        });
        
        console.log(`[MEDIASOUP-SERVER] ✅ Recv transport created:`, transport.id);

        // Store participant
        if (!this.participants.has(clientId)) {
            console.log(`[MEDIASOUP-SERVER] 🆕 Creating new participant entry`);
            this.participants.set(clientId, {
                ws,
                recvTransport: transport,
                sendTransport: null,
                producer: null,
                consumers: new Map(),
                micButtonActive: false,
                rtpCapabilities: null,
                username: `User ${clientId.split('_')[2]}` // Use timestamp part as simple username
            });
        } else {
            console.log(`[MEDIASOUP-SERVER] 🔄 Updating existing participant with ws and recvTransport`);
            const participant = this.participants.get(clientId);
            participant.ws = ws;  // Add ws reference if it was created early
            participant.recvTransport = transport;
            if (!participant.username) {
                participant.username = `User ${clientId.split('_')[2]}`;
            }
        }

        // Get participant info for messages
        const participant = this.participants.get(clientId);

        // Send transport info to client
        ws.send(JSON.stringify({
            type: 'transportCreated',
            transportId: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
            clientId: clientId, // Send client their own ID
            username: participant.username || `User ${clientId}`
        }));
        
        // Send list of all existing participants (including Echo User)
        const participantsList = [];
        for (const [participantId, p] of this.participants.entries()) {
            if (participantId !== clientId && p.username) {
                participantsList.push({
                    id: participantId,
                    username: p.username,
                    hasAudio: participantId === 'echo-test-user' || !!p.producer // Echo User always has "mic"
                });
            }
        }
        
        if (participantsList.length > 0) {
            console.log(`[MEDIASOUP-SERVER] 📋 Sending ${participantsList.length} existing participants to ${clientId}`);
            ws.send(JSON.stringify({
                type: 'existingParticipants',
                participants: participantsList
            }));
        }
        
        // Notify all OTHER clients that this new client joined (without mic yet)
        for (const [peerId, peer] of this.participants.entries()) {
            if (peerId === clientId || !peer.ws) continue;
            
            peer.ws.send(JSON.stringify({
                type: 'participantJoined',
                participantId: clientId,
                username: participant.username || `User ${clientId}`
            }));
        }
        console.log(`[MEDIASOUP-SERVER] 📢 Notified other clients about new participant ${clientId}`);
        
        console.log(`[MEDIASOUP-SERVER] ✅ Client ${clientId} joined, recvTransport: ${transport.id}`);

        // Subscribe to music producer
        console.log(`[MEDIASOUP-SERVER] 🎵 Attempting to subscribe to music (rtpCapabilities may not be set yet)...`);
        await this.subscribeToMusic(clientId);
        
        // Subscribe to all other participants
        console.log(`[MEDIASOUP-SERVER] 👥 Subscribing to other participants...`);
        await this.subscribeToAllParticipants(clientId);
        
        console.log(`[MEDIASOUP-SERVER] ✅ Join complete for ${clientId}`);
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
        console.log(`[MEDIASOUP-SERVER] 🎵 subscribeToMusic called for ${clientId}`);
        
        const participant = this.participants.get(clientId);
        console.log(`[MEDIASOUP-SERVER] 🎵 Participant exists:`, !!participant);
        console.log(`[MEDIASOUP-SERVER] 🎵 Music producer exists:`, !!this.musicProducer);
        console.log(`[MEDIASOUP-SERVER] 🎵 RTP capabilities set:`, !!participant?.rtpCapabilities);
        
        if (!participant || !this.musicProducer || !participant.rtpCapabilities) {
            console.warn(`[MEDIASOUP-SERVER] ⚠️ Cannot subscribe to music:`, {
                hasParticipant: !!participant,
                hasMusicProducer: !!this.musicProducer,
                hasRtpCapabilities: !!participant?.rtpCapabilities
            });
            return;
        }

        console.log(`[MEDIASOUP-SERVER] ✅ Creating consumer for music stream...`);

        const consumer = await participant.recvTransport.consume({
            producerId: this.musicProducer.id,
            rtpCapabilities: participant.rtpCapabilities,
            paused: false
        });

        participant.consumers.set('music', consumer);
        
        console.log(`[MEDIASOUP-SERVER] ✅ Music consumer created:`, consumer.id);

        participant.ws.send(JSON.stringify({
            type: 'newConsumer',
            consumerId: consumer.id,
            producerId: this.musicProducer.id,
            kind: 'audio',
            rtpParameters: consumer.rtpParameters,
            label: 'Server Music'
        }));
        
        console.log(`[MEDIASOUP-SERVER] ✅ Sent newConsumer message to client ${clientId}`);
    }

    /**
     * Subscribe client to all other participants
     */
    async subscribeToAllParticipants(clientId) {
        console.log(`[MEDIASOUP-SERVER] 👥 Subscribing to other participants...`);
        const participant = this.participants.get(clientId);
        if (!participant || !participant.rtpCapabilities) return;

        for (const [peerId, peer] of this.participants) {
            // Skip self, participants without producer, and Echo User (no ws/recvTransport)
            if (peerId === clientId || !peer.producer || !peer.ws) continue;

            try {
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
                    participantId: peerId,
                    kind: 'audio',
                    rtpParameters: consumer.rtpParameters,
                    label: peer.username || `User ${peerId}`
                }));
                
                console.log(`[MEDIASOUP-SERVER] ✅ Subscribed ${clientId} to ${peerId}`);
            } catch (error) {
                console.error(`[MEDIASOUP-SERVER] ❌ Failed to consume from ${peerId}:`, error.message);
            }
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
        
        // Emit event for Echo User and other server-side consumers
        this.emit('producerCreated', clientId, participant.producer);

        // Send producer ID back to client
        ws.send(JSON.stringify({
            type: 'produced',
            producerId: participant.producer.id
        }));

        // Broadcast to all other participants (skip if no WebSocket - e.g., Echo User)
        for (const [peerId, peer] of this.participants) {
            if (peerId === clientId || !peer.rtpCapabilities || !peer.ws) continue;

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
                participantId: clientId,
                kind: 'audio',
                rtpParameters: consumer.rtpParameters,
                label: participant.username || `User ${clientId}`
            }));
        }
        
        // Notify all clients that this participant joined (with mic)
        for (const [peerId, peer] of this.participants) {
            if (peerId === clientId || !peer.ws) continue;
            
            peer.ws.send(JSON.stringify({
                type: 'participantJoined',
                participantId: clientId,
                username: participant.username || `User ${clientId}`
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
        
        // Broadcast mic status change to all other participants
        for (const [peerId, peer] of this.participants.entries()) {
            if (peerId === clientId || !peer.ws) continue;
            
            peer.ws.send(JSON.stringify({
                type: 'participantMicStatus',
                participantId: clientId,
                micActive: active
            }));
        }
        console.log(`[MEDIASOUP-SERVER] 📢 Broadcasted mic status change for ${clientId}: ${active}`);

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
            // Microphones are forwarded to Liquidsoap Harbor Input (port 8001)
            // Liquidsoap mixes: Music + Microphones → RTP Output → AzuraCast
            console.log(`➕ Adding ${clientId} mic to Liquidsoap mix`);
            this.emit('addToLiquidsoapMix', clientId, participant.producer);
        } else {
            console.log(`➖ Removing ${clientId} mic from Liquidsoap mix`);
            this.emit('removeFromLiquidsoapMix', clientId);
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
    async setClientRtpCapabilities(clientId, rtpCapabilities) {
        console.log(`[MEDIASOUP-SERVER] 📋 Setting RTP capabilities for ${clientId}`);
        
        let participant = this.participants.get(clientId);
        
        // Create participant entry if not exists (happens when setRtpCapabilities is called before join)
        if (!participant) {
            console.log(`[MEDIASOUP-SERVER] 🆕 Creating participant entry for ${clientId} (early registration)`);
            // We'll get the ws reference later, but we need the entry now
            participant = {
                ws: null,
                recvTransport: null,
                sendTransport: null,
                producer: null,
                consumers: new Map(),
                micButtonActive: false,
                rtpCapabilities: rtpCapabilities
            };
            this.participants.set(clientId, participant);
            console.log(`[MEDIASOUP-SERVER] ✅ Participant ${clientId} pre-registered with RTP capabilities`);
        } else {
            participant.rtpCapabilities = rtpCapabilities;
            console.log(`[MEDIASOUP-SERVER] ✅ RTP capabilities set for existing participant`);
        }
        
        // Debug: Check ws state
        console.log(`[MEDIASOUP-SERVER] 🔍 Debug - participant.ws:`, {
            exists: !!participant.ws,
            readyState: participant.ws ? participant.ws.readyState : 'N/A'
        });
        
        // Send confirmation to client so they can proceed with join
        // NOTE: Subscriptions will happen AFTER join creates the recvTransport
        if (participant.ws) {
            participant.ws.send(JSON.stringify({
                type: 'rtpCapabilitiesSet'
            }));
            console.log(`[MEDIASOUP-SERVER] 📤 Sent rtpCapabilitiesSet confirmation to client`);
        } else {
            console.log(`[MEDIASOUP-SERVER] ⚠️ WS not available, cannot send confirmation`);
        }
    }

    /**
     * Get debug information about connected participants
     */
    getDebugInfo() {
        const participants = [];
        
        for (const [clientId, participant] of this.participants) {
            participants.push({
                clientId,
                hasRecvTransport: !!participant.recvTransport,
                hasSendTransport: !!participant.sendTransport,
                hasProducer: !!participant.producer,
                consumerCount: participant.consumers ? participant.consumers.size : 0,
                micButtonActive: participant.micButtonActive || false,
                hasRtpCapabilities: !!participant.rtpCapabilities,
                wsConnected: participant.ws && participant.ws.readyState === 1
            });
        }
        
        return {
            totalParticipants: this.participants.size,
            hasMusicProducer: !!this.musicProducer,
            hasMusicTransport: !!this.musicTransport,
            routerActive: !!this.router,
            participants
        };
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
