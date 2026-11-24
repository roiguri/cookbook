import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontFamilies, radii, shadows, spacing, statusColors, typeScale } from '@/theme';
import { Button } from '@/components/ui';

export interface AvatarUnsavedDialogProps {
  visible: boolean;
  onDiscard: () => void;
  onKeepEditing: () => void;
}

/**
 * Unsaved-changes guard dialog for the Chef Avatar Builder.
 * Dismissing via backdrop tap, hardware back, or "המשך לערוך" keeps editing.
 */
export function AvatarUnsavedDialog({
  visible,
  onDiscard,
  onKeepEditing,
}: AvatarUnsavedDialogProps) {
  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onKeepEditing}>
      <View style={styles.overlay}>
        <Pressable
          style={styles.backdrop}
          onPress={onKeepEditing}
          accessibilityRole="button"
          accessibilityLabel="המשך לערוך"
        />
        <View testID="avatar-unsaved-dialog" style={styles.dialog}>
          <Text style={styles.title}>לסגור בלי לשמור?</Text>
          <Text style={styles.message}>השינויים באווטאר לא נשמרו ויאבדו.</Text>
          <View style={styles.actions}>
            <Button
              label="המשך לערוך"
              variant="secondary"
              onPress={onKeepEditing}
              testID="avatar-keep-editing-btn"
              style={styles.actionBtn}
            />
            <Button
              label="סגור בלי לשמור"
              variant="danger"
              onPress={onDiscard}
              testID="avatar-discard-btn"
              style={styles.actionBtn}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: statusColors.overlayBackdrop,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.hairline,
    ...shadows.level3,
    gap: spacing.md,
  },
  title: {
    fontSize: typeScale.step2,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    textAlign: 'left',
    includeFontPadding: false,
  },
  message: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink2,
    lineHeight: 22,
    textAlign: 'left',
    includeFontPadding: false,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionBtn: {
    flex: 1,
  },
});
