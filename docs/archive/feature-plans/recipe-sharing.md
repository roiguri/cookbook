# Feature Plan: Recipe sharing

> **Archived 2026-10-14.** R1 (send a recipe), R2a (link previews) and R3a (share a private recipe with family) are built and merged; the production rollout is recorded under "Rollout" at the end. Open follow-ups are GitHub issues: **#383** (R3b notifications, R3c claim link), **#417** (R4 print / PDF), **#382** (share target).

## Context

Today a recipe can't be shared from the recipe page (`recipe-detail-page.html` has a `TODO - add print/share button`). The only share in the app is My meal's ingredient list (`navigator.share`, text).

- **Published recipes** are publicly readable (Firestore and Storage), so their links already open for anyone, signed in or not. But `index.html` has no Open Graph tags, so a pasted link previews as the generic app title, with no photo or recipe name.
- **Private recipes** are readable only by their author and managers (rules + `users/{uid}/recipes/{id}/…` in Storage). A link to one shows "not found" to anyone else.
- **Users can't see each other:** `users/{uid}` is readable by its owner and managers only.
- **Push notifications** (FCM) exist for managers (submissions).

Related issues: #383 (share private recipes with specific people), #382 (share target), #373 (collections, which need a shared "removed" state).

## Ways to share

| Direction                     | Recipient             | What they get                    |
| ----------------------------- | --------------------- | -------------------------------- |
| Published recipe, outside     | Anyone, no account    | A link with a proper preview     |
| Any recipe, as content        | Anyone                | Formatted text, print / PDF      |
| Private recipe, between users | Chosen family members | Live read-only access in the app |
| Into the app (#382)           | Yourself              | Share a link into the import     |

## Releases

Each release ships something usable on its own and builds on the previous one.

| Release | What                                                          | Size         | Data / rules change |
| ------- | ------------------------------------------------------------- | ------------ | ------------------- |
| R1      | Send a recipe: link + text                                    | Small        | No                  |
| R2      | Links that look good (link previews)                          | Small–medium | No                  |
| R3      | Share with family in the app (#383)                           | Large        | Yes                 |
| R4      | PDF / print                                                   | Medium       | No                  |
| —       | Share target (#382), separate track, independent of the above | Medium       | No                  |

### R1: Send a recipe (link + text)

- A share button on the recipe page.
- **Published:** the native share sheet with the link and a short text; without a share sheet, copy the link.
- **Private:** the full recipe as formatted text (a link wouldn't open for anyone else).
- One text formatter, also used by My meal's ingredient list.
- **Impact:** anyone can send any recipe to the family WhatsApp from day one. The base every later release builds on.

**Decisions (2026-10-14):**

- **Placement:** a share icon in the recipe page's top corner, beside the ⋮ menu. Shown to everyone, signed out included (⋮ stays signed-in only).
- **Tap:** a published recipe opens a two-item menu, "שליחת קישור" (send link) and "שליחת המתכון כטקסט" (send the recipe as text, for people who won't open links). A private recipe skips the menu and sends the text.
- **Text:** the full recipe: title, description, servings, times and difficulty, ingredients by section, numbered steps by stage, notes (הערות), source, and the link at the end when published. Category, photos and media, tags and internal fields stay out. Amounts use the servings currently shown on the page. Headings use WhatsApp markup (`*bold*`, `_italic_`); other apps show the asterisks.
- **No share sheet** (e.g. Firefox, Linux desktop): the same menu items copy to the clipboard and confirm with a "הועתק" (copied) toast.
- **Look:** the share button reuses the ⋮ button's style and My meal's share icon (three connected dots, added to `icons.js` for both). The menu reuses the ⋮ dropdown and its items: two labels, no hint lines. Mock: "Sharing · R1" row on the Cookbook screens canvas (`Share-menu`, `Share-menu-phone`, `Share-copied`).

### R2: Links that look good

- WhatsApp and other apps show the recipe's photo, title and description instead of the generic app title.
- **Impact:** R1's links get opened, not ignored.

**How it works.** Link-preview bots read the HTML without running JavaScript, and every route serves the same `index.html`. A Netlify **Edge Function** runs before the page is returned: on `/recipe/:id` it reads the recipe through the Firestore REST API, signed out (the rules refuse private recipes, so a private name never reaches a preview), and rewrites the `<head>`: `<title>`, `description` and the Open Graph tags. Other pages get the site's default tags. Visitors see no difference; on any error the page is returned unchanged.

**Decisions (2026-10-14):**

- **Photo:** the recipe's primary **public** photo (`access: 'public'` only; family-only photos never appear in a preview), plain, no branding overlay. Shown as a large card.
- **Fallback card:** when there's no public photo, or the recipe is private or missing: a static branded image, the **green card** (spoon logo, "Our Kitchen / Chronicles" on two lines so a centre square crop still reads, "ספר המתכונים של המשפחה"). Mock: "Sharing · R2" row on the Cookbook screens canvas (`OgCard-green`).
- **Text:** the title is the recipe name; the description is the recipe's own, or a line like "קינוחים · 30 דקות הכנה · 20 מנות". The browser tab shows the recipe name too.
- **Images stay off Netlify:** photos are served from Firebase Storage, the fallback card as a static site file. No Netlify Image CDN.
- **Two steps:**
  - **R2a:** the Edge Function, default tags, the fallback card, the tab title. The photo tag points at the existing `_1080x1080.webp`; a real WhatsApp test decides whether WebP is enough.
  - **R2b:** our own `sharp` function replacing the Resize Images extension (#390, deadline 2027-03-31). **Not needed for previews:** the R2a test (2026-10-14, draft deploy, WhatsApp) showed the WebP photo, the green card, and no name for a private recipe. R2b stays part of the extension work in #390.

### R3: Share with family in the app (#383)

- The author of a private recipe shares it with chosen family members; it appears for them under "שותפו איתי" in their library.
- **Impact:** private recipes become shareable without publishing them.

**Decisions (2026-10-14):**

- **Who:** the author of a private recipe (approved family, managers) shares it; only **approved family and managers** can receive. Plain sign-ups never appear and can't receive. Any private recipe (to try, tested, pending, rejected) can be shared; a published one doesn't offer it (R1's link covers it).
- **Picking:** from a family list (name and avatar). A claim link ("whoever opens it gets access") was considered and **deferred**: it reaches no one the list doesn't, and adds a token flow; revisit if picking names turns out tedious.
- **Recipient gets a live, read-only view:** always the author's latest version; they can heart it, add it to My meal and send it as text (R1). The author keeps editing as before.
- **Where it shows:** a "שותפו איתי" chip in הספרייה שלי (only when something is shared), shared recipes also under "הכל"; a "מ׳ ‹name›" badge in the card's existing photo badge slot (card height must not change — compact cards without a photo need a placement that adds no line); a "‹name› שיתפ/ה איתך" line on the recipe page.
- **Lifecycle:** removing someone deletes their access (the recipe leaves their "שותפו איתי", and "שמרתי" like any recipe they can't read); publishing leaves shares as they are; deleting the recipe deletes its shares (a manager's delete may leave orphans, which the list skips).
- **Notifications:** deferred (R3b). The share flow ends with "send them the link" (R1).

**Data model and rules (approved 2026-10-14):**

- `recipes/{recipeId}/shares/{recipientUid}`: `{ recipientUid, authorId, authorName, sharedAt }`. One record per recipient; never edited, only created or deleted.
- The family list comes from a callable function `listFamilyMembers` (callers: approved family and managers), returning name and avatar of approved family and managers only. No user directory collection; `users/` stays private.
- Rules:
  - **Recipe read** adds: a share record for the caller exists and the caller is still approved family or a manager.
  - **Share create:** only the recipe's author, on a private recipe; record id = recipient uid ≠ author; the recipient's role is approved or manager; `sharedAt` = server time; only the four fields.
  - **Share delete:** the author, the recipient, or a manager. **No updates.**
  - **Share read:** the author, the recipient (collection-group query on `recipientUid` for "שותפו איתי"), managers.
  - **Storage:** a private recipe's photos (`users/{author}/recipes/{id}/…`) are also readable by anyone with a share record for that recipe.
- Rules tests on the emulator cover every allowed and refused case, list queries and Storage, before any deploy.

**Author's design (2026-10-14, canvas row "Sharing · R3 · Share with family (author)"):**

- **Entry:** on the author's own private recipe the share button opens a menu: "שיתוף עם בני משפחה" and "שליחת המתכון כטקסט". Anyone else viewing a private recipe (a manager) still goes straight to text.
- **Picker** (the app's modal): title, a line that only the people picked will see it and always the latest version.
  - **"עם גישה"** collapsed by default: one row with up to 3 avatars and the count; expands to the people with the share date and "הסרה" (immediate, no confirmation).
  - **"בני משפחה"** with a count: full names (the account's name) with avatar initials and checkboxes. A name search sits above this list only when it's long (about 8+); it never filters "עם גישה".
  - Only the lists scroll; title and buttons stay. Buttons at the left edge: "ביטול" on the right, "שיתוף עם N" to its left.
- **After sharing:** the modal stays open with a one-line note and a small "שליחת קישור" button (R1's share). The note names one or two people, then "‹name› ועוד N"; it never wraps (ellipsis). The new people move into "עם גישה".

**Recipient's design (2026-10-14, canvas row "Sharing · R3 · Shared with me (recipient)"):**

- **Library:** chips "הכל · המתכונים שלי · שמרתי · שותפו איתי · לנסות" — "שותפו איתי" right after "שמרתי", shown only when something is shared; its lede: "מתכונים פרטיים שבני המשפחה שיתפו איתכם. תמיד תראו את הגרסה העדכנית שלהם." Shared recipes are also in "הכל".
- **Card badge:** "מ־‹first name›" with a people icon, styled like the status badges (dark green text), in the same photo corner (no-photo cards: the same corner of the placeholder), so card height never changes. It replaces the author's own status ("פרטי", "לנסות") for the recipient. **Long names truncate** (ellipsis), never wrap.
- **Recipe page:** a soft green pill under the title: "שותף איתך ע״י ‹full name›" (passive, no gendered verb); truncates too. No owner status badge. Share goes straight to text (the link opens only for people with access).

**Steps:** R3a (this), R3b notifications, R3c claim link (if wanted).

**R3a result (2026-10-14):** built and tested end to end on the test project (rules, index and `listFamilyMembers` deployed there): sharing, the picker, the recipient's library chip, card badge, recipe-page line and photos, removing access, and recipe delete removing its shares. Fixed during testing: the Storage rule's Firestore lookups (see `docs/lessons/security.md`), steady mobile loading (overlays wait for sharing data; the picker opens filled), and the share button appearing with ⋮.

**Production rollout (R3a):** before `main` reaches the sharing UI, deploy `firestore:rules,storage,firestore:indexes,functions:listFamilyMembers` with `--project production`. The `shares.recipientUid` collection-group index builds for a few minutes; until it's ready, "שותפו איתי" fails quietly (the library loads without shared recipes). Check it with `gcloud firestore indexes fields describe recipientUid --collection-group=shares --project=‹production project›` before release. Then smoke-test one share as approved family, including the photo.

### R4: PDF / print

- A print layout for the recipe, which also covers "save as PDF" from the browser.
- A real PDF file to share is harder: PDF libraries handle Hebrew RTL badly. A recipe card as an image is easier (the browser draws the Hebrew).
- **Impact:** printing for the kitchen or for family members who prefer paper. Less central on phones, where text and links already work.

### Share target (#382)

Sharing a link from Instagram or a website into the app's import. Independent of the releases above; ships when it fits.

## Order

R1 → R2 → R3 → R4. R1 and R2 give the most for the least work and set up what R3 reuses. Most sharing in this family happens on phones over WhatsApp, so PDF comes last; nothing depends on R4, so it can move earlier if printing becomes the priority.

## Status

| Release | State                                                                              |
| ------- | ---------------------------------------------------------------------------------- |
| R1      | ✅ merged to `development` (#412)                                                  |
| R2      | ✅ R2a merged to `development` (#414)                                              |
| R3      | ✅ R3a merged to `development`; rules, index and function on the test project only |
| R4      | Moved to #417                                                                      |

## Rollout

To be recorded as each step runs (staging, production Firebase, production Netlify).
