/**
 * QueueManager.js - Server-Side Queue Management
 * 
 * Handles:
 * - Global queue shared by all clients
 * - Queue operations: add, remove, reorder, clear
 * - Auto-queue logic when decks finish
 * - Queue persistence (optional)
 */

import { EventEmitter } from 'events';

export class QueueManager extends EventEmitter {
  constructor() {
    super();
    
    this.queue = [];
    this.history = [];
    this.maxHistorySize = 50;
    
    console.log('📋 QueueManager initialized');
  }

  /**
   * Get current queue
   */
  getQueue() {
    return [...this.queue]; // Return copy to prevent external modification
  }

  /**
   * Get queue length
   */
  getLength() {
    return this.queue.length;
  }

  /**
   * Add item to queue
   */
  add(item) {
    if (!item || !item.id) {
      throw new Error('Queue item must have an id');
    }

    // Check if item already exists
    const existingIndex = this.queue.findIndex(q => q.id === item.id);
    if (existingIndex !== -1) {
      console.log(`⚠️ Item ${item.id} already in queue at position ${existingIndex}`);
      return false;
    }

    this.queue.push({
      ...item,
      addedAt: Date.now(),
      queueId: `queue_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    });

    console.log(`➕ Added to queue: ${item.title || item.id} (total: ${this.queue.length})`);
    this.emit('queueUpdate', this.getQueue());
    return true;
  }

  /**
   * Remove item from queue by index
   */
  remove(index) {
    if (index < 0 || index >= this.queue.length) {
      throw new Error(`Invalid queue index: ${index}`);
    }

    const removed = this.queue.splice(index, 1)[0];
    console.log(`➖ Removed from queue: ${removed.title || removed.id} (remaining: ${this.queue.length})`);
    
    this.emit('queueUpdate', this.getQueue());
    return removed;
  }

  /**
   * Remove item by ID
   */
  removeById(id) {
    const index = this.queue.findIndex(item => item.id === id);
    if (index === -1) {
      console.warn(`⚠️ Item ${id} not found in queue`);
      return null;
    }
    return this.remove(index);
  }

  /**
   * Reorder queue - move item from one position to another
   */
  reorder(fromIndex, toIndex) {
    if (fromIndex < 0 || fromIndex >= this.queue.length) {
      throw new Error(`Invalid from index: ${fromIndex}`);
    }
    if (toIndex < 0 || toIndex >= this.queue.length) {
      throw new Error(`Invalid to index: ${toIndex}`);
    }

    const [item] = this.queue.splice(fromIndex, 1);
    this.queue.splice(toIndex, 0, item);

    console.log(`🔄 Reordered: ${item.title || item.id} from ${fromIndex} to ${toIndex}`);
    this.emit('queueUpdate', this.getQueue());
    return true;
  }

  /**
   * Clear entire queue
   */
  clear() {
    const count = this.queue.length;
    this.queue = [];
    console.log(`🗑️ Queue cleared (${count} items removed)`);
    this.emit('queueUpdate', this.getQueue());
  }

  /**
   * Get next item from queue (without removing)
   */
  peek() {
    return this.queue.length > 0 ? { ...this.queue[0] } : null;
  }

  /**
   * Get and remove next item from queue
   */
  getNext() {
    if (this.queue.length === 0) {
      return null;
    }

    const next = this.queue.shift();
    console.log(`⏭️ Getting next from queue: ${next.title || next.id} (remaining: ${this.queue.length})`);
    
    // Add to history
    this.addToHistory(next);
    
    this.emit('queueUpdate', this.getQueue());
    return next;
  }

  /**
   * Insert item at specific position
   */
  insertAt(index, item) {
    if (index < 0 || index > this.queue.length) {
      throw new Error(`Invalid insert index: ${index}`);
    }

    if (!item || !item.id) {
      throw new Error('Queue item must have an id');
    }

    this.queue.splice(index, 0, {
      ...item,
      addedAt: Date.now(),
      queueId: `queue_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    });

    console.log(`📌 Inserted at ${index}: ${item.title || item.id}`);
    this.emit('queueUpdate', this.getQueue());
    return true;
  }

  /**
   * Play next: move to front of queue
   */
  playNext(item) {
    return this.insertAt(0, item);
  }

  /**
   * Get item at specific index
   */
  getAt(index) {
    if (index < 0 || index >= this.queue.length) {
      return null;
    }
    return { ...this.queue[index] };
  }

  /**
   * Add to history
   */
  addToHistory(item) {
    this.history.unshift({
      ...item,
      playedAt: Date.now()
    });

    // Trim history to max size
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(0, this.maxHistorySize);
    }

    this.emit('historyUpdate', this.getHistory());
  }

  /**
   * Get play history
   */
  getHistory() {
    return [...this.history];
  }

  /**
   * Clear history
   */
  clearHistory() {
    this.history = [];
    console.log('🗑️ History cleared');
    this.emit('historyUpdate', this.getHistory());
  }

  /**
   * Check if item exists in queue
   */
  has(id) {
    return this.queue.some(item => item.id === id);
  }

  /**
   * Find item index by ID
   */
  findIndex(id) {
    return this.queue.findIndex(item => item.id === id);
  }

  /**
   * Get queue statistics
   */
  getStats() {
    const totalDuration = this.queue.reduce((sum, item) => sum + (item.duration || 0), 0);
    return {
      count: this.queue.length,
      totalDuration,
      historyCount: this.history.length
    };
  }

  /**
   * Export queue to JSON
   */
  export() {
    return {
      queue: this.queue,
      history: this.history,
      exportedAt: Date.now()
    };
  }

  /**
   * Import queue from JSON
   */
  import(data) {
    if (!data || !Array.isArray(data.queue)) {
      throw new Error('Invalid queue data');
    }

    this.queue = data.queue;
    if (data.history && Array.isArray(data.history)) {
      this.history = data.history;
    }

    console.log(`📥 Imported queue: ${this.queue.length} items, ${this.history.length} history`);
    this.emit('queueUpdate', this.getQueue());
    this.emit('historyUpdate', this.getHistory());
  }
}
