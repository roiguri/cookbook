# NLSpec 07 — Chef Avatar Builder (Live SVG + Skia PNG Upload)

- **Wave:** 2 (Parallel Core)
- **Depends On:** Slice `01`
- **Web Semport Oracles:** `packages/cookbook-core/avatar/chef-avatar.js`, `src/lib/auth/avatar-builder/avatar-builder.js`, `src/lib/auth/components/user-profile.js`, `src/js/services/users/user-service.js`, `docs/architecture/avatars.md`, `firestore.rules` (`isValidAvatarConfig`), `storage.rules` (`match /user-avatars/{fileName}`)

## 1. User Intent

Signed-in users customize a playful, flat-illustrated family Chef Avatar inside the Profile modal's **אווטאר** tab — choosing hair, eyes, brows, mouth, facial hair, glasses, kitchen headwear (toque, bandana, cap, headband), kitchen outfit (chef jacket, bib apron, striped butcher apron), and natural skin/hair/fabric/background colors — seeing live instant updates and saving a crisp 256×256 PNG that appears across the app header, profile, and family share picker.

## 2. Behavioral Contract

1. **Shared Engine Reuse (Verbatim — Zero Duplication):**
   - Imports `renderAvatarSvg`, `normalizeAvatarConfig`, `DEFAULT_AVATAR_CONFIG`, and all part/color catalogues directly from `@cookbook/core/avatar/chef-avatar` (lazy-loaded only when the `אווטאר` tab opens so it stays out of the cold-start bundle).
   - Never hardcodes duplicate part IDs or colors.
2. **Live Preview & Part Pickers (`src/components/auth/avatar-builder/`):**
   - Renders the live SVG string returned by `renderAvatarSvg(config)` via `react-native-svg` (`<SvgXml xml={svg} width={180} height={180} />`) inside a circular framed preview.
   - Category pills in Hebrew RTL (`שיער`, `עיניים`, `גבות`, `פה`, `שיער פנים`, `משקפיים`, `כובע`, `לבוש`, `צבעים`) switch part/color grids cleanly.
   - Includes a `אקראי` (randomize) button and a `שמירת אווטאר` (save) button disabled when no changes exist (unless user has no built avatar yet).
3. **Unsaved-Changes Close Guard:**
   - Tracks `hasUnsavedChanges` by comparing normalized current config against saved `users/{uid}.avatarConfig`.
   - Attempting to close the profile modal (✕ button, Android hardware back button, backdrop tap, or navigating away) while `hasUnsavedChanges === true` opens a confirmation alert:
     - `יש שינויים שלא נשמרו באווטאר`
     - `סגור בלי לשמור` (discards changes and closes)
     - `המשך לערוך` (keeps builder open with edits intact)
4. **Rasterization & Firebase Save Pipeline:**
   - On save: renders the final SVG via `@shopify/react-native-skia` (`Skia.SVG.MakeFromString` → offscreen `256×256` surface → `encodeToBase64(ImageFormat.PNG)`), verifying byte size `< 200 * 1024` (200 KB cap enforced by `storage.rules`).
   - Uploads PNG to `user-avatars/{uid}.png` with `contentType: 'image/png'` and **mandatory `customMetadata: { uploadedBy: uid }`**.
   - Appends cache-busting `&v=<Date.now()>` to the Storage download URL and writes `{ avatarConfig: { v: 1, parts, colors }, avatarUrl }` to `users/{uid}` via `UserService.update`.
   - Immediately updates the active user avatar in the app header, profile view, and family share picker without requiring a reload.

## 3. Required `testID` Contracts

- `avatar-builder-root`, `avatar-preview-svg`, `avatar-randomize-btn`, `avatar-save-btn`
- `avatar-cat-<category>` (`hair`, `eyes`, `brows`, `mouth`, `facialHair`, `glasses`, `hat`, `outfit`, `colors`)
- `avatar-option-<partId>`, `avatar-color-<group>-<colorId>`
- `avatar-unsaved-dialog`, `avatar-discard-btn`, `avatar-keep-editing-btn`

## 4. Acceptance & Edge Cases

- **P0:** Uploaded file at `user-avatars/{uid}.png` MUST have `contentType: 'image/png'`, `size < 204800`, and `metadata.uploadedBy === uid`.
- **P0:** `users/{uid}.avatarConfig` matches `firestore.rules` `isValidAvatarConfig` (`keys().hasOnly(['v', 'parts', 'colors'])`, `v` int, `parts.size() <= 16`, `colors.size() <= 8`).
- Unsaved-changes guard blocks accidental dismiss on back button / close button and preserves edits when user chooses `המשך לערוך`.
