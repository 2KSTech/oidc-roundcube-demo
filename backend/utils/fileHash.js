const crypto = require('crypto');
const fs = require('fs');

/**
 * Generate a SHA-256 hash for resume file caching
 * Combines filename, file size, file date (if available), and content MD5
 * 
 * @param {Object} fileInfo - File information object
 * @param {string} fileInfo.name - Original filename
 * @param {number} fileInfo.size - File size in bytes
 * @param {Date} fileInfo.lastModified - File last modified date (optional)
 * @param {string} fileInfo.tmpFilePath - Path to temporary file for content hash
 * @returns {string} SHA-256 hash string
 */
function generateFileHash(fileInfo) {
  try {
    const { name, size, lastModified, tmpFilePath } = fileInfo;
    
    // Create hash components
    const components = [
      name || 'unknown',
      size?.toString() || '0',
      lastModified ? lastModified.getTime().toString() : 'no-date'
    ];
    
    // Add content MD5 if file exists
    let contentHash = 'no-content';
    if (tmpFilePath && fs.existsSync(tmpFilePath)) {
      try {
        const fileBuffer = fs.readFileSync(tmpFilePath);
        contentHash = crypto.createHash('md5').update(fileBuffer).digest('hex');
      } catch (error) {
        console.warn('Failed to read file for content hash:', error.message);
        contentHash = 'read-error';
      }
    }
    
    components.push(contentHash);
    
    // Create final SHA-256 hash
    const combinedString = components.join('|');
    const sha256Hash = crypto.createHash('sha256').update(combinedString).digest('hex');
    
    console.log('Generated file hash:', {
      filename: name,
      size: size,
      lastModified: lastModified?.toISOString(),
      contentHash: contentHash.substring(0, 8) + '...',
      finalHash: sha256Hash.substring(0, 16) + '...'
    });
    
    return sha256Hash;
    
  } catch (error) {
    console.error('Error generating file hash:', error);
    // Fallback: generate hash from available data
    const fallbackString = `${fileInfo.name || 'unknown'}|${fileInfo.size || '0'}|${Date.now()}`;
    return crypto.createHash('sha256').update(fallbackString).digest('hex');
  }
}

/**
 * Extract file metadata from multer file object
 * 
 * @param {Object} file - Multer file object
 * @param {string} tmpFilePath - Path to temporary file
 * @returns {Object} File info object for hash generation
 */
function extractFileInfo(file, tmpFilePath) {
  return {
    name: file.name,
    size: file.size,
    lastModified: file.lastModified ? new Date(file.lastModified) : null,
    tmpFilePath: tmpFilePath
  };
}

module.exports = {
  generateFileHash,
  extractFileInfo
};
