import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Keyboard,
  RefreshControl,
  PanResponder,
  Switch,
  Linking,
  Modal,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { useRouter, useFocusEffect } from 'expo-router';
import { Colors, Fonts, Spacing, Radius } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { supabase, getProfile, ProfileRow, getProfileStats, ProfileStats, XP_PER_LEVEL, MAX_LIVES, getUnlockedAchievements } from '../../lib/supabase';
import { validateUsername } from '../../lib/validation';
import { extractErrorMessage } from '../../lib/errors';
import { useProfileSignal } from '../../stores/profileSignal';
import { useAchievementStore } from '../../stores/achievementStore';
import { ACHIEVEMENTS } from '../../lib/achievements';
import { useAudioStore } from '../../stores/audioStore'
import { writeGuestSnapshot, readGuestSnapshot } from '../../lib/guestSnapshot';

// Stable noop used as the return value of fetchProfileData when userId is absent,
// satisfying useEffect's (() => void) cleanup contract without an inline allocation.
const noop = () => {};

const GRID_COLS = 4;
const MIN_VISIBLE = 4;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StatItem = {
  label: string;
  value: string;
  heartPrefix?: boolean;
};

type AchievementSlot =
  | { kind: 'unlocked'; achievement: (typeof ACHIEVEMENTS)[number] }
  | { kind: 'locked'; id: string };

// ---------------------------------------------------------------------------
// Module-level derived constants
// ---------------------------------------------------------------------------

function computeXpPercent(xp: number, xpMax: number): `${number}%` {
  if (xpMax <= 0) return '0%';
  const pct = Math.round(Math.min(100, Math.max(0, (xp / xpMax) * 100)));
  return `${pct}%` as `${number}%`;
}

const ANIM_AVATAR       = FadeInDown.duration(400);
const ANIM_STATS        = FadeInDown.duration(400).delay(150);
const ANIM_ACHIEVEMENTS = FadeInDown.duration(400).delay(250);


const SAFE_EDGES = ['top'] as const;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ item }: { item: StatItem }) {
  return (
    <View style={styles.statCard}>
      {item.heartPrefix ? (
        <Text style={styles.statValue}>
          <Text style={styles.heartSymbol}>{'♥ '}</Text>
          {item.value}
        </Text>
      ) : (
        <Text style={styles.statValue}>{item.value}</Text>
      )}
      <Text style={styles.statLabel}>{item.label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function ProfileScreen() {
  const router = useRouter();
  const { user, isAnonymous, signOut, triggerUsernameRefresh, didLogOut } = useAuth();

  const [profile, setProfile] = useState<ProfileRow | null>(null)
  // Lazy initializer: start in loading state for real users so frame-zero
  // shows dimmed defaults rather than a flash of unloaded data.
  // NavigationGuard ensures auth state is resolved before (tabs) renders.
  const [profileLoading, setProfileLoading] = useState(() => !!user)
  const [statsLoading,   setStatsLoading]   = useState(() => !!user)
  const [stats, setStats] = useState<ProfileStats>({ quizzesPlayed: 0, correctAnswers: 0, accuracy: 0 })
  const [fetchError, setFetchError] = useState<string | null>(null)
  // Declared here (before useFocusEffect) so the !hasUser branch can call
  // setRefreshing and refreshCleanupRef without forward-referencing them.
  const [refreshing, setRefreshing] = useState(false)
  // undefined = not yet read (loading), null = confirmed absent, value = loaded data.
  const [guestSnapshot, setGuestSnapshot] = useState<{ coins: number; lives: number } | null | undefined>(undefined)

  // Stable primitives derived outside useCallback so deps are exhaustive
  // without capturing the full User object (which changes reference on every
  // token refresh even though the ID is unchanged).
  const userId  = user?.id
  const hasUser = !!user
  // True for both anonymous sessions and post-logout (no session) — any state
  // where the user isn't signed in with a real account.
  const isGuest = isAnonymous || !hasUser

  const unlockedIds          = useAchievementStore(s => s.unlockedIds)
  const setUnlocked          = useAchievementStore(s => s.setUnlocked)
  const clearAllAchievements = useAchievementStore(s => s.clearAll)
  const { unlockedCount, displayRows } = useMemo(() => {
    const unlockedList = ACHIEVEMENTS.filter(a => unlockedIds.has(a.id))
    const lockedSlotCount = unlockedList.length < MIN_VISIBLE
      ? MIN_VISIBLE - unlockedList.length
      : 0
    const slots: AchievementSlot[] = [
      ...unlockedList.map(a => ({ kind: 'unlocked' as const, achievement: a })),
      ...Array.from({ length: lockedSlotCount }, (_, i) => ({
        kind: 'locked' as const,
        id: `locked-${i}`,
      })),
    ]
    const rows = Array.from(
      { length: Math.ceil(slots.length / GRID_COLS) },
      (_, i) => slots.slice(i * GRID_COLS, i * GRID_COLS + GRID_COLS),
    )
    return { unlockedCount: unlockedList.length, displayRows: rows }
  }, [unlockedIds])
  // True on first focus until getUnlockedAchievements resolves — dims the grid
  // so the "all locked" flash matches the stats grid's loading pattern.
  const [achievementsLoading, setAchievementsLoading] = useState(() => !!user)

  // Incremented by the quiz screen after each successful DB save.
  const profileVersion = useProfileSignal((s) => s.profileVersion)

  // Tracks the highest profileVersion for which the background fetch SUCCEEDED.
  // Only advances on success — if the bg fetch fails, useFocusEffect sees a
  // stale value and shows the loading spinner so the user gets a visible retry.
  const bgFetchedVersionRef = useRef(0)

  // Holds the cancel function for any in-flight pull-to-refresh fetch so we can:
  //   a) cancel it if the user pulls again before the first settles,
  //   b) cancel it when the user signs out (!hasUser branch), and
  //   c) cancel it on unmount.
  const refreshCleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => { refreshCleanupRef.current?.() }, [])

  // silent=true  → no loading spinner; for background refreshes after quiz saves.
  // silent=false → shows loading spinner; for initial tab-focus loads.
  // onSuccess fires when getProfile resolves, allowing callers to advance bookkeeping refs.
  // Explicit return type pins the cleanup contract; callers pass it straight to useEffect.
  const fetchProfileData = useCallback((
    silent: boolean,
    onSuccess?: () => void,
    onSettled?: () => void,
  ): () => void => {
    if (!userId) return noop

    let cancelled = false

    // onSettled fires only after BOTH fetches settle, so the RefreshControl
    // spinner doesn't stop while the stats grid is still dimmed.
    let settledCount = 0
    const maybeSettle = () => { if (++settledCount === 2 && !cancelled) onSettled?.() }

    if (!silent) setProfileLoading(true)
    getProfile(userId)
      .then((data) => {
        if (!cancelled) {
          setProfile(data)
          // Clear any stale error on success — applies to both silent and non-silent
          // fetches so a successful background refresh dismisses a prior error banner.
          setFetchError(null)
          onSuccess?.()
        }
      })
      .catch((err) => {
        console.error('Failed to fetch profile:', err)
        // Only surface errors for non-silent (user-visible) fetches. Background
        // refreshes failing silently is acceptable; missing the spinner is not.
        if (!cancelled && !silent) setFetchError('Could not load profile. Pull down to retry.')
      })
      .finally(() => {
        if (!silent && !cancelled) setProfileLoading(false)
        maybeSettle()
      })

    if (!silent) setStatsLoading(true)
    getProfileStats(userId)
      .then((data) => { if (!cancelled) setStats(data) })
      // getProfileStats never throws — returns zeros on all Supabase errors.
      .catch((err) => { if (!cancelled) console.error('Failed to fetch stats:', err) })
      .finally(() => {
        if (!silent && !cancelled) setStatsLoading(false)
        maybeSettle()
      })

    return () => {
      cancelled = true
      // Reset any loading flags we set synchronously. Without this, a cancelled
      // non-silent fetch leaves profileLoading/statsLoading=true, and a subsequent
      // silent fetch (which never touches loading state) leaves them permanently dimmed.
      if (!silent) {
        setProfileLoading(false)
        setStatsLoading(false)
      }
    }
  // userId is a stable primitive; useState setters are always stable.
  }, [userId])

  // Fires when quiz saves resolve, even while the profile tab is in the background.
  // bgFetchedVersionRef advances only on success so a failed read doesn't silence
  // the loading spinner that useFocusEffect would otherwise show on next tab focus.
  useEffect(() => {
    // profileVersion === 0 means no quiz completed yet — useFocusEffect owns the
    // initial load, so skip here to avoid a duplicate request on mount.
    if (!hasUser || profileVersion === 0) return
    const v = profileVersion
    return fetchProfileData(true, () => { bgFetchedVersionRef.current = v })
  }, [hasUser, profileVersion, fetchProfileData])

  useFocusEffect(
    useCallback(() => {
      if (!hasUser) {
        // Cancel the refresh fetch first so its .then() can't write stale data
        // back over the state we're about to clear.
        refreshCleanupRef.current?.()
        setProfile(null)
        setStats({ quizzesPlayed: 0, correctAnswers: 0, accuracy: 0 })
        setFetchError(null)
        setProfileLoading(false)  // cleanup blocks finally when signing out mid-fetch
        setStatsLoading(false)
        setRefreshing(false)
        setAchievementsLoading(false)
        // Clear all achievement state (unlocked set AND toast queue) so a newly
        // signed-in user doesn't see the previous user's achievements or toasts.
        clearAllAchievements()
        // Load snapshot values so guest profile shows pre-logout coin + life counts.
        // Reset to undefined first so the stats grid dims while the read is in flight.
        // Always call setGuestSnapshot (even when s is null) so the loading gate clears.
        setGuestSnapshot(undefined)
        let snapshotCancelled = false
        readGuestSnapshot().then(s => { if (!snapshotCancelled) setGuestSnapshot(s) })
        return () => { snapshotCancelled = true }
      }

      // Clear any stale snapshot values carried over from a prior guest session
      // so the Lives stat doesn't briefly flash old data on the next logout.
      setGuestSnapshot(null)

      // Suppress the spinner only when the background fetch for this version
      // succeeded. A failed background fetch leaves bgFetchedVersionRef behind,
      // so useFocusEffect falls through to the non-silent path and shows the spinner.
      // Still runs a fetch in both paths to catch non-quiz writes (shop purchases, etc).
      // Note: profileVersion in deps is required by exhaustive-deps but functionally
      // irrelevant — useFocusEffect's internal effectRef always holds the latest closure.
      const silent = bgFetchedVersionRef.current >= profileVersion && profileVersion > 0
      const cancelFetch = fetchProfileData(silent)

      // Fetch achievement unlock state from DB on every focus. The store may
      // already have optimistic updates from enqueueToasts — setUnlocked is a
      // no-op when the incoming set matches what's already there.
      let achievementCancelled = false
      if (userId) {
        setAchievementsLoading(true)
        getUnlockedAchievements(userId)
          .then(ids => {
            if (!achievementCancelled) {
              setUnlocked(ids)
              setAchievementsLoading(false)
            }
          })
          .catch(err => {
            if (!achievementCancelled) setAchievementsLoading(false)
            console.error('[Profile] achievements fetch failed:', err)
          })
      }

      return () => {
        cancelFetch()
        achievementCancelled = true
        setEditingUsername(false)
        setEditError(null)
        setAchievementsLoading(false)
      }

    // userId/hasUser change on login/logout and anonymous→permanent upgrades, not token refresh.
    }, [userId, hasUser, fetchProfileData, profileVersion]),
  )

  // Depend on user?.email, not user — the User object reference changes on every
  // session refresh (token rotation) even when the email is unchanged.
  // Username takes priority for all users. Anonymous users without a username
  // fall back to 'Guest Scholar'; signed-in users without one fall back to
  // the email prefix. isAnonymous must come AFTER the username check — putting
  // it first caused anonymous users' chosen usernames to be ignored entirely.
  const displayName = useMemo(() => {
    if (profile?.username) return profile.username
    if (isGuest) return 'Guest Scholar'
    return user?.email?.split('@')[0] ?? 'Historian'
  }, [isGuest, profile?.username, user?.email]);

  const initials = useMemo(
    () => displayName.trim().charAt(0).toUpperCase() || '?',
    [displayName],
  );

  const xpPercent = useMemo(
    () => computeXpPercent(profile?.xp ?? 0, XP_PER_LEVEL),
    [profile?.xp],
  );

  const statItems = useMemo<StatItem[]>(() => [
    { label: 'Total Score',     value: String(profile?.total_score ?? 0) },
    { label: 'Quizzes Played',  value: String(stats.quizzesPlayed) },
    { label: 'Correct Answers', value: String(stats.correctAnswers) },
    { label: 'Accuracy',        value: `${stats.accuracy}%` },
    { label: 'Level',           value: String(profile?.level ?? 1) },
    { label: 'Coins',           value: String(hasUser ? (profile?.coins ?? 0) : (guestSnapshot?.coins ?? 0)) },
    { label: 'Lives',           value: String(hasUser ? (profile?.lives ?? 0) : (guestSnapshot?.lives ?? MAX_LIVES)), heartPrefix: true },
  ], [profile?.total_score, profile?.level, profile?.lives, profile?.coins, stats.quizzesPlayed, stats.correctAnswers, stats.accuracy, hasUser, guestSnapshot?.lives, guestSnapshot?.coins])

  const statRows = useMemo<StatItem[][]>(() => Array.from(
    { length: Math.ceil(statItems.length / 2) },
    (_, i) => statItems.slice(i * 2, i * 2 + 2),
  ), [statItems])

  const handleRefresh = useCallback(() => {
    // fetchProfileData returns noop when userId is absent, which would leave
    // setRefreshing(true) with no matching false — guard here instead.
    if (!userId) return
    // Cancel any previous in-flight refresh before starting a new one.
    refreshCleanupRef.current?.()
    setRefreshing(true)
    refreshCleanupRef.current = fetchProfileData(false, undefined, () => {
      setRefreshing(false)
      refreshCleanupRef.current = null
    })
  }, [fetchProfileData, userId])

  const [editingUsername, setEditingUsername]   = useState(false);
  const [editText,        setEditText]          = useState('');
  const [editError,       setEditError]         = useState<string | null>(null);
  const [editLoading,     setEditLoading]       = useState(false);
  const editLoadingRef = useRef(false);
  // Mirrors editText so handleEditSave can read the latest value without
  // being recreated on every keystroke (avoids re-propping onSubmitEditing).
  const editTextRef = useRef('');
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => { isMountedRef.current = false; };
  }, []);

  const handleEditStart = useCallback(() => {
    const initial = profile?.username ?? '';
    editTextRef.current = initial;
    setEditText(initial);
    setEditError(null);
    setEditingUsername(true);
  }, [profile?.username]);

  const handleEditCancel = useCallback(() => {
    Keyboard.dismiss();
    setEditingUsername(false);
    setEditError(null);
  }, []);

  const handleEditChange = useCallback((v: string) => {
    editTextRef.current = v;
    setEditText(v);
    // Only validate live once the user has already seen an error — avoids
    // showing errors while they're still typing for the first time.
    setEditError(prev => prev !== null ? validateUsername(v.trim()) : null);
  }, []);

  const handleEditSave = useCallback(async () => {
    if (editLoadingRef.current || !userId) return;
    const trimmed = editTextRef.current.trim();
    // Skip the network call if nothing changed.
    if (trimmed === (profile?.username ?? '')) {
      Keyboard.dismiss();
      setEditingUsername(false);
      setEditError(null);
      return;
    }
    const validationError = validateUsername(trimmed);
    if (validationError) {
      setEditError(validationError);
      return;
    }
    editLoadingRef.current = true;
    setEditLoading(true);
    try {
      const { error: dbError } = await supabase
        .from('profiles')
        .upsert({ id: userId, username: trimmed }, { onConflict: 'id' });
      // triggerUsernameRefresh is a stable Zustand action — safe to call even if
      // the component unmounts before the guard below runs.
      if (!dbError) triggerUsernameRefresh();
      if (!isMountedRef.current) return;
      if (dbError) {
        if (dbError.code === '23505') {
          setEditError('Username already taken');
          return;
        }
        throw dbError;
      }
      Keyboard.dismiss();
      setProfile(prev => prev ? { ...prev, username: trimmed } : prev);
      setEditingUsername(false);
    } catch (err: unknown) {
      if (isMountedRef.current) setEditError(extractErrorMessage(err, 'Could not save username'));
    } finally {
      editLoadingRef.current = false;
      if (isMountedRef.current) setEditLoading(false);
    }
  }, [userId, profile?.username, triggerUsernameRefresh]);

  const [signingOut, setSigningOut] = useState(false);
  // Ref guards against double-fire without needing to be a useCallback dep.
  // useState(signingOut) is kept separately for UI-only updates (disabled, text).
  const signingOutRef = useRef(false);

  const [logoutModalVisible, setLogoutModalVisible] = useState(false);
  const [logoutDone, setLogoutDone] = useState(false);

  const handleLogOutPress = useCallback(() => {
    setLogoutDone(false);
    setLogoutModalVisible(true);
  }, []);

  const handleLogOutCancel = useCallback(() => {
    if (signingOutRef.current) return;
    setLogoutModalVisible(false);
  }, []);

  const handleLogOut = useCallback(async () => {
    if (signingOutRef.current) return
    signingOutRef.current = true
    setSigningOut(true)
    try {
      await writeGuestSnapshot({ lives: profile?.lives ?? MAX_LIVES, coins: profile?.coins ?? 0 })
      await signOut()
      setLogoutDone(true)
      setTimeout(() => {
        if (isMountedRef.current) setLogoutModalVisible(false)
      }, 1500)
    } catch {
      setLogoutModalVisible(false)
      Alert.alert('Error', 'Could not sign out. Please try again.')
    } finally {
      signingOutRef.current = false
      setSigningOut(false)
    }
  }, [signOut, profile])

  const handleSignIn = useCallback(() => {
    router.push('/(auth)/welcome')
  }, [router])

  // Single StyleSheet-backed reference reused across all loading-dimmed sections.
  const loadingStyle = profileLoading ? styles.loading : undefined

  const hasMounted = useRef(false);
  useEffect(() => {
    hasMounted.current = true;
  }, []);

  // ----- Settings modal -----

  const insets = useSafeAreaInsets();
  const { musicVolume, isMusicEnabled, setMusicVolume, setMusicEnabled } = useAudioStore();

  const [settingsVisible, setSettingsVisible] = useState(false);
  const settingsY = useSharedValue(800);

  const sheetAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: settingsY.value }],
  }));

  const handleOpenSettings = useCallback(() => {
    settingsY.value = 800;
    setSettingsVisible(true);
    // Start animation immediately — Reanimated runs on the UI thread and will
    // already be mid-spring by the time the Modal commit paints
    settingsY.value = withSpring(0, { damping: 18, stiffness: 150 });
  }, [settingsY]);

  const handleCloseSettings = useCallback(() => {
    settingsY.value = withTiming(800, { duration: 220 }, (finished) => {
      if (finished) runOnJS(setSettingsVisible)(false);
    });
  }, [settingsY]);

  const [sliderWidth, setSliderWidth] = useState(0);
  const sliderWidthRef = useRef(0);
  const sliderGestureStartVolRef = useRef(0);
  const musicVolumeRef = useRef(musicVolume);
  useEffect(() => { musicVolumeRef.current = musicVolume; }, [musicVolume]);

  const handleSliderLayout = useCallback((e: { nativeEvent: { layout: { width: number } } }) => {
    const w = e.nativeEvent.layout.width;
    sliderWidthRef.current = w;
    setSliderWidth(w);
  }, []);

  const volumePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          sliderGestureStartVolRef.current = musicVolumeRef.current;
        },
        onPanResponderMove: (_, gs) => {
          if (sliderWidthRef.current <= 0) return;
          const fraction = gs.dx / sliderWidthRef.current;
          setMusicVolume(Math.max(0, Math.min(1, sliderGestureStartVolRef.current + fraction)));
        },
      }),
    [setMusicVolume],
  );

  return (
    <SafeAreaView style={styles.root} edges={SAFE_EDGES}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={Colors.gold}
            colors={[Colors.gold]}
          />
        }
      >
        {/* Sign-in banner — shown to anonymous users and post-logout guests */}
        {isGuest && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              {isAnonymous
                ? 'Sign in to keep your progress across devices'
                : 'Sign back in to restore your full account'}
            </Text>
            <TouchableOpacity
              style={styles.signInButton}
              onPress={handleSignIn}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Sign in to save your progress"
            >
              <Text style={styles.signInButtonText}>Sign In</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Error banner — shown when getProfile throws a non-PGRST116 error */}
        {fetchError != null && (
          <View
            style={styles.errorBanner}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            <Text style={styles.errorBannerText}>{fetchError}</Text>
          </View>
        )}

        {/* Avatar + username */}
        <Animated.View entering={hasMounted.current ? undefined : ANIM_AVATAR} style={styles.animWrapper}>
          <View style={[styles.avatarSection, loadingStyle]}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarInitials}>{initials}</Text>
            </View>

            {editingUsername ? (
              <View style={styles.editUsernameContainer}>
                <View style={styles.editUsernameRow}>
                  <TextInput
                    style={styles.editUsernameInput}
                    value={editText}
                    onChangeText={handleEditChange}
                    autoFocus
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={20}
                    returnKeyType="done"
                    onSubmitEditing={handleEditSave}
                    accessibilityLabel="New username"
                  />
                  <TouchableOpacity
                    style={[styles.editActionBtn, styles.editSaveBtn, editLoading && styles.editSaveBtnDisabled]}
                    onPress={handleEditSave}
                    disabled={editLoading}
                    accessibilityRole="button"
                    accessibilityLabel="Save username"
                  >
                    <Text style={styles.editSaveText}>✓</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.editActionBtn, styles.editCancelBtn]}
                    onPress={handleEditCancel}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel editing"
                  >
                    <Text style={styles.editCancelText}>✕</Text>
                  </TouchableOpacity>
                </View>
                {editError != null && (
                  <Text style={styles.editErrorText}>{editError}</Text>
                )}
              </View>
            ) : (
              <View style={styles.usernameRow}>
                <Text style={styles.username}>{displayName}</Text>
                {user && (
                  <TouchableOpacity
                    style={styles.editPencilBtn}
                    onPress={handleEditStart}
                    accessibilityRole="button"
                    accessibilityLabel="Edit username"
                  >
                    <Text style={styles.editPencilIcon}>✏</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            <Text style={styles.levelLabel}>{`Level ${profile?.level ?? 1}`}</Text>
          </View>
        </Animated.View>

        {/* XP progress bar */}
        <View style={[styles.xpContainer, loadingStyle]}>
          <View style={styles.xpLabelRow}>
            <Text style={styles.xpLabel}>XP</Text>
            <Text style={styles.xpLabel}>
              {`${profile?.xp ?? 0} / ${XP_PER_LEVEL}`}
            </Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: xpPercent }]} />
          </View>
        </View>

        {/* Stats grid — dimmed until data is ready. For signed-in users that means
             both profile and stats. For guests it also waits for the snapshot read
             so the Lives cell never flashes MAX_LIVES before the real value arrives. */}
        <Animated.View entering={hasMounted.current ? undefined : ANIM_STATS} style={styles.animWrapper}>
          <View style={(profileLoading || statsLoading || (!hasUser && guestSnapshot === undefined)) ? styles.loading : undefined}>
            <Text style={styles.sectionTitle}>Statistics</Text>
            <View style={styles.statsGrid}>
              {statRows.map((row) => (
                <View key={row[0]!.label} style={styles.statsRow}>
                  {row.map((item) => (
                    <StatCard key={item.label} item={item} />
                  ))}
                </View>
              ))}
            </View>
          </View>
        </Animated.View>

        {/* Achievements */}
        <Animated.View entering={hasMounted.current ? undefined : ANIM_ACHIEVEMENTS} style={styles.animWrapper}>
          <View style={achievementsLoading ? styles.loading : undefined}>
            <Text style={styles.sectionTitle}>
              {`Achievements (${unlockedCount}/${ACHIEVEMENTS.length})`}
            </Text>
            <View style={styles.achievementGrid}>
              {displayRows.map((row) => {
                const firstSlot = row[0]!
                const rowKey = firstSlot.kind === 'unlocked'
                  ? firstSlot.achievement.id
                  : firstSlot.id
                return (
                  <View key={rowKey} style={styles.achievementRow}>
                    {row.map(slot => {
                      if (slot.kind === 'locked') {
                        return (
                          <View
                            key={slot.id}
                            style={styles.achievementCell}
                            accessible
                            accessibilityLabel="Locked achievement"
                          >
                            <Text style={[styles.achievementIcon, styles.dimmed]}>
                              {'🔒'}
                            </Text>
                            <Text
                              style={[styles.achievementName, styles.achievementNameLocked]}
                              numberOfLines={2}
                            >
                              {'???'}
                            </Text>
                          </View>
                        )
                      }
                      const a = slot.achievement
                      return (
                        <View
                          key={a.id}
                          style={[styles.achievementCell, styles.achievementCellUnlocked]}
                          accessible
                          accessibilityLabel={`${a.name}: ${a.description} - unlocked`}
                        >
                          <Text style={styles.achievementIcon}>
                            {a.icon}
                          </Text>
                          <Text
                            style={styles.achievementName}
                            numberOfLines={2}
                          >
                            {a.name}
                          </Text>
                        </View>
                      )
                    })}
                    {/* Fill trailing empty cells so flex alignment holds */}
                    {row.length < GRID_COLS && Array.from({ length: GRID_COLS - row.length }, (_, i) => (
                      <View key={`pad-${i}`} style={styles.achievementCellPad} />
                    ))}
                  </View>
                )
              })}
            </View>
          </View>
        </Animated.View>

        {/* Account */}
        <View>
          <Text style={styles.sectionTitle}>Account</Text>
          <TouchableOpacity
            style={styles.actionRow}
            onPress={handleOpenSettings}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Settings"
          >
            <Text style={styles.actionLabel}>Settings</Text>
            <Text style={styles.actionChevron}>{'›'}</Text>
          </TouchableOpacity>
          {(!isAnonymous && (hasUser || !didLogOut)) && (
            <TouchableOpacity
              style={[styles.actionRow, (signingOut || profileLoading || !profile) && { opacity: 0.5 }]}
              onPress={handleLogOutPress}
              disabled={signingOut || profileLoading || !profile}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Log Out"
            >
              <Text style={styles.actionLabel}>Log Out</Text>
              <Text style={styles.actionChevron}>{'›'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      {/* Settings modal */}
      <Modal
        visible={settingsVisible}
        transparent
        animationType="none"
        onRequestClose={handleCloseSettings}
        statusBarTranslucent
      >
        <View style={styles.modalWrapper}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={handleCloseSettings}
          />
          <Animated.View
            style={[
              styles.settingsSheet,
              sheetAnimStyle,
              { paddingBottom: Spacing.xl + insets.bottom },
            ]}
          >
            {/* Drag handle */}
            <View style={styles.sheetHandle} />

            {/* Sheet header */}
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Settings</Text>
              <TouchableOpacity
                onPress={handleCloseSettings}
                style={styles.sheetCloseBtn}
                accessibilityRole="button"
                accessibilityLabel="Close settings"
              >
                <Text style={styles.sheetCloseIcon}>{'✕'}</Text>
              </TouchableOpacity>
            </View>

            {/* Music */}
            <Text style={styles.settingsSectionLabel}>Music</Text>

            <View style={styles.settingsRow}>
              <Text style={styles.settingsRowLabel}>Background Music</Text>
              <Switch
                value={isMusicEnabled}
                onValueChange={setMusicEnabled}
                trackColor={{ false: Colors.surface2, true: Colors.gold }}
                thumbColor={Colors.surface}
                ios_backgroundColor={Colors.surface2}
              />
            </View>

            <View style={[styles.settingsRow, !isMusicEnabled && styles.hidden]}>
                <Text style={styles.settingsRowLabel}>Volume</Text>
                <View
                  style={styles.sliderOuter}
                  onLayout={handleSliderLayout}
                  {...volumePanResponder.panHandlers}
                >
                  <View style={styles.sliderTrack}>
                    <View
                      style={[
                        styles.sliderFill,
                        { width: `${Math.round(musicVolume * 100)}%` },
                      ]}
                    />
                  </View>
                  <View
                    style={[
                      styles.sliderThumb,
                      {
                        left: Math.max(
                          0,
                          Math.min(sliderWidth - 20, musicVolume * sliderWidth - 10),
                        ),
                      },
                    ]}
                  />
                </View>
            </View>

            <View style={styles.settingsDivider} />

            {/* App */}
            <Text style={styles.settingsSectionLabel}>App</Text>

            <TouchableOpacity
              style={styles.settingsRow}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Language"
            >
              <Text style={styles.settingsRowLabel}>Language</Text>
              <Text style={styles.settingsRowValue}>{'English >'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.settingsRow}
              onPress={() =>
                Linking.openURL(
                  'https://henrybuildz.github.io/history-quiz-app/privacy.html',
                ).catch(() => {})
              }
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Privacy Policy"
            >
              <Text style={styles.settingsRowLabel}>Privacy Policy</Text>
              <Text style={styles.actionChevron}>{'›'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.settingsRow}
              onPress={() =>
                Linking.openURL(
                  'https://henrybuildz.github.io/history-quiz-app/terms.html',
                ).catch(() => {})
              }
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Terms of Use"
            >
              <Text style={styles.settingsRowLabel}>Terms of Use</Text>
              <Text style={styles.actionChevron}>{'›'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.settingsRow}
              onPress={() =>
                Linking.openURL('https://apps.apple.com/app/idPLACEHOLDER').catch(() => {})
              }
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Rate the App"
            >
              <Text style={styles.settingsRowLabel}>Rate the App</Text>
              <Text style={styles.actionChevron}>{'›'}</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>

      {/* Logout confirmation modal */}
      <Modal
        visible={logoutModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleLogOutCancel}
        statusBarTranslucent
      >
        <View style={styles.logoutBackdrop}>
          <View style={styles.logoutCard}>
            {logoutDone ? (
              <>
                <Text style={styles.logoutDoneIcon}>{'✓'}</Text>
                <Text style={styles.logoutTitle}>Done</Text>
                <Text style={styles.logoutSubtitle}>You've been signed out.</Text>
              </>
            ) : (
              <>
                <Text style={styles.logoutTitle}>Log Out?</Text>
                <Text style={styles.logoutSubtitle}>
                  Are you sure you want to sign out?
                </Text>
                <View style={styles.logoutButtons}>
                  <TouchableOpacity
                    style={styles.logoutCancelBtn}
                    onPress={handleLogOutCancel}
                    disabled={signingOut}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel"
                  >
                    <Text style={styles.logoutCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.logoutConfirmBtn, signingOut && { opacity: 0.5 }]}
                    onPress={handleLogOut}
                    disabled={signingOut}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Confirm log out"
                  >
                    <Text style={styles.logoutConfirmText}>
                      {signingOut ? 'Signing out...' : 'Log Out'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: Spacing.xxl,
    gap: Spacing.lg,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface2,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  bannerText: {
    flex: 1,
    fontFamily: Fonts.display,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  errorBanner: {
    marginHorizontal: Spacing.lg,
    backgroundColor: Colors.wrongBg,
    borderWidth: 1,
    borderColor: Colors.wrong,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  errorBannerText: {
    fontSize: 13,
    color: Colors.wrong,
    textAlign: 'center',
  },
  signInButton: {
    backgroundColor: Colors.gold,
    borderRadius: Radius.md,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    marginLeft: Spacing.sm,
  },
  signInButtonText: {
    fontFamily: Fonts.displayBold,
    fontSize: 13,
    color: Colors.textPrimary, // dark brown on gold: ~7:1 contrast, passes WCAG AA
  },
  // Pure animation wrapper — no visual style. alignSelf: 'stretch' makes the
  // full-width guarantee explicit rather than relying on the parent's default
  // alignItems: 'stretch', which could break if the parent is ever changed.
  animWrapper: {
    alignSelf: 'stretch',
  },
  avatarSection: {
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
  },
  avatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: Colors.gold,
    backgroundColor: Colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  avatarInitials: {
    fontFamily: Fonts.displayBold,
    fontSize: 28,
    color: Colors.gold,
  },
  usernameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  username: {
    fontFamily: Fonts.displayBold,
    fontSize: 22,
    color: Colors.textPrimary,
  },
  editPencilBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.surface2,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editPencilIcon: {
    fontSize: 12,
    color: Colors.gold,
  },
  editUsernameContainer: {
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  editUsernameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  editUsernameInput: {
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.gold,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    color: Colors.textPrimary,
    fontFamily: Fonts.displayBold,
    fontSize: 18,
    minWidth: 140,
    textAlign: 'center',
  },
  editActionBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editSaveBtn: {
    backgroundColor: Colors.gold,
  },
  editSaveBtnDisabled: {
    opacity: 0.5,
  },
  editCancelBtn: {
    backgroundColor: Colors.surface2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  editSaveText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.surface,
  },
  editCancelText: {
    fontSize: 14,
    color: Colors.textMuted,
  },
  editErrorText: {
    fontSize: 11,
    color: Colors.wrong,
    textAlign: 'center',
  },
  levelLabel: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  xpContainer: {
    paddingHorizontal: Spacing.lg,
  },
  xpLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.xs,
  },
  xpLabel: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  progressTrack: {
    height: 8,
    backgroundColor: Colors.surface2,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.gold,
    borderRadius: Radius.full,
  },
  sectionTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: 16,
    color: Colors.textSecondary,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  statsGrid: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: Fonts.displayBold,
    fontSize: 22,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  heartSymbol: {
    color: Colors.wrong,
  },
  achievementGrid: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  achievementRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  achievementCell: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: 2,
    gap: 2,
    minHeight: 72,
  },
  achievementCellUnlocked: {
    borderColor: Colors.gold,
    backgroundColor: Colors.surface2,
  },
  achievementCellPad: {
    flex: 1,
  },
  achievementIcon: {
    fontSize: 22,
  },
  dimmed: {
    opacity: 0.3,
  },
  achievementName: {
    fontFamily: Fonts.display,
    fontSize: 8,
    color: Colors.textPrimary,
    textAlign: 'center',
    lineHeight: 11,
  },
  achievementNameLocked: {
    color: Colors.textMuted,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  actionLabel: {
    fontSize: 15,
    color: Colors.textPrimary,
  },
  actionChevron: {
    fontSize: 20,
    color: Colors.textMuted,
  },
  loading: {
    opacity: 0.4,
  },
  hidden: {
    display: 'none',
  },
  // Settings modal
  modalWrapper: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  settingsSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  sheetTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: 18,
    color: Colors.textPrimary,
  },
  sheetCloseBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetCloseIcon: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  settingsSectionLabel: {
    fontFamily: Fonts.displayBold,
    fontSize: 12,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: Spacing.xs,
    marginTop: Spacing.xs,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  settingsRowLabel: {
    fontSize: 15,
    color: Colors.textPrimary,
  },
  settingsRowValue: {
    fontSize: 15,
    color: Colors.textMuted,
  },
  settingsDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: Spacing.sm,
  },
  sliderOuter: {
    flex: 1,
    height: 40,
    justifyContent: 'center',
    marginLeft: Spacing.md,
  },
  sliderTrack: {
    height: 4,
    backgroundColor: Colors.surface2,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  sliderFill: {
    height: '100%',
    backgroundColor: Colors.gold,
  },
  sliderThumb: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.gold,
    borderWidth: 2,
    borderColor: Colors.surface,
    top: 10,
  },
  logoutBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  logoutCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    width: '100%',
  },
  logoutDoneIcon: {
    fontSize: 40,
    color: Colors.correct,
    marginBottom: Spacing.sm,
  },
  logoutTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: 20,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  logoutSubtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  logoutButtons: {
    flexDirection: 'row',
    gap: Spacing.sm,
    width: '100%',
  },
  logoutCancelBtn: {
    flex: 1,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface2,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  logoutCancelText: {
    fontFamily: Fonts.displayBold,
    fontSize: 14,
    color: Colors.textSecondary,
  },
  logoutConfirmBtn: {
    flex: 1,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radius.md,
    backgroundColor: Colors.wrong,
    alignItems: 'center',
  },
  logoutConfirmText: {
    fontFamily: Fonts.displayBold,
    fontSize: 14,
    color: '#FFF9F0',
  },
});