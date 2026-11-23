# NLSpec 06 — Create / Edit Recipe, AI Import & Native OS Share Target

- **Wave:** 3 (Parallel Advanced)
- **Depends On:** Slices `02`, `03`, `04`
- **Web Semport Oracles:** `src/app/pages/propose-recipe-page.js`, `src/lib/recipes/recipe_form_component/{recipe_form_component,propose_recipe_component,edit_recipe_component}.js`, `src/lib/recipes/recipe_import_modal/recipe_import_modal.js`, `src/lib/recipes/save-choice/save-choice.js`, `src/js/services/recipes/{ai-enhancement-service,recipe-image-service,media-instruction-service,recipe-image-proposal-service}.js`, `packages/cookbook-core/{recipe-model.js,youtube-url.js}`, `functions/index.js`, `storage.rules`

## 1. User Intent

Signed-in users author rich Hebrew recipes (or import them in seconds using Gemini AI from a photo, web URL, or YouTube video, or directly from another app via the OS Share Sheet). Plain `user` accounts propose directly to the manager approval queue; `approved` family and `manager` accounts save privately (choosing `לנסות` or `נבדק`) with an optional toggle to also submit to the family book.

## 2. Behavioral Contract

1. **Guest Gate & Role-Adapted Copy (`app/(tabs)/propose-recipe.tsx`):**
   - Unauthenticated guests see a login prompt modal (`רק משתמשים מחוברים יכולים להציע מתכונים`) with `התחברות / הרשמה` CTA; form remains disabled until signed in.
   - Plain `user`: heading `הצע מתכון לספר`, CTA `שלח מתכון`, AI Import button hidden (callables require `approved`/`manager`). Saving executes an **atomic Firestore WriteBatch** creating BOTH `recipes/{id}` (`visibility: 'private'`, `authorId: uid`) AND `recipe_submissions/{id}` (`submissionRecord`, `status: 'pending'`) in a single commit (required by `firestore.rules` `submittedTogether(recipeId)`!).
   - `approved` & `manager`: heading `מתכון חדש`, CTA `שמירה`, AI Import button visible (`ייבוא מתכון ב-AI`). Save choice dialog allows saving privately (`to-try` / `tested`), saving & submitting for approval (batch), or (managers only) publishing directly.
2. **Full Recipe Form (`src/components/recipe-form/`):**
   - Validates all required fields via `@cookbook/core` `missingRequiredFields` (`name`, `category` from `CATEGORY_IDS`, `difficulty` from `DIFFICULTIES`, positive integer `prepTime`, positive integer `servings`, at least 1 ingredient, at least 1 instruction) and `isValidAmount` for numeric/fraction ingredient amounts (`HEBREW_UNITS` autocomplete suggestions).
   - Supports toggling between flat `ingredients[]` and `ingredientSections[]` (`MIN_SECTIONS = 2`), and between flat `instructions[]` and `stages[]` (`MIN_SECTIONS = 2`).
   - **Photos (`expo-image-picker`):** Pick/capture up to `MAX_PHOTOS = 5` photos (`<= 5 MB` each), choose primary photo, reorder/remove. Uploads to `users/{uid}/recipes/{recipeId}/images/...` (private) or `recipes/{recipeId}/images/...` (published/submitted) with **mandatory `customMetadata: { uploadedBy: uid }`**.
   - **Step Media (`mediaInstructions[]`):** Upload step images or videos (`<= 50 MB`) with editable Hebrew captions and drag/button reordering; uploads carry `customMetadata: { uploadedBy: uid }`.
   - **Related Recipes Picker:** Link up to `MAX_RELATED_RECIPES = 4` published recipes.
   - **Preview Toggle (`תצוגה מקדימה`):** Renders the live Recipe Detail preview before saving.
   - **Edit Mode & Edit Suggestions:** Reuses the exact same form for editing own private recipes, manager direct edits, and `הצע עריכה` (staging any new files under `suggestions/{suggestionId}/images|media/...` tagged with `uploadedBy: uid` and writing `recipe_edit_suggestions/{suggestionId}`).
3. **AI Recipe Import (`AIEnhancementService` + `RecipeImportModal`):**
   - Three tabs: `מתמונה` (`extractRecipeFromImage`, up to 4 images as base64), `מקישור` (`extractRecipeFromUrl`), `מיוטיוב` (`extractRecipeFromVideo`, validating YouTube URL via `@cookbook/core/youtube-url`).
   - **Filler Mini-Game During Extraction:** While the callable awaits Gemini (e.g. 3 s DTU artificial delay), mounts a random filler mini-game (`memory` or `burger` ONLY — matching `GameWrapper.random()`, never `excludeFromRandom` games) with loading banner; once extraction completes, shows `המתכון מוכן!` banner and CTA `הצג מתכון` to populate the form.
   - **Error Handling:** Clear Hebrew error alerts on extraction failures (invalid URL, YouTube error, rate limit, timeout); server-side callable logs URL/video failures into `failed_url_extractions`.
4. **Native OS Share Target (`useShareIntent`):**
   - **Android (`expo-share-intent`):** Handles incoming `android.intent.action.SEND` (`text/plain` URLs or YouTube links, `image/*` photos).
   - **iOS Simulator & Deep-Link Share Handoff:** Handles URL scheme `cookbook-e2e://propose-recipe?importUrl=<encodedUrl>` (and `cookbook-staging://...`; physical-device iOS Share Extension App Group activates in Phase 6 when `EXPO_ENABLE_APPLE_PAID_ENTITLEMENTS=true`).
   - When a shared URL/YouTube link or image arrives: opens `/propose-recipe`, auto-selects the matching AI import tab (`מיוטיוב` if `parseYouTubeUrl` matches, `מקישור` for web URLs, `מתמונה` for shared images), pre-fills the payload, and lets the user trigger import with 1 tap (or auto-triggers if signed in & approved).

## 3. Required `testID` Contracts

- `propose-screen`, `propose-login-prompt`, `recipe-form-name`, `recipe-form-category`, `recipe-form-difficulty`, `recipe-form-preptime`, `recipe-form-waittime`, `recipe-form-servings`, `recipe-form-sectioned-toggle`, `recipe-form-staged-toggle`
- `ingredient-input-item-<idx>`, `ingredient-input-amount-<idx>`, `ingredient-input-unit-<idx>`, `add-ingredient-btn`, `instruction-input-<idx>`, `add-instruction-btn`
- `add-photo-btn`, `photo-thumb-<idx>`, `add-step-media-btn`, `recipe-form-preview-btn`, `recipe-form-submit-btn`, `save-choice-private-btn`, `save-choice-submit-btn`
- `ai-import-open-btn`, `ai-import-modal`, `ai-tab-image`, `ai-tab-url`, `ai-tab-youtube`, `ai-url-input`, `ai-extract-btn`, `ai-filler-game`, `ai-extract-ready-btn`, `ai-extract-error`

## 4. Acceptance & Edge Cases

- **P0:** Plain `user` submission uses atomic `WriteBatch` (`recipes/{id}` + `recipe_submissions/{id}`); never attempts unbatched private write.
- **P0:** Every uploaded recipe photo, step media file, and suggestion staged file includes `customMetadata: { uploadedBy: uid }`.
- **P0:** Invalid ingredient amounts (`"2-3"`, `"abc"`) block submission with clear Hebrew field error.
- Gemini Twin fault injection (`timeout`, `rate-limit-429`, `invalid-youtube-url`) surfaces a clean recoverable Hebrew error without crashing and creates the expected `failed_url_extractions` doc.
