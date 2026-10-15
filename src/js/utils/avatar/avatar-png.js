import { renderAvatarSvg } from './chef-avatar.js';

/**
 * Rasterise an avatar config to a square PNG (for upload — every place that shows
 * avatars takes an image URL).
 * @param {Object} config - avatar config (see chef-avatar.js)
 * @param {number} [size=256] - width and height in pixels
 * @returns {Promise<Blob>} image/png
 */
export async function avatarPngBlob(config, size = 256) {
  const svg = renderAvatarSvg(config, { size });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image(size, size);
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    canvas.getContext('2d').drawImage(img, 0, 0, size, size);
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Avatar PNG encoding failed'))),
        'image/png',
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
