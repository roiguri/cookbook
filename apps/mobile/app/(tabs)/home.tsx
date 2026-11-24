import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { I18nManager, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CATEGORY_IDS, CATEGORY_MAP, STAGE } from '@cookbook/core/recipe-model';
import { getCategoryIcon } from '@cookbook/core/recipe-utils/recipe-data-utils';
import { colors, fontFamilies, radii, shadows, spacing, typeScale } from '@/theme';
import { Badge, Card, ConfirmDialog, PressableScale, useToast } from '@/components/ui';
import { RecipeStrip } from '@/components/browse';
import { APP_VARIANT, IS_DTU_MODE, checkDtuConnection } from '@/services/dtu-health-service';
import { getE2eTelemetrySummary, subscribeTelemetry } from '@/services/logger';
import { RecipeService, type RecipeDoc } from '@/services/recipes/recipe-service';
import { FavoritesService } from '@/services/users/favorites-service';
import { ActiveMealService } from '@/services/meals/active-meal-service';
import { useSession } from '@/context/SessionContext';

const FEATURED_LIMIT = 4;
const NEXT_STRIP_LIMIT = 4;

export default function HomeScreen() {
  const { user, profile, role, isAuthenticated, isApproved } = useSession();
  const { showToast } = useToast();

  const [dtuText, setDtuText] = useState('DTU: בודק חיבור...');
  const [telemetrySummary, setTelemetrySummary] = useState(getE2eTelemetrySummary());

  const [featuredRecipes, setFeaturedRecipes] = useState<RecipeDoc[]>([]);
  const [loadingFeatured, setLoadingFeatured] = useState(true);

  const [nextRecipes, setNextRecipes] = useState<RecipeDoc[]>([]);
  const [loadingNext, setLoadingNext] = useState(false);

  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loginPromptVisible, setLoginPromptVisible] = useState(false);

  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  useEffect(() => {
    const unsub = subscribeTelemetry(() => setTelemetrySummary(getE2eTelemetrySummary()));
    return unsub;
  }, []);

  useEffect(() => {
    if (!IS_DTU_MODE) return;
    let active = true;
    checkDtuConnection().then((res) => {
      if (!active) return;
      setDtuText(res.connected ? `DTU: מחובר (${res.profile || 'ready'})` : 'DTU: לא זמין');
    });
    return () => {
      active = false;
    };
  }, []);

  const loadFeatured = useCallback(async () => {
    try {
      const list = await RecipeService.listPublished({
        orderBy: ['creationTime', 'desc'],
        limit: FEATURED_LIMIT,
      });
      setFeaturedRecipes(list);
    } catch {
      // Keep prior state or empty gracefully
    } finally {
      setLoadingFeatured(false);
    }
  }, []);

  const loadNext = useCallback(async () => {
    if (!isAuthenticated || !isApproved || !user?.uid) {
      setNextRecipes([]);
      setLoadingNext(false);
      return;
    }
    setLoadingNext(true);
    try {
      const toTry = await RecipeService.listMine(user.uid, { stage: STAGE.TO_TRY });
      setNextRecipes(toTry);
    } catch {
      setNextRecipes([]);
    } finally {
      setLoadingNext(false);
    }
  }, [isAuthenticated, isApproved, user?.uid]);

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
    void loadFeatured();
  }, [loadFeatured]);

  useEffect(() => {
    void loadNext();
    void loadFavorites();
  }, [loadNext, loadFavorites]);

  // Refresh personal strips & favorites when returning to Home
  useFocusEffect(
    useCallback(() => {
      void loadFeatured();
      if (isAuthenticated && user?.uid) {
        void loadFavorites();
        if (isApproved) {
          void loadNext();
        }
      }
    }, [isAuthenticated, isApproved, user?.uid, loadFeatured, loadFavorites, loadNext]),
  );

  // Stay synchronized immediately with favorites toggled on Categories or My Recipes
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

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadFeatured(), loadNext(), loadFavorites()]);
    } finally {
      setRefreshing(false);
    }
  }, [loadFeatured, loadNext, loadFavorites]);

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

  const rtlLabel = I18nManager.isRTL ? 'RTL: פעיל' : 'RTL: כבוי';
  const showNextAllLink = nextRecipes.length > 2;
  const showNextAddTile = !loadingNext && nextRecipes.length < NEXT_STRIP_LIMIT;

  return (
    <>
      <ScrollView
        testID="home-screen"
        style={styles.screen}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
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
      >
        {/* Warm Editorial Hero + Prominent Search Entry */}
        <Card testID="home-hero" style={styles.heroCard}>
          <View style={styles.heroKickerRow}>
            <Ionicons name="sparkles-outline" size={14} color={colors.primaryDark} />
            <Text style={styles.heroKicker} allowFontScaling={false}>
              המטבח המשפחתי
            </Text>
          </View>

          <Text testID="home-hero-title" style={styles.heroTitle}>
            ספר המתכונים המשפחתי
          </Text>

          <Text style={styles.heroSubtitle}>
            {profile?.fullName
              ? `שלום ${profile.fullName}, מה נבשל היום?`
              : 'המתכונים האהובים של המשפחה, תמיד בהישג יד במטבח.'}
          </Text>

          <PressableScale
            variant="button"
            testID="home-hero-search"
            accessibilityRole="search"
            accessibilityLabel="חיפוש מתכונים"
            onPress={() =>
              router.push({
                pathname: '/(tabs)/categories',
                params: { focusSearch: String(Date.now()) },
              })
            }
            style={styles.heroSearchBar}
          >
            <Ionicons name="search-outline" size={18} color={colors.ink3} />
            <Text style={styles.heroSearchPlaceholder} numberOfLines={1}>
              חיפוש מתכונים, מרכיבים או תגיות...
            </Text>
          </PressableScale>
        </Card>

        {/* Horizontal RTL Category Strip (all 10 CATEGORY_IDS) */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>קטגוריות</Text>
            <PressableScale
              variant="button"
              testID="home-browse-all-btn"
              onPress={() => router.navigate('/(tabs)/categories')}
              style={styles.sectionLink}
            >
              <Text style={styles.sectionLinkText} allowFontScaling={false}>
                לכל המתכונים
              </Text>
              <Ionicons name="chevron-back" size={15} color={colors.primaryDark} />
            </PressableScale>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryScroll}
          >
            {CATEGORY_IDS.map((catId) => (
              <PressableScale
                key={catId}
                variant="card"
                testID={`home-category-tile-${catId}`}
                accessibilityRole="button"
                accessibilityLabel={CATEGORY_MAP[catId] || catId}
                onPress={() =>
                  router.push({
                    pathname: '/(tabs)/categories',
                    params: { category: catId },
                  })
                }
                style={[styles.categoryTile, shadows.level1]}
              >
                <View style={styles.categoryIconCircle}>
                  <Text style={styles.categoryEmoji} allowFontScaling={false}>
                    {getCategoryIcon(catId)}
                  </Text>
                </View>
                <Text style={styles.categoryTileLabel} numberOfLines={2} allowFontScaling={false}>
                  {CATEGORY_MAP[catId] || catId}
                </Text>
              </PressableScale>
            ))}
          </ScrollView>
        </View>

        {/* Personal "Next in the Kitchen" Strip (approved & manager only, placed above fold) */}
        {isAuthenticated && isApproved ? (
          <View testID="home-next-section" style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>הבא בתור במטבח</Text>
              {showNextAllLink ? (
                <PressableScale
                  variant="button"
                  testID="home-next-all-link"
                  onPress={() =>
                    router.push({
                      pathname: '/(tabs)/my-recipes',
                      params: { view: STAGE.TO_TRY },
                    })
                  }
                  style={styles.sectionLink}
                >
                  <Text style={styles.sectionLinkText} allowFontScaling={false}>
                    הכל
                  </Text>
                  <Ionicons name="chevron-back" size={15} color={colors.primaryDark} />
                </PressableScale>
              ) : null}
            </View>

            <RecipeStrip
              recipes={nextRecipes.slice(0, NEXT_STRIP_LIMIT)}
              loading={loadingNext}
              compactIfNoImages
              hideStatuses={[STAGE.TO_TRY]}
              favoriteIds={favoriteSet}
              showFavorite
              showAddToMeal={isAuthenticated}
              onPressRecipe={(recipe) => router.push(`/recipe/${recipe.id}`)}
              onToggleFavorite={(recipe) => {
                void handleToggleFavorite(recipe);
              }}
              onAddToMeal={(recipe) => {
                void handleAddToMeal(recipe);
              }}
              afterSlotFullWidth={nextRecipes.length === 0}
              afterSlot={
                showNextAddTile ? (
                  <PressableScale
                    variant="card"
                    testID="home-next-add-tile"
                    accessibilityRole="button"
                    accessibilityLabel="מתכון חדש"
                    onPress={() => router.navigate('/(tabs)/propose-recipe')}
                    style={[styles.addTile, nextRecipes.length === 0 && styles.addTileAlone]}
                  >
                    <View style={styles.addTileIcon}>
                      <Ionicons name="add" size={22} color={colors.primaryDark} />
                    </View>
                    <Text style={styles.addTileTitle}>מתכון חדש</Text>
                    <Text style={styles.addTileText}>
                      מצאתם מתכון שתרצו לנסות? כתבו אותו או ייבאו מקישור, והוא יחכה כאן.
                    </Text>
                  </PressableScale>
                ) : null
              }
            />
          </View>
        ) : null}

        {/* Featured / Newest Published Strip */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>מתכונים חדשים</Text>
            <PressableScale
              variant="button"
              testID="home-featured-all-link"
              onPress={() => router.navigate('/(tabs)/categories')}
              style={styles.sectionLink}
            >
              <Text style={styles.sectionLinkText} allowFontScaling={false}>
                כל המתכונים
              </Text>
              <Ionicons name="chevron-back" size={15} color={colors.primaryDark} />
            </PressableScale>
          </View>

          <RecipeStrip
            testID="home-featured-strip"
            recipes={featuredRecipes}
            loading={loadingFeatured}
            favoriteIds={favoriteSet}
            showFavorite
            showAddToMeal={isAuthenticated}
            onPressRecipe={(recipe) => router.push(`/recipe/${recipe.id}`)}
            onToggleFavorite={(recipe) => {
              void handleToggleFavorite(recipe);
            }}
            onAddToMeal={(recipe) => {
              void handleAddToMeal(recipe);
            }}
          />
        </View>

        {/* DTU & Zero-PII Telemetry Diagnostic Bar (APP_VARIANT=e2e only) */}
        {IS_DTU_MODE ? (
          <Card style={styles.e2eBar} elevated={false}>
            <View style={styles.e2eRow}>
              <Badge label={role} tone="neutral" />
              <Text testID="dtu-status-indicator" style={styles.e2eText}>
                {dtuText} · {rtlLabel} · {APP_VARIANT}
              </Text>
            </View>
            <Text testID="e2e-telemetry-status" style={styles.e2eMeta}>
              {telemetrySummary}
            </Text>
          </Card>
        ) : null}
      </ScrollView>

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
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface0,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.xl,
    paddingBottom: spacing['2xl'],
  },
  heroCard: {
    backgroundColor: colors.surface1,
    borderColor: colors.hairlineStrong,
    gap: spacing.sm,
  },
  heroKickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  heroKicker: {
    fontSize: 12,
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
    includeFontPadding: false,
  },
  heroTitle: {
    fontSize: typeScale.step4,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    textAlign: 'left',
  },
  heroSubtitle: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink2,
    lineHeight: 22,
    textAlign: 'left',
  },
  heroSearchBar: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
  },
  heroSearchPlaceholder: {
    flex: 1,
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    textAlign: 'left',
    includeFontPadding: false,
  },
  section: {
    gap: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: typeScale.step2,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    textAlign: 'left',
  },
  sectionLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  sectionLinkText: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
    includeFontPadding: false,
  },
  categoryScroll: {
    gap: spacing.sm,
    paddingVertical: 2,
    paddingEnd: spacing.xs,
  },
  categoryTile: {
    width: 96,
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    gap: spacing.xs,
  },
  categoryIconCircle: {
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryEmoji: {
    fontSize: 24,
    includeFontPadding: false,
  },
  categoryTileLabel: {
    fontSize: 12,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink,
    textAlign: 'center',
    lineHeight: 16,
    includeFontPadding: false,
  },
  addTile: {
    flex: 1,
    minHeight: 150,
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    padding: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  addTileAlone: {
    width: '100%',
    minHeight: 132,
  },
  addTileIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  addTileTitle: {
    fontSize: typeScale.step1,
    fontFamily: fontFamilies.heading,
    color: colors.primaryDark,
    textAlign: 'center',
  },
  addTileText: {
    fontSize: 12.5,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    textAlign: 'center',
    lineHeight: 18,
  },
  e2eBar: {
    backgroundColor: colors.surface2,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 4,
  },
  e2eRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  e2eText: {
    fontSize: 12,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink2,
    flex: 1,
    textAlign: 'left',
  },
  e2eMeta: {
    fontSize: 11,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    textAlign: 'left',
  },
});
