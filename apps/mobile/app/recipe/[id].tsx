import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextLayoutEventData,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { STAGE, VISIBILITY } from '@cookbook/core/recipe-model';
import {
  formatCookingTime,
  formatRecipeData,
  getCategoryIcon,
  getLocalizedCategoryName,
} from '@cookbook/core/recipe-utils/recipe-data-utils';
import { getRecipeImages } from '@cookbook/core/recipe-utils/recipe-image-utils';
import {
  formatIngredientAmount,
  scaleIngredients,
} from '@cookbook/core/recipe-utils/recipe-ingredients-utils';
import { getRecipeStatus } from '@cookbook/core/recipe-utils/recipe-status';
import { colors, fontFamilies, radii, shadows, spacing, statusColors, typeScale } from '@/theme';
import {
  AppHeader,
  BottomTabBar,
  Button,
  Card,
  ConfirmDialog,
  PressableScale,
  Skeleton,
  useToast,
} from '@/components/ui';
import { RecipeStrip } from '@/components/browse';
import {
  ShareFamilyModal,
  SharedRecipeBanner,
  StatusBadge,
  SubmissionActionsBar,
} from '@/components/library';
import {
  CookModePanel,
  FullscreenMediaModal,
  ImageCarousel,
  OwnerActionsSheet,
  ShareMenuSheet,
  buildCanonicalRecipeUrl,
  getSuggestEditModalRenderer,
  shareRecipeAsText,
  subscribeSuggestEditModalRenderer,
  type CookModeIngredientPeekItem,
  type CookModeStep,
  type FullscreenMediaItem,
  type ShareMode,
  type SuggestEditModalRenderer,
} from '@/components/recipe-detail';
import { useSession } from '@/context/SessionContext';
import { captureError } from '@/services/logger';
import { ActiveMealService } from '@/services/meals/active-meal-service';
import {
  MediaInstructionService,
  type MediaInstructionItem,
} from '@/services/recipes/media-instruction-service';
import {
  RecipeService,
  type RecipeDoc,
  type RecipeImageEntry,
} from '@/services/recipes/recipe-service';
import {
  RecipeShareService,
  type RecipeShareRecord,
} from '@/services/recipes/recipe-share-service';
import {
  RecipeSubmissionService,
  type RecipeSubmission,
} from '@/services/recipes/recipe-submission-service';
import { FavoritesService } from '@/services/users/favorites-service';

interface NormalizedIngredient {
  amount?: number | string | null;
  unit?: string;
  item: string;
}

interface IndexedIngredientRow {
  globalIndex: number;
  amount: string;
  unit: string;
  item: string;
}

interface IndexedIngredientSection {
  sectionIndex: number;
  title?: string;
  items: IndexedIngredientRow[];
}

interface IndexedInstructionStage {
  stageIndex: number;
  title?: string;
  steps: Array<{ stepIndex: number; localNumber: number; text: string }>;
}

interface ResolvedStepMediaItem {
  id: string;
  type: 'image' | 'video';
  uri: string;
  caption: string;
  order: number;
}

const filterRoleImages = getRecipeImages as unknown as (
  recipe: any,
  userRole?: string,
) => RecipeImageEntry[];

const URL_SPLIT_RE = /(https?:\/\/[^\s]+)/g;
const URL_TEST_RE = /^https?:\/\/[^\s]+$/i;

/**
 * Formats an ingredient amount via `@cookbook/core` `formatIngredientAmount` verbatim
 * and wraps multi-token mixed fractions (e.g. "1 1/2") in Unicode LRI/PDI so RTL Hebrew
 * text never bidi-reorders them. Returns empty string for null/empty amounts.
 */
function formatBidiAmount(rawAmount: number | string | null | undefined): string {
  const formatted = formatIngredientAmount(rawAmount);
  if (!formatted) return '';
  return formatted.includes(' ') ? `\u2066${formatted}\u2069` : formatted;
}

function normalizeLoadedRecipe(raw: RecipeDoc, fallbackId: string): RecipeDoc | null {
  const formatted = formatRecipeData(raw);
  if (!formatted) return null;
  return {
    ...formatted,
    id: formatted.id || raw.id || fallbackId,
    servingsUnit: typeof raw.servingsUnit === 'string' ? raw.servingsUnit : undefined,
    authorName: typeof raw.authorName === 'string' ? raw.authorName : undefined,
    source: typeof raw.source === 'string' ? raw.source : undefined,
  };
}

function renderAttributionSegments(attribution: string) {
  const parts = attribution.split(URL_SPLIT_RE);
  return parts.map((part, idx) => {
    if (!part) return null;
    if (URL_TEST_RE.test(part)) {
      return (
        <Text
          key={`attr-url-${idx}`}
          style={styles.attributionLink}
          onPress={() => {
            void Linking.openURL(part).catch(() => {});
          }}
        >
          {part}
        </Text>
      );
    }
    return <Text key={`attr-txt-${idx}`}>{part}</Text>;
  });
}

export default function RecipeDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const recipeId = Array.isArray(params.id) ? params.id[0] || '' : params.id || '';

  const insets = useSafeAreaInsets();
  const {
    user,
    profile,
    role,
    isAuthenticated,
    isApproved,
    loading: sessionLoading,
  } = useSession();
  const { showToast } = useToast();

  const [recipe, setRecipe] = useState<RecipeDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const [submission, setSubmission] = useState<RecipeSubmission | null | undefined>(undefined);
  const [sharedBy, setSharedBy] = useState<RecipeShareRecord | null>(null);
  const [relatedRecipes, setRelatedRecipes] = useState<RecipeDoc[]>([]);
  const [stepMedia, setStepMedia] = useState<ResolvedStepMediaItem[]>([]);

  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [servings, setServings] = useState(1);
  const [servingsInput, setServingsInput] = useState('1');
  const [checkedIngredients, setCheckedIngredients] = useState<Record<number, boolean>>({});
  const [activeStepIndex, setActiveStepIndex] = useState<number>(-1);
  const [cookMode, setCookMode] = useState(false);

  const [descExpanded, setDescExpanded] = useState(false);
  const [descTruncated, setDescTruncated] = useState(false);

  const [fullscreenVisible, setFullscreenVisible] = useState(false);
  const [fullscreenItems, setFullscreenItems] = useState<FullscreenMediaItem[]>([]);
  const [fullscreenIndex, setFullscreenIndex] = useState(0);

  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [shareFamilyOpen, setShareFamilyOpen] = useState(false);
  const [actionsSheetOpen, setActionsSheetOpen] = useState(false);
  const [suggestEditOpen, setSuggestEditOpen] = useState(false);
  const [suggestEditRenderer, setSuggestEditRenderer] = useState<SuggestEditModalRenderer | null>(
    () => getSuggestEditModalRenderer(),
  );

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);
  const [confirmCancelSubOpen, setConfirmCancelSubOpen] = useState(false);
  const [confirmResubmitOpen, setConfirmResubmitOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmLeaveShareOpen, setConfirmLeaveShareOpen] = useState(false);

  const loadSeqRef = useRef(0);
  const prevAuthUidRef = useRef<string | null>(user?.uid || null);
  const hadLoadedOnceRef = useRef(false);

  const uid = user?.uid || null;
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  // Subscribe to Slice 06 SuggestEditModal renderer registration
  useEffect(() => {
    setSuggestEditRenderer(() => getSuggestEditModalRenderer());
    return subscribeSuggestEditModalRenderer(() => {
      setSuggestEditRenderer(() => getSuggestEditModalRenderer());
    });
  }, []);

  // Reset per-recipe UI state whenever route ID changes
  useEffect(() => {
    setRecipe(null);
    setNotFound(false);
    setLoading(true);
    setSubmission(undefined);
    setSharedBy(null);
    setRelatedRecipes([]);
    setStepMedia([]);
    setCheckedIngredients({});
    setActiveStepIndex(-1);
    setCookMode(false);
    setDescExpanded(false);
    setDescTruncated(false);
    setShareSheetOpen(false);
    setShareFamilyOpen(false);
    setActionsSheetOpen(false);
    setSuggestEditOpen(false);
    hadLoadedOnceRef.current = false;
  }, [recipeId]);

  const loadFavorites = useCallback(async () => {
    if (!uid) {
      setFavoriteIds([]);
      return;
    }
    try {
      const ids = await FavoritesService.getFavoriteIds(uid);
      setFavoriteIds(ids);
    } catch {
      // Non-blocking
    }
  }, [uid]);

  useEffect(() => {
    void loadFavorites();
  }, [loadFavorites]);

  useEffect(() => {
    return FavoritesService.subscribeFavoriteChanges(
      ({ recipeId: changedId, isFavorite, userId }) => {
        if (!uid || userId !== uid) return;
        setFavoriteIds((prev) => {
          const next = new Set(prev);
          if (isFavorite) next.add(changedId);
          else next.delete(changedId);
          return Array.from(next);
        });
      },
    );
  }, [uid]);

  const loadRecipe = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!recipeId) {
        setRecipe(null);
        setNotFound(true);
        setLoading(false);
        return;
      }

      const seq = ++loadSeqRef.current;
      if (!silent) {
        setLoading(true);
      }

      try {
        const raw = await RecipeService.get(recipeId);
        if (seq !== loadSeqRef.current) return;

        if (!raw) {
          setRecipe(null);
          setNotFound(true);
          setLoading(false);
          setRefreshing(false);
          return;
        }

        const normalized = normalizeLoadedRecipe(raw, recipeId);
        if (!normalized) {
          setRecipe(null);
          setNotFound(true);
          setLoading(false);
          setRefreshing(false);
          return;
        }

        setRecipe(normalized);
        setNotFound(false);

        const base = normalized.servings && normalized.servings > 0 ? normalized.servings : 1;
        if (!hadLoadedOnceRef.current) {
          setServings(base);
          setServingsInput(String(base));
          hadLoadedOnceRef.current = true;
        }

        setLoading(false);
        setRefreshing(false);

        // Load step media URLs asynchronously
        const rawMedia: MediaInstructionItem[] = Array.isArray(normalized.mediaInstructions)
          ? [...normalized.mediaInstructions].sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0))
          : [];
        if (rawMedia.length > 0) {
          void Promise.all(
            rawMedia.map(async (item, idx): Promise<ResolvedStepMediaItem | null> => {
              const resolved = await MediaInstructionService.resolveMediaUrl(item);
              if (!resolved) return null;
              return {
                id: item.id || `media-${idx}`,
                type: item.type === 'video' ? 'video' : 'image',
                uri: resolved,
                caption: typeof item.caption === 'string' ? item.caption.trim() : '',
                order: typeof item.order === 'number' ? item.order : idx,
              };
            }),
          ).then((items) => {
            if (seq !== loadSeqRef.current) return;
            setStepMedia(items.filter((entry): entry is ResolvedStepMediaItem => entry !== null));
          });
        } else {
          setStepMedia([]);
        }

        // Load related published recipes asynchronously (strictly visibility === 'published')
        const relIds = Array.isArray(normalized.relatedRecipes)
          ? Array.from(
              new Set(
                normalized.relatedRecipes.filter(
                  (rid): rid is string =>
                    typeof rid === 'string' && rid.trim().length > 0 && rid !== normalized.id,
                ),
              ),
            )
          : [];

        if (relIds.length > 0) {
          void Promise.all(relIds.map((rid) => RecipeService.get(rid).catch(() => null))).then(
            (docs) => {
              if (seq !== loadSeqRef.current) return;
              const publishedOnly = docs.filter((doc): doc is RecipeDoc =>
                Boolean(doc && doc.visibility === VISIBILITY.PUBLISHED),
              );
              setRelatedRecipes(publishedOnly);
            },
          );
        } else {
          setRelatedRecipes([]);
        }
      } catch (err: any) {
        if (seq !== loadSeqRef.current) return;
        const code = String(err?.code || '');
        if (code !== 'permission-denied' && code !== 'firestore/permission-denied') {
          captureError(err, { service: 'recipeDetail', op: 'loadRecipe', recipeId });
        }
        setRecipe(null);
        setNotFound(true);
        setLoading(false);
        setRefreshing(false);
      }
    },
    [recipeId],
  );

  // Initial load & refresh on screen focus (e.g. returning from edit or auth)
  useFocusEffect(
    useCallback(() => {
      void loadRecipe({ silent: hadLoadedOnceRef.current });
      if (uid) {
        void loadFavorites();
      }
    }, [loadRecipe, loadFavorites, uid]),
  );

  // React to auth transitions:
  // 1. Signing out while viewing a private recipe redirects cleanly to /(tabs)/home.
  // 2. Signing in while on a not-found private recipe retries loading automatically.
  useEffect(() => {
    const prevUid = prevAuthUidRef.current;
    prevAuthUidRef.current = uid;

    if (!sessionLoading && !uid && recipe && recipe.visibility !== VISIBILITY.PUBLISHED) {
      setRecipe(null);
      router.replace('/(tabs)/home');
      return;
    }

    if (prevUid !== uid && uid && notFound) {
      void loadRecipe({ silent: false });
    }
  }, [uid, sessionLoading, recipe, notFound, loadRecipe]);

  const isPublished = recipe?.visibility === VISIBILITY.PUBLISHED;
  const isPrivate = Boolean(recipe && !isPublished);
  const isOwner = Boolean(recipe && uid && recipe.authorId === uid && isApproved);

  // Load owner's submission record
  const refreshSubmission = useCallback(async () => {
    if (!recipe?.id || !isOwner) {
      setSubmission(undefined);
      return;
    }
    try {
      const sub = await RecipeSubmissionService.getByRecipeId(recipe.id);
      setSubmission(sub || null);
    } catch {
      setSubmission(null);
    }
  }, [recipe?.id, isOwner]);

  useEffect(() => {
    void refreshSubmission();
  }, [refreshSubmission]);

  // Load shared-by metadata when viewing someone else's private recipe
  useEffect(() => {
    if (!recipe?.id || !uid || isPublished || recipe.authorId === uid) {
      setSharedBy(null);
      return;
    }
    let active = true;
    RecipeShareService.getMine(recipe.id, uid)
      .then((share) => {
        if (active) setSharedBy(share);
      })
      .catch(() => {
        if (active) setSharedBy(null);
      });
    return () => {
      active = false;
    };
  }, [recipe?.id, recipe?.authorId, isPublished, uid]);

  // Accessible hero images filtered by role via @cookbook/core `getRecipeImages`
  const accessibleImages = useMemo<RecipeImageEntry[]>(() => {
    if (!recipe || !Array.isArray(recipe.images) || recipe.images.length === 0) return [];
    const effectiveRole = role === 'guest' || role === 'user' ? 'public' : role;
    const withDefaultAccess = {
      ...recipe,
      images: recipe.images.map((img) =>
        img && typeof img === 'object' && !img.access ? { ...img, access: 'public' } : img,
      ),
    };
    return filterRoleImages(withDefaultAccess, effectiveRole);
  }, [recipe, role]);

  const baseServings = recipe?.servings && recipe.servings > 0 ? recipe.servings : 1;

  // Scaled & globally 0-based indexed ingredients using @cookbook/core `scaleIngredients` verbatim
  const { ingredientSections, flatCookIngredients, hasAnyQuantity } = useMemo(() => {
    if (!recipe) {
      return {
        ingredientSections: [] as IndexedIngredientSection[],
        flatCookIngredients: [] as CookModeIngredientPeekItem[],
        hasAnyQuantity: false,
      };
    }

    let cursor = 0;
    let anyQty = false;
    const peek: CookModeIngredientPeekItem[] = [];

    if (Array.isArray(recipe.ingredientSections) && recipe.ingredientSections.length > 0) {
      const scaled = scaleIngredients(recipe.ingredientSections, baseServings, servings) as Array<{
        title?: string;
        items?: NormalizedIngredient[];
      }>;

      const sections: IndexedIngredientSection[] = scaled.map((sec, sIdx) => {
        const items: IndexedIngredientRow[] = (sec.items || []).map((ing) => {
          const idx = cursor++;
          const amount = formatBidiAmount(ing.amount);
          const unit = (ing.unit ?? '').toString().trim();
          const item = (ing.item ?? '').toString().trim();
          if (amount || unit) anyQty = true;
          peek.push({
            index: idx,
            amount,
            unit,
            item,
            sectionTitle: sec.title,
            checked: Boolean(checkedIngredients[idx]),
          });
          return { globalIndex: idx, amount, unit, item };
        });
        return { sectionIndex: sIdx, title: sec.title, items };
      });

      return { ingredientSections: sections, flatCookIngredients: peek, hasAnyQuantity: anyQty };
    }

    const scaledFlat = scaleIngredients(
      recipe.ingredients || [],
      baseServings,
      servings,
    ) as NormalizedIngredient[];

    const items: IndexedIngredientRow[] = (Array.isArray(scaledFlat) ? scaledFlat : []).map(
      (ing) => {
        const idx = cursor++;
        const amount = formatBidiAmount(ing.amount);
        const unit = (ing.unit ?? '').toString().trim();
        const item = (ing.item ?? '').toString().trim();
        if (amount || unit) anyQty = true;
        peek.push({
          index: idx,
          amount,
          unit,
          item,
          checked: Boolean(checkedIngredients[idx]),
        });
        return { globalIndex: idx, amount, unit, item };
      },
    );

    return {
      ingredientSections: items.length > 0 ? [{ sectionIndex: 0, title: undefined, items }] : [],
      flatCookIngredients: peek,
      hasAnyQuantity: anyQty,
    };
  }, [recipe, baseServings, servings, checkedIngredients]);

  // Normalized instruction stages & flat step list for Cook Mode (0-based global indices)
  const { instructionStages, cookSteps } = useMemo(() => {
    if (!recipe) {
      return {
        instructionStages: [] as IndexedInstructionStage[],
        cookSteps: [] as CookModeStep[],
      };
    }

    let cursor = 0;
    const flat: CookModeStep[] = [];

    if (Array.isArray(recipe.stages) && recipe.stages.length > 0) {
      const stages: IndexedInstructionStage[] = recipe.stages.map((st, stageIdx) => {
        const steps = (st.instructions || []).map((text, localIdx) => {
          const stepIndex = cursor++;
          flat.push({ stepIndex, text, stageTitle: st.title });
          return { stepIndex, localNumber: localIdx + 1, text };
        });
        return { stageIndex: stageIdx, title: st.title, steps };
      });
      return { instructionStages: stages, cookSteps: flat };
    }

    const steps = (recipe.instructions || []).map((text, localIdx) => {
      const stepIndex = cursor++;
      flat.push({ stepIndex, text });
      return { stepIndex, localNumber: localIdx + 1, text };
    });

    return {
      instructionStages: steps.length > 0 ? [{ stageIndex: 0, title: undefined, steps }] : [],
      cookSteps: flat,
    };
  }, [recipe]);

  const nonEmptyComments = useMemo(
    () => (recipe?.comments || []).map((c) => (c ?? '').toString().trim()).filter(Boolean),
    [recipe?.comments],
  );

  // Share mode matches Web `recipe-detail-page.js`:
  // published -> link or text; author's private (approved) -> family or text; shared/other private -> text only
  const shareMode: ShareMode = useMemo(() => {
    if (!recipe) return 'text';
    if (recipe.visibility === VISIBILITY.PUBLISHED) return 'published';
    return isOwner ? 'family' : 'text';
  }, [recipe, isOwner]);

  const headerStatus = useMemo(() => {
    if (!recipe) return null;
    if (sharedBy && !isOwner && isPrivate) return 'shared';
    if (!isOwner) return null;
    return getRecipeStatus({
      ...recipe,
      submissionStatus: submission?.status,
      ownView: true,
    });
  }, [recipe, sharedBy, isOwner, isPrivate, submission?.status]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/home');
    }
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void loadRecipe({ silent: true });
    void refreshSubmission();
    if (uid) void loadFavorites();
  }, [loadRecipe, refreshSubmission, loadFavorites, uid]);

  const applyServings = useCallback((nextVal: number) => {
    const clamped = Math.max(1, Math.min(9999, Math.round(nextVal)));
    setServings(clamped);
    setServingsInput(String(clamped));
  }, []);

  const handleServingsTextChange = useCallback((text: string) => {
    const digitsOnly = text.replace(/[^0-9]/g, '');
    setServingsInput(digitsOnly);
    const parsed = parseInt(digitsOnly, 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      setServings(Math.min(9999, parsed));
    }
  }, []);

  const handleServingsInputBlur = useCallback(() => {
    const parsed = parseInt(servingsInput, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      setServingsInput(String(servings));
    } else {
      applyServings(parsed);
    }
  }, [servingsInput, servings, applyServings]);

  const handleToggleIngredient = useCallback((globalIndex: number) => {
    setCheckedIngredients((prev) => ({
      ...prev,
      [globalIndex]: !prev[globalIndex],
    }));
  }, []);

  const handleStepPress = useCallback(
    (stepIndex: number) => {
      setActiveStepIndex((prev) => {
        if (cookMode) return stepIndex;
        return prev === stepIndex ? -1 : stepIndex;
      });
    },
    [cookMode],
  );

  const handleToggleCookMode = useCallback(() => {
    setCookMode((prev) => {
      const next = !prev;
      if (next && activeStepIndex < 0 && cookSteps.length > 0) {
        setActiveStepIndex(0);
      }
      return next;
    });
  }, [activeStepIndex, cookSteps.length]);

  const handleOpenFullscreen = useCallback((index: number, items: FullscreenMediaItem[]) => {
    if (items.length === 0) return;
    setFullscreenItems(items);
    setFullscreenIndex(index);
    setFullscreenVisible(true);
  }, []);

  const handlePressStepMedia = useCallback(
    (index: number) => {
      const items: FullscreenMediaItem[] = stepMedia.map((m) => ({
        id: m.id,
        type: m.type,
        uri: m.uri,
        caption: m.caption,
      }));
      handleOpenFullscreen(index, items);
    },
    [stepMedia, handleOpenFullscreen],
  );

  const handleToggleFavorite = useCallback(
    async (targetId?: string) => {
      const idToToggle = targetId || recipe?.id;
      if (!uid || !idToToggle) return;
      try {
        await FavoritesService.toggleFavorite(uid, idToToggle, favoriteIds);
      } catch {
        showToast('לא ניתן לעדכן מועדפים כרגע. נסה שוב.', 'error');
      }
    },
    [uid, recipe?.id, favoriteIds, showToast],
  );

  const handleAddToMeal = useCallback(
    async (targetId?: string, targetServings?: number) => {
      const idToAdd = targetId || recipe?.id;
      if (!uid || !idToAdd) return;
      setBusyAction('meal');
      try {
        const res = await ActiveMealService.addToMeal(uid, idToAdd, targetServings ?? servings);
        if (res.success) {
          showToast('המתכון נוסף לארוחה שלך בהצלחה', 'success');
        } else if (res.reason === 'duplicate') {
          showToast('המתכון כבר נמצא בארוחה שלך', 'info');
        } else {
          showToast('שגיאה בהוספת המתכון לארוחה', 'error');
        }
      } catch {
        showToast('שגיאה בהוספת המתכון לארוחה', 'error');
      } finally {
        setBusyAction(null);
      }
    },
    [uid, recipe?.id, servings, showToast],
  );

  const handleSharePress = useCallback(() => {
    if (!recipe) return;
    if (shareMode === 'text') {
      void shareRecipeAsText(recipe, servings, showToast);
      return;
    }
    setShareSheetOpen(true);
  }, [recipe, shareMode, servings, showToast]);

  const handleMarkTested = useCallback(async () => {
    if (!recipe?.id) return;
    setActionsSheetOpen(false);
    setBusyAction('stage');
    try {
      await RecipeService.markTested(recipe.id);
      showToast('סומן כנבדק — המתכון עבר לספרייה שלכם', 'success');
      await loadRecipe({ silent: true });
    } catch (err) {
      captureError(err, { service: 'recipeDetail', op: 'markTested', recipeId: recipe.id });
      showToast('לא הצלחנו לסמן את המתכון כנבדק. נסו שוב.', 'error');
    } finally {
      setBusyAction(null);
    }
  }, [recipe?.id, showToast, loadRecipe]);

  const handleMarkToTry = useCallback(async () => {
    if (!recipe?.id) return;
    setActionsSheetOpen(false);
    setBusyAction('stage');
    try {
      await RecipeService.markToTry(recipe.id);
      showToast('הוחזר ל״לנסות״', 'success');
      await loadRecipe({ silent: true });
    } catch (err) {
      captureError(err, { service: 'recipeDetail', op: 'markToTry', recipeId: recipe.id });
      showToast('לא הצלחנו להחזיר את המתכון ל״לנסות״. נסו שוב.', 'error');
    } finally {
      setBusyAction(null);
    }
  }, [recipe?.id, showToast, loadRecipe]);

  const handleOpenEdit = useCallback(
    (withResubmit = false) => {
      if (!recipe?.id) return;
      setActionsSheetOpen(false);
      setConfirmResubmitOpen(false);
      router.push({
        pathname: '/(tabs)/propose-recipe',
        params: withResubmit ? { editId: recipe.id, resubmit: 'true' } : { editId: recipe.id },
      });
    },
    [recipe?.id],
  );

  const handleDirectResubmit = useCallback(async () => {
    if (!recipe?.id) return;
    setBusyAction('resubmit');
    try {
      await RecipeSubmissionService.resubmit(recipe.id);
      setConfirmResubmitOpen(false);
      setActionsSheetOpen(false);
      showToast('המתכון נשלח שוב לאישור', 'success');
      await refreshSubmission();
    } catch (err) {
      captureError(err, { service: 'recipeDetail', op: 'resubmit', recipeId: recipe.id });
      showToast('השליחה מחדש נכשלה. נסו שוב.', 'error');
    } finally {
      setBusyAction(null);
    }
  }, [recipe?.id, showToast, refreshSubmission]);

  const handleConfirmSubmitForApproval = useCallback(async () => {
    if (!recipe?.id || !uid) return;
    setBusyAction('submit');
    try {
      await RecipeSubmissionService.submit({
        recipeId: recipe.id,
        authorId: uid,
        recipeName: recipe.name,
        authorName: profile?.fullName || user?.displayName || undefined,
        category: recipe.category,
      });
      setConfirmSubmitOpen(false);
      setActionsSheetOpen(false);
      showToast('המתכון נשלח לאישור', 'success');
      await refreshSubmission();
    } catch (err) {
      captureError(err, { service: 'recipeDetail', op: 'submit', recipeId: recipe.id });
      showToast('לא הצלחנו לשלוח את המתכון. נסו שוב.', 'error');
    } finally {
      setBusyAction(null);
    }
  }, [recipe, uid, profile?.fullName, user?.displayName, showToast, refreshSubmission]);

  const handleConfirmCancelSubmission = useCallback(async () => {
    if (!recipe?.id) return;
    setBusyAction('cancel-submit');
    try {
      await RecipeSubmissionService.cancel(recipe.id);
      setConfirmCancelSubOpen(false);
      setActionsSheetOpen(false);
      showToast('השליחה בוטלה', 'success');
      await refreshSubmission();
    } catch (err) {
      captureError(err, { service: 'recipeDetail', op: 'cancelSubmission', recipeId: recipe.id });
      showToast('לא הצלחנו לבטל את השליחה. נסו שוב.', 'error');
    } finally {
      setBusyAction(null);
    }
  }, [recipe?.id, showToast, refreshSubmission]);

  const handleConfirmDelete = useCallback(async () => {
    if (!recipe?.id) return;
    setBusyAction('delete');
    try {
      await RecipeSubmissionService.deleteRecipe(recipe.id, {
        authorId: recipe.authorId || uid || undefined,
        images: recipe.images,
      });
      setConfirmDeleteOpen(false);
      setActionsSheetOpen(false);
      showToast('המתכון נמחק', 'success');
      if (recipe.stage === STAGE.TO_TRY) {
        router.replace({
          pathname: '/(tabs)/my-recipes',
          params: { view: STAGE.TO_TRY },
        });
      } else {
        router.replace('/(tabs)/my-recipes');
      }
    } catch (err) {
      captureError(err, { service: 'recipeDetail', op: 'deleteRecipe', recipeId: recipe.id });
      showToast('לא הצלחנו למחוק את המתכון. נסו שוב.', 'error');
    } finally {
      setBusyAction(null);
    }
  }, [recipe, uid, showToast]);

  const handleConfirmLeaveShared = useCallback(async () => {
    if (!recipe?.id || !uid) return;
    setBusyAction('leave-share');
    try {
      await RecipeShareService.remove(recipe.id, uid);
      setConfirmLeaveShareOpen(false);
      showToast('המתכון הוסר מהספרייה שלך', 'success');
      router.replace('/(tabs)/my-recipes');
    } catch (err) {
      captureError(err, { service: 'recipeDetail', op: 'leaveShare', recipeId: recipe.id });
      showToast('לא הצלחנו להסיר את המתכון. נסו שוב.', 'error');
    } finally {
      setBusyAction(null);
    }
  }, [recipe?.id, uid, showToast]);

  const handleOpenSuggestEdit = useCallback(() => {
    setActionsSheetOpen(false);
    if (suggestEditRenderer) {
      setSuggestEditOpen(true);
    } else {
      showToast('טופס הצעת העריכה יהיה זמין בקרוב', 'info');
    }
  }, [suggestEditRenderer, showToast]);

  const handleDescTextLayout = useCallback((event: NativeSyntheticEvent<TextLayoutEventData>) => {
    const lines = event.nativeEvent?.lines || [];
    if (lines.length > 2) {
      setDescTruncated(true);
    }
  }, []);

  const isFavorite = Boolean(recipe?.id && favoriteSet.has(recipe.id));
  const showActionsMenuBtn = Boolean(
    recipe && !notFound && isAuthenticated && (isOwner || isPublished),
  );
  const showDescriptionToggle =
    Boolean(recipe?.description) &&
    (descTruncated ||
      descExpanded ||
      (recipe?.description?.trim().length || 0) > 105 ||
      (recipe?.description?.includes('\n') ?? false));
  const anyOverlayOpen =
    actionsSheetOpen || shareSheetOpen || shareFamilyOpen || fullscreenVisible || suggestEditOpen;

  return (
    <View testID="recipe-detail-screen" collapsable={false} style={styles.screen}>
      {/* Shared App Header (keeps brand-logo, auth-open-btn, header-search-btn, shortcuts accessible) */}
      <View
        accessibilityElementsHidden={anyOverlayOpen}
        importantForAccessibility={anyOverlayOpen ? 'no-hide-descendants' : 'auto'}
      >
        <AppHeader />
      </View>

      {/* Top Action Header */}
      <View
        style={styles.topBar}
        accessibilityElementsHidden={anyOverlayOpen}
        importantForAccessibility={anyOverlayOpen ? 'no-hide-descendants' : 'auto'}
      >
        <PressableScale
          variant="icon"
          testID="recipe-back-btn"
          accessibilityRole="button"
          accessibilityLabel="חזרה"
          onPress={handleBack}
          style={styles.headerIconBtn}
        >
          <Ionicons name="chevron-forward" size={22} color={colors.ink} />
        </PressableScale>

        <View style={styles.headerActionsGroup}>
          {recipe && !notFound && isAuthenticated ? (
            <>
              <PressableScale
                variant="icon"
                testID="recipe-fav-btn"
                accessibilityRole="button"
                accessibilityLabel={isFavorite ? 'הסר מהמועדפים' : 'הוסף למועדפים'}
                accessibilityState={{ selected: isFavorite }}
                onPress={() => {
                  void handleToggleFavorite();
                }}
                style={[styles.headerIconBtn, isFavorite && styles.headerIconBtnFavActive]}
              >
                <Ionicons
                  name={isFavorite ? 'heart' : 'heart-outline'}
                  size={20}
                  color={isFavorite ? colors.secondary : colors.ink2}
                />
              </PressableScale>

              <PressableScale
                variant="icon"
                testID="recipe-add-to-meal-btn"
                accessibilityRole="button"
                accessibilityLabel="הוסף לארוחה שלי"
                disabled={busyAction === 'meal'}
                onPress={() => {
                  void handleAddToMeal();
                }}
                style={styles.headerIconBtn}
              >
                <Ionicons name="restaurant-outline" size={19} color={colors.primaryDark} />
              </PressableScale>
            </>
          ) : null}

          {recipe && !notFound ? (
            <PressableScale
              variant="icon"
              testID="recipe-share-btn"
              accessibilityRole="button"
              accessibilityLabel="שיתוף המתכון"
              onPress={handleSharePress}
              style={styles.headerIconBtn}
            >
              <Ionicons name="share-social-outline" size={20} color={colors.ink2} />
            </PressableScale>
          ) : null}

          {showActionsMenuBtn ? (
            <PressableScale
              variant="icon"
              testID="recipe-actions-menu-btn"
              accessibilityRole="button"
              accessibilityLabel="פעולות על המתכון"
              onPress={() => setActionsSheetOpen(true)}
              style={styles.headerIconBtn}
            >
              <Ionicons name="ellipsis-vertical" size={20} color={colors.ink2} />
            </PressableScale>
          ) : null}
        </View>
      </View>

      {/* Main Content */}
      <View
        style={styles.bodyFlex}
        accessibilityElementsHidden={anyOverlayOpen}
        importantForAccessibility={anyOverlayOpen ? 'no-hide-descendants' : 'auto'}
      >
        {loading ? (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[
              styles.content,
              { paddingBottom: Math.max(insets.bottom, spacing.xl) + spacing.lg },
            ]}
            showsVerticalScrollIndicator={false}
          >
            <Skeleton width="35%" height={18} radius={radii.pill} />
            <Skeleton width="85%" height={34} radius={radii.sm} />
            <Skeleton width="100%" height={78} radius={radii.lg} />
            <Skeleton width="100%" height={240} radius={radii.xl} />
            <Skeleton width="100%" height={190} radius={radii.lg} />
          </ScrollView>
        ) : notFound || !recipe ? (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[
              styles.notFoundWrap,
              { paddingBottom: Math.max(insets.bottom, spacing.xl) },
            ]}
            showsVerticalScrollIndicator={false}
          >
            <Card testID="recipe-not-found-card" style={styles.notFoundCard}>
              <View style={styles.notFoundIconCircle}>
                <Ionicons name="restaurant-outline" size={34} color={colors.primaryDark} />
              </View>
              <Text style={styles.notFoundEyebrow} allowFontScaling={false}>
                מתכון לא נמצא
              </Text>
              <Text style={styles.notFoundTitle}>המתכון הזה לא זמין</Text>
              <Text style={styles.notFoundBody}>
                ייתכן שהקישור שגוי, שהמתכון הוסר, או שהוא שמור כמתכון פרטי שרק בעליו יכולים לראות.
              </Text>

              <View style={styles.notFoundActions}>
                <Button
                  testID="not-found-categories-btn"
                  label="לכל המתכונים"
                  variant="primary"
                  onPress={() => router.replace('/(tabs)/categories')}
                  style={styles.notFoundActionBtn}
                />
                <Button
                  testID="not-found-home-btn"
                  label="לדף הבית"
                  variant="secondary"
                  onPress={() => router.replace('/(tabs)/home')}
                  style={styles.notFoundActionBtn}
                />
              </View>

              {!isAuthenticated ? (
                <View style={styles.notFoundLoginBox}>
                  <Text style={styles.notFoundLoginText}>
                    זה מתכון שלכם? מתכונים פרטיים מוצגים רק אחרי התחברות.
                  </Text>
                  <Button
                    testID="recipe-not-found-login-btn"
                    label="התחבר"
                    variant="outline"
                    size="sm"
                    onPress={() => router.push('/auth')}
                    icon={<Ionicons name="log-in-outline" size={16} color={colors.primaryDark} />}
                  />
                </View>
              ) : null}
            </Card>
          </ScrollView>
        ) : (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[
              styles.content,
              { paddingBottom: Math.max(insets.bottom, spacing.xl) + spacing.xl },
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={colors.primary}
                colors={[colors.primary]}
              />
            }
          >
            {/* Shared Private Recipe Banner (Recipient) */}
            {sharedBy && !isOwner && isPrivate ? (
              <SharedRecipeBanner
                authorName={sharedBy.authorName}
                onLeave={() => setConfirmLeaveShareOpen(true)}
                leaving={busyAction === 'leave-share'}
              />
            ) : null}

            {/* Owner Submission Lifecycle Banner (Prominent RejectionNoteBanner / Pending / Submit) */}
            {isOwner && isPrivate && submission !== undefined ? (
              <SubmissionActionsBar
                submission={submission}
                onSubmitForApproval={() => setConfirmSubmitOpen(true)}
                onCancelSubmission={() => setConfirmCancelSubOpen(true)}
                onResubmit={() => {
                  void handleDirectResubmit();
                }}
                busy={
                  busyAction === 'submit' ||
                  busyAction === 'cancel-submit' ||
                  busyAction === 'resubmit'
                }
              />
            ) : null}

            {/* Editorial Recipe Header */}
            <View style={styles.headerBlock}>
              <View style={styles.eyebrowRow}>
                {recipe.category ? (
                  <View style={styles.categoryPill}>
                    <Text style={styles.categoryEmoji} allowFontScaling={false}>
                      {getCategoryIcon(recipe.category)}
                    </Text>
                    <Text style={styles.categoryText} allowFontScaling={false}>
                      {getLocalizedCategoryName(recipe.category)}
                    </Text>
                  </View>
                ) : null}

                {headerStatus ? (
                  <StatusBadge
                    status={headerStatus}
                    sharedByName={sharedBy?.authorName}
                    recipeId={recipe.id}
                    testID="recipe-header-status-badge"
                  />
                ) : null}
              </View>

              <Text testID="recipe-title" style={styles.title}>
                {recipe.name}
              </Text>

              {recipe.description && recipe.description.trim() ? (
                <View style={styles.descWrap}>
                  <Text
                    testID="recipe-description"
                    numberOfLines={descExpanded ? undefined : 2}
                    onTextLayout={handleDescTextLayout}
                    style={styles.description}
                  >
                    {recipe.description.trim()}
                  </Text>
                  {showDescriptionToggle ? (
                    <Pressable
                      testID="recipe-description-toggle"
                      onPress={() => setDescExpanded((v) => !v)}
                      hitSlop={6}
                      style={styles.showMoreBtn}
                    >
                      <Text style={styles.showMoreText} allowFontScaling={false}>
                        {descExpanded ? 'הצג פחות' : 'הצג עוד'}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              {/* 3-Cell Editorial Metadata Strip + Attribution (hidden in Cook Mode to maximize step viewport) */}
              {!cookMode ? (
                <View style={[styles.metaStrip, shadows.level1]}>
                  <View style={styles.metaCellsRow}>
                    <View style={[styles.metaCell, styles.metaCellBorderEnd]}>
                      <Text style={styles.metaKey} allowFontScaling={false}>
                        זמן הכנה
                      </Text>
                      <Text style={styles.metaVal} numberOfLines={1} allowFontScaling={false}>
                        {formatCookingTime(recipe.prepTime || 0)}
                      </Text>
                    </View>

                    <View style={[styles.metaCell, styles.metaCellBorderEnd]}>
                      <Text style={styles.metaKey} allowFontScaling={false}>
                        זמן המתנה
                      </Text>
                      <Text style={styles.metaVal} numberOfLines={1} allowFontScaling={false}>
                        {formatCookingTime(recipe.waitTime || 0)}
                      </Text>
                    </View>

                    <View style={styles.metaCell}>
                      <Text style={styles.metaKey} allowFontScaling={false}>
                        רמת קושי
                      </Text>
                      <Text style={styles.metaVal} numberOfLines={1} allowFontScaling={false}>
                        {recipe.difficulty || '—'}
                      </Text>
                    </View>
                  </View>

                  {recipe.attribution && recipe.attribution.trim() ? (
                    <View style={styles.attributionRow}>
                      <Text style={styles.attributionLabel} allowFontScaling={false}>
                        מקור:
                      </Text>
                      <Text style={styles.attributionText} numberOfLines={1}>
                        {renderAttributionSegments(recipe.attribution.trim())}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>

            {/* Hero Photo Carousel (compact height so ingredients start above fold; hidden in Cook Mode) */}
            {!cookMode && accessibleImages.length > 0 ? (
              <ImageCarousel
                recipeId={recipe.id}
                images={accessibleImages}
                onPressImage={handleOpenFullscreen}
                height={128}
              />
            ) : null}

            {/* Cook Mode Toggle + Enlarged Step Navigator */}
            <CookModePanel
              enabled={cookMode}
              onToggle={handleToggleCookMode}
              steps={cookSteps}
              activeStepIndex={activeStepIndex}
              onSelectStep={(idx) => setActiveStepIndex(idx)}
              ingredients={flatCookIngredients}
              onToggleIngredient={handleToggleIngredient}
            />

            {/* Ingredients & Interactive Servings Stepper */}
            <Card style={styles.sectionCard}>
              <View style={styles.ingredientsHeader}>
                <View style={styles.ingredientsTitleCol}>
                  <Text style={styles.sectionTitle}>מצרכים</Text>
                  {servings !== baseServings ? (
                    <Pressable
                      testID="servings-reset-btn"
                      onPress={() => applyServings(baseServings)}
                      hitSlop={6}
                    >
                      <Text style={styles.resetServingsLink} allowFontScaling={false}>
                        {`איפוס למקור (${baseServings})`}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>

                <View style={styles.servingsGroup}>
                  <Text style={styles.servingsUnitLabel} allowFontScaling={false}>
                    {recipe.servingsUnit || 'מנות'}
                  </Text>
                  <View style={styles.stepperPill}>
                    <PressableScale
                      variant="icon"
                      testID="servings-dec-btn"
                      disabled={servings <= 1}
                      onPress={() => applyServings(servings - 1)}
                      accessibilityRole="button"
                      accessibilityLabel="פחות מנות"
                      style={[styles.stepperBtn, servings <= 1 && styles.stepperBtnDisabled]}
                    >
                      <Ionicons
                        name="remove"
                        size={17}
                        color={servings <= 1 ? colors.ink4 : colors.ink}
                      />
                    </PressableScale>

                    <TextInput
                      testID="servings-value"
                      value={servingsInput}
                      onChangeText={handleServingsTextChange}
                      onBlur={handleServingsInputBlur}
                      onSubmitEditing={handleServingsInputBlur}
                      keyboardType="number-pad"
                      returnKeyType="done"
                      selectTextOnFocus
                      maxLength={4}
                      accessibilityLabel="מספר מנות"
                      style={styles.servingsInput}
                    />

                    <PressableScale
                      variant="icon"
                      testID="servings-inc-btn"
                      onPress={() => applyServings(servings + 1)}
                      accessibilityRole="button"
                      accessibilityLabel="יותר מנות"
                      style={styles.stepperBtn}
                    >
                      <Ionicons name="add" size={17} color={colors.ink} />
                    </PressableScale>
                  </View>
                </View>
              </View>

              <View style={styles.ingredientsList}>
                {ingredientSections.map((section) => (
                  <View
                    key={`ing-sec-${section.sectionIndex}`}
                    style={styles.ingredientSectionWrap}
                  >
                    {section.title ? (
                      <View
                        testID={`ingredient-section-${section.sectionIndex}`}
                        collapsable={false}
                        style={styles.ingredientSectionHeader}
                      >
                        <View style={styles.ingredientSectionDot} />
                        <Text style={styles.ingredientSectionTitle}>{section.title}</Text>
                      </View>
                    ) : null}

                    {section.items.map((ing, localIdx) => {
                      const isChecked = Boolean(checkedIngredients[ing.globalIndex]);
                      const isLastInSection = localIdx === section.items.length - 1;
                      return (
                        <Pressable
                          key={`ing-row-${ing.globalIndex}`}
                          testID={`ingredient-row-${ing.globalIndex}`}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: isChecked }}
                          onPress={() => handleToggleIngredient(ing.globalIndex)}
                          style={[
                            styles.ingredientRow,
                            isLastInSection && styles.ingredientRowLast,
                          ]}
                        >
                          <View
                            style={[styles.checkboxBox, isChecked && styles.checkboxBoxChecked]}
                          >
                            {isChecked ? (
                              <Ionicons name="checkmark" size={13} color={colors.buttonColor} />
                            ) : null}
                          </View>

                          {hasAnyQuantity && (ing.amount || ing.unit) ? (
                            <View style={styles.qtyWrap}>
                              {ing.amount ? (
                                <Text
                                  testID={`ingredient-amount-${ing.globalIndex}`}
                                  style={[styles.amountText, isChecked && styles.textChecked]}
                                  allowFontScaling={false}
                                >
                                  {ing.amount}
                                </Text>
                              ) : null}
                              {ing.unit ? (
                                <Text style={[styles.unitText, isChecked && styles.textChecked]}>
                                  {ing.unit}
                                </Text>
                              ) : null}
                            </View>
                          ) : null}

                          <Text style={[styles.ingredientName, isChecked && styles.textChecked]}>
                            {ing.item}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
              </View>
            </Card>

            {/* Preparation Instructions (Flat or Multi-Stage) */}
            {instructionStages.length > 0 ? (
              <Card style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>הוראות הכנה</Text>

                <View style={styles.stagesList}>
                  {instructionStages.map((stage) => (
                    <View key={`stage-${stage.stageIndex}`} style={styles.stageBlock}>
                      {stage.title ? (
                        <View
                          testID={`stage-header-${stage.stageIndex}`}
                          collapsable={false}
                          style={styles.stageHeaderRow}
                        >
                          <Text style={styles.stageNumLabel} allowFontScaling={false}>
                            {`שלב ${String(stage.stageIndex + 1).padStart(2, '0')}`}
                          </Text>
                          <Text style={styles.stageTitle}>{stage.title}</Text>
                        </View>
                      ) : null}

                      <View style={styles.stepsList}>
                        {stage.steps.map((step, idxInStage) => {
                          const isActive = activeStepIndex === step.stepIndex;
                          return (
                            <Pressable
                              key={`step-${step.stepIndex}`}
                              testID={`instruction-step-${step.stepIndex}`}
                              accessibilityRole="button"
                              accessibilityState={{ selected: isActive }}
                              onPress={() => handleStepPress(step.stepIndex)}
                              style={[
                                styles.stepRow,
                                idxInStage === 0 && styles.stepRowFirst,
                                isActive && styles.stepRowActive,
                              ]}
                            >
                              <View
                                style={[styles.stepNumBadge, isActive && styles.stepNumBadgeActive]}
                              >
                                <Text
                                  style={[styles.stepNumText, isActive && styles.stepNumTextActive]}
                                  allowFontScaling={false}
                                >
                                  {String(step.localNumber).padStart(2, '0')}
                                </Text>
                              </View>
                              <Text
                                style={[
                                  styles.stepText,
                                  cookMode && styles.stepTextCookMode,
                                  isActive && styles.stepTextActive,
                                ]}
                              >
                                {step.text}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  ))}
                </View>
              </Card>
            ) : null}

            {/* Step Media Carousel ("טיפים מצולמים:") */}
            {stepMedia.length > 0 ? (
              <View testID="recipe-step-media-list" collapsable={false} style={styles.sectionBlock}>
                <Text style={styles.blockHeading}>טיפים מצולמים:</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.stepMediaScroll}
                >
                  {stepMedia.map((media, idx) => (
                    <PressableScale
                      key={media.id}
                      variant="card"
                      testID={`recipe-step-media-item-${idx}`}
                      accessibilityRole="button"
                      accessibilityLabel={
                        media.caption ||
                        (media.type === 'video'
                          ? `סרטון הדרכה ${idx + 1}`
                          : `תמונת הדרכה ${idx + 1}`)
                      }
                      onPress={() => handlePressStepMedia(idx)}
                      style={[styles.stepMediaCard, shadows.level1]}
                    >
                      <View style={styles.stepMediaThumbWrap}>
                        {media.type === 'video' ? (
                          <View style={styles.videoThumbBox}>
                            <View style={styles.videoPlayCircle}>
                              <Ionicons name="play" size={26} color={colors.buttonColor} />
                            </View>
                            <View style={styles.mediaTypePill}>
                              <Ionicons
                                name="videocam-outline"
                                size={12}
                                color={colors.buttonColor}
                              />
                              <Text style={styles.mediaTypeText} allowFontScaling={false}>
                                סרטון
                              </Text>
                            </View>
                          </View>
                        ) : (
                          <>
                            <Image
                              source={{ uri: media.uri }}
                              style={styles.stepMediaImage}
                              contentFit="cover"
                              transition={180}
                            />
                            <View style={styles.mediaTypePill}>
                              <Ionicons
                                name="expand-outline"
                                size={12}
                                color={colors.buttonColor}
                              />
                            </View>
                          </>
                        )}
                      </View>

                      {media.caption ? (
                        <Text style={styles.stepMediaCaption} numberOfLines={3}>
                          {media.caption}
                        </Text>
                      ) : null}
                    </PressableScale>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {/* Family Notes ("הערות:") */}
            {nonEmptyComments.length > 0 ? (
              <Card testID="recipe-comments-section" style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>הערות:</Text>
                <View style={styles.commentsList}>
                  {nonEmptyComments.map((comment, idx) => (
                    <View
                      key={`comment-${idx}`}
                      style={[
                        styles.commentRow,
                        idx === nonEmptyComments.length - 1 && styles.commentRowLast,
                      ]}
                    >
                      <View style={styles.commentBullet} />
                      <Text style={styles.commentText}>{comment}</Text>
                    </View>
                  ))}
                </View>
              </Card>
            ) : null}

            {/* Related Published Recipes */}
            {relatedRecipes.length > 0 ? (
              <View style={styles.sectionBlock}>
                <Text style={styles.blockHeading}>מתכונים קשורים</Text>
                <View testID="related-recipes-section" collapsable={false}>
                  <RecipeStrip
                    recipes={relatedRecipes}
                    dense
                    favoriteIds={favoriteSet}
                    showFavorite={isAuthenticated}
                    showAddToMeal={isAuthenticated}
                    onPressRecipe={(rel) => router.push(`/recipe/${rel.id}`)}
                    onToggleFavorite={(rel) => {
                      void handleToggleFavorite(rel.id);
                    }}
                    onAddToMeal={(rel) => {
                      void handleAddToMeal(rel.id, rel.servings);
                    }}
                  />
                </View>
              </View>
            ) : null}
          </ScrollView>
        )}
      </View>

      {/* Persistent Role-Reactive Bottom Tab Bar */}
      <View
        accessibilityElementsHidden={anyOverlayOpen}
        importantForAccessibility={anyOverlayOpen ? 'no-hide-descendants' : 'auto'}
      >
        <BottomTabBar />
      </View>

      {/* Fullscreen Image & Step Video Viewer */}
      <FullscreenMediaModal
        visible={fullscreenVisible}
        items={fullscreenItems}
        initialIndex={fullscreenIndex}
        onClose={() => setFullscreenVisible(false)}
      />

      {/* Dedicated Share Menu Sheet */}
      <ShareMenuSheet
        visible={shareSheetOpen}
        mode={shareMode}
        recipe={recipe}
        servings={servings}
        onClose={() => setShareSheetOpen(false)}
        onOpenFamilyShare={() => setShareFamilyOpen(true)}
        onShowToast={showToast}
      />

      {/* Share With Family Picker Modal (Slice 04) */}
      {recipe ? (
        <ShareFamilyModal
          visible={shareFamilyOpen}
          recipeId={recipe.id}
          recipeName={recipe.name}
          authorId={uid || undefined}
          authorName={profile?.fullName || user?.displayName || undefined}
          url={buildCanonicalRecipeUrl(recipe.id)}
          onClose={() => setShareFamilyOpen(false)}
        />
      ) : null}

      {/* Owner & Signed-In Actions Sheet (⋮) */}
      <OwnerActionsSheet
        visible={actionsSheetOpen}
        recipe={recipe}
        submission={submission}
        isOwner={isOwner}
        isAuthenticated={isAuthenticated}
        busyAction={busyAction}
        onClose={() => setActionsSheetOpen(false)}
        onMarkTested={() => {
          void handleMarkTested();
        }}
        onMarkToTry={() => {
          void handleMarkToTry();
        }}
        onEdit={() => handleOpenEdit(false)}
        onResubmit={() => {
          setActionsSheetOpen(false);
          setConfirmResubmitOpen(true);
        }}
        onShareFamily={() => {
          setActionsSheetOpen(false);
          setShareFamilyOpen(true);
        }}
        onSubmitForApproval={() => {
          setActionsSheetOpen(false);
          setConfirmSubmitOpen(true);
        }}
        onCancelSubmission={() => {
          setActionsSheetOpen(false);
          setConfirmCancelSubOpen(true);
        }}
        onSuggestEdit={handleOpenSuggestEdit}
        onAddToMeal={() => {
          setActionsSheetOpen(false);
          void handleAddToMeal();
        }}
        onDelete={() => {
          setActionsSheetOpen(false);
          setConfirmDeleteOpen(true);
        }}
      />

      {/* Suggest Edit Extension Slot (plugged by Slice 06) */}
      {suggestEditRenderer && recipe
        ? suggestEditRenderer({
            visible: suggestEditOpen,
            recipeId: recipe.id,
            recipe,
            onClose: () => setSuggestEditOpen(false),
            onSubmitted: () => {
              setSuggestEditOpen(false);
              showToast('העריכה נשלחה לאישור מנהל', 'success');
            },
          })
        : null}

      {/* Confirm: Submit Private Recipe for Approval */}
      <ConfirmDialog
        visible={confirmSubmitOpen}
        title="לשלוח לספר המשפחתי?"
        message={
          (recipe?.stage === STAGE.TO_TRY
            ? 'עוד לא ניסיתם את המתכון — אפשר לשלוח בכל זאת, אבל כדאי לנסות קודם. '
            : '') + 'מנהל יעבור על המתכון ויאשר אותו. עד אז הוא נשאר פרטי ואפשר להמשיך לערוך.'
        }
        confirmLabel="שליחה"
        cancelLabel="ביטול"
        loading={busyAction === 'submit'}
        confirmTestID="confirm-submit-approval-btn"
        onConfirm={() => {
          void handleConfirmSubmitForApproval();
        }}
        onCancel={() => setConfirmSubmitOpen(false)}
      />

      {/* Confirm: Cancel Pending Submission */}
      <ConfirmDialog
        visible={confirmCancelSubOpen}
        title="לבטל את השליחה?"
        message="המתכון יוסר מתור האישור ויישאר פרטי בספרייה שלכם."
        confirmLabel="ביטול השליחה"
        cancelLabel="חזרה"
        loading={busyAction === 'cancel-submit'}
        confirmTestID="confirm-cancel-submission-btn"
        onConfirm={() => {
          void handleConfirmCancelSubmission();
        }}
        onCancel={() => setConfirmCancelSubOpen(false)}
      />

      {/* Confirm: Resubmit Rejected Recipe (Direct Resubmit or Edit + Resubmit) */}
      <ConfirmDialog
        visible={confirmResubmitOpen}
        title="עריכה ושליחה מחדש"
        message="אפשר לשלוח את המתכון שוב לאישור מנהל עכשיו, או לפתוח את עורך המתכון לעדכון פרטים לפני השליחה."
        confirmLabel="שליחה מחדש"
        cancelLabel="ביטול"
        loading={busyAction === 'resubmit'}
        confirmTestID="confirm-direct-resubmit-btn"
        onConfirm={() => {
          void handleDirectResubmit();
        }}
        onCancel={() => setConfirmResubmitOpen(false)}
      >
        <Button
          testID="resubmit-open-editor-btn"
          label="פתיחה בעורך המתכון"
          variant="outline"
          size="sm"
          fullWidth
          onPress={() => handleOpenEdit(true)}
          icon={<Ionicons name="create-outline" size={16} color={colors.primaryDark} />}
        />
      </ConfirmDialog>

      {/* Confirm: Delete Private Recipe */}
      <ConfirmDialog
        visible={confirmDeleteOpen}
        title="למחוק את המתכון?"
        message={`״${recipe?.name || ''}״ יימחק מהספרייה שלכם יחד עם התמונות שלו. אי אפשר לבטל את זה.`}
        confirmLabel="מחיקה"
        cancelLabel="ביטול"
        destructive
        loading={busyAction === 'delete'}
        confirmTestID="confirm-delete-recipe-btn"
        onConfirm={() => {
          void handleConfirmDelete();
        }}
        onCancel={() => setConfirmDeleteOpen(false)}
      />

      {/* Confirm: Leave Shared Recipe */}
      <ConfirmDialog
        visible={confirmLeaveShareOpen}
        title="להסיר מהספרייה שלך?"
        message="המתכון יוסר מרשימת המתכונים ששותפו איתך. תמיד אפשר לבקש מהמחבר לשתף שוב."
        confirmLabel="הסרה"
        cancelLabel="ביטול"
        destructive
        loading={busyAction === 'leave-share'}
        confirmTestID="confirm-leave-shared-btn"
        onConfirm={() => {
          void handleConfirmLeaveShared();
        }}
        onCancel={() => setConfirmLeaveShareOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface0,
  },
  bodyFlex: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    backgroundColor: colors.surface0,
  },
  headerActionsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  headerIconBtn: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconBtnFavActive: {
    backgroundColor: statusColors.rejectedBg,
    borderColor: colors.secondaryLight,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  headerBlock: {
    gap: 6,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  categoryEmoji: {
    fontSize: 13,
    includeFontPadding: false,
  },
  categoryText: {
    fontSize: 12.5,
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
    includeFontPadding: false,
  },
  title: {
    fontSize: typeScale.step4,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    lineHeight: 38,
    textAlign: 'left',
  },
  descWrap: {
    gap: spacing.xs,
  },
  description: {
    fontSize: typeScale.step1,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    lineHeight: 24,
    textAlign: 'left',
  },
  showMoreBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 2,
  },
  showMoreText: {
    fontSize: 13.5,
    fontFamily: fontFamilies.bodyBold,
    color: colors.primary,
    includeFontPadding: false,
  },
  metaStrip: {
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: 'hidden',
  },
  metaCellsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  metaCell: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  metaCellBorderEnd: {
    borderEndWidth: 1,
    borderEndColor: colors.hairline,
  },
  metaKey: {
    fontSize: 11,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink3,
    includeFontPadding: false,
  },
  metaVal: {
    fontSize: typeScale.step1,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    textAlign: 'center',
    includeFontPadding: false,
  },
  attributionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    backgroundColor: colors.surface0,
  },
  attributionLabel: {
    fontSize: 12,
    fontFamily: fontFamilies.bodyBold,
    color: colors.ink4,
    includeFontPadding: false,
  },
  attributionText: {
    flex: 1,
    fontSize: 12.5,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    textAlign: 'left',
    lineHeight: 18,
  },
  attributionLink: {
    color: colors.primaryDark,
    textDecorationLine: 'underline',
  },
  sectionCard: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  sectionTitle: {
    fontSize: typeScale.step3,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    textAlign: 'left',
  },
  ingredientsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  ingredientsTitleCol: {
    gap: 2,
  },
  resetServingsLink: {
    fontSize: 12,
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
    includeFontPadding: false,
  },
  servingsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  servingsUnitLabel: {
    fontSize: 13,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink3,
    includeFontPadding: false,
  },
  stepperPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    padding: 3,
    gap: 2,
  },
  stepperBtn: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.surface1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnDisabled: {
    opacity: 0.4,
  },
  servingsInput: {
    minWidth: 38,
    paddingHorizontal: 4,
    paddingVertical: 2,
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyBold,
    color: colors.ink,
    textAlign: 'center',
    includeFontPadding: false,
  },
  ingredientsList: {
    gap: 6,
  },
  ingredientSectionWrap: {
    gap: 1,
  },
  ingredientSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 2,
    marginBottom: 2,
  },
  ingredientSectionDot: {
    width: 7,
    height: 7,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryBright,
  },
  ingredientSectionTitle: {
    fontSize: 13,
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
    textAlign: 'left',
    includeFontPadding: false,
  },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    minHeight: 34,
  },
  ingredientRowLast: {
    borderBottomWidth: 0,
  },
  checkboxBox: {
    width: 21,
    height: 21,
    borderRadius: radii.xs,
    borderWidth: 1.5,
    borderColor: colors.hairlineStrong,
    backgroundColor: colors.surface1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxBoxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  qtyWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 64,
    flexShrink: 0,
  },
  amountText: {
    fontSize: 14,
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
    writingDirection: 'ltr',
    includeFontPadding: false,
  },
  unitText: {
    fontSize: 13.5,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink3,
  },
  ingredientName: {
    flex: 1,
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink,
    lineHeight: 22,
    textAlign: 'left',
  },
  textChecked: {
    color: colors.ink4,
    textDecorationLine: 'line-through',
  },
  stagesList: {
    gap: 10,
  },
  stageBlock: {
    gap: 4,
  },
  stageHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  stageNumLabel: {
    fontSize: 11.5,
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
    backgroundColor: statusColors.approvedBg,
    borderRadius: radii.pill,
    paddingVertical: 3,
    paddingHorizontal: 9,
    includeFontPadding: false,
  },
  stageTitle: {
    flex: 1,
    fontSize: typeScale.step1,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    textAlign: 'left',
  },
  stepsList: {
    gap: 2,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: 6,
    paddingHorizontal: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    borderRadius: radii.md,
  },
  stepRowFirst: {
    borderTopWidth: 0,
  },
  stepRowActive: {
    backgroundColor: statusColors.approvedBg,
  },
  stepNumBadge: {
    width: 30,
    height: 30,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepNumBadgeActive: {
    backgroundColor: colors.primaryDark,
  },
  stepNumText: {
    fontSize: 13,
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
    includeFontPadding: false,
  },
  stepNumTextActive: {
    color: colors.buttonColor,
  },
  stepText: {
    flex: 1,
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink2,
    lineHeight: 25,
    textAlign: 'left',
  },
  stepTextCookMode: {
    fontSize: 17.5,
    lineHeight: 29,
  },
  stepTextActive: {
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink,
  },
  sectionBlock: {
    gap: spacing.md,
  },
  blockHeading: {
    fontSize: typeScale.step2,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    textAlign: 'left',
  },
  stepMediaScroll: {
    gap: spacing.md,
    paddingVertical: 2,
  },
  stepMediaCard: {
    width: 230,
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: 'hidden',
  },
  stepMediaThumbWrap: {
    width: '100%',
    height: 150,
    backgroundColor: colors.surface2,
    position: 'relative',
  },
  stepMediaImage: {
    width: '100%',
    height: '100%',
  },
  videoThumbBox: {
    flex: 1,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPlayCircle: {
    width: 54,
    height: 54,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaTypePill: {
    position: 'absolute',
    bottom: spacing.sm,
    end: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: statusColors.darkScrim,
    borderRadius: radii.pill,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  mediaTypeText: {
    color: colors.buttonColor,
    fontSize: 11.5,
    fontFamily: fontFamilies.bodyBold,
    includeFontPadding: false,
  },
  stepMediaCaption: {
    padding: spacing.md,
    fontSize: 13.5,
    fontFamily: fontFamilies.body,
    color: colors.ink2,
    lineHeight: 20,
    textAlign: 'left',
  },
  commentsList: {
    gap: 2,
  },
  commentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  commentRowLast: {
    borderBottomWidth: 0,
  },
  commentBullet: {
    width: 7,
    height: 7,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    marginTop: 9,
  },
  commentText: {
    flex: 1,
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink2,
    lineHeight: 23,
    textAlign: 'left',
  },
  notFoundWrap: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  notFoundCard: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  notFoundIconCircle: {
    width: 68,
    height: 68,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  notFoundEyebrow: {
    fontSize: 12,
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
    includeFontPadding: false,
  },
  notFoundTitle: {
    fontSize: typeScale.step3,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    textAlign: 'center',
  },
  notFoundBody: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    textAlign: 'center',
    lineHeight: 22,
  },
  notFoundActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    width: '100%',
    marginTop: spacing.md,
  },
  notFoundActionBtn: {
    flex: 1,
  },
  notFoundLoginBox: {
    width: '100%',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    alignItems: 'center',
    gap: spacing.sm,
  },
  notFoundLoginText: {
    fontSize: 13.5,
    fontFamily: fontFamilies.body,
    color: colors.ink2,
    textAlign: 'center',
    lineHeight: 20,
  },
});
