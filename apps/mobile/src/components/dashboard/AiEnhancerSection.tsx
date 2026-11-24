import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image as RNImage,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radii, shadows, spacing, statusColors, typeScale } from '@/theme';
import { Badge, Button, Card, Chip, PressableScale, useToast } from '@/components/ui';
import { FullscreenMediaModal, type FullscreenMediaItem } from '@/components/recipe-detail';
import { GameHostModal } from '@/games-host';
import {
  AiEnhancementService,
  ENHANCEMENT_AXES,
  ENHANCEMENT_JPEG_QUALITY,
  ENHANCEMENT_PARAMETERS,
  MAX_ENHANCEMENT_INPUT_DIM,
  MAX_ENHANCEMENT_INSTRUCTION_LENGTH,
  type EnhancementAxis,
} from '@/services/recipes/ai-enhancement-service';
import { RecipeImageService } from '@/services/recipes/recipe-image-service';
import type { RecipeDoc, RecipeImageEntry } from '@/services/recipes/recipe-service';

const INITIAL_RECIPE_LIMIT = 20;

export interface AiEnhancerSectionProps {
  recipes: RecipeDoc[];
  loading: boolean;
  refreshing: boolean;
  managerUid: string;
  onRefresh: () => void | Promise<void>;
  onImageSaved: (recipeId: string) => void | Promise<void>;
}

interface EnhancedImageResult {
  base64: string;
  mimeType: string;
  dataUrl: string;
}

type AxisSelectionMap = Record<EnhancementAxis, string>;

const EMPTY_AXIS_SELECTION: AxisSelectionMap = {
  lighting: '',
  angle: '',
  surface: '',
  styling: '',
};

function getImageDimensions(uri: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 4000);
    RNImage.getSize(
      uri,
      (width, height) => {
        clearTimeout(timer);
        resolve({ width, height });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

async function prepareSourceImagePayload(
  sourceUrl: string,
): Promise<{ base64: string; mimeType: string }> {
  let localUri = sourceUrl;
  let tempFileToClean: string | null = null;

  if (sourceUrl.startsWith('http://') || sourceUrl.startsWith('https://')) {
    const cacheDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
    if (!cacheDir) {
      throw new Error('אין גישה לתיקיית קבצים זמניים במכשיר');
    }
    const tempPath = `${cacheDir}enhance_src_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    const download = await FileSystem.downloadAsync(sourceUrl, tempPath);
    if (download.status < 200 || download.status >= 300) {
      throw new Error(`הורדת התמונה המקורית נכשלה (${download.status})`);
    }
    localUri = download.uri;
    tempFileToClean = download.uri;
  }

  try {
    const dims = await getImageDimensions(localUri);
    const actions: ImageManipulator.Action[] = [];
    if (
      dims &&
      (dims.width > MAX_ENHANCEMENT_INPUT_DIM || dims.height > MAX_ENHANCEMENT_INPUT_DIM)
    ) {
      if (dims.width >= dims.height) {
        actions.push({ resize: { width: MAX_ENHANCEMENT_INPUT_DIM } });
      } else {
        actions.push({ resize: { height: MAX_ENHANCEMENT_INPUT_DIM } });
      }
    } else if (!dims) {
      actions.push({ resize: { width: MAX_ENHANCEMENT_INPUT_DIM } });
    }

    const manipulated = await ImageManipulator.manipulateAsync(localUri, actions, {
      compress: ENHANCEMENT_JPEG_QUALITY,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    });

    if (!manipulated.base64) {
      throw new Error('קידוד התמונה לשליחה נכשל');
    }

    return {
      base64: manipulated.base64,
      mimeType: 'image/jpeg',
    };
  } finally {
    if (tempFileToClean) {
      await FileSystem.deleteAsync(tempFileToClean, { idempotent: true }).catch(() => {});
    }
  }
}

export function AiEnhancerSection({
  recipes,
  loading,
  refreshing,
  managerUid,
  onRefresh,
  onImageSaved,
}: AiEnhancerSectionProps) {
  const { showToast } = useToast();

  const [expanded, setExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [stripUrls, setStripUrls] = useState<Record<string, string | null>>({});

  // Inline enhancer studio state
  const [activeImage, setActiveImage] = useState<RecipeImageEntry | null>(null);
  const [beforeUrl, setBeforeUrl] = useState<string | null>(null);
  const [loadingBefore, setLoadingBefore] = useState(false);
  const [axisValues, setAxisValues] = useState<AxisSelectionMap>(EMPTY_AXIS_SELECTION);
  const [instruction, setInstruction] = useState('');
  const [enhancedResult, setEnhancedResult] = useState<EnhancedImageResult | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Sibling overlays
  const [fillerVisible, setFillerVisible] = useState(false);
  const [fillerReady, setFillerReady] = useState(false);
  const [fullscreenVisible, setFullscreenVisible] = useState(false);
  const [fullscreenIndex, setFullscreenIndex] = useState(0);

  const enhanceSeqRef = useRef(0);
  const fillerDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const eligibleRecipes = useMemo(() => {
    return recipes
      .filter((r) => Array.isArray(r.images) && r.images.length > 0)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he'));
  }, [recipes]);

  const filteredRecipes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return eligibleRecipes;
    return eligibleRecipes.filter((r) => (r.name || '').toLowerCase().includes(q));
  }, [eligibleRecipes, searchQuery]);

  // Auto-select first eligible recipe so enhancer controls are immediately ready
  useEffect(() => {
    if (eligibleRecipes.length === 0) {
      setSelectedRecipeId(null);
      return;
    }
    if (!selectedRecipeId || !eligibleRecipes.some((r) => r.id === selectedRecipeId)) {
      setSelectedRecipeId(eligibleRecipes[0].id);
    }
  }, [eligibleRecipes, selectedRecipeId]);

  const selectedRecipe = useMemo(() => {
    if (!selectedRecipeId) return eligibleRecipes[0] || null;
    return eligibleRecipes.find((r) => r.id === selectedRecipeId) || eligibleRecipes[0] || null;
  }, [eligibleRecipes, selectedRecipeId]);

  const selectImageForEnhance = useCallback((image: RecipeImageEntry) => {
    enhanceSeqRef.current += 1;
    if (fillerDelayTimerRef.current) {
      clearTimeout(fillerDelayTimerRef.current);
      fillerDelayTimerRef.current = null;
    }
    setActiveImage(image);
    setEnhancedResult(null);
    setAxisValues({ ...EMPTY_AXIS_SELECTION });
    setStatusMessage('');
    setIsEnhancing(false);
    setIsSaving(false);
    setFillerVisible(false);
    setFillerReady(false);
    setFullscreenVisible(false);
    setBeforeUrl(null);
    setLoadingBefore(true);

    RecipeImageService.getOptimizedUrl(image, '1080x1080')
      .then((url) => {
        setBeforeUrl(url);
      })
      .catch(() => {
        setBeforeUrl(null);
      })
      .finally(() => {
        setLoadingBefore(false);
      });
  }, []);

  // Auto-select primary (or first) photo whenever selectedRecipe changes
  useEffect(() => {
    if (!selectedRecipe?.images?.length) {
      setActiveImage(null);
      setBeforeUrl(null);
      setStripUrls({});
      return;
    }

    const primary = selectedRecipe.images.find((i) => i.isPrimary) || selectedRecipe.images[0];
    if (!activeImage || !selectedRecipe.images.some((i) => i.id === activeImage.id)) {
      selectImageForEnhance(primary);
    }

    let cancelled = false;
    Promise.all(
      selectedRecipe.images.map(async (img, idx) => {
        const key = img.id || String(idx);
        const url = await RecipeImageService.getOptimizedUrl(img, '400x400').catch(() => null);
        return [key, url] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      const map: Record<string, string | null> = {};
      for (const [k, url] of entries) {
        map[k] = url;
      }
      setStripUrls(map);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedRecipe, activeImage, selectImageForEnhance]);

  useEffect(() => {
    return () => {
      if (fillerDelayTimerRef.current) {
        clearTimeout(fillerDelayTimerRef.current);
      }
    };
  }, []);

  const handleRunEnhance = useCallback(async () => {
    if (!activeImage || isEnhancing || isSaving) return;

    const seq = ++enhanceSeqRef.current;
    setIsEnhancing(true);
    setEnhancedResult(null);
    setStatusMessage('שולח לשיפור בעזרת AI...');
    setFillerReady(false);
    if (fillerDelayTimerRef.current) clearTimeout(fillerDelayTimerRef.current);
    // Launch filler mini-game only for longer live Gemini calls (> 5s)
    fillerDelayTimerRef.current = setTimeout(() => {
      if (seq === enhanceSeqRef.current) {
        setFillerVisible(true);
      }
    }, 5000);

    try {
      const originalUrl = await AiEnhancementService.getOriginalImageDownloadUrl(activeImage);
      const { base64, mimeType } = await prepareSourceImagePayload(originalUrl);
      if (seq !== enhanceSeqRef.current) return;

      const paramsPayload: Partial<Record<EnhancementAxis, string>> = {};
      for (const axis of ENHANCEMENT_AXES) {
        if (axisValues[axis]) {
          paramsPayload[axis] = axisValues[axis];
        }
      }

      const trimmedInstruction = instruction.trim();

      const result = await AiEnhancementService.enhanceFoodImage({
        image: { base64, mimeType },
        parameters: Object.keys(paramsPayload).length > 0 ? paramsPayload : undefined,
        instruction: trimmedInstruction || undefined,
      });

      if (seq !== enhanceSeqRef.current) return;
      if (fillerDelayTimerRef.current) {
        clearTimeout(fillerDelayTimerRef.current);
        fillerDelayTimerRef.current = null;
      }

      const outMime = result.mimeType || 'image/png';
      const dataUrl = `data:${outMime};base64,${result.base64}`;
      setEnhancedResult({ base64: result.base64, mimeType: outMime, dataUrl });

      // Write returned selectedParameters back into controls (user override wins)
      const selected = result.selectedParameters || {};
      setAxisValues((prev) => {
        const next: AxisSelectionMap = { ...EMPTY_AXIS_SELECTION };
        for (const axis of ENHANCEMENT_AXES) {
          const validValues = new Set(ENHANCEMENT_PARAMETERS[axis].options.map((o) => o.value));
          const candidate = prev[axis] || selected[axis] || '';
          next[axis] = candidate && validValues.has(candidate) ? candidate : '';
        }
        return next;
      });

      setStatusMessage('התמונה שופרה. ניתן לשמור או לבטל.');
      setFillerReady(true);
    } catch (err) {
      if (seq !== enhanceSeqRef.current) return;
      if (fillerDelayTimerRef.current) {
        clearTimeout(fillerDelayTimerRef.current);
        fillerDelayTimerRef.current = null;
      }
      setFillerVisible(false);
      setFillerReady(false);
      setStatusMessage(AiEnhancementService.formatEnhancementError(err));
    } finally {
      if (seq === enhanceSeqRef.current) {
        setIsEnhancing(false);
      }
    }
  }, [activeImage, isEnhancing, isSaving, axisValues, instruction]);

  const handleApplyEnhanced = useCallback(async () => {
    if (!enhancedResult || !selectedRecipe || !activeImage?.id || isSaving) return;

    setIsSaving(true);
    setStatusMessage('שומר את התמונה החדשה...');
    try {
      await AiEnhancementService.replaceRecipeImageWithBackup({
        recipeId: selectedRecipe.id,
        imageId: activeImage.id,
        base64: enhancedResult.base64,
        mimeType: enhancedResult.mimeType,
        managerUid,
      });

      showToast('התמונה הוחלפה. התמונה המקורית נשמרה כגיבוי.', 'success');
      setEnhancedResult(null);
      setStatusMessage('התמונה הוחלפה בהצלחה.');
      await onImageSaved(selectedRecipe.id);
    } catch (err) {
      setStatusMessage(AiEnhancementService.formatEnhancementError(err));
      showToast('שמירת התמונה המשופרת נכשלה. נסו שוב.', 'error');
    } finally {
      setIsSaving(false);
    }
  }, [enhancedResult, selectedRecipe, activeImage, isSaving, managerUid, showToast, onImageSaved]);

  const handleDiscardResult = useCallback(() => {
    if (isSaving) return;
    setEnhancedResult(null);
    setAxisValues({ ...EMPTY_AXIS_SELECTION });
    setInstruction('');
    setStatusMessage('');
  }, [isSaving]);

  const fullscreenItems = useMemo<FullscreenMediaItem[]>(() => {
    const items: FullscreenMediaItem[] = [];
    if (beforeUrl) {
      items.push({ id: 'before', type: 'image', uri: beforeUrl, caption: 'לפני' });
    }
    if (enhancedResult?.dataUrl) {
      items.push({ id: 'after', type: 'image', uri: enhancedResult.dataUrl, caption: 'אחרי' });
    }
    return items;
  }, [beforeUrl, enhancedResult]);

  const openFullscreen = useCallback(
    (pane: 'before' | 'after') => {
      if (fullscreenItems.length === 0) return;
      const idx =
        pane === 'after'
          ? Math.max(
              0,
              fullscreenItems.findIndex((i) => i.id === 'after'),
            )
          : 0;
      setFullscreenIndex(idx);
      setFullscreenVisible(true);
    },
    [fullscreenItems],
  );

  const formLocked = isEnhancing || isSaving || Boolean(enhancedResult);

  return (
    <View testID="dashboard-panel-enhancer" collapsable={false}>
      <Card style={styles.sectionCard}>
        {/* Accordion Header */}
        <View style={styles.sectionHeader}>
          <PressableScale
            testID="dashboard-section-enhancer"
            variant="button"
            onPress={() => setExpanded((prev) => !prev)}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            style={styles.sectionToggle}
          >
            <View style={styles.sectionTitleGroup}>
              <Ionicons name="sparkles-outline" size={20} color={colors.primaryDark} />
              <Text style={styles.sectionTitle}>שיפור תמונות (AI)</Text>
              <Badge label={String(eligibleRecipes.length)} tone="neutral" />
            </View>
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={colors.ink3}
            />
          </PressableScale>

          <PressableScale
            testID="dashboard-section-enhancer-refresh"
            variant="icon"
            disabled={refreshing}
            onPress={() => {
              void onRefresh();
            }}
            accessibilityLabel="רענן תמונות לשיפור"
            style={styles.refreshBtn}
          >
            {refreshing ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons name="refresh" size={18} color={colors.ink2} />
            )}
          </PressableScale>
        </View>

        {expanded ? (
          <View style={styles.sectionBody}>
            {loading && eligibleRecipes.length === 0 ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.emptyText}>טוען מתכונים עם תמונות...</Text>
              </View>
            ) : eligibleRecipes.length === 0 ? (
              <Text style={styles.emptyText}>אין מתכונים עם תמונות להצגה</Text>
            ) : (
              <>
                {/* Compact Horizontal Recipe Picker Chips */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.axisChips}
                >
                  {filteredRecipes.slice(0, INITIAL_RECIPE_LIMIT).map((recipe) => {
                    const isSelected = selectedRecipe?.id === recipe.id;
                    return (
                      <Chip
                        key={recipe.id}
                        testID={`enhancer-recipe-${recipe.id}`}
                        label={recipe.name}
                        selected={isSelected}
                        onPress={() => {
                          setSelectedRecipeId(recipe.id);
                          const primary =
                            recipe.images?.find((i) => i.isPrimary) || recipe.images?.[0];
                          if (primary) selectImageForEnhance(primary);
                        }}
                      />
                    );
                  })}
                </ScrollView>

                {/* Inline AI Enhancer Studio */}
                <View testID="enhancer-modal" collapsable={false} style={styles.paramsCard}>
                  {/* Before / After Comparison */}
                  <View
                    testID={enhancedResult ? 'enhancer-before-after' : 'enhancer-preview-grid'}
                    collapsable={false}
                    style={styles.compareGrid}
                  >
                    <PressableScale
                      variant="card"
                      disabled={!beforeUrl}
                      onPress={() => openFullscreen('before')}
                      style={styles.comparePane}
                    >
                      <View style={styles.paneLabelPill}>
                        <Text style={styles.paneLabelText} allowFontScaling={false}>
                          לפני
                        </Text>
                      </View>
                      {loadingBefore ? (
                        <View style={styles.paneCenter}>
                          <ActivityIndicator size="small" color={colors.primary} />
                        </View>
                      ) : beforeUrl ? (
                        <Image
                          source={{ uri: beforeUrl }}
                          style={styles.paneImage}
                          contentFit="contain"
                        />
                      ) : (
                        <View style={styles.paneCenter}>
                          <Ionicons name="image-outline" size={24} color={colors.ink4} />
                        </View>
                      )}
                    </PressableScale>

                    <PressableScale
                      variant="card"
                      disabled={!enhancedResult}
                      onPress={() => openFullscreen('after')}
                      style={styles.comparePane}
                    >
                      <View style={styles.paneLabelPill}>
                        <Text style={styles.paneLabelText} allowFontScaling={false}>
                          אחרי
                        </Text>
                      </View>
                      {isEnhancing ? (
                        <View style={styles.paneCenter}>
                          <ActivityIndicator size="small" color={colors.primary} />
                          <Text style={styles.paneHint}>משפר...</Text>
                        </View>
                      ) : enhancedResult ? (
                        <RNImage
                          source={{ uri: enhancedResult.dataUrl }}
                          style={styles.paneImage}
                          resizeMode="contain"
                        />
                      ) : (
                        <View style={styles.paneCenter}>
                          <Ionicons name="sparkles-outline" size={24} color={colors.ink4} />
                          <Text style={styles.paneHint}>התוצאה תופיע כאן</Text>
                        </View>
                      )}
                    </PressableScale>
                  </View>

                  {/* Free-text Instruction Input (immediately visible above fold) */}
                  <View style={styles.instructionBlock}>
                    <View style={styles.instructionHeader}>
                      <Text style={styles.axisLabel}>הנחיה נוספת (אופציונלי)</Text>
                      <Text style={styles.charCounter}>
                        {instruction.length}/{MAX_ENHANCEMENT_INSTRUCTION_LENGTH}
                      </Text>
                    </View>
                    <TextInput
                      testID="enhancer-instruction-input"
                      value={instruction}
                      onChangeText={(text) =>
                        setInstruction(text.slice(0, MAX_ENHANCEMENT_INSTRUCTION_LENGTH))
                      }
                      maxLength={MAX_ENHANCEMENT_INSTRUCTION_LENGTH}
                      editable={!formLocked}
                      placeholder="למשל: הוסף צמח תבלין טרי בצד, תאורה חמימה יותר..."
                      placeholderTextColor={colors.ink4}
                      returnKeyType="done"
                      style={[
                        styles.instructionInput,
                        formLocked && styles.instructionInputDisabled,
                      ]}
                    />
                  </View>

                  {statusMessage ? <Text style={styles.statusText}>{statusMessage}</Text> : null}

                  {/* Primary Action Row */}
                  {!enhancedResult ? (
                    <Button
                      testID="enhancer-run-btn"
                      label={isEnhancing ? 'מעבד...' : 'שפר תמונה'}
                      variant="primary"
                      loading={isEnhancing}
                      disabled={isEnhancing || isSaving || !activeImage}
                      onPress={() => {
                        void handleRunEnhance();
                      }}
                      fullWidth
                    />
                  ) : (
                    <View style={styles.resultActionsRow}>
                      <Button
                        testID="enhancer-discard-btn"
                        label="בטל תוצאה"
                        variant="secondary"
                        disabled={isSaving}
                        onPress={handleDiscardResult}
                        style={styles.toolbarBtn}
                      />
                      <Button
                        testID="enhancer-apply-btn"
                        label="שמור והחלף"
                        variant="primary"
                        loading={isSaving}
                        disabled={isSaving}
                        onPress={() => {
                          void handleApplyEnhanced();
                        }}
                        style={styles.toolbarBtn}
                      />
                    </View>
                  )}

                  {/* 4 Parameter Axis Pickers */}
                  {ENHANCEMENT_AXES.map((axis) => {
                    const cfg = ENHANCEMENT_PARAMETERS[axis];
                    const selectedValue = axisValues[axis];
                    return (
                      <View key={axis} style={styles.axisBlock}>
                        <Text style={styles.axisLabel}>{cfg.label}</Text>
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={styles.axisChips}
                        >
                          <Chip
                            testID={`enhancer-param-${axis}-auto`}
                            label="אוטומטי"
                            selected={selectedValue === ''}
                            onPress={() => {
                              if (formLocked) return;
                              setAxisValues((prev) => ({ ...prev, [axis]: '' }));
                            }}
                          />
                          {cfg.options.map((opt) => (
                            <Chip
                              key={opt.value}
                              testID={`enhancer-param-${axis}-${opt.value}`}
                              label={opt.label}
                              selected={selectedValue === opt.value}
                              onPress={() => {
                                if (formLocked) return;
                                setAxisValues((prev) => ({ ...prev, [axis]: opt.value }));
                              }}
                            />
                          ))}
                        </ScrollView>
                      </View>
                    );
                  })}
                </View>

                {/* Photo Selector Strip when recipe has multiple images */}
                {selectedRecipe && selectedRecipe.images && selectedRecipe.images.length > 1 ? (
                  <View style={styles.stripWrap}>
                    <Text style={styles.stripTitle} numberOfLines={1}>
                      תמונות נוספות של {selectedRecipe.name}
                    </Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.stripRow}
                    >
                      {selectedRecipe.images.map((img, idx) => {
                        const key = img.id || String(idx);
                        const thumbUrl = stripUrls[key];
                        const aiEnhanced = Boolean((img as Record<string, any>).aiEnhanced);

                        return (
                          <PressableScale
                            key={key}
                            testID={`enhancer-image-${img.id || idx}`}
                            variant="card"
                            onPress={() => selectImageForEnhance(img)}
                            accessibilityLabel={`שפר תמונה ${idx + 1} של ${selectedRecipe.name}`}
                            style={styles.imageTile}
                          >
                            {thumbUrl ? (
                              <Image
                                source={{ uri: thumbUrl }}
                                style={styles.tileImg}
                                contentFit="cover"
                                transition={120}
                              />
                            ) : (
                              <View style={styles.tilePlaceholder}>
                                <ActivityIndicator size="small" color={colors.primary} />
                              </View>
                            )}
                            <View style={styles.tileBadges}>
                              {img.isPrimary ? <Badge label="ראשית" tone="primary" /> : null}
                              {aiEnhanced ? <Badge label="AI" tone="success" /> : null}
                            </View>
                          </PressableScale>
                        );
                      })}
                    </ScrollView>
                  </View>
                ) : null}

                {/* Recipe Search Filter */}
                <View style={styles.searchWrap}>
                  <Ionicons name="search-outline" size={18} color={colors.ink3} />
                  <TextInput
                    testID="enhancer-search-input"
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="חיפוש מתכון..."
                    placeholderTextColor={colors.ink4}
                    style={styles.searchInput}
                  />
                  {searchQuery.length > 0 ? (
                    <PressableScale
                      variant="icon"
                      onPress={() => setSearchQuery('')}
                      accessibilityLabel="נקה חיפוש"
                    >
                      <Ionicons name="close-circle" size={18} color={colors.ink3} />
                    </PressableScale>
                  ) : null}
                </View>
              </>
            )}
          </View>
        ) : null}
      </Card>

      {/* Sibling Filler Mini-Game during Gemini Enhancement */}
      <GameHostModal
        visible={fillerVisible}
        mode="filler"
        gameKey="random"
        asyncReady={fillerReady}
        readyBannerText="התמונה המשופרת מוכנה!"
        readyCtaLabel="צפה בתוצאה"
        loadingText="משפר את התמונה בעזרת AI... הנה משחק קטן בינתיים!"
        onViewResult={() => setFillerVisible(false)}
        onClose={() => setFillerVisible(false)}
      />

      {/* Sibling Fullscreen Before/After Viewer */}
      <FullscreenMediaModal
        visible={fullscreenVisible}
        items={fullscreenItems}
        initialIndex={fullscreenIndex}
        onClose={() => setFullscreenVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sectionCard: {
    padding: 0,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  sectionToggle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sectionTitleGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minWidth: 0,
  },
  sectionTitle: {
    fontFamily: fontFamilies.heading,
    fontSize: typeScale.step1,
    color: colors.ink,
    textAlign: 'left',
    flexShrink: 1,
  },
  refreshBtn: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  sectionBody: {
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface0,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    paddingHorizontal: spacing.md,
    minHeight: 42,
  },
  searchInput: {
    flex: 1,
    fontFamily: fontFamilies.body,
    fontSize: typeScale.stepMinus1,
    color: colors.ink,
    paddingVertical: 8,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  emptyText: {
    fontFamily: fontFamilies.body,
    fontSize: typeScale.stepMinus1,
    color: colors.ink3,
    textAlign: 'left',
  },
  recipeList: {
    gap: spacing.xs,
  },
  recipeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.surface0,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  recipeItemSelected: {
    borderColor: colors.primary,
    backgroundColor: statusColors.approvedBg,
  },
  recipeItemName: {
    flex: 1,
    fontFamily: fontFamilies.bodyMedium,
    fontSize: typeScale.stepMinus1,
    color: colors.ink,
    textAlign: 'left',
  },
  stripWrap: {
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingTop: spacing.md,
    marginTop: spacing.xs,
    gap: spacing.sm,
  },
  stripTitle: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: 12,
    color: colors.ink2,
    textAlign: 'left',
  },
  stripRow: {
    gap: spacing.sm,
    paddingVertical: 2,
  },
  imageTile: {
    width: 96,
    height: 96,
    borderRadius: radii.sm,
    borderWidth: 1.5,
    borderColor: colors.hairlineStrong,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
    position: 'relative',
  },
  tileImg: {
    width: '100%',
    height: '100%',
  },
  tilePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileBadges: {
    position: 'absolute',
    top: 4,
    start: 4,
    flexDirection: 'row',
    gap: 4,
  },
  modalRoot: {
    flex: 1,
    backgroundColor: colors.surface0,
  },
  modalInner: {
    flex: 1,
    position: 'relative',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    backgroundColor: colors.surface1,
    gap: spacing.sm,
  },
  modalTitle: {
    flex: 1,
    fontFamily: fontFamilies.heading,
    fontSize: typeScale.step1,
    color: colors.ink,
    textAlign: 'left',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBody: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing['2xl'],
  },
  compareGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  comparePane: {
    flex: 1,
    height: 108,
    backgroundColor: colors.surface2,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: 'hidden',
    position: 'relative',
  },
  paneLabelPill: {
    position: 'absolute',
    top: 6,
    start: 6,
    zIndex: 2,
    backgroundColor: statusColors.darkScrim,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: radii.pill,
  },
  paneLabelText: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: 11,
    color: colors.buttonColor,
    includeFontPadding: false,
  },
  paneImage: {
    width: '100%',
    height: '100%',
  },
  paneCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: spacing.sm,
  },
  paneHint: {
    fontFamily: fontFamilies.body,
    fontSize: 12,
    color: colors.ink3,
    textAlign: 'center',
  },
  tapZoomHint: {
    fontFamily: fontFamilies.body,
    fontSize: 12,
    color: colors.ink3,
    textAlign: 'center',
  },
  paramsCard: {
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  paramsCardTitle: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: 12,
    color: colors.ink3,
    textAlign: 'left',
  },
  axisBlock: {
    gap: 6,
  },
  axisLabel: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: 12,
    color: colors.ink2,
    textAlign: 'left',
  },
  axisChips: {
    gap: spacing.xs,
    paddingVertical: 2,
  },
  instructionBlock: {
    gap: 6,
  },
  instructionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  charCounter: {
    fontFamily: fontFamilies.body,
    fontSize: 11,
    color: colors.ink3,
  },
  instructionInput: {
    backgroundColor: colors.surface0,
    borderWidth: 1.5,
    borderColor: colors.hairlineStrong,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    minHeight: 42,
    fontFamily: fontFamilies.body,
    fontSize: typeScale.stepMinus1,
    color: colors.ink,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  instructionInputDisabled: {
    opacity: 0.6,
    backgroundColor: colors.surface2,
  },
  statusText: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: typeScale.stepMinus1,
    color: colors.ink2,
    textAlign: 'left',
  },
  modalToolbar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    backgroundColor: colors.surface1,
    ...shadows.level2,
  },
  resultActionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  toolbarBtn: {
    flex: 1,
  },
  savingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: statusColors.overlayBackdrop,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  savingCard: {
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
    ...shadows.level3,
  },
  savingText: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: typeScale.step0,
    color: colors.ink,
    textAlign: 'center',
  },
});
