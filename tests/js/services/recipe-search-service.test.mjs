import { jest } from '@jest/globals';

const recipeServiceMocks = { listPublished: jest.fn() };
const submissionMocks = { listMineWithStatus: jest.fn() };

jest.unstable_mockModule('src/js/services/recipes/recipe-service.js', () => ({
  RecipeService: recipeServiceMocks,
  VISIBILITY: { PRIVATE: 'private', PUBLISHED: 'published' },
}));
jest.unstable_mockModule('src/js/services/recipes/recipe-submission-service.js', () => ({
  RecipeSubmissionService: submissionMocks,
}));

let RecipeSearchService;

beforeAll(async () => {
  ({ RecipeSearchService } = await import('src/js/services/recipes/recipe-search-service.js'));
});

beforeEach(() => {
  jest.clearAllMocks();
  recipeServiceMocks.listPublished.mockResolvedValue([{ id: 'p1', visibility: 'published' }]);
  submissionMocks.listMineWithStatus.mockResolvedValue([
    { id: 'm1', visibility: 'private', category: 'desserts' },
    { id: 'm2', visibility: 'private', category: 'salads' },
    { id: 'p1', visibility: 'published', category: 'desserts' }, // also in the book
  ]);
});

describe('RecipeSearchService.listSearchable', () => {
  it('is the family book only without an owner', async () => {
    const result = await RecipeSearchService.listSearchable();
    expect(result.map((r) => r.id)).toEqual(['p1']);
    expect(submissionMocks.listMineWithStatus).not.toHaveBeenCalled();
  });

  it('adds the owner’s private recipes once (published ones are already in the book)', async () => {
    const result = await RecipeSearchService.listSearchable({ ownerId: 'u1' });
    expect(result.map((r) => r.id)).toEqual(['m1', 'm2', 'p1']);
    expect(submissionMocks.listMineWithStatus).toHaveBeenCalledWith('u1');
  });

  it('applies the category to both sources', async () => {
    const result = await RecipeSearchService.listSearchable({
      category: 'desserts',
      ownerId: 'u1',
    });
    expect(recipeServiceMocks.listPublished).toHaveBeenCalledWith({
      where: [['category', '==', 'desserts']],
    });
    expect(result.map((r) => r.id)).toEqual(['m1', 'p1']);
  });

  it('still returns the family book if the owner’s recipes fail to load', async () => {
    submissionMocks.listMineWithStatus.mockRejectedValue(new Error('offline'));
    const result = await RecipeSearchService.listSearchable({ ownerId: 'u1' });
    expect(result.map((r) => r.id)).toEqual(['p1']);
  });
});
