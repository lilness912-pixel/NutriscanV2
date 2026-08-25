import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { api, COLORS } from '@/src/lib/api';
import { BouncyPressable, FadeInUp } from '@/src/components/motion';
import { fallbackFoodImage } from '@/src/lib/images';

const DAY_LABELS: Record<string, string> = {
  Monday: 'Lun', Tuesday: 'Mar', Wednesday: 'Mer', Thursday: 'Jeu',
  Friday: 'Ven', Saturday: 'Sam', Sunday: 'Dim',
};
const DAY_FULL: Record<string, string> = {
  Monday: 'Lundi', Tuesday: 'Mardi', Wednesday: 'Mercredi', Thursday: 'Jeudi',
  Friday: 'Vendredi', Saturday: 'Samedi', Sunday: 'Dimanche',
};

const CAT_META: Record<string, { l: string; emoji: string }> = {
  breakfast: { l: 'Petit-déjeuner', emoji: '☀️' },
  lunch: { l: 'Déjeuner', emoji: '🍽️' },
  dinner: { l: 'Dîner', emoji: '🌙' },
  snack: { l: 'Snack', emoji: '🍎' },
};

export default function PlanScreen() {
  const [plan, setPlan] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [dayIdx, setDayIdx] = useState(0);
  const [refreshedBanner, setRefreshedBanner] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = await api.getMealPlan();
      setPlan(p);
      if (p?.auto_refreshed) {
        setRefreshedBanner(true);
        setTimeout(() => setRefreshedBanner(false), 6000);
      }
    } catch (e: any) {
      // 404 = pas encore de plan → afficher l'empty state immédiatement
      if (typeof e?.message === 'string' && e.message.startsWith('404:')) {
        setPlan(null);
        setLoading(false);
        return;
      }
      // Ingress may return 502 on the first stale-week auto_refresh call because
      // Gemini takes 60-120s. Poll the non-refreshing GET until the fresh plan
      // lands (server keeps generating in the background) — up to 2 min.
      const before = Date.now();
      let found: any = null;
      const startedIso = new Date(before).toISOString();
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        try {
          const p2 = await api.getMealPlanNoRefresh();
          if (p2 && p2.week_start === currentMondayIso() && (!p2.created_at || p2.created_at > startedIso)) {
            found = p2;
            break;
          }
        } catch (_) {
          /* still generating or 404 */
        }
      }
      if (found) {
        setPlan(found);
        setRefreshedBanner(true);
        setTimeout(() => setRefreshedBanner(false), 6000);
      } else {
        setPlan(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const generate = async (force = false) => {
    setGenerating(true);
    setErrorMsg(null);
    const startedIso = new Date().toISOString();
    try {
      const p = await api.generateMealPlan(force);
      setPlan(p);
      setDayIdx(0);
    } catch (_) {
      // Ingress 502 at ~60s. The backend keeps working. Poll for the finished plan.
      let found: any = null;
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        try {
          const p2 = await api.getMealPlanNoRefresh();
          if (p2 && p2.week_start === currentMondayIso() && (!p2.created_at || p2.created_at > startedIso)) {
            found = p2;
            break;
          }
        } catch (_e) {
          /* still generating */
        }
      }
      if (found) {
        setPlan(found);
        setDayIdx(0);
        setRefreshedBanner(true);
        setTimeout(() => setRefreshedBanner(false), 6000);
      } else {
        setErrorMsg("L'IA n'a pas pu générer le plan. Réessaie dans un instant.");
        setTimeout(() => setErrorMsg(null), 6000);
      }
    } finally {
      setGenerating(false);
    }
  };

  function currentMondayIso() {
    const d = new Date();
    const day = d.getUTCDay(); // 0 = Sunday
    const diff = day === 0 ? -6 : 1 - day;
    d.setUTCDate(d.getUTCDate() + diff);
    return d.toISOString().slice(0, 10);
  }

  if (loading || generating) {
    return (
      <SafeAreaView style={styles.center} testID="plan-loading">
        <View style={styles.loadingCard}>
          <ActivityIndicator color={COLORS.brandPrimary} size="large" />
          <Text style={styles.loadingTitle}>
            {generating ? "L'IA prépare ta semaine…" : 'Chargement de ton plan'}
          </Text>
          <Text style={styles.loadingText}>
            {generating
              ? '28 repas équilibrés, variés et de saison. Ça prend environ 1 à 2 minutes.'
              : "Si c'est une nouvelle semaine, l'IA prépare un menu tout frais (~1 à 2 min)."}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const currentDay = plan?.days?.[dayIdx];
  const totalCals = currentDay
    ? (['breakfast', 'lunch', 'dinner', 'snack'] as const).reduce(
        (s, k) => s + (currentDay[k]?.calories || 0), 0)
    : 0;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="plan-screen">
      <FadeInUp delay={0}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>🍳 Ton coach IA</Text>
          <Text style={styles.title}>Plan repas</Text>
          {plan?.week_start ? (
            <Text style={styles.subtitle}>
              Semaine du {new Date(plan.week_start).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} · renouvelé chaque lundi
            </Text>
          ) : (
            <Text style={styles.subtitle}>Personnalisé selon ton profil et tes objectifs</Text>
          )}
        </View>
      </FadeInUp>

      {refreshedBanner && (
        <FadeInUp delay={0}>
          <View style={styles.refreshBanner} testID="plan-refreshed-banner">
            <Ionicons name="sparkles" size={14} color={COLORS.brandPrimary} />
            <Text style={styles.refreshBannerText}>Nouveau plan généré pour cette semaine ✨</Text>
          </View>
        </FadeInUp>
      )}

      {errorMsg && (
        <FadeInUp delay={0}>
          <View style={styles.errorBanner} testID="plan-error-banner">
            <Ionicons name="alert-circle" size={14} color={COLORS.error} />
            <Text style={styles.errorBannerText}>{errorMsg}</Text>
          </View>
        </FadeInUp>
      )}

      {plan?.days?.length ? (
        <>
          <FadeInUp delay={80}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.daysRow}
              style={{ maxHeight: 60 }}
            >
              {plan.days.map((d: any, i: number) => (
                <BouncyPressable
                  key={i}
                  testID={`plan-day-${i}`}
                  onPress={() => setDayIdx(i)}
                  hapticStyle="selection"
                  style={[styles.dayChip, dayIdx === i && styles.dayChipActive]}
                >
                  <Text style={[styles.dayText, dayIdx === i && styles.dayTextActive]}>
                    {DAY_LABELS[d.day] || d.day?.slice(0, 3)}
                  </Text>
                </BouncyPressable>
              ))}
            </ScrollView>
          </FadeInUp>

          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
            <FadeInUp delay={140}>
              <View style={styles.daySummary}>
                <View>
                  <Text style={styles.daySummaryLabel}>{DAY_FULL[currentDay?.day] || currentDay?.day}</Text>
                  <Text style={styles.daySummaryValue}>
                    {totalCals}<Text style={{ fontSize: 14, color: COLORS.textMuted, fontWeight: '600' }}> kcal totales</Text>
                  </Text>
                </View>
                <View style={styles.daySummaryChip}>
                  <Ionicons name="sparkles" size={12} color={COLORS.brandPrimary} />
                  <Text style={styles.daySummaryChipText}>IA</Text>
                </View>
              </View>
            </FadeInUp>

            {(['breakfast', 'lunch', 'dinner', 'snack'] as const).map((k, idx) => {
              const m = currentDay?.[k];
              if (!m) return null;
              const meta = CAT_META[k];
              return (
                <FadeInUp key={`${dayIdx}-${k}`} delay={180 + idx * 80}>
                  <View style={styles.mealHero} testID={`plan-meal-${k}`}>
                    <Image
                      source={{ uri: fallbackFoodImage(m.name || k) }}
                      style={StyleSheet.absoluteFill as any}
                      contentFit="cover"
                      transition={300}
                    />
                    <LinearGradient
                      colors={['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.4)', 'rgba(0,0,0,0.85)']}
                      style={StyleSheet.absoluteFill}
                    />
                    <View style={styles.mealHeroTop}>
                      <View style={styles.mealCatBadge}>
                        <Text style={styles.mealCatBadgeText}>{meta.emoji} {meta.l}</Text>
                      </View>
                      <View style={styles.mealCalBadge}>
                        <Text style={styles.mealCalBadgeText}>{m.calories}</Text>
                        <Text style={styles.mealCalBadgeUnit}>kcal</Text>
                      </View>
                    </View>
                    <View style={styles.mealHeroBottom}>
                      <Text style={styles.mealHeroName}>{m.name}</Text>
                      {m.description ? (
                        <Text style={styles.mealHeroDesc} numberOfLines={2}>{m.description}</Text>
                      ) : null}
                      <View style={styles.macroRow}>
                        <MacroPill v={m.protein_g} unit="P" color={COLORS.protein} />
                        <MacroPill v={m.carbs_g} unit="G" color={COLORS.carbs} />
                        <MacroPill v={m.fat_g} unit="L" color={COLORS.fat} />
                      </View>
                    </View>
                  </View>
                </FadeInUp>
              );
            })}

            <FadeInUp delay={520}>
              <BouncyPressable
                testID="plan-regenerate"
                onPress={() => generate(true)}
                disabled={generating}
                hapticStyle="medium"
                style={styles.regenBtn}
              >
                {generating ? (
                  <ActivityIndicator color={COLORS.brandPrimary} />
                ) : (
                  <>
                    <Ionicons name="refresh" size={18} color={COLORS.brandPrimary} />
                    <Text style={{ color: COLORS.brandPrimary, fontWeight: '700' }}>
                      Régénérer un nouveau plan
                    </Text>
                  </>
                )}
              </BouncyPressable>
            </FadeInUp>
          </ScrollView>
        </>
      ) : (
        <View style={styles.emptyWrap}>
          <FadeInUp delay={80}>
            <View style={styles.emptyHero}>
              <Image
                source={{ uri: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800&q=80' }}
                style={StyleSheet.absoluteFill as any}
                contentFit="cover"
              />
              <LinearGradient
                colors={['rgba(255,255,255,0)', 'rgba(249,249,247,0.4)', COLORS.surface]}
                style={StyleSheet.absoluteFill}
              />
            </View>
          </FadeInUp>
          <FadeInUp delay={200}>
            <View style={styles.emptyContent}>
              <View style={styles.emptyIconWrap}>
                <Ionicons name="restaurant" size={32} color={COLORS.brandPrimary} />
              </View>
              <Text style={styles.emptyTitle}>Ton plan sur-mesure</Text>
              <Text style={styles.emptyText}>
                Un menu de 7 jours généré par IA, ajusté à tes macros et à la saison — et renouvelé automatiquement chaque lundi.
              </Text>
              <BouncyPressable
                testID="plan-generate-button"
                onPress={() => generate(false)}
                disabled={generating}
                hapticStyle="medium"
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
              </BouncyPressable>
            </View>
          </FadeInUp>
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
        <Text style={{ fontWeight: '800', color: '#fff' }}>{Math.round(v || 0)}g </Text>
        <Text style={{ color: 'rgba(255,255,255,0.7)' }}>{unit}</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface },
  header: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 12 },
  eyebrow: { fontSize: 12, color: COLORS.brandPrimary, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  title: { fontSize: 30, fontWeight: '800', color: COLORS.text, letterSpacing: -0.5, marginTop: 4 },
  subtitle: { fontSize: 14, color: COLORS.textMuted, marginTop: 4 },

  refreshBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 8,
    backgroundColor: COLORS.brandSecondary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
  },
  refreshBannerText: { fontSize: 12, color: COLORS.brandPrimary, fontWeight: '700' },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 8,
    backgroundColor: '#FFE9E7', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
  },
  errorBannerText: { fontSize: 12, color: COLORS.error, fontWeight: '700', flex: 1 },
  loadingCard: {
    alignItems: 'center', paddingHorizontal: 40, gap: 12,
  },
  loadingTitle: { fontSize: 16, fontWeight: '800', color: COLORS.text, marginTop: 8 },
  loadingText: { fontSize: 13, color: COLORS.textMuted, textAlign: 'center', lineHeight: 18 },

  daysRow: { paddingHorizontal: 16, gap: 8, alignItems: 'center', height: 60 },
  dayChip: {
    flexShrink: 0, height: 40, paddingHorizontal: 18, borderRadius: 999,
    backgroundColor: COLORS.brandTertiary, alignItems: 'center', justifyContent: 'center',
  },
  dayChipActive: {
    backgroundColor: COLORS.brandPrimary,
    ...Platform.select({
      ios: { shadowColor: COLORS.brandPrimary, shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 2 },
    }),
  },
  dayText: { fontSize: 13, fontWeight: '700', color: COLORS.brandPrimary },
  dayTextActive: { color: '#fff' },

  daySummary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 4, marginBottom: 16,
  },
  daySummaryLabel: { fontSize: 12, color: COLORS.textMuted, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  daySummaryValue: { fontSize: 28, fontWeight: '800', color: COLORS.text, marginTop: 4, fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  daySummaryChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.brandSecondary,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
  },
  daySummaryChipText: { fontSize: 11, color: COLORS.brandPrimary, fontWeight: '800' },

  mealHero: {
    height: 200, borderRadius: 20, overflow: 'hidden', marginBottom: 14, justifyContent: 'space-between',
  },
  mealHeroTop: { flexDirection: 'row', justifyContent: 'space-between', padding: 14 },
  mealCatBadge: {
    backgroundColor: 'rgba(255,255,255,0.95)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
  },
  mealCatBadgeText: { fontSize: 11, fontWeight: '800', color: COLORS.text },
  mealCalBadge: {
    backgroundColor: 'rgba(255,255,255,0.95)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12,
    alignItems: 'center', minWidth: 62,
  },
  mealCalBadgeText: { fontSize: 18, fontWeight: '800', color: COLORS.text, fontVariant: ['tabular-nums'] },
  mealCalBadgeUnit: { fontSize: 9, color: COLORS.textMuted, fontWeight: '700', marginTop: -3 },
  mealHeroBottom: { padding: 16 },
  mealHeroName: { fontSize: 20, fontWeight: '800', color: '#fff', letterSpacing: -0.3 },
  mealHeroDesc: { fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 4, lineHeight: 17 },
  macroRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
  },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 12 },

  regenBtn: {
    marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 16, backgroundColor: COLORS.brandSecondary, borderRadius: 999,
  },

  emptyWrap: { flex: 1 },
  emptyHero: { height: 240 },
  emptyContent: { alignItems: 'center', paddingHorizontal: 32, gap: 10, marginTop: -40 },
  emptyIconWrap: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
      android: { elevation: 3 },
    }),
  },
  emptyTitle: { fontSize: 24, fontWeight: '800', color: COLORS.text, marginTop: 12, letterSpacing: -0.5 },
  emptyText: { fontSize: 14, color: COLORS.textMuted, textAlign: 'center', lineHeight: 20, paddingHorizontal: 12 },
  genCta: {
    marginTop: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: COLORS.brandPrimary, paddingHorizontal: 32, paddingVertical: 18, borderRadius: 999,
    ...Platform.select({
      ios: { shadowColor: COLORS.brandPrimary, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
      android: { elevation: 4 },
    }),
  },
  genCtaText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
