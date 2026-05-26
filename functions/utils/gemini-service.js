// Barrel re-export. Implementation lives under ./gemini/ split by purpose:
// - extractors/ — recipe extraction from various sources (image, url, …)
// - enhancement/ — image generation/restyling (separate concern: different
//   model, different schema, different output shape)
const { extractRecipeFromImage } = require('./gemini/extractors/image');
const { extractRecipeFromUrl } = require('./gemini/extractors/url');
const { extractRecipeFromVideo } = require('./gemini/extractors/youtube');
const { enhanceFoodImage, PARAMETER_TAXONOMY } = require('./gemini/enhancement/food-image');

module.exports = {
  extractRecipeFromImage,
  extractRecipeFromUrl,
  extractRecipeFromVideo,
  enhanceFoodImage,
  PARAMETER_TAXONOMY,
};
