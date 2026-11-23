import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTokenParity } from '../../../packages/cookbook-tokens/sync-tokens.mjs';
import { tokens as moduleTokens } from '../../../packages/cookbook-tokens/tokens-data.js';
import mobileTheme, { colors, zIndex, radii } from '@cookbook/tokens';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('@cookbook/tokens parity with src/styles/tokens.css', () => {
  it('matches every :root custom property in src/styles/tokens.css 1-to-1', () => {
    const result = checkTokenParity();
    expect(result.mismatches).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('keeps tokens-data.js structurally identical to tokens.json', () => {
    const jsonTokens = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'packages/cookbook-tokens/tokens.json'), 'utf8'),
    );
    expect(moduleTokens).toEqual(jsonTokens);
  });

  it('exports typed mobile theme scalars for React Native', () => {
    expect(mobileTheme.colors.primary).toBe('#6a994e');
    expect(colors.surface0).toBe('#faf6ec');
    expect(radii.pill).toBe(9999);
    expect(zIndex.spinner).toBe(10010);
  });
});
