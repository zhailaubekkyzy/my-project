// media.js - Picking a photo on the phone, cropping and shrinking it before upload.
// Photos are avatars, so they are center-cropped to a square and saved as JPEG (≈50–150 KB).

(function (window) {
  const AVATAR_SIZE = 512;
  const JPEG_QUALITY = 0.86;

  // Opens the phone's gallery/camera. Resolves with a File, or null if nothing was chosen.
  function pickImageFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.style.display = 'none';
      input.addEventListener('change', () => {
        resolve(input.files && input.files[0] ? input.files[0] : null);
        input.remove();
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Не удалось открыть фото. Попробуйте другое.'));
      };
      img.src = url;
    });
  }

  // Square crop from the center, scaled down to AVATAR_SIZE.
  async function toAvatarBlob(file) {
    const img = await loadImage(file);
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const size = Math.min(AVATAR_SIZE, side);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // transparent PNGs get a white background in JPEG
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(
      img,
      (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side,
      0, 0, size, size
    );
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error('Не удалось обработать фото.'))),
        'image/jpeg',
        JPEG_QUALITY
      );
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Full flow: pick → crop/shrink → upload with `upload(blob)` (returns { photoUrl }).
   * Without a server session the photo is kept on this device only.
   * Resolves with { url, savedOnServer } or null if the person cancelled.
   */
  async function choosePhoto(upload) {
    const file = await pickImageFile();
    if (!file) return null;
    const blob = await toAvatarBlob(file);
    const api = window.smartFlowApi;
    if (upload && api && api.isSignedIn()) {
      try {
        const res = await upload(blob);
        return { url: api.mediaUrl(res.photoUrl), savedOnServer: true };
      } catch (err) {
        if (err.status && err.status !== 401 && err.status < 500) throw err; // the photo itself was rejected
      }
    }
    return { url: await blobToDataUrl(blob), savedOnServer: false };
  }

  window.sfMedia = { choosePhoto, toAvatarBlob, pickImageFile };
})(window);
