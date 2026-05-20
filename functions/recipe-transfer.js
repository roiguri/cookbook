/**
 * @deprecated #202 — Pub/Sub recipe-transfer pipeline (external
 * "recipe-reader-demo" publisher). The whole pipeline is currently GATED
 * (early-return + console.warn in processRecipeTransfer below) so any
 * in-flight messages are ACKed and dropped silently. Reversible: delete
 * the guard to restore. Scheduled for full removal once Cloud Logging
 * confirms zero traffic over the monitoring window. Do not add new
 * callers.
 *
 * The validators below (validateIngredientSections / validateFlatIngredients
 * / validateCookbookRecipe) were never used outside this pipeline.
 * prepareCookbookRecipe and processRecipeImages likewise. Migrating them
 * out of functions/index.js keeps live code lean and makes the eventual
 * deletion a single-file change.
 */

const { onMessagePublished } = require('firebase-functions/v2/pubsub');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

const db = getFirestore();
const storage = getStorage();

async function processRecipeImages(recipeId, images, category, originalUserId) {
  const processedImages = [];

  console.log(`Processing ${images.length} images for recipe ${recipeId}`);

  for (const [index, imageData] of images.entries()) {
    try {
      console.log(`Processing image ${index + 1}/${images.length}: ${imageData.filename}`);

      // Download image from signed URL
      const response = await fetch(imageData.downloadUrl);
      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.status}`);
      }

      const imageBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(imageBuffer);

      console.log(`Downloaded image: ${imageData.filename}, size: ${buffer.length} bytes`);

      // Generate unique filename and ID
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 15);
      const imageId = `img-${timestamp}-${randomId}`;
      const fileName = imageData.filename || `image-${index + 1}.jpg`;

      // Upload full-size image
      const fullPath = `img/recipes/full/${category}/${recipeId}/${fileName}`;
      const bucket = storage.bucket();
      const fullFile = bucket.file(fullPath);

      await fullFile.save(buffer, {
        metadata: {
          contentType: imageData.contentType || 'image/jpeg',
          metadata: {
            originalSource: 'recipe-reader-transfer',
            transferredAt: new Date().toISOString(),
          },
        },
      });

      console.log(`Uploaded full image to: ${fullPath}`);

      const firestoreImage = {
        access: 'public',
        fileName: fileName,
        full: fullPath,
        id: imageId,
        isPrimary: index === 0,
        uploadTimestamp: Timestamp.now(),
        uploadedBy: originalUserId,
      };

      processedImages.push(firestoreImage);

      console.log(`Successfully processed image ${index + 1}: ${fileName}`);
    } catch (error) {
      console.error(`Failed to process image ${index + 1} (${imageData.filename}):`, error.message);
      // Continue with other images - don't fail the entire transfer
    }
  }

  console.log(`Successfully processed ${processedImages.length}/${images.length} images`);
  return processedImages;
}

function validateIngredientSections(ingredientSections) {
  const errors = [];

  if (!ingredientSections || !Array.isArray(ingredientSections)) {
    errors.push('ingredientSections must be an array');
    return errors;
  }

  if (ingredientSections.length === 0) {
    errors.push('ingredientSections array cannot be empty');
    return errors;
  }

  ingredientSections.forEach((section, sectionIndex) => {
    if (!section || typeof section !== 'object') {
      errors.push(`Section ${sectionIndex}: must be an object`);
      return;
    }

    if (!section.title || typeof section.title !== 'string') {
      errors.push(`Section ${sectionIndex}: missing or invalid title`);
    } else if (section.title.trim().length === 0) {
      errors.push(`Section ${sectionIndex}: title cannot be empty`);
    }

    if (!section.items || !Array.isArray(section.items)) {
      errors.push(`Section ${sectionIndex}: missing or invalid items array`);
      return;
    }

    if (section.items.length === 0) {
      errors.push(`Section ${sectionIndex}: items array cannot be empty`);
      return;
    }

    section.items.forEach((ingredient, itemIndex) => {
      if (!ingredient.item || typeof ingredient.item !== 'string') {
        errors.push(`Section ${sectionIndex}, Item ${itemIndex}: missing or invalid item`);
      }
      if (
        ingredient.amount != null &&
        typeof ingredient.amount !== 'string' &&
        typeof ingredient.amount !== 'number'
      ) {
        errors.push(
          `Section ${sectionIndex}, Item ${itemIndex}: amount must be a string or number`,
        );
      }
      if (ingredient.unit && typeof ingredient.unit !== 'string') {
        errors.push(`Section ${sectionIndex}, Item ${itemIndex}: unit must be string`);
      }
    });
  });

  return errors;
}

function validateFlatIngredients(ingredients) {
  const errors = [];

  if (!ingredients || !Array.isArray(ingredients)) {
    errors.push('ingredients must be an array');
    return errors;
  }

  if (ingredients.length === 0) {
    errors.push('ingredients array cannot be empty');
    return errors;
  }

  ingredients.forEach((ingredient, index) => {
    if (!ingredient.item || typeof ingredient.item !== 'string') {
      errors.push(`Ingredient ${index}: missing or invalid item`);
    }
    if (
      ingredient.amount != null &&
      typeof ingredient.amount !== 'string' &&
      typeof ingredient.amount !== 'number'
    ) {
      errors.push(`Ingredient ${index}: amount must be a string or number`);
    }
    if (ingredient.unit && typeof ingredient.unit !== 'string') {
      errors.push(`Ingredient ${index}: unit must be string`);
    }
  });

  return errors;
}

function validateCookbookRecipe(recipeData) {
  const errors = [];

  if (!recipeData.name || typeof recipeData.name !== 'string') {
    errors.push('Missing or invalid name');
  }

  if (!recipeData.category || typeof recipeData.category !== 'string') {
    errors.push('Missing or invalid category');
  }

  if (typeof recipeData.prepTime !== 'number' || recipeData.prepTime < 0) {
    errors.push('Missing or invalid prepTime');
  }

  if (typeof recipeData.waitTime !== 'number' || recipeData.waitTime < 0) {
    errors.push('Missing or invalid waitTime');
  }

  if (typeof recipeData.servings !== 'number' || recipeData.servings < 1) {
    errors.push('Missing or invalid servings');
  }

  const hasIngredients = recipeData.ingredients && Array.isArray(recipeData.ingredients);
  const hasIngredientSections =
    recipeData.ingredientSections && Array.isArray(recipeData.ingredientSections);

  if (!hasIngredients && !hasIngredientSections) {
    errors.push('Must have either ingredients or ingredientSections');
  } else if (hasIngredients && hasIngredientSections) {
    errors.push('Cannot have both ingredients and ingredientSections - choose one');
  } else if (hasIngredients) {
    const ingredientErrors = validateFlatIngredients(recipeData.ingredients);
    errors.push(...ingredientErrors);
  } else if (hasIngredientSections) {
    const sectionErrors = validateIngredientSections(recipeData.ingredientSections);
    errors.push(...sectionErrors);
  }

  const hasStages = recipeData.stages && Array.isArray(recipeData.stages);
  const hasInstructions = recipeData.instructions && Array.isArray(recipeData.instructions);

  if (!hasStages && !hasInstructions) {
    errors.push('Must have either stages or instructions');
  }

  if (hasStages && hasInstructions) {
    errors.push('Cannot have both stages and instructions - choose one');
  }

  if (hasStages) {
    recipeData.stages.forEach((stage, index) => {
      if (!stage.title || typeof stage.title !== 'string') {
        errors.push(`Stage ${index}: missing or invalid title`);
      }
      if (
        !stage.instructions ||
        !Array.isArray(stage.instructions) ||
        stage.instructions.length === 0
      ) {
        errors.push(`Stage ${index}: missing or invalid instructions array`);
      }
    });
  }

  if (
    hasInstructions &&
    !recipeData.instructions.every((instruction) => typeof instruction === 'string')
  ) {
    errors.push('All instructions must be strings');
  }

  if (recipeData.difficulty && typeof recipeData.difficulty !== 'string') {
    errors.push('Invalid difficulty: must be string');
  }

  if (recipeData.mainIngredient && typeof recipeData.mainIngredient !== 'string') {
    errors.push('Invalid mainIngredient: must be string');
  }

  if (
    recipeData.tags &&
    (!Array.isArray(recipeData.tags) || !recipeData.tags.every((tag) => typeof tag === 'string'))
  ) {
    errors.push('Invalid tags: must be array of strings');
  }

  if (
    recipeData.comments &&
    (!Array.isArray(recipeData.comments) ||
      !recipeData.comments.every((comment) => typeof comment === 'string'))
  ) {
    errors.push('Invalid comments: must be array of strings');
  }

  if (recipeData.description && typeof recipeData.description !== 'string') {
    errors.push('Invalid description: must be string');
  }

  if (recipeData.sourceUrl && typeof recipeData.sourceUrl !== 'string') {
    errors.push('Invalid sourceUrl: must be string');
  }

  return errors;
}

function prepareCookbookRecipe(recipeData, metadata) {
  const firestoreTimestamp = Timestamp.now();
  console.log('TODO: Store transfer metadata once added to database schema:', {
    transferredFrom: 'recipe-reader-demo',
    transferDate: metadata.timestamp,
    originalUserId: metadata.userId,
    originalUserEmail: metadata.userEmail,
  });

  return {
    name: recipeData.name,
    category: recipeData.category,
    prepTime: recipeData.prepTime,
    waitTime: recipeData.waitTime,
    servings: recipeData.servings,

    ...(recipeData.ingredients && { ingredients: recipeData.ingredients }),
    ...(recipeData.ingredientSections && { ingredientSections: recipeData.ingredientSections }),

    ...(recipeData.stages && { stages: recipeData.stages }),
    ...(recipeData.instructions && { instructions: recipeData.instructions }),

    ...(recipeData.difficulty && { difficulty: recipeData.difficulty }),
    ...(recipeData.mainIngredient && { mainIngredient: recipeData.mainIngredient }),
    tags: recipeData.tags || [],
    comments: recipeData.comments || [],

    ...(recipeData.description && { description: recipeData.description }),
    ...(recipeData.sourceUrl && { attribution: recipeData.sourceUrl }),

    approved: false,
    allowImageSuggestions: true,
    images: [],
    pendingImages: [],
    creationTime: firestoreTimestamp,
  };
}

// GATED (#202): early-return + warn so any in-flight Pub/Sub messages are
// ACKed and dropped silently (no retry storm). Cloud Logging surfaces the
// real traffic. Delete the guard to restore. Full removal of this file is
// the tracked follow-up on #202 once logs confirm zero hits.
const processRecipeTransfer = onMessagePublished('recipe-transfers', async (event) => {
  console.warn('[processRecipeTransfer] GATED — message dropped:', event && event.id);
  return;

  /* eslint-disable no-unreachable */
  const messageId = event.id;
  const timestamp = new Date().toISOString();

  console.log(`[${timestamp}] Recipe transfer request received:`, messageId);

  try {
    const messageData = event.data.message.data;

    if (!messageData) {
      throw new Error('No message data received');
    }

    let transferRequest;
    try {
      const decodedMessage = Buffer.from(messageData, 'base64').toString();
      transferRequest = JSON.parse(decodedMessage);
    } catch (parseError) {
      throw new Error(`Failed to parse message JSON: ${parseError.message}`);
    }

    console.log('Processing recipe transfer for:', transferRequest.recipeData?.name);
    console.log('User:', transferRequest.metadata?.userEmail);
    console.log('Images count:', transferRequest.images?.length || 0);

    if (!transferRequest.type || transferRequest.type !== 'recipe-transfer-requested') {
      throw new Error('Invalid message type');
    }

    if (!transferRequest.recipeData || !transferRequest.metadata) {
      throw new Error('Missing recipeData or metadata');
    }

    const validationErrors = validateCookbookRecipe(transferRequest.recipeData);
    if (validationErrors.length > 0) {
      throw new Error(`Recipe validation failed: ${validationErrors.join(', ')}`);
    }

    console.log('Recipe validation passed');

    const cookbookRecipe = prepareCookbookRecipe(
      transferRequest.recipeData,
      transferRequest.metadata,
    );

    console.log('Prepared recipe for storage:', {
      name: cookbookRecipe.name,
      category: cookbookRecipe.category,
      hasStages: !!cookbookRecipe.stages,
      hasInstructions: !!cookbookRecipe.instructions,
      stagesCount: cookbookRecipe.stages?.length || 0,
      instructionsCount: cookbookRecipe.instructions?.length || 0,
      prepTime: cookbookRecipe.prepTime,
      waitTime: cookbookRecipe.waitTime,
      servings: cookbookRecipe.servings,
      approved: cookbookRecipe.approved,
      transferredFrom: cookbookRecipe.transferredFrom,
    });

    const recipeRef = await db.collection('recipes').add(cookbookRecipe);
    const recipeId = recipeRef.id;

    console.log(`Recipe stored successfully with ID: ${recipeId}`);

    const images = transferRequest.images || [];
    let processedImages = [];

    if (images.length > 0) {
      console.log(`Starting image transfer for ${images.length} images`);

      try {
        processedImages = await processRecipeImages(
          recipeId,
          images,
          transferRequest.recipeData.category,
          transferRequest.metadata.userId,
        );

        if (processedImages.length > 0) {
          await recipeRef.update({ images: processedImages });
          console.log(`Updated recipe with ${processedImages.length} images`);
        }
      } catch (imageError) {
        console.error('Image processing failed:', imageError.message);
      }
    }

    console.log(`Recipe transfer completed successfully: ${cookbookRecipe.name} (ID: ${recipeId})`);

    return {
      success: true,
      messageId: messageId,
      recipeId: recipeId,
      recipeName: cookbookRecipe.name,
      processedAt: timestamp,
    };
  } catch (error) {
    console.error(`Recipe transfer failed [${messageId}]:`, error.message);
    console.error('Full error:', error);

    throw error;
  }
  /* eslint-enable no-unreachable */
});

module.exports = { processRecipeTransfer };
