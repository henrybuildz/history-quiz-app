import { useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { Colors, Fonts, Spacing, Radius } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const MOCK_PROFILE = {
  username: 'Historian',
  total_score: 0,
  level: 1,
  xp: 0,
  xpToNextLevel: 500,
  lives: 3,
  quizzesPlayed: 0,
  correctAnswers: 0,
  accuracy: 0,
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

const XP_PERCENT = computeXpPercent(MOCK_PROFILE.xp, MOCK_PROFILE.xpToNextLevel);

const INITIALS = MOCK_PROFILE.username.trim().charAt(0).toUpperCase() || '?';

const STAT_ITEMS: StatItem[] = [
  { label: 'Total Score',     value: String(MOCK_PROFILE.total_score) },
  { label: 'Quizzes Played',  value: String(MOCK_PROFILE.quizzesPlayed) },
  { label: 'Correct Answers', value: String(MOCK_PROFILE.correctAnswers) },
  { label: 'Accuracy',        value: `${MOCK_PROFILE.accuracy}%` },
  { label: 'Level',           value: String(MOCK_PROFILE.level) },
  { label: 'Lives',           value: String(MOCK_PROFILE.lives), heartPrefix: true },
];

const STAT_ROWS: StatItem[][] = Array.from(
  { length: Math.ceil(STAT_ITEMS.length / 2) },
  (_, i) => STAT_ITEMS.slice(i * 2, i * 2 + 2),
);

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
  const { user, isAnonymous } = useAuth();
  const displayName = isAnonymous ? 'Guest Scholar' : (user?.email?.split('@')[0] ?? 'Historian');

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
        {/* Sign-in banner */}
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Sign in to save your progress</Text>
          <TouchableOpacity
            style={styles.signInButton}
            onPress={() => router.push('/(auth)/welcome')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Sign in to save your progress"
          >
            <Text style={styles.signInButtonText}>Sign In</Text>
          </TouchableOpacity>
        </View>

        {/* Avatar + username */}
        <Animated.View
          style={styles.avatarSection}
          entering={hasMounted.current ? undefined : ANIM_AVATAR}
        >
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitials}>{INITIALS}</Text>
          </View>
          <Text style={styles.username}>{displayName}</Text>
          <Text style={styles.levelLabel}>{`Level ${MOCK_PROFILE.level}`}</Text>
        </Animated.View>

        {/* XP progress bar */}
        <View style={styles.xpContainer}>
          <View style={styles.xpLabelRow}>
            <Text style={styles.xpLabel}>XP</Text>
            <Text style={styles.xpLabel}>
              {`${MOCK_PROFILE.xp} / ${MOCK_PROFILE.xpToNextLevel}`}
            </Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: XP_PERCENT }]} />
          </View>
        </View>

        {/* Stats grid */}
        <Animated.View entering={hasMounted.current ? undefined : ANIM_STATS}>
          <Text style={styles.sectionTitle}>Statistics</Text>
          <View style={styles.statsGrid}>
            {STAT_ROWS.map((row) => (
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
});