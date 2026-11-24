import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radii, spacing, statusColors, typeScale } from '@/theme';
import { EmptyState, PressableScale, Skeleton } from '@/components/ui';
import {
  MIN_ZOOM_SCALE,
  TOGGLE_ZOOM_SCALE,
  TocDrawer,
  ZoomablePage,
  type ZoomCommand,
} from '@/components/grandma';
import { useSession } from '@/context/SessionContext';
import {
  GRANDMA_COOKBOOK_COLLECTION,
  GRANDMA_COOKBOOK_DOC,
  PdfService,
  type PdfPageIndex,
} from '@/services/pdf/pdf-service';

export default function GrandmasCookingScreen() {
  const insets = useSafeAreaInsets();
  const { user, role, loading: sessionLoading, isApproved } = useSession();

  // P0 Strict Role Gate: ONLY approved family members and managers may access
  const hasAccess =
    !sessionLoading && Boolean(user) && (role === 'approved' || role === 'manager') && isApproved;

  const [pageIndex, setPageIndex] = useState<PdfPageIndex | null>(null);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [indexLoading, setIndexLoading] = useState<boolean>(true);
  const [indexReady, setIndexReady] = useState<boolean>(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [indexRetrySeq, setIndexRetrySeq] = useState<number>(0);

  const [pageUrls, setPageUrls] = useState<Record<number, string>>({});
  const [loadingPageUrl, setLoadingPageUrl] = useState<boolean>(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageRetrySeq, setPageRetrySeq] = useState<number>(0);

  const [tocOpen, setTocOpen] = useState<boolean>(false);
  const [fullscreen, setFullscreen] = useState<boolean>(false);
  const [zoomScale, setZoomScale] = useState<number>(MIN_ZOOM_SCALE);
  const [zoomCommand, setZoomCommand] = useState<ZoomCommand>({
    scale: MIN_ZOOM_SCALE,
    seq: 0,
  });

  const autoRetriedPagesRef = useRef<Set<number>>(new Set());

  // Redirect unauthorized guests / plain users immediately whenever screen is focused
  useFocusEffect(
    useCallback(() => {
      if (!sessionLoading && !hasAccess) {
        router.replace('/(tabs)/home');
      }
    }, [sessionLoading, hasAccess]),
  );

  // Immediately wipe viewer state & close modals on sign-out or role demotion
  useEffect(() => {
    if (!hasAccess) {
      setTocOpen(false);
      setFullscreen(false);
      setPageIndex(null);
      setIndexReady(false);
      setIndexError(null);
      setPageError(null);
      setZoomScale(MIN_ZOOM_SCALE);
    }
  }, [hasAccess]);

  // Fetch cookbook/recipes manifest ONLY after role gate passes
  useEffect(() => {
    if (!hasAccess) return;

    let cancelled = false;
    setIndexLoading(true);
    setIndexError(null);

    (async () => {
      try {
        const index = await PdfService.getPageIndex(
          GRANDMA_COOKBOOK_COLLECTION,
          GRANDMA_COOKBOOK_DOC,
        );
        if (cancelled) return;

        const derivedTotal = PdfService.getTotalPages(index);
        const restoredPage = await PdfService.getLastViewedPage(derivedTotal, user?.uid);
        if (cancelled) return;

        setPageIndex(index);
        setTotalPages(derivedTotal);
        setCurrentPage(restoredPage);
        setIndexReady(true);
        setIndexLoading(false);
      } catch {
        if (cancelled) return;
        setIndexError('לא הצלחנו לטעון את תוכן הספר. בדקו את החיבור ונסו שוב.');
        setIndexLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasAccess, user?.uid, indexRetrySeq]);

  // Resolve current page Storage URL, persist reading position, and prefetch adjacent pages
  useEffect(() => {
    if (!hasAccess || !indexReady) return;

    let cancelled = false;
    setPageError(null);

    void PdfService.saveLastViewedPage(currentPage, user?.uid);
    void PdfService.prefetchAdjacentPages(currentPage, totalPages);

    const memoryUrl = PdfService.getCachedPageUrlSync(currentPage);
    if (memoryUrl) {
      setPageUrls((prev) =>
        prev[currentPage] === memoryUrl ? prev : { ...prev, [currentPage]: memoryUrl },
      );
      setLoadingPageUrl(false);
      return;
    }

    setLoadingPageUrl(true);

    (async () => {
      try {
        const resolvedUrl = await PdfService.getPageUrl(currentPage);
        if (cancelled) return;
        setPageUrls((prev) => ({ ...prev, [currentPage]: resolvedUrl }));
        setLoadingPageUrl(false);
      } catch {
        if (cancelled) return;
        setLoadingPageUrl(false);
        setPageError('בדקו את החיבור לאינטרנט או נסו לרענן את העמוד.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasAccess, indexReady, currentPage, totalPages, user?.uid, pageRetrySeq]);

  const tocSections = useMemo(
    () => PdfService.buildTocSections(pageIndex, totalPages),
    [pageIndex, totalPages],
  );

  const activeCategory = useMemo(
    () => PdfService.getCategoryForPage(tocSections, currentPage),
    [tocSections, currentPage],
  );

  const activeRecipes = useMemo(
    () => PdfService.getRecipesForPage(tocSections, currentPage),
    [tocSections, currentPage],
  );

  const goToPage = useCallback(
    (target: number) => {
      const clamped = Math.max(1, Math.min(target, totalPages));
      setCurrentPage((prev) => {
        if (prev === clamped) return prev;
        return clamped;
      });
    },
    [totalPages],
  );

  const handlePrevPage = useCallback(() => {
    if (currentPage <= 1) return;
    goToPage(currentPage - 1);
  }, [currentPage, goToPage]);

  const handleNextPage = useCallback(() => {
    if (currentPage >= totalPages) return;
    goToPage(currentPage + 1);
  }, [currentPage, totalPages, goToPage]);

  const handleToggleZoom = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    const targetScale = zoomScale > 1.05 ? MIN_ZOOM_SCALE : TOGGLE_ZOOM_SCALE;
    setZoomCommand((prev) => ({ scale: targetScale, seq: prev.seq + 1 }));
  }, [zoomScale]);

  const handleRetryPage = useCallback(() => {
    const path = PdfService.getPageStoragePath(currentPage);
    autoRetriedPagesRef.current.delete(currentPage);
    setPageError(null);
    setPageUrls((prev) => {
      const next = { ...prev };
      delete next[currentPage];
      return next;
    });
    void PdfService.invalidatePageImageUrl(path).then(() => {
      setPageRetrySeq((s) => s + 1);
    });
  }, [currentPage]);

  const handleImageError = useCallback(() => {
    if (!autoRetriedPagesRef.current.has(currentPage)) {
      autoRetriedPagesRef.current.add(currentPage);
      const path = PdfService.getPageStoragePath(currentPage);
      setPageUrls((prev) => {
        const next = { ...prev };
        delete next[currentPage];
        return next;
      });
      void PdfService.invalidatePageImageUrl(path).then(() => {
        setPageRetrySeq((s) => s + 1);
      });
      return;
    }
    setPageError('לא הצלחנו לטעון את תמונת העמוד. נסו שוב כשהחיבור זמין.');
  }, [currentPage]);

  // Never render Grandma's Cookbook content while unauthorized or loading session
  if (!sessionLoading && !hasAccess) {
    return <Redirect href="/(tabs)/home" />;
  }
  if (!hasAccess) {
    return <View style={styles.screen} />;
  }

  const currentImageUrl = pageUrls[currentPage] ?? PdfService.getCachedPageUrlSync(currentPage);
  const canGoPrev = currentPage > 1;
  const canGoNext = currentPage < totalPages;
  const isZoomed = zoomScale > 1.05;

  const activeSubtitle =
    activeRecipes.length > 0
      ? activeCategory
        ? `${activeCategory.name} · ${activeRecipes[0].name}`
        : activeRecipes[0].name
      : activeCategory?.name || null;

  const pageIndicatorLabel = `עמוד ${currentPage} מתוך ${totalPages}`;

  return (
    <View testID="grandma-screen" style={styles.screen}>
      {/* Compact Editorial Header */}
      <View style={styles.header}>
        <View style={styles.titleCol}>
          <Text testID="grandma-title" style={styles.title} numberOfLines={2}>
            ספר המתכונים של סבתא
          </Text>
          {activeSubtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {activeSubtitle}
            </Text>
          ) : null}
        </View>

        <PressableScale
          variant="button"
          testID="grandma-toc-btn"
          onPress={() => setTocOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="פתח תוכן עניינים"
          style={styles.tocBtn}
        >
          <Ionicons name="list-outline" size={18} color={colors.primaryDark} />
          <Text style={styles.tocBtnText} allowFontScaling={false}>
            תוכן עניינים
          </Text>
        </PressableScale>
      </View>

      {/* Viewer Tools Strip */}
      <View style={styles.toolsBar}>
        <View style={styles.toolsHintWrap}>
          <Ionicons
            name={isZoomed ? 'hand-left-outline' : 'book-outline'}
            size={14}
            color={colors.ink3}
          />
          <Text style={styles.toolsHintText} numberOfLines={1} allowFontScaling={false}>
            {isZoomed ? `מוגדל ${zoomScale.toFixed(1)}x · גררו להזזה` : 'צבוט או הקש פעמיים להגדלה'}
          </Text>
        </View>

        <View style={styles.toolsActions}>
          <PressableScale
            variant="button"
            testID="grandma-zoom-reset-btn"
            onPress={handleToggleZoom}
            accessibilityRole="button"
            accessibilityLabel={isZoomed ? 'איפוס זום' : 'הגדלת עמוד'}
            style={[styles.toolPill, isZoomed && styles.toolPillActive]}
          >
            <Ionicons
              name={isZoomed ? 'contract-outline' : 'search-outline'}
              size={15}
              color={isZoomed ? colors.primaryDark : colors.ink2}
            />
            <Text
              style={[styles.toolPillText, isZoomed && styles.toolPillTextActive]}
              allowFontScaling={false}
            >
              {isZoomed ? 'איפוס 1x' : 'זום 2.5x'}
            </Text>
          </PressableScale>

          <PressableScale
            variant="icon"
            testID="grandma-fullscreen-btn"
            onPress={() => setFullscreen(true)}
            accessibilityRole="button"
            accessibilityLabel="מסך מלא"
            style={styles.fullscreenBtn}
          >
            <Ionicons name="expand-outline" size={17} color={colors.ink2} />
          </PressableScale>
        </View>
      </View>

      {/* Main Scanned Book Stage */}
      <View style={styles.stageContainer}>
        {indexLoading && !indexReady ? (
          <View style={styles.skeletonCard}>
            <Skeleton width="86%" height={24} radius={radii.sm} />
            <Skeleton width="100%" height={320} radius={radii.md} />
            <Skeleton width="60%" height={16} radius={radii.sm} />
          </View>
        ) : indexError && !indexReady ? (
          <EmptyState
            icon="library-outline"
            title="לא ניתן לטעון את הספר"
            subtitle={indexError}
            actionLabel="נסה שוב"
            onAction={() => setIndexRetrySeq((s) => s + 1)}
          />
        ) : (
          <ZoomablePage
            pageNumber={currentPage}
            imageUrl={currentImageUrl}
            loadingUrl={loadingPageUrl}
            errorText={pageError}
            onRetry={handleRetryPage}
            onImageError={handleImageError}
            canGoPrev={canGoPrev}
            canGoNext={canGoNext}
            onSwipePrev={handlePrevPage}
            onSwipeNext={handleNextPage}
            zoomCommand={zoomCommand}
            onZoomChange={setZoomScale}
            exposeTestID={!fullscreen}
          />
        )}
      </View>

      {/* RTL Page Navigation Bar (Start/Right = הקודם, Center = עמוד X מתוך Y, End/Left = הבא) */}
      <View style={styles.navBar}>
        <PressableScale
          variant="button"
          testID="grandma-prev-btn"
          disabled={!canGoPrev}
          onPress={handlePrevPage}
          accessibilityRole="button"
          accessibilityLabel="עמוד קודם"
          accessibilityState={{ disabled: !canGoPrev }}
          style={[styles.navBtn, !canGoPrev && styles.navBtnDisabled]}
        >
          <Ionicons
            name="chevron-forward"
            size={18}
            color={canGoPrev ? colors.buttonColor : colors.ink4}
          />
          <Text
            style={[styles.navBtnText, !canGoPrev && styles.navBtnTextDisabled]}
            allowFontScaling={false}
          >
            הקודם
          </Text>
        </PressableScale>

        <View style={styles.pageIndicatorPill}>
          <Text
            testID="grandma-page-indicator"
            style={styles.pageIndicatorText}
            allowFontScaling={false}
          >
            {pageIndicatorLabel}
          </Text>
        </View>

        <PressableScale
          variant="button"
          testID="grandma-next-btn"
          disabled={!canGoNext}
          onPress={handleNextPage}
          accessibilityRole="button"
          accessibilityLabel="עמוד הבא"
          accessibilityState={{ disabled: !canGoNext }}
          style={[styles.navBtn, !canGoNext && styles.navBtnDisabled]}
        >
          <Text
            style={[styles.navBtnText, !canGoNext && styles.navBtnTextDisabled]}
            allowFontScaling={false}
          >
            הבא
          </Text>
          <Ionicons
            name="chevron-back"
            size={18}
            color={canGoNext ? colors.buttonColor : colors.ink4}
          />
        </PressableScale>
      </View>

      {/* Searchable 2-Level RTL Table of Contents Drawer */}
      <TocDrawer
        visible={tocOpen}
        sections={tocSections}
        currentPage={currentPage}
        totalPages={totalPages}
        onSelectPage={goToPage}
        onClose={() => setTocOpen(false)}
      />

      {/* Immersive Fullscreen Viewer Modal */}
      <Modal
        visible={fullscreen}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setFullscreen(false)}
      >
        <GestureHandlerRootView style={styles.fullscreenRoot}>
          <View
            style={[
              styles.fullscreenTopBar,
              { paddingTop: Math.max(insets.top + spacing.xs, spacing.lg) },
            ]}
          >
            <PressableScale
              variant="icon"
              testID="grandma-fullscreen-close-btn"
              onPress={() => setFullscreen(false)}
              accessibilityRole="button"
              accessibilityLabel="סגור מסך מלא"
              style={styles.fullscreenControlBtn}
            >
              <Ionicons name="close" size={22} color={colors.buttonColor} />
            </PressableScale>

            <View style={styles.fullscreenIndicatorPill}>
              <Text style={styles.fullscreenIndicatorText} allowFontScaling={false}>
                {pageIndicatorLabel}
              </Text>
            </View>

            <PressableScale
              variant="button"
              testID="grandma-fullscreen-zoom-btn"
              onPress={handleToggleZoom}
              accessibilityRole="button"
              accessibilityLabel={isZoomed ? 'איפוס זום' : 'הגדלת עמוד'}
              style={styles.fullscreenZoomPill}
            >
              <Ionicons
                name={isZoomed ? 'contract-outline' : 'search-outline'}
                size={16}
                color={colors.buttonColor}
              />
              <Text style={styles.fullscreenZoomText} allowFontScaling={false}>
                {isZoomed ? '1x' : '2.5x'}
              </Text>
            </PressableScale>
          </View>

          <View style={styles.fullscreenStage}>
            <ZoomablePage
              pageNumber={currentPage}
              imageUrl={currentImageUrl}
              loadingUrl={loadingPageUrl}
              errorText={pageError}
              onRetry={handleRetryPage}
              onImageError={handleImageError}
              canGoPrev={canGoPrev}
              canGoNext={canGoNext}
              onSwipePrev={handlePrevPage}
              onSwipeNext={handleNextPage}
              zoomCommand={zoomCommand}
              onZoomChange={setZoomScale}
              fullscreen
              exposeTestID={fullscreen}
            />
          </View>

          <View
            style={[
              styles.fullscreenBottomBar,
              { paddingBottom: Math.max(insets.bottom + spacing.sm, spacing.lg) },
            ]}
          >
            <PressableScale
              variant="button"
              disabled={!canGoPrev}
              onPress={handlePrevPage}
              accessibilityRole="button"
              accessibilityLabel="עמוד קודם"
              style={[styles.fullscreenNavBtn, !canGoPrev && styles.fullscreenNavBtnDisabled]}
            >
              <Ionicons name="chevron-forward" size={18} color={colors.buttonColor} />
              <Text style={styles.fullscreenNavText} allowFontScaling={false}>
                הקודם
              </Text>
            </PressableScale>

            <PressableScale
              variant="button"
              disabled={!canGoNext}
              onPress={handleNextPage}
              accessibilityRole="button"
              accessibilityLabel="עמוד הבא"
              style={[styles.fullscreenNavBtn, !canGoNext && styles.fullscreenNavBtnDisabled]}
            >
              <Text style={styles.fullscreenNavText} allowFontScaling={false}>
                הבא
              </Text>
              <Ionicons name="chevron-back" size={18} color={colors.buttonColor} />
            </PressableScale>
          </View>
        </GestureHandlerRootView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    gap: spacing.sm,
  },
  titleCol: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontFamily: fontFamilies.heading,
    fontSize: typeScale.step2,
    color: colors.ink,
    textAlign: 'left',
    includeFontPadding: false,
  },
  subtitle: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: typeScale.stepMinus1,
    color: colors.primaryDark,
    textAlign: 'left',
    includeFontPadding: false,
  },
  tocBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface1,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    minHeight: 36,
    flexShrink: 0,
  },
  tocBtnText: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: typeScale.stepMinus1,
    color: colors.ink,
    includeFontPadding: false,
  },
  toolsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
    gap: spacing.sm,
  },
  toolsHintWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  toolsHintText: {
    flex: 1,
    fontFamily: fontFamilies.body,
    fontSize: typeScale.stepMinus1,
    color: colors.ink3,
    textAlign: 'left',
    includeFontPadding: false,
  },
  toolsActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 0,
  },
  toolPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surface1,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 32,
  },
  toolPillActive: {
    backgroundColor: statusColors.approvedBg,
    borderColor: colors.primary,
  },
  toolPillText: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: typeScale.stepMinus1,
    color: colors.ink2,
    includeFontPadding: false,
  },
  toolPillTextActive: {
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
  },
  fullscreenBtn: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageContainer: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  skeletonCard: {
    flex: 1,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface2,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  navBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    minHeight: 40,
    minWidth: 86,
  },
  navBtnDisabled: {
    backgroundColor: colors.neutral,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  navBtnText: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: typeScale.stepMinus1,
    color: colors.buttonColor,
    includeFontPadding: false,
  },
  navBtnTextDisabled: {
    color: colors.ink4,
  },
  pageIndicatorPill: {
    backgroundColor: colors.surface1,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageIndicatorText: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: typeScale.stepMinus1,
    color: colors.ink2,
    textAlign: 'center',
    includeFontPadding: false,
  },
  fullscreenRoot: {
    flex: 1,
    backgroundColor: colors.ink,
  },
  fullscreenTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  fullscreenControlBtn: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    backgroundColor: statusColors.darkScrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullscreenIndicatorPill: {
    backgroundColor: statusColors.darkScrim,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  fullscreenIndicatorText: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: typeScale.stepMinus1,
    color: colors.buttonColor,
    includeFontPadding: false,
  },
  fullscreenZoomPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: statusColors.darkScrim,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    minHeight: 36,
  },
  fullscreenZoomText: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: typeScale.stepMinus1,
    color: colors.buttonColor,
    includeFontPadding: false,
  },
  fullscreenStage: {
    flex: 1,
  },
  fullscreenBottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  fullscreenNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: statusColors.darkScrim,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    minHeight: 42,
  },
  fullscreenNavBtnDisabled: {
    opacity: 0.35,
  },
  fullscreenNavText: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: typeScale.stepMinus1,
    color: colors.buttonColor,
    includeFontPadding: false,
  },
});
