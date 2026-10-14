# Avatars

Signed-in users pick their avatar in the profile modal's **אווטאר** tab:

1. **Build one** in `<avatar-builder>`, choosing each part separately (face shape, hairstyle, eyes,
   brows, mouth, facial hair, glasses, cheeks, hat, outfit) plus skin, hair, fabric and background
   colours.
2. **Pick a stock avatar** (static files under the `Avatars/` Storage prefix).
3. **Use initials** (no image).

Wherever an avatar is shown (header, profile head, family picker), it is a plain image URL from
`users/{uid}.avatarUrl`. A built avatar is uploaded as a PNG, so none of those places know about
the builder.

## Pieces

| Piece                                               | Role                                                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/js/utils/avatar/chef-avatar.js`                | Part catalogue (ids, Hebrew labels, English descriptions), config helpers, pure SVG renderer    |
| `src/js/utils/avatar/avatar-png.js`                 | Rasterises a config to a 256×256 PNG (canvas)                                                   |
| `src/lib/auth/avatar-builder/avatar-builder.js`     | The builder UI; fires `avatar-builder-save` and never saves by itself                           |
| `src/lib/auth/components/user-profile.js`           | Hosts the builder; on save: PNG → `UserService.uploadAvatarImage` → `authService.updateProfile` |
| `UserService.uploadAvatarImage / deleteAvatarImage` | `user-avatars/{uid}.png` in Storage                                                             |

## Data

```js
users/{uid}.avatarConfig = {
  v: 1,
  parts:  { face, hair, eyes, brows, mouth, facialHair, glasses, extras, hat, outfit },
  colors: { skin, hair, outfit, background },
}
users/{uid}.avatarUrl = '<download URL of user-avatars/{uid}.png>&v=<save time>'
```

- Values are catalogue **ids**, never colours or markup. `normalizeAvatarConfig()` turns anything
  (old versions, unknown ids, missing keys) into a valid config, so the catalogue can grow without
  migrating stored configs.
- `avatarConfig` stays when the user switches to a stock avatar or initials, so the builder can
  re-apply it later. The builder knows it is "in use" when `avatarUrl` points at `user-avatars/`.
- The file name never changes; the `v` query parameter makes browsers fetch a new save.
- Deleting the account deletes the PNG (best effort, `AuthService.deleteAccount`).

## Security rules

- **Storage** `user-avatars/{fileName}`: only the owner writes it, and only `{uid}.png` as
  `image/png`, under 200 KB, tagged `uploadedBy` = owner. Reads (`get`) are for the owner and
  managers; everyone else sees it through the download URL. Nobody can `list` the folder, because
  file names are user ids.
- **Firestore** `users/{uid}`: on create and owner update, `avatarConfig` must be a map with only
  `v` (int), `parts` (map, ≤16 keys) and `colors` (map, ≤8 keys). Ids are checked by the app, not
  the rules, so new parts don't need a rules deploy.

Tests: `tests/rules/*` (`npm run test:rules`), `tests/js/utils/avatar/`, `tests/lib/auth/`.

## Drawing style

The parts follow the stock chef avatars: a 64×64 grid, `#343433` outlines at 1.5, flat fills with
one shade tone, and a bust that ends in a shallow arc. Layers, bottom to top: background, outfit,
back hair, neck (+ neckerchief), ears, face, cheeks, nose, mouth, eyes, facial hair, brows, front
hair, glasses, hat.

The renderer's output must stay **well-formed XML**: the PNG is decoded as a standalone
`image/svg+xml`, which fails on mistakes that inline SVG forgives (such as a duplicate attribute).
The unit tests parse every option as XML.

### Adding an option

1. Add `{ id, label, describe }` to the part in `AVATAR_PARTS` (or a colour to `AVATAR_COLORS`).
2. Draw it in the part's function in `chef-avatar.js` (`hairLayers`, `eyes`, `hat`, …).
3. Render a contact sheet and compare it with the other options at 36px (header) and 112px
   (preview).

Never rename or remove an id that may be stored. Keep it and map it in `normalizeAvatarConfig`.

## Future: match a photo

The catalogue was built for this. `describeAvatarSchema()` returns every part and colour as ids
with English descriptions. A future callable function (next to the Gemini extraction in
`functions/`) can send a selfie plus that schema to a vision model and ask for one id per part,
using structured output. It then runs `normalizeAvatarConfig` on the answer and returns a config.
The builder opens with that config (`builder.config = suggested`) and the user adjusts it before
saving. Nothing about the photo needs to be stored.

## Local testing

`npm run dev:emulators` runs the app against local Auth/Firestore/Storage emulators with this
checkout's rules (`.env.emulators`, a `demo-` project, so nothing reaches real Firebase). Sign up
in the app to get a user. The stock grid is empty unless `Avatars/*.svg` is uploaded to the
emulator with `contentType: image/svg+xml`.
