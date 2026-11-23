# NLSpec 06 — Create / Edit Recipe, AI Import & Native OS Share Target

- **Wave:** 3B (Parallel Advanced — after Wave 2 `S10` and Wave 3A `S03`)
- **Depends On:** Slices `02`, `03`, `04`, `10`
- **Web Semport Oracles:** `src/app/pages/propose-recipe-page.js`, `src/app/pages/propose-recipe-page.html`, `src/lib/recipes/recipe_form_component/recipe_form_component.js`, `src/lib/recipes/recipe_form_component/propose_recipe_component.js`, `src/lib/recipes/recipe_form_component/edit_recipe_component.js`, `src/lib/recipes/recipe_import_modal/recipe_import_modal.js`, `src/lib/recipes/save-choice/save-choice.js`, `src/lib/recipes/suggest_edit_modal/suggest-edit-modal.js`, `src/js/services/recipes/recipe-edit-suggestion-service.js`, `src/js/services/recipes/recipe-image-service.js`, `src/js/services/recipes/media-instruction-service.js`, `src/js/utils/recipe-extractor-utils.js`, `packages/cookbook-core/recipe-model.js`, `packages/cookbook-core/youtube-url.js`, `functions/index.js`, `storage.rules`

## 1. User Intent

Signed-in users author rich Hebrew recipes (or import them in seconds using Gemini AI from up to 5 photos, a web URL, or a YouTube video, or directly from another app via the OS Share Sheet). Plain `user` accounts propose directly to the manager approval queue via atomic batch write; `approved` family and `manager` accounts save privately via the 2×2 Save Choice dialog (`ניסיתם אותו?` × `מי יראה אותו?`) with an optional toggle to also submit to the family book.

## 2. Behavioral Contract

1. **Guest Gate & Role-Adapted Copy (`app/(tabs)/propose-recipe.tsx`):**
   - Unauthenticated guests see a login prompt modal (`רק משתמשים מחוברים יכולים להציע מתכונים`); dismissing without signing in redirects to `/home`.
   - Plain `user`: heading `הצע מתכון לספר.`, CTA `שלח מתכון`, AI Import button (`ייבא מתכון`) hidden (callables require `approved`/`manager`). Saving executes an **atomic Firestore WriteBatch** creating BOTH `recipes/{id}` (`visibility: 'private'`, `authorId: uid`) AND `recipe_submissions/{id}` (`submissionRecord`, `status: 'pending'`) in a single commit (required by `firestore.rules` `submittedTogether(recipeId)`!), showing toast **`המתכון נשלח לאישור בהצלחה`**.
   - `approved` & `manager`: heading `מתכון חדש.`, CTA `שמירה`, AI Import button visible (`ייבא מתכון`). Saving opens the exact 2×2 **Save Choice dialog** (`save-choice.js`):
     - `ניסיתם אותו?`: `ניסיתי` (`tested`) vs `עוד לא` (`to-try`, defaulted automatically after AI import!).
     - `מי יראה אותו?`: `רק אני` (private only, CTA `שמירה`) vs `כל המשפחה` (private + batched `recipe_submissions/{id}`, CTA `שמירה ושליחה`, showing a soft warning if `to-try` + submit).
     - **Important Web Parity:** Both `approved` AND `manager` create `visibility: 'private'` from `/propose-recipe` (direct publish happens only inside Manager Dashboard edit mode via `publish: true`).
2. **Full Recipe Form (`src/components/recipe-form/`):**
   - **All metadata fields:** `name` (required), `description` (`תיאור קצר`), `category` (`CATEGORY_IDS`, required), `difficulty` (`DIFFICULTIES`, required), `mainIngredient` (`מרכיב עיקרי`), `prepTime` (positive int, required), `waitTime` (optional `>= 0`), `servings` (positive int, required), `servingsUnit` (`מנות, כיכרות...`), `tags` (comma-separated, no commas inside tag), `comments` (`הערות משפחה`), `attribution` (`קרדיט`, auto-filled from imported `sourceUrl` when blank).
   - **Validation (`missingRequiredFields` + optional ingredient amounts):**
     - Validates required fields via `@cookbook/core` `missingRequiredFields` with a grouped problems summary banner + jump-to-next-problem helper.
     - **Optional amount/unit rule (CRITICAL):** Only `item` is required on non-blank ingredient rows. Validate `amount` via `isValidAmount(str)` **ONLY when `amount` is non-empty** (so valid items like `מלח לפי הטעם` with blank amount are NEVER blocked!). If any row has a blank amount or unit, prompt once with `כמות או יחידה חסרים` (`המשך בכל זאת` / `בדיקת השדות`). Reject invalid non-empty strings like `"2-3"` or `"abc"`.
   - Supports toggling between flat `ingredients[]` and `ingredientSections[]` (`MIN_SECTIONS = 2`), and between flat `instructions[]` and `stages[]` (`MIN_SECTIONS = 2`).
   - **Photos (`expo-image-picker`):** Up to `MAX_PHOTOS = 5` photos (`<= 5 MB` each, `image/jpeg|png|webp`), choose primary photo, reorder/remove. **ALL recipe photos (private AND published)** upload to **`recipes/{recipeId}/images/{fileName}`** (`recipeImagesFolder`) with **mandatory `customMetadata: { uploadedBy: uid }`** so approving in-place never leaves images behind private user Storage rules.
   - **Step Media (`mediaInstructions[]`):** Upload step images or videos (`<= 50 MB`) to **`recipes/{recipeId}/media/{fileName}`** (`recipeMediaFolder`) with editable Hebrew captions, reordering, and `customMetadata: { uploadedBy: uid }`.
   - **Related Recipes Picker:** Link up to `MAX_RELATED_RECIPES = 4` published recipes (excluding current recipe ID when editing).
   - **Preview Toggle & Dirty Guards:** Toggles `תצוגה מקדימה` ↔ `חזור לעריכה` (disabling submit/clear/import while previewing), tracks dirty state with `נקה טופס` confirmation and leave-page confirmation (`שינויים לא נשמרו`).
   - **Edit Mode & Edit Suggestions (`RecipeEditSuggestionService` + `SuggestEditModal`):**
     - Reuses form for editing own private recipes (deferring Storage deletes until save succeeds) and for `הצע עריכה` on published recipes (adds optional `הערה למנהל (אופציונלי)`, stages any newly uploaded files under `suggestions/{suggestionId}/images|media/...` tagged with `uploadedBy: uid`, and writes a **full recipe snapshot** in `proposedChanges` — ALWAYS including `images[]` and `mediaInstructions[]` — plus `storagePaths: [{ type, path }]`).
3. **AI Recipe Import (`RecipeImportService` + `RecipeImportModal`):**
   - Three tabs matching Web `recipe_import_modal.js`: **`מתמונה`** (`extractRecipeFromImage`, up to **5** images resized/cropped to max 1024px JPEG with rotate ±90°/reorder/delete, payload `{ images: [{ base64, mimeType }] }`), **`מכתובת URL`** (`extractRecipeFromUrl`), **`מסרטון YouTube`** (`extractRecipeFromVideo`, validated via `@cookbook/core/youtube-url`). Maps result via `mapExtractedDataToForm` (`recipe-extractor-utils.js`).
   - **Filler Mini-Game During Extraction:** While awaiting Gemini, mounts `GameHostModal` from Slice `10` (picking randomly strictly from `memory` or `burger` — never `excludeFromRandom` games) with close-guard while extracting (`עיבוד המתכון בתהליך. האם לבטל ולסגור?`) and staleness `requestId` guard. Once extraction completes, shows `המתכון מוכן!` and CTA **`צפה במתכון`** (`ai-extract-ready-btn`) — closing after completion still applies extracted data, displays post-import review alert (`המתכון יובא. עברו על הפרטים לפני השמירה...`), and defaults Save Choice stage to `to-try`.
   - **Error Handling:** Inline recoverable Hebrew error (`ai-extract-error` with `נסה שוב`); URL/video failures log server-side into `failed_url_extractions`.
4. **Native OS Share Target (`useShareIntent`):**
   - **Android (`expo-share-intent`):** Handles incoming `android.intent.action.SEND` (`text/plain` URLs / YouTube links, `image/*` photos).
   - **iOS Simulator & Deep-Link Share Handoff:** Handles URL scheme `cookbook-e2e://propose-recipe?importUrl=<encodedUrl>` (and `cookbook-staging://...`; physical-device iOS Share Extension App Group activates in Phase 6 when `EXPO_ENABLE_APPLE_PAID_ENTITLEMENTS=true`).
   - Opens `/propose-recipe`, auto-selects the matching AI import tab (`מסרטון YouTube` if `parseYouTubeUrl` matches, `מכתובת URL` for web URLs, `מתמונה` for images), and pre-fills the payload.

## 3. Required `testID` Contracts

- `propose-screen`, `propose-login-prompt`, `recipe-form-name`, `recipe-form-category`, `recipe-form-difficulty`, `recipe-form-preptime`, `recipe-form-waittime`, `recipe-form-servings`, `recipe-form-sectioned-toggle`, `recipe-form-staged-toggle`
- `ingredient-input-item-<idx>`, `ingredient-input-amount-<idx>`, `ingredient-input-unit-<idx>`, `add-ingredient-btn`, `instruction-input-<idx>`, `add-instruction-btn`
- `add-photo-btn`, `photo-thumb-<idx>`, `add-step-media-btn`, `recipe-form-preview-btn`, `recipe-form-submit-btn`, `save-choice-private-btn`, `save-choice-submit-btn`
- `ai-import-open-btn`, `ai-import-modal`, `ai-tab-image`, `ai-tab-url`, `ai-tab-youtube`, `ai-url-input`, `ai-extract-btn`, `ai-filler-game`, `ai-extract-ready-btn`, `ai-extract-error`

## 4. Acceptance & Edge Cases

- **P0:** Plain `user` submission uses atomic `WriteBatch` (`recipes/{id}` + `recipe_submissions/{id}`) and displays confirmation containing `נשלח לאישור`.
- **P0:** Every uploaded recipe photo, step media file, and suggestion staged file lives under `recipes/{id}/...` or `suggestions/{id}/...` with `customMetadata: { uploadedBy: uid }`.
- **P0:** Blank amounts (`מלח לפי הטעם`) are accepted; invalid non-empty amounts (`"2-3"`, `"abc"`) block submission with clear Hebrew field error.
- Gemini Twin fault injection (`?dtu_fault=rate-limit-429`, `?dtu_fault=empty`) surfaces a clean recoverable Hebrew error without crashing and creates the expected `failed_url_extractions` doc.
