import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withTiming,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import { api, COLORS } from '@/src/lib/api';
import { storage } from '@/src/lib/storage';
import { BouncyPressable, FadeInUp } from '@/src/components/motion';

type DayData = { date: string; calories: number; protein_g: number; target: number };
const DAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

function AnimatedBar({ heightPx, delay, color }: { heightPx: number; delay: number; color: string }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = 0;
    v.value = withDelay(delay, withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) }));
  }, [heightPx, delay, v]);
  const anim = useAnimatedStyle(() => ({
    height: interpolate(v.value, [0, 1], [0, heightPx]),
    opacity: v.value,
  }));
  return <Animated.View style={[{ width: '100%', backgroundColor: color, borderRadius: 6 }, anim]} />;
}

export default function ProgressScreen() {
  const router = useRouter();
  const [data, setData] = useState<DayData[]>([]);
  const [target, setTarget] = useState(2000);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const uid = await storage.getUserId();
    if (!uid) return;
    try {
      const [prog, p] = await Promise.all([api.progress(uid, 7), api.getProfile(uid)]);
      setData(prog.days);
      setTarget(prog.target);
      setProfile(p);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const reset = async () => {
    await storage.clear();
    router.replace('/onboarding');
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={COLORS.brandPrimary} />
      </SafeAreaView>
    );
  }

  const max = Math.max(target * 1.2, ...data.map((d) => d.calories), 100);
  const avg = Math.round(data.reduce((a, b) => a + b.calories, 0) / (data.length || 1));
  const daysOnTrack = data.filter((d) => d.calories > 0 && d.calories <= target * 1.05).length;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="progress-screen">
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        <FadeInUp delay={0}>
          <View style={styles.header}>
            <Text style={styles.eyebrow}>📈 Ta progression</Text>
            <Text style={styles.title}>7 derniers jours</Text>
          </View>
        </FadeInUp>

        <FadeInUp delay={80}>
          <View style={styles.statsRow}>
            <StatCard label="Moy. kcal" value={String(avg)} accent={COLORS.brandPrimary} testID="stat-avg-calories" />
            <StatCard label="Objectif" value={String(target)} accent={COLORS.textSecondary} />
            <StatCard label="Jours OK" value={`${daysOnTrack}/7`} accent={COLORS.success} highlight={daysOnTrack >= 5} />
          </View>
        </FadeInUp>

        {/* Chart */}
        <FadeInUp delay={160}>
          <View style={styles.chartCard} testID="progress-chart">
            <View style={styles.chartHead}>
              <Text style={styles.chartTitle}>Calories par jour</Text>
              <View style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: COLORS.brandPrimary }]} />
                <Text style={styles.legendText}>OK</Text>
                <View style={[styles.legendDot, { backgroundColor: COLORS.warning, marginLeft: 8 }]} />
                <Text style={styles.legendText}>Dépassé</Text>
              </View>
            </View>
            <View style={styles.bars}>
              {data.map((d, i) => {
                const day = new Date(d.date);
                const h = Math.max((d.calories / max) * 160, d.calories > 0 ? 6 : 0);
                const targetH = (target / max) * 160;
                const isToday = i === data.length - 1;
                const color = d.calories === 0
                  ? COLORS.brandTertiary
                  : d.calories > target * 1.1
                    ? COLORS.warning
                    : COLORS.brandPrimary;
                return (
                  <View key={i} style={styles.barCol}>
                    <View style={styles.barZone}>
                      <View style={[styles.targetTick, { bottom: targetH }]} />
                      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
                        <AnimatedBar heightPx={h} delay={200 + i * 90} color={color} />
                      </View>
                    </View>
                    <Text style={[styles.barDay, isToday && { color: COLORS.brandPrimary, fontWeight: '800' }]}>
                      {DAY_LABELS[day.getDay()]}
                    </Text>
                    <Text style={styles.barValue}>{d.calories || '·'}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        </FadeInUp>

        {/* Insight card */}
        {daysOnTrack > 0 && (
          <FadeInUp delay={240}>
            <View style={styles.insightCard}>
              <View style={styles.insightIcon}>
                <Text style={{ fontSize: 22 }}>🎯</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.insightTitle}>
                  {daysOnTrack >= 5 ? 'Excellent rythme !' : daysOnTrack >= 3 ? 'Sur la bonne voie' : 'Continue comme ça'}
                </Text>
                <Text style={styles.insightText}>
                  {daysOnTrack >= 5
                    ? `Tu as respecté ton objectif ${daysOnTrack} jours sur 7 cette semaine. Bravo 👏`
                    : `${daysOnTrack} jours dans la cible. Vise ${Math.min(7, daysOnTrack + 2)} la semaine prochaine.`}
                </Text>
              </View>
            </View>
          </FadeInUp>
        )}

        {/* Profile summary */}
        {profile && (
          <FadeInUp delay={300}>
            <View style={styles.profileCard} testID="profile-summary">
              <View style={styles.profileHead}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{profile.name?.[0]?.toUpperCase() || '?'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.profileName}>{profile.name}</Text>
                  <Text style={styles.profileMeta}>
                    {profile.age} ans · {profile.height_cm}cm · {profile.weight_kg}kg
                  </Text>
                </View>
                <View style={styles.goalPill}>
                  <Text style={styles.goalPillText}>
                    {profile.goal === 'lose' ? 'Perte' : profile.goal === 'gain' ? 'Muscle' : 'Forme'}
                  </Text>
                </View>
              </View>
              <View style={styles.divider} />
              <View style={styles.targetGrid}>
                <TargetItem label="Calories" v={profile.daily_calories} u=" kcal" color={COLORS.brandPrimary} />
                <TargetItem label="Protéines" v={profile.protein_g} u="g" color={COLORS.protein} />
                <TargetItem label="Glucides" v={profile.carbs_g} u="g" color={COLORS.carbs} />
                <TargetItem label="Lipides" v={profile.fat_g} u="g" color={COLORS.fat} />
              </View>
            </View>
          </FadeInUp>
        )}

        <FadeInUp delay={360}>
          <BouncyPressable onPress={reset} hapticStyle="light" style={styles.resetBtn} testID="reset-profile">
            <Ionicons name="log-out-outline" size={18} color={COLORS.error} />
            <Text style={{ color: COLORS.error, fontWeight: '700' }}>Réinitialiser mon profil</Text>
          </BouncyPressable>
        </FadeInUp>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({ label, value, accent, testID, highlight }: { label: string; value: string; accent: string; testID?: string; highlight?: boolean }) {
  return (
    <View style={[styles.statCard, highlight && { backgroundColor: COLORS.brandSecondary }]} testID={testID}>
      <Text style={[styles.statValue, { color: highlight ? COLORS.brandPrimary : COLORS.text }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      <View style={[styles.statAccent, { backgroundColor: accent }]} />
    </View>
  );
}

function TargetItem({ label, v, u, color }: { label: string; v: number; u: string; color: string }) {
  return (
    <View style={styles.targetItem}>
      <View style={[styles.targetDot, { backgroundColor: color }]} />
      <View>
        <Text style={styles.targetValue}>
          {v}
          <Text style={{ fontSize: 11, color: COLORS.textMuted, fontWeight: '700' }}>{u}</Text>
        </Text>
        <Text style={styles.targetItemLabel}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface },
  header: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 16 },
  eyebrow: { fontSize: 12, color: COLORS.brandPrimary, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  title: { fontSize: 30, fontWeight: '800', color: COLORS.text, letterSpacing: -0.5, marginTop: 4 },

  statsRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 10 },
  statCard: {
    flex: 1, backgroundColor: COLORS.surface2, borderRadius: 16, padding: 14,
    alignItems: 'flex-start', overflow: 'hidden', position: 'relative',
  },
  statValue: { fontSize: 22, fontWeight: '800', color: COLORS.text, fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  statLabel: { fontSize: 11, color: COLORS.textMuted, marginTop: 2, fontWeight: '600' },
  statAccent: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 3 },

  chartCard: {
    backgroundColor: COLORS.surface2, marginHorizontal: 16, marginTop: 16, borderRadius: 20, padding: 20,
  },
  chartHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  chartTitle: { fontSize: 15, fontWeight: '800', color: COLORS.text },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 10, color: COLORS.textMuted, fontWeight: '600' },

  bars: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 210 },
  barCol: { alignItems: 'center', flex: 1 },
  barZone: {
    height: 160, width: '70%', justifyContent: 'flex-end', position: 'relative',
    backgroundColor: COLORS.surface3, borderRadius: 8, overflow: 'hidden',
  },
  targetTick: {
    position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: 'rgba(28,28,30,0.25)',
    borderStyle: 'dashed', zIndex: 1,
  },
  barDay: { fontSize: 11, color: COLORS.textMuted, marginTop: 8, fontWeight: '700' },
  barValue: { fontSize: 10, color: COLORS.textSecondary, fontVariant: ['tabular-nums'], marginTop: 1 },

  insightCard: {
    flexDirection: 'row', marginHorizontal: 16, marginTop: 16, borderRadius: 16, padding: 16,
    backgroundColor: COLORS.brandSecondary, gap: 12, alignItems: 'center',
  },
  insightIcon: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
  },
  insightTitle: { fontSize: 15, fontWeight: '800', color: COLORS.brandPrimary },
  insightText: { fontSize: 12, color: COLORS.brandPrimary, marginTop: 2, lineHeight: 17, opacity: 0.9 },

  profileCard: {
    backgroundColor: COLORS.surface2, marginHorizontal: 16, marginTop: 16, borderRadius: 20, padding: 20,
  },
  profileHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: '800' },
  profileName: { fontSize: 17, fontWeight: '800', color: COLORS.text },
  profileMeta: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  goalPill: {
    backgroundColor: COLORS.brandTertiary, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
  },
  goalPillText: { fontSize: 11, color: COLORS.brandPrimary, fontWeight: '800' },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 16 },
  targetGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  targetItem: { width: '50%', paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  targetDot: { width: 8, height: 8, borderRadius: 4 },
  targetValue: { fontSize: 20, fontWeight: '800', color: COLORS.text, fontVariant: ['tabular-nums'], letterSpacing: -0.3 },
  targetItemLabel: { fontSize: 11, color: COLORS.textMuted, fontWeight: '600' },

  resetBtn: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
    marginTop: 24, padding: 14, marginHorizontal: 16,
  },
});
