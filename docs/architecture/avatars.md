# Avatars

Signed-in users build their avatar in the profile modal's **אווטאר** tab, in `<avatar-builder>`,
choosing each part separately: hairstyle, eyes, brows, mouth, facial hair, glasses, headwear and
kitchen outfit, plus skin, hair, fabric and background colours. Until they save one, the header
shows their initial (or their Google photo); there is no option to go back to initials.

Wherever an avatar is shown (header, profile head, family picker), it is a plain image URL from
`users/{uid}.avatarUrl`. A built avatar is uploaded as a PNG, so none of those places know about
the builder.

## Artwork

- **Faces and hair:** [Avataaars](https://avataaars.com/) by Pablo Stanley ("free for personal and
  commercial use"), drawn through [DiceBear](https://www.dicebear.com/) (`@dicebear/core` +
  `@dicebear/avataaars`, MIT code). **Both are pinned to an exact version.** The kitchen layer edits
  DiceBear's output, so upgrade only together with `npm run check:avatars` and the unit tests.
- **Kitchen layer (ours):** chef hats (puffy toque, tall pleated toque, short chef cap, paper
  cook's cap, bandana, skull cap, baseball cap worn forwards or backwards, headband) and
  outfits (chef jacket, bib apron, T-shirt with apron, striped butcher apron), drawn in the
  same flat style. A headband (`band: true`) sits on the hair: nothing is hidden under it and
  it never grows.
- The catalogue keeps only natural skin tones and kitchen-friendly expressions (no yellow
  skin, no dizzy or vomit faces).

## Pieces

| Piece                                               | Role                                                                                          |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/js/utils/avatar/chef-avatar.js`                | Catalogue (ids, Hebrew labels, English descriptions), config helpers, renderer, kitchen layer |
| `src/js/utils/avatar/avatar-png.js`                 | Rasterises a config to a 256×256 PNG (canvas), loaded only when saving                        |
| `src/lib/auth/avatar-builder/avatar-builder.js`     | The builder UI; fires `avatar-builder-save` and never saves by itself                         |
| `src/lib/auth/components/user-profile.js`           | Hosts the builder, with a shimmer skeleton while it loads; on save: PNG → upload → profile    |
| `UserService.uploadAvatarImage / deleteAvatarImage` | `user-avatars/{uid}.png` in Storage                                                           |
| `scripts/avatars/check-avatars.mjs`                 | `npm run check:avatars`: browser pixel checks plus a hat-fit review sheet                     |

The artwork library is a separate ~53 KB (gzipped) chunk. It loads when the avatar tab opens,
behind a skeleton in the app's grey shimmer. It is never in the app
shell or the profile chunk.

## Leaving with unsaved changes

The profile modal asks before closing when the builder has unsaved changes
(`builder.hasUnsavedChanges`): on the back button, ✕, Escape, backdrop and "הארוחה שלי". "סגור בלי
לשמור" drops the changes (`discardChanges()`); "המשך לערוך" or dismissing the question stays.
This is `custom-modal`'s close guard, set in `auth-controller.js`, which asks
`user-profile.confirmClose()`.

The back button closes the auth modal: opening it adds a same-URL history entry that back pops,
and the router ignores pops that keep the route, so the page behind stays. Other modals don't
handle back yet (#431).

## Data

```js
users/{uid}.avatarConfig = {
  v: 1,
  parts:  { hair, eyes, brows, mouth, facialHair, glasses, hat, outfit },
  colors: { skin, hair, outfit, background },
}
users/{uid}.avatarUrl = '<download URL of user-avatars/{uid}.png>&v=<save time>'
```

- Values are catalogue **ids**, never colours or markup. Part ids are Avataaars' own where the
  part comes from it. `normalizeAvatarConfig()` turns anything (old versions, unknown ids,
  missing keys) into a valid config, so the catalogue can change without migrating stored
  configs.
- The builder knows its config is "in use" when `avatarUrl` points at `user-avatars/`. Users still
  on a stock avatar (until converted) see their look-alike or default chef with Save enabled.
- The file name never changes; the `v` query parameter makes browsers fetch a new save.
- Deleting the account deletes the PNG (best effort, `AuthService.deleteAccount`).

## How the kitchen layer combines with Avataaars

`renderAvatarSvg()` asks DiceBear for the chosen Avataaars parts with a plain crew-neck shirt,
then:

1. **Outfit:** replaces the shirt group with ours, clipped to the same body outline.
2. **Hat:** draws the hat last in the figure, over hair and glasses. The hair is handled per
   hairstyle (`HAT_FIT`), which was checked on every hairstyle × hat:
   - **Short styles:** hair shows only below the hat's lower edge. The hat covers the cut, so
     nothing pokes through or beside it (short spiky tops, frida's flowers via `trim`).
   - **Long and big styles** (`crown` = the hairstyle's measured top edge): the hair isn't cut.
     Each hat scales around the head's centre just enough for its crown to cover the hair's,
     so the hair meets the hat's real outline with no seam, and an afro gets a proportionally
     bigger hat. (Cutting the hair beside a hat leaves a straight edge and a background-coloured
     gap next to the hat's rounded side; that's why big hair isn't cut.)
3. **Scale:** shrinks the figure slightly so tall hats and the outfit both fit the frame.

Re-measure a hairstyle's `crown` after an Avataaars upgrade: diff a render with and without the
hair and take the topmost changed pixel. `check-avatars` writes the review sheet for that check.

### Props never paint outside their outline

A transparent background is a user option, so hats and outfits must be clean on any surface:

- Each hat is `shape` (its outline) plus `details` (shading, pleats, dots) clipped to that
  outline, plus `extra` separate pieces (bandana tails). Outfit details are clipped to the
  body outline.
- White props (toque, chef cap, skull cap, the white clothes) get an **opaque** light rim,
  so they stay visible on white pages. It is opaque on purpose: a translucent edge would paint
  over nothing.
- `npm run check:avatars` rasterises every prop alone (all fabric colours) and every
  hairstyle × headwear × outfit (950 renders). It fails on translucent pixels away from any
  solid shape, or anything in the frame corners. Combinations are compared with the same
  hairstyle bare-headed, so only what our layer adds can fail. (Avataaars' own `frida` earring
  tip has one such pixel.)

## Security rules

- **Storage** `user-avatars/{fileName}`: only the owner writes it, and only `{uid}.png` as
  `image/png`, under 200 KB, tagged `uploadedBy` = owner. Reads (`get`) are for the owner and
  managers; everyone else sees it through the download URL. Nobody can `list` the folder, because
  file names are user ids.
- **Firestore** `users/{uid}`: on create and owner update, `avatarConfig` must be a map with only
  `v` (int), `parts` (map, ≤16 keys) and `colors` (map, ≤8 keys). Ids are checked by the app, not
  the rules, so catalogue changes don't need a rules deploy.

Tests: `tests/rules/*` (`npm run test:rules`), `tests/js/utils/avatar/`, `tests/lib/auth/`.

## Retiring the stock avatars

The six stock chefs (`Avatars/*.svg`) are being replaced by built avatars. A stock avatar is
stored as a download URL containing `Avatars%2F<file>.svg`, so each user's choice is known.

1. **Stop offering them:** done. The avatar tab no longer shows the stock grid. Users who picked
   one keep it until they're converted or build their own.
2. **Convert existing users** with `scripts/migrations/005-stock-avatars-to-built.mjs`. Each
   stock file maps to an approved look-alike built chef (`LOOKALIKES` in the script). For every
   user on a stock avatar, the script renders that config with `renderAvatarSvg`, converts it to
   a 256px PNG with `@resvg/resvg-js`, uploads `user-avatars/{uid}.png` (tagged with the user as
   uploader) and sets `avatarUrl` + `avatarConfig`, the same as a save from the builder. The dry
   run prints how many users have each stock avatar. It's safe while users are active (each user is
   re-read before converting; the PNG is created only if the user has no avatar file; the profile
   update is a transaction that applies only if they're still on the same stock avatar), safe to
   re-run, and other avatars are
   never touched. Rehearse with `--project emulator`, then run on `staging`, then `production`.
3. **Keep the files.** The six files, their `match /Avatars` Storage rule and
   `UserService.listAvatarOptions` stay; nothing is deleted from Storage (decided 2026-10-15).

## Future: match a photo

`describeAvatarSchema()` returns every part and colour as ids with English descriptions. A future
callable function (next to the Gemini extraction in `functions/`) can send a selfie plus that schema
to a vision model and ask for one id per part, using structured output. It then runs
`normalizeAvatarConfig` on the answer and returns a config. The builder opens with that config
(`builder.config = suggested`) and the user adjusts it before saving. Nothing about the photo needs
to be stored.

## Local testing

`npm run dev:emulators` runs the app against local Auth/Firestore/Storage emulators with this
checkout's rules (`.env.emulators`, a `demo-` project, so nothing reaches real Firebase). It also
listens on the network, so a phone on the same Wi-Fi or tailnet can open it. Sign up in the app to
get a user.
