import { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { api, COLORS } from '@/src/lib/api';
import { storage } from '@/src/lib/storage';
import { AnimatedProgressRing, AnimatedMacroBar } from '@/src/components/nutrition';
import { BouncyPressable, FadeInUp } from '@/src/components/motion';
import { fallbackFoodImage } from '@/src/lib/images';

const CATEGORIES: { k: 'breakfast' | 'lunch' | 'dinner' | 'snack'; l: string; i: string; emoji: string }[] = [
  { k: 'breakfast', l: 'Petit-déjeuner', i: 'sunny-outline', emoji: '☀️' },
  { k: 'lunch', l: 'Déjeuner', i: 'restaurant-outline', emoji: '🍽️' },
  { k: 'dinner', l: 'Dîner', i: 'moon-outline', emoji: '🌙' },
  { k: 'snack', l: 'Snacks', i: 'cafe-outline', emoji: '🍎' },
];

function greetingFor(hour: number): { greeting: string; emoji: string } {
  if (hour < 11) return { greeting: 'Bon matin', emoji: '☀️' };
  if (hour < 15) return { greeting: 'Bon appétit', emoji: '🍽️' };
  if (hour < 19) return { greeting: 'Bel après-midi', emoji: '✨' };
  return { greeting: 'Bonne soirée', emoji: '🌙' };
}

export default function HomeScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<any>(null);
  const [meals, setMeals] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
  const [streak, setStreak] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const id = await storage.getUserId();
    if (!id) {
      router.replace('/onboarding');
      return;
    }
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [p, m, s, prog] = await Promise.all([
        api.getProfile(id),
        api.listMeals(id, today),
        api.dailySummary(id),
        api.progress(id, 7),
      ]);
      setProfile(p);
      setMeals(m);
      setSummary(s);
      // streak = trailing days with >=1 meal ending today
      let count = 0;
      const days = [...(prog.days || [])].reverse();
      for (const d of days) {
        if ((d.calories ?? 0) > 0) count += 1;
        else break;
      }
      setStreak(count);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleDelete = async (id: string) => {
    await api.deleteMeal(id);
    load();
  };

  const grouped = useMemo(() => {
    const g: Record<string, any[]> = { breakfast: [], lunch: [], dinner: [], snack: [] };
    meals.forEach((m) => { (g[m.category] ||= []).push(m); });
    return g;
  }, [meals]);

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={COLORS.brandPrimary} />
      </SafeAreaView>
    );
  }

  const target = profile?.daily_calories ?? 2000;
  const consumed = Math.round(summary.calories ?? 0);
  const remaining = Math.max(0, target - consumed);
  const progress = target > 0 ? consumed / target : 0;
  const { greeting, emoji } = greetingFor(new Date().getHours());
  const totalMeals = meals.length;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="home-screen">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.brandPrimary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <FadeInUp delay={0}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.eyebrow}>{greeting} {emoji}</Text>
              <Text style={styles.greeting} testID="home-greeting">{profile?.name}</Text>
              <Text style={styles.dateText}>
                {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
              </Text>
            </View>
            {streak > 0 && (
              <View style={styles.streakBadge} testID="streak-badge">
                <Text style={styles.streakEmoji}>🔥</Text>
                <View>
                  <Text style={styles.streakValue}>{streak}</Text>
                  <Text style={styles.streakLabel}>jours</Text>
                </View>
              </View>
            )}
          </View>
        </FadeInUp>

        {/* Ring + macros hero */}
        <FadeInUp delay={80}>
          <View style={styles.heroCard} testID="daily-hero-card">
            <LinearGradient
              colors={[COLORS.brandTertiary, COLORS.surface2]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={{ alignItems: 'center', marginBottom: 20 }}>
              <AnimatedProgressRing progress={progress} size={200} stroke={18}>
                <Text style={styles.ringValue} testID="calories-consumed">{consumed}</Text>
                <Text style={styles.ringLabel}>consommées</Text>
                <View style={styles.ringChip}>
                  <Text style={styles.ringChipText}>{remaining} kcal restant</Text>
                </View>
              </AnimatedProgressRing>
            </View>

            <AnimatedMacroBar label="Protéines" value={summary.protein_g} target={profile?.protein_g ?? 100} color={COLORS.protein} delay={200} />
            <AnimatedMacroBar label="Glucides" value={summary.carbs_g} target={profile?.carbs_g ?? 200} color={COLORS.carbs} delay={300} />
            <AnimatedMacroBar label="Lipides" value={summary.fat_g} target={profile?.fat_g ?? 60} color={COLORS.fat} delay={400} />
          </View>
        </FadeInUp>

        {/* Scan CTA */}
        <FadeInUp delay={160}>
          <BouncyPressable
            testID="home-scan-cta"
            onPress={() => router.push('/(tabs)/scan')}
            hapticStyle="medium"
            style={styles.scanCta}
          >
            <View style={styles.scanCtaIcon}>
              <Ionicons name="sparkles" size={18} color={COLORS.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.scanCtaTitle}>Scanner un repas</Text>
              <Text style={styles.scanCtaSub}>L'IA analyse tout en 3 secondes</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color="#fff" />
          </BouncyPressable>
        </FadeInUp>

        {/* Meals */}
        <FadeInUp delay={220}>
          <View style={styles.mealsSectionHead}>
            <Text style={styles.sectionTitle}>Repas d'aujourd'hui</Text>
            <Text style={styles.sectionCount}>
              {totalMeals} {totalMeals > 1 ? 'repas' : 'repas'}
            </Text>
          </View>
        </FadeInUp>

        {totalMeals === 0 ? (
          <FadeInUp delay={260}>
            <View style={styles.emptyBox} testID="home-empty">
              <Text style={styles.emptyEmoji}>🥗</Text>
              <Text style={styles.emptyTitle}>Aucun repas encore</Text>
              <Text style={styles.emptyDesc}>
                Ton premier scan te donnera un aperçu détaillé de tes apports.
              </Text>
            </View>
          </FadeInUp>
        ) : (
          CATEGORIES.map((cat, catIdx) => {
            const items = grouped[cat.k] || [];
            if (items.length === 0) return null;
            return (
              <FadeInUp key={cat.k} delay={260 + catIdx * 60}>
                <View style={styles.categoryBlock} testID={`meal-category-${cat.k}`}>
                  <View style={styles.categoryHead}>
                    <Text style={styles.categoryTitle}>
                      <Text>{cat.emoji}</Text> {cat.l}
                    </Text>
                    <Text style={styles.categoryCount}>{items.length}</Text>
                  </View>
                  {items.map((m) => (
                    <View key={m.id} style={styles.mealCard} testID={`meal-card-${m.id}`}>
                      <Image
                        source={{ uri: m.image_base64 ? `data:image/jpeg;base64,${m.image_base64}` : fallbackFoodImage(m.name) }}
                        style={styles.mealThumb}
                        contentFit="cover"
                        transition={200}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.mealName} numberOfLines={1}>{m.name}</Text>
                        <Text style={styles.mealPortion}>{m.portion}</Text>
                        <View style={styles.mealMacros}>
                          <MacroDot color={COLORS.protein} v={m.protein_g} u="P" />
                          <MacroDot color={COLORS.carbs} v={m.carbs_g} u="G" />
                          <MacroDot color={COLORS.fat} v={m.fat_g} u="L" />
                        </View>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.mealCals}>{m.calories}</Text>
                        <Text style={styles.mealCalsLabel}>kcal</Text>
                        <BouncyPressable
                          onPress={() => handleDelete(m.id)}
                          hapticStyle="selection"
                          style={{ marginTop: 6, padding: 4 }}
                          testID={`meal-delete-${m.id}`}
                          hitSlop={12}
                        >
                          <Ionicons name="close-circle" size={22} color={COLORS.textMuted} />
                        </BouncyPressable>
                      </View>
                    </View>
                  ))}
                </View>
              </FadeInUp>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function MacroDot({ color, v, u }: { color: string; v: number; u: string }) {
  return (
    <View style={styles.macroDotBox}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.macroDotText}>
        <Text style={{ fontWeight: '700', color: COLORS.text }}>{Math.round(v)}</Text>
        <Text style={{ color: COLORS.textMuted }}>{u}</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface },
  header: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 20, flexDirection: 'row', alignItems: 'flex-start' },
  eyebrow: { fontSize: 14, color: COLORS.brandPrimary, fontWeight: '600', marginBottom: 2 },
  greeting: { fontSize: 32, fontWeight: '800', color: COLORS.text, letterSpacing: -0.5 },
  dateText: { fontSize: 13, color: COLORS.textMuted, marginTop: 4, textTransform: 'capitalize' },
  streakBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.text,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999,
  },
  streakEmoji: { fontSize: 20 },
  streakValue: { color: '#fff', fontWeight: '800', fontSize: 15, fontVariant: ['tabular-nums'], lineHeight: 16 },
  streakLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '600' },

  heroCard: {
    marginHorizontal: 16, borderRadius: 24, padding: 24, overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 20, shadowOffset: { width: 0, height: 6 } },
      android: { elevation: 2 },
    }),
    backgroundColor: COLORS.surface2,
  },
  ringValue: { fontSize: 42, fontWeight: '800', color: COLORS.text, fontVariant: ['tabular-nums'], letterSpacing: -1 },
  ringLabel: { fontSize: 12, color: COLORS.textMuted, marginTop: -2 },
  ringChip: {
    marginTop: 8, backgroundColor: COLORS.brandSecondary, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  ringChipText: { color: COLORS.brandPrimary, fontSize: 11, fontWeight: '700' },

  scanCta: {
    marginHorizontal: 16, marginTop: 16, backgroundColor: COLORS.brandPrimary, borderRadius: 20,
    padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14,
    ...Platform.select({
      ios: { shadowColor: COLORS.brandPrimary, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
      android: { elevation: 4 },
    }),
  },
  scanCtaIcon: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  scanCtaTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  scanCtaSub: { color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 2 },

  mealsSectionHead: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    paddingHorizontal: 24, marginTop: 32, marginBottom: 12,
  },
  sectionTitle: { fontSize: 20, fontWeight: '800', color: COLORS.text, letterSpacing: -0.3 },
  sectionCount: { fontSize: 12, color: COLORS.textMuted, fontWeight: '600' },

  emptyBox: {
    marginHorizontal: 16, padding: 32, borderRadius: 20, backgroundColor: COLORS.surface2,
    alignItems: 'center', borderStyle: 'dashed', borderWidth: 1.5, borderColor: COLORS.border,
  },
  emptyEmoji: { fontSize: 40, marginBottom: 12 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  emptyDesc: { fontSize: 13, color: COLORS.textMuted, textAlign: 'center', marginTop: 6, lineHeight: 18 },

  categoryBlock: { marginHorizontal: 16, marginBottom: 20 },
  categoryHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 10, paddingHorizontal: 4,
  },
  categoryTitle: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  categoryCount: {
    fontSize: 11, color: COLORS.textMuted, backgroundColor: COLORS.brandTertiary,
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden', fontWeight: '700',
  },
  mealCard: {
    flexDirection: 'row', backgroundColor: COLORS.surface2, borderRadius: 16,
    padding: 12, marginBottom: 8, gap: 12, alignItems: 'center',
  },
  mealThumb: { width: 60, height: 60, borderRadius: 14, backgroundColor: COLORS.brandTertiary },
  mealName: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  mealPortion: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  mealMacros: { flexDirection: 'row', gap: 12, marginTop: 8 },
  macroDotBox: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  macroDotText: { fontSize: 11 },
  mealCals: { fontSize: 20, fontWeight: '800', color: COLORS.text, fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  mealCalsLabel: { fontSize: 10, color: COLORS.textMuted, marginTop: -2 },
});
