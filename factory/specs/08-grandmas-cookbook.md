# NLSpec 08 — Grandma's Cookbook (ספר המתכונים של סבתא)

- **Wave:** 2 (Parallel Core)
- **Depends On:** Slice `01`
- **Web Semport Oracles:** `src/app/pages/documents-page.js`, `src/app/pages/documents-page.html`, `src/js/services/pdf/pdf-service.js`, `src/lib/utilities/pdf_viewer/pdf_viewer.js`, `firestore.rules`, `storage.rules`

## 1. User Intent

Approved family members and managers browse Grandma's original scanned handwritten Hebrew cookbook (**ספר המתכונים של סבתא**) in a smooth, tactile book-like native viewer with pinch-to-zoom, fullscreen toggle, RTL page swiping, a searchable 2-level RTL Table-of-Contents drawer (`קטגוריה` → `מתכונים`) to jump straight to any recipe or chapter, disk caching of scanned pages, and remembered reading position.

## 2. Behavioral Contract

1. **Strict Role Gate (`app/(tabs)/grandmas-cooking.tsx`):**
   - Accessible ONLY when `role === 'approved' || role === 'manager'`.
   - Guests and plain `user` accounts attempting to open `/grandmas-cooking` (including via deep link `cookbook-e2e://grandmas-cooking`) are immediately redirected to `/home`; zero `cookbook/recipes` Firestore read is fired while unauthorized.
   - Signing out while viewing immediately redirects to `/home`.
2. **Exact Web Firestore Manifest & Storage Service (`PdfService`):**
   - Reads Firestore document **`cookbook/recipes`** (`PdfService.getPageIndex('cookbook', 'recipes')`) — NEVER a fictional `cookbook/grandmas_cookbook` doc!
   - Exact Firestore schema matching live Firebase Staging & Production (`pdf_viewer.js:24-27, 106-139`):
     ```ts
     {
       categories: Record<string, { startPage: number; endPage?: number }>;
       recipes: Record<string, number>; // recipeName -> 1-based page number
     }
     ```
   - Derives `totalPages` as `92` in staging/production (matching `documents-page.html:3` `total-pages="92"`), or when running in `e2e` DTU mode computes `Math.max(...categoryEndPages, ...recipePages)` (yielding `3` for seeded DTU fixtures).
   - Resolves Storage URLs at **`grandmas_cookbook/original/page.${pageNumber}.jpg`** (`pageNumber = 1..totalPages`), caching resolved URLs in memory and image bytes on disk via `expo-image` (`cachePolicy="disk"`) while prefetching adjacent pages (`n-1`, `n+1`) for flicker-free turning.
3. **Pinch-to-Zoom Horizontal Pager & Controls:**
   - Displays current page indicator formatted consistently as **`עמוד X מתוך Y`** (`grandma-page-indicator`, e.g. `עמוד 3 מתוך 3`), previous/next page buttons (`הקודם` / `הבא`) respecting RTL reading flow, and smooth horizontal paging (`FlatList` / `PagerView`) with gesture-handler pinch-to-zoom, double-tap zoom / fullscreen mode toggle (`1x` ↔ `2.5x`), and pan while zoomed.
   - _(Mobile enhancement)_ Persists last viewed page number locally (`AsyncStorage`) so returning to Grandma's Cookbook resumes where the user left off (clamped to `1..totalPages`).
4. **Searchable 2-Level RTL Table of Contents Drawer (`תוכן עניינים`):**
   - Header button (`testID="grandma-toc-btn"`) opens an RTL slide-over drawer displaying:
     - Live search input (`grandma-toc-search-input`, placeholder **`חיפוש מתכון או קטגוריה...`**) filtering both category names and recipe names and auto-expanding matching categories.
     - Collapsible category sections sorted by `startPage` showing category name + page range (`${startPage}–${endPage}`), expanding to list clickable recipes grouped into that category's page range with page numbers (`grandma-toc-item-<pageNum>`).
     - Highlights the currently viewed recipe & category.
   - Tapping any category or recipe closes the drawer and jumps immediately to its target page.

## 3. Required `testID` Contracts

- `grandma-screen`, `grandma-title`, `grandma-page-indicator`, `grandma-page-image-<pageNum>`, `grandma-prev-btn`, `grandma-next-btn`, `grandma-zoom-reset-btn`
- `grandma-toc-btn`, `grandma-toc-drawer`, `grandma-toc-search-input`, `grandma-toc-category-<idx>`, `grandma-toc-item-<pageNum>`, `grandma-toc-close-btn`

## 4. Acceptance & Edge Cases

- **P0:** Plain `user` and unauthenticated guests are completely blocked from viewing Grandma's Cookbook and cannot read `cookbook/recipes` (`firestore.rules` enforces `isApproved()`).
- TOC jump from page 1 → page 3 (`קינוחים של שבת` / `עוגת דבש של פעם`) updates `grandma-page-indicator` to `עמוד 3 מתוך 3` and renders `grandma-page-image-3` cleanly with zero crash or white flicker.
- Offline revisit of previously loaded pages displays cached disk images gracefully.
