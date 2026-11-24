import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radii, shadows, spacing, statusColors, typeScale } from '@/theme';
import {
  Badge,
  Button,
  Card,
  Chip,
  ConfirmDialog,
  ModalSheet,
  PressableScale,
  useToast,
} from '@/components/ui';
import {
  API_TOKEN_DEFAULT_MAX_PER_USER,
  API_TOKEN_MAX_NAME_LENGTH,
  API_TOKEN_SCOPES,
  ApiTokenService,
  type ApiTokenRecord,
  type ApiTokenScope,
} from '@/services/admin/api-token-service';
import { captureError } from '@/services/logger';
import { UserService, type UserProfileDoc } from '@/services/users/user-service';

type ManageableRole = 'user' | 'approved' | 'manager';

const ROLE_OPTIONS: ReadonlyArray<{ value: ManageableRole; label: string; desc: string }> = [
  { value: 'user', label: 'משתמש', desc: 'צפייה והצעת מתכונים בלבד' },
  { value: 'approved', label: 'מאושר', desc: 'בן משפחה · ספרייה פרטית, ייבוא AI וגישת API' },
  { value: 'manager', label: 'מנהל', desc: 'ניהול מלא של הספר, המשתמשים והטוקנים' },
];

const ROLE_LABELS: Record<ManageableRole, string> = {
  user: 'משתמש',
  approved: 'מאושר',
  manager: 'מנהל',
};

const SCOPE_LABELS: Record<ApiTokenScope, string> = {
  [API_TOKEN_SCOPES.READ]: 'קריאה',
  [API_TOKEN_SCOPES.READ_WRITE]: 'קריאה וכתיבה',
};

function isEligibleForTokens(role?: string | null): boolean {
  return role === 'approved' || role === 'manager';
}

function formatDay(ms: number | null): string {
  if (!ms) return '—';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}

function formatDayTime(ms: number | null): string {
  if (!ms) return 'לא נעשה שימוש';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return 'לא נעשה שימוש';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `שימוש אחרון: ${dd}.${mm} ${hh}:${mi}`;
}

export interface UsersAndTokensSectionProps {
  users: UserProfileDoc[];
  tokens: ApiTokenRecord[];
  maxTokensPerUser: number;
  tokensLoadError: boolean;
  loadingUsers: boolean;
  refreshingUsers: boolean;
  refreshingTokens: boolean;
  currentManagerUid: string;
  onRefreshUsers: () => void | Promise<void>;
  onRefreshTokens: () => void | Promise<void>;
  onUserRoleUpdated: (uid: string, role: ManageableRole) => void;
  onTokensChanged: (nextTokens: ApiTokenRecord[]) => void;
}

export function UsersAndTokensSection({
  users,
  tokens,
  maxTokensPerUser,
  tokensLoadError,
  loadingUsers,
  refreshingUsers,
  refreshingTokens,
  currentManagerUid,
  onRefreshUsers,
  onRefreshTokens,
  onUserRoleUpdated,
  onTokensChanged,
}: UsersAndTokensSectionProps) {
  const { showToast } = useToast();

  // Accordion states
  const [usersExpanded, setUsersExpanded] = useState(true);
  const [tokensExpanded, setTokensExpanded] = useState(true);

  // User role management state
  const [draftRoles, setDraftRoles] = useState<Record<string, ManageableRole>>({});
  const [rolePickerUser, setRolePickerUser] = useState<UserProfileDoc | null>(null);
  const [savingUid, setSavingUid] = useState<string | null>(null);
  const [selfDemoteConfirm, setSelfDemoteConfirm] = useState<{
    uid: string;
    role: ManageableRole;
  } | null>(null);

  // API token creation state
  const [selectedOwnerUid, setSelectedOwnerUid] = useState<string>(currentManagerUid);
  const [createFormOpen, setCreateFormOpen] = useState(false);
  const [tokenName, setTokenName] = useState('');
  const [tokenScope, setTokenScope] = useState<ApiTokenScope>(API_TOKEN_SCOPES.READ_WRITE);
  const [creatingToken, setCreatingToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  // One-time plaintext secret modal (INV-P0-08: NEVER persisted or logged; cleared on close)
  const [secretModal, setSecretModal] = useState<{ secret: string; name: string } | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);
  const [closeWarned, setCloseWarned] = useState(false);

  // Revoke confirmation dialog state
  const [revokeTarget, setRevokeTarget] = useState<ApiTokenRecord | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const effectiveMaxPerUser =
    maxTokensPerUser > 0 ? maxTokensPerUser : API_TOKEN_DEFAULT_MAX_PER_USER;

  const usersById = useMemo(() => {
    const map: Record<string, UserProfileDoc> = {};
    for (const u of users) {
      map[u.id] = u;
    }
    return map;
  }, [users]);

  const eligibleUsers = useMemo(() => users.filter((u) => isEligibleForTokens(u.role)), [users]);

  // Keep draft roles synced when users list refreshes
  useEffect(() => {
    setDraftRoles((prev) => {
      const next: Record<string, ManageableRole> = {};
      for (const u of users) {
        const persisted = (u.role || 'user') as ManageableRole;
        next[u.id] = prev[u.id] ?? persisted;
      }
      return next;
    });
  }, [users]);

  // Keep selectedOwnerUid pointing to a valid eligible user (defaulting to current manager)
  useEffect(() => {
    if (eligibleUsers.length === 0) return;
    const stillEligible = eligibleUsers.some((u) => u.id === selectedOwnerUid);
    if (!stillEligible) {
      const managerMatch = eligibleUsers.find((u) => u.id === currentManagerUid);
      setSelectedOwnerUid(managerMatch ? managerMatch.id : eligibleUsers[0].id);
    }
  }, [eligibleUsers, selectedOwnerUid, currentManagerUid]);

  const labelOf = useCallback(
    (uid: string): string => {
      const u = usersById[uid];
      return u?.fullName || u?.email || uid;
    },
    [usersById],
  );

  const tokenCountByUid = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of tokens) {
      map[t.uid] = (map[t.uid] || 0) + 1;
    }
    return map;
  }, [tokens]);

  const sortedTokens = useMemo(
    () => [...tokens].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)),
    [tokens],
  );

  const executeRoleUpdate = useCallback(
    async (uid: string, nextRole: ManageableRole) => {
      setSavingUid(uid);
      try {
        await UserService.updateRole(uid, nextRole);
        onUserRoleUpdated(uid, nextRole);
        setDraftRoles((prev) => ({ ...prev, [uid]: nextRole }));
        showToast('תפקיד המשתמש עודכן בהצלחה', 'success');
      } catch (err) {
        captureError(err, { service: 'dashboard', op: 'updateUserRole', targetUid: uid });
        showToast('עדכון התפקיד נכשל. נסו שוב.', 'error');
      } finally {
        setSavingUid(null);
      }
    },
    [onUserRoleUpdated, showToast],
  );

  const handleSaveRolePress = useCallback(
    (u: UserProfileDoc) => {
      const nextRole = draftRoles[u.id] || (u.role as ManageableRole) || 'user';
      if (u.id === currentManagerUid && nextRole !== 'manager') {
        setSelfDemoteConfirm({ uid: u.id, role: nextRole });
        return;
      }
      void executeRoleUpdate(u.id, nextRole);
    },
    [draftRoles, currentManagerUid, executeRoleUpdate],
  );

  const selectedOwnerTokenCount = tokenCountByUid[selectedOwnerUid] || 0;
  const atPerUserLimit = selectedOwnerTokenCount >= effectiveMaxPerUser;

  const handleCreateToken = useCallback(async () => {
    if (creatingToken) return;
    const trimmedName = tokenName.trim();
    if (!trimmedName) {
      setTokenError('יש להזין שם לטוקן.');
      return;
    }
    if (trimmedName.length > API_TOKEN_MAX_NAME_LENGTH) {
      setTokenError(`שם הטוקן יכול להכיל עד ${API_TOKEN_MAX_NAME_LENGTH} תווים.`);
      return;
    }
    if (!selectedOwnerUid) {
      setTokenError('יש לבחור משתמש מאושר.');
      return;
    }

    setCreatingToken(true);
    setTokenError(null);
    try {
      // Strictly send 'read' or 'read+write' (NEVER 'write')
      const safeScope: ApiTokenScope =
        tokenScope === API_TOKEN_SCOPES.READ ? API_TOKEN_SCOPES.READ : API_TOKEN_SCOPES.READ_WRITE;

      const created = await ApiTokenService.createToken({
        uid: selectedOwnerUid,
        name: trimmedName,
        scope: safeScope,
      });

      const { token: rawSecret, ...publicToken } = created;
      onTokensChanged([...tokens, publicToken]);

      setCreateFormOpen(false);
      setTokenName('');
      setTokenScope(API_TOKEN_SCOPES.READ_WRITE);
      setSecretCopied(false);
      setCloseWarned(false);
      setSecretModal({ secret: rawSecret, name: publicToken.name });
    } catch (err) {
      setTokenError(ApiTokenService.mapApiTokenErrorToHebrew(err, 'יצירת הטוקן נכשלה. נסו שוב.'));
    } finally {
      setCreatingToken(false);
    }
  }, [creatingToken, tokenName, selectedOwnerUid, tokenScope, tokens, onTokensChanged]);

  const handleCopySecret = useCallback(async () => {
    if (!secretModal?.secret) return;
    try {
      await Clipboard.setStringAsync(secretModal.secret);
      setSecretCopied(true);
      setCloseWarned(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch {
      showToast('לא הצלחנו להעתיק אוטומטית — סמנו והעתיקו ידנית', 'info');
    }
  }, [secretModal, showToast]);

  const handleCloseSecretModal = useCallback(() => {
    // Close guard (exact parity with token-dialogs.js): warn once if not copied yet
    if (!secretCopied && !closeWarned) {
      setCloseWarned(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      return;
    }
    // Clear plaintext secret from React state immediately
    setSecretModal(null);
    setSecretCopied(false);
    setCloseWarned(false);
  }, [secretCopied, closeWarned]);

  const handleConfirmRevoke = useCallback(async () => {
    if (!revokeTarget || revokingId) return;
    const targetId = revokeTarget.tokenId;
    setRevokingId(targetId);
    setTokenError(null);
    try {
      await ApiTokenService.revokeToken(targetId);
      onTokensChanged(tokens.filter((t) => t.tokenId !== targetId));
      setRevokeTarget(null);
      showToast('הטוקן בוטל בהצלחה', 'success');
    } catch (err) {
      setTokenError(ApiTokenService.mapApiTokenErrorToHebrew(err, 'ביטול הטוקן נכשל. נסו שוב.'));
      setRevokeTarget(null);
    } finally {
      setRevokingId(null);
    }
  }, [revokeTarget, revokingId, tokens, onTokensChanged, showToast]);

  return (
    <View style={styles.wrapper}>
      {/* 1. User Role Management Section */}
      <View testID="dashboard-section-users" collapsable={false}>
        <Card style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <PressableScale
              testID="dashboard-section-users-toggle"
              variant="button"
              onPress={() => setUsersExpanded((prev) => !prev)}
              accessibilityRole="button"
              accessibilityState={{ expanded: usersExpanded }}
              style={styles.sectionToggle}
            >
              <View style={styles.sectionTitleGroup}>
                <Ionicons name="people-outline" size={20} color={colors.primaryDark} />
                <Text style={styles.sectionTitle}>ניהול משתמשים</Text>
                <Badge label={String(users.length)} tone="neutral" />
              </View>
              <Ionicons
                name={usersExpanded ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={colors.ink3}
              />
            </PressableScale>

            <PressableScale
              testID="dashboard-section-users-refresh"
              variant="icon"
              disabled={refreshingUsers}
              onPress={() => {
                void onRefreshUsers();
              }}
              accessibilityLabel="רענן רשימת משתמשים"
              style={styles.refreshBtn}
            >
              {refreshingUsers ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons name="refresh" size={18} color={colors.ink2} />
              )}
            </PressableScale>
          </View>

          {usersExpanded ? (
            <View style={styles.sectionBody}>
              {loadingUsers && users.length === 0 ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.emptyText}>טוען משתמשים...</Text>
                </View>
              ) : users.length === 0 ? (
                <Text style={styles.emptyText}>אין משתמשים רשומים</Text>
              ) : (
                <View style={styles.list}>
                  {users.map((u) => {
                    const persistedRole = (u.role || 'user') as ManageableRole;
                    const draftRole = draftRoles[u.id] || persistedRole;
                    const isSaving = savingUid === u.id;
                    const isSelf = u.id === currentManagerUid;
                    const userTokenCount = tokenCountByUid[u.id] || 0;

                    return (
                      <View
                        key={u.id}
                        testID={`user-row-${u.id}`}
                        collapsable={false}
                        style={styles.userRow}
                      >
                        <View style={styles.userTopRow}>
                          <View style={styles.userInfo}>
                            <View style={styles.userNameRow}>
                              <Text style={styles.userName} numberOfLines={1}>
                                {u.fullName || u.email || u.id}
                              </Text>
                              {isSelf ? <Badge label="את/ה" tone="success" /> : null}
                            </View>
                            {u.email && u.fullName ? (
                              <Text style={styles.userEmail} numberOfLines={1}>
                                {u.email}
                              </Text>
                            ) : null}
                          </View>
                          {userTokenCount > 0 ? (
                            <Badge
                              label={`${userTokenCount}/${effectiveMaxPerUser} טוקנים`}
                              tone="neutral"
                            />
                          ) : null}
                        </View>

                        <View style={styles.roleControlsRow}>
                          <Text style={styles.roleLabel}>תפקיד:</Text>
                          <PressableScale
                            testID={`user-role-select-${u.id}`}
                            variant="button"
                            disabled={isSaving}
                            onPress={() => setRolePickerUser(u)}
                            accessibilityRole="button"
                            accessibilityLabel={`בחירת תפקיד עבור ${u.fullName || u.email || u.id}`}
                            style={styles.roleSelectTrigger}
                          >
                            <Text style={styles.roleSelectText} allowFontScaling={false}>
                              {ROLE_LABELS[draftRole] || draftRole}
                            </Text>
                            <Ionicons name="chevron-down" size={16} color={colors.ink3} />
                          </PressableScale>

                          <Button
                            testID={`user-role-save-${u.id}`}
                            label="שמור"
                            variant="primary"
                            size="sm"
                            loading={isSaving}
                            disabled={Boolean(savingUid && !isSaving)}
                            onPress={() => handleSaveRolePress(u)}
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
      </View>

      {/* 2. Recipe API Tokens Section */}
      <View testID="dashboard-section-api-tokens" collapsable={false}>
        <Card style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <PressableScale
              testID="dashboard-section-api-tokens-toggle"
              variant="button"
              onPress={() => setTokensExpanded((prev) => !prev)}
              accessibilityRole="button"
              accessibilityState={{ expanded: tokensExpanded }}
              style={styles.sectionToggle}
            >
              <View style={styles.sectionTitleGroup}>
                <Ionicons name="key-outline" size={20} color={colors.primaryDark} />
                <Text style={styles.sectionTitle}>גישת API</Text>
                <Badge label={String(tokens.length)} tone="neutral" />
              </View>
              <Ionicons
                name={tokensExpanded ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={colors.ink3}
              />
            </PressableScale>

            <PressableScale
              testID="dashboard-section-api-tokens-refresh"
              variant="icon"
              disabled={refreshingTokens}
              onPress={() => {
                void onRefreshTokens();
              }}
              accessibilityLabel="רענן טוקנים"
              style={styles.refreshBtn}
            >
              {refreshingTokens ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons name="refresh" size={18} color={colors.ink2} />
              )}
            </PressableScale>
          </View>

          {tokensExpanded ? (
            <View style={styles.sectionBody}>
              {tokensLoadError ? (
                <View style={styles.loadErrorRow}>
                  <Text style={styles.emptyText}>לא ניתן לטעון את הטוקנים.</Text>
                  <Button
                    label="נסו שוב"
                    variant="secondary"
                    size="sm"
                    loading={refreshingTokens}
                    onPress={() => {
                      void onRefreshTokens();
                    }}
                  />
                </View>
              ) : (
                <>
                  {/* Existing tokens list */}
                  {sortedTokens.length === 0 ? (
                    <Text style={styles.emptyText}>אין טוקנים פעילים.</Text>
                  ) : (
                    <View style={styles.list}>
                      {sortedTokens.map((token) => {
                        const owner = usersById[token.uid];
                        const ownerEligible = owner ? isEligibleForTokens(owner.role) : true;
                        const isRevoking = revokingId === token.tokenId;

                        return (
                          <View
                            key={token.tokenId}
                            testID={`api-token-item-${token.tokenId}`}
                            collapsable={false}
                            style={styles.tokenRow}
                          >
                            <View style={styles.tokenTopRow}>
                              <View style={styles.tokenInfo}>
                                <Text style={styles.tokenName} numberOfLines={2}>
                                  {token.name}
                                </Text>
                                <Text style={styles.tokenMeta}>בעלים: {labelOf(token.uid)}</Text>
                                <Text style={styles.tokenMeta}>
                                  {`\u2066${token.prefix}…\u2069 · נוצר ${formatDay(token.createdAt)} ע״י ${labelOf(token.createdBy)} · ${formatDayTime(token.lastUsedAt)}`}
                                </Text>
                              </View>

                              <Button
                                testID={`api-token-revoke-${token.tokenId}`}
                                label="בטל"
                                variant="danger"
                                size="sm"
                                loading={isRevoking}
                                disabled={Boolean(revokingId && !isRevoking)}
                                onPress={() => setRevokeTarget(token)}
                              />
                            </View>

                            <View style={styles.tokenBadges}>
                              <Badge
                                label={SCOPE_LABELS[token.scope] || token.scope}
                                tone="neutral"
                              />
                              {!ownerEligible ? (
                                <Badge label="לא פעיל (תפקיד)" tone="danger" />
                              ) : null}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}

                  {/* Owner selector & token creation */}
                  {eligibleUsers.length > 0 ? (
                    <View style={styles.tokenCreateBox}>
                      <Text style={styles.subSectionLabel}>הנפקת טוקן אישי למשתמש מאושר:</Text>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.ownerChipStrip}
                      >
                        {eligibleUsers.map((u) => {
                          const count = tokenCountByUid[u.id] || 0;
                          const label = `${u.fullName || u.email || u.id} (${count}/${effectiveMaxPerUser})`;
                          return (
                            <Chip
                              key={u.id}
                              label={label}
                              selected={selectedOwnerUid === u.id}
                              onPress={() => {
                                setSelectedOwnerUid(u.id);
                                setTokenError(null);
                              }}
                            />
                          );
                        })}
                      </ScrollView>

                      {atPerUserLimit ? (
                        <Text style={styles.limitNote}>
                          לכל משתמש עד {effectiveMaxPerUser} טוקנים.
                        </Text>
                      ) : !createFormOpen ? (
                        <Button
                          testID="api-token-create-btn"
                          label="+ טוקן חדש"
                          variant="outline"
                          size="sm"
                          onPress={() => {
                            setCreateFormOpen(true);
                            setTokenScope(API_TOKEN_SCOPES.READ_WRITE);
                            setTokenError(null);
                          }}
                          style={styles.openCreateBtn}
                        />
                      ) : (
                        <View style={styles.createForm}>
                          <View style={styles.inputHeaderRow}>
                            <Text style={styles.fieldLabel}>שם הטוקן</Text>
                            <Text style={styles.charCount}>
                              {tokenName.length}/{API_TOKEN_MAX_NAME_LENGTH}
                            </Text>
                          </View>
                          <TextInput
                            testID="api-token-name-input"
                            value={tokenName}
                            onChangeText={(text) => {
                              setTokenName(text.slice(0, API_TOKEN_MAX_NAME_LENGTH));
                              if (tokenError) setTokenError(null);
                            }}
                            maxLength={API_TOKEN_MAX_NAME_LENGTH}
                            placeholder="שם הטוקן (למשל Jarvis)"
                            placeholderTextColor={colors.ink4}
                            editable={!creatingToken}
                            style={styles.textInput}
                          />

                          <Text style={styles.fieldLabel}>הרשאות</Text>
                          <View style={styles.scopeRow}>
                            <Chip
                              testID="api-token-scope-read"
                              label="קריאה"
                              selected={tokenScope === API_TOKEN_SCOPES.READ}
                              onPress={() => setTokenScope(API_TOKEN_SCOPES.READ)}
                              style={styles.scopeChip}
                            />
                            <Chip
                              testID="api-token-scope-read-write"
                              label="קריאה וכתיבה"
                              selected={tokenScope === API_TOKEN_SCOPES.READ_WRITE}
                              onPress={() => setTokenScope(API_TOKEN_SCOPES.READ_WRITE)}
                              style={styles.scopeChip}
                            />
                          </View>

                          <View style={styles.createActions}>
                            <Button
                              label="ביטול"
                              variant="secondary"
                              size="sm"
                              disabled={creatingToken}
                              onPress={() => {
                                setCreateFormOpen(false);
                                setTokenName('');
                                setTokenScope(API_TOKEN_SCOPES.READ_WRITE);
                                setTokenError(null);
                              }}
                              style={styles.createActionBtn}
                            />
                            <Button
                              testID="api-token-submit-btn"
                              label="צור"
                              variant="primary"
                              size="sm"
                              loading={creatingToken}
                              onPress={() => {
                                void handleCreateToken();
                              }}
                              style={styles.createActionBtn}
                            />
                          </View>
                        </View>
                      )}
                    </View>
                  ) : (
                    <Text style={styles.emptyText}>זמין רק למשתמשים מאושרים.</Text>
                  )}

                  {tokenError ? <Text style={styles.errorText}>{tokenError}</Text> : null}
                </>
              )}
            </View>
          ) : null}
        </Card>
      </View>

      {/* Role Picker Sheet (Single mounted instance -> unambiguous user-role-option-<role>) */}
      <ModalSheet
        visible={Boolean(rolePickerUser)}
        title={
          rolePickerUser
            ? `בחירת תפקיד — ${rolePickerUser.fullName || rolePickerUser.email || rolePickerUser.id}`
            : 'בחירת תפקיד'
        }
        onClose={() => setRolePickerUser(null)}
      >
        <View style={styles.rolePickerList}>
          {ROLE_OPTIONS.map((option) => {
            const currentSelected = rolePickerUser
              ? (draftRoles[rolePickerUser.id] || rolePickerUser.role || 'user') === option.value
              : false;
            return (
              <PressableScale
                key={option.value}
                testID={`user-role-option-${option.value}`}
                variant="card"
                onPress={() => {
                  if (!rolePickerUser) return;
                  setDraftRoles((prev) => ({ ...prev, [rolePickerUser.id]: option.value }));
                  setRolePickerUser(null);
                }}
                style={[styles.roleOptionCard, currentSelected && styles.roleOptionCardSelected]}
              >
                <View style={styles.roleOptionText}>
                  <Text
                    style={[
                      styles.roleOptionLabel,
                      currentSelected && styles.roleOptionLabelSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                  <Text style={styles.roleOptionDesc}>{option.desc}</Text>
                </View>
                {currentSelected ? (
                  <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                ) : (
                  <Ionicons name="ellipse-outline" size={22} color={colors.ink4} />
                )}
              </PressableScale>
            );
          })}
        </View>
      </ModalSheet>

      {/* Self-Demotion Confirmation Guard */}
      <ConfirmDialog
        visible={Boolean(selfDemoteConfirm)}
        title="הסרת הרשאות מנהל"
        message="שינוי התפקיד שלך יסיר מיד את הגישה שלך לממשק הניהול. האם להמשיך?"
        confirmLabel="שנה תפקיד"
        cancelLabel="ביטול"
        destructive
        loading={Boolean(savingUid)}
        onConfirm={() => {
          if (!selfDemoteConfirm) return;
          const target = selfDemoteConfirm;
          setSelfDemoteConfirm(null);
          void executeRoleUpdate(target.uid, target.role);
        }}
        onCancel={() => setSelfDemoteConfirm(null)}
      />

      {/* Revoke API Token Confirmation */}
      <ConfirmDialog
        visible={Boolean(revokeTarget)}
        title="ביטול טוקן"
        message={
          revokeTarget
            ? `לבטל את הטוקן "${revokeTarget.name}"? כלים שמשתמשים בו יפסיקו לעבוד מיד. הפעולה אינה הפיכה.`
            : ''
        }
        confirmLabel="בטל טוקן"
        cancelLabel="חזרה"
        destructive
        loading={Boolean(revokingId)}
        confirmTestID="api-token-revoke-confirm-btn"
        onConfirm={() => {
          void handleConfirmRevoke();
        }}
        onCancel={() => {
          if (!revokingId) setRevokeTarget(null);
        }}
      />

      {/* One-Time API Token Secret Modal with Close Guard (INV-P0-08) */}
      <Modal
        visible={Boolean(secretModal)}
        transparent
        animationType="fade"
        onRequestClose={handleCloseSecretModal}
      >
        <View style={styles.secretOverlay}>
          <View testID="api-token-secret-modal" collapsable={false} style={styles.secretDialog}>
            <View style={styles.secretHeader}>
              <Ionicons name="key" size={22} color={colors.primaryDark} />
              <Text style={styles.secretTitle}>
                {secretModal ? `הטוקן ״${secretModal.name}״ נוצר` : 'טוקן חדש'}
              </Text>
            </View>

            <Text style={styles.secretWarning}>
              הטוקן יוצג פעם אחת בלבד — העתיקו אותו עכשיו ושמרו אותו במקום בטוח. מי שמחזיק בו יכול
              לקרוא ולהוסיף מתכונים בשם המשתמש.
            </Text>

            <View style={styles.secretValueBox}>
              <Text testID="api-token-secret-value" selectable style={styles.secretValueText}>
                {secretModal?.secret || ''}
              </Text>
            </View>

            {closeWarned && !secretCopied ? (
              <View style={styles.closeGuardBox}>
                <Ionicons name="alert-circle" size={18} color={colors.secondary} />
                <Text style={styles.closeGuardText}>
                  עוד לא העתקתם את הטוקן — אחרי הסגירה אי אפשר לראות אותו שוב. לחצו שוב כדי לסגור
                  בכל זאת.
                </Text>
              </View>
            ) : null}

            <View style={styles.secretActions}>
              <Button
                testID="api-token-copy-btn"
                label={secretCopied ? 'הועתק ✓' : 'העתק'}
                variant="primary"
                onPress={() => {
                  void handleCopySecret();
                }}
                style={styles.secretBtn}
              />
              <Button
                testID="api-token-close-btn"
                label="סיימתי"
                variant="secondary"
                onPress={handleCloseSecretModal}
                style={styles.secretBtn}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.md,
  },
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
    gap: spacing.md,
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
  loadErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  list: {
    gap: spacing.sm,
  },
  userRow: {
    backgroundColor: colors.surface0,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: spacing.md,
    gap: spacing.sm,
  },
  userTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  userInfo: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  userName: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: typeScale.step0,
    color: colors.ink,
    textAlign: 'left',
    flexShrink: 1,
  },
  userEmail: {
    fontFamily: fontFamilies.body,
    fontSize: 12,
    color: colors.ink3,
    textAlign: 'left',
  },
  roleControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  roleLabel: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: 12,
    color: colors.ink3,
  },
  roleSelectTrigger: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface1,
    borderWidth: 1.5,
    borderColor: colors.hairlineStrong,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    minHeight: 38,
    gap: spacing.xs,
  },
  roleSelectText: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: typeScale.stepMinus1,
    color: colors.ink,
    includeFontPadding: false,
  },
  tokenRow: {
    backgroundColor: colors.surface0,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: spacing.md,
    gap: spacing.xs,
  },
  tokenTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  tokenInfo: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  tokenName: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: typeScale.step0,
    color: colors.ink,
    textAlign: 'left',
  },
  tokenMeta: {
    fontFamily: fontFamilies.body,
    fontSize: 12,
    color: colors.ink3,
    textAlign: 'left',
    lineHeight: 17,
  },
  tokenBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: 2,
  },
  tokenCreateBox: {
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  subSectionLabel: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: 12,
    color: colors.ink2,
    textAlign: 'left',
  },
  ownerChipStrip: {
    gap: spacing.xs,
    paddingVertical: 2,
  },
  limitNote: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: typeScale.stepMinus1,
    color: colors.ink3,
    textAlign: 'left',
  },
  openCreateBtn: {
    alignSelf: 'flex-start',
  },
  createForm: {
    backgroundColor: colors.surface0,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    padding: spacing.md,
    gap: spacing.sm,
  },
  inputHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fieldLabel: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: 12,
    color: colors.ink2,
    textAlign: 'left',
  },
  charCount: {
    fontFamily: fontFamilies.body,
    fontSize: 11,
    color: colors.ink3,
  },
  textInput: {
    backgroundColor: colors.surface1,
    borderWidth: 1.5,
    borderColor: colors.hairlineStrong,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    fontFamily: fontFamilies.body,
    fontSize: typeScale.stepMinus1,
    color: colors.ink,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  scopeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  scopeChip: {
    flex: 1,
  },
  createActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: 4,
  },
  createActionBtn: {
    flex: 1,
  },
  errorText: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: typeScale.stepMinus1,
    color: colors.secondary,
    textAlign: 'left',
  },
  rolePickerList: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  roleOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    padding: spacing.md,
  },
  roleOptionCardSelected: {
    borderColor: colors.primary,
    backgroundColor: statusColors.approvedBg,
  },
  roleOptionText: {
    flex: 1,
    gap: 2,
  },
  roleOptionLabel: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: typeScale.step0,
    color: colors.ink,
    textAlign: 'left',
  },
  roleOptionLabelSelected: {
    color: colors.primaryDark,
  },
  roleOptionDesc: {
    fontFamily: fontFamilies.body,
    fontSize: 12,
    color: colors.ink3,
    textAlign: 'left',
  },
  secretOverlay: {
    flex: 1,
    backgroundColor: statusColors.overlayBackdrop,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  secretDialog: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: spacing.xl,
    gap: spacing.md,
    ...shadows.level3,
  },
  secretHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  secretTitle: {
    flex: 1,
    fontFamily: fontFamilies.heading,
    fontSize: typeScale.step2,
    color: colors.ink,
    textAlign: 'left',
  },
  secretWarning: {
    fontFamily: fontFamilies.body,
    fontSize: typeScale.stepMinus1,
    color: colors.ink2,
    lineHeight: 20,
    textAlign: 'left',
  },
  secretValueBox: {
    backgroundColor: colors.surface2,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    padding: spacing.md,
  },
  secretValueText: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 13,
    color: colors.ink,
    writingDirection: 'ltr',
    textAlign: 'left',
  },
  closeGuardBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: statusColors.rejectedBg,
    borderRadius: radii.sm,
    padding: spacing.sm,
  },
  closeGuardText: {
    flex: 1,
    fontFamily: fontFamilies.bodyMedium,
    fontSize: 12,
    color: statusColors.rejectedText,
    lineHeight: 18,
    textAlign: 'left',
  },
  secretActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  secretBtn: {
    flex: 1,
  },
});
