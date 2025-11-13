/**
 * Runtime Configuration Loader
 * 
 * Lädt alle Environment-Variablen vom Backend zur Laufzeit.
 * Vorteil: Keine Neubuilds bei Config-Änderungen!
 * Sicherheit: Tokens bleiben auf dem Server!
 */

interface AppConfig {
  opensubsonic: {
    url: string;
    username: string;
  };
  azuracast: {
    servers: string;
    stationId: string;
  };
  discord: {
    channelId: string;
    guildId: string;
    enabled: boolean;
  };
  unifiedLogin: {
    enabled: boolean;
  };
  stream: {
    bitrate: string;
    sampleRate: string;
  };
  deckConfiguration: string;
  blacklistedGenres?: string;
}

let cachedConfig: AppConfig | null = null;

/**
 * Lädt die Konfiguration vom Backend
 * Cached das Ergebnis für Performance
 */
export async function loadConfig(): Promise<AppConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  console.log('📋 Loading configuration from backend...');

  try {
    const response = await fetch('/api/config');
    
    if (!response.ok) {
      throw new Error(`Failed to load config: ${response.status}`);
    }

    const config = await response.json();
    cachedConfig = config;

    console.log('✅ Configuration loaded successfully');
    console.log('   OpenSubsonic:', config.opensubsonic.url ? '✅' : '❌');
    console.log('   AzuraCast:', config.azuracast.servers ? '✅' : '❌');
    console.log('   Discord:', config.discord.enabled ? '✅' : '❌');

    return config;
  } catch (error) {
    console.warn('⚠️ Backend config not available, falling back to build-time ENV variables');
    
    // Fallback to import.meta.env (für lokale Entwicklung)
    const fallbackConfig: AppConfig = {
      opensubsonic: { 
        url: import.meta.env.VITE_OPENSUBSONIC_URL || '', 
        username: import.meta.env.VITE_OPENSUBSONIC_USERNAME || '' 
      },
      azuracast: { 
        servers: import.meta.env.VITE_AZURACAST_SERVERS || '', 
        stationId: import.meta.env.VITE_AZURACAST_STATION_ID || '1' 
      },
      discord: { 
        channelId: import.meta.env.VITE_DISCORD_CHANNEL_ID || '', 
        guildId: import.meta.env.VITE_DISCORD_GUILD_ID || '', 
        enabled: !!(import.meta.env.VITE_DISCORD_CHANNEL_ID && import.meta.env.VITE_DISCORD_GUILD_ID)
      },
      unifiedLogin: { 
        enabled: import.meta.env.VITE_USE_UNIFIED_LOGIN === 'true'
      },
      stream: { 
        bitrate: import.meta.env.VITE_STREAM_BITRATE || '128', 
        sampleRate: import.meta.env.VITE_STREAM_SAMPLE_RATE || '44100' 
      },
      deckConfiguration: import.meta.env.VITE_DECK_CONFIGURATION || 'four-decks',
      blacklistedGenres: import.meta.env.VITE_BLACKLISTED_GENRES || '',
    };

    cachedConfig = fallbackConfig;

    console.log('✅ Configuration loaded from ENV');
    console.log('   OpenSubsonic:', fallbackConfig.opensubsonic.url ? '✅' : '❌');
    console.log('   AzuraCast:', fallbackConfig.azuracast.servers ? '✅' : '❌');
    console.log('   Discord:', fallbackConfig.discord.enabled ? '✅' : '❌');

    return fallbackConfig;
  }
}

/**
 * Gibt einen einzelnen Config-Wert zurück
 * Kompatibel mit altem import.meta.env.VITE_* Pattern
 */
export function getConfigValue(key: string): string {
  if (!cachedConfig) {
    console.warn(`⚠️ Config not loaded yet, trying to access: ${key}`);
    return '';
  }

  // Map old VITE_* keys to new config structure
  const keyMap: Record<string, () => string> = {
    'VITE_OPENSUBSONIC_URL': () => cachedConfig!.opensubsonic.url,
    'VITE_OPENSUBSONIC_USERNAME': () => cachedConfig!.opensubsonic.username,
    'VITE_AZURACAST_SERVERS': () => cachedConfig!.azuracast.servers,
    'VITE_AZURACAST_STATION_ID': () => cachedConfig!.azuracast.stationId,
    'VITE_DISCORD_CHANNEL_ID': () => cachedConfig!.discord.channelId,
    'VITE_DISCORD_GUILD_ID': () => cachedConfig!.discord.guildId,
    'VITE_STREAM_BITRATE': () => cachedConfig!.stream.bitrate,
    'VITE_STREAM_SAMPLE_RATE': () => cachedConfig!.stream.sampleRate,
    'VITE_DECK_CONFIGURATION': () => cachedConfig!.deckConfiguration,
    'VITE_USE_UNIFIED_LOGIN': () => String(cachedConfig!.unifiedLogin.enabled),
    'VITE_BLACKLISTED_GENRES': () => cachedConfig!.blacklistedGenres || '',
  };

  const getter = keyMap[key];
  if (getter) {
    return getter();
  }

  console.warn(`⚠️ Unknown config key: ${key}`);
  return '';
}

/**
 * Expose getConfigValue globally for compatibility
 */
(window as any).getConfigValue = getConfigValue;

// Removed unused functions: getDiscordCredentials, getOpenSubsonicAuth, sendAzuraCastCommand
