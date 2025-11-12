/**
 * Centralized Logging System for SubCaster Server (Node.js)
 * 
 * Provides structured logging with configurable log categories.
 * Can be controlled via environment variables.
 */

/**
 * Available log categories
 */
const LogCategory = {
  // Core System
  SYSTEM: 'SYSTEM',
  CONFIG: 'CONFIG',
  
  // Audio & Server
  AUDIO_ENGINE: 'AUDIO_ENGINE',
  AUDIO_MIXER: 'AUDIO_MIXER',
  
  // Network & Communication
  WEBSOCKET: 'WEBSOCKET',
  COMMAND_SERVER: 'COMMAND_SERVER',
  MEDIASOUP_SERVER: 'MEDIASOUP_SERVER',
  
  // External Services
  AZURACAST: 'AZURACAST',
  
  // Queue Management
  QUEUE: 'QUEUE',
  
  // Development & Debug
  DEBUG: 'DEBUG',
  PERFORMANCE: 'PERFORMANCE',
};

/**
 * Log levels
 */
const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 99,
};

/**
 * Default configuration
 */
const defaultConfig = {
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
let config = { ...defaultConfig };

/**
 * Parse environment variable for enabled categories
 */
function parseEnabledCategories(envValue) {
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
  
  const categories = new Set();
  const parts = envValue.split(',').map(s => s.trim().toUpperCase());
  
  for (const part of parts) {
    if (part in LogCategory) {
      categories.add(part);
    }
  }
  
  return categories;
}

/**
 * Parse log level from string
 */
function parseLogLevel(value) {
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
 */
function initLogger() {
  // Parse global level
  config.globalLevel = parseLogLevel(process.env.LOG_LEVEL);
  
  // Parse enabled categories
  const enabledCategories = parseEnabledCategories(process.env.LOG_CATEGORIES);
  
  // Set all categories
  for (const category of Object.values(LogCategory)) {
    config.categories.set(category, enabledCategories.has(category));
    
    // Check for category-specific log level
    const categoryLevelKey = `LOG_LEVEL_${category}`;
    const categoryLevel = parseLogLevel(process.env[categoryLevelKey]);
    config.categoryLevels.set(category, categoryLevel);
  }
  
  // Parse other options
  const timestamps = process.env.LOG_TIMESTAMPS;
  config.showTimestamps = timestamps === 'true' || timestamps === '1';
  
  const emoji = process.env.LOG_EMOJI;
  if (emoji !== undefined) {
    config.useEmoji = emoji !== 'false' && emoji !== '0';
  }
}

/**
 * Check if a category is enabled for a given log level
 */
function isEnabled(category, level) {
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
function getTimestamp() {
  const now = new Date();
  return now.toISOString().split('T')[1].slice(0, -1); // HH:MM:SS.mmm
}

/**
 * Get category prefix with optional emoji
 */
function getCategoryPrefix(category, emoji) {
  const emojiStr = config.useEmoji && emoji ? emoji + ' ' : '';
  return config.showCategory ? `[${category}] ${emojiStr}` : emojiStr;
}

/**
 * Format log message
 */
function formatMessage(category, emoji, message) {
  const parts = [];
  
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
class Logger {
  constructor(category) {
    this.category = category;
  }
  
  /**
   * Log debug message
   */
  debug(message, emoji, ...args) {
    if (!isEnabled(this.category, LogLevel.DEBUG)) return;
    console.log(formatMessage(this.category, emoji, message), ...args);
  }
  
  /**
   * Log info message
   */
  info(message, emoji, ...args) {
    if (!isEnabled(this.category, LogLevel.INFO)) return;
    console.log(formatMessage(this.category, emoji, message), ...args);
  }
  
  /**
   * Log warning message
   */
  warn(message, emoji, ...args) {
    if (!isEnabled(this.category, LogLevel.WARN)) return;
    console.warn(formatMessage(this.category, emoji, message), ...args);
  }
  
  /**
   * Log error message
   */
  error(message, emoji, ...args) {
    if (!isEnabled(this.category, LogLevel.ERROR)) return;
    console.error(formatMessage(this.category, emoji, message), ...args);
  }
  
  /**
   * Check if a specific level is enabled for this category
   */
  isLevelEnabled(level) {
    return isEnabled(this.category, level);
  }
}

/**
 * Create a logger for a specific category
 */
function createLogger(category) {
  return new Logger(category);
}

/**
 * Enable/disable a category at runtime
 */
function setCategory(category, enabled) {
  config.categories.set(category, enabled);
}

/**
 * Set minimum log level for a category
 */
function setCategoryLevel(category, level) {
  config.categoryLevels.set(category, level);
}

/**
 * Set global minimum log level
 */
function setGlobalLevel(level) {
  config.globalLevel = level;
}

/**
 * Get current configuration (for debugging)
 */
function getConfig() {
  return config;
}

// Auto-initialize on module load
initLogger();

module.exports = {
  LogCategory,
  LogLevel,
  Logger,
  createLogger,
  setCategory,
  setCategoryLevel,
  setGlobalLevel,
  getConfig,
  initLogger,
};
