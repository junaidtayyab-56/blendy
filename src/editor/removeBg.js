// Background removal that runs in the browser (no API key, nothing sent to a third party).
// The AI model (about 40 MB) downloads the first time and the browser caches it after that.
import { drawLayer, toBlob } from './render.js';

let lib = null;
const load = () => (lib ||= import('@imgly/background-removal'));

// img/box: the picture to cut out (box = piece on a sprite sheet, or null for the whole image).
// Returns a transparent PNG blob.
export async function removeBackground(img, box, onProgress) {
  const { removeBackground: run } = await load();
  const piece = drawLayer(img, box, null, 1600);
  const input = await toBlob(piece, 'image/png');
  return run(input, {
    model: 'isnet_fp16',
    output: { format: 'image/png', quality: 1 },
    progress: (key, current, total) => {
      if (!onProgress) return;
      if (String(key).startsWith('fetch')) onProgress(total ? Math.round((current / total) * 100) : null, 'Downloading the background remover (first time only)…');
      else onProgress(null, 'Removing background…');
    },
  });
}
