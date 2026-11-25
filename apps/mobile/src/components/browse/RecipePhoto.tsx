import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { getPrimaryImage } from '@cookbook/core/recipe-utils/recipe-image-utils';
import { colors } from '@/theme';
import { RecipeImageService } from '@/services/recipes/recipe-image-service';
import { getCategoryImage } from '@/utils/category-images';

export interface RecipePhotoProps {
  recipe: {
    id: string;
    category?: string;
    images?: any[];
    [key: string]: any;
  };
  size?: 'thumb' | 'full';
  fallbackIconSize?: number;
  style?: StyleProp<ViewStyle>;
}

function getDirectImageUrl(recipe: RecipePhotoProps['recipe']): string | null {
  const primary = getPrimaryImage(recipe);
  if (typeof primary?.preview === 'string' && primary.preview) return primary.preview;
  if (typeof primary?.url === 'string' && primary.url.startsWith('http')) return primary.url;
  return null;
}

/**
 * Renders a recipe card photo with a warm pulsing loading shimmer whenever the
 * recipe has photos (`images.length > 0`), crossfading straight to the real
 * photo on load. The bundled category jar image is strictly used as a fallback
 * when the recipe has no photos (or if image resolution/loading fails).
 */
export function RecipePhoto({
  recipe,
  size = 'thumb',
  fallbackIconSize = 28,
  style,
}: RecipePhotoProps) {
  const hasImages = Array.isArray(recipe.images) && recipe.images.length > 0;
  const primaryImage = getPrimaryImage(recipe);
  const directUrl = hasImages ? getDirectImageUrl(recipe) : null;
  const imageKey = `${recipe.id}|${primaryImage?.full || primaryImage?.url || primaryImage?.preview || ''}|${hasImages ? '1' : '0'}`;

  const recipeRef = useRef(recipe);
  recipeRef.current = recipe;

  const [resolvedUrl, setResolvedUrl] = useState<string | null>(directUrl);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>(
    hasImages ? 'loading' : 'failed',
  );

  const pulseAnim = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    let active = true;

    if (!hasImages) {
      setResolvedUrl(null);
      setStatus('failed');
      return;
    }

    setResolvedUrl(directUrl);
    setStatus('loading');

    RecipeImageService.getPrimaryImageUrl(recipeRef.current as any, size)
      .then((url) => {
        if (!active) return;
        if (url) {
          setResolvedUrl(url);
        } else if (directUrl) {
          setResolvedUrl(directUrl);
        } else {
          setResolvedUrl(null);
          setStatus('failed');
        }
      })
      .catch(() => {
        if (!active) return;
        if (directUrl) {
          setResolvedUrl(directUrl);
        } else {
          setResolvedUrl(null);
          setStatus('failed');
        }
      });

    return () => {
      active = false;
    };
  }, [imageKey, hasImages, directUrl, size]);

  const showLoadingShimmer = hasImages && status === 'loading';

  useEffect(() => {
    if (!showLoadingShimmer) {
      pulseAnim.stopAnimation();
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 750,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.55,
          duration: 750,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [showLoadingShimmer, pulseAnim]);

  const categoryImage = getCategoryImage(recipe.category);
  const showFallback = !hasImages || status === 'failed';

  return (
    <View style={[styles.container, style]}>
      {showFallback ? (
        categoryImage ? (
          <Image source={categoryImage} style={styles.image} contentFit="cover" />
        ) : (
          <View style={styles.iconFallback}>
            <Ionicons name="restaurant-outline" size={fallbackIconSize} color={colors.ink3} />
          </View>
        )
      ) : (
        <>
          {showLoadingShimmer ? (
            <Animated.View pointerEvents="none" style={[styles.shimmer, { opacity: pulseAnim }]} />
          ) : null}

          {resolvedUrl ? (
            <Image
              source={{ uri: resolvedUrl }}
              style={styles.image}
              contentFit="cover"
              transition={220}
              onLoad={() => setStatus('loaded')}
              onError={() => {
                setResolvedUrl(null);
                setStatus('failed');
              }}
            />
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.surface2,
    position: 'relative',
    overflow: 'hidden',
  },
  shimmer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.neutral,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  iconFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
});
