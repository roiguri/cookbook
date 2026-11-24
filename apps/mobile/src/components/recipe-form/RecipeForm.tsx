import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import {
  CATEGORY_IDS,
  CATEGORY_MAP,
  DIFFICULTIES,
  MAX_PHOTOS,
  MAX_RELATED_RECIPES,
  MEDIA_MAX_BYTES,
  mediaTypeOf,
  MIN_SECTIONS,
  missingRequiredFields,
  PHOTO_MAX_BYTES,
  PHOTO_TYPES,
  RECIPE_NUMBER_LIMITS,
} from '@cookbook/core/recipe-model';
import {
  calculateTotalTime,
  formatCookingTime,
  getLocalizedCategoryName,
} from '@cookbook/core/recipe-utils/recipe-data-utils';
import {
  formatIngredientAmount,
  HEBREW_UNITS,
  isValidAmount,
  parseAmount,
} from '@cookbook/core/recipe-utils/recipe-ingredients-utils';
import { colors, fontFamilies, radii, shadows, spacing, statusColors, typeScale } from '@/theme';
import {
  Badge,
  Button,
  Card,
  Chip,
  ConfirmDialog,
  ModalSheet,
  PressableScale,
} from '@/components/ui';
import { MediaInstructionService } from '@/services/recipes/media-instruction-service';
import { RecipeImageService } from '@/services/recipes/recipe-image-service';
import { RecipeService, type RecipeDoc } from '@/services/recipes/recipe-service';
import type { MappedRecipeFormData } from '@/services/recipes/recipe-import-service';

export interface RecipeFormImageItem {
  id: string;
  source: 'new' | 'existing';
  previewUri: string;
  localUri?: string;
  fileName?: string;
  contentType?: string;
  isPrimary: boolean;
  full?: string;
  url?: string;
  uploadedBy?: string;
  access?: string;
  uploadTimestamp?: any;
  [key: string]: any;
}

export interface RecipeFormMediaItem {
  id: string;
  source: 'new' | 'existing';
  previewUri: string;
  localUri?: string;
  fileName?: string;
  contentType?: string;
  type: 'image' | 'video';
  caption: string;
  path?: string;
  url?: string;
  uploadedBy?: string;
  uploadedAt?: any;
}

export interface RecipeFormCollectedData {
  name: string;
  description?: string;
  category: string;
  difficulty: string;
  mainIngredient?: string;
  prepTime: number;
  waitTime: number;
  servings: number;
  servingsUnit?: string;
  tags?: string[];
  comments?: string[];
  attribution?: string;
  relatedRecipes: string[];
  ingredients?: Array<{ amount: number | null; unit: string; item: string }>;
  ingredientSections?: Array<{
    title: string;
    items: Array<{ amount: number | null; unit: string; item: string }>;
  }>;
  instructions?: string[];
  stages?: Array<{ title: string; instructions: string[] }>;
  images: RecipeFormImageItem[];
  imagesToDelete: RecipeFormImageItem[];
  mediaItemsOrdered: RecipeFormMediaItem[];
  mediaToDelete: string[];
  directPublish?: boolean;
}

export interface RecipeFormHandle {
  populateFromExtracted: (mapped: MappedRecipeFormData, sourceUrl?: string | null) => void;
  resetToEmpty: () => void;
  resetToInitial: () => void;
  submit: () => void;
  requestClear: () => void;
  isDirty: () => boolean;
  markClean: () => void;
}

export interface RecipeFormProps {
  initialRecipe?: Partial<RecipeDoc> | null;
  excludeRecipeId?: string | null;
  submitLabel?: string;
  clearLabel?: string;
  showAiImport?: boolean;
  showPreviewToggle?: boolean;
  hideActions?: boolean;
  /** Reusable flag for Slice 09 Manager Dashboard direct-publish edit mode. */
  directPublish?: boolean;
  submitting?: boolean;
  disabled?: boolean;
  isImported?: boolean;
  onOpenAiImport?: () => void;
  onSubmit: (data: RecipeFormCollectedData) => void | Promise<void>;
  onClear?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onPreviewChange?: (preview: boolean) => void;
}

interface IngredientRowDraft {
  id: string;
  amount: string;
  unit: string;
  item: string;
}

interface IngredientSectionDraft {
  id: string;
  title: string;
  items: IngredientRowDraft[];
}

interface InstructionRowDraft {
  id: string;
  text: string;
}

interface StageDraft {
  id: string;
  title: string;
  items: InstructionRowDraft[];
}

interface CommentRowDraft {
  id: string;
  text: string;
}

interface FormProblem {
  id: string;
  kind: 'missing' | 'wrong' | 'rule';
  label: string;
  explanation?: string;
  section: 'details' | 'ingredients' | 'instructions';
}

interface BlankIngredientRowInfo {
  id: string;
  rowKey: string;
  item: string;
  fields: Array<'amount' | 'unit'>;
}

interface FormStateSnapshot {
  name: string;
  description: string;
  category: string;
  difficulty: string;
  mainIngredient: string;
  prepTime: string;
  waitTime: string;
  servings: string;
  servingsUnit: string;
  tagsText: string;
  attribution: string;
  isSectionedIngredients: boolean;
  flatIngredients: IngredientRowDraft[];
  ingredientSections: IngredientSectionDraft[];
  isStagedInstructions: boolean;
  flatInstructions: InstructionRowDraft[];
  stages: StageDraft[];
  comments: CommentRowDraft[];
  images: RecipeFormImageItem[];
  imagesToDelete: RecipeFormImageItem[];
  mediaItems: RecipeFormMediaItem[];
  mediaToDelete: string[];
  relatedRecipes: string[];
}

let uidSeq = 0;
function nextKey(prefix: string): string {
  uidSeq += 1;
  return `${prefix}-${Date.now()}-${uidSeq}`;
}

function emptyIngredientRow(): IngredientRowDraft {
  return { id: nextKey('ing'), amount: '', unit: '', item: '' };
}

function emptyIngredientSection(): IngredientSectionDraft {
  return { id: nextKey('sec'), title: '', items: [emptyIngredientRow()] };
}

function emptyInstructionRow(): InstructionRowDraft {
  return { id: nextKey('step'), text: '' };
}

function emptyStage(): StageDraft {
  return { id: nextKey('stg'), title: '', items: [emptyInstructionRow()] };
}

function createEmptyState(): FormStateSnapshot {
  return {
    name: '',
    description: '',
    category: 'main-courses',
    difficulty: 'קלה',
    mainIngredient: '',
    prepTime: '',
    waitTime: '',
    servings: '',
    servingsUnit: '',
    tagsText: '',
    attribution: '',
    isSectionedIngredients: false,
    flatIngredients: [emptyIngredientRow()],
    ingredientSections: [emptyIngredientSection(), emptyIngredientSection()],
    isStagedInstructions: false,
    flatInstructions: [emptyInstructionRow()],
    stages: [emptyStage(), emptyStage()],
    comments: [],
    images: [],
    imagesToDelete: [],
    mediaItems: [],
    mediaToDelete: [],
    relatedRecipes: [],
  };
}

function ingredientToDraft(raw: any): IngredientRowDraft {
  if (typeof raw === 'string') {
    return { id: nextKey('ing'), amount: '', unit: '', item: raw };
  }
  return {
    id: nextKey('ing'),
    amount:
      raw?.amount !== null && raw?.amount !== undefined && raw?.amount !== ''
        ? formatIngredientAmount(raw.amount) || String(raw.amount)
        : '',
    unit: typeof raw?.unit === 'string' ? raw.unit : '',
    item: typeof raw?.item === 'string' ? raw.item : '',
  };
}

function buildStateFromRecipe(
  recipe?: Partial<RecipeDoc> | MappedRecipeFormData | null,
): FormStateSnapshot {
  const base = createEmptyState();
  if (!recipe) return base;

  base.name = typeof recipe.name === 'string' ? recipe.name : '';
  base.description = typeof recipe.description === 'string' ? recipe.description : '';
  base.category =
    typeof recipe.category === 'string' && CATEGORY_IDS.includes(recipe.category)
      ? recipe.category
      : '';
  base.difficulty =
    typeof recipe.difficulty === 'string' && DIFFICULTIES.includes(recipe.difficulty)
      ? recipe.difficulty
      : '';
  base.mainIngredient = typeof recipe.mainIngredient === 'string' ? recipe.mainIngredient : '';
  base.prepTime =
    typeof recipe.prepTime === 'number' && Number.isFinite(recipe.prepTime) && recipe.prepTime > 0
      ? String(recipe.prepTime)
      : '';
  base.waitTime =
    typeof recipe.waitTime === 'number' && Number.isFinite(recipe.waitTime) && recipe.waitTime > 0
      ? String(recipe.waitTime)
      : '';
  base.servings =
    typeof recipe.servings === 'number' && Number.isFinite(recipe.servings) && recipe.servings > 0
      ? String(recipe.servings)
      : '';
  base.servingsUnit = typeof recipe.servingsUnit === 'string' ? recipe.servingsUnit : '';
  base.tagsText = Array.isArray(recipe.tags) ? recipe.tags.filter(Boolean).join(', ') : '';
  base.attribution = typeof recipe.attribution === 'string' ? recipe.attribution : '';

  if (Array.isArray(recipe.ingredientSections) && recipe.ingredientSections.length > 0) {
    base.isSectionedIngredients = true;
    const secs: IngredientSectionDraft[] = recipe.ingredientSections.map((sec: any) => {
      const items =
        Array.isArray(sec?.items) && sec.items.length > 0
          ? sec.items.map(ingredientToDraft)
          : [emptyIngredientRow()];
      return { id: nextKey('sec'), title: typeof sec?.title === 'string' ? sec.title : '', items };
    });
    while (secs.length < MIN_SECTIONS) secs.push(emptyIngredientSection());
    base.ingredientSections = secs;
  } else if (Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0) {
    base.isSectionedIngredients = false;
    base.flatIngredients = recipe.ingredients.map(ingredientToDraft);
  }

  if (Array.isArray(recipe.stages) && recipe.stages.length > 0) {
    base.isStagedInstructions = true;
    const stgs: StageDraft[] = recipe.stages.map((st: any) => {
      const list = Array.isArray(st?.instructions) ? st.instructions : [];
      const items =
        list.length > 0
          ? list.map((s: any) => ({
              id: nextKey('step'),
              text: typeof s === 'string' ? s : typeof s?.text === 'string' ? s.text : '',
            }))
          : [emptyInstructionRow()];
      return { id: nextKey('stg'), title: typeof st?.title === 'string' ? st.title : '', items };
    });
    while (stgs.length < MIN_SECTIONS) stgs.push(emptyStage());
    base.stages = stgs;
  } else if (Array.isArray(recipe.instructions) && recipe.instructions.length > 0) {
    base.isStagedInstructions = false;
    base.flatInstructions = recipe.instructions.map((s: any) => ({
      id: nextKey('step'),
      text: typeof s === 'string' ? s : typeof s?.text === 'string' ? s.text : '',
    }));
  }

  if (Array.isArray(recipe.comments) && recipe.comments.length > 0) {
    base.comments = recipe.comments
      .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
      .map((c) => ({ id: nextKey('cmt'), text: c }));
  }

  if ('relatedRecipes' in recipe && Array.isArray(recipe.relatedRecipes)) {
    base.relatedRecipes = recipe.relatedRecipes
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      .slice(0, MAX_RELATED_RECIPES);
  }

  if ('images' in recipe && Array.isArray(recipe.images)) {
    base.images = recipe.images.map((img: any, idx: number) => ({
      ...img,
      id: img?.id || nextKey(`img-${idx}`),
      source: 'existing' as const,
      previewUri: img?.url || img?.preview || '',
      isPrimary: Boolean(img?.isPrimary),
    }));
  }

  if ('mediaInstructions' in recipe && Array.isArray(recipe.mediaInstructions)) {
    base.mediaItems = [...recipe.mediaInstructions]
      .sort((a: any, b: any) => (a?.order ?? 0) - (b?.order ?? 0))
      .map((item: any, idx: number) => ({
        id: item?.id || nextKey(`med-${idx}`),
        source: 'existing' as const,
        previewUri: item?.url || item?.preview || '',
        type: item?.type === 'video' ? 'video' : 'image',
        caption: typeof item?.caption === 'string' ? item.caption : '',
        path: item?.path,
        url: item?.url,
        uploadedBy: item?.uploadedBy,
        uploadedAt: item?.uploadedAt,
      }));
  }

  return base;
}

function serializeComparable(state: FormStateSnapshot): string {
  return JSON.stringify({
    name: state.name.trim(),
    description: state.description.trim(),
    category: state.category,
    difficulty: state.difficulty,
    mainIngredient: state.mainIngredient.trim(),
    prepTime: state.prepTime.trim(),
    waitTime: state.waitTime.trim(),
    servings: state.servings.trim(),
    servingsUnit: state.servingsUnit.trim(),
    tagsText: state.tagsText.trim(),
    attribution: state.attribution.trim(),
    isSectionedIngredients: state.isSectionedIngredients,
    flatIngredients: state.flatIngredients.map((r) => [
      r.amount.trim(),
      r.unit.trim(),
      r.item.trim(),
    ]),
    ingredientSections: state.ingredientSections.map((s) => [
      s.title.trim(),
      s.items.map((r) => [r.amount.trim(), r.unit.trim(), r.item.trim()]),
    ]),
    isStagedInstructions: state.isStagedInstructions,
    flatInstructions: state.flatInstructions.map((r) => r.text.trim()),
    stages: state.stages.map((s) => [s.title.trim(), s.items.map((r) => r.text.trim())]),
    comments: state.comments.map((c) => c.text.trim()),
    images: state.images.map((i) => [i.id, i.source, i.isPrimary, i.localUri || i.full || '']),
    mediaItems: state.mediaItems.map((m) => [
      m.id,
      m.source,
      m.caption.trim(),
      m.localUri || m.path || '',
    ]),
    relatedRecipes: state.relatedRecipes,
  });
}

function findBlankIngredientRows(state: FormStateSnapshot): BlankIngredientRowInfo[] {
  const rows: BlankIngredientRowInfo[] = [];
  const checkRow = (row: IngredientRowDraft, rowKey: string) => {
    const item = row.item.trim();
    if (!item) return;
    // Allow count-style ingredients with an explicit amount and blank unit
    // (e.g. "3 ביצים", "4 לחם מחמצת"); prompt only when amount itself is blank.
    if (!row.amount.trim()) {
      const fields: Array<'amount' | 'unit'> = !row.unit.trim() ? ['amount', 'unit'] : ['amount'];
      rows.push({
        id: `${item}::${fields.join(',')}`,
        rowKey,
        item,
        fields,
      });
    }
  };

  if (state.isSectionedIngredients) {
    state.ingredientSections.forEach((sec, sIdx) => {
      sec.items.forEach((row, rIdx) => checkRow(row, `sec-${sIdx}-row-${rIdx}`));
    });
  } else {
    state.flatIngredients.forEach((row, rIdx) => checkRow(row, `flat-${rIdx}`));
  }
  return rows;
}

function buildBlankFieldsMessage(rows: BlankIngredientRowInfo[]): string {
  const missing = (fields: Array<'amount' | 'unit'>) =>
    fields.length === 2 ? 'כמות ויחידה' : fields[0] === 'amount' ? 'כמות' : 'יחידה';
  const shown = rows.length <= 4 ? rows : rows.slice(0, 3);
  const listed = shown.map((r) => `${r.item} (${missing(r.fields)})`).join(', ');
  const more = rows.length > shown.length ? ` ו-${rows.length - shown.length} נוספים` : '';
  const count = rows.length === 1 ? 'במרכיב אחד' : `ב-${rows.length} מרכיבים`;
  return `${count} לא מולאו כל השדות: ${listed}${more}. השארת אותם ריקים בכוונה?`;
}

function inferPhotoMime(asset: ImagePicker.ImagePickerAsset): string {
  if (asset.mimeType && PHOTO_TYPES.includes(asset.mimeType)) return asset.mimeType;
  const lower = (asset.fileName || asset.uri || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function inferStepMediaMime(asset: ImagePicker.ImagePickerAsset): string {
  if (asset.mimeType && mediaTypeOf(asset.mimeType)) return asset.mimeType;
  const lower = (asset.fileName || asset.uri || '').toLowerCase();
  if (asset.type === 'video' || lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

export const RecipeForm = forwardRef<RecipeFormHandle, RecipeFormProps>(function RecipeForm(
  {
    initialRecipe,
    excludeRecipeId,
    submitLabel = 'שלח מתכון',
    clearLabel = 'נקה טופס',
    showAiImport = false,
    showPreviewToggle = true,
    hideActions = false,
    directPublish = false,
    submitting = false,
    disabled = false,
    isImported = false,
    onOpenAiImport,
    onSubmit,
    onClear,
    onDirtyChange,
    onPreviewChange,
  },
  ref,
) {
  const [state, setState] = useState<FormStateSnapshot>(() => buildStateFromRecipe(initialRecipe));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<FormProblem[]>([]);
  const [blankWarningKeys, setBlankWarningKeys] = useState<Set<string>>(new Set());
  const [assetError, setAssetError] = useState<string | null>(null);
  const [isPreview, setIsPreview] = useState(false);

  // Modals / Pickers
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [unitPickerTarget, setUnitPickerTarget] = useState<{
    sectionIndex: number | null;
    rowIndex: number;
  } | null>(null);
  const [photoSourceSheetOpen, setPhotoSourceSheetOpen] = useState(false);
  const [relatedSheetOpen, setRelatedSheetOpen] = useState(false);
  const [publishedRecipes, setPublishedRecipes] = useState<RecipeDoc[]>([]);
  const [loadingPublished, setLoadingPublished] = useState(false);
  const [relatedSearch, setRelatedSearch] = useState('');

  // Confirmation dialogs
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [blankDialog, setBlankDialog] = useState<{
    rows: BlankIngredientRowInfo[];
    pendingData: RecipeFormCollectedData;
  } | null>(null);

  const baselineRef = useRef<string>(serializeComparable(state));
  const acknowledgedBlankRowsRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<ScrollView | null>(null);
  const sectionYRef = useRef<Record<'details' | 'ingredients' | 'instructions', number>>({
    details: 0,
    ingredients: 420,
    instructions: 840,
  });
  const jumpIdxRef = useRef(0);

  // Resolve existing Storage image & media preview URLs when seeded with a saved recipe
  const resolveExistingPreviews = useCallback(async (seedState: FormStateSnapshot) => {
    if (seedState.images.length > 0) {
      const resolvedImgs = await Promise.all(
        seedState.images.map(async (img) => {
          if (img.source !== 'existing' || img.previewUri) return img;
          const url = await RecipeImageService.getOptimizedUrl(img, '400x400').catch(() => null);
          return url ? { ...img, previewUri: url } : img;
        }),
      );
      setState((prev) => ({
        ...prev,
        images: prev.images.map((cur) => {
          const hit = resolvedImgs.find((r) => r.id === cur.id);
          return hit && hit.previewUri ? { ...cur, previewUri: hit.previewUri } : cur;
        }),
      }));
    }

    if (seedState.mediaItems.length > 0) {
      const resolvedMedia = await Promise.all(
        seedState.mediaItems.map(async (item) => {
          if (item.source !== 'existing' || item.previewUri) return item;
          const url = await MediaInstructionService.resolveMediaUrl(item).catch(() => null);
          return url ? { ...item, previewUri: url } : item;
        }),
      );
      setState((prev) => ({
        ...prev,
        mediaItems: prev.mediaItems.map((cur) => {
          const hit = resolvedMedia.find((r) => r.id === cur.id);
          return hit && hit.previewUri ? { ...cur, previewUri: hit.previewUri } : cur;
        }),
      }));
    }
  }, []);

  // Re-seed whenever initialRecipe changes (Edit Mode / SuggestEditModal)
  useEffect(() => {
    if (!initialRecipe) return;
    const seeded = buildStateFromRecipe(initialRecipe);
    setState(seeded);
    setFieldErrors({});
    setProblems([]);
    setBlankWarningKeys(new Set());
    setAssetError(null);
    baselineRef.current = serializeComparable(seeded);
    // Mark pre-existing blank ingredient rows as acknowledged so edits don't re-prompt
    acknowledgedBlankRowsRef.current = new Set(findBlankIngredientRows(seeded).map((r) => r.id));
    onDirtyChange?.(false);
    void resolveExistingPreviews(seeded);
  }, [initialRecipe, onDirtyChange, resolveExistingPreviews]);

  // Track dirty state against baseline
  const isDirtyNow = useMemo(() => serializeComparable(state) !== baselineRef.current, [state]);

  useEffect(() => {
    onDirtyChange?.(isDirtyNow);
  }, [isDirtyNow, onDirtyChange]);

  // Fetch published recipes when related picker opens or when existing related IDs need labels
  const loadPublishedRecipes = useCallback(async () => {
    if (publishedRecipes.length > 0 || loadingPublished) return;
    setLoadingPublished(true);
    try {
      const list = await RecipeService.listPublished();
      setPublishedRecipes(list);
    } catch {
      // Non-blocking
    } finally {
      setLoadingPublished(false);
    }
  }, [publishedRecipes.length, loadingPublished]);

  useEffect(() => {
    if (state.relatedRecipes.length > 0 && publishedRecipes.length === 0) {
      void loadPublishedRecipes();
    }
  }, [state.relatedRecipes.length, publishedRecipes.length, loadPublishedRecipes]);

  const clearErrorKey = useCallback((key: string) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const clearBlankWarningKey = useCallback((key: string) => {
    setBlankWarningKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  // Build normalized payload + validate all rules (including optional blank amounts!)
  const validateAndCollect = useCallback((): {
    valid: boolean;
    data: RecipeFormCollectedData | null;
    errors: Record<string, string>;
    problems: FormProblem[];
  } => {
    const errors: Record<string, string> = {};
    const list: FormProblem[] = [];

    const name = state.name.trim();
    const description = state.description.trim();
    const category = state.category;
    const difficulty = state.difficulty;
    const mainIngredient = state.mainIngredient.trim();
    const servingsUnit = state.servingsUnit.trim();
    const attribution = state.attribution.trim();

    const prepRaw = state.prepTime.trim();
    const prepNum = prepRaw === '' ? NaN : Number(prepRaw);
    const waitRaw = state.waitTime.trim();
    const waitNum = waitRaw === '' ? 0 : Number(waitRaw);
    const servingsRaw = state.servings.trim();
    const servingsNum = servingsRaw === '' ? NaN : Number(servingsRaw);

    if (!name) {
      errors.name = 'חובה למלא שם המנה.';
      list.push({ id: 'name', kind: 'missing', label: 'שם המנה', section: 'details' });
    }
    if (!category || !CATEGORY_IDS.includes(category)) {
      errors.category = 'חובה לבחור קטגוריה.';
      list.push({ id: 'category', kind: 'missing', label: 'קטגוריה', section: 'details' });
    }
    if (!difficulty || !DIFFICULTIES.includes(difficulty)) {
      errors.difficulty = 'חובה לבחור דרגת קושי.';
      list.push({ id: 'difficulty', kind: 'missing', label: 'דרגת קושי', section: 'details' });
    }

    if (!prepRaw) {
      errors.prepTime = 'חובה למלא זמן הכנה.';
      list.push({ id: 'prepTime', kind: 'missing', label: 'זמן הכנה', section: 'details' });
    } else if (
      !Number.isInteger(prepNum) ||
      prepNum <= 0 ||
      prepNum > RECIPE_NUMBER_LIMITS.minutes
    ) {
      errors.prepTime = 'זמן הכנה צריך להיות מספר שלם גדול מ-0.';
      list.push({
        id: 'prepTime',
        kind: 'wrong',
        label: 'זמן הכנה',
        explanation: 'צריך להיות מספר דקות גדול מ-0.',
        section: 'details',
      });
    }

    if (
      waitRaw !== '' &&
      (!Number.isInteger(waitNum) || waitNum < 0 || waitNum > RECIPE_NUMBER_LIMITS.minutes)
    ) {
      errors.waitTime = 'זמן המתנה צריך להיות מספר שלם 0 או יותר.';
      list.push({
        id: 'waitTime',
        kind: 'wrong',
        label: 'זמן המתנה',
        explanation: 'צריך להיות מספר דקות, 0 או יותר.',
        section: 'details',
      });
    }

    if (!servingsRaw) {
      errors.servings = 'חובה למלא כמות מנות.';
      list.push({ id: 'servings', kind: 'missing', label: 'כמות מנות', section: 'details' });
    } else if (
      !Number.isInteger(servingsNum) ||
      servingsNum <= 0 ||
      servingsNum > RECIPE_NUMBER_LIMITS.servings
    ) {
      errors.servings = 'כמות מנות צריכה להיות מספר שלם גדול מ-0.';
      list.push({
        id: 'servings',
        kind: 'wrong',
        label: 'כמות מנות',
        explanation: 'צריכה להיות מספר גדול מ-0.',
        section: 'details',
      });
    }

    const tags = state.tagsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    // Ingredients validation (CRITICAL P0: optional blank amounts, strict non-empty amount validation!)
    const validateIngredientRow = (
      row: IngredientRowDraft,
      rowKey: string,
      rowNumber: number,
    ): { amount: number | null; unit: string; item: string } | null => {
      const item = row.item.trim();
      const amountRaw = row.amount.trim();
      const unit = row.unit.trim();

      // Completely blank row is ignored
      if (!item && !amountRaw && !unit) return null;

      let rowHasError = false;
      if (!item) {
        errors[`${rowKey}.item`] = 'חובה למלא שם פריט לכל מרכיב.';
        list.push({
          id: `${rowKey}.item`,
          kind: 'missing',
          label: `פריט (שורה ${rowNumber})`,
          section: 'ingredients',
        });
        rowHasError = true;
      }

      let parsedAmount: number | null = null;
      if (amountRaw !== '') {
        if (!isValidAmount(amountRaw)) {
          errors[`${rowKey}.amount`] =
            'כמות שהוזנה חייבת להיות מספר, כמו 2 או 1/2 — או להישאר ריקה.';
          list.push({
            id: `${rowKey}.amount`,
            kind: 'wrong',
            label: item ? `כמות ב־${item}` : `כמות (שורה ${rowNumber})`,
            explanation: 'צריכה להיות מספר, כמו 2 או 1/2 – או להישאר ריקה.',
            section: 'ingredients',
          });
          rowHasError = true;
        } else {
          parsedAmount = parseAmount(amountRaw);
        }
      }

      if (rowHasError) return null;
      return { amount: parsedAmount, unit, item };
    };

    let collectedFlatIngredients:
      Array<{ amount: number | null; unit: string; item: string }> | undefined;
    let collectedSections:
      | Array<{
          title: string;
          items: Array<{ amount: number | null; unit: string; item: string }>;
        }>
      | undefined;

    if (state.isSectionedIngredients) {
      const validSections: Array<{
        title: string;
        items: Array<{ amount: number | null; unit: string; item: string }>;
      }> = [];
      let populatedSectionCount = 0;

      state.ingredientSections.forEach((sec, sIdx) => {
        const title = sec.title.trim();
        const nonBlankRows = sec.items.filter(
          (r) => r.item.trim() || r.amount.trim() || r.unit.trim(),
        );
        const sectionTouched = Boolean(title) || nonBlankRows.length > 0;
        if (sectionTouched) populatedSectionCount += 1;

        const secItems: Array<{ amount: number | null; unit: string; item: string }> = [];
        sec.items.forEach((row, rIdx) => {
          const parsed = validateIngredientRow(row, `sec-${sIdx}-row-${rIdx}`, rIdx + 1);
          if (parsed) secItems.push(parsed);
        });

        if (sectionTouched && !title) {
          errors[`sec-${sIdx}.title`] = 'חובה למלא כותרת לקטגוריה.';
          list.push({
            id: `sec-${sIdx}.title`,
            kind: 'missing',
            label: `כותרת קטגוריה ${sIdx + 1}`,
            section: 'ingredients',
          });
        }
        if (sectionTouched && nonBlankRows.length === 0) {
          errors[`sec-${sIdx}.items`] = 'חובה להוסיף לפחות מצרך אחד בקטגוריה.';
          list.push({
            id: `sec-${sIdx}.items`,
            kind: 'missing',
            label: `מצרכים (${title || `קטגוריה ${sIdx + 1}`})`,
            section: 'ingredients',
          });
        }
        if (title && secItems.length > 0) {
          validSections.push({ title, items: secItems });
        }
      });

      if (populatedSectionCount < MIN_SECTIONS || validSections.length < MIN_SECTIONS) {
        errors.ingredients = 'צריך לפחות 2 קטגוריות, לכל אחת כותרת ומצרך.';
        list.push({
          id: 'ingredients-sections-rule',
          kind: 'rule',
          label: 'צריך לפחות 2 קטגוריות מצרכים, לכל אחת כותרת ומצרך.',
          section: 'ingredients',
        });
      } else {
        collectedSections = validSections;
      }
    } else {
      const items: Array<{ amount: number | null; unit: string; item: string }> = [];
      let nonBlankCount = 0;
      state.flatIngredients.forEach((row, idx) => {
        if (row.item.trim() || row.amount.trim() || row.unit.trim()) nonBlankCount += 1;
        const parsed = validateIngredientRow(row, `flat-${idx}`, idx + 1);
        if (parsed) items.push(parsed);
      });

      if (nonBlankCount === 0) {
        errors.ingredients = 'חובה להוסיף לפחות מצרך אחד.';
        errors['flat-0.item'] = 'חובה להוסיף לפחות מצרך אחד.';
        list.push({ id: 'ingredients', kind: 'missing', label: 'מצרכים', section: 'ingredients' });
      } else {
        collectedFlatIngredients = items;
      }
    }

    // Instructions validation
    let collectedFlatInstructions: string[] | undefined;
    let collectedStages: Array<{ title: string; instructions: string[] }> | undefined;

    if (state.isStagedInstructions) {
      const validStages: Array<{ title: string; instructions: string[] }> = [];
      let populatedStageCount = 0;

      state.stages.forEach((stg, sIdx) => {
        const title = stg.title.trim();
        const steps = stg.items.map((r) => r.text.trim()).filter(Boolean);
        const touched = Boolean(title) || steps.length > 0;
        if (touched) populatedStageCount += 1;

        if (touched && !title) {
          errors[`stg-${sIdx}.title`] = 'חובה למלא כותרת לשלב.';
          list.push({
            id: `stg-${sIdx}.title`,
            kind: 'missing',
            label: `כותרת שלב ${sIdx + 1}`,
            section: 'instructions',
          });
        }
        if (touched && steps.length === 0) {
          errors[`stg-${sIdx}.items`] = 'חובה למלא לפחות הוראה אחת בשלב.';
          list.push({
            id: `stg-${sIdx}.items`,
            kind: 'missing',
            label: `הוראות (${title || `שלב ${sIdx + 1}`})`,
            section: 'instructions',
          });
        }
        if (title && steps.length > 0) {
          validStages.push({ title, instructions: steps });
        }
      });

      if (populatedStageCount < MIN_SECTIONS || validStages.length < MIN_SECTIONS) {
        errors.instructions = 'צריך לפחות 2 שלבים, לכל אחד כותרת והוראה.';
        list.push({
          id: 'stages-rule',
          kind: 'rule',
          label: 'צריך לפחות 2 שלבי הכנה, לכל אחד כותרת והוראה.',
          section: 'instructions',
        });
      } else {
        collectedStages = validStages;
      }
    } else {
      const steps = state.flatInstructions.map((r) => r.text.trim()).filter(Boolean);
      if (steps.length === 0) {
        errors.instructions = 'חובה למלא תהליך הכנה.';
        errors['step-0'] = 'חובה למלא לפחות שלב הכנה אחד.';
        list.push({
          id: 'instructions',
          kind: 'missing',
          label: 'הוראות הכנה',
          section: 'instructions',
        });
      } else {
        collectedFlatInstructions = steps;
      }
    }

    const comments = state.comments.map((c) => c.text.trim()).filter(Boolean);

    const candidate: RecipeFormCollectedData = {
      name,
      ...(description ? { description } : { description: '' }),
      category,
      difficulty,
      ...(mainIngredient ? { mainIngredient } : { mainIngredient: '' }),
      prepTime: Number.isInteger(prepNum) ? prepNum : 0,
      waitTime: Number.isInteger(waitNum) ? waitNum : 0,
      servings: Number.isInteger(servingsNum) ? servingsNum : 0,
      ...(servingsUnit ? { servingsUnit } : { servingsUnit: '' }),
      tags,
      comments,
      ...(attribution ? { attribution } : { attribution: '' }),
      relatedRecipes: state.relatedRecipes.slice(0, MAX_RELATED_RECIPES),
      ...(collectedSections
        ? { ingredientSections: collectedSections }
        : { ingredients: collectedFlatIngredients || [] }),
      ...(collectedStages
        ? { stages: collectedStages }
        : { instructions: collectedFlatInstructions || [] }),
      images: state.images,
      imagesToDelete: state.imagesToDelete,
      mediaItemsOrdered: state.mediaItems,
      mediaToDelete: state.mediaToDelete,
      ...(directPublish ? { directPublish: true } : {}),
    };

    // Cross-check completeness with shared @cookbook/core `missingRequiredFields`
    const coreMissing = missingRequiredFields({
      ...candidate,
      prepTime: candidate.prepTime > 0 ? candidate.prepTime : null,
      servings: candidate.servings > 0 ? candidate.servings : null,
    });
    for (const key of coreMissing) {
      if (!errors[key]) {
        errors[key] = 'שדה חובה';
        list.push({
          id: `core-${key}`,
          kind: 'missing',
          label: key,
          section:
            key === 'ingredients'
              ? 'ingredients'
              : key === 'instructions'
                ? 'instructions'
                : 'details',
        });
      }
    }

    const valid = Object.keys(errors).length === 0;
    return { valid, data: valid ? candidate : null, errors, problems: list };
  }, [state, directPublish]);

  const handleSubmitPress = useCallback(() => {
    if (disabled || submitting || isPreview) return;

    const result = validateAndCollect();
    setFieldErrors(result.errors);
    setProblems(result.problems);

    if (!result.valid || !result.data) {
      jumpIdxRef.current = 0;
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }

    // One-time blank amount/unit confirmation dialog (P0)
    const blankRows = findBlankIngredientRows(state);
    const unacknowledged = blankRows.filter((r) => !acknowledgedBlankRowsRef.current.has(r.id));
    if (unacknowledged.length > 0) {
      blankRows.forEach((r) => acknowledgedBlankRowsRef.current.add(r.id));
      setBlankDialog({ rows: unacknowledged, pendingData: result.data });
      return;
    }

    setBlankWarningKeys(new Set());
    void onSubmit(result.data);
  }, [disabled, submitting, isPreview, validateAndCollect, state, onSubmit]);

  const handleJumpToNextProblem = useCallback(() => {
    if (problems.length === 0) return;
    const target = problems[jumpIdxRef.current % problems.length];
    jumpIdxRef.current = (jumpIdxRef.current + 1) % problems.length;
    const y = sectionYRef.current[target.section] ?? 0;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 16), animated: true });
  }, [problems]);

  const doResetEmpty = useCallback(() => {
    const fresh = createEmptyState();
    setState(fresh);
    setFieldErrors({});
    setProblems([]);
    setBlankWarningKeys(new Set());
    setAssetError(null);
    setIsPreview(false);
    onPreviewChange?.(false);
    acknowledgedBlankRowsRef.current.clear();
    baselineRef.current = serializeComparable(fresh);
    onDirtyChange?.(false);
    onClear?.();
  }, [onClear, onDirtyChange, onPreviewChange]);

  const doResetInitial = useCallback(() => {
    if (initialRecipe) {
      const seeded = buildStateFromRecipe(initialRecipe);
      setState(seeded);
      setFieldErrors({});
      setProblems([]);
      setBlankWarningKeys(new Set());
      setAssetError(null);
      baselineRef.current = serializeComparable(seeded);
      acknowledgedBlankRowsRef.current = new Set(findBlankIngredientRows(seeded).map((r) => r.id));
      onDirtyChange?.(false);
      void resolveExistingPreviews(seeded);
      onClear?.();
    } else {
      doResetEmpty();
    }
  }, [initialRecipe, doResetEmpty, onClear, onDirtyChange, resolveExistingPreviews]);

  const requestClear = useCallback(() => {
    if (disabled || submitting || isPreview) return;
    if (isDirtyNow) {
      setClearConfirmOpen(true);
    } else {
      doResetInitial();
    }
  }, [disabled, submitting, isPreview, isDirtyNow, doResetInitial]);

  useImperativeHandle(
    ref,
    () => ({
      populateFromExtracted(mapped: MappedRecipeFormData, sourceUrl?: string | null) {
        const next = buildStateFromRecipe(mapped);
        if (sourceUrl && !next.attribution.trim()) {
          next.attribution = sourceUrl;
        }
        setState(next);
        setFieldErrors({});
        setProblems([]);
        setBlankWarningKeys(new Set());
        setAssetError(null);
        // Keep baselineRef untouched so imported data is marked dirty (Web parity!)
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      },
      resetToEmpty: doResetEmpty,
      resetToInitial: doResetInitial,
      submit: handleSubmitPress,
      requestClear,
      isDirty: () => isDirtyNow,
      markClean: () => {
        baselineRef.current = serializeComparable(state);
        onDirtyChange?.(false);
      },
    }),
    [
      doResetEmpty,
      doResetInitial,
      handleSubmitPress,
      requestClear,
      isDirtyNow,
      state,
      onDirtyChange,
    ],
  );

  // Toggle ingredients flat <-> sectioned (MIN_SECTIONS = 2)
  const toggleSectionedIngredients = useCallback(() => {
    setState((prev) => {
      if (!prev.isSectionedIngredients) {
        const carried = prev.flatIngredients.filter(
          (r) => r.item.trim() || r.amount.trim() || r.unit.trim(),
        );
        const firstItems = carried.length > 0 ? carried : [emptyIngredientRow()];
        return {
          ...prev,
          isSectionedIngredients: true,
          ingredientSections: [
            { id: nextKey('sec'), title: '', items: firstItems },
            emptyIngredientSection(),
          ],
        };
      }
      const flattened = prev.ingredientSections.flatMap((s) =>
        s.items.filter((r) => r.item.trim() || r.amount.trim() || r.unit.trim()),
      );
      return {
        ...prev,
        isSectionedIngredients: false,
        flatIngredients: flattened.length > 0 ? flattened : [emptyIngredientRow()],
      };
    });
    clearErrorKey('ingredients');
  }, [clearErrorKey]);

  // Toggle instructions flat <-> stages (MIN_SECTIONS = 2)
  const toggleStagedInstructions = useCallback(() => {
    setState((prev) => {
      if (!prev.isStagedInstructions) {
        const carried = prev.flatInstructions.filter((r) => r.text.trim());
        const firstItems = carried.length > 0 ? carried : [emptyInstructionRow()];
        return {
          ...prev,
          isStagedInstructions: true,
          stages: [{ id: nextKey('stg'), title: '', items: firstItems }, emptyStage()],
        };
      }
      const flattened = prev.stages.flatMap((s) => s.items.filter((r) => r.text.trim()));
      return {
        ...prev,
        isStagedInstructions: false,
        flatInstructions: flattened.length > 0 ? flattened : [emptyInstructionRow()],
      };
    });
    clearErrorKey('instructions');
  }, [clearErrorKey]);

  // Photo pickers (Gallery / Camera) — up to MAX_PHOTOS = 5, <= 5 MB, jpeg/png/webp
  const addPickedPhotos = useCallback((assets: ImagePicker.ImagePickerAsset[]) => {
    setAssetError(null);
    const rejectedMessages: string[] = [];
    const accepted: RecipeFormImageItem[] = [];

    for (const asset of assets) {
      if (typeof asset.fileSize === 'number' && asset.fileSize > PHOTO_MAX_BYTES) {
        rejectedMessages.push('תמונה אחת או יותר חורגות ממגבלת 5MB.');
        continue;
      }
      const mime = inferPhotoMime(asset);
      if (!PHOTO_TYPES.includes(mime)) {
        rejectedMessages.push('נתמכות רק תמונות JPG, PNG או WebP.');
        continue;
      }
      accepted.push({
        id: nextKey('photo'),
        source: 'new',
        previewUri: asset.uri,
        localUri: asset.uri,
        fileName:
          asset.fileName ||
          `photo.${mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'}`,
        contentType: mime,
        isPrimary: false,
      });
    }

    if (rejectedMessages.length > 0) {
      setAssetError(rejectedMessages[0]);
    }
    if (accepted.length === 0) return;

    setState((prev) => {
      const remaining = Math.max(0, MAX_PHOTOS - prev.images.length);
      const merged = [...prev.images, ...accepted.slice(0, remaining)];
      if (merged.length > 0 && !merged.some((i) => i.isPrimary)) {
        merged[0] = { ...merged[0], isPrimary: true };
      }
      return { ...prev, images: merged };
    });
  }, []);

  const handlePickPhotoLibrary = useCallback(async () => {
    setPhotoSourceSheetOpen(false);
    const remaining = MAX_PHOTOS - state.images.length;
    if (remaining <= 0) return;

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setAssetError('נדרשת הרשאת גישה לגלריה להוספת תמונות.');
      return;
    }

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.85,
    });
    if (!res.canceled && res.assets?.length) {
      addPickedPhotos(res.assets);
    }
  }, [state.images.length, addPickedPhotos]);

  const handlePickPhotoCamera = useCallback(async () => {
    setPhotoSourceSheetOpen(false);
    if (state.images.length >= MAX_PHOTOS) return;

    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setAssetError('נדרשת הרשאת מצלמה לצילום תמונה.');
      return;
    }

    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.85,
    });
    if (!res.canceled && res.assets?.length) {
      addPickedPhotos(res.assets);
    }
  }, [state.images.length, addPickedPhotos]);

  const setPrimaryPhoto = useCallback((photoId: string) => {
    setState((prev) => ({
      ...prev,
      images: prev.images.map((img) => ({ ...img, isPrimary: img.id === photoId })),
    }));
  }, []);

  const movePhoto = useCallback((index: number, delta: -1 | 1) => {
    setState((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.images.length) return prev;
      const next = [...prev.images];
      const tmp = next[index];
      next[index] = next[target];
      next[target] = tmp;
      return { ...prev, images: next };
    });
  }, []);

  const removePhoto = useCallback((index: number) => {
    setState((prev) => {
      const removed = prev.images[index];
      const remaining = prev.images.filter((_, i) => i !== index);
      if (remaining.length > 0 && !remaining.some((i) => i.isPrimary)) {
        remaining[0] = { ...remaining[0], isPrimary: true };
      }
      const nextToDelete =
        removed && removed.source === 'existing'
          ? [...prev.imagesToDelete, removed]
          : prev.imagesToDelete;
      return { ...prev, images: remaining, imagesToDelete: nextToDelete };
    });
  }, []);

  // Step Media picker (image or video <= 50 MB)
  const handleAddStepMedia = useCallback(async () => {
    setAssetError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setAssetError('נדרשת הרשאת גישה לגלריה להוספת מדיה לשלבים.');
      return;
    }

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: false,
      quality: 0.85,
    });
    if (res.canceled || !res.assets?.[0]) return;

    const asset = res.assets[0];
    if (typeof asset.fileSize === 'number' && asset.fileSize > MEDIA_MAX_BYTES) {
      setAssetError('קובץ המדיה חורג ממגבלת 50MB.');
      return;
    }

    const mime = inferStepMediaMime(asset);
    const mediaType = mediaTypeOf(mime);
    if (!mediaType) {
      setAssetError('סוג קובץ לא נתמך. ניתן להעלות תמונות או סרטונים.');
      return;
    }

    const newItem: RecipeFormMediaItem = {
      id: nextKey('media'),
      source: 'new',
      previewUri: asset.uri,
      localUri: asset.uri,
      fileName: asset.fileName || `step.${mediaType === 'video' ? 'mp4' : 'jpg'}`,
      contentType: mime,
      type: mediaType,
      caption: '',
    };
    setState((prev) => ({ ...prev, mediaItems: [...prev.mediaItems, newItem] }));
  }, []);

  const moveMediaItem = useCallback((index: number, delta: -1 | 1) => {
    setState((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.mediaItems.length) return prev;
      const next = [...prev.mediaItems];
      const tmp = next[index];
      next[index] = next[target];
      next[target] = tmp;
      return { ...prev, mediaItems: next };
    });
  }, []);

  const removeMediaItem = useCallback((index: number) => {
    setState((prev) => {
      const removed = prev.mediaItems[index];
      const nextItems = prev.mediaItems.filter((_, i) => i !== index);
      const nextToDelete =
        removed && removed.source === 'existing' && removed.path
          ? [...prev.mediaToDelete, removed.path]
          : prev.mediaToDelete;
      return { ...prev, mediaItems: nextItems, mediaToDelete: nextToDelete };
    });
  }, []);

  const toggleRelatedRecipe = useCallback((recipeId: string) => {
    setState((prev) => {
      if (prev.relatedRecipes.includes(recipeId)) {
        return { ...prev, relatedRecipes: prev.relatedRecipes.filter((id) => id !== recipeId) };
      }
      if (prev.relatedRecipes.length >= MAX_RELATED_RECIPES) return prev;
      return { ...prev, relatedRecipes: [...prev.relatedRecipes, recipeId] };
    });
  }, []);

  const togglePreview = useCallback(() => {
    setIsPreview((prev) => {
      const next = !prev;
      onPreviewChange?.(next);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return next;
    });
  }, [onPreviewChange]);

  const filteredPublished = useMemo(() => {
    const q = relatedSearch.trim().toLowerCase();
    return publishedRecipes.filter((r) => {
      if (excludeRecipeId && r.id === excludeRecipeId) return false;
      if (!q) return true;
      return (
        (r.name || '').toLowerCase().includes(q) ||
        getLocalizedCategoryName(r.category || '')
          .toLowerCase()
          .includes(q)
      );
    });
  }, [publishedRecipes, excludeRecipeId, relatedSearch]);

  const primaryPreviewPhoto = useMemo(() => {
    const primary = state.images.find((i) => i.isPrimary) || state.images[0];
    return primary?.previewUri || null;
  }, [state.images]);

  const missingProblems = useMemo(() => problems.filter((p) => p.kind === 'missing'), [problems]);
  const wrongAndRuleProblems = useMemo(
    () => problems.filter((p) => p.kind !== 'missing'),
    [problems],
  );

  // Track global flat/sectioned indices for deterministic testIDs
  let ingredientGlobalIdx = 0;
  let instructionGlobalIdx = 0;

  return (
    <View style={styles.root}>
      {/* Sticky Top Toolbar (AI Import + Preview Toggle) */}
      {showAiImport || showPreviewToggle ? (
        <View style={styles.topToolbar}>
          {showAiImport ? (
            <Button
              testID="ai-import-open-btn"
              label="ייבא מתכון"
              variant="outline"
              size="sm"
              disabled={disabled || submitting || isPreview}
              onPress={onOpenAiImport}
              icon={<Ionicons name="sparkles-outline" size={16} color={colors.primaryDark} />}
              style={styles.toolbarBtn}
            />
          ) : null}

          {showPreviewToggle ? (
            <Button
              testID="recipe-form-preview-btn"
              label={isPreview ? 'חזור לעריכה' : 'תצוגה מקדימה'}
              variant="secondary"
              size="sm"
              disabled={disabled || submitting}
              onPress={togglePreview}
              icon={
                <Ionicons
                  name={isPreview ? 'create-outline' : 'eye-outline'}
                  size={16}
                  color={colors.ink}
                />
              }
              style={styles.toolbarBtn}
            />
          ) : null}
        </View>
      ) : null}

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}
      >
        {/* Post-Import Review Banner */}
        {isImported && !isPreview ? (
          <View testID="recipe-form-import-alert" style={styles.importAlert}>
            <Ionicons name="checkmark-circle" size={20} color={colors.primaryDark} />
            <Text style={styles.importAlertText}>
              <Text style={styles.importAlertBold}>המתכון יובא. </Text>
              עברו על הפרטים לפני השמירה. בשמירה הוא יסומן ״עוד לא נוסה״ — אפשר לשנות.
            </Text>
          </View>
        ) : null}

        {/* PREVIEW MODE */}
        {isPreview ? (
          <Card style={styles.previewCard}>
            {primaryPreviewPhoto ? (
              <Image
                source={{ uri: primaryPreviewPhoto }}
                style={styles.previewHeroImage}
                contentFit="cover"
              />
            ) : null}

            <Text style={styles.previewTitle}>{state.name.trim() || 'מתכון ללא שם'}</Text>
            {state.description.trim() ? (
              <Text style={styles.previewDescription}>{state.description.trim()}</Text>
            ) : null}

            <View style={styles.previewMetaRow}>
              {state.category ? (
                <Badge label={CATEGORY_MAP[state.category] || state.category} tone="primary" />
              ) : null}
              {state.difficulty ? <Badge label={state.difficulty} tone="neutral" /> : null}
              {Number(state.prepTime) > 0 || Number(state.waitTime) > 0 ? (
                <Badge
                  label={formatCookingTime(
                    calculateTotalTime(Number(state.prepTime) || 0, Number(state.waitTime) || 0),
                  )}
                  tone="neutral"
                />
              ) : null}
              {Number(state.servings) > 0 ? (
                <Badge
                  label={`${state.servings} ${state.servingsUnit.trim() || 'מנות'}`}
                  tone="neutral"
                />
              ) : null}
            </View>

            <View style={styles.previewSection}>
              <Text style={styles.previewSectionTitle}>מצרכים</Text>
              {state.isSectionedIngredients
                ? state.ingredientSections.map((sec) => (
                    <View key={sec.id} style={styles.previewSubGroup}>
                      {sec.title.trim() ? (
                        <Text style={styles.previewSubTitle}>{sec.title.trim()}</Text>
                      ) : null}
                      {sec.items
                        .filter((r) => r.item.trim())
                        .map((r) => (
                          <View key={r.id} style={styles.previewBulletRow}>
                            <Text style={styles.previewBullet}>•</Text>
                            <Text style={styles.previewBodyText}>
                              {r.amount.trim() ? (
                                <Text style={styles.ltrAmount}>
                                  {formatIngredientAmount(parseAmount(r.amount)) ||
                                    r.amount.trim()}{' '}
                                </Text>
                              ) : null}
                              {r.unit.trim() ? `${r.unit.trim()} ` : ''}
                              {r.item.trim()}
                            </Text>
                          </View>
                        ))}
                    </View>
                  ))
                : state.flatIngredients
                    .filter((r) => r.item.trim())
                    .map((r) => (
                      <View key={r.id} style={styles.previewBulletRow}>
                        <Text style={styles.previewBullet}>•</Text>
                        <Text style={styles.previewBodyText}>
                          {r.amount.trim() ? (
                            <Text style={styles.ltrAmount}>
                              {formatIngredientAmount(parseAmount(r.amount)) ||
                                r.amount.trim()}{' '}
                            </Text>
                          ) : null}
                          {r.unit.trim() ? `${r.unit.trim()} ` : ''}
                          {r.item.trim()}
                        </Text>
                      </View>
                    ))}
            </View>

            <View style={styles.previewSection}>
              <Text style={styles.previewSectionTitle}>הוראות הכנה</Text>
              {state.isStagedInstructions
                ? state.stages.map((stg) => (
                    <View key={stg.id} style={styles.previewSubGroup}>
                      {stg.title.trim() ? (
                        <Text style={styles.previewSubTitle}>{stg.title.trim()}</Text>
                      ) : null}
                      {stg.items
                        .filter((r) => r.text.trim())
                        .map((r, idx) => (
                          <View key={r.id} style={styles.previewStepRow}>
                            <View style={styles.stepNumBadge}>
                              <Text style={styles.stepNumText}>{idx + 1}</Text>
                            </View>
                            <Text style={styles.previewBodyText}>{r.text.trim()}</Text>
                          </View>
                        ))}
                    </View>
                  ))
                : state.flatInstructions
                    .filter((r) => r.text.trim())
                    .map((r, idx) => (
                      <View key={r.id} style={styles.previewStepRow}>
                        <View style={styles.stepNumBadge}>
                          <Text style={styles.stepNumText}>{idx + 1}</Text>
                        </View>
                        <Text style={styles.previewBodyText}>{r.text.trim()}</Text>
                      </View>
                    ))}
            </View>

            {state.mediaItems.length > 0 ? (
              <View style={styles.previewSection}>
                <Text style={styles.previewSectionTitle}>הוראות מצולמות</Text>
                {state.mediaItems.map((m) => (
                  <View key={m.id} style={styles.previewMediaCard}>
                    {m.type === 'image' && m.previewUri ? (
                      <Image
                        source={{ uri: m.previewUri }}
                        style={styles.previewMediaImg}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={styles.videoPlaceholder}>
                        <Ionicons name="videocam-outline" size={28} color={colors.primaryDark} />
                        <Text style={styles.previewBodyText}>סרטון שלב הכנה</Text>
                      </View>
                    )}
                    {m.caption.trim() ? (
                      <Text style={styles.previewCaption}>{m.caption.trim()}</Text>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}

            {state.comments.some((c) => c.text.trim()) ? (
              <View style={styles.previewSection}>
                <Text style={styles.previewSectionTitle}>הערות משפחה</Text>
                {state.comments
                  .filter((c) => c.text.trim())
                  .map((c) => (
                    <Text key={c.id} style={styles.previewBodyText}>
                      • {c.text.trim()}
                    </Text>
                  ))}
              </View>
            ) : null}

            {state.attribution.trim() ? (
              <Text style={styles.previewAttribution}>קרדיט: {state.attribution.trim()}</Text>
            ) : null}
          </Card>
        ) : (
          /* EDIT / AUTHORING FORM */
          <View style={styles.formBody}>
            {/* Grouped Problems Summary Banner */}
            {problems.length > 0 ? (
              <View testID="recipe-form-problems" style={styles.problemsBanner}>
                <View style={styles.problemsHeader}>
                  <Ionicons name="alert-circle" size={20} color={colors.secondary} />
                  <Text style={styles.problemsTitle}>
                    נמצאו {problems.length} שדות שדורשים תשומת לב:
                  </Text>
                </View>

                {missingProblems.length > 0 ? (
                  <Text style={styles.problemsLine}>
                    <Text style={styles.problemsBold}>חובה למלא: </Text>
                    {Array.from(new Set(missingProblems.map((p) => p.label))).join(' · ')}
                  </Text>
                ) : null}

                {wrongAndRuleProblems.length > 0 ? (
                  <View style={styles.problemsWrongList}>
                    <Text style={styles.problemsBold}>צריך לתקן:</Text>
                    {wrongAndRuleProblems.map((p) => (
                      <Text key={p.id} style={styles.problemsLine}>
                        • {p.label}
                        {p.explanation ? `: ${p.explanation}` : ''}
                      </Text>
                    ))}
                  </View>
                ) : null}

                <Button
                  testID="recipe-form-jump-problem-btn"
                  label="מעבר לשגיאה הבאה"
                  variant="secondary"
                  size="sm"
                  onPress={handleJumpToNextProblem}
                />
              </View>
            ) : null}

            {/* 01 — פרטי המתכון */}
            <Card style={styles.sectionCardCompact}>
              <View
                style={styles.compactSectionHeader}
                onLayout={(e) => {
                  sectionYRef.current.details = e.nativeEvent.layout.y;
                }}
              >
                <Text style={styles.sectionNumber}>01 — פרטי המתכון</Text>
                <Text style={styles.compactLegendText}>
                  <Text style={styles.reqStar}>*</Text> שדות חובה
                </Text>
              </View>

              {/* Name */}
              <View style={styles.fieldGroupCompact}>
                <Text style={styles.label}>
                  שם המנה <Text style={styles.reqStar}>*</Text>
                </Text>
                <TextInput
                  testID="recipe-form-name"
                  editable={!disabled && !submitting}
                  value={state.name}
                  onChangeText={(text) => {
                    setState((p) => ({ ...p, name: text }));
                    clearErrorKey('name');
                  }}
                  placeholder="שם המתכון..."
                  placeholderTextColor={colors.ink4}
                  returnKeyType="done"
                  style={[styles.inputCompact, fieldErrors.name && styles.inputInvalid]}
                />
                {fieldErrors.name ? (
                  <Text style={styles.fieldError}>{fieldErrors.name}</Text>
                ) : null}
              </View>

              {/* Prep Time, Wait Time & Servings (compact 3-col row right below name, always above keyboard) */}
              <View style={styles.threeColRow}>
                <View style={[styles.fieldGroupCompact, styles.colThird]}>
                  <Text style={styles.label} numberOfLines={1}>
                    זמן הכנה <Text style={styles.reqStar}>*</Text>
                  </Text>
                  <TextInput
                    testID="recipe-form-preptime"
                    editable={!disabled && !submitting}
                    value={state.prepTime}
                    onChangeText={(text) => {
                      setState((p) => ({ ...p, prepTime: text.replace(/[^0-9]/g, '') }));
                      clearErrorKey('prepTime');
                    }}
                    keyboardType="number-pad"
                    returnKeyType="done"
                    placeholder="דקות"
                    placeholderTextColor={colors.ink4}
                    style={[styles.inputCompact, fieldErrors.prepTime && styles.inputInvalid]}
                  />
                  {fieldErrors.prepTime ? (
                    <Text style={styles.fieldError}>{fieldErrors.prepTime}</Text>
                  ) : null}
                </View>

                <View style={[styles.fieldGroupCompact, styles.colThird]}>
                  <Text style={styles.label} numberOfLines={1}>
                    המתנה (דק׳)
                  </Text>
                  <TextInput
                    testID="recipe-form-waittime"
                    editable={!disabled && !submitting}
                    value={state.waitTime}
                    onChangeText={(text) => {
                      setState((p) => ({ ...p, waitTime: text.replace(/[^0-9]/g, '') }));
                      clearErrorKey('waitTime');
                    }}
                    keyboardType="number-pad"
                    returnKeyType="done"
                    placeholder="0"
                    placeholderTextColor={colors.ink4}
                    style={[styles.inputCompact, fieldErrors.waitTime && styles.inputInvalid]}
                  />
                  {fieldErrors.waitTime ? (
                    <Text style={styles.fieldError}>{fieldErrors.waitTime}</Text>
                  ) : null}
                </View>

                <View style={[styles.fieldGroupCompact, styles.colThird]}>
                  <Text style={styles.label} numberOfLines={1}>
                    מנות <Text style={styles.reqStar}>*</Text>
                  </Text>
                  <TextInput
                    testID="recipe-form-servings"
                    editable={!disabled && !submitting}
                    value={state.servings}
                    onChangeText={(text) => {
                      setState((p) => ({ ...p, servings: text.replace(/[^0-9]/g, '') }));
                      clearErrorKey('servings');
                    }}
                    keyboardType="number-pad"
                    returnKeyType="done"
                    placeholder="4"
                    placeholderTextColor={colors.ink4}
                    style={[styles.inputCompact, fieldErrors.servings && styles.inputInvalid]}
                  />
                  {fieldErrors.servings ? (
                    <Text style={styles.fieldError}>{fieldErrors.servings}</Text>
                  ) : null}
                </View>
              </View>

              {/* Category & Difficulty (side-by-side compact row so ingredients & step 1 stay above keyboard) */}
              <View style={styles.catDiffRow}>
                <View style={[styles.fieldGroupCompact, styles.catCol]}>
                  <Text style={styles.label}>
                    קטגוריה <Text style={styles.reqStar}>*</Text>
                  </Text>
                  <PressableScale
                    testID="recipe-form-category"
                    disabled={disabled || submitting}
                    onPress={() => setCategorySheetOpen(true)}
                    style={[
                      styles.selectTriggerCompact,
                      fieldErrors.category && styles.inputInvalid,
                    ]}
                  >
                    <Text
                      style={[
                        styles.selectTriggerText,
                        !state.category && styles.selectPlaceholderText,
                      ]}
                      numberOfLines={1}
                    >
                      {state.category ? CATEGORY_MAP[state.category] : 'בחר קטגוריה'}
                    </Text>
                    <Ionicons name="chevron-down" size={16} color={colors.ink3} />
                  </PressableScale>
                  {fieldErrors.category ? (
                    <Text style={styles.fieldError}>{fieldErrors.category}</Text>
                  ) : null}
                </View>

                <View style={[styles.fieldGroupCompact, styles.diffCol]}>
                  <Text style={styles.label}>
                    דרגת קושי <Text style={styles.reqStar}>*</Text>
                  </Text>
                  <View
                    testID="recipe-form-difficulty"
                    style={[
                      styles.difficultyRow,
                      fieldErrors.difficulty && styles.difficultyRowInvalid,
                    ]}
                  >
                    {DIFFICULTIES.map((diff) => {
                      const selected = state.difficulty === diff;
                      return (
                        <PressableScale
                          key={diff}
                          testID={`recipe-form-difficulty-${diff}`}
                          disabled={disabled || submitting}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          onPress={() => {
                            setState((p) => ({ ...p, difficulty: diff }));
                            clearErrorKey('difficulty');
                          }}
                          style={[styles.diffPillCompact, selected && styles.diffPillSelected]}
                        >
                          <Text
                            style={[styles.diffPillText, selected && styles.diffPillTextSelected]}
                            allowFontScaling={false}
                          >
                            {diff}
                          </Text>
                        </PressableScale>
                      );
                    })}
                  </View>
                  {fieldErrors.difficulty ? (
                    <Text style={styles.fieldError}>{fieldErrors.difficulty}</Text>
                  ) : null}
                </View>
              </View>
            </Card>

            {/* 02 — מצרכים */}
            <View
              onLayout={(e) => {
                sectionYRef.current.ingredients = e.nativeEvent.layout.y;
              }}
            >
              <Card style={styles.sectionCardCompact}>
                <View style={styles.compactSectionHeader}>
                  <Text style={styles.sectionNumber}>02 — מצרכים</Text>
                  <View style={styles.sectionHeaderPills}>
                    {!state.isSectionedIngredients ? (
                      <PressableScale
                        testID="add-ingredient-btn"
                        disabled={disabled || submitting}
                        onPress={() =>
                          setState((p) => ({
                            ...p,
                            flatIngredients: [...p.flatIngredients, emptyIngredientRow()],
                          }))
                        }
                        style={styles.addInlinePill}
                      >
                        <Text style={styles.addInlinePillText} allowFontScaling={false}>
                          + מרכיב
                        </Text>
                      </PressableScale>
                    ) : null}
                    <PressableScale
                      testID="recipe-form-sectioned-toggle"
                      disabled={disabled || submitting}
                      onPress={toggleSectionedIngredients}
                      style={[
                        styles.modeTogglePill,
                        state.isSectionedIngredients && styles.modeToggleBtnActive,
                      ]}
                    >
                      <Ionicons
                        name={state.isSectionedIngredients ? 'layers' : 'list-outline'}
                        size={14}
                        color={
                          state.isSectionedIngredients ? colors.buttonColor : colors.primaryDark
                        }
                      />
                      <Text
                        style={[
                          styles.modeTogglePillText,
                          state.isSectionedIngredients && styles.modeToggleTextActive,
                        ]}
                        allowFontScaling={false}
                      >
                        {state.isSectionedIngredients ? 'רשימה פשוטה' : 'קבץ לקטגוריות'}
                      </Text>
                    </PressableScale>
                  </View>
                </View>

                {fieldErrors.ingredients ? (
                  <Text style={styles.fieldError}>{fieldErrors.ingredients}</Text>
                ) : null}

                {!state.isSectionedIngredients ? (
                  <View style={styles.rowsList}>
                    {state.flatIngredients.map((row, idx) => {
                      const rowKey = `flat-${idx}`;
                      const amountErr = fieldErrors[`${rowKey}.amount`];
                      const itemErr = fieldErrors[`${rowKey}.item`];
                      const amountWarn = blankWarningKeys.has(`${rowKey}.amount`);
                      const unitWarn = blankWarningKeys.has(`${rowKey}.unit`);
                      const globalIdx = ingredientGlobalIdx++;

                      return (
                        <View key={row.id} style={styles.ingredientBlock}>
                          <View style={styles.ingredientRow}>
                            <TextInput
                              testID={`ingredient-input-amount-${globalIdx}`}
                              editable={!disabled && !submitting}
                              value={row.amount}
                              onChangeText={(text) => {
                                setState((p) => ({
                                  ...p,
                                  flatIngredients: p.flatIngredients.map((r, i) =>
                                    i === idx ? { ...r, amount: text } : r,
                                  ),
                                }));
                                clearErrorKey(`${rowKey}.amount`);
                                clearBlankWarningKey(`${rowKey}.amount`);
                              }}
                              placeholder="כמות"
                              placeholderTextColor={colors.ink4}
                              style={[
                                styles.input,
                                styles.ingAmountInput,
                                amountErr && styles.inputInvalid,
                                !amountErr && amountWarn && styles.inputWarning,
                              ]}
                            />

                            <View style={styles.ingUnitWrap}>
                              <TextInput
                                testID={`ingredient-input-unit-${globalIdx}`}
                                editable={!disabled && !submitting}
                                value={row.unit}
                                onChangeText={(text) => {
                                  setState((p) => ({
                                    ...p,
                                    flatIngredients: p.flatIngredients.map((r, i) =>
                                      i === idx ? { ...r, unit: text } : r,
                                    ),
                                  }));
                                  clearBlankWarningKey(`${rowKey}.unit`);
                                }}
                                placeholder="יחידה"
                                placeholderTextColor={colors.ink4}
                                style={[
                                  styles.input,
                                  styles.ingUnitInput,
                                  unitWarn && styles.inputWarning,
                                ]}
                              />
                              <PressableScale
                                variant="icon"
                                disabled={disabled || submitting}
                                accessibilityLabel="בחר יחידת מידה"
                                onPress={() =>
                                  setUnitPickerTarget({ sectionIndex: null, rowIndex: idx })
                                }
                                style={styles.unitQuickBtn}
                              >
                                <Ionicons name="chevron-down" size={14} color={colors.ink3} />
                              </PressableScale>
                            </View>

                            <TextInput
                              testID={`ingredient-input-item-${globalIdx}`}
                              editable={!disabled && !submitting}
                              value={row.item}
                              onChangeText={(text) => {
                                setState((p) => ({
                                  ...p,
                                  flatIngredients: p.flatIngredients.map((r, i) =>
                                    i === idx ? { ...r, item: text } : r,
                                  ),
                                }));
                                clearErrorKey(`${rowKey}.item`);
                                clearErrorKey('ingredients');
                              }}
                              placeholder="פריט"
                              placeholderTextColor={colors.ink4}
                              style={[
                                styles.input,
                                styles.ingItemInput,
                                itemErr && styles.inputInvalid,
                              ]}
                            />

                            {state.flatIngredients.length > 1 ? (
                              <PressableScale
                                variant="icon"
                                disabled={disabled || submitting}
                                accessibilityLabel="הסר מצרך"
                                onPress={() =>
                                  setState((p) => ({
                                    ...p,
                                    flatIngredients: p.flatIngredients.filter((_, i) => i !== idx),
                                  }))
                                }
                                style={styles.removeRowBtn}
                              >
                                <Ionicons name="remove" size={18} color={colors.secondary} />
                              </PressableScale>
                            ) : null}
                          </View>

                          {amountErr ? <Text style={styles.fieldError}>{amountErr}</Text> : null}
                          {itemErr ? <Text style={styles.fieldError}>{itemErr}</Text> : null}
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <View style={styles.sectionsList}>
                    <Text style={styles.hintText}>
                      במצב קטגוריות: חובה למלא עבור כל קטגוריה כותרת ומצרך אחד לפחות (לפחות 2
                      קטגוריות).
                    </Text>

                    {state.ingredientSections.map((sec, sIdx) => (
                      <View key={sec.id} style={styles.subSectionCard}>
                        <View style={styles.subSectionHeader}>
                          <TextInput
                            testID={`ingredient-section-title-${sIdx}`}
                            editable={!disabled && !submitting}
                            value={sec.title}
                            onChangeText={(text) => {
                              setState((p) => ({
                                ...p,
                                ingredientSections: p.ingredientSections.map((s, i) =>
                                  i === sIdx ? { ...s, title: text } : s,
                                ),
                              }));
                              clearErrorKey(`sec-${sIdx}.title`);
                              clearErrorKey('ingredients');
                            }}
                            placeholder={`שם קטגוריה ${sIdx + 1} (למשל: לבצק)`}
                            placeholderTextColor={colors.ink4}
                            style={[
                              styles.input,
                              styles.subSectionTitleInput,
                              fieldErrors[`sec-${sIdx}.title`] && styles.inputInvalid,
                            ]}
                          />
                          {state.ingredientSections.length > MIN_SECTIONS ? (
                            <PressableScale
                              variant="icon"
                              disabled={disabled || submitting}
                              accessibilityLabel="מחק קטגוריה"
                              onPress={() =>
                                setState((p) => ({
                                  ...p,
                                  ingredientSections: p.ingredientSections.filter(
                                    (_, i) => i !== sIdx,
                                  ),
                                }))
                              }
                              style={styles.removeRowBtn}
                            >
                              <Ionicons name="trash-outline" size={16} color={colors.secondary} />
                            </PressableScale>
                          ) : null}
                        </View>
                        {fieldErrors[`sec-${sIdx}.title`] ? (
                          <Text style={styles.fieldError}>{fieldErrors[`sec-${sIdx}.title`]}</Text>
                        ) : null}
                        {fieldErrors[`sec-${sIdx}.items`] ? (
                          <Text style={styles.fieldError}>{fieldErrors[`sec-${sIdx}.items`]}</Text>
                        ) : null}

                        {sec.items.map((row, rIdx) => {
                          const rowKey = `sec-${sIdx}-row-${rIdx}`;
                          const amountErr = fieldErrors[`${rowKey}.amount`];
                          const itemErr = fieldErrors[`${rowKey}.item`];
                          const amountWarn = blankWarningKeys.has(`${rowKey}.amount`);
                          const unitWarn = blankWarningKeys.has(`${rowKey}.unit`);
                          const globalIdx = ingredientGlobalIdx++;

                          return (
                            <View key={row.id} style={styles.ingredientBlock}>
                              <View style={styles.ingredientRow}>
                                <TextInput
                                  testID={`ingredient-input-amount-${globalIdx}`}
                                  editable={!disabled && !submitting}
                                  value={row.amount}
                                  onChangeText={(text) => {
                                    setState((p) => ({
                                      ...p,
                                      ingredientSections: p.ingredientSections.map((s, si) =>
                                        si === sIdx
                                          ? {
                                              ...s,
                                              items: s.items.map((r, ri) =>
                                                ri === rIdx ? { ...r, amount: text } : r,
                                              ),
                                            }
                                          : s,
                                      ),
                                    }));
                                    clearErrorKey(`${rowKey}.amount`);
                                    clearBlankWarningKey(`${rowKey}.amount`);
                                  }}
                                  placeholder="כמות"
                                  placeholderTextColor={colors.ink4}
                                  style={[
                                    styles.input,
                                    styles.ingAmountInput,
                                    amountErr && styles.inputInvalid,
                                    !amountErr && amountWarn && styles.inputWarning,
                                  ]}
                                />
                                <View style={styles.ingUnitWrap}>
                                  <TextInput
                                    testID={`ingredient-input-unit-${globalIdx}`}
                                    editable={!disabled && !submitting}
                                    value={row.unit}
                                    onChangeText={(text) => {
                                      setState((p) => ({
                                        ...p,
                                        ingredientSections: p.ingredientSections.map((s, si) =>
                                          si === sIdx
                                            ? {
                                                ...s,
                                                items: s.items.map((r, ri) =>
                                                  ri === rIdx ? { ...r, unit: text } : r,
                                                ),
                                              }
                                            : s,
                                        ),
                                      }));
                                      clearBlankWarningKey(`${rowKey}.unit`);
                                    }}
                                    placeholder="יחידה"
                                    placeholderTextColor={colors.ink4}
                                    style={[
                                      styles.input,
                                      styles.ingUnitInput,
                                      unitWarn && styles.inputWarning,
                                    ]}
                                  />
                                  <PressableScale
                                    variant="icon"
                                    disabled={disabled || submitting}
                                    accessibilityLabel="בחר יחידת מידה"
                                    onPress={() =>
                                      setUnitPickerTarget({ sectionIndex: sIdx, rowIndex: rIdx })
                                    }
                                    style={styles.unitQuickBtn}
                                  >
                                    <Ionicons name="chevron-down" size={14} color={colors.ink3} />
                                  </PressableScale>
                                </View>
                                <TextInput
                                  testID={`ingredient-input-item-${globalIdx}`}
                                  editable={!disabled && !submitting}
                                  value={row.item}
                                  onChangeText={(text) => {
                                    setState((p) => ({
                                      ...p,
                                      ingredientSections: p.ingredientSections.map((s, si) =>
                                        si === sIdx
                                          ? {
                                              ...s,
                                              items: s.items.map((r, ri) =>
                                                ri === rIdx ? { ...r, item: text } : r,
                                              ),
                                            }
                                          : s,
                                      ),
                                    }));
                                    clearErrorKey(`${rowKey}.item`);
                                    clearErrorKey(`sec-${sIdx}.items`);
                                    clearErrorKey('ingredients');
                                  }}
                                  placeholder="פריט"
                                  placeholderTextColor={colors.ink4}
                                  style={[
                                    styles.input,
                                    styles.ingItemInput,
                                    itemErr && styles.inputInvalid,
                                  ]}
                                />
                                {sec.items.length > 1 ? (
                                  <PressableScale
                                    variant="icon"
                                    disabled={disabled || submitting}
                                    accessibilityLabel="הסר מצרך"
                                    onPress={() =>
                                      setState((p) => ({
                                        ...p,
                                        ingredientSections: p.ingredientSections.map((s, si) =>
                                          si === sIdx
                                            ? {
                                                ...s,
                                                items: s.items.filter((_, ri) => ri !== rIdx),
                                              }
                                            : s,
                                        ),
                                      }))
                                    }
                                    style={styles.removeRowBtn}
                                  >
                                    <Ionicons name="remove" size={18} color={colors.secondary} />
                                  </PressableScale>
                                ) : null}
                              </View>
                              {amountErr ? (
                                <Text style={styles.fieldError}>{amountErr}</Text>
                              ) : null}
                              {itemErr ? <Text style={styles.fieldError}>{itemErr}</Text> : null}
                            </View>
                          );
                        })}

                        <Button
                          testID={sIdx === 0 ? 'add-ingredient-btn' : `add-ingredient-sec-${sIdx}`}
                          label="+ הוסף מרכיב לקטגוריה"
                          variant="ghost"
                          size="sm"
                          disabled={disabled || submitting}
                          onPress={() =>
                            setState((p) => ({
                              ...p,
                              ingredientSections: p.ingredientSections.map((s, si) =>
                                si === sIdx
                                  ? { ...s, items: [...s.items, emptyIngredientRow()] }
                                  : s,
                              ),
                            }))
                          }
                        />
                      </View>
                    ))}

                    <Button
                      testID="add-ingredient-section-btn"
                      label="+ הוסף קטגוריה"
                      variant="secondary"
                      size="sm"
                      disabled={disabled || submitting}
                      onPress={() =>
                        setState((p) => ({
                          ...p,
                          ingredientSections: [...p.ingredientSections, emptyIngredientSection()],
                        }))
                      }
                    />
                  </View>
                )}
              </Card>
            </View>

            {/* 03 — הוראות הכנה */}
            <View
              onLayout={(e) => {
                sectionYRef.current.instructions = e.nativeEvent.layout.y;
              }}
            >
              <Card style={styles.sectionCardCompact}>
                <View style={styles.compactSectionHeader}>
                  <Text style={styles.sectionNumber}>03 — הוראות הכנה</Text>
                  <PressableScale
                    testID="recipe-form-staged-toggle"
                    disabled={disabled || submitting}
                    onPress={toggleStagedInstructions}
                    style={[
                      styles.modeTogglePill,
                      state.isStagedInstructions && styles.modeToggleBtnActive,
                    ]}
                  >
                    <Ionicons
                      name={state.isStagedInstructions ? 'layers' : 'list-outline'}
                      size={14}
                      color={state.isStagedInstructions ? colors.buttonColor : colors.primaryDark}
                    />
                    <Text
                      style={[
                        styles.modeTogglePillText,
                        state.isStagedInstructions && styles.modeToggleTextActive,
                      ]}
                      allowFontScaling={false}
                    >
                      {state.isStagedInstructions ? 'רשימה פשוטה' : 'חלק לשלבים'}
                    </Text>
                  </PressableScale>
                </View>

                {fieldErrors.instructions ? (
                  <Text style={styles.fieldError}>{fieldErrors.instructions}</Text>
                ) : null}

                {!state.isStagedInstructions ? (
                  <View style={styles.rowsList}>
                    {state.flatInstructions.map((row, idx) => {
                      const globalIdx = instructionGlobalIdx++;
                      return (
                        <View key={row.id} style={styles.stepRow}>
                          <View style={styles.stepNumBadge}>
                            <Text style={styles.stepNumText}>{idx + 1}</Text>
                          </View>
                          <TextInput
                            testID={`instruction-input-${globalIdx}`}
                            editable={!disabled && !submitting}
                            value={row.text}
                            onChangeText={(text) => {
                              setState((p) => ({
                                ...p,
                                flatInstructions: p.flatInstructions.map((r, i) =>
                                  i === idx ? { ...r, text } : r,
                                ),
                              }));
                              clearErrorKey('instructions');
                              clearErrorKey(`step-${idx}`);
                            }}
                            placeholder={`שלב ${idx + 1}...`}
                            placeholderTextColor={colors.ink4}
                            multiline
                            style={[
                              styles.input,
                              styles.stepInput,
                              fieldErrors[`step-${idx}`] && styles.inputInvalid,
                            ]}
                          />
                          {state.flatInstructions.length > 1 ? (
                            <PressableScale
                              variant="icon"
                              disabled={disabled || submitting}
                              accessibilityLabel="הסר שלב"
                              onPress={() =>
                                setState((p) => ({
                                  ...p,
                                  flatInstructions: p.flatInstructions.filter((_, i) => i !== idx),
                                }))
                              }
                              style={styles.removeRowBtn}
                            >
                              <Ionicons name="remove" size={18} color={colors.secondary} />
                            </PressableScale>
                          ) : null}
                        </View>
                      );
                    })}

                    <Button
                      testID="add-instruction-btn"
                      label="+ הוסף שלב"
                      variant="secondary"
                      size="sm"
                      disabled={disabled || submitting}
                      onPress={() =>
                        setState((p) => ({
                          ...p,
                          flatInstructions: [...p.flatInstructions, emptyInstructionRow()],
                        }))
                      }
                    />
                  </View>
                ) : (
                  <View style={styles.sectionsList}>
                    <Text style={styles.hintText}>
                      במצב שלבים: חובה למלא עבור כל שלב כותרת והוראה אחת לפחות (לפחות 2 שלבים).
                    </Text>

                    {state.stages.map((stg, sIdx) => (
                      <View key={stg.id} style={styles.subSectionCard}>
                        <View style={styles.subSectionHeader}>
                          <TextInput
                            testID={`stage-title-${sIdx}`}
                            editable={!disabled && !submitting}
                            value={stg.title}
                            onChangeText={(text) => {
                              setState((p) => ({
                                ...p,
                                stages: p.stages.map((s, i) =>
                                  i === sIdx ? { ...s, title: text } : s,
                                ),
                              }));
                              clearErrorKey(`stg-${sIdx}.title`);
                              clearErrorKey('instructions');
                            }}
                            placeholder={`שם שלב ${sIdx + 1}`}
                            placeholderTextColor={colors.ink4}
                            style={[
                              styles.input,
                              styles.subSectionTitleInput,
                              fieldErrors[`stg-${sIdx}.title`] && styles.inputInvalid,
                            ]}
                          />
                          {state.stages.length > MIN_SECTIONS ? (
                            <PressableScale
                              variant="icon"
                              disabled={disabled || submitting}
                              accessibilityLabel="מחק שלב עבודה"
                              onPress={() =>
                                setState((p) => ({
                                  ...p,
                                  stages: p.stages.filter((_, i) => i !== sIdx),
                                }))
                              }
                              style={styles.removeRowBtn}
                            >
                              <Ionicons name="trash-outline" size={16} color={colors.secondary} />
                            </PressableScale>
                          ) : null}
                        </View>
                        {fieldErrors[`stg-${sIdx}.title`] ? (
                          <Text style={styles.fieldError}>{fieldErrors[`stg-${sIdx}.title`]}</Text>
                        ) : null}
                        {fieldErrors[`stg-${sIdx}.items`] ? (
                          <Text style={styles.fieldError}>{fieldErrors[`stg-${sIdx}.items`]}</Text>
                        ) : null}

                        {stg.items.map((row, rIdx) => {
                          const globalIdx = instructionGlobalIdx++;
                          return (
                            <View key={row.id} style={styles.stepRow}>
                              <View style={styles.stepNumBadge}>
                                <Text style={styles.stepNumText}>{rIdx + 1}</Text>
                              </View>
                              <TextInput
                                testID={`instruction-input-${globalIdx}`}
                                editable={!disabled && !submitting}
                                value={row.text}
                                onChangeText={(text) => {
                                  setState((p) => ({
                                    ...p,
                                    stages: p.stages.map((s, si) =>
                                      si === sIdx
                                        ? {
                                            ...s,
                                            items: s.items.map((r, ri) =>
                                              ri === rIdx ? { ...r, text } : r,
                                            ),
                                          }
                                        : s,
                                    ),
                                  }));
                                  clearErrorKey(`stg-${sIdx}.items`);
                                  clearErrorKey('instructions');
                                }}
                                placeholder={`הוראה ${rIdx + 1}...`}
                                placeholderTextColor={colors.ink4}
                                multiline
                                style={[styles.input, styles.stepInput]}
                              />
                              {stg.items.length > 1 ? (
                                <PressableScale
                                  variant="icon"
                                  disabled={disabled || submitting}
                                  accessibilityLabel="הסר הוראה"
                                  onPress={() =>
                                    setState((p) => ({
                                      ...p,
                                      stages: p.stages.map((s, si) =>
                                        si === sIdx
                                          ? {
                                              ...s,
                                              items: s.items.filter((_, ri) => ri !== rIdx),
                                            }
                                          : s,
                                      ),
                                    }))
                                  }
                                  style={styles.removeRowBtn}
                                >
                                  <Ionicons name="remove" size={18} color={colors.secondary} />
                                </PressableScale>
                              ) : null}
                            </View>
                          );
                        })}

                        <Button
                          testID={
                            sIdx === 0 ? 'add-instruction-btn' : `add-instruction-stg-${sIdx}`
                          }
                          label="+ הוסף הוראה לשלב"
                          variant="ghost"
                          size="sm"
                          disabled={disabled || submitting}
                          onPress={() =>
                            setState((p) => ({
                              ...p,
                              stages: p.stages.map((s, si) =>
                                si === sIdx
                                  ? { ...s, items: [...s.items, emptyInstructionRow()] }
                                  : s,
                              ),
                            }))
                          }
                        />
                      </View>
                    ))}

                    <Button
                      testID="add-stage-btn"
                      label="+ הוסף שלב עבודה"
                      variant="secondary"
                      size="sm"
                      disabled={disabled || submitting}
                      onPress={() =>
                        setState((p) => ({ ...p, stages: [...p.stages, emptyStage()] }))
                      }
                    />
                  </View>
                )}
              </Card>
            </View>

            {/* Optional Metadata Details (placed after core required sections) */}
            <Card style={styles.sectionCard}>
              <Text style={styles.sectionNumber}>פרטים נוספים (אופציונלי)</Text>

              <View style={styles.twoColRow}>
                <View style={[styles.fieldGroup, styles.colHalf]}>
                  <Text style={styles.label}>מרכיב עיקרי</Text>
                  <TextInput
                    testID="recipe-form-main-ingredient"
                    editable={!disabled && !submitting}
                    value={state.mainIngredient}
                    onChangeText={(text) => setState((p) => ({ ...p, mainIngredient: text }))}
                    placeholder="עוף, בצק, גבינה..."
                    placeholderTextColor={colors.ink4}
                    style={styles.input}
                  />
                </View>

                <View style={[styles.fieldGroup, styles.colHalf]}>
                  <Text style={styles.label}>יחידת כמות</Text>
                  <TextInput
                    testID="recipe-form-servings-unit"
                    editable={!disabled && !submitting}
                    value={state.servingsUnit}
                    onChangeText={(text) => setState((p) => ({ ...p, servingsUnit: text }))}
                    placeholder="מנות, כיכרות..."
                    placeholderTextColor={colors.ink4}
                    style={styles.input}
                  />
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>תיאור קצר</Text>
                <TextInput
                  testID="recipe-form-description"
                  editable={!disabled && !submitting}
                  value={state.description}
                  onChangeText={(text) => setState((p) => ({ ...p, description: text }))}
                  placeholder="משפט-שניים. יוצג על כרטיס המתכון."
                  placeholderTextColor={colors.ink4}
                  multiline
                  numberOfLines={3}
                  style={[styles.input, styles.multilineInput]}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>תגיות</Text>
                <TextInput
                  testID="recipe-form-tags"
                  editable={!disabled && !submitting}
                  value={state.tagsText}
                  onChangeText={(text) => setState((p) => ({ ...p, tagsText: text }))}
                  placeholder="פסח, שבת, טבעוני..."
                  placeholderTextColor={colors.ink4}
                  style={styles.input}
                />
                <Text style={styles.hintText}>מופרדות בפסיק.</Text>
              </View>
            </Card>

            {/* 04 — תמונות ומדיה */}
            <Card style={styles.sectionCard}>
              <Text style={styles.sectionNumber}>04 — תמונות ומדיה</Text>
              <Text style={styles.sectionTitle}>התמונה הסופית.</Text>
              <Text style={styles.sectionSub}>
                עד {MAX_PHOTOS} תמונות (JPG, PNG, WebP · עד 5MB לתמונה). ניתן לבחור תמונה ראשית.
              </Text>

              {assetError ? <Text style={styles.fieldError}>{assetError}</Text> : null}

              {/* Recipe Photos */}
              {state.images.length > 0 ? (
                <View style={styles.photosGrid}>
                  {state.images.map((img, idx) => (
                    <View key={img.id} testID={`photo-thumb-${idx}`} style={styles.photoCard}>
                      <View style={styles.photoImageWrap}>
                        {img.previewUri ? (
                          <Image
                            source={{ uri: img.previewUri }}
                            style={styles.photoThumb}
                            contentFit="cover"
                          />
                        ) : (
                          <View style={styles.photoPlaceholder}>
                            <Ionicons name="image-outline" size={24} color={colors.ink4} />
                          </View>
                        )}
                        {img.isPrimary ? (
                          <View style={styles.primaryTag}>
                            <Text style={styles.primaryTagText} allowFontScaling={false}>
                              ראשית
                            </Text>
                          </View>
                        ) : null}
                      </View>

                      <View style={styles.photoActionsRow}>
                        {!img.isPrimary ? (
                          <PressableScale
                            disabled={disabled || submitting}
                            onPress={() => setPrimaryPhoto(img.id)}
                            style={styles.photoSmallAction}
                          >
                            <Text style={styles.photoSmallActionText} allowFontScaling={false}>
                              הגדר כראשית
                            </Text>
                          </PressableScale>
                        ) : null}
                        <PressableScale
                          variant="icon"
                          disabled={disabled || submitting || idx === 0}
                          onPress={() => movePhoto(idx, -1)}
                          accessibilityLabel="הזז קדימה"
                          style={[styles.miniIconBtn, idx === 0 && styles.controlDisabled]}
                        >
                          <Ionicons name="arrow-up" size={14} color={colors.ink2} />
                        </PressableScale>
                        <PressableScale
                          variant="icon"
                          disabled={disabled || submitting || idx === state.images.length - 1}
                          onPress={() => movePhoto(idx, 1)}
                          accessibilityLabel="הזז אחורה"
                          style={[
                            styles.miniIconBtn,
                            idx === state.images.length - 1 && styles.controlDisabled,
                          ]}
                        >
                          <Ionicons name="arrow-down" size={14} color={colors.ink2} />
                        </PressableScale>
                        <PressableScale
                          variant="icon"
                          disabled={disabled || submitting}
                          onPress={() => removePhoto(idx)}
                          accessibilityLabel="הסר תמונה"
                          style={styles.miniIconBtnDanger}
                        >
                          <Ionicons name="trash-outline" size={14} color={colors.secondary} />
                        </PressableScale>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}

              <Button
                testID="add-photo-btn"
                label={
                  state.images.length >= MAX_PHOTOS
                    ? `הגעת למקסימום (${MAX_PHOTOS} תמונות)`
                    : `+ הוסף תמונה (${state.images.length}/${MAX_PHOTOS})`
                }
                variant="outline"
                size="sm"
                disabled={disabled || submitting || state.images.length >= MAX_PHOTOS}
                onPress={() => setPhotoSourceSheetOpen(true)}
                icon={<Ionicons name="camera-outline" size={16} color={colors.primaryDark} />}
              />

              {/* Step Media Instructions */}
              <View style={styles.mediaDivider} />
              <Text style={styles.label}>הוראות מצולמות</Text>
              <Text style={styles.hintText}>
                הוסיפו תמונות או סרטונים המדגימים שלבי הכנה (עד 50MB לקובץ).
              </Text>

              {state.mediaItems.map((item, idx) => (
                <View key={item.id} style={styles.stepMediaCard}>
                  <View style={styles.stepMediaTop}>
                    <View style={styles.stepMediaThumbWrap}>
                      {item.type === 'image' && item.previewUri ? (
                        <Image
                          source={{ uri: item.previewUri }}
                          style={styles.stepMediaThumb}
                          contentFit="cover"
                        />
                      ) : (
                        <View style={styles.stepMediaVideoBadge}>
                          <Ionicons name="videocam" size={22} color={colors.primaryDark} />
                        </View>
                      )}
                    </View>

                    <View style={styles.stepMediaInfo}>
                      <Badge label={item.type === 'video' ? 'סרטון' : 'תמונה'} tone="neutral" />
                      <TextInput
                        editable={!disabled && !submitting}
                        value={item.caption}
                        onChangeText={(text) =>
                          setState((p) => ({
                            ...p,
                            mediaItems: p.mediaItems.map((m, i) =>
                              i === idx ? { ...m, caption: text } : m,
                            ),
                          }))
                        }
                        placeholder="כיתוב לשלב (אופציונלי)..."
                        placeholderTextColor={colors.ink4}
                        style={[styles.input, styles.captionInput]}
                      />
                    </View>
                  </View>

                  <View style={styles.photoActionsRow}>
                    <PressableScale
                      variant="icon"
                      disabled={disabled || submitting || idx === 0}
                      onPress={() => moveMediaItem(idx, -1)}
                      accessibilityLabel="הזז מדיה למעלה"
                      style={[styles.miniIconBtn, idx === 0 && styles.controlDisabled]}
                    >
                      <Ionicons name="arrow-up" size={14} color={colors.ink2} />
                    </PressableScale>
                    <PressableScale
                      variant="icon"
                      disabled={disabled || submitting || idx === state.mediaItems.length - 1}
                      onPress={() => moveMediaItem(idx, 1)}
                      accessibilityLabel="הזז מדיה למטה"
                      style={[
                        styles.miniIconBtn,
                        idx === state.mediaItems.length - 1 && styles.controlDisabled,
                      ]}
                    >
                      <Ionicons name="arrow-down" size={14} color={colors.ink2} />
                    </PressableScale>
                    <PressableScale
                      variant="icon"
                      disabled={disabled || submitting}
                      onPress={() => removeMediaItem(idx)}
                      accessibilityLabel="הסר מדיה"
                      style={styles.miniIconBtnDanger}
                    >
                      <Ionicons name="trash-outline" size={14} color={colors.secondary} />
                    </PressableScale>
                  </View>
                </View>
              ))}

              <Button
                testID="add-step-media-btn"
                label="+ הוסף תמונה או סרטון לשלב"
                variant="secondary"
                size="sm"
                disabled={disabled || submitting}
                onPress={handleAddStepMedia}
                icon={<Ionicons name="videocam-outline" size={16} color={colors.ink} />}
              />
            </Card>

            {/* 05 — הערות משפחה */}
            <Card style={styles.sectionCard}>
              <Text style={styles.sectionNumber}>05 — הערות משפחה</Text>
              <Text style={styles.sectionTitle}>טיפים ווריאציות.</Text>
              <Text style={styles.sectionSub}>
                דברים שהייתם אומרים למישהו שמבשל את זה בפעם הראשונה (אופציונלי).
              </Text>

              {state.comments.map((cmt, idx) => (
                <View key={cmt.id} style={styles.stepRow}>
                  <TextInput
                    editable={!disabled && !submitting}
                    value={cmt.text}
                    onChangeText={(text) =>
                      setState((p) => ({
                        ...p,
                        comments: p.comments.map((c, i) => (i === idx ? { ...c, text } : c)),
                      }))
                    }
                    placeholder="הערה או טיפ..."
                    placeholderTextColor={colors.ink4}
                    multiline
                    style={[styles.input, styles.stepInput]}
                  />
                  <PressableScale
                    variant="icon"
                    disabled={disabled || submitting}
                    accessibilityLabel="הסר הערה"
                    onPress={() =>
                      setState((p) => ({
                        ...p,
                        comments: p.comments.filter((_, i) => i !== idx),
                      }))
                    }
                    style={styles.removeRowBtn}
                  >
                    <Ionicons name="remove" size={18} color={colors.secondary} />
                  </PressableScale>
                </View>
              ))}

              <Button
                label="+ הוסף הערה"
                variant="secondary"
                size="sm"
                disabled={disabled || submitting}
                onPress={() =>
                  setState((p) => ({
                    ...p,
                    comments: [...p.comments, { id: nextKey('cmt'), text: '' }],
                  }))
                }
              />
            </Card>

            {/* 06 — קרדיט */}
            <Card style={styles.sectionCard}>
              <Text style={styles.sectionNumber}>06 — קרדיט</Text>
              <Text style={styles.sectionTitle}>של מי המתכון הזה?</Text>
              <Text style={styles.sectionSub}>קרדיט לטבח המקורי — שם, קישור, או שניהם.</Text>

              <TextInput
                testID="recipe-form-attribution"
                editable={!disabled && !submitting}
                value={state.attribution}
                onChangeText={(text) => setState((p) => ({ ...p, attribution: text }))}
                placeholder="סבתא רות · או https://..."
                placeholderTextColor={colors.ink4}
                style={styles.input}
              />
            </Card>

            {/* 07 — מתכונים קשורים */}
            <Card style={styles.sectionCard}>
              <Text style={styles.sectionNumber}>07 — מתכונים קשורים</Text>
              <Text style={styles.sectionTitle}>מתכונים משלימים.</Text>
              <Text style={styles.sectionSub}>
                קשרו עד {MAX_RELATED_RECIPES} מתכונים מפורסמים שמשתלבים יחד (אופציונלי).
              </Text>

              {state.relatedRecipes.length > 0 ? (
                <View style={styles.relatedChipsWrap}>
                  {state.relatedRecipes.map((rid) => {
                    const matched = publishedRecipes.find((r) => r.id === rid);
                    return (
                      <View key={rid} style={styles.relatedChip}>
                        <Text style={styles.relatedChipText} numberOfLines={1}>
                          {matched?.name || rid}
                        </Text>
                        <PressableScale
                          variant="icon"
                          disabled={disabled || submitting}
                          accessibilityLabel="הסר מתכון קשור"
                          onPress={() => toggleRelatedRecipe(rid)}
                        >
                          <Ionicons name="close-circle" size={18} color={colors.ink3} />
                        </PressableScale>
                      </View>
                    );
                  })}
                </View>
              ) : null}

              <Button
                testID="add-related-recipe-btn"
                label={`+ קשר מתכון (${state.relatedRecipes.length}/${MAX_RELATED_RECIPES})`}
                variant="secondary"
                size="sm"
                disabled={
                  disabled || submitting || state.relatedRecipes.length >= MAX_RELATED_RECIPES
                }
                onPress={() => {
                  setRelatedSearch('');
                  setRelatedSheetOpen(true);
                  void loadPublishedRecipes();
                }}
              />
            </Card>
          </View>
        )}
      </ScrollView>

      {/* Sticky Bottom Actions Bar (always accessible without scrolling past optional sections) */}
      {!hideActions ? (
        <View style={styles.bottomActionsSticky}>
          <Button
            testID="recipe-form-clear-btn"
            label={clearLabel}
            variant="secondary"
            size="sm"
            disabled={disabled || submitting || isPreview}
            onPress={requestClear}
            style={styles.clearActionBtn}
          />
          <Button
            testID="recipe-form-submit-btn"
            label={submitLabel}
            variant="primary"
            size="sm"
            loading={submitting}
            disabled={disabled || isPreview}
            onPress={handleSubmitPress}
            style={styles.submitActionBtn}
          />
        </View>
      ) : null}

      {/* Category Picker Sheet */}
      <ModalSheet
        visible={categorySheetOpen}
        title="בחירת קטגוריה"
        onClose={() => setCategorySheetOpen(false)}
      >
        <View style={styles.sheetOptionsList}>
          {CATEGORY_IDS.map((catId) => {
            const selected = state.category === catId;
            return (
              <PressableScale
                key={catId}
                testID={`recipe-form-category-option-${catId}`}
                onPress={() => {
                  setState((p) => ({ ...p, category: catId }));
                  clearErrorKey('category');
                  setCategorySheetOpen(false);
                }}
                style={[styles.sheetOptionRow, selected && styles.sheetOptionRowSelected]}
              >
                <Text style={[styles.sheetOptionText, selected && styles.sheetOptionTextSelected]}>
                  {CATEGORY_MAP[catId]}
                </Text>
                {selected ? (
                  <Ionicons name="checkmark-circle" size={20} color={colors.primaryDark} />
                ) : null}
              </PressableScale>
            );
          })}
        </View>
      </ModalSheet>

      {/* Curated Hebrew Units Quick Picker */}
      <ModalSheet
        visible={unitPickerTarget !== null}
        title="בחירת יחידת מידה"
        onClose={() => setUnitPickerTarget(null)}
      >
        <View style={styles.unitsGrid}>
          {HEBREW_UNITS.map((u) => (
            <Chip
              key={u}
              label={u}
              onPress={() => {
                if (!unitPickerTarget) return;
                const { sectionIndex, rowIndex } = unitPickerTarget;
                if (sectionIndex === null) {
                  setState((p) => ({
                    ...p,
                    flatIngredients: p.flatIngredients.map((r, i) =>
                      i === rowIndex ? { ...r, unit: u } : r,
                    ),
                  }));
                  clearBlankWarningKey(`flat-${rowIndex}.unit`);
                } else {
                  setState((p) => ({
                    ...p,
                    ingredientSections: p.ingredientSections.map((s, si) =>
                      si === sectionIndex
                        ? {
                            ...s,
                            items: s.items.map((r, ri) =>
                              ri === rowIndex ? { ...r, unit: u } : r,
                            ),
                          }
                        : s,
                    ),
                  }));
                  clearBlankWarningKey(`sec-${sectionIndex}-row-${rowIndex}.unit`);
                }
                setUnitPickerTarget(null);
              }}
            />
          ))}
        </View>
      </ModalSheet>

      {/* Photo Source Picker Sheet */}
      <ModalSheet
        visible={photoSourceSheetOpen}
        title="הוספת תמונה למתכון"
        onClose={() => setPhotoSourceSheetOpen(false)}
        scrollable={false}
      >
        <View style={styles.photoSourceActions}>
          <Button
            testID="photo-source-gallery-btn"
            label="בחירה מהגלריה"
            variant="primary"
            fullWidth
            onPress={handlePickPhotoLibrary}
            icon={<Ionicons name="images-outline" size={18} color={colors.buttonColor} />}
          />
          <Button
            testID="photo-source-camera-btn"
            label="צילום במצלמה"
            variant="secondary"
            fullWidth
            onPress={handlePickPhotoCamera}
            icon={<Ionicons name="camera-outline" size={18} color={colors.ink} />}
          />
        </View>
      </ModalSheet>

      {/* Related Recipes Picker Sheet */}
      <ModalSheet
        visible={relatedSheetOpen}
        title="בחירת מתכונים קשורים"
        onClose={() => setRelatedSheetOpen(false)}
      >
        <View style={styles.relatedSheetBody}>
          <TextInput
            value={relatedSearch}
            onChangeText={setRelatedSearch}
            placeholder="חיפוש מתכון מפורסם..."
            placeholderTextColor={colors.ink4}
            style={styles.input}
          />
          {loadingPublished ? (
            <ActivityIndicator size="small" color={colors.primary} style={styles.sheetSpinner} />
          ) : filteredPublished.length === 0 ? (
            <Text style={styles.hintText}>לא נמצאו מתכונים מפורסמים תואמים.</Text>
          ) : (
            filteredPublished.slice(0, 40).map((recipe) => {
              const selected = state.relatedRecipes.includes(recipe.id);
              const atLimit = !selected && state.relatedRecipes.length >= MAX_RELATED_RECIPES;
              return (
                <PressableScale
                  key={recipe.id}
                  disabled={atLimit}
                  onPress={() => toggleRelatedRecipe(recipe.id)}
                  style={[
                    styles.sheetOptionRow,
                    selected && styles.sheetOptionRowSelected,
                    atLimit && styles.controlDisabled,
                  ]}
                >
                  <View style={styles.relatedOptionCol}>
                    <Text style={styles.sheetOptionText}>{recipe.name}</Text>
                    {recipe.category ? (
                      <Text style={styles.hintText}>
                        {getLocalizedCategoryName(recipe.category)}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons
                    name={selected ? 'checkmark-circle' : 'add-circle-outline'}
                    size={22}
                    color={selected ? colors.primaryDark : colors.ink3}
                  />
                </PressableScale>
              );
            })
          )}
        </View>
      </ModalSheet>

      {/* One-Time Blank Amount/Unit Confirmation Dialog */}
      <ConfirmDialog
        visible={blankDialog !== null}
        title="כמות או יחידה חסרים"
        message={blankDialog ? buildBlankFieldsMessage(blankDialog.rows) : ''}
        confirmLabel="המשך בכל זאת"
        cancelLabel="בדיקת השדות"
        confirmTestID="blank-fields-continue-btn"
        cancelTestID="blank-fields-review-btn"
        onConfirm={() => {
          if (!blankDialog) return;
          const pending = blankDialog.pendingData;
          setBlankDialog(null);
          setBlankWarningKeys(new Set());
          void onSubmit(pending);
        }}
        onCancel={() => {
          if (!blankDialog) return;
          const nextWarn = new Set<string>();
          blankDialog.rows.forEach((row) => {
            row.fields.forEach((f) => nextWarn.add(`${row.rowKey}.${f}`));
          });
          setBlankWarningKeys(nextWarn);
          setBlankDialog(null);
          scrollRef.current?.scrollTo({
            y: Math.max(0, sectionYRef.current.ingredients - 16),
            animated: true,
          });
        }}
      />

      {/* Dirty Clear Confirmation Dialog */}
      <ConfirmDialog
        visible={clearConfirmOpen}
        title="נקה טופס"
        message="יש לך שינויים שלא נשמרו שיאבדו. האם אתה בטוח שברצונך לנקות את הטופס?"
        confirmLabel="נקה טופס"
        cancelLabel="ביטול"
        destructive
        onConfirm={() => {
          setClearConfirmOpen(false);
          doResetInitial();
        }}
        onCancel={() => setClearConfirmOpen(false)}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  topToolbar: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    backgroundColor: colors.surface0,
  },
  toolbarBtn: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: 6,
    paddingBottom: spacing['2xl'] + 24,
    gap: 8,
  },
  importAlert: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: statusColors.approvedBg,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  importAlertText: {
    flex: 1,
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.body,
    color: colors.ink,
    lineHeight: 20,
    textAlign: 'left',
  },
  importAlertBold: {
    fontFamily: fontFamilies.bodyBold,
  },
  formBody: {
    gap: 8,
  },
  legendText: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    textAlign: 'left',
  },
  reqStar: {
    color: colors.secondary,
    fontFamily: fontFamilies.bodyBold,
  },
  problemsBanner: {
    backgroundColor: statusColors.rejectedBg,
    borderWidth: 1,
    borderColor: colors.secondary,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  problemsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  problemsTitle: {
    flex: 1,
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyBold,
    color: statusColors.rejectedText,
    textAlign: 'left',
  },
  problemsLine: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.body,
    color: colors.ink,
    lineHeight: 20,
    textAlign: 'left',
  },
  problemsBold: {
    fontFamily: fontFamilies.bodyBold,
    color: statusColors.rejectedText,
  },
  problemsWrongList: {
    gap: 2,
  },
  sectionCard: {
    gap: spacing.md,
  },
  sectionCardCompact: {
    gap: 6,
    padding: 10,
  },
  compactSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  compactLegendText: {
    fontSize: 11.5,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    includeFontPadding: false,
  },
  fieldGroupCompact: {
    gap: 2,
  },
  catDiffRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    alignItems: 'flex-start',
  },
  catCol: {
    flex: 0.9,
    minWidth: 0,
  },
  diffCol: {
    flex: 1.1,
    minWidth: 0,
  },
  threeColRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  colThird: {
    flex: 1,
    minWidth: 0,
  },
  inputCompact: {
    backgroundColor: colors.surface0,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    fontSize: 14,
    fontFamily: fontFamilies.body,
    color: colors.ink,
    textAlign: 'right',
  },
  selectTriggerCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface0,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    borderRadius: radii.md,
    paddingHorizontal: 8,
    paddingVertical: 5,
    gap: 4,
  },
  diffPillCompact: {
    flex: 1,
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    backgroundColor: colors.surface0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeTogglePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface0,
  },
  sectionHeaderPills: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  addInlinePill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    backgroundColor: colors.surface2,
  },
  addInlinePillText: {
    fontSize: 12,
    fontFamily: fontFamilies.bodyBold,
    color: colors.ink,
    includeFontPadding: false,
  },
  modeTogglePillText: {
    fontSize: 12,
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
    includeFontPadding: false,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  sectionHeaderCol: {
    flex: 1,
    gap: 2,
  },
  sectionNumber: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
    textAlign: 'left',
    includeFontPadding: false,
  },
  sectionTitle: {
    fontSize: typeScale.step2,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    textAlign: 'left',
  },
  sectionSub: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    lineHeight: 19,
    textAlign: 'left',
  },
  fieldGroup: {
    gap: 6,
  },
  label: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyBold,
    color: colors.ink2,
    textAlign: 'left',
  },
  hintText: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    textAlign: 'left',
  },
  fieldError: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.secondary,
    textAlign: 'left',
  },
  input: {
    backgroundColor: colors.surface0,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    fontSize: 14,
    fontFamily: fontFamilies.body,
    color: colors.ink,
    textAlign: 'right',
  },
  multilineInput: {
    minHeight: 76,
    textAlignVertical: 'top',
  },
  inputInvalid: {
    borderColor: colors.secondary,
    backgroundColor: statusColors.rejectedBg,
  },
  inputWarning: {
    borderColor: colors.caution,
    backgroundColor: statusColors.pendingBg,
  },
  selectTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface0,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  selectTriggerText: {
    flex: 1,
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink,
    textAlign: 'left',
    includeFontPadding: false,
  },
  selectPlaceholderText: {
    color: colors.ink4,
    fontFamily: fontFamilies.body,
  },
  difficultyRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  difficultyRowInvalid: {
    padding: 4,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.secondary,
  },
  diffPill: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radii.md,
    backgroundColor: colors.surface0,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  diffPillSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  diffPillText: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink2,
    includeFontPadding: false,
  },
  diffPillTextSelected: {
    color: colors.buttonColor,
    fontFamily: fontFamilies.bodyBold,
  },
  twoColRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  colHalf: {
    flex: 1,
  },
  modeToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: 9,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
  },
  modeToggleBtnActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  modeToggleText: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.primaryDark,
    includeFontPadding: false,
  },
  modeToggleTextActive: {
    color: colors.buttonColor,
    fontFamily: fontFamilies.bodyBold,
  },
  rowsList: {
    gap: spacing.sm,
  },
  sectionsList: {
    gap: spacing.md,
  },
  subSectionCard: {
    backgroundColor: colors.surface0,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: spacing.md,
    gap: spacing.sm,
  },
  subSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  subSectionTitleInput: {
    flex: 1,
    backgroundColor: colors.surface1,
  },
  ingredientBlock: {
    gap: 4,
  },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ingAmountInput: {
    width: 64,
    paddingHorizontal: 8,
    textAlign: 'center',
  },
  ingUnitWrap: {
    width: 88,
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },
  ingUnitInput: {
    flex: 1,
    paddingHorizontal: 8,
    paddingEnd: 24,
  },
  unitQuickBtn: {
    position: 'absolute',
    end: 4,
    padding: 4,
  },
  ingItemInput: {
    flex: 1,
    minWidth: 0,
  },
  removeRowBtn: {
    width: 34,
    height: 34,
    borderRadius: radii.sm,
    backgroundColor: statusColors.rejectedBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  stepNumBadge: {
    width: 26,
    height: 26,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  stepNumText: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
    includeFontPadding: false,
  },
  stepInput: {
    flex: 1,
    minHeight: 44,
    textAlignVertical: 'top',
  },
  photosGrid: {
    gap: spacing.sm,
  },
  photoCard: {
    backgroundColor: colors.surface0,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  photoImageWrap: {
    height: 150,
    borderRadius: radii.sm,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
    position: 'relative',
  },
  photoThumb: {
    width: '100%',
    height: '100%',
  },
  photoPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryTag: {
    position: 'absolute',
    top: spacing.xs,
    start: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  primaryTagText: {
    fontSize: 11,
    fontFamily: fontFamilies.bodyBold,
    color: colors.buttonColor,
    includeFontPadding: false,
  },
  photoActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
  },
  photoSmallAction: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    marginEnd: 'auto',
  },
  photoSmallActionText: {
    fontSize: 12,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.primaryDark,
    includeFontPadding: false,
  },
  miniIconBtn: {
    width: 30,
    height: 30,
    borderRadius: radii.sm,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniIconBtnDanger: {
    width: 30,
    height: 30,
    borderRadius: radii.sm,
    backgroundColor: statusColors.rejectedBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlDisabled: {
    opacity: 0.35,
  },
  mediaDivider: {
    height: 1,
    backgroundColor: colors.hairline,
    marginVertical: spacing.xs,
  },
  stepMediaCard: {
    backgroundColor: colors.surface0,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  stepMediaTop: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  stepMediaThumbWrap: {
    width: 64,
    height: 64,
    borderRadius: radii.sm,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
  },
  stepMediaThumb: {
    width: '100%',
    height: '100%',
  },
  stepMediaVideoBadge: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepMediaInfo: {
    flex: 1,
    gap: spacing.xs,
    alignItems: 'flex-start',
  },
  captionInput: {
    width: '100%',
    paddingVertical: 8,
    backgroundColor: colors.surface1,
  },
  relatedChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  relatedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface2,
    borderRadius: radii.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    maxWidth: '100%',
  },
  relatedChipText: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink,
    flexShrink: 1,
  },
  bottomActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  bottomActionsSticky: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    backgroundColor: colors.surface1,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  clearActionBtn: {
    flex: 1,
  },
  submitActionBtn: {
    flex: 2,
  },
  sheetOptionsList: {
    gap: spacing.xs,
    paddingBottom: spacing.md,
  },
  sheetOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  sheetOptionRowSelected: {
    borderColor: colors.primaryDark,
    backgroundColor: statusColors.approvedBg,
  },
  sheetOptionText: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink,
    textAlign: 'left',
  },
  sheetOptionTextSelected: {
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
  },
  unitsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingBottom: spacing.md,
  },
  photoSourceActions: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  relatedSheetBody: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  relatedOptionCol: {
    flex: 1,
    gap: 2,
  },
  sheetSpinner: {
    marginVertical: spacing.lg,
  },
  // Preview styles
  previewCard: {
    gap: spacing.md,
    ...shadows.level2,
  },
  previewHeroImage: {
    width: '100%',
    height: 210,
    borderRadius: radii.md,
    backgroundColor: colors.surface2,
  },
  previewTitle: {
    fontSize: typeScale.step3,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    textAlign: 'left',
  },
  previewDescription: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink2,
    lineHeight: 22,
    textAlign: 'left',
  },
  previewMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  previewSection: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  previewSectionTitle: {
    fontSize: typeScale.step1,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    textAlign: 'left',
  },
  previewSubGroup: {
    gap: 4,
  },
  previewSubTitle: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
    textAlign: 'left',
  },
  previewBulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  previewBullet: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyBold,
    color: colors.primary,
  },
  previewStepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  previewBodyText: {
    flex: 1,
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink2,
    lineHeight: 22,
    textAlign: 'left',
  },
  ltrAmount: {
    fontFamily: fontFamilies.bodyBold,
    color: colors.ink,
    writingDirection: 'ltr',
  },
  previewMediaCard: {
    gap: spacing.xs,
    backgroundColor: colors.surface0,
    borderRadius: radii.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  previewMediaImg: {
    width: '100%',
    height: 160,
    borderRadius: radii.sm,
  },
  videoPlaceholder: {
    height: 90,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface2,
    borderRadius: radii.sm,
  },
  previewCaption: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink2,
    textAlign: 'left',
  },
  previewAttribution: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink3,
    textAlign: 'left',
  },
});
