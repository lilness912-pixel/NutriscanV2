import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { api, COLORS } from '@/src/lib/api';
import { storage } from '@/src/lib/storage';
import { ProgressRing, MacroBar } from '@/src/components/nutrition';

const CATEGORIES: { k: 'breakfast' | 'lunch' | 'dinner' | 'snack'; l: string; i: string }[] = [
  { k: 'breakfast', l: 'Petit-déjeuner', i: 'sunny-outline' },
  { k: 'lunch', l: 'Déjeuner', i: 'restaurant-outline' },
  { k: 'dinner', l: 'Dîner', i: 'moon-outline' },
  { k: 'snack', l: 'Snacks', i: 'cafe-outline' },
];

export default function HomeScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<any>(null);
  const [meals, setMeals] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const id = await storage.getUserId();
    if (!id) {
      router.replace('/onboarding');
      return;
    }
    try {
      const [p, m, s] = await Promise.all([
        api.getProfile(id),
        api.listMeals(id, new Date().toISOString().slice(0, 10)),
        api.dailySummary(id),
      ]);
      setProfile(p);
      setMeals(m);
      setSummary(s);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleDelete = async (id: string) => {
    await api.deleteMeal(id);
    load();
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={COLORS.brandPrimary} />
      </SafeAreaView>
    );
  }

  const target = profile?.daily_calories ?? 2000;
  const consumed = summary.calories ?? 0;
  const remaining = Math.max(0, target - consumed);
  const progress = target > 0 ? consumed / target : 0;

  const grouped: Record<string, any[]> = { breakfast: [], lunch: [], dinner: [], snack: [] };
  meals.forEach((m) => {
    (grouped[m.category] ||= []).push(m);
  });

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="home-screen">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Salut, {profile?.name} 👋</Text>
            <Text style={styles.dateText}>
              {new Date().toLocaleDateString('fr-FR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </Text>
          </View>
        </View>

        {/* Ring + macros hero */}
        <View style={styles.heroCard} testID="daily-hero-card">
          <View style={{ alignItems: 'center', marginBottom: 16 }}>
            <ProgressRing progress={progress} size={190} stroke={16}>
              <Text style={styles.ringValue} testID="calories-consumed">
                {Math.round(consumed)}
              </Text>
              <Text style={styles.ringLabel}>/ {target} kcal</Text>
              <Text style={styles.ringSub}>{Math.round(remaining)} restant</Text>
            </ProgressRing>
          </View>

          <MacroBar
            label="Protéines"
            value={summary.protein_g}
            target={profile?.protein_g ?? 100}
            color={COLORS.protein}
          />
          <MacroBar
            label="Glucides"
            value={summary.carbs_g}
            target={profile?.carbs_g ?? 200}
            color={COLORS.carbs}
          />
          <MacroBar
            label="Lipides"
            value={summary.fat_g}
            target={profile?.fat_g ?? 60}
            color={COLORS.fat}
          />
        </View>

        {/* Quick action */}
        <Pressable
          testID="home-scan-cta"
          onPress={() => router.push('/(tabs)/scan')}
          style={styles.scanCta}
        >
          <Ionicons name="camera" size={22} color="#fff" />
          <Text style={styles.scanCtaText}>Scanner un repas</Text>
        </Pressable>

        {/* Meals */}
        <Text style={styles.sectionTitle}>Repas d'aujourd'hui</Text>

        {CATEGORIES.map((cat) => {
          const items = grouped[cat.k] || [];
          return (
            <View key={cat.k} style={styles.categoryBlock} testID={`meal-category-${cat.k}`}>
              <View style={styles.categoryHead}>
                <Ionicons name={cat.i as any} size={18} color={COLORS.brandPrimary} />
                <Text style={styles.categoryTitle}>{cat.l}</Text>
                <Text style={styles.categoryCount}>{items.length}</Text>
              </View>
              {items.length === 0 ? (
                <Text style={styles.emptyText}>Aucun repas ajouté</Text>
              ) : (
                items.map((m) => (
                  <View key={m.id} style={styles.mealCard} testID={`meal-card-${m.id}`}>
                    {m.image_base64 ? (
                      <Image
                        source={{ uri: `data:image/jpeg;base64,${m.image_base64}` }}
                        style={styles.mealThumb}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={[styles.mealThumb, { backgroundColor: COLORS.brandTertiary }]}>
                        <Ionicons name="restaurant" size={22} color={COLORS.brand} />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.mealName} numberOfLines={1}>
                        {m.name}
                      </Text>
                      <Text style={styles.mealPortion}>{m.portion}</Text>
                      <View style={styles.mealMacros}>
                        <Text style={styles.mealMacro}>
                          <Text style={{ color: COLORS.protein, fontWeight: '700' }}>
                            {Math.round(m.protein_g)}
                          </Text>
                          P
                        </Text>
                        <Text style={styles.mealMacro}>
                          <Text style={{ color: COLORS.carbs, fontWeight: '700' }}>
                            {Math.round(m.carbs_g)}
                          </Text>
                          G
                        </Text>
                        <Text style={styles.mealMacro}>
                          <Text style={{ color: COLORS.fat, fontWeight: '700' }}>
                            {Math.round(m.fat_g)}
                          </Text>
                          L
                        </Text>
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.mealCals}>{m.calories}</Text>
                      <Text style={styles.mealCalsLabel}>kcal</Text>
                      <Pressable
                        onPress={() => handleDelete(m.id)}
                        hitSlop={12}
                        testID={`meal-delete-${m.id}`}
                      >
                        <Ionicons
                          name="close-circle"
                          size={20}
                          color={COLORS.textMuted}
                          style={{ marginTop: 4 }}
                        />
                      </Pressable>
                    </View>
                  </View>
                ))
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface },
  header: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 16 },
  greeting: { fontSize: 28, fontWeight: '700', color: COLORS.text },
  dateText: { fontSize: 14, color: COLORS.textMuted, marginTop: 4, textTransform: 'capitalize' },
  heroCard: {
    backgroundColor: COLORS.surface2,
    marginHorizontal: 16,
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  ringValue: { fontSize: 36, fontWeight: '700', color: COLORS.text, fontVariant: ['tabular-nums'] },
  ringLabel: { fontSize: 13, color: COLORS.textMuted, marginTop: 2 },
  ringSub: { fontSize: 12, color: COLORS.brandPrimary, marginTop: 6, fontWeight: '600' },
  scanCta: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: COLORS.brandPrimary,
    borderRadius: 999,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  scanCtaText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 28,
    marginHorizontal: 24,
    marginBottom: 12,
  },
  categoryBlock: { marginHorizontal: 16, marginBottom: 16 },
  categoryHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    paddingHorizontal: 8,
  },
  categoryTitle: { fontSize: 15, fontWeight: '600', color: COLORS.text, flex: 1 },
  categoryCount: {
    fontSize: 12,
    color: COLORS.textMuted,
    backgroundColor: COLORS.brandTertiary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
  },
  emptyText: { fontSize: 13, color: COLORS.textMuted, paddingHorizontal: 12, paddingVertical: 8 },
  mealCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface2,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    gap: 12,
    alignItems: 'center',
  },
  mealThumb: {
    width: 56,
    height: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealName: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  mealPortion: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  mealMacros: { flexDirection: 'row', gap: 10, marginTop: 6 },
  mealMacro: { fontSize: 11, color: COLORS.textMuted },
  mealCals: { fontSize: 18, fontWeight: '700', color: COLORS.text, fontVariant: ['tabular-nums'] },
  mealCalsLabel: { fontSize: 10, color: COLORS.textMuted },
});
