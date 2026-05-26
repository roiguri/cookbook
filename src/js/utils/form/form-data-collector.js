/**
 * Form Data Collector Utilities
 * ------------------------------
 * Extracted data collection logic from RecipeFormComponent.
 * Handles collecting form data from various form sections and converting to recipe data structure.
 */

import authService from '../../services/auth/auth-service.js';

/**
 * Collects all form data and converts it to recipe data structure
 * @param {ShadowRoot} shadowRoot - The component's shadow root for DOM access
 * @returns {Object} - Complete recipe data object
 */
export function collectRecipeFormData(shadowRoot) {
  // Get metadata from the metadata fields component
  const metadataComponent = shadowRoot.getElementById('metadata-fields');
  const metadataData = metadataComponent ? metadataComponent.getFormData() : {};

  const recipeData = {
    ...metadataData,
  };

  // Collect ingredients/ingredientSections from component
  const ingredientsData = collectIngredientsFromComponent(shadowRoot);
  if (ingredientsData) {
    if (Array.isArray(ingredientsData) && ingredientsData.length > 0 && ingredientsData[0].title) {
      recipeData.ingredientSections = ingredientsData;
    } else if (Array.isArray(ingredientsData)) {
      // Flat ingredients array
      recipeData.ingredients = ingredientsData;
    }
  }

  // Collect instructions/stages from new component
  const instructionsData = collectInstructionsFromComponent(shadowRoot);
  if (instructionsData) {
    if (
      Array.isArray(instructionsData) &&
      instructionsData.length > 0 &&
      instructionsData[0] &&
      instructionsData[0].title
    ) {
      // Stages format - convert from section format to legacy format
      recipeData.stages = instructionsData.map((stage) => ({
        title: stage.title,
        instructions: stage.items ? stage.items.map((item) => item.text || '') : [],
      }));
    } else if (Array.isArray(instructionsData)) {
      recipeData.instructions = instructionsData.map((item) =>
        typeof item === 'string' ? item : item.text || '',
      );
    }
  }

  // Collect images
  const { images, toDelete } = collectImages(shadowRoot);
  recipeData.images = images;
  recipeData.toDelete = toDelete;

  // Collect media instructions
  const mediaInstructions = collectMediaInstructions(shadowRoot);
  if (mediaInstructions) {
    recipeData.mediaInstructions = mediaInstructions;
  }

  // Collect comments
  const comments = collectComments(shadowRoot);
  if (comments) {
    recipeData.comments = comments;
  }

  // Collect attribution (single free-text field)
  const attributionEl = shadowRoot.getElementById('attribution');
  if (attributionEl) {
    const attribution = attributionEl.value.trim();
    if (attribution) recipeData.attribution = attribution;
  }

  // Collect related recipes (array of IDs)
  const relatedField = shadowRoot.getElementById('related-field');
  if (relatedField && typeof relatedField.getData === 'function') {
    const relatedRecipes = relatedField.getData();
    recipeData.relatedRecipes = relatedRecipes;
  }

  return recipeData;
}

/**
 * Collects ingredient data from the ingredients list component
 * @param {ShadowRoot} shadowRoot - The component's shadow root
 * @returns {Array|null} - Ingredients data from component (flat array or sectioned array)
 */
function collectIngredientsFromComponent(shadowRoot) {
  const ingredientsList = shadowRoot.getElementById('ingredients-list');
  if (ingredientsList && typeof ingredientsList.getData === 'function') {
    return ingredientsList.getData();
  }

  // Component should always be available
  console.warn('Ingredients component not found or missing getData method');
  return null;
}

/**
 * Collects instructions data from the instructions list component
 * @param {ShadowRoot} shadowRoot - The component's shadow root
 * @returns {Array|null} - Instructions data from component
 */
function collectInstructionsFromComponent(shadowRoot) {
  const instructionsList = shadowRoot.getElementById('instructions-list');
  if (instructionsList && typeof instructionsList.getInstructions === 'function') {
    return instructionsList.getInstructions();
  }

  // Component should always be available
  console.warn('Instructions component not found or missing getInstructions method');
  return null;
}

/**
 * Collects image data from the image handler
 * @param {ShadowRoot} shadowRoot - The component's shadow root
 * @returns {Object} - Object with images array and toDelete array
 */
function collectImages(shadowRoot) {
  const imageHandler = shadowRoot.getElementById('recipe-images');

  if (!imageHandler) {
    return { images: [], toDelete: [] };
  }

  const images = imageHandler.getImages();
  const toDelete =
    typeof imageHandler.getRemovedImages === 'function' ? imageHandler.getRemovedImages() : [];

  const processedImages = images.map((img) => {
    if (img.file) {
      // New image to upload
      return {
        file: img.file,
        preview: img.preview,
        isPrimary: img.isPrimary ?? false, // Default to false if undefined
        access: 'public',
        uploadedBy: authService.getCurrentUser()?.uid || 'anonymous',
        source: 'new',
      };
    } else {
      // Spread all persistent fields (e.g. aiEnhanced) and drop transient
      // form-internal ones. Filter undefined values since Firestore is not
      // configured with ignoreUndefinedProperties.
      const { file: _f, preview: _p, source: _s, ...rest } = img;
      const existingImage = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v !== undefined),
      );
      existingImage.isPrimary = img.isPrimary ?? false;
      existingImage.source = 'existing';
      return existingImage;
    }
  });

  return { images: processedImages, toDelete };
}

/**
 * Collects media instructions data from the media instructions editor
 * @param {ShadowRoot} shadowRoot - The component's shadow root
 * @returns {Array|null} - Array of media instructions or null if none
 */
function collectMediaInstructions(shadowRoot) {
  const mediaEditor = shadowRoot.getElementById('media-instructions-editor');

  if (!mediaEditor) {
    return null;
  }

  if (typeof mediaEditor.getAllMediaInOrder !== 'function') {
    console.warn('Media instructions editor missing getAllMediaInOrder method');
    return null;
  }

  const allMedia = mediaEditor.getAllMediaInOrder();

  if (allMedia.length === 0) {
    return null;
  }

  return allMedia.map((item) => ({
    id: item.id,
    path: item.path || item.preview, // Use preview for local unsaved items
    caption: item.caption,
    type: item.type,
    order: item.position,
    pending: !!item.file,
  }));
}

/**
 * Collects comments from the comments list component
 * @param {ShadowRoot} shadowRoot - The component's shadow root
 * @returns {string[]|null} - Array with comments or null if empty
 */
function collectComments(shadowRoot) {
  const commentsList = shadowRoot.getElementById('comments-list');
  if (commentsList && typeof commentsList.getData === 'function') {
    return commentsList.getData();
  }

  console.warn('Comments list component not found or missing getData method');
  return null;
}

/**
 * Collects data for a specific section (for partial updates)
 * @param {ShadowRoot} shadowRoot - The component's shadow root
 * @param {string} section - Section name ('metadata', 'ingredients', 'instructions', 'images', 'comments')
 * @returns {Object} - Section-specific data
 */
export function collectSectionData(shadowRoot, section) {
  switch (section) {
    case 'metadata':
      const metadataComponent = shadowRoot.getElementById('metadata-fields');
      return metadataComponent ? metadataComponent.getFormData() : {};

    case 'ingredients':
      const ingredientsData = collectIngredientsFromComponent(shadowRoot);
      if (
        ingredientsData &&
        Array.isArray(ingredientsData) &&
        ingredientsData.length > 0 &&
        ingredientsData[0].title
      ) {
        return { ingredientSections: ingredientsData };
      } else if (ingredientsData) {
        return { ingredients: ingredientsData };
      }
      return { ingredients: [] };

    case 'instructions':
      const instructionsData = collectInstructionsFromComponent(shadowRoot);
      if (
        Array.isArray(instructionsData) &&
        instructionsData.length > 0 &&
        instructionsData[0].title
      ) {
        return { stages: instructionsData };
      }
      return { instructions: instructionsData || [] };

    case 'images':
      return collectImages(shadowRoot);

    case 'mediaInstructions':
      return { mediaInstructions: collectMediaInstructions(shadowRoot) };

    case 'comments':
      return { comments: collectComments(shadowRoot) };

    default:
      return {};
  }
}

// TODO: consider removing or use when relevant
/**
 * Validates that required data is present for submission
 * @param {Object} recipeData - Recipe data to validate
 * @returns {boolean} - True if minimum required data is present
 */
export function hasMinimumRequiredData(recipeData) {
  const hasIngredients =
    (recipeData.ingredients && recipeData.ingredients.length > 0) ||
    (recipeData.ingredientSections && recipeData.ingredientSections.length > 0);

  return !!(
    recipeData.name &&
    recipeData.category &&
    hasIngredients &&
    (recipeData.instructions?.length > 0 || recipeData.stages?.length > 0)
  );
}
