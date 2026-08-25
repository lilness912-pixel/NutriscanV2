import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, COLORS } from '@/src/lib/api';
import { storage } from '@/src/lib/storage';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_LABELS: Record<string, string> = {
  Monday: 'Lun',
  Tuesday: 'Mar',
  Wednesday: 'Mer',
  Thursday: 'Jeu',
  Friday: 'Ven',
  Saturday: 'Sam',
  Sunday: 'Dim',
};

export default function PlanScreen() {
  const [plan, setPlan] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [dayIdx, setDayIdx] = useState(0);

  const load = useCallback(async () => {
    const uid = await storage.getUserId();
    if (!uid) return;
    try {
      const p = await api.getMealPlan(uid);
      setPlan(p);
    } catch (_) {
      setPlan(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const generate = async () => {
    const uid = await storage.getUserId();
    if (!uid) return;
    setGenerating(true);
    try {
      const p = await api.generateMealPlan(uid);
      setPlan(p);
    } catch (e) {
      console.error(e);
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={COLORS.brandPrimary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="plan-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Plan repas</Text>
        <Text style={styles.subtitle}>Généré par IA selon ton profil</Text>
      </View>

      {plan?.days?.length ? (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.daysRow}
            style={{ maxHeight: 56 }}
          >
            {plan.days.map((d: any, i: number) => (
              <Pressable
                key={i}
                testID={`plan-day-${i}`}
                onPress={() => setDayIdx(i)}
                style={[styles.dayChip, dayIdx === i && styles.dayChipActive]}
              >
                <Text style={[styles.dayText, dayIdx === i && styles.dayTextActive]}>
                  {DAY_LABELS[d.day] || d.day?.slice(0, 3)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
            {(['breakfast', 'lunch', 'dinner', 'snack'] as const).map((k) => {
              const m = plan.days[dayIdx]?.[k];
              if (!m) return null;
              const label =
                k === 'breakfast'
                  ? 'Petit-déjeuner'
                  : k === 'lunch'
                    ? 'Déjeuner'
                    : k === 'dinner'
                      ? 'Dîner'
                      : 'Snack';
              return (
                <View key={k} style={styles.mealCard} testID={`plan-meal-${k}`}>
                  <Text style={styles.mealCat}>{label}</Text>
                  <Text style={styles.mealName}>{m.name}</Text>
                  {m.description ? <Text style={styles.mealDesc}>{m.description}</Text> : null}
                  <View style={styles.macroRow}>
                    <MacroPill v={m.calories} unit="kcal" color={COLORS.brandPrimary} />
                    <MacroPill v={m.protein_g} unit="P" color={COLORS.protein} />
                    <MacroPill v={m.carbs_g} unit="G" color={COLORS.carbs} />
                    <MacroPill v={m.fat_g} unit="L" color={COLORS.fat} />
                  </View>
                </View>
              );
            })}
            <Pressable
              testID="plan-regenerate"
              onPress={generate}
              disabled={generating}
              style={styles.regenBtn}
            >
              {generating ? (
                <ActivityIndicator color={COLORS.brandPrimary} />
              ) : (
                <>
                  <Ionicons name="refresh" size={18} color={COLORS.brandPrimary} />
                  <Text style={{ color: COLORS.brandPrimary, fontWeight: '600' }}>
                    Régénérer le plan
                  </Text>
                </>
              )}
            </Pressable>
          </ScrollView>
        </>
      ) : (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIconWrap}>
            <Ionicons name="restaurant-outline" size={44} color={COLORS.brand} />
          </View>
          <Text style={styles.emptyTitle}>Aucun plan pour l'instant</Text>
          <Text style={styles.emptyText}>
            Génère un plan repas de 7 jours personnalisé par IA basé sur ton profil et tes objectifs.
          </Text>
          <Pressable
            testID="plan-generate-button"
            onPress={generate}
            disabled={generating}
            style={styles.genCta}
          >
            {generating ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="sparkles" size={18} color="#fff" />
                <Text style={styles.genCtaText}>Générer mon plan</Text>
              </>
            )}
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

function MacroPill({ v, unit, color }: { v: number; unit: string; color: string }) {
  return (
    <View style={styles.pill}>
      <View style={[styles.pillDot, { backgroundColor: color }]} />
      <Text style={styles.pillText}>
        <Text style={{ fontWeight: '700', color: COLORS.text }}>{Math.round(v || 0)}</Text>
        <Text style={{ color: COLORS.textMuted }}> {unit}</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface },
  header: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 12 },
  title: { fontSize: 26, fontWeight: '700', color: COLORS.text },
  subtitle: { fontSize: 14, color: COLORS.textMuted, marginTop: 4 },
  daysRow: { paddingHorizontal: 16, gap: 8, alignItems: 'center', height: 56 },
  dayChip: {
    flexShrink: 0,
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: COLORS.brandTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayChipActive: { backgroundColor: COLORS.brandPrimary },
  dayText: { fontSize: 13, fontWeight: '600', color: COLORS.brandPrimary },
  dayTextActive: { color: '#fff' },
  mealCard: {
    backgroundColor: COLORS.surface2,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  mealCat: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.brandPrimary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  mealName: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginTop: 4 },
  mealDesc: { fontSize: 13, color: COLORS.textMuted, marginTop: 4, lineHeight: 19 },
  macroRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.surface3,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 12 },
  regenBtn: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    backgroundColor: COLORS.brandTertiary,
    borderRadius: 999,
  },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  emptyIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: COLORS.brandTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: COLORS.text, marginTop: 8 },
  emptyText: { fontSize: 14, color: COLORS.textMuted, textAlign: 'center', lineHeight: 20 },
  genCta: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.brandPrimary,
    paddingHorizontal: 28,
    paddingVertical: 16,
    borderRadius: 999,
  },
  genCtaText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
