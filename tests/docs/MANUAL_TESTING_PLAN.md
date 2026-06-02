# Our Kitchen Chronicles - Manual Testing Checklist

## Testing Workflow

### Release Pipeline

```
feature/bug branch → development → staging → main (production)
        ↓                ↓            ↓         ↓
   Preview Deploy   Dev Deploy  Stage Deploy  Production
```

### Pre-Production Testing Checklist (STAGING REQUIRED)

**Before merging staging → main:**

- [ ] **Staging Deployment** - Merge development → staging, verify deployment succeeds
- [ ] **Full Feature Testing** - Run complete 🆕 NEW features test suite on staging
- [ ] **Critical Regression** - Run 🔴 Critical EXISTING features regression tests
- [ ] **Cross-Browser Testing** - Test on Desktop (Chrome/Firefox) + Mobile (iOS/Android)
- [ ] **User Role Testing** - Test all user roles (Guest/User/Manager)
- [ ] **Console Verification** - Check browser DevTools for errors/warnings
- [ ] **Performance Check** - Verify page load times and responsiveness
- [ ] **Bug Documentation** - Document any issues → fix in development → re-test staging
- [ ] **Sign-Off** - Get approval from tester before merging to main

**Production Deployment (main):**

- [ ] **Merge to Main** - Only merge from staging after all checks pass
- [ ] **Smoke Test** - Quick verification of 🆕 NEW features in production
- [ ] **Critical Path Test** - Quick verification of 🔴 Critical EXISTING features
- [ ] **Monitor Deployment** - Watch for errors in production logs
- [ ] **Archive Tests** - Move passing 🆕 NEW tests to ✅ EXISTING section

**⚠️ CRITICAL RULE**: Never merge to `main` without successful staging verification!

---

## Testing Priorities Legend

- 🔴 **Critical** - Must test before production release
- 🟡 **High** - Important functionality, should test
- 🟢 **Medium** - Standard functionality, test if time permits

## Feature Categories

- 🆕 **NEW** - Features added in current release (staging → main)
- ✅ **EXISTING** - Baseline regression test suite (reused each release)

---

## 🆕 NEW FEATURES IN THIS RELEASE (development → staging)

> **Focus Area**: Test these comprehensively on STAGING before merging to main. After production deployment, integrate passing tests into EXISTING section.

**Release Info:**

- **Key areas affected**:
  - **Recipes**: "Suggest an Edit" — users propose edits to existing recipes; managers review a full contextual diff and approve/reject (new `recipe_edit_suggestions` collection + firestore rules).
  - **Recipe Import**: YouTube video extraction in the import modal; backend `gemini-service` refactor.
  - **Recipe Forms**: unified form-field contract refactor across all recipe form components (high regression surface on Propose Recipe + Manager edit).
  - **Games**: two new mini-games — Knife Skills and Pizzatron — plus a portrait-orientation rotate prompt.
  - **My Meal**: ingredients drawer migrated to the shared `app-drawer` component.
  - **i18n/Fixes**: router error message localized to Hebrew; category-change image migration fix.

---

### 1. Suggest an Edit — User Flow (Create)

**Impact**: Recipe Detail page, new moderation collection

- [ ] 🔴 **Entry Point (auth-gated)** - As a **logged-in** user, open a recipe → menu shows "הצע עריכה". As a **guest**, the item is hidden.
- [ ] 🔴 **Modal Seeds Recipe** - Click "הצע עריכה". Modal opens with the recipe-form pre-filled with the current recipe (name, ingredients, instructions, images, media).
- [ ] 🔴 **Submit Suggestion** - Change a field (e.g. fix a typo in an ingredient), submit. Success toast appears; the **live recipe is NOT changed**.
- [ ] 🟡 **Reopen Resets** - Close and reopen the modal. Verify the form re-seeds cleanly (no duplicated images / leftover edits from the previous open).
- [ ] 🟡 **Add Image/Media** - Suggest adding a new image and a new media instruction; submit. Verify it uploads without errors (and without replacing the recipe's primary image).

### 2. Suggest an Edit — Manager Review (Approve / Reject)

**Impact**: Manager Dashboard

- [ ] 🔴 **Pending Edits Section** - As **Manager**, open Dashboard. "הצעות עריכה ממתינות" section lists pending suggestions (empty-state message when none).
- [ ] 🔴 **Contextual Diff View** - Open a suggestion. The whole recipe renders in the recipe-display language with changes highlighted in context: metadata rows show `before ← after`; added/removed ingredient & instruction lines marked `+/−`; added images green, removed red.
- [ ] 🔴 **Approve Applies Changes** - Approve a suggestion. Verify the live recipe now reflects the changes and the suggestion leaves the pending list.
- [ ] 🔴 **Reject Discards** - Reject a suggestion. Verify the recipe is unchanged and any uploaded suggestion images/media are cleaned up (not orphaned).
- [ ] 🟡 **Suggester Name** - Verify the review header shows who submitted the suggestion.
- [ ] 🟡 **Supersede Other Pendings** - With two pending suggestions on the **same recipe**, approve one. Verify the other is superseded (no longer applies a stale diff).
- [ ] 🟡 **Media Caption Change** - Suggest a media caption-only change and verify the diff surfaces the caption change.
- [ ] 🟡 **Clear All Media** - Suggest removing all media instructions; approve. Verify the recipe ends with no media.
- [ ] 🟢 **Section Refresh** - Use the section refresh icon; pending edits reload without a full-page reload.

### 3. Suggest an Edit — Security

**Impact**: Firestore rules (`recipe_edit_suggestions`)

- [ ] 🔴 **No Self-Approve** - As a regular user, confirm there is no path to approve your own suggestion (approval lives only behind the manager dashboard / rules).
- [ ] 🔴 **Guest Blocked** - As a guest, attempt to create a suggestion → permission denied.
- [ ] 🟢 **Production Rules Deploy** - ⚠️ `firestore.rules` for the new collection must be deployed to **production** before/at release (`firebase deploy --only firestore:rules`). Confirm before running.

### 4. YouTube Video Recipe Import

**Impact**: Propose Recipe → Import Modal

- [ ] 🔴 **Video Tab** - Open the Import Modal. A "מסרטון YouTube" tab is present alongside Image/URL.
- [ ] 🔴 **Extract From Video** - Paste a valid YouTube URL and run extraction. Loading state shows; recipe fields populate from the video.
- [ ] 🟡 **Invalid URL** - Paste a non-YouTube / malformed URL. Verify the inline error appears and extraction is blocked.
- [ ] 🟡 **Existing Image/URL Modes** - Verify Image upload and generic URL import still work (regression — backend gemini-service was refactored).

### 5. Recipe Form Refactor (Unified Field Contract)

**Impact**: Propose Recipe page + Manager recipe edit modal — broad regression surface

- [ ] 🔴 **Propose Recipe (full)** - Re-run the core Propose Recipe checks (flat & sectioned ingredients, flat & multi-stage instructions, metadata, related field, validation, submit). All must still pass.
- [ ] 🔴 **Manager Edit Recipe** - Open the edit modal in the dashboard, change fields across all component types, save. Verify changes persist correctly.
- [ ] 🟡 **Validation Parity** - Verify per-field validation, error highlighting, and clear-on-typing still behave per the EXISTING Propose Recipe checklist.
- [ ] 🟡 **Mode Toggles** - Toggle flat↔sectioned (ingredients) and flat↔staged (instructions); data persists across toggles.

### 6. New Mini-Games (Easter Egg `/games`)

**Impact**: Games page (unlock via 7 logo taps in 2s)

- [ ] 🟢 **Knife Skills** - Launch "אמנות הסכין" 🔪. Swipe to slice produce; hazards (bomb/boot) end the run; 3 misses end the run; timer scores the run.
- [ ] 🟢 **Pizzatron** - Launch "הפיצריה" 🍕. Assemble pizzas per the order on the conveyor.
- [ ] 🟢 **Rotate Prompt** - On a mobile **portrait** device, opening Knife Skills shows the rotate-to-landscape recommendation; rotating dismisses it.
- [ ] 🟢 **Game Wrapper** - Start overlay, timer HUD, game-over and completion screens behave for both new games.

### 7. My Meal Drawer Migration

**Impact**: Ingredients drawer (`/my-meal`)

- [ ] 🟡 **Shared Drawer** - Open/close the ingredients drawer via button and backdrop (now uses the shared `app-drawer`). Verify it owns its own backdrop and does not overlap nav/header.
- [ ] 🟡 **View Switching & Copy** - "Current Recipe" vs "All Ingredients" switching works; Copy-to-clipboard still shows the feedback toast.

### 8. Localized Router Error

**Impact**: Routing

- [ ] 🟢 **Hebrew Route Error** - Trigger a routing error (e.g. a bad direct URL). Verify the error message is shown in Hebrew.

### 9. Category-Change Image Migration Fix

**Impact**: Manager Dashboard recipe edit

- [ ] 🟡 **No Image Loss on Category Change** - Edit a recipe and change its category (with images). Verify images are NOT deleted and still display after save (migration no-ops when source === target category).

---

## ✅ EXISTING FEATURES (Baseline Regression Test Suite)

> **Purpose**: Core functionality that should work in every release. Test critical paths to ensure new features didn't break existing functionality.

### 1. Home Page (index.html)

#### 🔴 Critical

- [ ] Page loads correctly with all content visible
- [ ] Navigation menu displays and links work
- [ ] Featured recipes section displays recipe cards
- [ ] Recipe cards are clickable and navigate to recipe page
- [ ] Firebase connection established (no console errors)
- [ ] **Search Navigation** - Single search result navigates directly to recipe page
- [ ] **Search Toast** - Toast notification appears ("Found 1 recipe...") for single result

#### 🟡 High

- [ ] **Recipe Grid Performance** - Load Home Page. Verify no "waterfall" of individual requests for recipe favorites (N+1 probem fixed).
- [ ] **Image Loading (LRU cache)** - Scroll through Home, Categories, and a Recipe page. Verify images load correctly with no console errors and no runaway memory growth (URL cache uses an LRU policy).
- [ ] **3D Auth Avatar** - Hover over user avatar. Verify 3D tilt effect. Click and verify menu opens.
- [ ] **Recipe Card** - Hover over any part of a recipe card. Verify pointer cursor. Click anywhere on card -> navigates to recipe.
- [ ] **Layout Stability** - Open a modal (e.g., Login). Verify page background does not shift (check scrollbar gutter).
- [ ] Logo link stays on home page (doesn't navigate away)
- [ ] Auth avatar shows correct state (login prompt vs user avatar)
- [ ] Page is responsive on mobile devices
- [ ] All category jars display correctly
- [ ] Category jars link to correct category pages

#### 🟢 Medium

- [ ] Search bar functions (accepts input, triggers search)
- [ ] Search input clears after search is performed

---

### 2. Categories Page (categories.html)

#### 🔴 Critical

- [ ] Recipe grid displays recipe cards properly
- [ ] Recipe cards navigate to individual recipe pages
- [ ] "All categories" option shows all approved recipes
- [ ] All categories appear in filter dropdown and work correctly

#### 🟡 High

- [ ] Category filtering works (clicking category shows only those recipes)
- [ ] Search functionality filters recipes correctly
- [ ] Pagination works (next/previous buttons, page info)
- [ ] Filter modal opens and applies filters correctly
- [ ] Categories nav button resets filters

#### 🟢 Medium

- [ ] Search input clears after search is performed
- [ ] Page maintains selected category when navigating back
- [ ] Move to favorites with filter/nav button works
- [ ] Filters preserved on category change
- [ ] Favorites filter appears for logged-in users

---

### 3. Recipe Page (recipe-page.html)

#### 🔴 Critical

- [ ] Recipe details display correctly (name, ingredients, instructions)
- [ ] **Security**: Content handles special characters safely (XSS check)
- [ ] Recipe images load and display properly (carousel)
- [ ] Ingredients list is readable and properly formatted
- [ ] Step-by-step instructions display in correct order
- [ ] Page works for both logged-in and guest users
- [ ] **Image Proposal** - Image proposal modal opens from menu (for users)
- [ ] **Browser History** - Browser history shows correct recipe names

#### 🟡 High

- [ ] Both flat and sectioned ingredients displayed correctly
- [ ] Both flat and sectioned instructions displayed correctly
- [ ] Stage numbering and formatting is correct for multi-stage instructions
- [ ] Check recipes with one or multiple images
- [ ] **Recipe Scroller** - Images scroll smoothly in new scroller component
- [ ] **Modal Responsiveness** - Images/Modals scroll properly on mobile
- [ ] Change amount of dishes (servings adjuster) works
- [ ] Check recipes with media instructions
- [ ] Check media instructions on fullscreen
- [ ] **Tab Title** - Tab title updates to recipe name

#### 🟢 Medium

- [ ] Cooking time and difficulty level shown correctly
- [ ] Back navigation returns to previous page
- [ ] Recipe metadata (category, tags) displays correctly
- [ ] Recipes without main ingredient display correctly (field optional)

---

### 4. Profile Page (profile.html)

#### 🔴 Critical

- [ ] User favorites display correctly
- [ ] Recipe cards navigate to recipe pages
- [ ] Page redirects non-logged-in users appropriately

#### 🟡 High

- [ ] Category filtering works on favorites
- [ ] Search functionality filters favorite recipes
- [ ] Return gets back to favorites (not categories)
- [ ] Remove from favorites button works
- [ ] Can move to categories page by removing the favorites filter
- [ ] Can move to categories page by pressing the categories nav button

#### 🟢 Medium

- [ ] Empty favorites state displays appropriate message
- [ ] Pagination works for large favorite lists

---

### 5. Propose Recipe Page (propose-recipe.html)

#### 🔴 Critical - Basic Form

- [ ] Form displays all required fields (name, ingredients, instructions, etc.)
- [ ] Form validation prevents submission with missing required fields
- [ ] Submit button sends recipe for approval
- [ ] Success message displays after submission
- [ ] Form resets after successful submission
- [ ] Page requires user authentication
- [ ] If closing the modal without logging in - reroutes to home
- [ ] If logging in returns to the same page
- [ ] **Magic Wand Button** - Verify button appears in Import Modal and has correct styling.
- [ ] **Image Analysis** - Upload an image via the Magic Wand and verify analysis triggers (loading state).
- [ ] **Field Population** - Verify fields are populated correctly from the analyzed image.
- [ ] **Security (Strict Rules)** - Log in as regular user. Create a recipe. Verify success.

#### 🟡 High - Ingredients

- [ ] Add/remove ingredient lines works correctly in flat mode
- [ ] Add/remove ingredient sections works correctly (multi-category mode)
- [ ] Section titles for ingredients can be added/edited
- [ ] Toggle between flat and sectioned ingredient modes
- [ ] Minimum 2 sections with titles when in sectioned mode
- [ ] Data persists when toggling between modes
- [ ] Component-level validation for ingredients (sectioned mode)

#### 🟡 High - Instructions

- [ ] Add/remove instruction steps works correctly in flat mode
- [ ] Add/remove instruction stages works correctly (multi-stage mode)
- [ ] Stage titles for instructions can be added/edited
- [ ] Toggle between flat and multi-stage instruction modes
- [ ] Minimum 2 stages with titles when in multi-stage mode
- [ ] Data persists when toggling between modes
- [ ] Component-level validation for instructions (staged mode)

#### 🟡 High - Form Validation

- [ ] Main ingredient field is OPTIONAL (can be left blank)
- [ ] Validation shows specific error messages per field
- [ ] Invalid fields are highlighted with visual indicators
- [ ] Error highlighting clears when user starts typing

#### 🟢 Medium - Form Protection

- [ ] Warning appears when trying to navigate away with unsaved changes
- [ ] Browser "beforeunload" warning when closing tab with unsaved changes
- [ ] Form dirty state indicator shows when form has been modified
- [ ] Clear button shows confirmation dialog when form is dirty
- [ ] Dirty state clears after successful form submission
- [ ] Navigation guard prevents accidental data loss

#### 🟢 Medium - Other

- [ ] Clear button works
- [ ] Image upload functionality works

---

### 6. Manager Dashboard (manager-dashboard.html)

#### 🔴 Critical

- [ ] User management section displays all users
- [ ] Pending recipes section shows recipes awaiting approval
- [ ] All recipes section displays with search and filter
- [ ] Approve/reject recipe functionality works
- [ ] User role management works (promote/demote users)
- [ ] Page requires manager/admin authentication
- [ ] Recipe search and category filter work correctly
- [ ] **Image Approval** - Consolidated modal for batch approval works
- [ ] **Image Approval** - Approve/Reject All buttons work
- [ ] **Category Migration** - Changing category migrates images correctly
- [ ] **Bug Fix (Double Image)** - Open Recipe Preview. Verify main image appears only once.

#### 🟡 High

- [ ] Recipe edit modal opens correctly
- [ ] Recipe edit modal saves changes successfully
- [ ] Recipe preview works
- [ ] Modal closes properly after actions
- [ ] **Loading States** - Loading overlays prevent interaction during saved/updates

#### 🟢 Medium

- [ ] Pending images section displays (placeholder for future feature)

---

### 7. Documents Page (documents.html)

#### 🔴 Critical

- [ ] PDF documents list displays correctly
- [ ] PDF files open and display properly
- [ ] Only authenticated users are allowed - reroutes to home on log out

#### 🟢 Medium

- [ ] Documents are organized/categorized appropriately
- [ ] Mobile viewing of PDFs works correctly
- [ ] Search within document works

---

### 8. Authentication System

#### 🔴 Critical

- [ ] Login form accepts valid credentials and logs user in
- [ ] Login form rejects invalid credentials with error message
- [ ] Logout functionality works and clears user session
- [ ] Auth state persists across page refreshes
- [ ] Protected pages redirect unauthenticated users appropriately
- [ ] **Security (Strict Rules)** - Log out (Guest). Try to save a recipe. Verify permission denied error.
- [ ] **Lazy Loading** - Verify "Auth" code chunk is NOT loaded until "Login" is clicked.

#### 🟡 High

- [ ] Sign in with Google
- [ ] Auth modal content is fully visible (no overflow)
- [ ] Sign up with Google
- [ ] Signup form creates new user account successfully
- [ ] Signup form validates email format and password requirements
- [ ] Auth avatar shows correct user state (logged in/out)

#### 🟢 Medium

- [ ] Remember me works
- [ ] Forgot password sends reset email correctly
- [ ] User profile displays and allows editing user information

---

### 9. Navigation & Routing

#### 🔴 Critical

- [ ] Main navigation menu links work correctly
- [ ] Page URLs update correctly when navigating
- [ ] Direct URL access loads correct pages
- [ ] Logo click returns to home page

#### 🟡 High

- [ ] Mobile side menu opens and closes properly
- [ ] Mobile menu does not overlap other interface elements (e.g. drawers)
- [ ] Side menu closes after search/navigation
- [ ] Back button functionality works as expected
- [ ] Navigation preserves user state (auth, filters)
- [ ] **Protected Routes** - Verify redirect to Home (or Login) without infinite loop when accessing `/propose` logged out.
- [ ] **Focus Trap** - Open any modal. Press Tab. Verify focus stays inside the modal and does not escape.
- [ ] **Focus Return** - Close modal. Verify focus returns to the element that opened it.

#### 🟢 Medium

- [ ] External links open in appropriate tabs

---

### 10. Ingredients Drawer (my-meal.html)

#### 🔴 Critical

- [ ] Drawer opens/closes correctly via button and backdrop
- [ ] "Current Recipe" vs "All Ingredients" view switching works
- [ ] **Copy to Clipboard** - Copies text and shows feedback toast

---

## Testing Environment & Execution

### Required Test Environments

**⚠️ STAGING IS MANDATORY before production deployment**

1. **Staging (REQUIRED)** - Complete testing before merging to main

   - Run ALL 🆕 NEW features test suite (comprehensive)
   - Run ALL 🔴 Critical EXISTING features (regression)
   - Run 🟡 High priority tests if time permits
   - Test on all required browsers and devices
   - Document ALL issues found
   - Get sign-off approval before proceeding

2. **Production (After staging passes)** - Post-deployment verification
   - Quick smoke test of 🆕 NEW features (verify deployment worked)
   - Quick smoke test of 🔴 Critical EXISTING features (verify no breakage)
   - Monitor logs and error tracking

**Standard regression testing** (both staging and production):

- **Desktop browsers**: Chrome (required), Firefox (required), Safari (if available)
- **Mobile devices**: iOS Safari (required), Android Chrome (required)
- **Tablet**: Test on at least one platform (recommended)

### User Role Coverage (test all roles in staging)

- **Guest** (not logged in)
- **Regular User** (authenticated)
- **Manager** (manager role)

### Staging-to-Main Workflow

```bash
# 1. Ensure staging is deployed and stable
git checkout staging
git pull origin staging

# 2. Review changes between staging and main
git log main..staging --oneline
git diff main..staging --stat

# 3. Run complete test suite on staging environment
# → Use this checklist

# 4. After ALL tests pass and sign-off received
git checkout main
git merge staging --ff-only  # Fast-forward merge only
git push origin main

# 5. Monitor production deployment
# → Run smoke tests in production

# 6. Deploy Infrastructure (Rules & Functions)
# → MANDATORY: Deploy updated security rules and functions
firebase deploy --only firestore:rules,storage,functions
```

---

## Known Issues & Notes

### Features Not Yet Implemented

- **Pending images approval** - UI present in Manager Dashboard but functionality not implemented

### Performance

- **Large media files** (20+ items or files >20MB each) may impact loading times - acceptable as long as page remains responsive

### For Next Release

After this release is deployed to production:

1. **Update CHANGELOG** - Add new entry to [CHANGELOG.md](../CHANGELOG.md) with:
   - Version number and deployment date
   - Added/Changed/Fixed sections from this release
   - Move current "Unreleased" items to new version section
2. **Update EXISTING tests** - Move passing NEW feature tests into appropriate EXISTING sections
3. **Clear NEW section** - Remove all items from NEW features section
4. **Update metadata** - Update release version, commit count, and date below
5. **Prepare next cycle** - Merge development → staging for next release

---

## Release Tracking

**Release Version**: development → staging
**Commits since main**: 30
**Last Updated**: 2026-06-02

### Testing Sign-Off

**Staging Environment**:

- [ ] Test Date:
- [ ] Tested By:
- [ ] Browser Coverage: Chrome ☐ | Firefox ☐ | Safari ☐ | Mobile iOS ☐ | Mobile Android ☐
- [ ] All 🔴 Critical tests passed: ☐
- [ ] All 🆕 NEW feature tests passed: ☐
- [ ] Issues found (if any):
- [ ] **APPROVED FOR PRODUCTION**: ☐ (signature required)

**Production Environment**:

- [ ] Deployment Date:
- [ ] Smoke Test Passed: ☐
- [ ] Critical Path Verified: ☐
- [ ] Build/Commit Hash:
- [ ] Rollback Plan (if needed):
