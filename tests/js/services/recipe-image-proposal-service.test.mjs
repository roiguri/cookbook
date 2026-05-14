import { jest } from '@jest/globals';

import '../../common/mocks/firebase-firestore.mock.js';
import '../../common/mocks/firebase-storage.mock.js';
import '../../common/mocks/firebase-service.mock.js';

let RecipeImageProposalService;

const imageUtilMocks = {
  addPendingImages: jest.fn(),
  approvePendingImageById: jest.fn(),
  rejectPendingImageById: jest.fn(),
  getPendingImages: jest.fn(),
};

jest.unstable_mockModule('src/js/utils/recipes/recipe-image-utils.js', () => imageUtilMocks);

beforeEach(async () => {
  jest.resetModules();
  Object.values(imageUtilMocks).forEach((m) => m.mockReset());
  ({ RecipeImageProposalService } = await import(
    'src/js/services/recipe-image-proposal-service.js'
  ));
});

describe('RecipeImageProposalService', () => {
  it('propose delegates to addPendingImages', async () => {
    imageUtilMocks.addPendingImages.mockResolvedValue([{ id: 'p1' }]);
    const files = [new File([new Blob(['a'])], 'a.jpg', { type: 'image/jpeg' })];
    const result = await RecipeImageProposalService.propose('r1', files, 'cat', 'user-1');
    expect(imageUtilMocks.addPendingImages).toHaveBeenCalledWith('r1', files, 'cat', 'user-1');
    expect(result).toEqual([{ id: 'p1' }]);
  });

  it('approve delegates to approvePendingImageById', async () => {
    imageUtilMocks.approvePendingImageById.mockResolvedValue('new-id');
    const result = await RecipeImageProposalService.approve('r1', 'pid');
    expect(imageUtilMocks.approvePendingImageById).toHaveBeenCalledWith('r1', 'pid');
    expect(result).toBe('new-id');
  });

  it('reject delegates to rejectPendingImageById', async () => {
    imageUtilMocks.rejectPendingImageById.mockResolvedValue();
    await RecipeImageProposalService.reject('r1', 'pid');
    expect(imageUtilMocks.rejectPendingImageById).toHaveBeenCalledWith('r1', 'pid');
  });

  it('listPending delegates to getPendingImages', async () => {
    imageUtilMocks.getPendingImages.mockResolvedValue([{ id: 'p1' }]);
    const result = await RecipeImageProposalService.listPending('r1');
    expect(imageUtilMocks.getPendingImages).toHaveBeenCalledWith('r1');
    expect(result).toEqual([{ id: 'p1' }]);
  });
});
