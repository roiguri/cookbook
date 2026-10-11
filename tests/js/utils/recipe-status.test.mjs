import { getRecipeStatus, RECIPE_STATUS } from 'src/js/utils/recipes/recipe-status.js';

describe('getRecipeStatus', () => {
  it('published recipes carry no badge', () => {
    expect(getRecipeStatus({ visibility: 'published', stage: 'tested' })).toBeNull();
    expect(getRecipeStatus({ approved: true })).toBeNull();
  });

  it('a private recipe is to-try or private by stage', () => {
    expect(getRecipeStatus({ visibility: 'private', stage: 'to-try' })).toBe(RECIPE_STATUS.TO_TRY);
    expect(getRecipeStatus({ visibility: 'private', stage: 'tested' })).toBe(RECIPE_STATUS.PRIVATE);
    expect(getRecipeStatus({ visibility: 'private' })).toBe(RECIPE_STATUS.PRIVATE);
  });

  it('falls back to the legacy approved flag', () => {
    expect(getRecipeStatus({ approved: false })).toBe(RECIPE_STATUS.PRIVATE);
  });

  it('no recipe, no status', () => {
    expect(getRecipeStatus(null)).toBeNull();
  });
});
