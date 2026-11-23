# NLSpec 08 — Grandma's Cookbook (ספר המתכונים של סבתא)

- **Wave:** 2 (Parallel Core)
- **Depends On:** Slice `01`
- **Web Semport Oracles:** `src/app/pages/documents-page.js`, `src/js/services/pdf/pdf-service.js`, `src/lib/utilities/pdf_viewer/pdf_viewer.js`, `firestore.rules` (`match /cookbook/{document=**}`), `storage.rules` (`match /grandmas_cookbook/{allPaths=**}`)

## 1. User Intent

Approved family members and managers browse Grandma's original scanned handwritten Hebrew cookbook (**ספר המתכונים של סבתא**) in a smooth, tactile book-like native viewer with pinch-to-zoom, RTL page swiping, an RTL Table-of-Contents drawer to jump straight to any chapter, disk caching of scanned pages, and remembered reading position.

## 2. Behavioral Contract

1. **Strict Role Gate (`app/(tabs)/grandmas-cooking.tsx`):**
   - Only `approved` and `manager` roles may access this screen.
   - Guests and plain `user` accounts attempting to open `/grandmas-cooking` (including via deep link) are immediately redirected to `/home` with an informative Hebrew toast; no `cookbook/` Firestore read is fired while unauthorized.
   - Signing out while viewing immediately redirects to `/home`.
2. **Manifest & Page Image Service (`PdfService`):**
   - Reads Firestore doc `cookbook/grandmas_cookbook` (`{ title, totalPages, storagePrefix, toc: [{ title, page }] }`).
   - Resolves Storage URLs for `${storagePrefix}/page.${n}.jpg` (`n = 1..totalPages`) and caches resolved URLs in memory + image bytes on disk via `expo-image` (`cachePolicy="disk"`) and prefetches adjacent pages (`n-1`, `n+1`) so page turning has zero flicker.
3. **Pinch-to-Zoom Horizontal Pager & Controls:**
   - Displays current page counter (`עמוד X מתוך Y`), previous/next page buttons respecting RTL reading flow, and smooth horizontal paging (`FlatList` / `PagerView`) with gesture-handler pinch-to-zoom & double-tap zoom (`1x` ↔ `2.5x`) and pan while zoomed.
   - Persists last viewed page number locally (`AsyncStorage`) so returning to Grandma's Cookbook resumes where the user left off.
4. **RTL Table of Contents Drawer (`תוכן עניינים`):**
   - Header button (`testID="grandma-toc-btn"`) opens an RTL slide-over drawer listing all `toc[]` chapters with title and page number.
   - Tapping a TOC entry closes the drawer and jumps immediately to the target page (`page`).

## 3. Required `testID` Contracts

- `grandma-screen`, `grandma-title`, `grandma-page-indicator`, `grandma-page-image-<pageNum>`, `grandma-prev-btn`, `grandma-next-btn`, `grandma-zoom-reset-btn`
- `grandma-toc-btn`, `grandma-toc-drawer`, `grandma-toc-item-<pageNum>`, `grandma-toc-close-btn`

## 4. Acceptance & Edge Cases

- **P0:** Plain `user` and unauthenticated guests are completely blocked from viewing Grandma's Cookbook and cannot read `cookbook/grandmas_cookbook` (`firestore.rules` enforces `isApproved()`).
- TOC jump from page 1 → page 3 updates `grandma-page-indicator` to `3 / 3` and renders `grandma-page-image-3` cleanly with zero crash or white flicker.
- Offline revisit of previously loaded pages displays cached disk images gracefully.
