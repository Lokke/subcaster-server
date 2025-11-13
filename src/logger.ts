/**
 * Centralized Logging System for SubCaster
 * 
 * Provides structured logging with configurable log categories.
 * Can be controlled via environment variables or runtime configuration.
 */

/**
 * Available log categories
 */
export const LogCategory = {
  // Core System
  SYSTEM: 'SYSTEM',
  CONFIG: 'CONFIG',
  
  // Audio & Decks
  AUDIO: 'AUDIO',
  DECK: 'DECK',
  MIXER: 'MIXER',
  WAVEFORM: 'WAVEFORM',
  VOLUME_METER: 'VOLUME_METER',
  
  // Network & Communication
  WEBSOCKET: 'WEBSOCKET',
  WEBRTC: 'WEBRTC',
  CONFERENCE: 'CONFERENCE',
  
  // External Services
  AZURACAST: 'AZURACAST',
  OPENSUBSONIC: 'OPENSUBSONIC',
  DISCORD: 'DISCORD',
  
  // UI & User Interaction
  UI: 'UI',
  NAVIGATION: 'NAVIGATION',
  DRAG_DROP: 'DRAG_DROP',
  
  // Queue & Playlist
  QUEUE: 'QUEUE',
  AUTOQUEUE: 'AUTOQUEUE',
  SONG_REGISTRY: 'SONG_REGISTRY',
  
  // Library & Browse
  LIBRARY: 'LIBRARY',
  BROWSE: 'BROWSE',
  
  // Server-side Components
  SERVER_AUDIO: 'SERVER_AUDIO',
  SERVER_COMMAND: 'SERVER_COMMAND',
  SERVER_MEDIASOUP: 'SERVER_MEDIASOUP',
  
  // Development & Debug
  DEBUG: 'DEBUG',
  PERFORMANCE: 'PERFORMANCE',
} as const;

export type LogCategory = typeof LogCategory[keyof typeof LogCategory];

/**
 * Log levels
 */
export const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 99,
} as const;

export type LogLevel = typeof LogLevel[keyof typeof LogLevel];

/**
 * Configuration for logging system
 */
interface LoggerConfig {
  // Global log level (minimum level to display)
  globalLevel: LogLevel;
  
  // Per-category enabled/disabled status
  categories: Map<LogCategory, boolean>;
  
  // Per-category minimum log level
  categoryLevels: Map<LogCategory, LogLevel>;
  
  // Show timestamps
  showTimestamps: boolean;
  
  // Show category prefix
  showCategory: boolean;
  
  // Use emoji icons
  useEmoji: boolean;
}

/**
 * Default configuration
 */
const defaultConfig: LoggerConfig = {
  globalLevel: LogLevel.INFO,
  categories: new Map(),
  categoryLevels: new Map(),
  showTimestamps: false,
  showCategory: true,
  useEmoji: true,
};

/**
 * Current logging configuration
 */
let config: LoggerConfig = { ...defaultConfig };

/**
 * Parse environment variable for enabled categories
 * Format: CATEGORY1,CATEGORY2,CATEGORY3 or "all" or "none"
 */
function parseEnabledCategories(envValue: string | undefined): Set<LogCategory> {
  if (!envValue) {
    return new Set(Object.values(LogCategory)); // Enable all by default
  }
  
  const normalized = envValue.toLowerCase().trim();
  
  if (normalized === 'all' || normalized === '*') {
    return new Set(Object.values(LogCategory));
  }
  
  if (normalized === 'none') {
    return new Set();
  }
  
  const categories = new Set<LogCategory>();
  const parts = envValue.split(',').map(s => s.trim().toUpperCase());
  
  for (const part of parts) {
    if (part in LogCategory) {
      categories.add(part as LogCategory);
    }
  }
  
  return categories;
}

/**
 * Parse log level from string
 */
function parseLogLevel(value: string | undefined): LogLevel {
  if (!value) return LogLevel.INFO;
  
  const normalized = value.toUpperCase();
  switch (normalized) {
    case 'DEBUG': return LogLevel.DEBUG;
    case 'INFO': return LogLevel.INFO;
    case 'WARN': return LogLevel.WARN;
    case 'ERROR': return LogLevel.ERROR;
    case 'NONE': return LogLevel.NONE;
    default: return LogLevel.INFO;
  }
}

/**
 * Initialize logger from environment variables
 * 
 * Environment variables:
 * - LOG_LEVEL: Global minimum log level (DEBUG, INFO, WARN, ERROR, NONE)
 * - LOG_CATEGORIES: Comma-separated list of enabled categories, or "all" / "none"
 * - LOG_TIMESTAMPS: Show timestamps (true/false)
 * - LOG_EMOJI: Use emoji icons (true/false)
 * 
 * Category-specific levels:
 * - LOG_LEVEL_AUDIO: Minimum level for AUDIO category
 * - LOG_LEVEL_WEBRTC: Minimum level for WEBRTC category
 * - etc.
 */
export function initLogger(env?: Record<string, string>): void {
  // Use provided env or try to access environment
  const getEnv = (key: string): string | undefined => {
    if (env && key in env) return env[key];
    if (typeof process !== 'undefined' && process.env) return process.env[key];
    if (typeof import.meta !== 'undefined' && import.meta.env) return (import.meta.env as any)[key];
    return undefined;
  };
  
  // Parse global level
  config.globalLevel = parseLogLevel(getEnv('LOG_LEVEL') || getEnv('VITE_LOG_LEVEL'));
  
  // Parse enabled categories
  const enabledCategories = parseEnabledCategories(
    getEnv('LOG_CATEGORIES') || getEnv('VITE_LOG_CATEGORIES')
  );
  
  // Set all categories
  for (const category of Object.values(LogCategory)) {
    config.categories.set(category, enabledCategories.has(category));
    
    // Check for category-specific log level
    const categoryLevelKey = `LOG_LEVEL_${category}`;
    const viteKey = `VITE_LOG_LEVEL_${category}`;
    const categoryLevel = parseLogLevel(getEnv(categoryLevelKey) || getEnv(viteKey));
    config.categoryLevels.set(category, categoryLevel);
  }
  
  // Parse other options
  const timestamps = getEnv('LOG_TIMESTAMPS') || getEnv('VITE_LOG_TIMESTAMPS');
  config.showTimestamps = timestamps === 'true' || timestamps === '1';
  
  const emoji = getEnv('LOG_EMOJI') || getEnv('VITE_LOG_EMOJI');
  if (emoji !== undefined) {
    config.useEmoji = emoji !== 'false' && emoji !== '0';
  }
}

/**
 * Check if a category is enabled for a given log level
 */
function isEnabled(category: LogCategory, level: LogLevel): boolean {
  // Check global level
  if (level < config.globalLevel) return false;
  
  // Check if category is enabled
  if (!config.categories.get(category)) return false;
  
  // Check category-specific level
  const categoryLevel = config.categoryLevels.get(category);
  if (categoryLevel !== undefined && level < categoryLevel) return false;
  
  return true;
}

/**
 * Format timestamp
 */
function getTimestamp(): string {
  const now = new Date();
  return now.toISOString().split('T')[1].slice(0, -1); // HH:MM:SS.mmm
}

/**
 * Get category prefix with optional emoji
 */
function getCategoryPrefix(category: LogCategory, emoji?: string): string {
  const emojiStr = config.useEmoji && emoji ? emoji + ' ' : '';
  return config.showCategory ? `[${category}] ${emojiStr}` : emojiStr;
}

/**
 * Format log message
 */
function formatMessage(category: LogCategory, emoji: string | undefined, message: string): string {
  const parts: string[] = [];
  
  if (config.showTimestamps) {
    parts.push(`[${getTimestamp()}]`);
  }
  
  parts.push(getCategoryPrefix(category, emoji));
  parts.push(message);
  
  return parts.join(' ');
}

/**
 * Logger class for a specific category
 */
export class Logger {
  private category: LogCategory;
  
  constructor(category: LogCategory) {
    this.category = category;
  }
  
  /**
   * Log debug message
   */
  debug(message: string, emoji?: string, ...args: any[]): void {
    if (!isEnabled(this.category, LogLevel.DEBUG)) return;
    console.log(formatMessage(this.category, emoji, message), ...args);
  }
  
  /**
   * Log info message
   */
  info(message: string, emoji?: string, ...args: any[]): void {
    if (!isEnabled(this.category, LogLevel.INFO)) return;
    console.log(formatMessage(this.category, emoji, message), ...args);
  }
  
  /**
   * Log warning message
   */
  warn(message: string, emoji?: string, ...args: any[]): void {
    if (!isEnabled(this.category, LogLevel.WARN)) return;
    console.warn(formatMessage(this.category, emoji, message), ...args);
  }
  
  /**
   * Log error message
   */
  error(message: string, emoji?: string, ...args: any[]): void {
    if (!isEnabled(this.category, LogLevel.ERROR)) return;
    console.error(formatMessage(this.category, emoji, message), ...args);
  }
  
  /**
   * Check if a specific level is enabled for this category
   */
  isLevelEnabled(level: LogLevel): boolean {
    return isEnabled(this.category, level);
  }
}

// Removed unused exports: createLogger, setCategory, setCategoryLevel, setGlobalLevel, getConfig, resetConfig

// Auto-initialize on module load
initLogger();
