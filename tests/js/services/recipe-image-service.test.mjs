import { jest } from '@jest/globals';

import '../../common/mocks/firebase-firestore.mock.js';
import '../../common/mocks/firebase-storage.mock.js';
import '../../common/mocks/firebase-service.mock.js';

let RecipeImageService;

const imageUtilMocks = {
  setPrimaryImage: jest.fn(() => Promise.resolve()),
};

jest.unstable_mockModule('src/js/utils/recipes/recipe-image-utils.js', () => imageUtilMocks);

beforeEach(async () => {
  jest.resetModules();
  imageUtilMocks.setPrimaryImage.mockReset();
  imageUtilMocks.setPrimaryImage.mockImplementation(() => Promise.resolve());

  ({ RecipeImageService } = await import('src/js/services/recipes/recipe-image-service.js'));
});

describe('RecipeImageService', () => {
  describe('setPrimaryImage', () => {
    it('delegates to the recipe-image-utils helper', async () => {
      await RecipeImageService.setPrimaryImage('recipe-x', 'img-1');
      expect(imageUtilMocks.setPrimaryImage).toHaveBeenCalledWith('recipe-x', 'img-1');
    });
  });
});
