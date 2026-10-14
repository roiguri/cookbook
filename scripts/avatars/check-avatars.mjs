/**
 * Avatar checks that need a real browser (run after changing chef-avatar.js or upgrading
 * DiceBear): `npm run check:avatars`.
 *
 * 1. Transparency: every hat and outfit alone (all fabric colours) and every
 *    hairstyle × headwear × outfit combination is rasterised on a transparent canvas.
 *    Fails if a prop paints translucent pixels away from any solid shape (a shade or
 *    background leaking outside its outline) or if a combination paints the frame corners.
 *    Combinations are compared with the same hairstyle without a hat, so only what our
 *    kitchen layer adds can fail.
 * 2. Review sheets: writes `hats.html` (every hairstyle under every hat) into the output
 *    folder for a visual check of hat fit.
 *
 * Usage: node scripts/avatars/check-avatars.mjs [output-dir]   (default: ./avatar-check)
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import {
  AVATAR_COLORS,
  AVATAR_PARTS,
  DEFAULT_AVATAR_CONFIG,
  renderAvatarSvg,
  renderKitchenPropSvg,
} from '../../src/js/utils/avatar/chef-avatar.js';

const outDir = path.resolve(process.argv[2] || 'avatar-check');
fs.mkdirSync(outDir, { recursive: true });

const config = (parts, colors = {}) => ({
  ...DEFAULT_AVATAR_CONFIG,
  parts: { ...DEFAULT_AVATAR_CONFIG.parts, glasses: 'round', facialHair: 'beardMedium', ...parts },
  colors: { ...DEFAULT_AVATAR_CONFIG.colors, background: 'none', outfit: 'mustard', ...colors },
});

const kitchenHats = AVATAR_PARTS.hat.options.filter(
  (o) => !['none', 'hijab', 'turban'].includes(o.id),
);
const items = [];
for (const hat of kitchenHats)
  for (const c of AVATAR_COLORS.outfit.options)
    items.push({ label: `hat ${hat.id}/${c.id}`, svg: renderKitchenPropSvg('hat', hat.id, c.id) });
for (const o of AVATAR_PARTS.outfit.options)
  for (const c of AVATAR_COLORS.outfit.options)
    items.push({
      label: `outfit ${o.id}/${c.id}`,
      svg: renderKitchenPropSvg('outfit', o.id, c.id),
    });
for (const hair of AVATAR_PARTS.hair.options)
  for (const hat of AVATAR_PARTS.hat.options)
    for (const outfit of AVATAR_PARTS.outfit.options)
      items.push({
        label: `${hair.id}/${hat.id}/${outfit.id}`,
        baseline: `${hair.id}/none/${outfit.id}`,
        avatar: true,
        svg: renderAvatarSvg(config({ hair: hair.id, hat: hat.id, outfit: outfit.id })),
      });

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<canvas id="c" width="560" height="560"></canvas>');
  const results = await page.evaluate(async (items) => {
    const ctx = document.getElementById('c').getContext('2d', { willReadFrequently: true });
    const N = 560;
    const out = [];
    for (const it of items) {
      const img = new Image();
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(it.svg)));
      await img.decode();
      ctx.clearRect(0, 0, N, N);
      ctx.drawImage(img, 0, 0, N, N);
      const d = ctx.getImageData(0, 0, N, N).data;
      const alpha = (x, y) => d[(y * N + x) * 4 + 3];
      let leaks = 0;
      let corners = 0;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const a = alpha(x, y);
          if (a < 8) continue; // invisible rasterisation noise
          if (it.avatar && (x < 40 || x >= N - 40) && y < 40) corners++;
          if (a >= 200) continue;
          // Edge anti-aliasing always touches a solid pixel; a leak doesn't.
          let nearSolid = false;
          for (let dy = -2; dy <= 2 && !nearSolid; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              const xx = x + dx;
              const yy = y + dy;
              if (xx >= 0 && yy >= 0 && xx < N && yy < N && alpha(xx, yy) >= 200) {
                nearSolid = true;
                break;
              }
            }
          }
          if (!nearSolid) leaks++;
        }
      }
      out.push({ label: it.label, baseline: it.baseline, leaks, corners });
    }
    return out;
  }, items);
  await browser.close();

  const byLabel = Object.fromEntries(results.map((r) => [r.label, r]));
  const failures = results.filter((r) => {
    const allowed = r.baseline ? byLabel[r.baseline].leaks : 0; // Avataaars' own artwork
    return r.leaks > allowed || r.corners > 0;
  });
  console.log(`checked ${results.length} renders (props and combinations)`);
  for (const f of failures)
    console.log(`  FAIL ${f.label}: ${f.leaks} leaked pixels, ${f.corners} in corners`);

  // Review sheet: every hairstyle under every headwear.
  const hats = AVATAR_PARTS.hat.options.map((o) => o.id);
  let html = `<style>body{font:12px sans-serif;margin:8px}td,th{padding:1px}</style><table><tr><td></td>${hats.map((h) => `<th>${h}</th>`).join('')}</tr>`;
  for (const hair of AVATAR_PARTS.hair.options) {
    html += `<tr><th>${hair.id}</th>${hats
      .map(
        (hat) =>
          `<td>${renderAvatarSvg(config({ hair: hair.id, hat, glasses: 'none', facialHair: 'none' }, { background: 'cream' }), { size: 110 })}</td>`,
      )
      .join('')}</tr>`;
  }
  fs.writeFileSync(path.join(outDir, 'hats.html'), `${html}</table>`);
  console.log(`review sheet: ${path.join(outDir, 'hats.html')}`);
  return failures.length ? 1 : 0;
}

main().then((code) => process.exit(code));
