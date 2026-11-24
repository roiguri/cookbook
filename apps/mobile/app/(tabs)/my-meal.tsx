import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Ionicons } from '@expo/vector-icons';
import {
  calculateTotalTime,
  formatCookingTime,
  formatRecipeData,
  getLocalizedCategoryName,
} from '@cookbook/core/recipe-utils/recipe-data-utils';
import { scaleIngredients } from '@cookbook/core/recipe-utils/recipe-ingredients-utils';
import { colors, fontFamilies, radii, shadows, spacing, statusColors, typeScale } from '@/theme';
import {
  Badge,
  Card,
  ConfirmDialog,
  EmptyState,
  PressableScale,
  Skeleton,
  useToast,
} from '@/components/ui';
import {
  OfflineBanner,
  ShoppingListSheet,
  formatBidiSafeAmount,
  getIngredientKey,
  getRecipeIngredientKeys,
  useNetworkStatus,
  type MealIngredient,
  type MealIngredientSection,
  type MealRecipe,
} from '@/components/meal';
import { useSession } from '@/context/SessionContext';
import {
  ActiveMealService,
  type ActiveMealDoc,
  type RecipeMealState,
} from '@/services/meals/active-meal-service';
import { RecipeService } from '@/services/recipes/recipe-service';

const RECIPES_CACHE_PREFIX = 'cookbook:my_meal_recipes_cache:v1:';
const COOK_MODE_WAKE_TAG = 'my-meal-cook-mode';

function toMealRecipe(raw: any, fallbackId: string): MealRecipe | null {
  const formatted = formatRecipeData(raw);
  if (!formatted) return null;
  return {
    id: formatted.id || fallbackId,
    name: formatted.name || '',
    category: formatted.category || '',
    prepTime: formatted.prepTime || 0,
    waitTime: formatted.waitTime || 0,
    difficulty: formatted.difficulty || '',
    description: formatted.description || '',
    servings: formatted.servings > 0 ? formatted.servings : 1,
    servingsUnit: typeof raw?.servingsUnit === 'string' ? raw.servingsUnit : undefined,
    ingredients: formatted.ingredients,
    ingredientSections: formatted.ingredientSections,
    instructions: formatted.instructions,
    stages: formatted.stages,
    comments: formatted.comments,
  };
}

interface TabItem {
  id: string;
  name: string;
}

interface MealTabsBarProps {
  items: TabItem[];
  activeRecipeId: string | null;
  onSelectTab: (id: string) => void;
  onRequestRemove: (id: string) => void;
}

/**
 * Memoized horizontal RTL recipe pill tabs.
 * Only re-renders when recipeIds, resolved names, or activeRecipeId change —
 * never rebuilt on ingredient checkoffs, servings adjustments, or step progress.
 */
const MealTabsBar = React.memo(function MealTabsBar({
  items,
  activeRecipeId,
  onSelectTab,
  onRequestRemove,
}: MealTabsBarProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.tabsContent}
      style={styles.tabsScroll}
    >
      {items.map((item) => {
        const isActive = item.id === activeRecipeId;
        return (
          <View key={item.id} style={[styles.tabPill, isActive && styles.tabPillActive]}>
            <Pressable
              testID={`meal-tab-${item.id}`}
              onPress={() => onSelectTab(item.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              style={styles.tabSelectArea}
            >
              <Text
                style={[styles.tabLabel, isActive && styles.tabLabelActive]}
                numberOfLines={1}
                allowFontScaling={false}
              >
                {item.name}
              </Text>
            </Pressable>

            <PressableScale
              variant="icon"
              testID={`meal-tab-remove-${item.id}`}
              onPress={() => onRequestRemove(item.id)}
              accessibilityRole="button"
              accessibilityLabel={`הסר ${item.name} מהארוחה`}
              hitSlop={6}
              style={[styles.tabRemoveBtn, isActive && styles.tabRemoveBtnActive]}
            >
              <Ionicons
                name="close"
                size={15}
                color={isActive ? colors.buttonColor : colors.ink3}
              />
            </PressableScale>
          </View>
        );
      })}
    </ScrollView>
  );
});

export default function MyMealScreen() {
  const { user, isAuthenticated, loading: sessionLoading } = useSession();
  const { showToast } = useToast();
  const { isOffline } = useNetworkStatus();

  const [meal, setMeal] = useState<ActiveMealDoc | null>(null);
  const [mealLoaded, setMealLoaded] = useState(false);
  const [recipes, setRecipes] = useState<Record<string, MealRecipe>>({});
  const [recipesHydrated, setRecipesHydrated] = useState(false);
  const [fetchingIds, setFetchingIds] = useState<Record<string, boolean>>({});
  const [shoppingSheetOpen, setShoppingSheetOpen] = useState(false);
  const [cookMode, setCookMode] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [localChecked, setLocalChecked] = useState<Record<string, Record<string, boolean>>>({});
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [mutatingConfirm, setMutatingConfirm] = useState(false);

  const recipesRef = useRef<Record<string, MealRecipe>>({});
  recipesRef.current = recipes;
  const inFlightRef = useRef<Set<string>>(new Set());

  const uid = user?.uid || null;

  // Auth guard
  useEffect(() => {
    if (!sessionLoading && !isAuthenticated) {
      router.replace('/(tabs)/home');
    }
  }, [sessionLoading, isAuthenticated]);

  // Wake lock for Cook Mode (always releases on exit or unmount)
  useEffect(() => {
    if (cookMode) {
      activateKeepAwakeAsync(COOK_MODE_WAKE_TAG).catch(() => {});
    } else {
      deactivateKeepAwake(COOK_MODE_WAKE_TAG).catch(() => {});
    }
    return () => {
      deactivateKeepAwake(COOK_MODE_WAKE_TAG).catch(() => {});
    };
  }, [cookMode]);

  // Hydrate locally cached meal recipes immediately for zero-network offline resilience
  useEffect(() => {
    if (!uid) {
      setRecipes({});
      setRecipesHydrated(false);
      return;
    }

    let active = true;
    setRecipesHydrated(false);
    AsyncStorage.getItem(`${RECIPES_CACHE_PREFIX}${uid}`)
      .then((raw) => {
        if (!active) return;
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            setRecipes(parsed as Record<string, MealRecipe>);
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setRecipesHydrated(true);
      });

    return () => {
      active = false;
    };
  }, [uid]);

  // Real-time ActiveMealService subscription (cache-first + offline queue + reconnect sync)
  useEffect(() => {
    if (!uid) {
      setMeal(null);
      setMealLoaded(true);
      return;
    }

    setMealLoaded(false);
    const unsub = ActiveMealService.subscribe(uid, (nextMeal) => {
      setMeal(nextMeal);
      setMealLoaded(true);
    });

    return () => {
      unsub();
    };
  }, [uid]);

  // Fetch any missing recipe docs (uses RecipeService offline AsyncStorage fallback + saves to my-meal cache)
  const recipeIdsKey = useMemo(() => (meal?.recipeIds || []).join(','), [meal?.recipeIds]);

  useEffect(() => {
    if (!uid || !recipesHydrated) return;
    const ids = recipeIdsKey ? recipeIdsKey.split(',').filter(Boolean) : [];
    const missing = ids.filter((id) => !recipesRef.current[id] && !inFlightRef.current.has(id));
    if (missing.length === 0) return;

    let cancelled = false;
    missing.forEach((id) => inFlightRef.current.add(id));
    setFetchingIds((prev) => {
      const next = { ...prev };
      missing.forEach((id) => {
        next[id] = true;
      });
      return next;
    });

    void Promise.all(
      missing.map(async (id) => {
        try {
          const raw = await RecipeService.getById(id);
          return { id, recipe: raw ? toMealRecipe(raw, id) : null };
        } catch {
          return { id, recipe: null };
        }
      }),
    ).then((results) => {
      missing.forEach((id) => inFlightRef.current.delete(id));
      if (cancelled) return;

      setFetchingIds((prev) => {
        const next = { ...prev };
        missing.forEach((id) => {
          delete next[id];
        });
        return next;
      });

      const loadedEntries = results.filter((r): r is { id: string; recipe: MealRecipe } =>
        Boolean(r.recipe),
      );
      if (loadedEntries.length === 0) return;

      setRecipes((prev) => {
        const merged = { ...prev };
        loadedEntries.forEach(({ id, recipe }) => {
          merged[id] = recipe;
        });
        void AsyncStorage.setItem(`${RECIPES_CACHE_PREFIX}${uid}`, JSON.stringify(merged)).catch(
          () => {},
        );
        return merged;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [uid, recipeIdsKey, recipesHydrated, isOffline]);

  const recipeIds = useMemo(() => meal?.recipeIds || [], [meal?.recipeIds]);

  const activeRecipeId = useMemo(() => {
    if (!recipeIds.length) return null;
    if (meal?.activeRecipeId && recipeIds.includes(meal.activeRecipeId)) {
      return meal.activeRecipeId;
    }
    return recipeIds[0];
  }, [meal?.activeRecipeId, recipeIds]);

  // Reset description expansion when switching active recipe
  useEffect(() => {
    setDescExpanded(false);
  }, [activeRecipeId]);

  const activeRecipe = activeRecipeId ? (recipes[activeRecipeId] ?? null) : null;
  const activeRecipeState: RecipeMealState | undefined = activeRecipeId
    ? meal?.recipeStates?.[activeRecipeId]
    : undefined;

  const baseServings =
    activeRecipe?.servings && activeRecipe.servings > 0 ? activeRecipe.servings : 1;
  const currentServings =
    activeRecipeState?.servings && activeRecipeState.servings > 0
      ? activeRecipeState.servings
      : baseServings;

  const currentStepIndex =
    typeof activeRecipeState?.currentStepIndex === 'number'
      ? activeRecipeState.currentStepIndex
      : -1;

  // Derived unselected ingredients set across all recipes in meal
  const unselectedSet = useMemo(() => {
    const set = new Set<string>();
    if (meal?.recipeStates) {
      Object.values(meal.recipeStates).forEach((state) => {
        if (Array.isArray(state?.unselectedIngredients)) {
          state.unselectedIngredients.forEach((key) => set.add(key));
        }
      });
    }
    return set;
  }, [meal?.recipeStates]);

  // Total selected shopping items count for the badge on shopping-list-open-btn
  const selectedShoppingCount = useMemo(() => {
    let count = 0;
    recipeIds.forEach((id) => {
      const rec = recipes[id];
      if (!rec) return;
      const keys = getRecipeIngredientKeys(rec, id);
      keys.forEach((key) => {
        if (!unselectedSet.has(key)) count += 1;
      });
    });
    return count;
  }, [recipeIds, recipes, unselectedSet]);

  // Stable tab items signature — decoupled from recipeStates / ingredient checkoffs!
  const tabSignature = useMemo(
    () => recipeIds.map((id) => `${id}:${recipes[id]?.name || ''}`).join('|'),
    [recipeIds, recipes],
  );

  const tabItems = useMemo<TabItem[]>(
    () =>
      recipeIds.map((id) => ({
        id,
        name: recipes[id]?.name || 'טוען...',
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabSignature],
  );

  const handleSelectTab = useCallback(
    (id: string) => {
      if (!uid || id === activeRecipeId) return;
      void ActiveMealService.switchRecipe(uid, id);
    },
    [uid, activeRecipeId],
  );

  const handleRequestRemove = useCallback((id: string) => {
    setPendingRemoveId(id);
  }, []);

  const handleConfirmRemove = async () => {
    if (!uid || !pendingRemoveId) return;
    setMutatingConfirm(true);
    try {
      await ActiveMealService.removeFromMeal(uid, pendingRemoveId);
      setPendingRemoveId(null);
      showToast('המתכון הוסר מהארוחה', 'info');
    } catch {
      showToast('הסרת המתכון נכשלה', 'error');
    } finally {
      setMutatingConfirm(false);
    }
  };

  const handleConfirmClear = async () => {
    if (!uid) return;
    setMutatingConfirm(true);
    try {
      await ActiveMealService.clearMeal(uid);
      setConfirmClearOpen(false);
      setCookMode(false);
      setShoppingSheetOpen(false);
      showToast('הארוחה נוקתה', 'info');
    } catch {
      showToast('ניקוי הארוחה נכשל', 'error');
    } finally {
      setMutatingConfirm(false);
    }
  };

  const handleChangeServings = useCallback(
    (nextServings: number) => {
      if (!uid || !activeRecipeId) return;
      const clamped = Math.max(1, Math.min(999, Math.round(nextServings)));
      void ActiveMealService.updateRecipeState(uid, activeRecipeId, { servings: clamped });
    },
    [uid, activeRecipeId],
  );

  const handleSelectStep = useCallback(
    (stepIndex: number) => {
      if (!uid || !activeRecipeId) return;
      void ActiveMealService.updateRecipeState(uid, activeRecipeId, {
        currentStepIndex: stepIndex,
      });
    },
    [uid, activeRecipeId],
  );

  const handleToggleShoppingIngredient = useCallback(
    (recipeId: string, key: string) => {
      if (!uid) return;
      const currentForRecipe = meal?.recipeStates?.[recipeId]?.unselectedIngredients || [];
      const set = new Set(currentForRecipe);
      if (set.has(key)) {
        set.delete(key);
      } else {
        set.add(key);
      }
      void ActiveMealService.updateRecipeState(uid, recipeId, {
        unselectedIngredients: Array.from(set),
      });
    },
    [uid, meal?.recipeStates],
  );

  const handleBulkSelectRecipes = useCallback(
    (shouldSelect: boolean, targetRecipeIds: string[]) => {
      if (!uid) return;
      targetRecipeIds.forEach((recipeId) => {
        const recipe = recipesRef.current[recipeId];
        if (!recipe) return;
        const nextUnselected = shouldSelect ? [] : getRecipeIngredientKeys(recipe, recipeId);
        const prevUnselected = meal?.recipeStates?.[recipeId]?.unselectedIngredients || [];
        const changed =
          prevUnselected.length !== nextUnselected.length ||
          nextUnselected.some((k) => !prevUnselected.includes(k));
        if (changed) {
          void ActiveMealService.updateRecipeState(uid, recipeId, {
            unselectedIngredients: nextUnselected,
          });
        }
      });
    },
    [uid, meal?.recipeStates],
  );

  const toggleLocalIngredientCheck = useCallback((recipeId: string, key: string) => {
    setLocalChecked((prev) => ({
      ...prev,
      [recipeId]: {
        ...(prev[recipeId] || {}),
        [key]: !prev[recipeId]?.[key],
      },
    }));
  }, []);

  // Scaled ingredients for the active recipe
  const scaledIngredientSections = useMemo(() => {
    if (!activeRecipe) return [];
    if (activeRecipe.ingredientSections && activeRecipe.ingredientSections.length > 0) {
      const scaled = scaleIngredients(
        activeRecipe.ingredientSections,
        baseServings,
        currentServings,
      ) as MealIngredientSection[];
      return scaled.map((sec, sIndex) => ({
        sectionIndex: sIndex,
        title: sec.title,
        items: Array.isArray(sec.items) ? sec.items : [],
      }));
    }
    const scaled = scaleIngredients(
      activeRecipe.ingredients || [],
      baseServings,
      currentServings,
    ) as MealIngredient[];
    return [
      {
        sectionIndex: 0,
        title: undefined,
        items: Array.isArray(scaled) ? scaled : [],
      },
    ];
  }, [activeRecipe, baseServings, currentServings]);

  // Normalized instruction stages with global 0-based step indices
  const instructionStages = useMemo(() => {
    if (!activeRecipe) return { stages: [], totalSteps: 0 };
    let cursor = 0;

    if (activeRecipe.stages && activeRecipe.stages.length > 0) {
      const stages = activeRecipe.stages.map((st, stageIdx) => {
        const steps = (st.instructions || []).map((text) => {
          const stepIndex = cursor;
          cursor += 1;
          return { stepIndex, text };
        });
        return { key: `stage-${stageIdx}`, title: st.title, steps };
      });
      return { stages, totalSteps: cursor };
    }

    const steps = (activeRecipe.instructions || []).map((text) => {
      const stepIndex = cursor;
      cursor += 1;
      return { stepIndex, text };
    });
    return {
      stages: steps.length > 0 ? [{ key: 'stage-0', title: undefined, steps }] : [],
      totalSteps: cursor,
    };
  }, [activeRecipe]);

  const effectiveCookStep =
    instructionStages.totalSteps > 0
      ? currentStepIndex >= 0 && currentStepIndex < instructionStages.totalSteps
        ? currentStepIndex
        : 0
      : -1;

  if (!isAuthenticated) {
    return <View style={styles.screen} />;
  }

  const hasMeal = recipeIds.length > 0;
  const totalTime = activeRecipe
    ? calculateTotalTime(activeRecipe.prepTime || 0, activeRecipe.waitTime || 0)
    : 0;

  return (
    <View testID="my-meal-screen" style={styles.screen}>
      <OfflineBanner isOffline={isOffline} />

      {!mealLoaded ? (
        <View style={styles.loadingWrap}>
          <Skeleton height={44} radius={radii.pill} />
          <Skeleton height={120} radius={radii.lg} />
          <Skeleton height={180} radius={radii.lg} />
        </View>
      ) : !hasMeal ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            testID="meal-empty-state"
            icon="restaurant-outline"
            title="אין ארוחה פעילה"
            subtitle="התחל להוסיף מתכונים לארוחה שלך כדי לראות אותם כאן"
            actionLabel="חפש מתכונים"
            actionTestID="meal-empty-browse-btn"
            onAction={() => router.navigate('/(tabs)/categories')}
          />
        </View>
      ) : (
        <>
          {/* Sticky Workspace Header: Shopping List Trigger + Clear Meal + RTL Pill Tabs */}
          <View style={styles.mealHeader}>
            <View style={styles.headerActionRow}>
              <PressableScale
                testID="shopping-list-open-btn"
                onPress={() => setShoppingSheetOpen(true)}
                accessibilityRole="button"
                style={styles.shoppingBtn}
              >
                <Ionicons name="clipboard-outline" size={17} color={colors.buttonColor} />
                <Text style={styles.shoppingBtnLabel} allowFontScaling={false}>
                  רשימת מצרכים
                </Text>
                {selectedShoppingCount > 0 ? (
                  <View style={styles.shoppingCountBadge}>
                    <Text style={styles.shoppingCountText} allowFontScaling={false}>
                      {selectedShoppingCount}
                    </Text>
                  </View>
                ) : null}
              </PressableScale>

              <PressableScale
                testID="meal-clear-btn"
                onPress={() => setConfirmClearOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="נקה את כל הארוחה"
                style={styles.clearBtn}
              >
                <Ionicons name="trash-outline" size={17} color={colors.secondary} />
                <Text style={styles.clearBtnLabel} allowFontScaling={false}>
                  נקה ארוחה
                </Text>
              </PressableScale>
            </View>

            <MealTabsBar
              items={tabItems}
              activeRecipeId={activeRecipeId}
              onSelectTab={handleSelectTab}
              onRequestRemove={handleRequestRemove}
            />
          </View>

          {/* Active Recipe Kitchen Body */}
          <ScrollView
            style={styles.bodyScroll}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            {activeRecipe ? (
              <>
                {/* Recipe Title, Metadata & Cook Mode Toggle */}
                <Card style={styles.recipeHeaderCard}>
                  <View style={styles.recipeTitleRow}>
                    <Text style={styles.recipeTitle}>{activeRecipe.name}</Text>
                    <PressableScale
                      variant="icon"
                      onPress={() => router.push(`/recipe/${activeRecipe.id}`)}
                      accessibilityRole="button"
                      accessibilityLabel="פתח עמוד מתכון מלא"
                      style={styles.openDetailBtn}
                    >
                      <Ionicons name="open-outline" size={18} color={colors.primaryDark} />
                    </PressableScale>
                  </View>

                  <View style={styles.metaRow}>
                    {activeRecipe.category ? (
                      <Badge
                        label={getLocalizedCategoryName(activeRecipe.category)}
                        tone="neutral"
                      />
                    ) : null}
                    {activeRecipe.difficulty ? (
                      <Badge label={activeRecipe.difficulty} tone="warning" />
                    ) : null}
                    {totalTime > 0 ? (
                      <Badge label={formatCookingTime(totalTime)} tone="success" />
                    ) : null}
                  </View>

                  {activeRecipe.description ? (
                    <View style={styles.descWrap}>
                      <Text
                        style={styles.descriptionText}
                        numberOfLines={descExpanded ? undefined : 2}
                      >
                        {activeRecipe.description}
                      </Text>
                      {activeRecipe.description.length > 90 ? (
                        <Pressable
                          onPress={() => setDescExpanded((v) => !v)}
                          style={styles.descToggleBtn}
                        >
                          <Text style={styles.descToggleText}>
                            {descExpanded ? 'הצג פחות' : 'הצג עוד'}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}

                  {/* Cook Mode Toggle Bar */}
                  <View style={styles.cookModeRow}>
                    <PressableScale
                      testID="meal-cook-mode-toggle"
                      onPress={() => {
                        setCookMode((prev) => {
                          const next = !prev;
                          if (next && currentStepIndex < 0 && instructionStages.totalSteps > 0) {
                            handleSelectStep(0);
                          }
                          return next;
                        });
                      }}
                      accessibilityRole="switch"
                      accessibilityState={{ checked: cookMode }}
                      style={[styles.cookModeBtn, cookMode && styles.cookModeBtnActive]}
                    >
                      <Ionicons
                        name={cookMode ? 'flame' : 'flame-outline'}
                        size={17}
                        color={cookMode ? colors.buttonColor : colors.primaryDark}
                      />
                      <Text
                        style={[styles.cookModeLabel, cookMode && styles.cookModeLabelActive]}
                        allowFontScaling={false}
                      >
                        מצב בישול
                      </Text>
                    </PressableScale>

                    {cookMode ? (
                      <View style={styles.wakeBadge}>
                        <Ionicons name="sunny-outline" size={14} color={colors.primaryDark} />
                        <Text style={styles.wakeBadgeText} allowFontScaling={false}>
                          המסך יישאר דלוק
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </Card>

                {/* Servings Scaler Card */}
                <Card style={styles.servingsCard}>
                  <View style={styles.servingsLabelCol}>
                    <Text style={styles.sectionHeading}>{activeRecipe.servingsUnit || 'מנות'}</Text>
                    {currentServings !== baseServings ? (
                      <Pressable
                        onPress={() => handleChangeServings(baseServings)}
                        style={styles.resetServingsBtn}
                      >
                        <Text style={styles.resetServingsText}>
                          {`איפוס למקור (${baseServings})`}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>

                  <View style={styles.stepper}>
                    <PressableScale
                      variant="icon"
                      testID="meal-servings-dec-btn"
                      disabled={currentServings <= 1}
                      onPress={() => handleChangeServings(currentServings - 1)}
                      accessibilityRole="button"
                      accessibilityLabel="הפחת מנות"
                      style={[styles.stepperBtn, currentServings <= 1 && styles.stepperBtnDisabled]}
                    >
                      <Ionicons
                        name="remove"
                        size={20}
                        color={currentServings <= 1 ? colors.ink4 : colors.primaryDark}
                      />
                    </PressableScale>

                    <Text testID="meal-servings-value" style={styles.servingsValue}>
                      {currentServings}
                    </Text>

                    <PressableScale
                      variant="icon"
                      testID="meal-servings-inc-btn"
                      onPress={() => handleChangeServings(currentServings + 1)}
                      accessibilityRole="button"
                      accessibilityLabel="הגדל מנות"
                      style={styles.stepperBtn}
                    >
                      <Ionicons name="add" size={20} color={colors.primaryDark} />
                    </PressableScale>
                  </View>
                </Card>

                {/* Scaled Ingredients Card */}
                <Card style={styles.contentCard}>
                  <View style={styles.cardHeaderRow}>
                    <Text style={styles.sectionHeading}>מצרכים</Text>
                    <PressableScale
                      onPress={() => setShoppingSheetOpen(true)}
                      style={styles.inlineLinkBtn}
                    >
                      <Text style={styles.inlineLinkText} allowFontScaling={false}>
                        פתח ברשימת קניות
                      </Text>
                    </PressableScale>
                  </View>

                  {scaledIngredientSections.map((section) => (
                    <View key={`ing-sec-${section.sectionIndex}`} style={styles.ingSectionBlock}>
                      {section.title ? (
                        <Text style={styles.subSectionTitle}>{section.title}</Text>
                      ) : null}

                      {section.items.map((item, iIndex) => {
                        const key = getIngredientKey(activeRecipe.id, section.sectionIndex, iIndex);
                        const checked = Boolean(localChecked[activeRecipe.id]?.[key]);
                        const bidiAmount = formatBidiSafeAmount(item.amount);
                        const unit = (item.unit ?? '').toString().trim();
                        const itemName = (item.item ?? '').toString().trim();

                        return (
                          <Pressable
                            key={key}
                            onPress={() => toggleLocalIngredientCheck(activeRecipe.id, key)}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked }}
                            style={({ pressed }) => [
                              styles.ingredientRow,
                              checked && styles.ingredientRowChecked,
                              pressed && styles.rowPressed,
                            ]}
                          >
                            <View
                              style={[styles.checkCircle, checked && styles.checkCircleChecked]}
                            >
                              {checked ? (
                                <Ionicons name="checkmark" size={13} color={colors.buttonColor} />
                              ) : null}
                            </View>

                            <View style={styles.ingredientParts}>
                              {bidiAmount ? (
                                <Text
                                  style={[
                                    styles.amountText,
                                    cookMode && styles.cookModeIngredientText,
                                    checked && styles.checkedText,
                                  ]}
                                >
                                  {bidiAmount}
                                </Text>
                              ) : null}
                              {unit ? (
                                <Text
                                  style={[
                                    styles.unitText,
                                    cookMode && styles.cookModeIngredientText,
                                    checked && styles.checkedText,
                                  ]}
                                >
                                  {unit}
                                </Text>
                              ) : null}
                              <Text
                                style={[
                                  styles.itemText,
                                  cookMode && styles.cookModeIngredientText,
                                  checked && styles.checkedText,
                                ]}
                              >
                                {itemName}
                              </Text>
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  ))}
                </Card>

                {/* Instructions & Preserved Step Progress Card */}
                {instructionStages.stages.length > 0 ? (
                  <Card style={styles.contentCard}>
                    <View style={styles.cardHeaderRow}>
                      <Text style={styles.sectionHeading}>הוראות הכנה</Text>
                      {currentStepIndex >= 0 && instructionStages.totalSteps > 0 ? (
                        <Badge
                          label={`שלב ${Math.min(currentStepIndex + 1, instructionStages.totalSteps)} מתוך ${instructionStages.totalSteps}`}
                          tone="success"
                        />
                      ) : null}
                    </View>

                    {cookMode && instructionStages.totalSteps > 0 ? (
                      <View style={styles.cookNavBar}>
                        <PressableScale
                          disabled={effectiveCookStep <= 0}
                          onPress={() => handleSelectStep(Math.max(0, effectiveCookStep - 1))}
                          style={[
                            styles.cookNavBtn,
                            effectiveCookStep <= 0 && styles.cookNavBtnDisabled,
                          ]}
                        >
                          <Text style={styles.cookNavLabel} allowFontScaling={false}>
                            השלב הקודם
                          </Text>
                        </PressableScale>

                        <Text style={styles.cookNavCounter}>
                          {`${effectiveCookStep + 1} / ${instructionStages.totalSteps}`}
                        </Text>

                        <PressableScale
                          disabled={effectiveCookStep >= instructionStages.totalSteps - 1}
                          onPress={() =>
                            handleSelectStep(
                              Math.min(instructionStages.totalSteps - 1, effectiveCookStep + 1),
                            )
                          }
                          style={[
                            styles.cookNavBtn,
                            styles.cookNavBtnPrimary,
                            effectiveCookStep >= instructionStages.totalSteps - 1 &&
                              styles.cookNavBtnDisabled,
                          ]}
                        >
                          <Text
                            style={[styles.cookNavLabel, styles.cookNavLabelPrimary]}
                            allowFontScaling={false}
                          >
                            השלב הבא
                          </Text>
                        </PressableScale>
                      </View>
                    ) : null}

                    {instructionStages.stages.map((stage) => (
                      <View key={stage.key} style={styles.stageBlock}>
                        {stage.title ? (
                          <Text style={styles.subSectionTitle}>{stage.title}</Text>
                        ) : null}

                        {stage.steps.map(({ stepIndex, text }) => {
                          const isCurrent = stepIndex === currentStepIndex;
                          const isCompleted = currentStepIndex > stepIndex;
                          return (
                            <Pressable
                              key={`step-${stepIndex}`}
                              onPress={() => handleSelectStep(stepIndex)}
                              accessibilityRole="button"
                              accessibilityState={{ selected: isCurrent }}
                              style={[
                                styles.stepRow,
                                isCurrent && styles.stepRowActive,
                                isCompleted && styles.stepRowCompleted,
                              ]}
                            >
                              <View
                                style={[
                                  styles.stepBadge,
                                  isCurrent && styles.stepBadgeActive,
                                  isCompleted && styles.stepBadgeCompleted,
                                ]}
                              >
                                {isCompleted ? (
                                  <Ionicons name="checkmark" size={14} color={colors.primaryDark} />
                                ) : (
                                  <Text
                                    style={[
                                      styles.stepBadgeText,
                                      isCurrent && styles.stepBadgeTextActive,
                                    ]}
                                    allowFontScaling={false}
                                  >
                                    {stepIndex + 1}
                                  </Text>
                                )}
                              </View>
                              <Text
                                style={[
                                  styles.stepText,
                                  cookMode && styles.cookModeStepText,
                                  isCurrent && styles.stepTextActive,
                                ]}
                              >
                                {text}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    ))}
                  </Card>
                ) : null}

                {/* Family Notes */}
                {activeRecipe.comments && activeRecipe.comments.length > 0 ? (
                  <Card style={styles.notesCard}>
                    <Text style={styles.sectionHeading}>הערות:</Text>
                    {activeRecipe.comments.map((note, idx) => (
                      <View key={`note-${idx}`} style={styles.noteRow}>
                        <View style={styles.noteBullet} />
                        <Text style={styles.noteText}>{note}</Text>
                      </View>
                    ))}
                  </Card>
                ) : null}
              </>
            ) : activeRecipeId && fetchingIds[activeRecipeId] ? (
              <View style={styles.loadingWrap}>
                <Skeleton height={110} radius={radii.lg} />
                <Skeleton height={180} radius={radii.lg} />
              </View>
            ) : (
              <Card style={styles.offlineFallbackCard}>
                <Ionicons name="cloud-offline-outline" size={28} color={colors.caution} />
                <Text style={styles.offlineFallbackTitle}>המתכון לא שמור במכשיר</Text>
                <Text style={styles.offlineFallbackSub}>
                  {isOffline
                    ? 'המתכון ייטען אוטומטית כשתחזרו לרשת.'
                    : 'לא ניתן היה לטעון את פרטי המתכון כרגע.'}
                </Text>
              </Card>
            )}
          </ScrollView>
        </>
      )}

      {/* Shopping List Bottom Sheet */}
      <ShoppingListSheet
        visible={shoppingSheetOpen}
        onClose={() => setShoppingSheetOpen(false)}
        recipeIds={recipeIds}
        activeRecipeId={activeRecipeId}
        recipes={recipes}
        recipeStates={meal?.recipeStates || {}}
        unselectedSet={unselectedSet}
        onToggleIngredient={handleToggleShoppingIngredient}
        onBulkSelectRecipes={handleBulkSelectRecipes}
      />

      {/* Confirm Remove Single Recipe */}
      <ConfirmDialog
        visible={pendingRemoveId !== null}
        title="הסרת מתכון"
        message="האם להסיר את המתכון מהארוחה?"
        confirmLabel="הסר"
        cancelLabel="ביטול"
        destructive
        loading={mutatingConfirm}
        onConfirm={handleConfirmRemove}
        onCancel={() => setPendingRemoveId(null)}
        confirmTestID="meal-confirm-remove-btn"
        cancelTestID="meal-cancel-remove-btn"
      />

      {/* Confirm Clear Entire Meal */}
      <ConfirmDialog
        visible={confirmClearOpen}
        title="ניקוי הארוחה"
        message="האם לנקות את כל הארוחה? פעולה זו תסיר את כל המתכונים."
        confirmLabel="נקה הכל"
        cancelLabel="ביטול"
        destructive
        loading={mutatingConfirm}
        onConfirm={handleConfirmClear}
        onCancel={() => setConfirmClearOpen(false)}
        confirmTestID="meal-confirm-clear-btn"
        cancelTestID="meal-cancel-clear-btn"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface0,
  },
  loadingWrap: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  mealHeader: {
    backgroundColor: colors.surface1,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairlineStrong,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  headerActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  shoppingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    minHeight: 38,
    ...shadows.level1,
  },
  shoppingBtnLabel: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyBold,
    color: colors.buttonColor,
    includeFontPadding: false,
  },
  shoppingCountBadge: {
    backgroundColor: colors.primaryDark,
    borderRadius: radii.pill,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shoppingCountText: {
    fontSize: 11,
    fontFamily: fontFamilies.bodyBold,
    color: colors.buttonColor,
    includeFontPadding: false,
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: statusColors.rejectedBg,
    borderRadius: radii.pill,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    minHeight: 38,
  },
  clearBtnLabel: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyBold,
    color: colors.secondary,
    includeFontPadding: false,
  },
  tabsScroll: {
    flexGrow: 0,
  },
  tabsContent: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    alignItems: 'center',
  },
  tabPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    minHeight: 38,
    paddingStart: spacing.md,
    paddingEnd: 6,
    gap: 4,
    maxWidth: 230,
  },
  tabPillActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  tabSelectArea: {
    paddingVertical: 8,
    flexShrink: 1,
    justifyContent: 'center',
  },
  tabLabel: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink2,
    includeFontPadding: false,
    textAlign: 'left',
  },
  tabLabelActive: {
    fontFamily: fontFamilies.bodyBold,
    color: colors.buttonColor,
  },
  tabRemoveBtn: {
    width: 26,
    height: 26,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface1,
  },
  tabRemoveBtnActive: {
    backgroundColor: colors.primary,
  },
  bodyScroll: {
    flex: 1,
  },
  bodyContent: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing['2xl'],
  },
  recipeHeaderCard: {
    gap: spacing.sm,
  },
  recipeTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  recipeTitle: {
    flex: 1,
    fontSize: typeScale.step3,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    textAlign: 'left',
  },
  openDetailBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  descWrap: {
    gap: 4,
  },
  descriptionText: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink2,
    lineHeight: 22,
    textAlign: 'left',
  },
  descToggleBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 2,
  },
  descToggleText: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
  },
  cookModeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  cookModeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  cookModeBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  cookModeLabel: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
    includeFontPadding: false,
  },
  cookModeLabelActive: {
    color: colors.buttonColor,
  },
  wakeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: statusColors.approvedBg,
    borderRadius: radii.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
  },
  wakeBadgeText: {
    fontSize: 12,
    fontFamily: fontFamilies.bodyBold,
    color: statusColors.approvedText,
    includeFontPadding: false,
  },
  servingsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  servingsLabelCol: {
    flex: 1,
    gap: 2,
  },
  resetServingsBtn: {
    alignSelf: 'flex-start',
  },
  resetServingsText: {
    fontSize: 12,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.primaryDark,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    padding: 4,
    gap: spacing.sm,
  },
  stepperBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.surface1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  stepperBtnDisabled: {
    opacity: 0.45,
  },
  servingsValue: {
    minWidth: 34,
    textAlign: 'center',
    fontSize: typeScale.step2,
    fontFamily: fontFamilies.bodyBold,
    color: colors.ink,
    includeFontPadding: false,
  },
  contentCard: {
    gap: spacing.sm,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sectionHeading: {
    fontSize: typeScale.step2,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    textAlign: 'left',
  },
  inlineLinkBtn: {
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
  },
  inlineLinkText: {
    fontSize: 12,
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
    includeFontPadding: false,
  },
  ingSectionBlock: {
    gap: 2,
  },
  subSectionTitle: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
    textAlign: 'left',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 9,
    paddingHorizontal: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  ingredientRowChecked: {
    opacity: 0.45,
  },
  rowPressed: {
    backgroundColor: colors.pressTint,
    borderRadius: radii.xs,
  },
  checkCircle: {
    width: 20,
    height: 20,
    borderRadius: radii.xs,
    borderWidth: 1.5,
    borderColor: colors.hairlineStrong,
    backgroundColor: colors.surface0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircleChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  ingredientParts: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 5,
  },
  amountText: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
    writingDirection: 'ltr',
  },
  unitText: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink2,
  },
  itemText: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink,
    flexShrink: 1,
    textAlign: 'left',
  },
  cookModeIngredientText: {
    fontSize: typeScale.step1,
  },
  checkedText: {
    textDecorationLine: 'line-through',
    color: colors.ink3,
  },
  cookNavBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.surface2,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  cookNavBtn: {
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
  },
  cookNavBtnPrimary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  cookNavBtnDisabled: {
    opacity: 0.4,
  },
  cookNavLabel: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyBold,
    color: colors.ink,
    includeFontPadding: false,
  },
  cookNavLabelPrimary: {
    color: colors.buttonColor,
  },
  cookNavCounter: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyBold,
    color: colors.ink2,
  },
  stageBlock: {
    gap: spacing.sm,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface0,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  stepRowActive: {
    backgroundColor: statusColors.approvedBg,
    borderColor: colors.primary,
    borderWidth: 1.5,
  },
  stepRowCompleted: {
    opacity: 0.65,
  },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  stepBadgeCompleted: {
    backgroundColor: statusColors.approvedBg,
    borderColor: colors.primary,
  },
  stepBadgeText: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyBold,
    color: colors.ink2,
    includeFontPadding: false,
  },
  stepBadgeTextActive: {
    color: colors.buttonColor,
  },
  stepText: {
    flex: 1,
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink,
    lineHeight: 24,
    textAlign: 'left',
  },
  cookModeStepText: {
    fontSize: typeScale.step2,
    lineHeight: 32,
  },
  stepTextActive: {
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink,
  },
  notesCard: {
    gap: spacing.sm,
    backgroundColor: colors.surface2,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  noteBullet: {
    width: 6,
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    marginTop: 9,
  },
  noteText: {
    flex: 1,
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink2,
    lineHeight: 22,
    textAlign: 'left',
  },
  offlineFallbackCard: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  offlineFallbackTitle: {
    fontSize: typeScale.step1,
    fontFamily: fontFamilies.bodyBold,
    color: colors.ink,
    textAlign: 'center',
  },
  offlineFallbackSub: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    textAlign: 'center',
  },
});
