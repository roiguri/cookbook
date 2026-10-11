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

  it('the submission comes first for a private recipe', () => {
    const r = { visibility: 'private', stage: 'to-try' };
    expect(getRecipeStatus({ ...r, submissionStatus: 'pending' })).toBe(RECIPE_STATUS.PENDING);
    expect(getRecipeStatus({ ...r, submissionStatus: 'rejected' })).toBe(RECIPE_STATUS.REJECTED);
  });

  it('"published" shows only in the author’s own view', () => {
    const r = { visibility: 'published', stage: 'tested', submissionStatus: 'approved' };
    expect(getRecipeStatus(r)).toBeNull();
    expect(getRecipeStatus({ ...r, ownView: true })).toBe(RECIPE_STATUS.PUBLISHED);
  });

  it('no recipe, no status', () => {
    expect(getRecipeStatus(null)).toBeNull();
  });
});
