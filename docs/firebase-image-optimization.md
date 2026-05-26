# Firebase Image Optimization Setup

This document describes the configuration, maintenance, and bulk processing of the "Resize Images" Firebase Extension used for recipe images.

## 1. Extension Configuration

Install the [Resize Images](https://extensions.dev/extensions/firebase/storage-resize-images) extension in the Firebase Console with the following mandatory parameters:

- **Cloud Storage bucket:** `(your-default-bucket).appspot.com`
- **Paths that contain images:** `img/recipes/full`
- **Sizes of resized images:** `400x400,1080x1080`
- **Sharp constructor options:** `{"fit": "inside"}`
  - _Note: This ensures aspect ratio is preserved and images are not cropped._
- **Image output options:** `{"webp": true}`
- **Convert to preferred format:** `webp`
- **Deletion of original file:** `Keep` (Crucial for the app's fallback logic).
- **Make resized images public:** `False`
- **Is WebP animated:** `False`
- **Enable events:** `False`

## 2. Bulk Triggering for Existing Images

The extension only triggers on **New Uploads** or **Overwrites**. Updating metadata (touching) is often insufficient for this specific extension. To process an entire existing library, use the following methods.

### Cloud Shell Method

This method forces a refresh by synchronizing your images through a temporary folder.

1.  Open the [Google Cloud Console](https://console.cloud.google.com/).
2.  Activate **Cloud Shell** (top right icon `>_`).
3.  Run these commands (replace `BUCKET_NAME` with your actual bucket):

```bash
# 1. Create a temporary backup of your originals
gsutil -m cp -r gs://BUCKET_NAME/img/recipes/full gs://BUCKET_NAME/img/recipes/backup

# 2. Sync them back (This overwrites originals and triggers the extension)
gsutil -m rsync -r gs://BUCKET_NAME/img/recipes/backup/full/ gs://BUCKET_NAME/img/recipes/full/

# 3. Cleanup after verifying .webp files appear in Storage
gsutil -m rm -r gs://BUCKET_NAME/img/recipes/backup
```

## 3. Runtime architecture

Runtime URL resolution and deletion are owned by `RecipeImageService`:

- `getOptimizedUrl(image, size)` does the **WebP → full → null** waterfall, so the user sees the original immediately after upload while the resize extension is still catching up, and falls back to a CSS placeholder if all Storage paths fail.
- `deleteFiles(image)` cleans up the original plus all generated variants (`_400x400.webp`, `_1080x1080.webp`, the `_original.<ext>` AI-enhance backup, and the backup's variants).

See [`docs/architecture/services.md`](architecture/services.md) for the full service surface.
