# Feature Plan: Recipe sharing

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
  - **R2b:** our own `sharp` function replacing the Resize Images extension (#390, deadline 2027-03-31): the same WebP sizes plus a wide JPEG for previews, if R2a's test shows WebP isn't reliable.

### R3: Share with family in the app (#383)

- The author of a private recipe shares it with chosen family members; it appears for them under "שותפו איתי" in their library.
- Needs a family list (`users` isn't readable by others), a share record, rule changes for Firestore and Storage, the shared-with-me view, and revoking. Security-sensitive: rules tests first; the rules plan is approved before it's applied.
- Notifications can be an R3b follow-up: the share flow can end with "send them the link" (R1), so the recipient still hears about it.
- **Impact:** private recipes become shareable without publishing them.

### R4: PDF / print

- A print layout for the recipe, which also covers "save as PDF" from the browser.
- A real PDF file to share is harder: PDF libraries handle Hebrew RTL badly. A recipe card as an image is easier (the browser draws the Hebrew).
- **Impact:** printing for the kitchen or for family members who prefer paper. Less central on phones, where text and links already work.

### Share target (#382)

Sharing a link from Instagram or a website into the app's import. Independent of the releases above; ships when it fits.

## Order

R1 → R2 → R3 → R4. R1 and R2 give the most for the least work and set up what R3 reuses. Most sharing in this family happens on phones over WhatsApp, so PDF comes last; nothing depends on R4, so it can move earlier if printing becomes the priority.

## Status

| Release | State                                  |
| ------- | -------------------------------------- |
| R1      | ✅ merged to `development` (#412)      |
| R2      | 🔨 building R2a (`feat/link-previews`) |
| R3      | ⏳ planned                             |
| R4      | ⏳ planned                             |
