#!/usr/bin/liquidsoap

# ==============================================================================
# SubCaster Radio - Liquidsoap Configuration
# ==============================================================================
# Professional DJ Software with 4 Decks, Queue System, and Live Mixing
# ==============================================================================

log("🎵 SubCaster Radio Starting...")

# ==============================================================================
# SETTINGS
# ==============================================================================

# IMPORTANT: Telnet server has a bug in Liquidsoap 2.2.x where it tries to bind twice
# We disable it and use Harbor HTTP endpoints for control instead
settings.server.telnet.set(false)

# Audio settings
settings.frame.audio.samplerate.set(48000)
settings.frame.audio.channels.set(2)

log("✅ Settings configured (Telnet disabled, using Harbor for control)")

# ==============================================================================
# DECK A - Request Queue
# ==============================================================================

deck_a_queue = ref([])
def deck_a_next() =
  uri = list.hd(default="", deck_a_queue())
  if uri != "" then
    request.create(uri)
  else
    null()
  end
end
deck_a = request.dynamic(id="deck_a", deck_a_next)
deck_a = amplify(id="volume_deck_a", 1.0, deck_a)

# Register interactive variables
deck_a_volume = interactive.float("deck_a.volume", 1.0)
deck_a = amplify(override="liq_amplify", deck_a_volume, deck_a)

log("✅ Deck A initialized")

# ==============================================================================
# DECK B - Request Queue
# ==============================================================================

deck_b_queue = ref([])
def deck_b_next() =
  uri = list.hd(default="", deck_b_queue())
  if uri != "" then
    request.create(uri)
  else
    null()
  end
end
deck_b = request.dynamic(id="deck_b", deck_b_next)
deck_b = amplify(id="volume_deck_b", 1.0, deck_b)

deck_b_volume = interactive.float("deck_b.volume", 1.0)
deck_b = amplify(override="liq_amplify", deck_b_volume, deck_b)

log("✅ Deck B initialized")

# ==============================================================================
# DECK C - Request Queue
# ==============================================================================

deck_c_queue = ref([])
def deck_c_next() =
  uri = list.hd(default="", deck_c_queue())
  if uri != "" then
    request.create(uri)
  else
    null()
  end
end
deck_c = request.dynamic(id="deck_c", deck_c_next)
deck_c = amplify(id="volume_deck_c", 1.0, deck_c)

deck_c_volume = interactive.float("deck_c.volume", 1.0)
deck_c = amplify(override="liq_amplify", deck_c_volume, deck_c)

log("✅ Deck C initialized")

# ==============================================================================
# DECK D - Request Queue
# ==============================================================================

deck_d_queue = ref([])
def deck_d_next() =
  uri = list.hd(default="", deck_d_queue())
  if uri != "" then
    request.create(uri)
  else
    null()
  end
end
deck_d = request.dynamic(id="deck_d", deck_d_next)
deck_d = amplify(id="volume_deck_d", 1.0, deck_d)

deck_d_volume = interactive.float("deck_d.volume", 1.0)
deck_d = amplify(override="liq_amplify", deck_d_volume, deck_d)

log("✅ Deck D initialized")

# ==============================================================================
# MICROPHONE INPUT
# ==============================================================================

# Live microphone input (placeholder - will be connected via external input)
mic = input.harbor(
  id="microphone",
  port=8001,
  "/live"
)
mic = amplify(id="volume_mic", 1.0, mic)

mic_volume = interactive.float("microphone.volume", 1.0)
mic = amplify(override="liq_amplify", mic_volume, mic)

log("✅ Microphone input initialized on port 8001")

# ==============================================================================
# MAIN QUEUE - AutoQueue System
# ==============================================================================

main_queue_list = ref([])
def main_queue_next() =
  uri = list.hd(default="", main_queue_list())
  if uri != "" then
    request.create(uri)
  else
    null()
  end
end
main_queue = request.dynamic(id="main_queue", main_queue_next)
main_queue = amplify(id="volume_queue", 1.0, main_queue)

queue_volume = interactive.float("queue.volume", 0.8)
main_queue = amplify(override="liq_amplify", queue_volume, main_queue)

log("✅ Main queue initialized")

# ==============================================================================
# MIXING - Combine all sources
# ==============================================================================

# Mix all decks together (fallback chain)
# Priority: Deck A > Deck B > Deck C > Deck D > Queue > Blank
decks_only = fallback(
  track_sensitive=false,
  [
    deck_a,
    deck_b,
    deck_c,
    deck_d,
    main_queue,
    blank(id="silence")
  ]
)

# Master volume control for decks
master_volume = interactive.float("master.volume", 1.0)
decks_only = amplify(override="liq_amplify", master_volume, decks_only)

# Create two separate mixes:
# 1. decks_only = Music only (for WebRTC DJ monitoring)
# 2. broadcast = Music + Microphones (for listeners via AzuraCast)
broadcast = add(normalize=false, [mic, decks_only])

log("✅ Mixing configured (decks_only for DJs, broadcast for listeners)")

# ==============================================================================
# CROSSFADE SUPPORT (Optional - can be enabled)
# ==============================================================================

# Uncomment for smooth crossfading between tracks:
# radio = crossfade(
#   duration=3.0,
#   fade_in=1.5,
#   fade_out=1.5,
#   radio
# )

# ==============================================================================
# OUTPUTS
# ==============================================================================

# 1. Harbor PCM Output for WebRTC DJ Monitoring (DECKS ONLY - no microphones)
# MediaSoup will fetch this via HTTP for DJ monitoring
output.harbor(
  %wav(stereo=true, samplerate=48000),
  id="monitor_output",
  port=8002,
  mount="/monitor",
  decks_only
)

log("✅ Monitor output configured on port 8002/monitor (DECKS ONLY for DJ monitoring)")

# 2. Harbor PCM Output for AzuraCast Broadcast (DECKS + MICROPHONES)
# AzuraCastOutput will fetch this via HTTP for listeners
output.harbor(
  %wav(stereo=true, samplerate=48000),
  id="broadcast_output",
  port=8003,
  mount="/broadcast",
  broadcast
)

log("✅ Broadcast output configured on port 8003/broadcast (DECKS + MICS for listeners)")

# ==============================================================================
# TELNET COMMANDS
# ==============================================================================

# TEMPORARILY DISABLED - Testing if server.register() causes port conflict
# Custom commands for deck control via telnet

# def deck_load(deck_id, uri) =
#   log("📀 Loading track to #{deck_id}: #{uri}")
#   
#   # Push to appropriate queue
#   if deck_id == "deck_a" then
#     deck_a_queue := list.append(deck_a_queue(), [uri])
#   elsif deck_id == "deck_b" then
#     deck_b_queue := list.append(deck_b_queue(), [uri])
#   elsif deck_id == "deck_c" then
#     deck_c_queue := list.append(deck_c_queue(), [uri])
#   elsif deck_id == "deck_d" then
#     deck_d_queue := list.append(deck_d_queue(), [uri])
#   elsif deck_id == "queue" then
#     main_queue_list := list.append(main_queue_list(), [uri])
#   else
#     log("❌ Unknown deck: #{deck_id}")
#   end
#   
#   "OK"
# end

# server.register(
#   namespace="deck",
#   description="Load track to deck",
#   usage="deck.load <deck_id> <uri>",
#   "load",
#   fun (s) -> begin
#     args = string.split(separator=" ", s)
#     deck_id = list.nth(default="", args, 0)
#     uri = list.nth(default="", args, 1)
#     deck_load(deck_id, uri)
#   end
# )

# # Skip current track on deck
# def deck_skip(deck_id) =
#   log("⏭️ Skipping track on #{deck_id}")
#   
#   if deck_id == "deck_a" then
#     deck_a.skip()
#   elsif deck_id == "deck_b" then
#     deck_b.skip()
#   elsif deck_id == "deck_c" then
#     deck_c.skip()
#   elsif deck_id == "deck_d" then
#     deck_d.skip()
#   elsif deck_id == "queue" then
#     main_queue.skip()
#   else
#     log("❌ Unknown deck: #{deck_id}")
#   end
#   
#   "OK"
# end

# server.register(
#   namespace="deck",
#   description="Skip current track",
#   usage="deck.skip <deck_id>",
#   "skip",
#   fun (deck_id) -> deck_skip(deck_id)
# )

# # Queue management
# server.register(
#   namespace="queue",
#   description="Add track to main queue",
#   usage="queue.push <uri>",
#   "push",
#   fun (uri) -> begin
#     main_queue_list := list.append(main_queue_list(), [uri])
#     "OK"
#   end
# )

# server.register(
#   namespace="queue",
#   description="Clear main queue",
#   usage="queue.clear",
#   "clear",
#   fun (_) -> begin
#     # Clear the queue list
#     main_queue_list := []
#     "OK"
#   end
# )

# Volume controls are already available via interactive variables:
# var.set deck_a.volume = 0.5
# var.get deck_a.volume

log("✅ Telnet commands temporarily disabled for testing")

# ==============================================================================
# METADATA HANDLING
# ==============================================================================

# Attach metadata callback to broadcast source (for tracking what's playing)
broadcast.on_metadata(fun (m) -> begin
  log("🎵 Now Playing:")
  log("   Title: #{m['title']}")
  log("   Artist: #{m['artist']}")
  log("   Album: #{m['album']}")
end)

# ==============================================================================
# STARTUP COMPLETE
# ==============================================================================

log("🎵 ============================================")
log("🎵 SubCaster Radio is READY!")
log("🎵 ============================================")
log("📡 Monitor (DJs): http://localhost:8002/monitor (DECKS ONLY)")
log("📡 Broadcast (Listeners): http://localhost:8003/broadcast (DECKS + MICS)")
log("🎤 Microphone input: http://localhost:8001/live")
log("🎵 ============================================")
