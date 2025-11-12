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

settings.server.telnet.set(true)
settings.server.telnet.port.set(1234)
settings.server.telnet.bind_addr.set("127.0.0.1")

# Audio settings
settings.frame.audio.samplerate.set(48000)
settings.frame.audio.channels.set(2)

log("✅ Settings configured")

# ==============================================================================
# DECK A - Request Queue
# ==============================================================================

deck_a = request.queue(id="deck_a")
deck_a = amplify(id="volume_deck_a", 1.0, deck_a)

# Register interactive variables
deck_a_volume = interactive.float("deck_a.volume", 1.0)
deck_a = amplify(override="liq_amplify", deck_a_volume, deck_a)

log("✅ Deck A initialized")

# ==============================================================================
# DECK B - Request Queue
# ==============================================================================

deck_b = request.queue(id="deck_b")
deck_b = amplify(id="volume_deck_b", 1.0, deck_b)

deck_b_volume = interactive.float("deck_b.volume", 1.0)
deck_b = amplify(override="liq_amplify", deck_b_volume, deck_b)

log("✅ Deck B initialized")

# ==============================================================================
# DECK C - Request Queue
# ==============================================================================

deck_c = request.queue(id="deck_c")
deck_c = amplify(id="volume_deck_c", 1.0, deck_c)

deck_c_volume = interactive.float("deck_c.volume", 1.0)
deck_c = amplify(override="liq_amplify", deck_c_volume, deck_c)

log("✅ Deck C initialized")

# ==============================================================================
# DECK D - Request Queue
# ==============================================================================

deck_d = request.queue(id="deck_d")
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
# MAIN QUEUE - For AutoQueue system
# ==============================================================================

main_queue = request.queue(id="main_queue")
main_queue = amplify(id="volume_queue", 0.8, main_queue)

queue_volume = interactive.float("queue.volume", 0.8)
main_queue = amplify(override="liq_amplify", queue_volume, main_queue)

log("✅ Main queue initialized")

# ==============================================================================
# MIXING - Combine all sources
# ==============================================================================

# Mix all decks together (fallback chain)
# Priority: Deck A > Deck B > Deck C > Deck D > Queue
radio = fallback(
  track_sensitive=false,
  [
    deck_a,
    deck_b,
    deck_c,
    deck_d,
    main_queue
  ]
)

# Add microphone on top (always mixed in)
radio = add(normalize=false, [mic, radio])

# Master volume control
master_volume = interactive.float("master.volume", 1.0)
radio = amplify(override="liq_amplify", master_volume, radio)

log("✅ Mixing configured")

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

# 1. RTP Output (Opus) for MediaSoup WebRTC Conference
# This is consumed by MediaSoupServer's PlainTransport
output.rtp.opus(
  id="webrtc_output",
  host="127.0.0.1",
  port=5004,
  radio
)

log("✅ RTP Opus output configured on port 5004 (for MediaSoup WebRTC)")

# 2. Harbor Monitor (optional - HTTP MP3 stream for debugging)
output.harbor(
  %mp3(bitrate=128),
  id="harbor_monitor",
  port=8002,
  mount="/monitor",
  radio
)

log("✅ Harbor monitor output configured on port 8002")

# ==============================================================================
# TELNET COMMANDS
# ==============================================================================

# Custom commands for deck control via telnet

def deck_load(deck_id, uri) =
  log("📀 Loading track to #{deck_id}: #{uri}")
  
  # Push to appropriate queue
  if deck_id == "deck_a" then
    ignore(request.push(uri, queue=deck_a))
  elsif deck_id == "deck_b" then
    ignore(request.push(uri, queue=deck_b))
  elsif deck_id == "deck_c" then
    ignore(request.push(uri, queue=deck_c))
  elsif deck_id == "deck_d" then
    ignore(request.push(uri, queue=deck_d))
  elsif deck_id == "queue" then
    ignore(request.push(uri, queue=main_queue))
  else
    log("❌ Unknown deck: #{deck_id}")
  end
  
  "OK"
end

server.register(
  namespace="deck",
  description="Load track to deck",
  usage="deck.load <deck_id> <uri>",
  "load",
  fun (deck_id, uri) -> deck_load(deck_id, uri)
)

# Skip current track on deck
def deck_skip(deck_id) =
  log("⏭️ Skipping track on #{deck_id}")
  
  if deck_id == "deck_a" then
    source.skip(deck_a)
  elsif deck_id == "deck_b" then
    source.skip(deck_b)
  elsif deck_id == "deck_c" then
    source.skip(deck_c)
  elsif deck_id == "deck_d" then
    source.skip(deck_d)
  elsif deck_id == "queue" then
    source.skip(main_queue)
  else
    log("❌ Unknown deck: #{deck_id}")
  end
  
  "OK"
end

server.register(
  namespace="deck",
  description="Skip current track",
  usage="deck.skip <deck_id>",
  "skip",
  fun (deck_id) -> deck_skip(deck_id)
)

# Queue management
server.register(
  namespace="queue",
  description="Add track to main queue",
  usage="queue.push <uri>",
  "push",
  fun (uri) -> begin
    ignore(request.push(uri, queue=main_queue))
    "OK"
  end
)

server.register(
  namespace="queue",
  description="Clear main queue",
  usage="queue.clear",
  "clear",
  fun () -> begin
    # Clear all pending requests
    request.queue.clear(main_queue)
    "OK"
  end
)

# Volume controls are already available via interactive variables:
# var.set deck_a.volume = 0.5
# var.get deck_a.volume

log("✅ Telnet commands registered")

# ==============================================================================
# METADATA HANDLING
# ==============================================================================

def on_metadata(m) =
  log("🎵 Now Playing:")
  log("   Title: #{m['title']}")
  log("   Artist: #{m['artist']}")
  log("   Album: #{m['album']}")
end

radio = on_metadata(on_metadata, radio)

# ==============================================================================
# STARTUP COMPLETE
# ==============================================================================

log("🎵 ============================================")
log("🎵 SubCaster Radio is READY!")
log("🎵 ============================================")
log("📡 Telnet control: localhost:1234")
log("📡 Icecast stream: http://localhost:8000/live")
log("📡 Monitor stream: http://localhost:8002/monitor")
log("🎤 Microphone input: http://localhost:8001/live")
log("🎵 ============================================")
