/**
 * Map snapshot upload service.
 * Compresses a base64 dataUrl to JPEG (≤800px wide, quality 0.65 ≈ 50-80 KB)
 * then uploads to Firebase Storage and returns a permanent download URL.
 *
 * Storage path: map-snapshots/{userId}/{memoryId}/{timestamp}.jpg
 */
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase/config';

/**
 * Compress a base64 dataUrl to a small JPEG Blob.
 * @param {string} dataUrl  - original canvas dataUrl (image/jpeg or image/png)
 * @param {number} maxWidth - resize to at most this width (default 800)
 * @param {number} quality  - JPEG quality 0-1 (default 0.65)
 * @returns {Promise<Blob>}
 */
function compressDataUrl(dataUrl, maxWidth = 800, quality = 0.65) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = img.width > maxWidth ? maxWidth / img.width : 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas toBlob returned null'));
        },
        'image/jpeg',
        quality
      );
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/**
 * Upload a map snapshot dataUrl to Firebase Storage and return its download URL.
 * Falls back to returning the original dataUrl if upload fails.
 *
 * @param {string} dataUrl   - base64 image dataUrl from canvas
 * @param {Object} opts
 * @param {string} opts.userId   - Firebase Auth uid
 * @param {string} opts.memoryId - conversation memory id
 * @returns {Promise<string>} permanent download URL (or original dataUrl on failure)
 */
export async function uploadMapSnapshot(dataUrl, { userId = 'anon', memoryId = 'unknown' } = {}) {
  let compressedDataUrl = dataUrl;
  let blob;
  try {
    blob = await compressDataUrl(dataUrl);
    // Keep a compressed dataUrl as fallback in case the upload fails
    compressedDataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch (_) {
    // compression failed — use original
  }

  try {
    if (!blob) blob = await compressDataUrl(dataUrl);
    const timestamp = Date.now();
    const path = `map-snapshots/${userId}/${memoryId}/${timestamp}.jpg`;
    const storageRef = ref(storage, path);
    const metadata = { contentType: 'image/jpeg', cacheControl: 'public,max-age=31536000' };
    await uploadBytes(storageRef, blob, metadata);
    const url = await getDownloadURL(storageRef);
    console.log(`✅ Map snapshot uploaded (${Math.round(blob.size / 1024)} KB): ${path}`);
    return url;
  } catch (err) {
    console.warn('⚠️ Map snapshot upload failed, using compressed inline dataUrl:', err?.message ?? err);
    // Return compressed version (much smaller than original) so the widget still renders
    return compressedDataUrl;
  }
}
