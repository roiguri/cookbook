import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { FilterUtils } from '@cookbook/core/filter-utils';
import { CATEGORY_IDS } from '@cookbook/core/recipe-model';
import { buildLibraryViews, LIBRARY_VIEW } from '@cookbook/core/recipe-utils/library-views';
import {
  calculateTotalTime,
  formatCookingTime,
  getCategoryIcon,
  getLocalizedCategoryName,
} from '@cookbook/core/recipe-utils/recipe-data-utils';
import { colors, fontFamilies, radii, shadows, spacing, statusColors, typeScale } from '@/theme';
import {
  Button,
  EmptyState,
  PressableScale,
  ScreenHeader,
  Skeleton,
  useToast,
} from '@/components/ui';
import { StatusBadge } from '@/components/library';
import { useSession } from '@/context/SessionContext';
import { captureError } from '@/services/logger';
import { ActiveMealService } from '@/services/meals/active-meal-service';
import { RecipeImageService } from '@/services/recipes/recipe-image-service';
import { RecipeService } from '@/services/recipes/recipe-service';
import { RecipeShareService } from '@/services/recipes/recipe-share-service';
import { RecipeSubmissionService } from '@/services/recipes/recipe-submission-service';
import { FavoritesService } from '@/services/users/favorites-service';

type LibraryViewId = 'all' | 'mine' | 'saved' | 'shared' | 'to-try';

interface LibraryRecipe {
  id: string;
  name?: string;
  category?: string;
  prepTime?: number;
  waitTime?: number;
  difficulty?: string;
  tags?: string[];
  images?: any[];
  authorId?: string | null;
  visibility?: 'private' | 'published';
  stage?: 'to-try' | 'tested';
  creationTime?: any;
  submissionStatus?: string;
  rejectionReason?: string | null;
  ownView?: boolean;
  sharedBy?: { uid: string; name: string };
  sharedAt?: any;
  [key: string]: any;
}

interface ViewCopyConfig {
  label: string;
  testID: string;
  lede: string;
  emptyTitle: string;
  emptyText: string;
  toBook?: boolean;
}

const VALID_VIEWS = new Set<string>(Object.values(LIBRARY_VIEW));

const VIEW_CONFIGS: Record<LibraryViewId, ViewCopyConfig> = {
  all: {
    label: 'הכל',
    testID: 'library-chip-all',
    lede: 'המתכונים שכתבתם והמתכונים ששמרתם מהספר המשפחתי, במקום אחד.',
    emptyTitle: 'הספרייה עדיין ריקה',
    emptyText: 'כתבו מתכון משלכם, או שמרו מתכון מהספר המשפחתי בלחיצה על הלב.',
  },
  mine: {
    label: 'המתכונים שלי',
    testID: 'library-chip-mine',
    lede: 'מתכונים שכתבתם — פרטיים, לנסות, ואלה שפורסמו בספר המשפחתי.',
    emptyTitle: 'עוד לא כתבתם מתכונים',
    emptyText: 'כתבו מתכון משלכם, או ייבאו אחד מקישור או מתמונה.',
  },
  saved: {
    label: 'שמרתי',
    testID: 'library-chip-saved',
    lede: 'מתכונים ששמרתם בלחיצה על הלב.',
    emptyTitle: 'עוד לא שמרתם מתכונים',
    emptyText: 'לחצו על הלב בכרטיס של מתכון כדי לשמור אותו כאן.',
    toBook: true,
  },
  shared: {
    label: 'שותפו איתי',
    testID: 'library-chip-shared',
    lede: 'מתכונים פרטיים שבני המשפחה שיתפו איתכם. תמיד תראו את הגרסה העדכנית שלהם.',
    emptyTitle: 'עוד לא שיתפו איתכם מתכונים',
    emptyText: 'כשמישהו מהמשפחה ישתף איתכם מתכון פרטי, הוא יופיע כאן.',
    toBook: true,
  },
  'to-try': {
    label: 'לנסות',
    testID: 'library-chip-to-try',
    lede: 'מתכונים ששמרתם ועוד לא ניסיתם. אחרי שתנסו, סמנו אותם כנבדקים.',
    emptyTitle: 'אין כאן מתכונים לנסות',
    emptyText:
      'מצאתם מתכון באתר, בספר או על פתק? הוסיפו אותו בטופס המתכון החדש — אפשר לייבא מקישור או מתמונה — והוא יחכה כאן עד שתנסו.',
  },
};

const SCOPE_ORDER: LibraryViewId[] = ['all', 'mine', 'saved', 'shared', 'to-try'];

// Type-safe wrapper matching runtime signature buildLibraryViews(mine, saved, shared) in @cookbook/core
const computeLibraryViews = buildLibraryViews as unknown as (
  mine?: LibraryRecipe[],
  saved?: LibraryRecipe[],
  shared?: LibraryRecipe[],
) => Record<LibraryViewId, LibraryRecipe[]>;

function parseViewParam(raw?: string | string[]): LibraryViewId {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value && VALID_VIEWS.has(value)) return value as LibraryViewId;
  return LIBRARY_VIEW.ALL as LibraryViewId;
}

export default function MyRecipesScreen() {
  const { user, isAuthenticated, isApproved, loading: sessionLoading } = useSession();
  const { showToast } = useToast();
  const params = useLocalSearchParams<{ view?: string; category?: string; q?: string }>();

  const hasOwnRecipes = isApproved;
  const uid = user?.uid || '';

  const [activeView, setActiveView] = useState<LibraryViewId>(() =>
    hasOwnRecipes ? parseViewParam(params.view) : (LIBRARY_VIEW.SAVED as LibraryViewId),
  );
  const [selectedCategory, setSelectedCategory] = useState<string>(
    typeof params.category === 'string' && params.category ? params.category : 'all',
  );
  const [searchQuery, setSearchQuery] = useState<string>(
    typeof params.q === 'string' ? params.q : '',
  );

  const [views, setViews] = useState<Record<LibraryViewId, LibraryRecipe[]>>({
    all: [],
    mine: [],
    saved: [],
    shared: [],
    'to-try': [],
  });
  const [imageUrls, setImageUrls] = useState<Record<string, string | null>>({});
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [addingMealId, setAddingMealId] = useState<string | null>(null);

  const loadSeqRef = useRef(0);
  const loadedImageIdsRef = useRef<Set<string>>(new Set());

  // Redirect signed-out visitors back to home
  useEffect(() => {
    if (!sessionLoading && !isAuthenticated) {
      router.replace('/(tabs)/home');
    }
  }, [sessionLoading, isAuthenticated]);

  // Keep view aligned with role and route params
  useEffect(() => {
    if (!hasOwnRecipes) {
      setActiveView(LIBRARY_VIEW.SAVED as LibraryViewId);
      return;
    }
    if (params.view) {
      setActiveView(parseViewParam(params.view));
    }
  }, [hasOwnRecipes, params.view]);

  const loadLibrary = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!uid) return;
      const seq = ++loadSeqRef.current;
      if (!silent) {
        setInitialLoading(true);
      }

      try {
        const [mineResult, savedResult, sharedResult] = await Promise.all([
          hasOwnRecipes
            ? (async () => {
                const [ownRecipes, submissionMap] = await Promise.all([
                  RecipeService.listMine(uid),
                  RecipeSubmissionService.listMineWithStatus(uid).catch(() => new Map()),
                ]);
                return (ownRecipes || []).map((recipe: any) => {
                  const sub = submissionMap.get(recipe.id);
                  return {
                    ...recipe,
                    submissionStatus: sub?.status,
                    rejectionReason: sub?.rejectionReason ?? null,
                    ownView: true,
                  } as LibraryRecipe;
                });
              })()
            : Promise.resolve<LibraryRecipe[]>([]),

          (async () => {
            const favIds = await FavoritesService.getFavoriteIds(uid).catch(() => []);
            const fetched = await Promise.all(
              (favIds || []).map((id: string) => RecipeService.getById(id).catch(() => null)),
            );
            return fetched.filter(Boolean) as LibraryRecipe[];
          })(),

          hasOwnRecipes
            ? (async () => {
                try {
                  const shareRecords = await RecipeShareService.listSharedWithMe(uid);
                  const settled = await Promise.allSettled(
                    shareRecords.map(async (share) => {
                      const recipe = await RecipeService.getById(share.recipeId);
                      if (!recipe || recipe.authorId === uid) return null;
                      return {
                        ...recipe,
                        sharedBy: { uid: share.authorId, name: share.authorName },
                        sharedAt: share.sharedAt,
                      } as LibraryRecipe;
                    }),
                  );
                  return settled
                    .map((item) => (item.status === 'fulfilled' ? item.value : null))
                    .filter((item): item is LibraryRecipe => item !== null);
                } catch (err) {
                  captureError(err, { service: 'myRecipes', op: 'loadShared', uid });
                  return [];
                }
              })()
            : Promise.resolve<LibraryRecipe[]>([]),
        ]);

        if (seq !== loadSeqRef.current) return;

        const computed = computeLibraryViews(mineResult, savedResult, sharedResult);
        setViews(computed);

        // Resolve primary card thumbnails for any newly visible recipes
        const uniqueRecipes = new Map<string, LibraryRecipe>();
        for (const r of computed.all) {
          if (r?.id) uniqueRecipes.set(r.id, r);
        }
        const toResolve = Array.from(uniqueRecipes.values()).filter(
          (r) => !loadedImageIdsRef.current.has(r.id),
        );
        if (toResolve.length > 0) {
          const pairs = await Promise.all(
            toResolve.map(async (r) => {
              try {
                const url = await RecipeImageService.getPrimaryImageUrl(r, 'thumb');
                return [r.id, url || null] as const;
              } catch {
                return [r.id, null] as const;
              }
            }),
          );
          if (seq !== loadSeqRef.current) return;
          setImageUrls((prev) => {
            const next = { ...prev };
            for (const [id, url] of pairs) {
              loadedImageIdsRef.current.add(id);
              next[id] = url;
            }
            return next;
          });
        }
      } catch (err) {
        captureError(err, { service: 'myRecipes', op: 'loadLibrary', uid });
        showToast('לא הצלחנו לטעון את הספרייה. נסו שוב.', 'error');
      } finally {
        if (seq === loadSeqRef.current) {
          setInitialLoading(false);
          setRefreshing(false);
        }
      }
    },
    [uid, hasOwnRecipes, showToast],
  );

  // Refresh whenever screen regains focus (after edits, shares, deletes, or new recipes)
  useFocusEffect(
    useCallback(() => {
      if (!isAuthenticated || !uid) return;
      void loadLibrary({ silent: !initialLoading });
    }, [isAuthenticated, uid, loadLibrary, initialLoading]),
  );

  // Live updates when favorites change elsewhere in the app
  useEffect(() => {
    if (!isAuthenticated || !uid) return;
    if (typeof FavoritesService?.subscribeFavoriteChanges !== 'function') return;
    const unsubscribe = FavoritesService.subscribeFavoriteChanges(() => {
      void loadLibrary({ silent: true });
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [isAuthenticated, uid, loadLibrary]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadedImageIdsRef.current.clear();
    void loadLibrary({ silent: true });
  }, [loadLibrary]);

  const effectiveView: LibraryViewId = hasOwnRecipes
    ? activeView
    : (LIBRARY_VIEW.SAVED as LibraryViewId);
  const viewConfig = VIEW_CONFIGS[effectiveView];
  const recipesInView = views[effectiveView] || [];

  const counts = useMemo(
    () => ({
      all: views.all.length,
      mine: views.mine.length,
      saved: views.saved.length,
      shared: views.shared.length,
      'to-try': views['to-try'].length,
    }),
    [views],
  );

  const availableCategories = useMemo(() => {
    const present = new Set<string>();
    for (const r of recipesInView) {
      if (r.category) present.add(r.category);
    }
    const ordered = CATEGORY_IDS.filter((cat) => present.has(cat));
    for (const cat of present) {
      if (!ordered.includes(cat)) ordered.push(cat);
    }
    return ordered;
  }, [recipesInView]);

  // Reset selectedCategory if switching views drops it
  useEffect(() => {
    if (selectedCategory !== 'all' && !availableCategories.includes(selectedCategory)) {
      setSelectedCategory('all');
    }
  }, [selectedCategory, availableCategories]);

  const filteredRecipes = useMemo(() => {
    let list = recipesInView;
    if (selectedCategory !== 'all') {
      list = list.filter((r) => r.category === selectedCategory);
    }
    if (searchQuery.trim()) {
      list = FilterUtils.searchRecipes(list, searchQuery);
    }
    return list;
  }, [recipesInView, selectedCategory, searchQuery]);

  const handleSelectView = useCallback((view: LibraryViewId) => {
    setActiveView(view);
    setSelectedCategory('all');
  }, []);

  const handleMarkTested = useCallback(
    async (recipeId: string) => {
      if (!recipeId || markingId) return;
      setMarkingId(recipeId);
      try {
        await RecipeService.markTested(recipeId);
        showToast('סומן כנבדק', 'success');
        await loadLibrary({ silent: true });
      } catch (err) {
        captureError(err, { service: 'myRecipes', op: 'markTested', recipeId });
        showToast('לא הצלחנו לסמן את המתכון כנבדק. נסו שוב.', 'error');
      } finally {
        setMarkingId(null);
      }
    },
    [markingId, showToast, loadLibrary],
  );

  const handleAddToMeal = useCallback(
    async (recipeId: string) => {
      if (!uid || !recipeId || addingMealId) return;
      setAddingMealId(recipeId);
      try {
        const result: any = await ActiveMealService.addToMeal(uid, recipeId);
        if (result?.reason === 'duplicate') {
          showToast('המתכון כבר נמצא בארוחה שלך', 'info');
        } else if (result?.success === false) {
          showToast('שגיאה בהוספת המתכון לארוחה', 'error');
        } else {
          showToast('המתכון נוסף לארוחה שלך', 'success');
        }
      } catch (err) {
        captureError(err, { service: 'myRecipes', op: 'addToMeal', recipeId });
        showToast('שגיאה בהוספת המתכון לארוחה', 'error');
      } finally {
        setAddingMealId(null);
      }
    },
    [uid, addingMealId, showToast],
  );

  const handleOpenRecipe = useCallback((recipeId: string) => {
    router.push(`/recipe/${recipeId}`);
  }, []);

  const showMarkTested = hasOwnRecipes && effectiveView === LIBRARY_VIEW.TO_TRY;
  const emptyToBook = Boolean(viewConfig.toBook || !hasOwnRecipes);

  const renderRecipeCard = useCallback(
    ({ item }: { item: LibraryRecipe }) => {
      const thumbUrl = imageUrls[item.id] ?? null;
      const totalMinutes = calculateTotalTime(item.prepTime, item.waitTime);
      const categoryLabel = item.category ? getLocalizedCategoryName(item.category) : '';
      const canMarkTested = showMarkTested && item.ownView && item.stage === 'to-try';
      const isMarkingThis = markingId === item.id;
      const isAddingThis = addingMealId === item.id;

      return (
        <View style={styles.cardColumn}>
          <PressableScale
            variant="card"
            testID={`recipe-card-${item.id}`}
            onPress={() => handleOpenRecipe(item.id)}
            style={styles.card}
          >
            <View style={styles.photoWrap}>
              {thumbUrl ? (
                <Image
                  source={{ uri: thumbUrl }}
                  contentFit="cover"
                  transition={180}
                  style={styles.photo}
                />
              ) : (
                <View style={styles.photoPlaceholder}>
                  <Text style={styles.photoPlaceholderIcon}>
                    {getCategoryIcon(item.category || 'else')}
                  </Text>
                </View>
              )}

              <View style={styles.badgeOverlay} pointerEvents="none">
                <StatusBadge recipe={item} recipeId={item.id} />
              </View>

              <PressableScale
                variant="icon"
                testID={`card-add-to-meal-${item.id}`}
                accessibilityRole="button"
                accessibilityLabel="הוסף לארוחה שלי"
                disabled={isAddingThis}
                onPress={() => handleAddToMeal(item.id)}
                style={styles.addMealBtn}
              >
                {isAddingThis ? (
                  <ActivityIndicator size="small" color={colors.primaryDark} />
                ) : (
                  <Ionicons name="add" size={18} color={colors.primaryDark} />
                )}
              </PressableScale>
            </View>

            <View style={styles.cardBody}>
              <Text numberOfLines={2} style={styles.cardTitle}>
                {item.name || 'מתכון ללא שם'}
              </Text>

              <View style={styles.metaRow}>
                {categoryLabel ? (
                  <View style={styles.metaPill}>
                    <Text allowFontScaling={false} numberOfLines={1} style={styles.metaPillText}>
                      {categoryLabel}
                    </Text>
                  </View>
                ) : null}
                {totalMinutes > 0 ? (
                  <View style={styles.metaItem}>
                    <Ionicons name="time-outline" size={12} color={colors.ink3} />
                    <Text allowFontScaling={false} style={styles.metaText}>
                      {formatCookingTime(totalMinutes)}
                    </Text>
                  </View>
                ) : null}
                {item.difficulty ? (
                  <Text allowFontScaling={false} style={styles.metaText}>
                    {item.difficulty}
                  </Text>
                ) : null}
              </View>

              {canMarkTested ? (
                <PressableScale
                  testID={`card-mark-tested-${item.id}`}
                  disabled={isMarkingThis}
                  onPress={() => handleMarkTested(item.id)}
                  accessibilityRole="button"
                  accessibilityLabel="סימון כנבדק"
                  style={styles.markTestedBtn}
                >
                  {isMarkingThis ? (
                    <ActivityIndicator size="small" color={colors.primaryDark} />
                  ) : (
                    <>
                      <Ionicons name="checkmark" size={15} color={colors.primaryDark} />
                      <Text allowFontScaling={false} style={styles.markTestedText}>
                        סימון כנבדק
                      </Text>
                    </>
                  )}
                </PressableScale>
              ) : null}
            </View>
          </PressableScale>
        </View>
      );
    },
    [
      imageUrls,
      showMarkTested,
      markingId,
      addingMealId,
      handleOpenRecipe,
      handleAddToMeal,
      handleMarkTested,
    ],
  );

  if (!isAuthenticated) {
    return <View style={styles.screen} />;
  }

  const headerNode = (
    <View style={styles.headerBlock}>
      <ScreenHeader
        title="הספרייה שלי"
        subtitle={viewConfig.lede}
        rightAction={
          hasOwnRecipes ? (
            <Button
              testID="library-new-recipe-btn"
              label="מתכון חדש"
              size="sm"
              variant="primary"
              onPress={() => router.push('/(tabs)/propose-recipe')}
              icon={<Ionicons name="add" size={16} color={colors.buttonColor} />}
            />
          ) : undefined
        }
      />

      {hasOwnRecipes ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scopeChipsRow}
        >
          {SCOPE_ORDER.map((viewId) => {
            if (
              viewId === LIBRARY_VIEW.SHARED &&
              counts.shared === 0 &&
              effectiveView !== LIBRARY_VIEW.SHARED
            ) {
              return null;
            }
            const cfg = VIEW_CONFIGS[viewId];
            const selected = effectiveView === viewId;
            const count = counts[viewId];
            return (
              <PressableScale
                key={viewId}
                testID={cfg.testID}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => handleSelectView(viewId)}
                style={[
                  styles.scopeChip,
                  viewId === LIBRARY_VIEW.TO_TRY && !selected && styles.scopeChipToTry,
                  selected && styles.scopeChipSelected,
                ]}
              >
                <Text
                  allowFontScaling={false}
                  style={[styles.scopeChipLabel, selected && styles.scopeChipLabelSelected]}
                >
                  {cfg.label}
                </Text>
                <View style={[styles.countBadge, selected && styles.countBadgeSelected]}>
                  <Text
                    allowFontScaling={false}
                    style={[styles.countText, selected && styles.countTextSelected]}
                  >
                    {String(count)}
                  </Text>
                </View>
              </PressableScale>
            );
          })}
        </ScrollView>
      ) : null}

      {!initialLoading && recipesInView.length > 0 ? (
        <View style={styles.filterBlock}>
          <View style={styles.searchWrap}>
            <Ionicons name="search-outline" size={17} color={colors.ink3} />
            <TextInput
              testID="library-search-input"
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="חיפוש בספרייה..."
              placeholderTextColor={colors.ink4}
              autoCorrect={false}
              returnKeyType="search"
              style={styles.searchInput}
            />
            {searchQuery.length > 0 ? (
              <Pressable
                onPress={() => setSearchQuery('')}
                accessibilityLabel="נקה חיפוש"
                hitSlop={8}
              >
                <Ionicons name="close-circle" size={17} color={colors.ink3} />
              </Pressable>
            ) : null}
          </View>

          {availableCategories.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoryChipsRow}
            >
              <PressableScale
                onPress={() => setSelectedCategory('all')}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedCategory === 'all' }}
                style={[
                  styles.categoryChip,
                  selectedCategory === 'all' && styles.categoryChipSelected,
                ]}
              >
                <Text
                  allowFontScaling={false}
                  style={[
                    styles.categoryChipText,
                    selectedCategory === 'all' && styles.categoryChipTextSelected,
                  ]}
                >
                  כל הקטגוריות
                </Text>
              </PressableScale>

              {availableCategories.map((catId) => {
                const isSelected = selectedCategory === catId;
                return (
                  <PressableScale
                    key={catId}
                    onPress={() => setSelectedCategory(catId)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    style={[styles.categoryChip, isSelected && styles.categoryChipSelected]}
                  >
                    <Text
                      allowFontScaling={false}
                      style={[
                        styles.categoryChipText,
                        isSelected && styles.categoryChipTextSelected,
                      ]}
                    >
                      {getLocalizedCategoryName(catId)}
                    </Text>
                  </PressableScale>
                );
              })}
            </ScrollView>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  const emptyComponent = initialLoading ? (
    <View style={styles.skeletonGrid}>
      {[0, 1, 2, 3].map((idx) => (
        <View key={idx} style={styles.skeletonCard}>
          <Skeleton height={116} radius={radii.md} />
          <View style={styles.skeletonBody}>
            <Skeleton width="80%" height={15} />
            <Skeleton width="50%" height={12} />
          </View>
        </View>
      ))}
    </View>
  ) : recipesInView.length === 0 ? (
    <EmptyState
      testID="library-empty-state"
      icon={emptyToBook ? 'book-outline' : 'bookmarks-outline'}
      title={viewConfig.emptyTitle}
      subtitle={viewConfig.emptyText}
      actionLabel={emptyToBook ? 'לספר המשפחתי' : 'מתכון חדש'}
      onAction={() => router.push(emptyToBook ? '/(tabs)/categories' : '/(tabs)/propose-recipe')}
    />
  ) : (
    <EmptyState
      icon="search-outline"
      title="לא נמצאו מתכונים"
      subtitle="נסו לשנות את מילות החיפוש או לבחור קטגוריה אחרת."
      actionLabel="ניקוי סינון"
      onAction={() => {
        setSearchQuery('');
        setSelectedCategory('all');
      }}
    />
  );

  return (
    <View testID="my-recipes-screen" style={styles.screen}>
      <FlatList
        data={initialLoading ? [] : filteredRecipes}
        keyExtractor={(item) => item.id}
        numColumns={2}
        renderItem={renderRecipeCard}
        ListHeaderComponent={headerNode}
        ListEmptyComponent={emptyComponent}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.listContent}
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
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface0,
  },
  listContent: {
    paddingBottom: spacing['2xl'],
    flexGrow: 1,
  },
  headerBlock: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  scopeChipsRow: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    paddingVertical: 2,
  },
  scopeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    minHeight: 38,
  },
  scopeChipToTry: {
    borderStyle: 'dashed',
    borderColor: colors.ink3,
  },
  scopeChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  scopeChipLabel: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink2,
    includeFontPadding: false,
  },
  scopeChipLabelSelected: {
    fontFamily: fontFamilies.bodyBold,
    color: colors.buttonColor,
  },
  countBadge: {
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeSelected: {
    backgroundColor: colors.primaryDark,
  },
  countText: {
    fontSize: 11,
    fontFamily: fontFamilies.bodyBold,
    color: colors.ink3,
    includeFontPadding: false,
  },
  countTextSelected: {
    color: colors.buttonColor,
  },
  filterBlock: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    borderRadius: radii.md,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
  },
  searchInput: {
    flex: 1,
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink,
    paddingVertical: 8,
    textAlign: 'right',
  },
  categoryChipsRow: {
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
  },
  categoryChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.hairline,
    minHeight: 32,
    justifyContent: 'center',
  },
  categoryChipSelected: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  categoryChipText: {
    fontSize: 12,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink2,
    includeFontPadding: false,
  },
  categoryChipTextSelected: {
    color: colors.buttonColor,
    fontFamily: fontFamilies.bodyBold,
  },
  gridRow: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  cardColumn: {
    flex: 1,
    maxWidth: '50%',
  },
  card: {
    flex: 1,
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: 'hidden',
    ...shadows.level1,
  },
  photoWrap: {
    width: '100%',
    height: 120,
    backgroundColor: colors.surface2,
    position: 'relative',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  photoPlaceholderIcon: {
    fontSize: 34,
  },
  badgeOverlay: {
    position: 'absolute',
    top: spacing.sm,
    start: spacing.sm,
    end: 44,
    alignItems: 'flex-start',
  },
  addMealBtn: {
    position: 'absolute',
    top: spacing.sm,
    end: spacing.sm,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: statusColors.whiteAlpha85,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.level1,
  },
  cardBody: {
    padding: spacing.md,
    gap: spacing.xs,
    flex: 1,
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    lineHeight: 21,
    textAlign: 'left',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  metaPill: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
  },
  metaPillText: {
    fontSize: 11,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink2,
    includeFontPadding: false,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  metaText: {
    fontSize: 11.5,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    includeFontPadding: false,
  },
  markTestedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: spacing.xs,
    paddingVertical: 7,
    paddingHorizontal: 10,
    minHeight: 34,
    borderRadius: radii.sm,
    backgroundColor: statusColors.approvedBg,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  markTestedText: {
    fontSize: 12.5,
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
    includeFontPadding: false,
  },
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  skeletonCard: {
    width: '47%',
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: 'hidden',
  },
  skeletonBody: {
    padding: spacing.md,
    gap: spacing.sm,
  },
});
