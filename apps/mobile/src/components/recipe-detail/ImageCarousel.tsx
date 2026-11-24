import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  type ViewToken,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radii, shadows, spacing, statusColors } from '@/theme';
import { Skeleton } from '@/components/ui';
import type { RecipeImageEntry } from '@/services/recipes/recipe-service';
import { RecipeImageService } from '@/services/recipes/recipe-image-service';
import type { FullscreenMediaItem } from './FullscreenMediaModal';

export interface ImageCarouselProps {
  recipeId: string;
  images: RecipeImageEntry[];
  onPressImage?: (index: number, items: FullscreenMediaItem[]) => void;
  height?: number;
}

interface ResolvedSlide {
  key: string;
  entry: RecipeImageEntry;
  uri: string | null;
}

function getImmediateUrl(entry: RecipeImageEntry): string | null {
  if (typeof entry.preview === 'string' && entry.preview.trim()) return entry.preview.trim();
  if (
    typeof entry.url === 'string' &&
    (entry.url.startsWith('http://') ||
      entry.url.startsWith('https://') ||
      entry.url.startsWith('file://') ||
      entry.url.startsWith('data:'))
  ) {
    return entry.url.trim();
  }
  if (
    typeof entry.full === 'string' &&
    (entry.full.startsWith('http://') || entry.full.startsWith('https://'))
  ) {
    return entry.full.trim();
  }
  return null;
}

export function ImageCarousel({
  recipeId,
  images,
  onPressImage,
  height = 256,
}: ImageCarouselProps) {
  const sortedImages = useMemo(() => {
    if (!Array.isArray(images) || images.length === 0) return [];
    return [...images].sort((a, b) => {
      if (a?.isPrimary && !b?.isPrimary) return -1;
      if (!a?.isPrimary && b?.isPrimary) return 1;
      return 0;
    });
  }, [images]);

  const [containerWidth, setContainerWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, string | null>>({});
  const [resolving, setResolving] = useState(false);

  const flatListRef = useRef<FlatList<ResolvedSlide>>(null);
  const viewabilityConfigRef = useRef({ viewAreaCoveragePercentThreshold: 50 });

  const slides = useMemo<ResolvedSlide[]>(
    () =>
      sortedImages.map((entry, idx) => {
        const key = entry.id || entry.full || entry.url || `img-${idx}`;
        const uri = key in resolvedUrls ? resolvedUrls[key] : getImmediateUrl(entry);
        return { key, entry, uri };
      }),
    [sortedImages, resolvedUrls],
  );

  const imagesSignature = useMemo(
    () => sortedImages.map((img, i) => img.id || img.full || img.url || String(i)).join('|'),
    [sortedImages],
  );

  useEffect(() => {
    setActiveIndex(0);
    if (sortedImages.length === 0) {
      setResolvedUrls({});
      setResolving(false);
      return;
    }

    let active = true;
    setResolving(true);

    Promise.all(
      sortedImages.map(async (entry, idx) => {
        const key = entry.id || entry.full || entry.url || `img-${idx}`;
        try {
          const url = await RecipeImageService.getOptimizedUrl(entry, 'full');
          return [key, url || getImmediateUrl(entry)] as const;
        } catch {
          return [key, getImmediateUrl(entry)] as const;
        }
      }),
    )
      .then((pairs) => {
        if (!active) return;
        const map: Record<string, string | null> = {};
        for (const [k, u] of pairs) {
          map[k] = u;
        }
        setResolvedUrls(map);
      })
      .finally(() => {
        if (active) setResolving(false);
      });

    return () => {
      active = false;
    };
  }, [recipeId, imagesSignature, sortedImages]);

  const onViewableItemsChangedRef = useRef(
    ({ viewableItems }: { viewableItems: Array<ViewToken> }) => {
      const first = viewableItems[0];
      if (first && typeof first.index === 'number') {
        setActiveIndex(first.index);
      }
    },
  );

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const w = Math.floor(event.nativeEvent.layout.width);
    if (w > 0) setContainerWidth(w);
  }, []);

  const fullscreenItems = useMemo<FullscreenMediaItem[]>(() => {
    return slides
      .filter((s) => Boolean(s.uri))
      .map((s) => ({
        id: s.key,
        type: 'image' as const,
        uri: s.uri as string,
      }));
  }, [slides]);

  const handlePressSlide = useCallback(
    (slideIndex: number) => {
      if (!onPressImage || fullscreenItems.length === 0) return;
      const targetSlide = slides[slideIndex];
      const mappedIndex = targetSlide?.uri
        ? Math.max(
            0,
            fullscreenItems.findIndex((item) => item.id === targetSlide.key),
          )
        : 0;
      onPressImage(mappedIndex, fullscreenItems);
    },
    [onPressImage, fullscreenItems, slides],
  );

  const handleSelectDot = useCallback((index: number) => {
    setActiveIndex(index);
    flatListRef.current?.scrollToIndex({ index, animated: true });
  }, []);

  const renderSlide = useCallback(
    ({ item, index }: ListRenderItemInfo<ResolvedSlide>) => {
      const slideWidth = containerWidth > 0 ? containerWidth : 320;
      return (
        <Pressable
          testID={`recipe-carousel-slide-${index}`}
          accessibilityRole="button"
          accessibilityLabel={`צפייה בתמונת מתכון ${index + 1} במסך מלא`}
          onPress={() => handlePressSlide(index)}
          style={[styles.slide, { width: slideWidth, height }]}
        >
          {item.uri ? (
            <Image
              source={{ uri: item.uri }}
              style={styles.image}
              contentFit="cover"
              transition={200}
            />
          ) : resolving ? (
            <Skeleton width="100%" height={height} radius={0} />
          ) : (
            <View style={styles.fallbackBox}>
              <Ionicons name="image-outline" size={44} color={colors.ink4} />
            </View>
          )}
        </Pressable>
      );
    },
    [containerWidth, height, handlePressSlide, resolving],
  );

  if (sortedImages.length === 0) {
    return null;
  }

  const multiple = slides.length > 1;
  const clampedActive = Math.min(activeIndex, Math.max(0, slides.length - 1));

  return (
    <View
      testID="recipe-image-carousel"
      collapsable={false}
      onLayout={handleLayout}
      style={[styles.container, shadows.level1, { height }]}
    >
      {containerWidth > 0 ? (
        <FlatList
          ref={flatListRef}
          data={slides}
          keyExtractor={(item) => item.key}
          renderItem={renderSlide}
          horizontal
          pagingEnabled
          bounces={false}
          showsHorizontalScrollIndicator={false}
          getItemLayout={(_, index) => ({
            length: containerWidth,
            offset: containerWidth * index,
            index,
          })}
          onScrollToIndexFailed={({ index }) => {
            if (containerWidth > 0) {
              flatListRef.current?.scrollToOffset({
                offset: containerWidth * index,
                animated: true,
              });
            }
          }}
          onViewableItemsChanged={onViewableItemsChangedRef.current}
          viewabilityConfig={viewabilityConfigRef.current}
          extraData={resolvedUrls}
        />
      ) : (
        <Skeleton width="100%" height={height} radius={radii.xl} />
      )}

      {multiple ? (
        <View style={styles.counterBadge} pointerEvents="none">
          <Text style={styles.counterText} allowFontScaling={false}>
            {`\u2066${clampedActive + 1} / ${slides.length}\u2069`}
          </Text>
        </View>
      ) : null}

      <View style={styles.zoomHint} pointerEvents="none">
        <Ionicons name="expand-outline" size={16} color={colors.buttonColor} />
      </View>

      {multiple ? (
        <View style={styles.dotsRow}>
          {slides.map((slide, idx) => {
            const isActive = idx === clampedActive;
            return (
              <Pressable
                key={slide.key}
                onPress={() => handleSelectDot(idx)}
                accessibilityRole="button"
                accessibilityLabel={`תמונה ${idx + 1}`}
                hitSlop={8}
                style={[styles.dot, isActive && styles.dotActive]}
              />
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    borderRadius: radii.xl,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.hairline,
    position: 'relative',
  },
  slide: {
    overflow: 'hidden',
    backgroundColor: colors.surface2,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  fallbackBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  counterBadge: {
    position: 'absolute',
    top: spacing.md,
    end: spacing.md,
    backgroundColor: statusColors.darkScrim,
    borderRadius: radii.pill,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  counterText: {
    color: colors.buttonColor,
    fontSize: 12,
    fontFamily: fontFamilies.bodyMedium,
    includeFontPadding: false,
  },
  zoomHint: {
    position: 'absolute',
    bottom: spacing.md,
    end: spacing.md,
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    backgroundColor: statusColors.darkScrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotsRow: {
    position: 'absolute',
    bottom: spacing.md,
    start: spacing.lg,
    end: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: radii.pill,
    backgroundColor: statusColors.whiteAlpha85,
    opacity: 0.55,
  },
  dotActive: {
    width: 20,
    opacity: 1,
    backgroundColor: colors.buttonColor,
  },
});
