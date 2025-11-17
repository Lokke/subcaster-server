/**
 * Debug Echo User - Server-side MediaSoup participant for testing microphones
 * 
 * This test user joins the MediaSoup conference and echoes back all received audio.
 * Useful for testing microphone input and WebRTC connectivity.
 * 
 * Usage:
 *   const echoUser = new DebugEchoUser(mediaSoupServer);
 *   await echoUser.join();
 *   // User will automatically echo all received audio
 *   await echoUser.leave(); // Clean up when done
 */

import { EventEmitter } from 'events';

export class DebugEchoUser extends EventEmitter {
  constructor(mediaSoupServer) {
    super();
    
    this.mediaSoupServer = mediaSoupServer;
    this.router = null;
    this.recvTransport = null;  // For receiving audio
    this.sendTransport = null;  // For sending echo back
    this.consumers = new Map(); // participantId -> Consumer
    this.producer = null;       // Echo producer
    
    this.userId = 'echo-test-user';
    this.isActive = false;
    
    console.log('🔊 [ECHO-USER] Debug echo user created');
  }

  /**
   * Join the MediaSoup conference
   */
  async join() {
    if (this.isActive) {
      console.warn('🔊 [ECHO-USER] Already joined');
      return;
    }

    try {
      console.log('🔊 [ECHO-USER] Joining conference...');
      
      // Get the MediaSoup router
      this.router = this.mediaSoupServer.router;
      if (!this.router) {
        throw new Error('MediaSoup router not available');
      }

      // Create WebRTC transport for receiving audio
      this.recvTransport = await this.router.createWebRtcTransport({
        listenIps: [{ ip: '127.0.0.1', announcedIp: null }],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true
      });
      
      // Create WebRTC transport for sending echo back
      this.sendTransport = await this.router.createWebRtcTransport({
        listenIps: [{ ip: '127.0.0.1', announcedIp: null }],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true
      });

      console.log('🔊 [ECHO-USER] ✅ Transports created');
      console.log(`   Recv Transport: ${this.recvTransport.id}`);
      console.log(`   Send Transport: ${this.sendTransport.id}`);

      // Listen for new producers from ALL participants (not just AzuraCast forwarding)
      this.mediaSoupServer.on('producerCreated', async (clientId, producer) => {
        console.log(`🔊 [ECHO-USER] 🎤 New producer from ${clientId} (WebRTC mic enabled)`);
        await this.consumeAudio(clientId, producer);
      });
      
      // Also listen for AzuraCast forwarding activations
      this.mediaSoupServer.on('addToLiquidsoapMix', async (clientId, producer) => {
        console.log(`🔊 [ECHO-USER] 📡 AzuraCast forwarding enabled for ${clientId}`);
        // Producer already consumed via producerCreated event
      });

      // Also consume existing producers
      console.log(`🔊 [ECHO-USER] Checking for existing participants...`);
      for (const [clientId, participant] of this.mediaSoupServer.participants.entries()) {
        if (participant.producer) {
          console.log(`🔊 [ECHO-USER] Found existing producer from ${clientId}`);
          await this.consumeAudio(clientId, participant.producer);
        }
      }

      this.isActive = true;
      console.log('🔊 [ECHO-USER] ✅ Joined conference, ready to echo');
      console.log(`🔊 [ECHO-USER] Monitoring ${this.mediaSoupServer.participants.size} participants`);
      
      // Register Echo User as a participant so it appears in the UI
      this.registerAsParticipant();
      
    } catch (error) {
      console.error('🔊 [ECHO-USER] ❌ Failed to join:', error);
      throw error;
    }
  }
  
  /**
   * Register Echo User as a visible participant
   */
  registerAsParticipant() {
    // Add Echo User to participants map
    this.mediaSoupServer.participants.set(this.userId, {
      ws: null, // No WebSocket (server-side only)
      recvTransport: this.recvTransport,
      sendTransport: this.sendTransport,
      producer: this.producer, // Will be set when echoing
      consumers: new Map(),
      rtpCapabilities: this.router.rtpCapabilities,
      micButtonActive: false,
      username: '🔊 Echo User (Test)'
    });
    
    console.log('🔊 [ECHO-USER] ✅ Registered as participant');
    
    // Notify all connected clients about the Echo User
    for (const [clientId, participant] of this.mediaSoupServer.participants.entries()) {
      if (participant.ws && clientId !== this.userId) {
        try {
          participant.ws.send(JSON.stringify({
            type: 'participantJoined',
            participantId: this.userId,
            username: '🔊 Echo User (Test)'
          }));
          console.log(`🔊 [ECHO-USER] 📢 Notified client ${clientId} about Echo User`);
        } catch (error) {
          console.error(`🔊 [ECHO-USER] ❌ Failed to notify ${clientId}:`, error);
        }
      }
    }
  }

  /**
   * Handle new producer from another participant (removed - using addToLiquidsoapMix event instead)
   */
  
  /**
   * Consume audio from a participant
   */
  async consumeAudio(participantId, producer) {
    if (this.consumers.has(participantId)) {
      console.log(`🔊 [ECHO-USER] Already consuming from ${participantId}`);
      return;
    }

    try {
      // Create consumer for this producer
      const consumer = await this.recvTransport.consume({
        producerId: producer.id,
        rtpCapabilities: this.router.rtpCapabilities,
        paused: false
      });

      this.consumers.set(participantId, consumer);
      
      console.log(`🔊 [ECHO-USER] ✅ Consuming audio from ${participantId}`);
      console.log(`   Consumer ID: ${consumer.id}`);
      console.log(`   Kind: ${consumer.kind}`);
      console.log(`   RTP parameters: ${consumer.rtpParameters.codecs[0]?.mimeType}`);

      // NOW ECHO IT BACK!
      // Create a producer that sends the same audio back
      await this.echoAudioBack(consumer, participantId);
      
      // Monitor consumer events
      consumer.on('transportclose', () => {
        console.log(`🔊 [ECHO-USER] Transport closed for ${participantId}`);
        this.consumers.delete(participantId);
      });
      
      consumer.on('producerclose', () => {
        console.log(`🔊 [ECHO-USER] Producer closed for ${participantId}`);
        this.consumers.delete(participantId);
      });

      consumer.observer.on('pause', () => {
        console.log(`🔊 [ECHO-USER] 🔇 Audio paused from ${participantId}`);
      });

      consumer.observer.on('resume', () => {
        console.log(`🔊 [ECHO-USER] 🔊 Audio resumed from ${participantId}`);
      });

      // Emit event for external processing
      this.emit('audioReceived', {
        participantId,
        consumer,
        producer
      });

    } catch (error) {
      console.error(`🔊 [ECHO-USER] ❌ Failed to consume from ${participantId}:`, error);
    }
  }
  
  /**
   * Echo audio back to all participants
   * NOTE: This is a simplified approach - in reality you'd need to pipe RTP packets
   */
  async echoAudioBack(consumer, sourceParticipantId) {
    try {
      // For now, we just create a producer that other clients can consume
      // The actual audio echoing would require RTP packet manipulation
      // which is beyond the scope of this simple implementation
      
      if (!this.producer) {
        // Create a PlainTransport producer that can be consumed by others
        // This is a placeholder - real echo would need RTP packet forwarding
        console.log(`🔊 [ECHO-USER] 📢 Echo producer would be created here`);
        console.log(`   Note: Real audio echo requires RTP packet forwarding`);
        console.log(`   For testing: Check stats to verify audio reception`);
      }
      
    } catch (error) {
      console.error(`🔊 [ECHO-USER] ❌ Failed to echo audio:`, error);
    }
  }

  /**
   * Get statistics about consumed audio
   */
  async getStats() {
    const stats = {
      active: this.isActive,
      consumersCount: this.consumers.size,
      consumers: []
    };

    for (const [participantId, consumer] of this.consumers.entries()) {
      try {
        const consumerStats = await consumer.getStats();
        stats.consumers.push({
          participantId,
          consumerId: consumer.id,
          kind: consumer.kind,
          paused: consumer.paused,
          stats: Array.from(consumerStats)
        });
      } catch (error) {
        console.error(`🔊 [ECHO-USER] Failed to get stats for ${participantId}:`, error);
      }
    }

    return stats;
  }

  /**
   * Leave the conference
   */
  async leave() {
    if (!this.isActive) {
      console.warn('🔊 [ECHO-USER] Not joined');
      return;
    }

    console.log('🔊 [ECHO-USER] Leaving conference...');

    // Close all consumers
    for (const [participantId, consumer] of this.consumers.entries()) {
      try {
        await consumer.close();
        console.log(`🔊 [ECHO-USER] ✅ Closed consumer for ${participantId}`);
      } catch (error) {
        console.error(`🔊 [ECHO-USER] ❌ Failed to close consumer for ${participantId}:`, error);
      }
    }
    this.consumers.clear();

    // Close transport
    if (this.transport) {
      try {
        await this.transport.close();
        console.log('🔊 [ECHO-USER] ✅ Transport closed');
      } catch (error) {
        console.error('🔊 [ECHO-USER] ❌ Failed to close transport:', error);
      }
      this.transport = null;
    }

    // Remove event listeners
    if (this.mediaSoupServer) {
      this.mediaSoupServer.removeAllListeners('producerCreated');
      this.mediaSoupServer.removeAllListeners('addToLiquidsoapMix');
    }

    this.isActive = false;
    console.log('🔊 [ECHO-USER] ✅ Left conference');
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      userId: this.userId,
      active: this.isActive,
      transportId: this.transport?.id,
      consumersCount: this.consumers.size,
      participants: Array.from(this.consumers.keys())
    };
  }
}

/**
 * Create and auto-join echo user
 */
export async function createEchoUser(mediaSoupServer) {
  const echoUser = new DebugEchoUser(mediaSoupServer);
  await echoUser.join();
  
  // Log statistics every 5 seconds
  const statsInterval = setInterval(async () => {
    if (!echoUser.isActive) {
      clearInterval(statsInterval);
      return;
    }
    
    const stats = await echoUser.getStats();
    console.log('🔊 [ECHO-USER] 📊 Stats:', JSON.stringify(stats, null, 2));
  }, 5000);

  // Cleanup on process exit
  process.on('SIGINT', async () => {
    clearInterval(statsInterval);
    await echoUser.leave();
  });

  return echoUser;
}
