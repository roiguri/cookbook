import { ingredientLine, recipeShareText } from 'src/js/utils/recipes/recipe-text.js';

const challah = {
  name: 'חלה של שישי',
  servings: 4,
  prepTime: 30,
  waitTime: 120,
  difficulty: 'בינונית',
  description: 'קלועה בארבע רצועות.',
  comments: ['אפשר להקפיא את הבצק.', ' '],
  attribution: 'סבתא רותי',
  ingredientSections: [
    {
      title: '',
      items: [
        { amount: 1, unit: 'ק"ג', item: 'קמח' },
        { amount: 2, unit: 'כפות', item: 'שמרים יבשים' },
      ],
    },
    { title: 'להברשה', items: [{ amount: 1, unit: '', item: 'ביצה' }] },
  ],
  stages: [
    { title: 'בצק', instructions: ['מערבבים קמח ושמרים.', 'לשים עשר דקות.'] },
    { title: 'אפייה', instructions: ['אופים 30 דקות.'] },
  ],
};

describe('ingredientLine', () => {
  it('joins amount, unit and name', () => {
    expect(ingredientLine({ amount: 2, unit: 'כוסות', item: 'קמח' })).toBe('2 כוסות קמח');
  });

  it('skips a missing amount or unit', () => {
    expect(ingredientLine({ amount: null, unit: '', item: 'מלח לפי הטעם' })).toBe('מלח לפי הטעם');
    expect(ingredientLine({ amount: 3, unit: '  ', item: 'ביצים' })).toBe('3 ביצים');
  });

  it('shows fractions as the recipe page does', () => {
    expect(ingredientLine({ amount: 0.5, unit: 'כוס', item: 'סוכר' })).toBe('1/2 כוס סוכר');
  });
});

describe('recipeShareText', () => {
  it('writes the whole recipe with WhatsApp headings and the link last', () => {
    expect(recipeShareText(challah, { url: 'https://example.test/recipe/abc' })).toBe(
      [
        '*חלה של שישי*',
        'קלועה בארבע רצועות.',
        '4 מנות · זמן הכנה: 30 דקות · זמן המתנה: שעתיים · רמת קושי: בינונית',
        '',
        '*מצרכים*',
        '• 1 ק"ג קמח',
        '• 2 כפות שמרים יבשים',
        '',
        '_להברשה_',
        '• 1 ביצה',
        '',
        '*הוראות הכנה*',
        '_בצק_',
        '1. מערבבים קמח ושמרים.',
        '2. לשים עשר דקות.',
        '',
        '_אפייה_',
        '1. אופים 30 דקות.',
        '',
        '*הערות*',
        '• אפשר להקפיא את הבצק.',
        '',
        'מקור: סבתא רותי',
        'https://example.test/recipe/abc',
      ].join('\n'),
    );
  });

  it('scales the amounts to the servings shown on the page', () => {
    const text = recipeShareText(challah, { servings: 8 });
    expect(text).toContain('8 מנות');
    expect(text).toContain('• 2 ק"ג קמח');
    expect(text).toContain('• 4 כפות שמרים יבשים');
  });

  it('handles a flat recipe without description, times, notes, source or link', () => {
    const text = recipeShareText({
      name: 'סלט',
      ingredients: [{ amount: 2, unit: '', item: 'עגבניות' }],
      instructions: ['חותכים.', 'מערבבים.'],
    });
    expect(text).toBe(
      [
        '*סלט*',
        '',
        '*מצרכים*',
        '• 2 עגבניות',
        '',
        '*הוראות הכנה*',
        '1. חותכים.',
        '2. מערבבים.',
      ].join('\n'),
    );
  });
});
