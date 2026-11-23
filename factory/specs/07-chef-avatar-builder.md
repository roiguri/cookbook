# NLSpec 07 — Chef Avatar Builder (Live SVG + Skia PNG Upload)

- **Wave:** 2 (Parallel Core)
- **Depends On:** Slice `01`
- **Web Semport Oracles:** `packages/cookbook-core/avatar/chef-avatar.js`, `packages/cookbook-core/avatar/avatar-url.js`, `src/js/utils/avatar/avatar-png.js`, `src/lib/auth/avatar-builder/avatar-builder.js`, `src/lib/auth/components/user-profile.js`, `src/js/services/users/user-service.js`, `docs/architecture/avatars.md`, `firestore.rules`, `storage.rules`

## 1. User Intent

Signed-in users customize a playful, flat-illustrated family Chef Avatar inside the Profile modal's **אווטאר** tab across the exact 10 customization tabs from Web — choosing skin tone, hairstyle (+ hair color), eyes, brows, mouth, facial hair (+ hair color), glasses, kitchen headwear (10 options + fabric color), kitchen outfit (4 options + fabric color), and background color — seeing instant live SVG previews and saving a crisp 256×256 PNG (< 200 KB) that appears across the app header, profile, and family share picker.

## 2. Behavioral Contract

1. **Shared Engine Reuse (Verbatim — Zero Duplication):**
   - Imports `renderAvatarSvg`, `normalizeAvatarConfig`, `randomAvatarConfig`, `DEFAULT_AVATAR_CONFIG`, and all part/color catalogues directly from `@cookbook/core/avatar/chef-avatar`, plus `isBuiltAvatarUrl` from `@cookbook/core/avatar/avatar-url` (lazy-loaded behind a shimmer skeleton when the `אווטאר` tab opens so DiceBear stays out of the cold-start bundle).
   - Exact catalogue IDs come verbatim from `chef-avatar.js` (e.g. outfits: `jacket`, `apron`, `tee`, `stripes`; hats: `toque`, `cap`, `bandana`, `beanie`, `baseball`, `tallToque`, `paperCap`, `backwards`, `headband`, `none`) — NEVER invent alias IDs.
2. **Live Preview & Exact 10-Tab Picker (`src/components/auth/avatar-builder/`):**
   - Renders live SVG via `react-native-svg` (`<SvgXml xml={svg} width={180} height={180} />`) inside a circular framed preview.
   - **Exact 10 tabs in order matching `avatar-builder.js` (NO standalone `colors` tab):**
     1. `skin` — `גוון עור` (colour swatches only)
     2. `hair` — `תסרוקת` (part tiles + embedded `צבע שיער` palette; thumbnails render with `hat: 'none'` so hairstyles remain visible when a hat is equipped!)
     3. `eyes` — `עיניים`
     4. `brows` — `גבות`
     5. `mouth` — `פה`
     6. `facialHair` — `זקן ושפם` (part tiles + embedded `צבע שיער` palette)
     7. `glasses` — `משקפיים`
     8. `hat` — `כובע` (10 hat tiles + embedded `צבע בד` palette)
     9. `outfit` — `מדים` (4 outfit tiles + embedded `צבע בד` palette)
     10. `background` — `רקע` (colour swatches only)
   - Option tiles render cropped SVG thumbnails (`renderAvatarSvg(..., { viewBox: part.crop })` with transparent background `'none'`).
   - Action controls:
     - **`הפתע אותי`** (`avatar-randomize-btn`): calls `randomAvatarConfig()` from `chef-avatar.js`.
     - **`ביטול השינויים`** (`avatar-undo-btn`): reverts edits back to initial baseline config.
     - **`שמירת האווטאר`** (`avatar-save-btn`, displays `שומר…` while saving): checks `isBuilt = isBuiltAvatarUrl(avatarUrl) && !!avatarConfig`. Disabled with status text `'זה האווטאר שלך כרגע.'` when `isBuilt && !hasUnsavedChanges`; stays enabled when `!isBuilt` (so users on initial/Google avatar can save the default chef immediately).
3. **Unsaved-Changes Close Guard:**
   - Computes `hasUnsavedChanges` by comparing normalized current config against the tab's initial baseline (`users/{uid}.avatarConfig ? normalizeAvatarConfig(saved) : DEFAULT_AVATAR_CONFIG`) so opening & closing unedited NEVER falsely prompts when `avatarConfig` is `null`!
   - Attempting to close the profile modal (✕ button, Android hardware back button, backdrop tap, or footer `הארוחה שלי` button) while `hasUnsavedChanges === true` opens a confirmation dialog (`avatar-unsaved-dialog`):
     - Title: **`לסגור בלי לשמור?`**
     - Body: **`השינויים באווטאר לא נשמרו ויאבדו.`**
     - Buttons: **`סגור בלי לשמור`** (`avatar-discard-btn`) and **`המשך לערוך`** (`avatar-keep-editing-btn`, default/dismiss keeps editing).
4. **Rasterization & Firebase Save Pipeline:**
   - On save: renders final SVG via `@shopify/react-native-skia` (`Skia.SVG.MakeFromString` → offscreen `256×256` surface → `encodeToBase64(ImageFormat.PNG)`), asserting byte size `< 200 * 1024`.
   - Uploads PNG to `user-avatars/{uid}.png` with `contentType: 'image/png'` and **mandatory `customMetadata: { uploadedBy: uid }`**.
   - Appends safe cache-busting query `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}` (works with both production `?alt=media&token=...` and emulator URLs without `?`).
   - Persists `{ avatarConfig: { v: 1, parts, colors }, avatarUrl }` via `AuthService.updateProfile` (writing `updatedAt: serverTimestamp()`), flashes **`✓ האווטאר נשמר`** (or error `שמירת האווטאר נכשלה. נסה שנית.`), and refreshes header/profile/share-picker avatars immediately.

## 3. Required `testID` Contracts

- `avatar-builder-root`, `avatar-preview-svg`, `avatar-randomize-btn`, `avatar-undo-btn`, `avatar-save-btn`
- `avatar-cat-<category>` (`skin`, `hair`, `eyes`, `brows`, `mouth`, `facialHair`, `glasses`, `hat`, `outfit`, `background`)
- `avatar-option-<partId>`, `avatar-color-<group>-<colorId>`
- `avatar-unsaved-dialog`, `avatar-discard-btn`, `avatar-keep-editing-btn`

## 4. Acceptance & Edge Cases

- **P0:** Uploaded file at `user-avatars/{uid}.png` MUST have `contentType: 'image/png'`, `size < 204800`, and `metadata.uploadedBy === uid`.
- **P0:** `users/{uid}.avatarConfig` matches `firestore.rules` `isValidAvatarConfig` (`keys().hasOnly(['v', 'parts', 'colors'])`, `v` int, `parts.size() <= 16`, `colors.size() <= 8`).
- Unsaved-changes guard blocks accidental dismiss on back/close when dirty, preserves edits on `המשך לערוך`, and does NOT trigger when opening & closing an unedited builder for a user with `avatarConfig == null`.
