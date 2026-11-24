import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radii, spacing, statusColors, typeScale } from '@/theme';
import { PressableScale } from '@/components/ui';

export interface FullscreenMediaItem {
  id?: string;
  type: 'image' | 'video';
  uri: string;
  caption?: string;
}

export interface FullscreenMediaModalProps {
  visible: boolean;
  items: FullscreenMediaItem[];
  initialIndex?: number;
  onClose: () => void;
}

const DOUBLE_TAP_WINDOW_MS = 280;
const ANDROID_ZOOM_FACTOR = 2.25;

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildVideoHtml(videoUrl: string): string {
  const safeUrl = escapeHtmlAttr(videoUrl);
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: ${colors.ink};
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    video {
      width: 100%;
      height: 100%;
      max-width: 100vw;
      max-height: 100vh;
      object-fit: contain;
      background: ${colors.ink};
    }
  </style>
</head>
<body>
  <video controls playsinline webkit-playsinline preload="metadata" src="${safeUrl}"></video>
</body>
</html>`;
}

export function FullscreenMediaModal({
  visible,
  items,
  initialIndex = 0,
  onClose,
}: FullscreenMediaModalProps) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const [activeIndex, setActiveIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [mediaLoading, setMediaLoading] = useState(false);

  const lastTapRef = useRef<number>(0);
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!visible) {
      setZoomed(false);
      setMediaLoading(false);
      return;
    }
    const clamped = Math.max(0, Math.min(initialIndex, Math.max(0, items.length - 1)));
    setActiveIndex(clamped);
    setZoomed(false);
    setMediaLoading(true);
  }, [visible, initialIndex, items.length]);

  useEffect(() => {
    setZoomed(false);
    scrollViewRef.current?.scrollTo({ x: 0, y: 0, animated: false });
  }, [activeIndex]);

  const currentItem = items[activeIndex] ?? null;
  const hasMultiple = items.length > 1;

  const toggleZoom = useCallback(() => {
    setZoomed((prev) => {
      const next = !prev;
      if (!next) {
        scrollViewRef.current?.scrollTo({ x: 0, y: 0, animated: true });
      }
      return next;
    });
  }, []);

  const handleImagePress = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current <= DOUBLE_TAP_WINDOW_MS) {
      lastTapRef.current = 0;
      toggleZoom();
    } else {
      lastTapRef.current = now;
    }
  }, [toggleZoom]);

  const handlePrev = useCallback(() => {
    if (activeIndex <= 0) return;
    setActiveIndex((idx) => Math.max(0, idx - 1));
    setMediaLoading(true);
  }, [activeIndex]);

  const handleNext = useCallback(() => {
    if (activeIndex >= items.length - 1) return;
    setActiveIndex((idx) => Math.min(items.length - 1, idx + 1));
    setMediaLoading(true);
  }, [activeIndex, items.length]);

  const stageHeight = Math.max(260, screenHeight - insets.top - insets.bottom - 148);
  const imageWidth = zoomed ? screenWidth * ANDROID_ZOOM_FACTOR : screenWidth;
  const imageHeight = zoomed ? stageHeight * ANDROID_ZOOM_FACTOR : stageHeight;

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View testID="recipe-fullscreen-viewer" collapsable={false} style={styles.root}>
        <StatusBar barStyle="light-content" />

        {/* Top Bar */}
        <View style={[styles.topBar, { paddingTop: Math.max(insets.top, spacing.md) }]}>
          <PressableScale
            variant="icon"
            testID="fullscreen-viewer-close-btn"
            accessibilityRole="button"
            accessibilityLabel="סגור"
            onPress={onClose}
            style={styles.topIconBtn}
          >
            <Ionicons name="close" size={24} color={colors.buttonColor} />
          </PressableScale>

          {hasMultiple ? (
            <View style={styles.counterPill}>
              <Text style={styles.counterText} allowFontScaling={false}>
                {`\u2066${activeIndex + 1} / ${items.length}\u2069`}
              </Text>
            </View>
          ) : (
            <View />
          )}

          {currentItem?.type === 'image' ? (
            <PressableScale
              variant="icon"
              testID="fullscreen-viewer-zoom-btn"
              accessibilityRole="button"
              accessibilityLabel={zoomed ? 'הקטן תמונה' : 'הגדל תמונה'}
              onPress={toggleZoom}
              style={styles.topIconBtn}
            >
              <Ionicons
                name={zoomed ? 'contract-outline' : 'expand-outline'}
                size={21}
                color={colors.buttonColor}
              />
            </PressableScale>
          ) : (
            <View style={styles.topPlaceholder} />
          )}
        </View>

        {/* Media Stage */}
        <View style={[styles.stage, { height: stageHeight }]}>
          {visible && currentItem ? (
            currentItem.type === 'video' ? (
              <View style={styles.videoWrap}>
                <WebView
                  key={currentItem.uri}
                  source={{ html: buildVideoHtml(currentItem.uri) }}
                  style={styles.videoWebView}
                  originWhitelist={['*']}
                  javaScriptEnabled
                  allowsInlineMediaPlayback
                  allowsFullscreenVideo
                  mediaPlaybackRequiresUserAction={false}
                  onLoadEnd={() => setMediaLoading(false)}
                />
                {mediaLoading ? (
                  <View pointerEvents="none" style={styles.loaderOverlay}>
                    <ActivityIndicator size="large" color={colors.buttonColor} />
                  </View>
                ) : null}
              </View>
            ) : (
              <ScrollView
                ref={scrollViewRef}
                style={styles.zoomScroll}
                contentContainerStyle={[styles.zoomContent, zoomed && styles.zoomContentExpanded]}
                maximumZoomScale={3}
                minimumZoomScale={1}
                centerContent
                bouncesZoom
                showsHorizontalScrollIndicator={false}
                showsVerticalScrollIndicator={false}
                horizontal={zoomed}
              >
                <ScrollView
                  nestedScrollEnabled
                  scrollEnabled={zoomed}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.zoomInnerCenter}
                >
                  <Pressable
                    onPress={handleImagePress}
                    accessibilityRole="imagebutton"
                    accessibilityLabel="הקשה כפולה להגדלה או הקטנה"
                  >
                    <Image
                      source={{ uri: currentItem.uri }}
                      style={{ width: imageWidth, height: imageHeight }}
                      contentFit="contain"
                      transition={150}
                      onLoadEnd={() => setMediaLoading(false)}
                    />
                  </Pressable>
                </ScrollView>
              </ScrollView>
            )
          ) : null}
        </View>

        {/* Bottom Caption & Navigation Bar */}
        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          {currentItem?.caption ? (
            <Text style={styles.captionText}>{currentItem.caption}</Text>
          ) : currentItem?.type === 'image' ? (
            <Text style={styles.hintText} allowFontScaling={false}>
              הקישו פעמיים או צבטו כדי להגדיל
            </Text>
          ) : null}

          {hasMultiple ? (
            <View style={styles.navRow}>
              <PressableScale
                testID="fullscreen-viewer-prev-btn"
                disabled={activeIndex === 0}
                onPress={handlePrev}
                accessibilityRole="button"
                accessibilityLabel="הקודם"
                style={[styles.navBtn, activeIndex === 0 && styles.navBtnDisabled]}
              >
                <Ionicons name="chevron-forward" size={18} color={colors.buttonColor} />
                <Text style={styles.navBtnText} allowFontScaling={false}>
                  הקודם
                </Text>
              </PressableScale>

              <View style={styles.dotsWrap}>
                {items.map((item, idx) => (
                  <View
                    key={item.id || String(idx)}
                    style={[styles.dot, idx === activeIndex && styles.dotActive]}
                  />
                ))}
              </View>

              <PressableScale
                testID="fullscreen-viewer-next-btn"
                disabled={activeIndex >= items.length - 1}
                onPress={handleNext}
                accessibilityRole="button"
                accessibilityLabel="הבא"
                style={[styles.navBtn, activeIndex >= items.length - 1 && styles.navBtnDisabled]}
              >
                <Text style={styles.navBtnText} allowFontScaling={false}>
                  הבא
                </Text>
                <Ionicons name="chevron-back" size={18} color={colors.buttonColor} />
              </PressableScale>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.ink,
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  topIconBtn: {
    width: 42,
    height: 42,
    borderRadius: radii.pill,
    backgroundColor: statusColors.darkScrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topPlaceholder: {
    width: 42,
    height: 42,
  },
  counterPill: {
    backgroundColor: statusColors.darkScrim,
    borderRadius: radii.pill,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  counterText: {
    color: colors.buttonColor,
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyMedium,
    includeFontPadding: false,
  },
  stage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  zoomScroll: {
    flex: 1,
    width: '100%',
  },
  zoomContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomContentExpanded: {
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
  },
  zoomInnerCenter: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoWrap: {
    flex: 1,
    width: '100%',
    position: 'relative',
    backgroundColor: colors.ink,
  },
  videoWebView: {
    flex: 1,
    backgroundColor: colors.ink,
  },
  loaderOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  captionText: {
    color: colors.buttonColor,
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    lineHeight: 22,
    textAlign: 'center',
  },
  hintText: {
    color: colors.ink4,
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.body,
    textAlign: 'center',
    includeFontPadding: false,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  navBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    backgroundColor: statusColors.darkScrim,
    minHeight: 40,
  },
  navBtnDisabled: {
    opacity: 0.35,
  },
  navBtnText: {
    color: colors.buttonColor,
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyMedium,
    includeFontPadding: false,
  },
  dotsWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    flex: 1,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.ink4,
  },
  dotActive: {
    width: 16,
    backgroundColor: colors.buttonColor,
  },
});
