import type { ImageSource } from 'expo-image';

const CATEGORY_IMAGES: Record<string, ImageSource> = {
  appetizers: require('../../assets/categories/appetizers.webp'),
  'main-courses': require('../../assets/categories/main-course.webp'),
  'side-dishes': require('../../assets/categories/side-dishes.webp'),
  'soups-stews': require('../../assets/categories/soups-stews.webp'),
  salads: require('../../assets/categories/salad.webp'),
  desserts: require('../../assets/categories/dessert.webp'),
  'breakfast-brunch': require('../../assets/categories/breakfast.webp'),
  'breads-pastries': require('../../assets/categories/breads-pastries.webp'),
  snacks: require('../../assets/categories/snacks.webp'),
  beverages: require('../../assets/categories/beverages.webp'),
};

export function getCategoryImage(categoryId?: string | null): ImageSource | null {
  if (!categoryId) return null;
  return CATEGORY_IMAGES[categoryId] ?? null;
}
