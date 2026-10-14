import { jest } from '@jest/globals';

jest.unstable_mockModule('src/js/services/recipes/recipe-share-service.js', () => ({
  RecipeShareService: {},
}));
jest.unstable_mockModule('src/lib/notifications/toast-notification/toast-notification.js', () => ({
  showToast: jest.fn(),
}));

let sharedWithText;
beforeAll(async () => {
  ({ sharedWithText } = await import('src/lib/recipes/share-family-modal/share-family-modal.js'));
});

describe('sharedWithText', () => {
  it('names one or two people, then counts the rest', () => {
    expect(sharedWithText(['דנה כהן'])).toBe('שותף עם דנה כהן');
    expect(sharedWithText(['דנה כהן', 'אבי לוי'])).toBe('שותף עם דנה כהן ואבי לוי');
    expect(sharedWithText(['דנה כהן', 'אבי לוי', 'נועה', 'עומר', 'רון'])).toBe(
      'שותף עם דנה כהן ועוד 4',
    );
  });

  it('uses a placeholder for someone without a name', () => {
    expect(sharedWithText([null])).toBe('שותף עם ללא שם');
  });
});
