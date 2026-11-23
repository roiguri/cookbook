/**
 * Generic Least Recently Used (LRU) Cache
 * ---------------------------------------
 * Stores key-value pairs up to a maximum limit.
 * When the limit is reached, the least recently used item is evicted.
 * Accessing an item (get) or adding it (set) marks it as most recently used.
 */
export class LRUCache {
  /**
   * @param {number} limit - Maximum number of items to hold
   */
  constructor(limit = 100) {
    this.limit = limit;
    this.cache = new Map();
  }

  /**
   * Get value by key and update recent usage
   * @param {any} key
   * @returns {any | undefined}
   */
  get(key) {
    if (!this.cache.has(key)) return undefined;

    const value = this.cache.get(key);
    // Refresh item: remove and re-add to end (most recent)
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  /**
   * Set value for key and evict if necessary
   * @param {any} key
   * @param {any} value
   */
  set(key, value) {
    if (this.cache.has(key)) {
      // If exists, delete first to update position
      this.cache.delete(key);
    } else if (this.cache.size >= this.limit) {
      // Evict least recently used (first item in Map)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  /**
   * Check if key exists (does NOT update usage)
   * @param {any} key
   * @returns {boolean}
   */
  has(key) {
    return this.cache.has(key);
  }

  /**
   * Delete key
   * @param {any} key
   * @returns {boolean} true if deleted
   */
  delete(key) {
    return this.cache.delete(key);
  }

  /**
   * Clear cache
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get current size
   * @returns {number}
   */
  get size() {
    return this.cache.size;
  }
}
