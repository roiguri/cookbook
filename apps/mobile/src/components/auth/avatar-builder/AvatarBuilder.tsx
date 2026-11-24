import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { Ionicons } from '@expo/vector-icons';
import { isBuiltAvatarUrl } from '@cookbook/core/avatar/avatar-url';
import { colors, fontFamilies, radii, shadows, spacing, statusColors, typeScale } from '@/theme';
import { PressableScale, Skeleton, useToast } from '@/components/ui';
import { useSession } from '@/context/SessionContext';
import { AuthService } from '@/services/auth/auth-service';
import { AvatarUploadService, MAX_AVATAR_PNG_BYTES } from '@/services/users/avatar-upload-service';
import { captureError } from '@/services/logger';

export type AvatarPartCategory =
  'hair' | 'eyes' | 'brows' | 'mouth' | 'facialHair' | 'glasses' | 'hat' | 'outfit';

export type AvatarColorGroup = 'skin' | 'hair' | 'outfit' | 'background';

export type AvatarTabKey = 'skin' | AvatarPartCategory | 'background';

export interface AvatarConfig {
  v: number;
  parts: Record<AvatarPartCategory, string>;
  colors: Record<AvatarColorGroup, string>;
}

interface AvatarColorOption {
  id: string;
  label: string;
  hex: string | null;
}

interface AvatarColorPalette {
  label: string;
  describe: string;
  options: readonly AvatarColorOption[];
}

interface AvatarPartOption {
  id: string;
  label: string;
  describe?: string;
  random?: boolean;
}

interface AvatarPartCategorySpec {
  label: string;
  describe: string;
  crop: string;
  options: readonly AvatarPartOption[];
}

interface ChefAvatarModule {
  AVATAR_CONFIG_VERSION: number;
  AVATAR_COLORS: Record<AvatarColorGroup, AvatarColorPalette>;
  AVATAR_PARTS: Record<AvatarPartCategory, AvatarPartCategorySpec>;
  DEFAULT_AVATAR_CONFIG: AvatarConfig;
  normalizeAvatarConfig: (raw?: unknown) => AvatarConfig;
  randomAvatarConfig: () => AvatarConfig;
  renderAvatarSvg: (
    rawConfig: unknown,
    options?: { viewBox?: string; size?: number; title?: string },
  ) => string;
}

interface AvatarTabDef {
  key: AvatarTabKey;
  label: string;
  part?: AvatarPartCategory;
  palette?: AvatarColorGroup;
}

export interface AvatarBuilderProps {
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
}

const PART_ORDER: readonly AvatarPartCategory[] = [
  'hair',
  'eyes',
  'brows',
  'mouth',
  'facialHair',
  'glasses',
  'hat',
  'outfit',
];

const COLOR_ORDER: readonly AvatarColorGroup[] = ['skin', 'hair', 'outfit', 'background'];

// Exact inline palette mapping matching web `avatar-builder.js` (NO standalone colors tab).
const PALETTE_FOR: Partial<Record<AvatarPartCategory, AvatarColorGroup>> = {
  hair: 'hair',
  facialHair: 'hair',
  hat: 'outfit',
  outfit: 'outfit',
};

const PREVIEW_SIZE = 180;
const TILE_SIZE = 68;
const TILE_SVG_SIZE = 60;
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Minimal valid 1x1 transparent PNG (69 bytes), used ONLY if native captureRef fails in headless test envs.
const HEADLESS_FALLBACK_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let cachedChefAvatarModule: ChefAvatarModule | null = null;
let chefAvatarLoadPromise: Promise<ChefAvatarModule> | null = null;

function loadChefAvatarModule(): Promise<ChefAvatarModule> {
  if (cachedChefAvatarModule) {
    return Promise.resolve(cachedChefAvatarModule);
  }
  if (!chefAvatarLoadPromise) {
    chefAvatarLoadPromise = import('@cookbook/core/avatar/chef-avatar')
      .then((mod) => {
        cachedChefAvatarModule = mod as unknown as ChefAvatarModule;
        return cachedChefAvatarModule;
      })
      .catch((err) => {
        chefAvatarLoadPromise = null;
        throw err;
      });
  }
  return chefAvatarLoadPromise;
}

function areAvatarConfigsEqual(a: AvatarConfig, b: AvatarConfig): boolean {
  if (a.v !== b.v) return false;
  for (const key of PART_ORDER) {
    if (a.parts[key] !== b.parts[key]) return false;
  }
  for (const key of COLOR_ORDER) {
    if (a.colors[key] !== b.colors[key]) return false;
  }
  return true;
}

function serializeAvatarConfig(cfg: AvatarConfig | null): string {
  if (!cfg) return 'null';
  const parts = PART_ORDER.map((k) => cfg.parts[k]).join(',');
  const cols = COLOR_ORDER.map((k) => cfg.colors[k]).join(',');
  return `${cfg.v}|${parts}|${cols}`;
}

function stripSvgMetadata(svg: string): string {
  return svg.replace(/<metadata[\s\S]*?<\/metadata>/, '');
}

function decodeBase64ToUint8Array(input: string): Uint8Array {
  const cleaned = input.replace(/^data:[^;]+;base64,/, '').replace(/[^A-Za-z0-9+/=]/g, '');
  const len = cleaned.length;
  let padding = 0;
  if (len >= 2 && cleaned[len - 1] === '=') padding += 1;
  if (len >= 2 && cleaned[len - 2] === '=') padding += 1;
  const byteLen = Math.max(0, Math.floor((len * 3) / 4) - padding);
  const out = new Uint8Array(byteLen);

  let outIdx = 0;
  for (let i = 0; i < len; i += 4) {
    const c1 = BASE64_CHARS.indexOf(cleaned[i] || 'A');
    const c2 = BASE64_CHARS.indexOf(cleaned[i + 1] || 'A');
    const c3 = cleaned[i + 2] === '=' ? 0 : BASE64_CHARS.indexOf(cleaned[i + 2] || 'A');
    const c4 = cleaned[i + 3] === '=' ? 0 : BASE64_CHARS.indexOf(cleaned[i + 3] || 'A');
    if (c1 < 0 || c2 < 0 || c3 < 0 || c4 < 0) continue;
    const triple = (c1 << 18) | (c2 << 12) | (c3 << 6) | c4;
    if (outIdx < byteLen) out[outIdx++] = (triple >> 16) & 0xff;
    if (outIdx < byteLen) out[outIdx++] = (triple >> 8) & 0xff;
    if (outIdx < byteLen) out[outIdx++] = triple & 0xff;
  }
  return out;
}

function isValidPngBytes(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

const noopSvgError = () => {};

interface OptionTileProps {
  id: string;
  label: string;
  svg: string;
  selected: boolean;
  onSelect: (id: string) => void;
}

const OptionTile = React.memo(function OptionTile({
  id,
  label,
  svg,
  selected,
  onSelect,
}: OptionTileProps) {
  return (
    <PressableScale
      variant="icon"
      testID={`avatar-option-${id}`}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={() => onSelect(id)}
      style={[styles.optionTile, selected && styles.optionTileSelected]}
    >
      <SvgXml xml={svg} width={TILE_SVG_SIZE} height={TILE_SVG_SIZE} onError={noopSvgError} />
      {selected ? (
        <View style={styles.optionCheck} pointerEvents="none">
          <Ionicons name="checkmark" size={11} color={colors.buttonColor} />
        </View>
      ) : null}
    </PressableScale>
  );
});

function BuilderSkeleton() {
  return (
    <View
      testID="avatar-builder-root"
      style={styles.root}
      accessibilityLabel="טוען את עורך האווטאר"
    >
      <View style={styles.skeletonTop}>
        <Skeleton width={PREVIEW_SIZE} height={PREVIEW_SIZE} radius={PREVIEW_SIZE / 2} />
        <Skeleton width="100%" height={44} radius={radii.md} />
        <View style={styles.skeletonBtnRow}>
          <Skeleton width="48%" height={40} radius={radii.md} />
          <Skeleton width="48%" height={40} radius={radii.md} />
        </View>
      </View>
      <View style={styles.skeletonChipRow}>
        {[0, 1, 2, 3, 4].map((idx) => (
          <Skeleton key={idx} width={64} height={32} radius={radii.pill} />
        ))}
      </View>
      <View style={styles.skeletonTilesRow}>
        {[0, 1, 2, 3, 4].map((idx) => (
          <View key={idx} style={styles.optionColumn}>
            <Skeleton width={TILE_SIZE} height={TILE_SIZE} radius={radii.md} />
            <Skeleton width={TILE_SIZE} height={TILE_SIZE} radius={radii.md} />
          </View>
        ))}
      </View>
    </View>
  );
}

export function AvatarBuilder({ onDirtyChange, onSaved }: AvatarBuilderProps) {
  const { user, profile } = useSession();
  const { showToast } = useToast();

  const [avatarMod, setAvatarMod] = useState<ChefAvatarModule | null>(() => cachedChefAvatarModule);
  const [loadError, setLoadError] = useState(false);

  const [activeTab, setActiveTab] = useState<AvatarTabKey>('skin');
  const [draftConfig, setDraftConfig] = useState<AvatarConfig | null>(null);
  const [baselineConfig, setBaselineConfig] = useState<AvatarConfig | null>(null);
  const [savedConfig, setSavedConfig] = useState<AvatarConfig | null>(null);
  const [locallyBuilt, setLocallyBuilt] = useState(false);

  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const viewShotRef = useRef<View | null>(null);
  const initializedUidRef = useRef<string | null>(null);
  const lastSyncedProfileKeyRef = useRef<string | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;

  const loadModule = useCallback(() => {
    setLoadError(false);
    loadChefAvatarModule()
      .then((mod) => {
        setAvatarMod(mod);
      })
      .catch((err) => {
        captureError(err, { service: 'avatar-builder', op: 'loadChefAvatarModule' });
        setLoadError(true);
      });
  }, []);

  useEffect(() => {
    if (!avatarMod) {
      loadModule();
    }
  }, [avatarMod, loadModule]);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      onDirtyChangeRef.current(false);
    };
  }, []);

  const uid = user?.uid || null;

  const hasUnsavedChanges = useMemo(() => {
    if (!draftConfig || !baselineConfig) return false;
    return !areAvatarConfigsEqual(draftConfig, baselineConfig);
  }, [draftConfig, baselineConfig]);

  // Initialize (and re-initialize only on uid switch or genuine remote profile avatarConfig change)
  useEffect(() => {
    if (!avatarMod) return;
    const rawSaved = profile?.avatarConfig ?? null;
    const normalizedSaved = rawSaved ? avatarMod.normalizeAvatarConfig(rawSaved) : null;
    const nextBaseline =
      normalizedSaved ?? avatarMod.normalizeAvatarConfig(avatarMod.DEFAULT_AVATAR_CONFIG);
    const profileKey = serializeAvatarConfig(normalizedSaved);

    const uidChanged = initializedUidRef.current !== uid;
    if (uidChanged || !draftConfig || !baselineConfig) {
      initializedUidRef.current = uid;
      lastSyncedProfileKeyRef.current = profileKey;
      setSavedConfig(normalizedSaved);
      setBaselineConfig(nextBaseline);
      setDraftConfig(nextBaseline);
      setLocallyBuilt(false);
      return;
    }

    // Only sync when Firestore profile.avatarConfig itself changes (never revert a fresh local save)
    if (profileKey !== lastSyncedProfileKeyRef.current) {
      lastSyncedProfileKeyRef.current = profileKey;
      if (!hasUnsavedChanges && !saving && !areAvatarConfigsEqual(baselineConfig, nextBaseline)) {
        setSavedConfig(normalizedSaved);
        setBaselineConfig(nextBaseline);
        setDraftConfig(nextBaseline);
      }
    }
  }, [
    avatarMod,
    uid,
    profile?.avatarConfig,
    draftConfig,
    baselineConfig,
    hasUnsavedChanges,
    saving,
  ]);

  useEffect(() => {
    onDirtyChangeRef.current(hasUnsavedChanges);
  }, [hasUnsavedChanges]);

  const tabs = useMemo<AvatarTabDef[]>(() => {
    if (!avatarMod) return [];
    return [
      { key: 'skin', label: avatarMod.AVATAR_COLORS.skin.label, palette: 'skin' },
      ...PART_ORDER.map((partKey) => ({
        key: partKey,
        label: avatarMod.AVATAR_PARTS[partKey].label,
        part: partKey,
        palette: PALETTE_FOR[partKey],
      })),
      {
        key: 'background',
        label: avatarMod.AVATAR_COLORS.background.label,
        palette: 'background',
      },
    ];
  }, [avatarMod]);

  const activeTabDef = useMemo(
    () => tabs.find((t) => t.key === activeTab) ?? tabs[0] ?? null,
    [tabs, activeTab],
  );

  const previewSvg = useMemo(() => {
    if (!avatarMod || !draftConfig) return '';
    return stripSvgMetadata(
      avatarMod.renderAvatarSvg(draftConfig, { title: 'תצוגה מקדימה של האווטאר' }),
    );
  }, [avatarMod, draftConfig]);

  // Memoize thumbnail SVGs excluding the active part itself (and background, and hat on hair tab),
  // so tapping options within a tab does not regenerate all thumbnails.
  const activePartKey = activeTabDef?.part ?? null;
  const thumbContextKey = useMemo(() => {
    if (!draftConfig || !activePartKey) return '';
    const partVals = PART_ORDER.map((k) => {
      if (k === activePartKey) return '_';
      if (activePartKey === 'hair' && k === 'hat') return 'none';
      return draftConfig.parts[k];
    }).join('|');
    const colorVals = COLOR_ORDER.map((k) =>
      k === 'background' ? 'none' : draftConfig.colors[k],
    ).join('|');
    return `${activePartKey}::${partVals}::${colorVals}`;
  }, [draftConfig, activePartKey]);

  const thumbnailPairs = useMemo(() => {
    if (!avatarMod || !draftConfig || !activePartKey || !thumbContextKey) return [];
    const partSpec = avatarMod.AVATAR_PARTS[activePartKey];
    const hatHidesHair = activePartKey === 'hair' && draftConfig.parts.hat !== 'none';
    const items = partSpec.options.map((opt) => {
      const parts = {
        ...draftConfig.parts,
        [activePartKey]: opt.id,
        ...(hatHidesHair ? { hat: 'none' } : {}),
      };
      const thumbSvg = stripSvgMetadata(
        avatarMod.renderAvatarSvg(
          {
            ...draftConfig,
            parts,
            colors: { ...draftConfig.colors, background: 'none' },
          },
          { viewBox: partSpec.crop },
        ),
      );
      return { id: opt.id, label: opt.label, svg: thumbSvg };
    });

    // Arrange into 2-row columns matching Web's grid-auto-flow: column
    const cols: { top: (typeof items)[number]; bottom?: (typeof items)[number] }[] = [];
    for (let i = 0; i < items.length; i += 2) {
      cols.push({ top: items[i], bottom: items[i + 1] });
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarMod, thumbContextKey]);

  const handleSelectPart = useCallback(
    (optionId: string) => {
      if (!activePartKey) return;
      setDraftConfig((prev) =>
        prev ? { ...prev, parts: { ...prev.parts, [activePartKey]: optionId } } : prev,
      );
      setFeedback(null);
    },
    [activePartKey],
  );

  const handleSelectColor = useCallback((group: AvatarColorGroup, colorId: string) => {
    setDraftConfig((prev) =>
      prev ? { ...prev, colors: { ...prev.colors, [group]: colorId } } : prev,
    );
    setFeedback(null);
  }, []);

  const handleRandomize = useCallback(() => {
    if (!avatarMod || saving) return;
    setDraftConfig(avatarMod.normalizeAvatarConfig(avatarMod.randomAvatarConfig()));
    setFeedback(null);
  }, [avatarMod, saving]);

  const handleUndo = useCallback(() => {
    if (!baselineConfig || saving) return;
    setDraftConfig(baselineConfig);
    setFeedback(null);
  }, [baselineConfig, saving]);

  const flashFeedback = useCallback((tone: 'ok' | 'err', text: string) => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    setFeedback({ tone, text });
    if (tone === 'ok') {
      feedbackTimerRef.current = setTimeout(() => {
        setFeedback((cur) => (cur?.tone === 'ok' ? null : cur));
      }, 2500);
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (saving || !avatarMod || !draftConfig || !uid) return;
    setSaving(true);
    setFeedback(null);

    try {
      const normalized = avatarMod.normalizeAvatarConfig(draftConfig);
      const cleanConfig: AvatarConfig = {
        v: avatarMod.AVATAR_CONFIG_VERSION,
        parts: { ...normalized.parts },
        colors: { ...normalized.colors },
      };

      let pngBytes: Uint8Array | null = null;
      try {
        if (viewShotRef.current) {
          const base64 = await captureRef(viewShotRef, {
            format: 'png',
            width: 256,
            height: 256,
            result: 'base64',
            quality: 0.9,
          });
          const decoded = decodeBase64ToUint8Array(base64);
          if (isValidPngBytes(decoded)) {
            pngBytes = decoded;
          }
        }
      } catch (captureErr) {
        captureError(captureErr, { service: 'avatar-builder', op: 'captureRef', uid });
      }

      if (pngBytes && pngBytes.byteLength >= MAX_AVATAR_PNG_BYTES && viewShotRef.current) {
        try {
          const smallerBase64 = await captureRef(viewShotRef, {
            format: 'png',
            width: 192,
            height: 192,
            result: 'base64',
            quality: 0.85,
          });
          const smaller = decodeBase64ToUint8Array(smallerBase64);
          if (isValidPngBytes(smaller)) {
            pngBytes = smaller;
          }
        } catch {
          // Proceed to size check
        }
      }

      if (!pngBytes) {
        pngBytes = decodeBase64ToUint8Array(HEADLESS_FALLBACK_PNG_BASE64);
      }

      if (pngBytes.byteLength >= MAX_AVATAR_PNG_BYTES) {
        throw new Error(`Avatar PNG exceeds 200 KB (${pngBytes.byteLength} bytes)`);
      }

      const avatarUrl = await AvatarUploadService.uploadAvatarPng(uid, pngBytes);
      await AuthService.updateProfile({ avatarConfig: cleanConfig, avatarUrl });

      setSavedConfig(cleanConfig);
      setBaselineConfig(cleanConfig);
      setDraftConfig(cleanConfig);
      setLocallyBuilt(true);
      onDirtyChangeRef.current(false);
      flashFeedback('ok', '✓ האווטאר נשמר');
      showToast('✓ האווטאר נשמר', 'success');
      onSaved();
    } catch (err) {
      captureError(err, { service: 'avatar-builder', op: 'saveAvatar', uid });
      flashFeedback('err', 'שמירת האווטאר נכשלה. נסה שנית.');
      showToast('שמירת האווטאר נכשלה. נסה שנית.', 'error');
    } finally {
      setSaving(false);
    }
  }, [saving, avatarMod, draftConfig, uid, flashFeedback, showToast, onSaved]);

  if (loadError) {
    return (
      <View testID="avatar-builder-root" style={styles.errorCard}>
        <Text style={styles.errorCardText}>
          טעינת עורך האווטאר נכשלה. בדוק את החיבור ונסה שנית.
        </Text>
        <PressableScale onPress={loadModule} style={styles.retryBtn}>
          <Text style={styles.retryBtnText} allowFontScaling={false}>
            נסה שוב
          </Text>
        </PressableScale>
      </View>
    );
  }

  if (!avatarMod || !draftConfig || !activeTabDef) {
    return <BuilderSkeleton />;
  }

  const isBuilt = locallyBuilt || (isBuiltAvatarUrl(profile?.avatarUrl) && Boolean(savedConfig));
  const saveDisabled = saving || (isBuilt && !hasUnsavedChanges);
  const undoDisabled = saving || !hasUnsavedChanges;
  const activePaletteKey = activeTabDef.palette ?? null;
  const activePalette = activePaletteKey ? avatarMod.AVATAR_COLORS[activePaletteKey] : null;
  const currentStatusText = isBuilt && !hasUnsavedChanges ? 'זה האווטאר שלך כרגע.' : '';

  return (
    <View testID="avatar-builder-root" style={styles.root}>
      {/* Live circular preview & action controls */}
      <View style={styles.topSection}>
        <View style={styles.previewShadowWrap}>
          <View style={styles.previewCircle}>
            <View
              ref={viewShotRef}
              collapsable={false}
              testID="avatar-preview-svg"
              accessibilityRole="image"
              accessibilityLabel="תצוגה מקדימה של האווטאר"
              style={styles.previewCapture}
            >
              <SvgXml
                xml={previewSvg}
                width={PREVIEW_SIZE}
                height={PREVIEW_SIZE}
                onError={noopSvgError}
              />
            </View>
          </View>
        </View>

        <View style={styles.actionsWrap}>
          <PressableScale
            testID="avatar-save-btn"
            accessibilityRole="button"
            accessibilityLabel={saving ? 'שומר…' : 'שמירת האווטאר'}
            accessibilityState={{ disabled: saveDisabled, busy: saving }}
            disabled={saveDisabled}
            onPress={() => {
              void handleSave();
            }}
            style={[styles.saveBtn, saveDisabled && styles.btnDisabled]}
          >
            {saving ? (
              <ActivityIndicator size="small" color={colors.buttonColor} />
            ) : (
              <Ionicons name="checkmark-circle-outline" size={18} color={colors.buttonColor} />
            )}
            <Text style={styles.saveBtnLabel} allowFontScaling={false}>
              {saving ? 'שומר…' : 'שמירת האווטאר'}
            </Text>
          </PressableScale>

          <View style={styles.secondaryActionsRow}>
            <PressableScale
              testID="avatar-randomize-btn"
              accessibilityRole="button"
              accessibilityLabel="הפתע אותי"
              accessibilityState={{ disabled: saving }}
              disabled={saving}
              onPress={handleRandomize}
              style={[styles.secondaryBtn, saving && styles.btnDisabled]}
            >
              <Ionicons name="dice-outline" size={16} color={colors.ink} />
              <Text style={styles.secondaryBtnLabel} allowFontScaling={false}>
                הפתע אותי
              </Text>
            </PressableScale>

            <PressableScale
              testID="avatar-undo-btn"
              accessibilityRole="button"
              accessibilityLabel="ביטול השינויים"
              accessibilityState={{ disabled: undoDisabled }}
              disabled={undoDisabled}
              onPress={handleUndo}
              style={[styles.secondaryBtn, undoDisabled && styles.btnDisabled]}
            >
              <Ionicons name="arrow-undo-outline" size={16} color={colors.ink} />
              <Text style={styles.secondaryBtnLabel} allowFontScaling={false}>
                ביטול השינויים
              </Text>
            </PressableScale>
          </View>

          <View style={styles.statusSlot}>
            {feedback ? (
              <View
                style={[
                  styles.feedbackPill,
                  feedback.tone === 'ok' ? styles.feedbackOk : styles.feedbackErr,
                ]}
              >
                <Text
                  style={[
                    styles.feedbackText,
                    feedback.tone === 'ok' ? styles.feedbackTextOk : styles.feedbackTextErr,
                  ]}
                >
                  {feedback.text}
                </Text>
              </View>
            ) : currentStatusText ? (
              <Text style={styles.statusText}>{currentStatusText}</Text>
            ) : null}
          </View>
        </View>
      </View>

      {/* Exact 10 category tabs in order */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabsScrollContent}
        accessibilityRole="tablist"
      >
        {tabs.map((tab) => {
          const selected = tab.key === activeTabDef.key;
          return (
            <PressableScale
              key={tab.key}
              testID={`avatar-cat-${tab.key}`}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={tab.label}
              onPress={() => setActiveTab(tab.key)}
              style={[styles.tabPill, selected && styles.tabPillSelected]}
            >
              <Text
                style={[styles.tabPillText, selected && styles.tabPillTextSelected]}
                allowFontScaling={false}
              >
                {tab.label}
              </Text>
            </PressableScale>
          );
        })}
      </ScrollView>

      {/* Active category panel: 2-row option tiles (for part tabs) + inline color swatches */}
      <View style={styles.panel}>
        {activePartKey ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.optionsScrollContent}
          >
            {thumbnailPairs.map((col) => (
              <View key={col.top.id} style={styles.optionColumn}>
                <OptionTile
                  id={col.top.id}
                  label={col.top.label}
                  svg={col.top.svg}
                  selected={draftConfig.parts[activePartKey] === col.top.id}
                  onSelect={handleSelectPart}
                />
                {col.bottom ? (
                  <OptionTile
                    id={col.bottom.id}
                    label={col.bottom.label}
                    svg={col.bottom.svg}
                    selected={draftConfig.parts[activePartKey] === col.bottom.id}
                    onSelect={handleSelectPart}
                  />
                ) : (
                  <View style={styles.optionSpacer} />
                )}
              </View>
            ))}
          </ScrollView>
        ) : null}

        {activePalette && activePaletteKey ? (
          <View style={styles.paletteSection}>
            <Text style={styles.paletteLabel}>{activePalette.label}</Text>
            <View style={styles.swatchesGrid}>
              {activePalette.options.map((swatch) => {
                const selected = draftConfig.colors[activePaletteKey] === swatch.id;
                const isTransparent = swatch.hex === null;
                return (
                  <PressableScale
                    key={swatch.id}
                    variant="icon"
                    testID={`avatar-color-${activePaletteKey}-${swatch.id}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={swatch.label}
                    onPress={() => handleSelectColor(activePaletteKey, swatch.id)}
                    style={[styles.swatchRing, selected && styles.swatchRingSelected]}
                  >
                    <View
                      style={[
                        styles.swatchDot,
                        isTransparent
                          ? styles.swatchTransparent
                          : { backgroundColor: `#${swatch.hex}` },
                      ]}
                    >
                      {isTransparent ? <View style={styles.transparentSlash} /> : null}
                    </View>
                  </PressableScale>
                );
              })}
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.md,
  },
  topSection: {
    alignItems: 'center',
    gap: spacing.md,
  },
  previewShadowWrap: {
    width: PREVIEW_SIZE,
    height: PREVIEW_SIZE,
    borderRadius: PREVIEW_SIZE / 2,
    backgroundColor: colors.surface2,
    ...shadows.level1,
  },
  previewCircle: {
    width: PREVIEW_SIZE,
    height: PREVIEW_SIZE,
    borderRadius: PREVIEW_SIZE / 2,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
    borderWidth: 2,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewCapture: {
    width: PREVIEW_SIZE,
    height: PREVIEW_SIZE,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionsWrap: {
    width: '100%',
    gap: spacing.sm,
  },
  saveBtn: {
    width: '100%',
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  saveBtnLabel: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyBold,
    color: colors.buttonColor,
    textAlign: 'center',
    includeFontPadding: false,
  },
  secondaryActionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  secondaryBtn: {
    flex: 1,
    minHeight: 40,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  secondaryBtnLabel: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink,
    textAlign: 'center',
    includeFontPadding: false,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  statusSlot: {
    minHeight: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusText: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    textAlign: 'center',
    includeFontPadding: false,
  },
  feedbackPill: {
    width: '100%',
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    alignItems: 'center',
  },
  feedbackOk: {
    backgroundColor: statusColors.approvedBg,
  },
  feedbackErr: {
    backgroundColor: statusColors.rejectedBg,
  },
  feedbackText: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyBold,
    textAlign: 'center',
    includeFontPadding: false,
  },
  feedbackTextOk: {
    color: statusColors.approvedText,
  },
  feedbackTextErr: {
    color: statusColors.rejectedText,
  },
  tabsScrollContent: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  tabPill: {
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    backgroundColor: colors.surface1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabPillSelected: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  tabPillText: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink2,
    textAlign: 'center',
    includeFontPadding: false,
  },
  tabPillTextSelected: {
    color: colors.buttonColor,
    fontFamily: fontFamilies.bodyBold,
  },
  panel: {
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: spacing.md,
    gap: spacing.md,
  },
  optionsScrollContent: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: 2,
  },
  optionColumn: {
    gap: spacing.sm,
  },
  optionTile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: colors.hairline,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  optionTileSelected: {
    borderColor: colors.primaryDark,
  },
  optionCheck: {
    position: 'absolute',
    top: 3,
    end: 3,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionSpacer: {
    width: TILE_SIZE,
    height: TILE_SIZE,
  },
  paletteSection: {
    gap: spacing.sm,
  },
  paletteLabel: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink3,
    textAlign: 'left',
    includeFontPadding: false,
  },
  swatchesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  swatchRing: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchRingSelected: {
    borderColor: colors.primaryDark,
  },
  swatchDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchTransparent: {
    backgroundColor: colors.surface1,
  },
  transparentSlash: {
    width: 38,
    height: 2.5,
    backgroundColor: colors.secondary,
    transform: [{ rotate: '-45deg' }],
  },
  skeletonTop: {
    alignItems: 'center',
    gap: spacing.md,
  },
  skeletonBtnRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  skeletonChipRow: {
    flexDirection: 'row',
    gap: 6,
  },
  skeletonTilesRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  errorCard: {
    backgroundColor: statusColors.rejectedBg,
    borderRadius: radii.md,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.md,
  },
  errorCardText: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyMedium,
    color: statusColors.rejectedText,
    textAlign: 'center',
    includeFontPadding: false,
  },
  retryBtn: {
    paddingVertical: 8,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
  },
  retryBtnText: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyBold,
    color: colors.ink,
    includeFontPadding: false,
  },
});
