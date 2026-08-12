import { buildCardFromRecipe } from 'src/js/utils/recipes/recipe-card-utils.js';

describe('recipe-card-utils: buildCardFromRecipe', () => {
  test('builds name, category, and prepTime from the recipe', () => {
    const card = buildCardFromRecipe({
      name: 'מרק עוף',
      category: 'soups-stews',
      prepTime: 30,
      images: [],
    });
    expect(card).toEqual({ name: 'מרק עוף', category: 'soups-stews', prepTime: 30 });
  });

  test('includes primaryImage when the recipe has a primary image', () => {
    const card = buildCardFromRecipe({
      name: 'עוגת גזר',
      category: 'desserts',
      prepTime: 45,
      images: [
        { id: 'a', full: 'img/a.jpg', isPrimary: false },
        { id: 'b', full: 'img/b.jpg', isPrimary: true },
      ],
    });
    expect(card.primaryImage).toBe('img/b.jpg');
  });

  test('omits primaryImage when the recipe has no images', () => {
    const card = buildCardFromRecipe({ name: 'סלט', category: 'salads', prepTime: 10, images: [] });
    expect(card).not.toHaveProperty('primaryImage');
  });

  test('defaults missing name/category/prepTime to null', () => {
    const card = buildCardFromRecipe({});
    expect(card).toEqual({ name: null, category: null, prepTime: null });
  });
});
