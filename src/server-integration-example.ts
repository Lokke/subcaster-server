/**
 * server-integration-example.ts
 * 
 * Example of how to integrate the server-based audio system
 * into the SubCaster UI
 */

import { ServerClient } from './serverClient';
import { MicrophoneClient } from './microphoneClient';

// ============================================================================
// Initialize Server Connection
// ============================================================================

let serverClient: ServerClient;
let micClient: MicrophoneClient;
let isServerMode = true; // Set to true for server-side audio

/**
 * Initialize server-based audio system
 */
export async function initializeServerAudio() {
  console.log('🎵 Initializing server-based audio system...');
  
  // Create server client
  serverClient = new ServerClient();
  
  // Setup event handlers
  serverClient.onConnected = handleServerConnected;
  serverClient.onDisconnected = handleServerDisconnected;
  serverClient.onStateChange = handleDeckStateChange;
  serverClient.onPositionUpdate = handlePositionUpdate;
  serverClient.onControlGranted = handleControlGranted;
  serverClient.onControlDenied = handleControlDenied;
  serverClient.onError = handleServerError;
  
  try {
    // Connect to server
    await serverClient.connect();
    console.log('✅ Connected to server audio engine');
    
    // Request DJ control
    serverClient.requestControl();
    
  } catch (error) {
    console.error('❌ Failed to connect to server:', error);
    // Fall back to client-side audio
    isServerMode = false;
  }
}

/**
 * Initialize microphone group call
 */
export async function initializeMicrophone(username?: string) {
  console.log('🎤 Initializing microphone...');
  
  // Create microphone client
  micClient = new MicrophoneClient(username);
  
  // Setup event handlers
  micClient.onConnected = handleMicConnected;
  micClient.onDisconnected = handleMicDisconnected;
  micClient.onParticipantsChanged = handleParticipantsChanged;
  micClient.onError = handleMicError;
  
  try {
    // Connect to microphone server
    await micClient.connect();
    console.log('✅ Connected to microphone server');
    
    // Start microphone capture
    await micClient.startMicrophone();
    console.log('✅ Microphone started');
    
  } catch (error) {
    console.error('❌ Failed to initialize microphone:', error);
  }
}

// ============================================================================
// Server Event Handlers
// ============================================================================

function handleServerConnected() {
  console.log('🔌 Server connected');
  // Update UI to show server connection status
  updateConnectionStatus('connected');
}

function handleServerDisconnected() {
  console.log('📴 Server disconnected');
  // Update UI to show disconnection
  updateConnectionStatus('disconnected');
  // Try to reconnect
  setTimeout(() => initializeServerAudio(), 5000);
}

function handleDeckStateChange(state: any) {
  console.log('🎵 Deck state changed:', state);
  
  // Update UI for the specific deck
  const deckElement = document.getElementById(`deck-${state.id.toLowerCase()}`);
  if (deckElement) {
    updateDeckUI(deckElement, state);
  }
}

function handlePositionUpdate(deck: string, position: number) {
  // Update progress bar for deck
  const progressBar = document.getElementById(`deck-${deck.toLowerCase()}-progress`);
  if (progressBar) {
    updateProgressBar(progressBar, position);
  }
}

function handleControlGranted() {
  console.log('🎛️ DJ control granted');
  // Update UI to show control is granted
  updateControlStatus(true);
}

function handleControlDenied() {
  console.log('🎛️ DJ control denied');
  // Update UI to show control is denied
  updateControlStatus(false);
}

function handleServerError(error: string) {
  console.error('❌ Server error:', error);
  // Show error message to user
  showErrorNotification(error);
}

// ============================================================================
// Microphone Event Handlers
// ============================================================================

function handleMicConnected() {
  console.log('🎤 Microphone connected');
  // Update UI to show microphone is active
  updateMicrophoneStatus('connected');
}

function handleMicDisconnected() {
  console.log('🎤 Microphone disconnected');
  // Update UI to show microphone is inactive
  updateMicrophoneStatus('disconnected');
}

function handleParticipantsChanged(participants: any[]) {
  console.log('👥 Participants updated:', participants);
  // Update participant list in UI
  updateParticipantList(participants);
}

function handleMicError(error: string) {
  console.error('❌ Microphone error:', error);
  // Show error message to user
  showErrorNotification(error);
}

// ============================================================================
// Deck Control Functions (called from UI)
// ============================================================================

/**
 * Load track to deck
 */
export function loadTrackToDeck(deck: string, song: any) {
  if (!isServerMode) {
    // Use client-side audio (original implementation)
    loadTrackClientSide(deck, song);
    return;
  }
  
  // Use server-side audio
  const url = getStreamUrl(song.id);
  const metadata = {
    title: song.title,
    artist: song.artist,
    album: song.album || '',
    duration: song.duration || 0
  };
  
  serverClient.loadTrack(deck, url, metadata);
}

/**
 * Play deck
 */
export function playDeck(deck: string) {
  if (!isServerMode) {
    playDeckClientSide(deck);
    return;
  }
  
  serverClient.play(deck);
}

/**
 * Pause deck
 */
export function pauseDeck(deck: string) {
  if (!isServerMode) {
    pauseDeckClientSide(deck);
    return;
  }
  
  serverClient.pause(deck);
}

/**
 * Seek deck
 */
export function seekDeck(deck: string, time: number) {
  if (!isServerMode) {
    seekDeckClientSide(deck, time);
    return;
  }
  
  serverClient.seek(deck, time);
}

/**
 * Set deck volume
 */
export function setDeckVolume(deck: string, volume: number) {
  if (!isServerMode) {
    setDeckVolumeClientSide(deck, volume);
    return;
  }
  
  serverClient.setVolume(deck, volume);
}

/**
 * Clear deck
 */
export function clearDeck(deck: string) {
  if (!isServerMode) {
    clearDeckClientSide(deck);
    return;
  }
  
  serverClient.clear(deck);
}

// ============================================================================
// Microphone Control Functions (called from UI)
// ============================================================================

/**
 * Toggle microphone mute
 */
export function toggleMicrophoneMute() {
  if (!micClient) return;
  
  const isMuted = micClient.getMuted();
  micClient.setMuted(!isMuted);
  
  // Update UI
  updateMicrophoneMuteButton(!isMuted);
}

/**
 * Get available microphones
 */
export async function getAvailableMicrophones() {
  if (!micClient) return [];
  return await micClient.getMicrophones();
}

/**
 * Switch microphone
 */
export async function switchMicrophone(deviceId: string) {
  if (!micClient) return;
  
  await micClient.stopMicrophone();
  await micClient.startMicrophone(deviceId);
}

/**
 * Leave microphone group call
 */
export function leaveMicrophoneCall() {
  if (!micClient) return;
  micClient.disconnect();
}

// ============================================================================
// UI Helper Functions (implement these in your main.ts)
// ============================================================================

function updateConnectionStatus(status: 'connected' | 'disconnected') {
  // Implement: Update UI to show server connection status
}

function updateDeckUI(deckElement: HTMLElement, state: any) {
  // Implement: Update deck UI with new state
}

function updateProgressBar(progressBar: HTMLElement, position: number) {
  // Implement: Update progress bar
}

function updateControlStatus(hasControl: boolean) {
  // Implement: Update UI to show if user has DJ control
}

function updateMicrophoneStatus(status: 'connected' | 'disconnected') {
  // Implement: Update UI to show microphone status
}

function updateParticipantList(participants: any[]) {
  // Implement: Update participant list in UI
}

function updateMicrophoneMuteButton(isMuted: boolean) {
  // Implement: Update mute button appearance
}

function showErrorNotification(message: string) {
  // Implement: Show error notification to user
  alert(message);
}

// Placeholders for client-side functions (original implementation)
function loadTrackClientSide(deck: string, song: any) {}
function playDeckClientSide(deck: string) {}
function pauseDeckClientSide(deck: string) {}
function seekDeckClientSide(deck: string, time: number) {}
function setDeckVolumeClientSide(deck: string, volume: number) {}
function clearDeckClientSide(deck: string) {}
function getStreamUrl(songId: string): string { return ''; }
