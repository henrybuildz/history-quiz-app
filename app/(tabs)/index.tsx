import { useState, useCallback, memo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  StyleSheet,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors, Fonts, Spacing, Radius } from '../../constants/theme';
import {
  AnimatedSlot,
  ENTRANCE_STAGGER_MS,
  ENTRANCE_MAX_DELAY_MS,
} from '../../components/AnimatedSlot';

// ─── Types & Constants ────────────────────────────────────────────────────────

type EraItem = {
  readonly name: string;
  readonly emoji: string;
};

const ERAS: readonly EraItem[] = [
  { name: 'Ancient Rome',    emoji: '🏛️' },
  { name: 'Ancient Greece',  emoji: '⚡' },
  { name: 'Ancient Egypt',   emoji: '𓂀' },
  { name: 'Medieval Europe', emoji: '⚔️' },
  { name: 'World War II',    emoji: '💣' },
  { name: 'World War I',     emoji: '🪖' },
  { name: 'Cold War',        emoji: '🚀' },
  { name: 'Renaissance',     emoji: '🎨' },
  { name: 'Napoleonic Wars', emoji: '🐴' },
  { name: 'Ottoman Empire',  emoji: '🌙' },
  { name: 'Byzantine Empire',emoji: '✝️' },
  { name: 'Mongol Empire',   emoji: '🏹' },
];

const ERA_ROWS: EraItem[][] = Array.from(
  { length: Math.ceil(ERAS.length / 2) },
  (_, i) => ERAS.slice(i * 2, i * 2 + 2),
);

type DifficultyValue = 'easy' | 'medium' | 'hard';

type DifficultyOption = {
  readonly value: DifficultyValue;
  readonly emoji: string;
  readonly name: string;
  readonly description: string;
};

const DIFFICULTIES: readonly DifficultyOption[] = [
  { value: 'easy',   emoji: '🌿', name: 'Easy',   description: 'Beginner friendly' },
  { value: 'medium', emoji: '⚔️', name: 'Medium', description: 'Test your knowledge' },
  { value: 'hard',   emoji: '💀', name: 'Hard',   description: 'For historians only' },
];

const CLOSE_BTN_WIDTH = 32;

// ─── DifficultyModal ──────────────────────────────────────────────────────────

const DifficultyModal = memo(function DifficultyModal({
  visible,
  era,
  entryKey,
  onSelect,
  onClose,
}: {
  visible: boolean;
  era: string;
  entryKey: number;
  onSelect: (difficulty: DifficultyValue) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      // Android hardware back dismisses the sheet
      onRequestClose={onClose}
    >
      <View style={sheetStyles.backdrop}>
        {/* Full-screen touchable sits behind the sheet in the view hierarchy.
            React Native gives precedence to later siblings, so sheet touches are
            not intercepted — only taps on the dark area above the sheet hit this. */}
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          activeOpacity={1}
          accessibilityRole="button"
          accessibilityLabel="Close difficulty selection"
        />

        <View style={[sheetStyles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
          {/* Header */}
          <View style={sheetStyles.header}>
            {/* Left spacer mirrors the close button width to keep the title centred */}
            <View style={sheetStyles.headerSpacer} />
            <View style={sheetStyles.headerCenter}>
              <Text style={sheetStyles.eraTitle} numberOfLines={1}>
                {era}
              </Text>
              <Text style={sheetStyles.headerSub}>Select Difficulty</Text>
            </View>
            <TouchableOpacity
              style={sheetStyles.closeBtn}
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={sheetStyles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Re-key the container on every open so AnimatedSlots remount and
              replay their entrance animations even if the same era is re-tapped */}
          <View key={entryKey} style={sheetStyles.optionList}>
            {DIFFICULTIES.map((diff, i) => (
              <AnimatedSlot key={diff.value} delay={i * ENTRANCE_STAGGER_MS}>
                <TouchableOpacity
                  style={sheetStyles.optionCard}
                  activeOpacity={0.82}
                  accessibilityRole="button"
                  accessibilityLabel={`${diff.name}: ${diff.description}`}
                  onPress={() => onSelect(diff.value)}
                >
                  <Text style={sheetStyles.optionEmoji} accessible={false}>
                    {diff.emoji}
                  </Text>
                  <View style={sheetStyles.optionBody}>
                    <Text style={sheetStyles.optionName}>{diff.name}</Text>
                    <Text style={sheetStyles.optionDesc}>{diff.description}</Text>
                  </View>
                  <Text style={sheetStyles.optionArrow}>›</Text>
                </TouchableOpacity>
              </AnimatedSlot>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
});

// ─── HomeScreen ───────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const [selectedEra,   setSelectedEra]   = useState<string | null>(null);
  const [showDiffModal, setShowDiffModal] = useState(false);
  // Incremented on every open so the AnimatedSlot entrance always replays
  const [modalKey,      setModalKey]      = useState(0);

  const handleEraPress = useCallback((era: string) => {
    setSelectedEra(era);
    setShowDiffModal(true);
    setModalKey(k => k + 1);
  }, []);

  const handleDiffSelect = useCallback((difficulty: DifficultyValue) => {
    setShowDiffModal(false);
    if (!selectedEra) return; // guard — selectedEra is always set when modal is open
    // Defer navigation one frame so the sheet's slide-down animation starts before
    // the route push takes over — prevents a double-transition flash on Android.
    const era = selectedEra;
    requestAnimationFrame(() => {
      router.push({
        pathname: '/quiz/[era]',
        params: { era, difficulty },
      });
    });
  }, [selectedEra]);

  const handleCloseModal = useCallback(() => {
    setShowDiffModal(false);
  }, []);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <DifficultyModal
        visible={showDiffModal}
        era={selectedEra ?? ''}
        entryKey={modalKey}
        onSelect={handleDiffSelect}
        onClose={handleCloseModal}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <AnimatedSlot delay={0} style={styles.header}>
          <Text style={styles.appTitle}>HISTORY QUIZ</Text>
          <Text style={styles.subtitle}>Choose Your Era</Text>
        </AnimatedSlot>

        <AnimatedSlot delay={ENTRANCE_STAGGER_MS}>
          <TouchableOpacity
            style={styles.mixedCard}
            activeOpacity={0.82}
            accessibilityRole="button"
            accessibilityLabel="Mixed mode: all eras, endless questions"
            onPress={() => handleEraPress('Mixed')}
          >
            <Text style={styles.mixedLabel}>⚡ Mixed</Text>
            <Text style={styles.mixedSub}>All Eras · Endless Questions</Text>
          </TouchableOpacity>
        </AnimatedSlot>

        <View style={styles.grid}>
          {ERA_ROWS.map((row, rowIndex) => (
            <View key={row[0]?.name ?? String(rowIndex)} style={styles.row}>
              {row.map((era, colIndex) => {
                const delay = Math.min(
                  (rowIndex * 2 + colIndex + 2) * ENTRANCE_STAGGER_MS,
                  ENTRANCE_MAX_DELAY_MS,
                );
                return (
                  <AnimatedSlot key={era.name} delay={delay} style={styles.cardCell}>
                    <TouchableOpacity
                      style={styles.eraCard}
                      activeOpacity={0.82}
                      accessibilityRole="button"
                      accessibilityLabel={`${era.name} quiz`}
                      onPress={() => handleEraPress(era.name)}
                    >
                      <Text
                        style={styles.eraEmoji}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                      >
                        {era.emoji}
                      </Text>
                      <Text style={styles.eraName}>{era.name}</Text>
                    </TouchableOpacity>
                  </AnimatedSlot>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Home Styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  header: {
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  appTitle: {
    fontFamily: Fonts.display,
    fontSize: 32,
    color: Colors.gold,
    letterSpacing: 4,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    letterSpacing: 2,
    marginTop: Spacing.xs,
    textAlign: 'center',
  },
  mixedCard: {
    backgroundColor: Colors.gold,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  mixedLabel: {
    fontFamily: Fonts.display,
    fontSize: 26,
    color: Colors.surface,
    letterSpacing: 2,
    marginBottom: Spacing.xs,
  },
  mixedSub: {
    fontSize: 13,
    color: Colors.surface2,
    letterSpacing: 0.8,
  },
  grid: {
    gap: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  cardCell: {
    flex: 1,
  },
  eraCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 108,
  },
  eraEmoji: {
    fontSize: 34,
    marginBottom: Spacing.sm,
  },
  eraName: {
    fontFamily: Fonts.display,
    fontSize: 11,
    color: Colors.textPrimary,
    textAlign: 'center',
    letterSpacing: 0.8,
    lineHeight: 16,
  },
});

// ─── Sheet Styles ─────────────────────────────────────────────────────────────

const sheetStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    borderTopWidth: 2,
    borderTopColor: Colors.gold,
    paddingTop: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerSpacer: {
    width: CLOSE_BTN_WIDTH,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  eraTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: 18,
    color: Colors.gold,
    letterSpacing: 2,
    textAlign: 'center',
  },
  headerSub: {
    fontSize: 11,
    color: Colors.textSecondary,
    letterSpacing: 1.5,
  },
  closeBtn: {
    width: CLOSE_BTN_WIDTH,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 18,
    color: Colors.textMuted,
  },
  optionList: {
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface2,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.gold,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  optionEmoji: {
    fontSize: 26,
    marginRight: Spacing.md,
  },
  optionBody: {
    flex: 1,
    gap: 3,
  },
  optionName: {
    fontFamily: Fonts.display,
    fontSize: 15,
    color: Colors.textPrimary,
    letterSpacing: 0.8,
  },
  optionDesc: {
    fontSize: 12,
    color: Colors.textMuted,
    letterSpacing: 0.4,
  },
  optionArrow: {
    fontSize: 24,
    color: Colors.gold,
    marginLeft: Spacing.sm,
  },
});
