/**
 * A utility class for generating consistent hashes from filepaths in browser environments
 */
export class FilepathHasher {
    /**
     * Creates a SHA-256 hash of a filepath
     * @param {string} filepath - The filepath to hash
     * @returns {Promise<string>} The hex-encoded hash
     */
    static async sha256(filepath: string) {
      // Normalize the filepath to ensure consistent hashing across platforms
      const normalizedPath = filepath.replace(/\\/g, '/').toLowerCase();
      
      // Convert string to array buffer
      const encoder = new TextEncoder();
      const data = encoder.encode(normalizedPath);
      
      // Generate hash using browser's crypto API
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
      
      // Convert to hex string
      return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }
  
    /**
     * Creates a shorter hash (first 8 characters of SHA-256)
     * @param {string} filepath - The filepath to hash
     * @returns {Promise<string>} The truncated hex-encoded hash
     */
    static async shortHash(filepath: string) {
      const fullHash = await this.sha256(filepath);
      return fullHash.slice(0, 8);
    }
  
  }

  