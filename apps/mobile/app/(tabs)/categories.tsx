import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { FilterUtils } from '@cookbook/core/filter-utils';
import { CATEGORY_IDS, CATEGORY_MAP } from '@cookbook/core/recipe-model';
import { getLocalizedCategoryName } from '@cookbook/core/recipe-utils/recipe-data-utils';
import { colors, fontFamilies, radii, spacing, typeScale } from '@/theme';
import {
  Button,
  Chip,
  ConfirmDialog,
  EmptyState,
  PressableScale,
  ScreenHeader,
  Skeleton,
  useToast,
} from '@/components/ui';
import {
  EMPTY_FILTERS,
  FilterSheet,
  RecipeCard,
  countActiveFilters,
  type RecipeFilters,
} from '@/components/browse';
import { RecipeService, type RecipeDoc } from '@/services/recipes/recipe-service';
import { RecipeSearchService } from '@/services/recipes/recipe-search-service';
import { FavoritesService } from '@/services/users/favorites-service';
import { ActiveMealService } from '@/services/meals/active-meal-service';
import { useSession } from '@/context/SessionContext';

const PAGE_SIZE = 12;

function firstParam(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val[0] || '';
  return typeof val === 'string' ? val : '';
}

function normalizeCategoryParam(raw: string): string {
  if (!raw || raw === 'all') return 'all';
  return CATEGORY_IDS.includes(raw) ? raw : 'all';
}

export default function CategoriesScreen() {
  const params = useLocalSearchParams<{
    category?: string | string[];
    q?: string | string[];
    favorites?: string | string[];
    focusSearch?: string | string[];
  }>();

  const { user, role, isAuthenticated } = useSession();
  const { showToast } = useToast();

  const initialCategory = normalizeCategoryParam(firstParam(params.category));
  const initialQuery = firstParam(params.q);
  const initialFavorites = firstParam(params.favorites) === 'true' && isAuthenticated;

  const [selectedCategory, setSelectedCategory] = useState<string>(initialCategory);
  const [searchInput, setSearchInput] = useState<string>(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState<string>(initialQuery);
  const [filters, setFilters] = useState<RecipeFilters>({
    ...EMPTY_FILTERS,
    tags: [],
    favoritesOnly: initialFavorites,
  });

  const [baseRecipes, setBaseRecipes] = useState<RecipeDoc[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [filterSheetVisible, setFilterSheetVisible] = useState<boolean>(false);
  const [loginPromptVisible, setLoginPromptVisible] = useState<boolean>(false);
  const [visibleCount, setVisibleCount] = useState<number>(PAGE_SIZE);

  const searchInputRef = useRef<TextInput>(null);
  const requestSeqRef = useRef<number>(0);
  const prevAuthRef = useRef<boolean>(isAuthenticated);
  const prevParamsRef = useRef({
    category: firstParam(params.category),
    q: firstParam(params.q),
    favorites: firstParam(params.favorites),
    focusSearch: firstParam(params.focusSearch),
  });

  // Sync incoming route params (?category=<id>&q=<query>&favorites=true&focusSearch=...)
  useEffect(() => {
    const nextCategoryRaw = firstParam(params.category);
    const nextQ = firstParam(params.q);
    const nextFav = firstParam(params.favorites);
    const nextFocus = firstParam(params.focusSearch);

    const prev = prevParamsRef.current;

    if (nextCategoryRaw !== prev.category) {
      setSelectedCategory(normalizeCategoryParam(nextCategoryRaw));
    }

    if (nextQ !== prev.q) {
      setSearchInput(nextQ);
      setDebouncedQuery(nextQ);
    }

    if (nextFav !== prev.favorites) {
      const wantFav = nextFav === 'true' && isAuthenticated;
      setFilters((curr) => ({ ...curr, favoritesOnly: wantFav }));
    }

    if (nextFocus && nextFocus !== prev.focusSearch) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 150);
    }

    prevParamsRef.current = {
      category: nextCategoryRaw,
      q: nextQ,
      favorites: nextFav,
      focusSearch: nextFocus,
    };
  }, [params.category, params.q, params.favorites, params.focusSearch, isAuthenticated]);

  // Focus search input on initial mount if navigated from Home hero search
  useEffect(() => {
    if (firstParam(params.focusSearch)) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 180);
      return () => clearTimeout(timer);
    }
  }, []);

  // Reset favorites filter automatically on sign-out
  useEffect(() => {
    const wasAuth = prevAuthRef.current;
    prevAuthRef.current = isAuthenticated;

    if (wasAuth && !isAuthenticated) {
      FavoritesService.clearCache();
      setFavoriteIds([]);
      setFilters((prev) => (prev.favoritesOnly ? { ...prev, favoritesOnly: false } : prev));
    }
  }, [isAuthenticated]);

  // Debounce live typing (instant when cleared)
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (!trimmed) {
      setDebouncedQuery('');
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedQuery(searchInput);
    }, 220);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Load favorites for signed-in user
  const loadFavorites = useCallback(async () => {
    if (!isAuthenticated || !user?.uid) {
      setFavoriteIds([]);
      return;
    }
    try {
      const ids = await FavoritesService.getFavoriteIds(user.uid);
      setFavoriteIds(ids);
    } catch {
      // Keep current list on transient error
    }
  }, [isAuthenticated, user?.uid]);

  useEffect(() => {
    void loadFavorites();
  }, [loadFavorites]);

  // Subscribe to cross-screen favorite broadcasts
  useEffect(() => {
    return FavoritesService.subscribeFavoriteChanges(({ recipeId, isFavorite, userId }) => {
      if (!user?.uid || userId !== user.uid) return;
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (isFavorite) next.add(recipeId);
        else next.delete(recipeId);
        return Array.from(next);
      });
    });
  }, [user?.uid]);

  // Race-condition-safe recipe loader using monotonic request counter
  const fetchRecipes = useCallback(
    async (opts?: { silent?: boolean }) => {
      const reqId = ++requestSeqRef.current;
      if (!opts?.silent) setLoading(true);

      const queryText = debouncedQuery.trim();
      try {
        let fetched: RecipeDoc[];
        if (queryText) {
          const { recipes } = await RecipeSearchService.searchUnified(queryText, {
            role,
            uid: user?.uid || null,
            category: selectedCategory,
          });
          fetched = recipes;
        } else {
          fetched = await RecipeService.listPublished(
            selectedCategory !== 'all' ? { category: selectedCategory } : {},
          );
        }

        // Discard stale responses from earlier rapid category/search switches
        if (reqId !== requestSeqRef.current) return;
        setBaseRecipes(fetched);
      } catch {
        if (reqId !== requestSeqRef.current) return;
        setBaseRecipes([]);
      } finally {
        if (reqId === requestSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [debouncedQuery, role, user?.uid, selectedCategory],
  );

  useEffect(() => {
    void fetchRecipes();
  }, [fetchRecipes]);

  useFocusEffect(
    useCallback(() => {
      if (isAuthenticated && user?.uid) {
        void loadFavorites();
      }
    }, [isAuthenticated, user?.uid, loadFavorites]),
  );

  // Apply multi-facet filters via `@cookbook/core/filter-utils` FilterUtils.applyFilters
  const filteredRecipes = useMemo(() => {
    const safeFilters: RecipeFilters = {
      ...filters,
      favoritesOnly: isAuthenticated ? filters.favoritesOnly : false,
    };
    return (FilterUtils as any).applyFilters(baseRecipes, safeFilters, favoriteIds) as RecipeDoc[];
  }, [baseRecipes, filters, favoriteIds, isAuthenticated]);

  // Reset pagination whenever category, query, or filters change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [selectedCategory, debouncedQuery, filters]);

  const paginatedRecipes = useMemo(
    () => filteredRecipes.slice(0, visibleCount),
    [filteredRecipes, visibleCount],
  );

  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const activeFilterCount = useMemo(
    () =>
      countActiveFilters({
        ...filters,
        favoritesOnly: isAuthenticated ? filters.favoritesOnly : false,
      }),
    [filters, isAuthenticated],
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([fetchRecipes({ silent: true }), loadFavorites()]);
    } finally {
      setRefreshing(false);
    }
  }, [fetchRecipes, loadFavorites]);

  const handleSelectCategory = useCallback((catId: string) => {
    setSelectedCategory(catId);
    prevParamsRef.current.category = catId === 'all' ? '' : catId;
    router.setParams({ category: catId === 'all' ? '' : catId });
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchInput('');
    setDebouncedQuery('');
    prevParamsRef.current.q = '';
    router.setParams({ q: '' });
  }, []);

  const handleResetAll = useCallback(() => {
    setSelectedCategory('all');
    setSearchInput('');
    setDebouncedQuery('');
    setFilters({ ...EMPTY_FILTERS, tags: [] });
    prevParamsRef.current.category = '';
    prevParamsRef.current.q = '';
    prevParamsRef.current.favorites = '';
    router.setParams({ category: '', q: '', favorites: '' });
  }, []);

  const handleToggleFavorite = useCallback(
    async (recipe: RecipeDoc) => {
      if (!isAuthenticated || !user?.uid) {
        setLoginPromptVisible(true);
        return;
      }
      try {
        await FavoritesService.toggleFavorite(user.uid, recipe.id, favoriteIds);
      } catch {
        showToast('לא ניתן לעדכן מועדפים כרגע. נסה שוב.', 'error');
      }
    },
    [isAuthenticated, user?.uid, favoriteIds, showToast],
  );

  const handleAddToMeal = useCallback(
    async (recipe: RecipeDoc) => {
      if (!isAuthenticated || !user?.uid) {
        setLoginPromptVisible(true);
        return;
      }
      try {
        const res = await ActiveMealService.addToMeal(user.uid, recipe.id);
        if (res.success) {
          showToast('המתכון נוסף לארוחה שלך בהצלחה', 'success');
        } else if (res.reason === 'duplicate') {
          showToast('המתכון כבר נמצא בארוחה שלך', 'info');
        } else {
          showToast('שגיאה בהוספת המתכון לארוחה', 'error');
        }
      } catch {
        showToast('שגיאה בהוספת המתכון לארוחה', 'error');
      }
    },
    [isAuthenticated, user?.uid, showToast],
  );

  const handleLoadMore = useCallback(() => {
    if (visibleCount < filteredRecipes.length) {
      setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, filteredRecipes.length));
    }
  }, [visibleCount, filteredRecipes.length]);

  const screenTitle = useMemo(() => {
    if (filters.favoritesOnly && isAuthenticated) return 'מתכונים ששמרתי';
    if (debouncedQuery.trim()) return `תוצאות חיפוש: "${debouncedQuery.trim()}"`;
    if (selectedCategory !== 'all') return getLocalizedCategoryName(selectedCategory);
    return 'מתכונים';
  }, [filters.favoritesOnly, isAuthenticated, debouncedQuery, selectedCategory]);

  const screenSubtitle = loading ? 'טוען מתכונים...' : `${filteredRecipes.length} מתכונים`;

  const renderRecipeItem = useCallback(
    ({ item }: { item: RecipeDoc }) => (
      <View style={styles.gridCell}>
        <RecipeCard
          recipe={item}
          isFavorite={favoriteSet.has(item.id)}
          showFavorite
          showAddToMeal={isAuthenticated}
          onPress={(recipe) => router.push(`/recipe/${recipe.id}`)}
          onToggleFavorite={(recipe) => {
            void handleToggleFavorite(recipe);
          }}
          onAddToMeal={(recipe) => {
            void handleAddToMeal(recipe);
          }}
          style={styles.cardFill}
        />
      </View>
    ),
    [favoriteSet, isAuthenticated, handleToggleFavorite, handleAddToMeal],
  );

  const renderFooter = () => {
    if (loading || filteredRecipes.length === 0) return null;
    const hasMore = visibleCount < filteredRecipes.length;
    return (
      <View style={styles.footer}>
        <Text style={styles.footerCount}>
          מציג {paginatedRecipes.length} מתוך {filteredRecipes.length} מתכונים
        </Text>
        {hasMore ? (
          <Button
            label="טען עוד מתכונים"
            variant="secondary"
            size="sm"
            onPress={handleLoadMore}
            testID="categories-load-more-btn"
          />
        ) : null}
      </View>
    );
  };

  const renderEmpty = () => {
    if (loading) {
      return (
        <View style={styles.skeletonGrid}>
          {[0, 1].map((row) => (
            <View key={row} style={styles.skeletonRow}>
              {[0, 1].map((col) => (
                <View key={col} style={styles.skeletonCard}>
                  <Skeleton height={124} radius={radii.md} />
                  <View style={styles.skeletonBody}>
                    <Skeleton width="45%" height={12} />
                    <Skeleton width="85%" height={16} />
                    <Skeleton width="60%" height={12} />
                  </View>
                </View>
              ))}
            </View>
          ))}
        </View>
      );
    }

    return (
      <EmptyState
        testID="categories-empty-state"
        icon="search-outline"
        title="לא נמצאו מתכונים"
        subtitle="נסה לשנות את הקריטריונים או החיפוש"
        actionLabel="אפס הכל"
        onAction={handleResetAll}
        actionTestID="categories-empty-reset-btn"
      />
    );
  };

  return (
    <View testID="categories-screen" style={styles.screen}>
      <ScreenHeader title={screenTitle} subtitle={screenSubtitle} />

      {/* Search + Multi-Facet Filter Controls */}
      <View style={styles.controlsWrap}>
        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Ionicons name="search-outline" size={18} color={colors.ink3} />
            <TextInput
              ref={searchInputRef}
              testID="categories-search-input"
              value={searchInput}
              onChangeText={setSearchInput}
              placeholder="חיפוש מתכונים, קטגוריות או תגיות..."
              placeholderTextColor={colors.ink4}
              returnKeyType="search"
              style={styles.searchInput}
            />
            {searchInput.length > 0 ? (
              <PressableScale
                variant="icon"
                testID="categories-search-clear"
                accessibilityRole="button"
                accessibilityLabel="נקה חיפוש"
                hitSlop={8}
                onPress={handleClearSearch}
                style={styles.clearSearchBtn}
              >
                <Ionicons name="close-circle" size={18} color={colors.ink3} />
              </PressableScale>
            ) : null}
          </View>

          <PressableScale
            variant="button"
            testID="filter-open-btn"
            accessibilityRole="button"
            accessibilityLabel="עוד מסננים"
            onPress={() => setFilterSheetVisible(true)}
            style={[styles.filterBtn, activeFilterCount > 0 && styles.filterBtnActive]}
          >
            <Ionicons
              name="options-outline"
              size={17}
              color={activeFilterCount > 0 ? colors.buttonColor : colors.primaryDark}
            />
            <Text
              style={[styles.filterBtnText, activeFilterCount > 0 && styles.filterBtnTextActive]}
              allowFontScaling={false}
            >
              עוד מסננים
            </Text>
            {activeFilterCount > 0 ? (
              <View style={styles.filterCountPill}>
                <Text style={styles.filterCountText} allowFontScaling={false}>
                  {activeFilterCount}
                </Text>
              </View>
            ) : null}
          </PressableScale>
        </View>

        {/* Horizontal RTL Category Filter Chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryChipsRow}
        >
          <Chip
            label="כל הקטגוריות"
            selected={selectedCategory === 'all'}
            onPress={() => handleSelectCategory('all')}
            testID="category-chip-all"
          />
          {CATEGORY_IDS.map((catId) => (
            <Chip
              key={catId}
              label={CATEGORY_MAP[catId] || catId}
              selected={selectedCategory === catId}
              onPress={() => handleSelectCategory(catId)}
              testID={`category-chip-${catId}`}
            />
          ))}
        </ScrollView>
      </View>

      {/* Virtualized Recipe Grid */}
      <FlatList
        testID="recipe-list"
        data={loading ? [] : paginatedRecipes}
        renderItem={renderRecipeItem}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void handleRefresh();
            }}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      />

      <FilterSheet
        visible={filterSheetVisible}
        recipes={baseRecipes}
        currentFilters={filters}
        favoriteIds={favoriteIds}
        isAuthenticated={isAuthenticated}
        onApply={(next) => setFilters(next)}
        onClear={() => setFilters({ ...EMPTY_FILTERS, tags: [] })}
        onClose={() => setFilterSheetVisible(false)}
      />

      <ConfirmDialog
        visible={loginPromptVisible}
        title="התחברו כדי לשמור מתכונים מועדפים"
        message="כדי לשמור מתכונים למועדפים ולחזור אליהם בקלות במטבח, יש להתחבר לחשבון."
        confirmLabel="התחברות"
        cancelLabel="ביטול"
        onConfirm={() => {
          setLoginPromptVisible(false);
          router.push('/auth');
        }}
        onCancel={() => setLoginPromptVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface0,
  },
  controlsWrap: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface1,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    paddingHorizontal: spacing.md,
    minHeight: 42,
  },
  searchInput: {
    flex: 1,
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink,
    paddingVertical: 8,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  clearSearchBtn: {
    padding: 2,
  },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface1,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: spacing.md,
    minHeight: 42,
  },
  filterBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterBtnText: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
    includeFontPadding: false,
  },
  filterBtnTextActive: {
    color: colors.buttonColor,
  },
  filterCountPill: {
    minWidth: 20,
    height: 20,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  filterCountText: {
    fontSize: 11,
    fontFamily: fontFamilies.bodyBold,
    color: colors.buttonColor,
    includeFontPadding: false,
  },
  categoryChipsRow: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    paddingVertical: 2,
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing['2xl'],
    flexGrow: 1,
  },
  gridRow: {
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  gridCell: {
    flex: 1,
    maxWidth: '48.5%',
  },
  cardFill: {
    flex: 1,
  },
  footer: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  footerCount: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink3,
    includeFontPadding: false,
  },
  skeletonGrid: {
    gap: spacing.md,
  },
  skeletonRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  skeletonCard: {
    flex: 1,
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: 'hidden',
    padding: spacing.xs,
  },
  skeletonBody: {
    padding: spacing.sm,
    gap: spacing.sm,
  },
});
