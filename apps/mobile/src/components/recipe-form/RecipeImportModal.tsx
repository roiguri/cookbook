import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { parseYouTubeUrl } from '@cookbook/core/youtube-url';
import { colors, fontFamilies, radii, shadows, spacing, statusColors, typeScale } from '@/theme';
import { Button, PressableScale } from '@/components/ui';
import { GameHostModal } from '@/games-host';
import {
  RecipeImportService,
  type ExtractedRecipeData,
  type RecipeImportMode,
} from '@/services/recipes/recipe-import-service';

const MAX_IMPORT_IMAGES = 5;
const MAX_IMAGE_EDGE_PX = 1024;

interface ImportImageItem {
  id: string;
  uri: string;
  width?: number;
  height?: number;
  rotating?: boolean;
}

export interface RecipeImportModalProps {
  visible: boolean;
  initialMode?: RecipeImportMode;
  initialUrl?: string;
  initialImageUris?: string[];
  onClose: () => void;
  onExtracted: (result: { data: ExtractedRecipeData; sourceUrl: string | null }) => void;
}

type ModalPhase = 'input' | 'extracting' | 'error';

function isValidWebUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function makeTempId(): string {
  return `imp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function prepareImageForGemini(
  item: ImportImageItem,
): Promise<{ base64: string; mimeType: string }> {
  const actions: ImageManipulator.Action[] = [];
  if (item.width && item.height) {
    if (item.width > MAX_IMAGE_EDGE_PX || item.height > MAX_IMAGE_EDGE_PX) {
      if (item.width >= item.height) {
        actions.push({ resize: { width: MAX_IMAGE_EDGE_PX } });
      } else {
        actions.push({ resize: { height: MAX_IMAGE_EDGE_PX } });
      }
    }
  } else {
    actions.push({ resize: { width: MAX_IMAGE_EDGE_PX } });
  }

  const manipulated = await ImageManipulator.manipulateAsync(item.uri, actions, {
    compress: 0.8,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });

  if (!manipulated.base64) {
    throw new Error('Failed to encode image as base64');
  }
  return { base64: manipulated.base64, mimeType: 'image/jpeg' };
}

export function RecipeImportModal({
  visible,
  initialMode = 'image',
  initialUrl = '',
  initialImageUris,
  onClose,
  onExtracted,
}: RecipeImportModalProps) {
  const [mode, setMode] = useState<RecipeImportMode>(initialMode);
  const [images, setImages] = useState<ImportImageItem[]>([]);
  const [webUrl, setWebUrl] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [phase, setPhase] = useState<ModalPhase>('input');
  const [extractedData, setExtractedData] = useState<ExtractedRecipeData | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [limitNotice, setLimitNotice] = useState<string | null>(null);

  const requestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const deliveredRef = useRef(false);
  const prevVisibleRef = useRef(false);

  const cancelInFlight = useCallback(() => {
    requestIdRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  // Initialize / reset modal state whenever it opens or closes
  useEffect(() => {
    const justOpened = visible && !prevVisibleRef.current;
    prevVisibleRef.current = visible;

    if (justOpened) {
      cancelInFlight();
      deliveredRef.current = false;
      setPhase('input');
      setExtractedData(null);
      setSourceUrl(null);
      setErrorMessage(null);
      setLimitNotice(null);
      setMode(initialMode);

      if (initialMode === 'video') {
        setVideoUrl(initialUrl || '');
        setWebUrl('');
        setImages([]);
      } else if (initialMode === 'url') {
        setWebUrl(initialUrl || '');
        setVideoUrl('');
        setImages([]);
      } else {
        setWebUrl('');
        setVideoUrl('');
        setImages(
          (initialImageUris || []).slice(0, MAX_IMPORT_IMAGES).map((uri) => ({
            id: makeTempId(),
            uri,
          })),
        );
      }
    } else if (!visible) {
      cancelInFlight();
    }
  }, [visible, initialMode, initialUrl, initialImageUris, cancelInFlight]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelInFlight();
    };
  }, [cancelInFlight]);

  const videoValidation = useMemo(() => {
    const trimmed = videoUrl.trim();
    if (!trimmed) return { valid: false, showError: false };
    const parsed = parseYouTubeUrl(trimmed);
    const valid = Boolean(parsed && parsed.videoId);
    return { valid, showError: !valid };
  }, [videoUrl]);

  const canExtract = useMemo(() => {
    if (mode === 'image') return images.length > 0 && !images.some((i) => i.rotating);
    if (mode === 'url') return isValidWebUrl(webUrl);
    return videoValidation.valid;
  }, [mode, images, webUrl, videoValidation.valid]);

  const extractButtonLabel =
    mode === 'image' ? 'חלץ מתכון' : mode === 'video' ? 'ייבא מסרטון' : 'ייבא מכתובת';

  const switchTab = useCallback((nextMode: RecipeImportMode) => {
    setMode(nextMode);
    setErrorMessage(null);
    setLimitNotice(null);
    setPhase('input');
  }, []);

  const pickImagesFromLibrary = useCallback(async () => {
    setLimitNotice(null);
    const remaining = MAX_IMPORT_IMAGES - images.length;
    if (remaining <= 0) {
      setLimitNotice('ניתן להעלות עד 5 תמונות בלבד');
      return;
    }

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setErrorMessage('נדרשת הרשאת גישה לגלריה כדי לבחור תמונות.');
      return;
    }

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.9,
    });
    if (res.canceled || !res.assets?.length) return;

    const toAdd = res.assets.slice(0, remaining);
    if (res.assets.length > remaining) {
      setLimitNotice('ניתן להעלות עד 5 תמונות בלבד');
    }

    setImages((prev) => [
      ...prev,
      ...toAdd.map((asset) => ({
        id: makeTempId(),
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
      })),
    ]);
    setErrorMessage(null);
  }, [images.length]);

  const capturePhotoWithCamera = useCallback(async () => {
    setLimitNotice(null);
    if (images.length >= MAX_IMPORT_IMAGES) {
      setLimitNotice('ניתן להעלות עד 5 תמונות בלבד');
      return;
    }

    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setErrorMessage('נדרשת הרשאת גישה למצלמה כדי לצלם מתכון.');
      return;
    }

    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    if (res.canceled || !res.assets?.[0]) return;

    const asset = res.assets[0];
    setImages((prev) => [
      ...prev,
      {
        id: makeTempId(),
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
      },
    ]);
    setErrorMessage(null);
  }, [images.length]);

  const rotateImage = useCallback(
    async (id: string, degrees: 90 | -90) => {
      const target = images.find((img) => img.id === id);
      if (!target || target.rotating) return;

      setImages((prev) => prev.map((img) => (img.id === id ? { ...img, rotating: true } : img)));
      try {
        const rotated = await ImageManipulator.manipulateAsync(target.uri, [{ rotate: degrees }], {
          compress: 0.85,
          format: ImageManipulator.SaveFormat.JPEG,
        });
        setImages((prev) =>
          prev.map((img) =>
            img.id === id
              ? {
                  ...img,
                  uri: rotated.uri,
                  width: rotated.width,
                  height: rotated.height,
                  rotating: false,
                }
              : img,
          ),
        );
      } catch {
        setImages((prev) => prev.map((img) => (img.id === id ? { ...img, rotating: false } : img)));
      }
    },
    [images],
  );

  const moveImage = useCallback((index: number, delta: -1 | 1) => {
    setImages((prev) => {
      const nextIndex = index + delta;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[nextIndex];
      copy[nextIndex] = temp;
      return copy;
    });
  }, []);

  const removeImage = useCallback((index: number) => {
    setLimitNotice(null);
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const deliverAndClose = useCallback(
    (data: ExtractedRecipeData | null, url: string | null) => {
      cancelInFlight();
      setPhase('input');
      if (data && !deliveredRef.current) {
        deliveredRef.current = true;
        onExtracted({ data, sourceUrl: url });
      }
      onClose();
    },
    [cancelInFlight, onClose, onExtracted],
  );

  const handleFillerCloseRequest = useCallback(() => {
    // If extraction already finished, closing still applies extracted data (Web parity)
    if (extractedData) {
      deliverAndClose(extractedData, sourceUrl);
      return;
    }

    Alert.alert('ביטול עיבוד', 'עיבוד המתכון בתהליך. האם לבטל ולסגור?', [
      { text: 'המשך', style: 'cancel' },
      {
        text: 'בטל עיבוד',
        style: 'destructive',
        onPress: () => deliverAndClose(null, null),
      },
    ]);
  }, [extractedData, sourceUrl, deliverAndClose]);

  const handleExtract = useCallback(async () => {
    if (!canExtract) return;

    cancelInFlight();
    const myRequestId = requestIdRef.current;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setErrorMessage(null);
    setExtractedData(null);
    setPhase('extracting');

    const activeSourceUrl =
      mode === 'url' ? webUrl.trim() : mode === 'video' ? videoUrl.trim() : null;
    setSourceUrl(activeSourceUrl);

    try {
      let data: ExtractedRecipeData;
      if (mode === 'image') {
        const prepared = await Promise.all(images.map(prepareImageForGemini));
        if (requestIdRef.current !== myRequestId) return;
        data = await RecipeImportService.extractFromImages(prepared, {
          signal: controller.signal,
        });
      } else if (mode === 'video') {
        data = await RecipeImportService.extractFromVideo(videoUrl.trim(), {
          signal: controller.signal,
        });
      } else {
        data = await RecipeImportService.extractFromUrl(webUrl.trim(), {
          signal: controller.signal,
        });
      }

      if (requestIdRef.current !== myRequestId) return;

      if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
        throw new Error('Could not extract: empty response');
      }

      setExtractedData(data);
    } catch (err: any) {
      if (err?.name === 'AbortError' || requestIdRef.current !== myRequestId) return;
      const hebrewError = RecipeImportService.mapImportErrorToHebrew(err, mode);
      setErrorMessage(hebrewError);
      setPhase('error');
    }
  }, [canExtract, cancelInFlight, mode, images, webUrl, videoUrl]);

  const handleRetryFromError = useCallback(() => {
    setErrorMessage(null);
    setPhase('input');
  }, []);

  const showInputModal = visible && phase !== 'extracting';
  const showFillerModal = visible && phase === 'extracting';

  return (
    <>
      <Modal
        visible={showInputModal}
        transparent
        animationType="slide"
        onRequestClose={() => deliverAndClose(null, null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.overlay}
        >
          <Pressable style={styles.backdrop} onPress={() => deliverAndClose(null, null)} />
          <View testID="ai-import-modal" style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>ייבא מתכון</Text>
              <PressableScale
                variant="icon"
                onPress={() => deliverAndClose(null, null)}
                accessibilityLabel="סגור"
                style={styles.closeBtn}
              >
                <Ionicons name="close" size={22} color={colors.ink2} />
              </PressableScale>
            </View>

            {/* 3-Tab Switcher */}
            <View style={styles.tabsRow}>
              <PressableScale
                testID="ai-tab-image"
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === 'image' }}
                onPress={() => switchTab('image')}
                style={[styles.tabBtn, mode === 'image' && styles.tabBtnActive]}
              >
                <Ionicons
                  name="camera-outline"
                  size={16}
                  color={mode === 'image' ? colors.buttonColor : colors.ink2}
                />
                <Text
                  style={[styles.tabLabel, mode === 'image' && styles.tabLabelActive]}
                  numberOfLines={1}
                  allowFontScaling={false}
                >
                  מתמונה
                </Text>
              </PressableScale>

              <PressableScale
                testID="ai-tab-url"
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === 'url' }}
                onPress={() => switchTab('url')}
                style={[styles.tabBtn, mode === 'url' && styles.tabBtnActive]}
              >
                <Ionicons
                  name="link-outline"
                  size={16}
                  color={mode === 'url' ? colors.buttonColor : colors.ink2}
                />
                <Text
                  style={[styles.tabLabel, mode === 'url' && styles.tabLabelActive]}
                  numberOfLines={1}
                  allowFontScaling={false}
                >
                  מכתובת URL
                </Text>
              </PressableScale>

              <PressableScale
                testID="ai-tab-youtube"
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === 'video' }}
                onPress={() => switchTab('video')}
                style={[styles.tabBtn, mode === 'video' && styles.tabBtnActive]}
              >
                <Ionicons
                  name="logo-youtube"
                  size={16}
                  color={mode === 'video' ? colors.buttonColor : colors.ink2}
                />
                <Text
                  style={[styles.tabLabel, mode === 'video' && styles.tabLabelActive]}
                  numberOfLines={1}
                  allowFontScaling={false}
                >
                  מסרטון YouTube
                </Text>
              </PressableScale>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={styles.scrollBody}
            >
              {/* Inline Recoverable Error Banner */}
              {errorMessage ? (
                <View testID="ai-extract-error" style={styles.errorBanner}>
                  <View style={styles.errorTopRow}>
                    <Ionicons name="alert-circle" size={20} color={colors.secondary} />
                    <Text style={styles.errorBannerText}>{errorMessage}</Text>
                  </View>
                  <Button
                    testID="ai-extract-retry-btn"
                    label="נסה שוב"
                    variant="secondary"
                    size="sm"
                    onPress={handleRetryFromError}
                  />
                </View>
              ) : null}

              {limitNotice ? (
                <View style={styles.warnBanner}>
                  <Text style={styles.warnBannerText}>{limitNotice}</Text>
                </View>
              ) : null}

              {/* TAB 1: Images */}
              {mode === 'image' ? (
                <View style={styles.tabContent}>
                  {images.length === 0 ? (
                    <View style={styles.uploadBox}>
                      <Ionicons name="images-outline" size={36} color={colors.primary} />
                      <Text style={styles.uploadTitle}>
                        צלמו או בחרו עד {MAX_IMPORT_IMAGES} תמונות של המתכון
                      </Text>
                      <Text style={styles.uploadHint}>
                        מתכון מספר, צילום מסך או פתק בכתב יד — נעבד אותם אוטומטית.
                      </Text>
                      <View style={styles.pickerBtnRow}>
                        <Button
                          testID="ai-pick-gallery-btn"
                          label="בחירה מהגלריה"
                          variant="primary"
                          size="sm"
                          onPress={pickImagesFromLibrary}
                          icon={
                            <Ionicons name="images-outline" size={16} color={colors.buttonColor} />
                          }
                          style={styles.pickerBtn}
                        />
                        <Button
                          testID="ai-pick-camera-btn"
                          label="צילום במצלמה"
                          variant="secondary"
                          size="sm"
                          onPress={capturePhotoWithCamera}
                          icon={<Ionicons name="camera-outline" size={16} color={colors.ink} />}
                          style={styles.pickerBtn}
                        />
                      </View>
                    </View>
                  ) : (
                    <View style={styles.imagesList}>
                      {images.map((img, idx) => (
                        <View key={img.id} style={styles.imageRow}>
                          <View style={styles.thumbWrap}>
                            <Image
                              source={{ uri: img.uri }}
                              style={styles.thumb}
                              contentFit="cover"
                            />
                            {img.rotating ? (
                              <View style={styles.thumbLoader}>
                                <ActivityIndicator size="small" color={colors.buttonColor} />
                              </View>
                            ) : null}
                            <View style={styles.indexBadge}>
                              <Text style={styles.indexBadgeText}>{idx + 1}</Text>
                            </View>
                          </View>

                          <View style={styles.imageControls}>
                            <PressableScale
                              variant="icon"
                              accessibilityLabel="סובב שמאלה"
                              disabled={img.rotating}
                              onPress={() => rotateImage(img.id, -90)}
                              style={styles.iconControlBtn}
                            >
                              <Ionicons name="refresh-outline" size={18} color={colors.ink2} />
                            </PressableScale>
                            <PressableScale
                              variant="icon"
                              accessibilityLabel="סובב ימינה"
                              disabled={img.rotating}
                              onPress={() => rotateImage(img.id, 90)}
                              style={styles.iconControlBtn}
                            >
                              <Ionicons name="reload-outline" size={18} color={colors.ink2} />
                            </PressableScale>
                            <PressableScale
                              variant="icon"
                              accessibilityLabel="הזז למעלה"
                              disabled={idx === 0}
                              onPress={() => moveImage(idx, -1)}
                              style={[styles.iconControlBtn, idx === 0 && styles.controlDisabled]}
                            >
                              <Ionicons name="arrow-up" size={18} color={colors.ink2} />
                            </PressableScale>
                            <PressableScale
                              variant="icon"
                              accessibilityLabel="הזז למטה"
                              disabled={idx === images.length - 1}
                              onPress={() => moveImage(idx, 1)}
                              style={[
                                styles.iconControlBtn,
                                idx === images.length - 1 && styles.controlDisabled,
                              ]}
                            >
                              <Ionicons name="arrow-down" size={18} color={colors.ink2} />
                            </PressableScale>
                            <PressableScale
                              variant="icon"
                              accessibilityLabel="מחק תמונה"
                              onPress={() => removeImage(idx)}
                              style={styles.iconControlBtnDanger}
                            >
                              <Ionicons name="trash-outline" size={18} color={colors.secondary} />
                            </PressableScale>
                          </View>
                        </View>
                      ))}

                      {images.length < MAX_IMPORT_IMAGES ? (
                        <View style={styles.pickerBtnRow}>
                          <Button
                            label="+ הוסף מהגלריה"
                            variant="outline"
                            size="sm"
                            onPress={pickImagesFromLibrary}
                            style={styles.pickerBtn}
                          />
                          <Button
                            label="+ צלם נוספת"
                            variant="secondary"
                            size="sm"
                            onPress={capturePhotoWithCamera}
                            style={styles.pickerBtn}
                          />
                        </View>
                      ) : null}
                    </View>
                  )}
                </View>
              ) : null}

              {/* TAB 2: Web URL */}
              {mode === 'url' ? (
                <View style={styles.tabContent}>
                  <Text style={styles.inputLabel}>הכנס כתובת URL של מתכון:</Text>
                  <TextInput
                    testID="ai-url-input"
                    value={webUrl}
                    onChangeText={(text) => {
                      setWebUrl(text);
                      if (errorMessage) setErrorMessage(null);
                    }}
                    placeholder="https://example.com/recipe"
                    placeholderTextColor={colors.ink4}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    style={styles.urlInput}
                  />
                  <Text style={styles.helpText}>הדבק קישור למתכון מאתר בישול כלשהו</Text>
                </View>
              ) : null}

              {/* TAB 3: YouTube Video */}
              {mode === 'video' ? (
                <View style={styles.tabContent}>
                  <Text style={styles.inputLabel}>הכנס קישור לסרטון YouTube:</Text>
                  <TextInput
                    testID="ai-url-input"
                    value={videoUrl}
                    onChangeText={(text) => {
                      setVideoUrl(text);
                      if (errorMessage) setErrorMessage(null);
                    }}
                    placeholder="https://www.youtube.com/watch?v=..."
                    placeholderTextColor={colors.ink4}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    style={[styles.urlInput, videoValidation.showError && styles.urlInputInvalid]}
                  />
                  <Text style={styles.helpText}>
                    תמיכה בסרטונים רגילים וב-Shorts. קישורי youtu.be מתקבלים גם הם.
                  </Text>
                  {videoValidation.showError ? (
                    <Text style={styles.inlineValidationError}>
                      הקישור אינו סרטון YouTube תקין. הדבק קישור watch, Shorts או youtu.be.
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </ScrollView>

            {/* Footer */}
            <View style={styles.footer}>
              <Button
                label="ביטול"
                variant="secondary"
                onPress={() => deliverAndClose(null, null)}
                style={styles.footerBtn}
              />
              <Button
                testID="ai-extract-btn"
                label={extractButtonLabel}
                variant="primary"
                disabled={!canExtract}
                onPress={handleExtract}
                style={styles.footerBtn}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Filler Mini-Game Modal while Gemini extraction runs */}
      <GameHostModal
        visible={showFillerModal}
        mode="filler"
        gameKey="random"
        fillerTestID="ai-filler-game"
        asyncReady={Boolean(extractedData)}
        readyBannerText="המתכון מוכן!"
        readyCtaLabel="צפה במתכון"
        readyCtaTestID="ai-extract-ready-btn"
        loadingText="מעבד את המתכון... הנה משחק קטן בינתיים!"
        onViewResult={() => deliverAndClose(extractedData, sourceUrl)}
        onRequestClose={handleFillerCloseRequest}
        onClose={() => deliverAndClose(extractedData, sourceUrl)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: statusColors.overlayBackdrop,
  },
  sheet: {
    backgroundColor: colors.surface0,
    borderTopStartRadius: radii.xl,
    borderTopEndRadius: radii.xl,
    maxHeight: '90%',
    paddingBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.hairline,
    ...shadows.level3,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.hairlineStrong,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  title: {
    fontSize: typeScale.step2,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    textAlign: 'left',
    flex: 1,
  },
  closeBtn: {
    padding: 6,
  },
  tabsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.md,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
  },
  tabBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tabLabel: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink2,
    includeFontPadding: false,
  },
  tabLabelActive: {
    color: colors.buttonColor,
    fontFamily: fontFamilies.bodyBold,
  },
  scrollBody: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  tabContent: {
    gap: spacing.sm,
  },
  errorBanner: {
    backgroundColor: statusColors.rejectedBg,
    borderWidth: 1,
    borderColor: colors.secondary,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  errorTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  errorBannerText: {
    flex: 1,
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyMedium,
    color: statusColors.rejectedText,
    textAlign: 'left',
  },
  warnBanner: {
    backgroundColor: statusColors.pendingBg,
    borderRadius: radii.sm,
    padding: spacing.sm,
  },
  warnBannerText: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyMedium,
    color: statusColors.pendingText,
    textAlign: 'left',
  },
  uploadBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.hairlineStrong,
    backgroundColor: colors.surface1,
    gap: spacing.sm,
  },
  uploadTitle: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyBold,
    color: colors.ink,
    textAlign: 'center',
  },
  uploadHint: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    textAlign: 'center',
  },
  pickerBtnRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
    width: '100%',
  },
  pickerBtn: {
    flex: 1,
  },
  imagesList: {
    gap: spacing.sm,
  },
  imageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  thumbWrap: {
    width: 72,
    height: 72,
    borderRadius: radii.sm,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
    position: 'relative',
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  thumbLoader: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: statusColors.darkScrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indexBadge: {
    position: 'absolute',
    top: 4,
    start: 4,
    minWidth: 20,
    height: 20,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  indexBadgeText: {
    fontSize: 11,
    fontFamily: fontFamilies.bodyBold,
    color: colors.buttonColor,
    includeFontPadding: false,
  },
  imageControls: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
  },
  iconControlBtn: {
    width: 34,
    height: 34,
    borderRadius: radii.sm,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconControlBtnDanger: {
    width: 34,
    height: 34,
    borderRadius: radii.sm,
    backgroundColor: statusColors.rejectedBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlDisabled: {
    opacity: 0.35,
  },
  inputLabel: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyBold,
    color: colors.ink2,
    textAlign: 'left',
  },
  urlInput: {
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink,
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  urlInputInvalid: {
    borderColor: colors.secondary,
  },
  helpText: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    textAlign: 'left',
  },
  inlineValidationError: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.secondary,
    textAlign: 'left',
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  footerBtn: {
    flex: 1,
  },
});
