import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radii, spacing, statusColors, typeScale } from '@/theme';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ModalSheet,
  PressableScale,
  useToast,
} from '@/components/ui';
import {
  FailedUrlExtractionService,
  type FailedUrlExtractionDoc,
} from '@/services/admin/failed-url-extraction-service';
import { captureError } from '@/services/logger';

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

export interface FailedUrlsSectionProps {
  items: FailedUrlExtractionDoc[];
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void | Promise<void>;
  onDeleted: () => void | Promise<void>;
}

function formatAttemptDate(ts: any): string {
  if (!ts) return '';
  const d =
    typeof ts.toDate === 'function'
      ? ts.toDate()
      : typeof ts.seconds === 'number'
        ? new Date(ts.seconds * 1000)
        : new Date(ts);
  if (!d || Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm} ${hh}:${mi}`;
}

export function FailedUrlsSection({
  items,
  loading,
  refreshing,
  onRefresh,
  onDeleted,
}: FailedUrlsSectionProps) {
  const { showToast } = useToast();

  const [expanded, setExpanded] = useState(false);
  const [detailsItem, setDetailsItem] = useState<FailedUrlExtractionDoc | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FailedUrlExtractionDoc | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleCopyUrl = useCallback(
    async (url: string) => {
      try {
        await Clipboard.setStringAsync(url);
        showToast('הכתובת הועתקה ללוח', 'success');
      } catch {
        showToast('כשל בהעתקה ללוח', 'error');
      }
    },
    [showToast],
  );

  const handleCopyFullError = useCallback(
    async (item: FailedUrlExtractionDoc) => {
      try {
        const json = JSON.stringify(item.error ?? {}, null, 2);
        await Clipboard.setStringAsync(json);
        showToast('השגיאה הועתקה ללוח', 'success');
      } catch {
        showToast('כשל בהעתקה ללוח', 'error');
      }
    },
    [showToast],
  );

  const handleDeleteDirect = useCallback(
    async (item: FailedUrlExtractionDoc) => {
      if (deleting) return;
      setDeleting(true);
      try {
        await FailedUrlExtractionService.delete(item.id);
        setDeleteTarget(null);
        showToast('הרשומה נמחקה בהצלחה', 'success');
        await onDeleted();
      } catch (err) {
        captureError(err, {
          service: 'dashboard',
          op: 'deleteFailedUrl',
          recordId: item.id,
        });
        showToast('מחיקת הרשומה נכשלה. נסו שוב.', 'error');
      } finally {
        setDeleting(false);
      }
    },
    [deleting, showToast, onDeleted],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    await handleDeleteDirect(deleteTarget);
  }, [deleteTarget, handleDeleteDirect]);

  return (
    <View testID="dashboard-panel-failed-urls" collapsable={false}>
      <Card style={styles.sectionCard}>
        {/* Accordion Header */}
        <View style={styles.sectionHeader}>
          <PressableScale
            testID="dashboard-section-failed-urls"
            variant="button"
            onPress={() => setExpanded((prev) => !prev)}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            style={styles.sectionToggle}
          >
            <View style={styles.sectionTitleGroup}>
              <Ionicons name="link-outline" size={20} color={colors.secondary} />
              <Text style={styles.sectionTitle}>כתובות שנכשלו</Text>
              <Badge label={String(items.length)} tone={items.length > 0 ? 'danger' : 'neutral'} />
            </View>
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={colors.ink3}
            />
          </PressableScale>

          <PressableScale
            testID="dashboard-section-failed-urls-refresh"
            variant="icon"
            disabled={refreshing}
            onPress={() => {
              void onRefresh();
            }}
            accessibilityLabel="רענן כתובות שנכשלו"
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
            {loading && items.length === 0 ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.emptyText}>טוען כתובות שנכשלו...</Text>
              </View>
            ) : items.length === 0 ? (
              <Text style={styles.emptyText}>אין כתובות שנכשלו</Text>
            ) : (
              <View style={styles.list}>
                {items.map((item) => {
                  const attemptTime = formatAttemptDate(item.lastAttempt);
                  return (
                    <View
                      key={item.id}
                      testID={`failed-url-item-${item.id}`}
                      collapsable={false}
                      style={styles.itemRow}
                    >
                      <View style={styles.itemTopRow}>
                        <Text style={styles.urlText} numberOfLines={2} ellipsizeMode="middle">
                          {item.url}
                        </Text>
                        <View style={styles.countBadges}>
                          <Badge label={`${item.count ?? 1} ✕`} tone="danger" />
                          {item.kind === 'video' ? <Badge label="סרטון" tone="neutral" /> : null}
                        </View>
                      </View>

                      <Text style={styles.errorPreview} numberOfLines={2}>
                        {item.error?.message || 'שגיאה לא ידועה'}
                      </Text>

                      {attemptTime ? (
                        <Text style={styles.attemptMeta}>ניסיון אחרון: {attemptTime}</Text>
                      ) : null}

                      <View style={styles.actionsRow}>
                        <Button
                          testID={`failed-url-details-${item.id}`}
                          label="פרטים נוספים"
                          variant="secondary"
                          size="sm"
                          onPress={() => setDetailsItem(item)}
                          style={styles.actionBtn}
                        />
                        <Button
                          testID={`failed-url-copy-${item.id}`}
                          label="העתק"
                          variant="outline"
                          size="sm"
                          onPress={() => {
                            void handleCopyUrl(item.url);
                          }}
                        />
                        <Button
                          testID={`failed-url-delete-${item.id}`}
                          label="מחק"
                          variant="danger"
                          size="sm"
                          disabled={deleting}
                          onPress={() => {
                            void handleDeleteDirect(item);
                          }}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        ) : null}
      </Card>

      {/* Full Error Details Sheet */}
      <ModalSheet
        visible={Boolean(detailsItem)}
        title="פרטי שגיאה מלאים"
        onClose={() => setDetailsItem(null)}
        testID="failed-url-details-modal"
      >
        {detailsItem ? (
          <View style={styles.detailsBody}>
            <Text style={styles.detailsUrl} selectable>
              {detailsItem.url}
            </Text>

            <View style={styles.detailsMetaRow}>
              <Badge label={`ניסיונות: ${detailsItem.count ?? 1}`} tone="danger" />
              {detailsItem.kind ? (
                <Badge label={detailsItem.kind === 'video' ? 'סרטון' : 'אתר'} tone="neutral" />
              ) : null}
              {detailsItem.lastAttempt ? (
                <Badge label={formatAttemptDate(detailsItem.lastAttempt)} tone="neutral" />
              ) : null}
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator
              style={styles.jsonBox}
              contentContainerStyle={styles.jsonBoxContent}
            >
              <Text selectable style={styles.jsonText}>
                {JSON.stringify(detailsItem.error ?? {}, null, 2)}
              </Text>
            </ScrollView>

            <View style={styles.detailsActions}>
              <Button
                label="העתק שגיאה"
                variant="primary"
                onPress={() => {
                  void handleCopyFullError(detailsItem);
                }}
                style={styles.detailsActionBtn}
              />
              <Button
                label="סגור"
                variant="secondary"
                onPress={() => setDetailsItem(null)}
                style={styles.detailsActionBtn}
              />
            </View>
          </View>
        ) : null}
      </ModalSheet>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        visible={Boolean(deleteTarget)}
        title="מחיקת רשומה"
        message="האם אתה בטוח שברצונך למחוק רשומה זו?"
        confirmLabel="מחק"
        cancelLabel="ביטול"
        destructive
        loading={deleting}
        confirmTestID="failed-url-delete-confirm-btn"
        onConfirm={() => {
          void handleConfirmDelete();
        }}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null);
        }}
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
  list: {
    gap: spacing.sm,
  },
  itemRow: {
    backgroundColor: colors.surface0,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: spacing.md,
    gap: spacing.xs,
  },
  itemTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  urlText: {
    flex: 1,
    fontFamily: MONO_FONT,
    fontSize: 12,
    color: colors.ink2,
    writingDirection: 'ltr',
    textAlign: 'left',
  },
  countBadges: {
    flexDirection: 'row',
    gap: 4,
    flexShrink: 0,
  },
  errorPreview: {
    fontFamily: MONO_FONT,
    fontSize: 12,
    color: statusColors.rejectedText,
    writingDirection: 'ltr',
    textAlign: 'left',
  },
  attemptMeta: {
    fontFamily: fontFamilies.body,
    fontSize: 11,
    color: colors.ink3,
    textAlign: 'left',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 4,
  },
  actionBtn: {
    flex: 1,
  },
  detailsBody: {
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  detailsUrl: {
    fontFamily: MONO_FONT,
    fontSize: 12,
    color: colors.ink,
    writingDirection: 'ltr',
    textAlign: 'left',
  },
  detailsMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  jsonBox: {
    backgroundColor: colors.surface2,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    maxHeight: 280,
  },
  jsonBoxContent: {
    padding: spacing.md,
  },
  jsonText: {
    fontFamily: MONO_FONT,
    fontSize: 12,
    color: colors.ink,
    writingDirection: 'ltr',
    textAlign: 'left',
  },
  detailsActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  detailsActionBtn: {
    flex: 1,
  },
});
