import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, COLORS } from '@/src/lib/api';
import { storage } from '@/src/lib/storage';

type DayData = { date: string; calories: number; protein_g: number; target: number };

const DAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

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

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

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
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={styles.header}>
          <Text style={styles.title}>Progrès</Text>
          <Text style={styles.subtitle}>7 derniers jours</Text>
        </View>

        {/* Stats cards */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue} testID="stat-avg-calories">{avg}</Text>
            <Text style={styles.statLabel}>Moy. calories</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{target}</Text>
            <Text style={styles.statLabel}>Objectif quot.</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{daysOnTrack}/7</Text>
            <Text style={styles.statLabel}>Jours OK</Text>
          </View>
        </View>

        {/* Chart card */}
        <View style={styles.chartCard} testID="progress-chart">
          <Text style={styles.chartTitle}>Calories quotidiennes</Text>
          <View style={styles.chartWrap}>
            <View style={styles.targetLine}>
              <Text style={styles.targetLabel}>Cible</Text>
            </View>
            <View style={styles.bars}>
              {data.map((d, i) => {
                const day = new Date(d.date);
                const h = (d.calories / max) * 160;
                const targetH = (target / max) * 160;
                return (
                  <View key={i} style={styles.barCol}>
                    <View style={styles.barZone}>
                      <View style={[styles.targetTick, { bottom: targetH }]} />
                      <View
                        style={[
                          styles.bar,
                          {
                            height: h,
                            backgroundColor:
                              d.calories > target * 1.1
                                ? COLORS.warning
                                : d.calories === 0
                                  ? COLORS.brandTertiary
                                  : COLORS.brandPrimary,
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.barDay}>{DAY_LABELS[day.getDay()]}</Text>
                    <Text style={styles.barValue}>{d.calories || '·'}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        </View>

        {/* Profile summary */}
        {profile && (
          <View style={styles.profileCard} testID="profile-summary">
            <View style={styles.profileHead}>
              <View style={styles.avatar}>
                <Ionicons name="person" size={22} color={COLORS.brandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.profileName}>{profile.name}</Text>
                <Text style={styles.profileMeta}>
                  {profile.age} ans · {profile.height_cm}cm · {profile.weight_kg}kg
                </Text>
              </View>
            </View>
            <View style={styles.divider} />
            <View style={styles.targetGrid}>
              <TargetItem label="Calories" v={profile.daily_calories} u="kcal" />
              <TargetItem label="Protéines" v={profile.protein_g} u="g" />
              <TargetItem label="Glucides" v={profile.carbs_g} u="g" />
              <TargetItem label="Lipides" v={profile.fat_g} u="g" />
            </View>
          </View>
        )}

        <Pressable onPress={reset} style={styles.resetBtn} testID="reset-profile">
          <Ionicons name="log-out-outline" size={18} color={COLORS.error} />
          <Text style={{ color: COLORS.error, fontWeight: '600' }}>Réinitialiser mon profil</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function TargetItem({ label, v, u }: { label: string; v: number; u: string }) {
  return (
    <View style={styles.targetItem}>
      <Text style={styles.targetValue}>
        {v}
        <Text style={{ fontSize: 12, color: COLORS.textMuted }}>{u}</Text>
      </Text>
      <Text style={styles.targetItemLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface },
  header: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 16 },
  title: { fontSize: 26, fontWeight: '700', color: COLORS.text },
  subtitle: { fontSize: 14, color: COLORS.textMuted, marginTop: 4 },
  statsRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8 },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.surface2,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    fontVariant: ['tabular-nums'],
  },
  statLabel: { fontSize: 11, color: COLORS.textMuted, marginTop: 4, textAlign: 'center' },
  chartCard: {
    backgroundColor: COLORS.surface2,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 20,
    padding: 20,
  },
  chartTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text, marginBottom: 16 },
  chartWrap: {},
  targetLine: { alignItems: 'flex-end' },
  targetLabel: { fontSize: 10, color: COLORS.textMuted, fontWeight: '600' },
  bars: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 210 },
  barCol: { alignItems: 'center', flex: 1 },
  barZone: {
    height: 160,
    width: '70%',
    justifyContent: 'flex-end',
    position: 'relative',
    backgroundColor: COLORS.surface3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  bar: { width: '100%', borderRadius: 6 },
  targetTick: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: COLORS.borderStrong,
    zIndex: 1,
  },
  barDay: { fontSize: 11, color: COLORS.textMuted, marginTop: 6, fontWeight: '600' },
  barValue: { fontSize: 10, color: COLORS.textSecondary, fontVariant: ['tabular-nums'] },
  profileCard: {
    backgroundColor: COLORS.surface2,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 20,
    padding: 20,
  },
  profileHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.brandTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileName: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  profileMeta: { fontSize: 13, color: COLORS.textMuted, marginTop: 2 },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 16 },
  targetGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  targetItem: { width: '50%', paddingVertical: 6 },
  targetValue: { fontSize: 20, fontWeight: '700', color: COLORS.text, fontVariant: ['tabular-nums'] },
  targetItemLabel: { fontSize: 12, color: COLORS.textMuted },
  resetBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 24,
    padding: 12,
  },
});
