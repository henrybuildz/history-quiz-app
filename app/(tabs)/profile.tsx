import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { Colors, Fonts, Spacing, Radius } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { getProfile, ProfileRow, getProfileStats, ProfileStats } from '../../lib/supabase';

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

// xpToNextLevel is the only value not yet sourced from the DB.
const MOCK_PROFILE = {
  xpToNextLevel: 500,
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StatItem = {
  label: string;
  value: string;
  heartPrefix?: boolean;
};

// ---------------------------------------------------------------------------
// Module-level derived constants
// ---------------------------------------------------------------------------

function computeXpPercent(xp: number, xpMax: number): `${number}%` {
  if (xpMax <= 0) return '0%';
  const pct = Math.min(100, Math.max(0, (xp / xpMax) * 100));
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
  const { user, isAnonymous, signOut } = useAuth();

  const [profile, setProfile] = useState<ProfileRow | null>(null)
  // Lazy initializer: start in loading state for real users so frame-zero
  // shows dimmed defaults rather than a flash of unloaded data.
  // NavigationGuard ensures auth state is resolved before (tabs) renders.
  const [profileLoading, setProfileLoading] = useState(() => !isAnonymous && !!user)
  const [statsLoading,   setStatsLoading]   = useState(() => !isAnonymous && !!user)
  const [stats, setStats] = useState<ProfileStats>({ quizzesPlayed: 0, correctAnswers: 0, accuracy: 0 })

  useEffect(() => {
    if (!user || isAnonymous) {
      setProfile(null)
      setStats({ quizzesPlayed: 0, correctAnswers: 0, accuracy: 0 })
      setProfileLoading(false)  // reset — cleanup blocks finally when signing out mid-fetch
      setStatsLoading(false)
      return
    }
    let cancelled = false
    setProfileLoading(true)
    getProfile(user.id)
      .then((data) => { if (!cancelled) setProfile(data) })
      .catch((err) => { if (!cancelled) console.error('Failed to fetch profile:', err) })
      .finally(() => { if (!cancelled) setProfileLoading(false) })
    return () => { cancelled = true }
  }, [user?.id, isAnonymous])

  useEffect(() => {
    // Anonymous users never have saved sessions — skip the fetch entirely.
    if (!user?.id || isAnonymous) {
      setStatsLoading(false)
      return
    }
    let cancelled = false
    setStatsLoading(true)
    getProfileStats(user.id)
      .then((data) => { if (!cancelled) setStats(data) })
      // getProfileStats never throws — it returns zeros on all Supabase errors.
      // This .catch() is a safety net for truly unexpected JS exceptions only.
      .catch((err) => { if (!cancelled) console.error('Failed to fetch profile stats:', err) })
      .finally(() => { if (!cancelled) setStatsLoading(false) })
    return () => { cancelled = true }
  }, [user?.id, isAnonymous])

  // Depend on user?.email, not user — the User object reference changes on every
  // session refresh (token rotation) even when the email is unchanged.
  // Profile username takes priority when available.
  const displayName = useMemo(() => {
    if (isAnonymous) return 'Guest Scholar'
    if (profile?.username) return profile.username
    return user?.email?.split('@')[0] ?? 'Historian'
  }, [isAnonymous, profile?.username, user?.email]);

  const initials = useMemo(
    () => displayName.trim().charAt(0).toUpperCase() || '?',
    [displayName],
  );

  const xpPercent = useMemo(
    () => computeXpPercent(profile?.xp ?? 0, MOCK_PROFILE.xpToNextLevel),
    [profile?.xp],
  );

  const statItems = useMemo<StatItem[]>(() => [
    { label: 'Total Score',     value: String(profile?.total_score ?? 0) },
    { label: 'Quizzes Played',  value: String(stats.quizzesPlayed) },
    { label: 'Correct Answers', value: String(stats.correctAnswers) },
    { label: 'Accuracy',        value: `${stats.accuracy}%` },
    { label: 'Level',           value: String(profile?.level ?? 1) },
    { label: 'Lives',           value: String(profile?.lives ?? 0), heartPrefix: true },
  ], [profile?.total_score, profile?.level, profile?.lives, stats.quizzesPlayed, stats.correctAnswers, stats.accuracy])

  const statRows = useMemo<StatItem[][]>(() => Array.from(
    { length: Math.ceil(statItems.length / 2) },
    (_, i) => statItems.slice(i * 2, i * 2 + 2),
  ), [statItems])

  const [signingOut, setSigningOut] = useState(false);
  // Ref guards against double-fire without needing to be a useCallback dep.
  // useState(signingOut) is kept separately for UI-only updates (disabled, text).
  const signingOutRef = useRef(false);
  const handleLogOut = useCallback(async () => {
    if (signingOutRef.current) return
    signingOutRef.current = true
    setSigningOut(true)
    try {
      await signOut()
    } catch {
      Alert.alert('Error', 'Could not sign out. Please try again.')
    } finally {
      signingOutRef.current = false
      setSigningOut(false)
    }
  }, [signOut])

  const handleSignIn = useCallback(() => {
    router.push('/(auth)/welcome')
  }, [router])

  // Single StyleSheet-backed reference reused across all loading-dimmed sections.
  const loadingStyle = profileLoading ? styles.loading : undefined

  const hasMounted = useRef(false);
  useEffect(() => {
    hasMounted.current = true;
  }, []);

  return (
    <SafeAreaView style={styles.root} edges={SAFE_EDGES}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Sign-in banner — only shown to anonymous users */}
        {isAnonymous && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>Sign in to save your progress</Text>
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

        {/* Avatar + username */}
        <Animated.View
          style={[styles.avatarSection, loadingStyle]}
          entering={hasMounted.current ? undefined : ANIM_AVATAR}
        >
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitials}>{initials}</Text>
          </View>
          <Text style={styles.username}>{displayName}</Text>
          <Text style={styles.levelLabel}>{`Level ${profile?.level ?? 1}`}</Text>
        </Animated.View>

        {/* XP progress bar */}
        <View style={[styles.xpContainer, loadingStyle]}>
          <View style={styles.xpLabelRow}>
            <Text style={styles.xpLabel}>XP</Text>
            <Text style={styles.xpLabel}>
              {`${profile?.xp ?? 0} / ${MOCK_PROFILE.xpToNextLevel}`}
            </Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: xpPercent }]} />
          </View>
        </View>

        {/* Stats grid — dimmed until BOTH profile and stats have loaded, so
             Total Score / Level never undim while Quizzes / Accuracy still show 0. */}
        <Animated.View
          entering={hasMounted.current ? undefined : ANIM_STATS}
          style={(profileLoading || statsLoading) ? styles.loading : undefined}
        >
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
        </Animated.View>

        {/* Achievements */}
        <Animated.View entering={hasMounted.current ? undefined : ANIM_ACHIEVEMENTS}>
          <Text style={styles.sectionTitle}>Achievements</Text>
          <View style={styles.achievementPlaceholder}>
            <Text style={styles.achievementText}>
              Complete quizzes to unlock achievements
            </Text>
          </View>
        </Animated.View>

        {/* Account */}
        <View>
          <Text style={styles.sectionTitle}>Account</Text>
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => {}}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="About"
          >
            <Text style={styles.actionLabel}>About</Text>
            <Text style={styles.actionChevron}>{'›'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => {}}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Rate the App"
          >
            <Text style={styles.actionLabel}>Rate the App</Text>
            <Text style={styles.actionChevron}>{'›'}</Text>
          </TouchableOpacity>
          {!isAnonymous && (
            <TouchableOpacity
              style={[styles.actionRow, signingOut && { opacity: 0.5 }]}
              onPress={handleLogOut}
              disabled={signingOut}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Log Out"
            >
              <Text style={styles.actionLabel}>{signingOut ? 'Signing out…' : 'Log Out'}</Text>
              <Text style={styles.actionChevron}>{'›'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
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
  username: {
    fontFamily: Fonts.displayBold,
    fontSize: 22,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
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
  achievementPlaceholder: {
    marginHorizontal: Spacing.lg,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: Platform.OS === 'ios' ? 'dashed' : 'solid',
    borderRadius: Radius.md,
    paddingVertical: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  achievementText: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: Spacing.lg,
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
});