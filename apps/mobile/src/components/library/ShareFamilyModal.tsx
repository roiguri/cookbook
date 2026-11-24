import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radii, spacing, statusColors, typeScale } from '@/theme';
import { Button, ModalSheet, PressableScale, Skeleton, useToast } from '@/components/ui';
import { useSession } from '@/context/SessionContext';
import { captureError } from '@/services/logger';
import {
  RecipeShareService,
  type FamilyMember,
  type RecipeShareRecord,
} from '@/services/recipes/recipe-share-service';

// Matches Web share-family-modal.js: show name search starting from 8 available family members.
const SEARCH_FROM = 8;
const UNNAMED = 'ללא שם';

export interface ShareFamilyModalProps {
  visible: boolean;
  recipeId: string;
  recipeName?: string;
  /** Defaults to signed-in session UID if omitted. */
  authorId?: string;
  /** Defaults to signed-in profile fullName / displayName / email prefix if omitted. */
  authorName?: string;
  /** Optional recipe URL for the post-share "שליחת קישור" CTA. */
  url?: string;
  onClose: () => void;
  /** Called after sharing or revoking access so parent screens can refresh. */
  onSharesChanged?: (recipeId: string) => void;
}

/**
 * Formats the post-share confirmation line verbatim from Web `share-family-modal.js`.
 */
export function sharedWithText(names: Array<string | null | undefined>): string {
  const normalized = names.map((n) => (n || '').trim() || UNNAMED);
  if (normalized.length === 0) return '';
  if (normalized.length === 1) return `שותף עם ${normalized[0]}`;
  if (normalized.length === 2) return `שותף עם ${normalized[0]} ו${normalized[1]}`;
  return `שותף עם ${normalized[0]} ועוד ${normalized.length - 1}`;
}

function formatDayMonth(timestamp: any): string {
  if (!timestamp) return '';
  const date =
    typeof timestamp.toDate === 'function'
      ? timestamp.toDate()
      : typeof timestamp.seconds === 'number'
        ? new Date(timestamp.seconds * 1000)
        : new Date(timestamp);
  if (!date || Number.isNaN(date.getTime())) return '';
  return `${date.getDate()}.${date.getMonth() + 1}`;
}

function MemberAvatar({
  name,
  avatarUrl,
  size = 34,
  stackBorder = false,
}: {
  name?: string | null;
  avatarUrl?: string | null;
  size?: number;
  stackBorder?: boolean;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const initial = ((name || '?').trim().charAt(0) || '?').toUpperCase();
  const radius = size / 2;

  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: radius },
        stackBorder && styles.avatarStackBorder,
      ]}
    >
      <Text
        allowFontScaling={false}
        style={[styles.avatarInitial, { fontSize: size <= 28 ? 11.5 : 13 }]}
      >
        {initial}
      </Text>
      {avatarUrl && !imgFailed ? (
        <Image
          source={{ uri: avatarUrl }}
          contentFit="cover"
          transition={150}
          onError={() => setImgFailed(true)}
          style={[StyleSheet.absoluteFillObject, { borderRadius: radius }]}
        />
      ) : null}
    </View>
  );
}

/**
 * 2-section Family Share picker modal matching Web `<share-family-modal>`:
 * - Section 1: Existing Recipients (`עם גישה · N`, collapsible with avatar stack & individual `הסרה`)
 * - Section 2: Available Family (`בני משפחה · N`, multi-select checkboxes + search when >= 8)
 * - Post-share confirmation state stays open with `שותף עם <name>`, `שליחת קישור`, and `סגירה`.
 */
export function ShareFamilyModal({
  visible,
  recipeId,
  recipeName = '',
  authorId,
  authorName,
  url,
  onClose,
  onSharesChanged,
}: ShareFamilyModalProps) {
  const { user, profile } = useSession();
  const { showToast } = useToast();
  const { height: windowHeight } = useWindowDimensions();

  const resolvedAuthorId = authorId || user?.uid || '';
  const resolvedAuthorName =
    (authorName || '').trim() ||
    (profile?.fullName || '').trim() ||
    (user?.displayName || '').trim() ||
    (user?.email || '').split('@')[0]?.trim() ||
    'בן משפחה';

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [family, setFamily] = useState<FamilyMember[]>([]);
  const [shares, setShares] = useState<RecipeShareRecord[]>([]);
  const [selectedUids, setSelectedUids] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [accessExpanded, setAccessExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [removingUid, setRemovingUid] = useState<string | null>(null);
  const [justSharedNames, setJustSharedNames] = useState<string[]>([]);

  const loadData = useCallback(async () => {
    if (!recipeId || !resolvedAuthorId) return;
    setLoading(true);
    setLoadError('');
    try {
      const [members, currentShares] = await Promise.all([
        RecipeShareService.listFamilyMembers(),
        RecipeShareService.listSharesForRecipe(recipeId, resolvedAuthorId),
      ]);
      setFamily(members);
      setShares(currentShares);
    } catch (err) {
      captureError(err, { service: 'shareFamilyModal', op: 'load', recipeId });
      setLoadError('לא הצלחנו לטעון את בני המשפחה. נסו שוב.');
    } finally {
      setLoading(false);
    }
  }, [recipeId, resolvedAuthorId]);

  useEffect(() => {
    if (!visible) return;
    setSelectedUids(new Set());
    setSearchQuery('');
    setAccessExpanded(false);
    setJustSharedNames([]);
    setLoadError('');
    void loadData();
  }, [visible, loadData]);

  const familyByUid = useMemo(() => {
    const map = new Map<string, FamilyMember>();
    for (const member of family) {
      map.set(member.uid, member);
    }
    return map;
  }, [family]);

  const accessPeople = useMemo(() => {
    return shares.map((share) => {
      const member = familyByUid.get(share.recipientUid);
      return {
        uid: share.recipientUid,
        name: member?.name || UNNAMED,
        avatarUrl: member?.avatarUrl ?? null,
        sharedAt: share.sharedAt,
      };
    });
  }, [shares, familyByUid]);

  const availableMembers = useMemo(() => {
    const withAccess = new Set(shares.map((s) => s.recipientUid));
    return family.filter((member) => !withAccess.has(member.uid));
  }, [family, shares]);

  const filteredAvailable = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return availableMembers;
    return availableMembers.filter((member) => (member.name || '').toLowerCase().includes(q));
  }, [availableMembers, searchQuery]);

  const toggleMember = useCallback((uid: string) => {
    setSelectedUids((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }, []);

  const handleShare = useCallback(async () => {
    if (selectedUids.size === 0 || submitting || !recipeId || !resolvedAuthorId) return;
    const recipientUids = Array.from(selectedUids);
    setSubmitting(true);
    try {
      await RecipeShareService.shareWithMany(recipeId, recipientUids, {
        uid: resolvedAuthorId,
        name: resolvedAuthorName,
      });
      const names = recipientUids.map((uid) => familyByUid.get(uid)?.name || UNNAMED);
      setSelectedUids(new Set());
      setJustSharedNames(names);
      const updatedShares = await RecipeShareService.listSharesForRecipe(
        recipeId,
        resolvedAuthorId,
      );
      setShares(updatedShares);
      onSharesChanged?.(recipeId);
    } catch (err) {
      captureError(err, { service: 'shareFamilyModal', op: 'shareWithMany', recipeId });
      showToast('לא הצלחנו לשתף את המתכון. נסו שוב.', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [
    selectedUids,
    submitting,
    recipeId,
    resolvedAuthorId,
    resolvedAuthorName,
    familyByUid,
    onSharesChanged,
    showToast,
  ]);

  const handleRemove = useCallback(
    async (recipientUid: string) => {
      if (!recipeId || !resolvedAuthorId || removingUid) return;
      setRemovingUid(recipientUid);
      try {
        await RecipeShareService.remove(recipeId, recipientUid);
        const updatedShares = await RecipeShareService.listSharesForRecipe(
          recipeId,
          resolvedAuthorId,
        );
        setShares(updatedShares);
        onSharesChanged?.(recipeId);
      } catch (err) {
        captureError(err, { service: 'shareFamilyModal', op: 'remove', recipeId });
        showToast('לא הצלחנו להסיר את הגישה. נסו שוב.', 'error');
      } finally {
        setRemovingUid(null);
      }
    },
    [recipeId, resolvedAuthorId, removingUid, onSharesChanged, showToast],
  );

  const handleSendLink = useCallback(async () => {
    const shareUrl = url || Linking.createURL(`/recipe/${recipeId}`);
    try {
      await Share.share({
        title: recipeName || 'מתכון מהספר המשפחתי',
        message: recipeName ? `${recipeName}\n${shareUrl}` : shareUrl,
        url: shareUrl,
      });
    } catch {
      try {
        await Clipboard.setStringAsync(shareUrl);
        showToast('הקישור הועתק', 'success');
      } catch (err) {
        captureError(err, { service: 'shareFamilyModal', op: 'sendLink', recipeId });
        showToast('לא הצלחנו להעתיק. נסו שוב.', 'error');
      }
    }
  }, [url, recipeId, recipeName, showToast]);

  const hasShared = justSharedNames.length > 0;
  const selectedCount = selectedUids.size;
  const submitLabel = selectedCount > 0 ? `שיתוף עם ${selectedCount}` : 'שיתוף';
  const scrollMaxHeight = Math.min(Math.max(windowHeight * 0.48, 220), 420);

  return (
    <ModalSheet
      visible={visible}
      title="שיתוף עם בני משפחה"
      onClose={onClose}
      testID="share-family-modal"
      scrollable={false}
    >
      <View style={styles.content}>
        {hasShared ? (
          <View style={styles.doneBanner}>
            <Text numberOfLines={1} ellipsizeMode="tail" style={styles.doneText}>
              {sharedWithText(justSharedNames)}
            </Text>
            <PressableScale
              testID="share-family-send-link-btn"
              onPress={handleSendLink}
              style={styles.sendLinkBtn}
              accessibilityRole="button"
              accessibilityLabel="שליחת קישור"
            >
              <Ionicons name="link-outline" size={15} color={colors.buttonColor} />
              <Text allowFontScaling={false} style={styles.sendLinkText}>
                שליחת קישור
              </Text>
            </PressableScale>
          </View>
        ) : (
          <Text style={styles.introText}>
            {`רק מי שתבחרו יוכלו לראות את ״${recipeName}״. המתכון נשאר פרטי, והם תמיד יראו את הגרסה העדכנית.`}
          </Text>
        )}

        {loadError ? (
          <View style={styles.messageBox}>
            <Text style={styles.errorMessage}>{loadError}</Text>
            <Button label="נסו שוב" variant="secondary" size="sm" onPress={loadData} />
          </View>
        ) : (
          <ScrollView
            style={[styles.scrollArea, { maxHeight: scrollMaxHeight }]}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            {loading ? (
              <View style={styles.section}>
                <Text style={styles.sectionHead}>בני משפחה</Text>
                <View style={styles.listCard}>
                  {[0, 1, 2].map((idx) => (
                    <View key={idx} style={[styles.row, idx === 2 && styles.rowLast]}>
                      <Skeleton width={34} height={34} radius={17} />
                      <Skeleton width={idx === 1 ? '38%' : '52%'} height={14} radius={radii.pill} />
                    </View>
                  ))}
                </View>
              </View>
            ) : (
              <>
                {/* Section 1: Existing Recipients ("עם גישה · N") */}
                {accessPeople.length > 0 ? (
                  <View style={styles.section}>
                    <PressableScale
                      testID="share-family-access-section"
                      variant="card"
                      accessibilityRole="button"
                      accessibilityState={{ expanded: accessExpanded }}
                      onPress={() => setAccessExpanded((prev) => !prev)}
                      style={styles.accessToggle}
                    >
                      <View style={styles.avatarStack}>
                        {accessPeople.slice(0, 3).map((person, index) => (
                          <View
                            key={person.uid}
                            style={index > 0 ? styles.avatarStackOverlap : undefined}
                          >
                            <MemberAvatar
                              name={person.name}
                              avatarUrl={person.avatarUrl}
                              size={28}
                              stackBorder
                            />
                          </View>
                        ))}
                      </View>
                      <Text style={styles.accessLabel}>{`עם גישה · ${accessPeople.length}`}</Text>
                      <Ionicons
                        name={accessExpanded ? 'chevron-up' : 'chevron-down'}
                        size={18}
                        color={colors.ink3}
                      />
                    </PressableScale>

                    {accessExpanded ? (
                      <View style={styles.listCard}>
                        {accessPeople.map((person, index) => {
                          const dateStr = formatDayMonth(person.sharedAt);
                          const isRemoving = removingUid === person.uid;
                          const isLast = index === accessPeople.length - 1;
                          return (
                            <View
                              key={person.uid}
                              testID={`share-family-member-${person.uid}`}
                              collapsable={false}
                              style={[styles.row, isLast && styles.rowLast]}
                            >
                              <MemberAvatar name={person.name} avatarUrl={person.avatarUrl} />
                              <View style={styles.who}>
                                <Text numberOfLines={1} style={styles.memberName}>
                                  {person.name}
                                </Text>
                                <Text style={styles.memberMeta}>
                                  {dateStr ? `שותף ב־${dateStr}` : 'שותף'}
                                </Text>
                              </View>
                              <PressableScale
                                testID={`share-family-remove-${person.uid}`}
                                disabled={isRemoving}
                                onPress={() => handleRemove(person.uid)}
                                accessibilityRole="button"
                                accessibilityLabel={`הסרת הגישה של ${person.name}`}
                                style={[styles.removeBtn, isRemoving && styles.removeBtnDisabled]}
                              >
                                {isRemoving ? (
                                  <ActivityIndicator size="small" color={colors.secondaryDark} />
                                ) : (
                                  <Text allowFontScaling={false} style={styles.removeBtnText}>
                                    הסרה
                                  </Text>
                                )}
                              </PressableScale>
                            </View>
                          );
                        })}
                      </View>
                    ) : null}
                  </View>
                ) : null}

                {/* Empty / all-shared messages */}
                {family.length === 0 ? (
                  <Text style={styles.infoMessage}>אין עדיין בני משפחה נוספים באתר לשתף איתם.</Text>
                ) : availableMembers.length === 0 ? (
                  <Text style={styles.infoMessage}>כל בני המשפחה כבר יכולים לראות את המתכון.</Text>
                ) : (
                  /* Section 2: Available Family ("בני משפחה · N") */
                  <View style={styles.section}>
                    <Text style={styles.sectionHead}>
                      {`בני משפחה · ${availableMembers.length}`}
                    </Text>

                    {availableMembers.length >= SEARCH_FROM ? (
                      <View style={styles.searchWrap}>
                        <Ionicons name="search-outline" size={16} color={colors.ink3} />
                        <TextInput
                          testID="share-family-search-input"
                          value={searchQuery}
                          onChangeText={setSearchQuery}
                          placeholder="חיפוש לפי שם"
                          placeholderTextColor={colors.ink4}
                          autoCorrect={false}
                          style={styles.searchInput}
                        />
                        {searchQuery.length > 0 ? (
                          <Pressable
                            onPress={() => setSearchQuery('')}
                            accessibilityLabel="נקה חיפוש"
                            hitSlop={8}
                          >
                            <Ionicons name="close-circle" size={16} color={colors.ink3} />
                          </Pressable>
                        ) : null}
                      </View>
                    ) : null}

                    {filteredAvailable.length === 0 && searchQuery.trim().length > 0 ? (
                      <Text style={styles.infoMessage}>אין בני משפחה בשם הזה.</Text>
                    ) : (
                      <View style={styles.listCard}>
                        {filteredAvailable.map((member, index) => {
                          const isSelected = selectedUids.has(member.uid);
                          const isLast = index === filteredAvailable.length - 1;
                          const displayName = member.name || UNNAMED;
                          return (
                            <View
                              key={member.uid}
                              testID={`share-family-member-${member.uid}`}
                              collapsable={false}
                              style={[styles.rowContainer, !isLast && styles.rowDivider]}
                            >
                              <Pressable
                                testID={`share-family-toggle-${member.uid}`}
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked: isSelected }}
                                accessibilityLabel={displayName}
                                onPress={() => toggleMember(member.uid)}
                                style={[
                                  styles.row,
                                  styles.rowLast,
                                  isSelected && styles.rowSelected,
                                ]}
                              >
                                <View
                                  style={[styles.checkbox, isSelected && styles.checkboxSelected]}
                                >
                                  {isSelected ? (
                                    <Ionicons
                                      name="checkmark"
                                      size={14}
                                      color={colors.buttonColor}
                                    />
                                  ) : null}
                                </View>
                                <MemberAvatar name={displayName} avatarUrl={member.avatarUrl} />
                                <View style={styles.who}>
                                  <Text numberOfLines={1} style={styles.memberName}>
                                    {displayName}
                                  </Text>
                                </View>
                              </Pressable>
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </View>
                )}
              </>
            )}
          </ScrollView>
        )}

        <View style={styles.footer}>
          <Button
            testID="share-family-close-btn"
            label={hasShared ? 'סגירה' : 'ביטול'}
            variant="secondary"
            onPress={onClose}
            style={styles.footerBtn}
          />
          <Button
            testID="share-family-submit-btn"
            label={submitLabel}
            variant="primary"
            disabled={selectedCount === 0 || submitting}
            loading={submitting}
            onPress={handleShare}
            style={styles.footerBtn}
          />
        </View>
      </View>
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.md,
  },
  introText: {
    fontSize: 13.5,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    lineHeight: 21,
    textAlign: 'left',
  },
  doneBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: statusColors.approvedBg,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  doneText: {
    flex: 1,
    fontSize: 13.5,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.primaryDark,
    textAlign: 'left',
    includeFontPadding: false,
  },
  sendLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
    paddingVertical: 8,
    paddingHorizontal: 12,
    minHeight: 36,
  },
  sendLinkText: {
    fontSize: 13,
    fontFamily: fontFamilies.bodyBold,
    color: colors.buttonColor,
    includeFontPadding: false,
  },
  scrollArea: {
    flexGrow: 0,
  },
  scrollContent: {
    gap: spacing.lg,
    paddingBottom: spacing.xs,
  },
  section: {
    gap: spacing.xs,
  },
  sectionHead: {
    fontSize: 12,
    fontFamily: fontFamilies.bodyBold,
    color: colors.ink3,
    textAlign: 'left',
    includeFontPadding: false,
    marginBottom: 2,
  },
  accessToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 50,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface1,
  },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarStackOverlap: {
    marginStart: -10,
  },
  accessLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink,
    textAlign: 'left',
    includeFontPadding: false,
  },
  listCard: {
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.md,
    backgroundColor: colors.surface1,
    overflow: 'hidden',
  },
  rowContainer: {
    backgroundColor: colors.surface1,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    backgroundColor: colors.surface1,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowSelected: {
    backgroundColor: statusColors.approvedBg,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radii.xs,
    borderWidth: 1.5,
    borderColor: colors.hairlineStrong,
    backgroundColor: colors.surface1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  avatar: {
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarStackBorder: {
    borderWidth: 2,
    borderColor: colors.surface1,
  },
  avatarInitial: {
    color: colors.buttonColor,
    fontFamily: fontFamilies.bodyBold,
    includeFontPadding: false,
  },
  who: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  memberName: {
    fontSize: 14.5,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink,
    textAlign: 'left',
    includeFontPadding: false,
  },
  memberMeta: {
    fontSize: 12,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    textAlign: 'left',
    includeFontPadding: false,
  },
  removeBtn: {
    minHeight: 36,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    backgroundColor: colors.surface1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBtnDisabled: {
    opacity: 0.5,
  },
  removeBtnText: {
    fontSize: 13,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.secondaryDark,
    includeFontPadding: false,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    marginBottom: spacing.xs,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: fontFamilies.body,
    color: colors.ink,
    paddingVertical: 8,
    textAlign: 'right',
  },
  messageBox: {
    paddingVertical: spacing.md,
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  errorMessage: {
    fontSize: 13.5,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.secondaryDark,
    textAlign: 'left',
  },
  infoMessage: {
    fontSize: 13.5,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    textAlign: 'left',
    lineHeight: 20,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  footerBtn: {
    flex: 1,
  },
});
