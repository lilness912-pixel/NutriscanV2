import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { api, COLORS } from '@/src/lib/api';
import { useAuth } from '@/src/lib/auth';
import { BouncyPressable, FadeInUp } from '@/src/components/motion';

const HERO = 'https://images.unsplash.com/photo-1558017487-06bf9f82613a?crop=entropy&cs=srgb&fm=jpg&w=1200&q=85';

type Step = 0 | 1 | 2 | 3 | 4 | 5;

export default function Onboarding() {
  const router = useRouter();
  const { refreshUser } = useAuth();
  const [step, setStep] = useState<Step>(0);
  const [name, setName] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | 'other' | null>(null);
  const [age, setAge] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [activity, setActivity] = useState<string | null>(null);
  const [goal, setGoal] = useState<'lose' | 'maintain' | 'gain' | null>(null);
  const [loading, setLoading] = useState(false);

  const totalSteps = 6;
  const progress = ((step + 1) / totalSteps) * 100;

  const next = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep((s) => (s + 1) as Step);
  };
  const back = () => {
    Haptics.selectionAsync();
    setStep((s) => Math.max(0, s - 1) as Step);
  };

  const canProceed = () => {
    if (step === 0) return name.trim().length > 0;
    if (step === 1) return !!gender && !!age && parseInt(age) > 0;
    if (step === 2) return !!height && parseFloat(height) > 0 && !!weight && parseFloat(weight) > 0;
    if (step === 3) return !!activity;
    if (step === 4) return !!goal;
    return true;
  };

  const finish = async () => {
    setLoading(true);
    try {
      await api.createProfile({
        name: name.trim(),
        age: parseInt(age),
        gender,
        height_cm: parseFloat(height),
        weight_kg: parseFloat(weight),
        activity,
        goal,
      });
      await refreshUser();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)');
    } catch (e: any) {
      console.error(e);
      setLoading(false);
    }
  };

  return (
    <View style={styles.root} testID="onboarding-screen">
      <Image source={HERO} style={StyleSheet.absoluteFill as any} contentFit="cover" />
      <LinearGradient
        colors={['rgba(0,0,0,0.65)', 'rgba(0,0,0,0.75)', 'rgba(10,10,10,0.95)']}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <View style={styles.progressWrap}>
            {step > 0 && (
              <Pressable onPress={back} testID="onboarding-back-button" hitSlop={16}>
                <Ionicons name="chevron-back" size={24} color="#fff" />
              </Pressable>
            )}
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${progress}%` }]} />
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <FadeInUp key={step} delay={0} distance={24}>
            {step === 0 && (
              <View>
                <Text style={styles.eyebrow}>Bienvenue sur Nutriscan</Text>
                <Text style={styles.question}>Comment doit-on t'appeler ?</Text>
                <TextInput
                  testID="onboarding-name-input"
                  style={styles.input}
                  placeholder="Ton prénom"
                  placeholderTextColor="rgba(255,255,255,0.5)"
                  value={name}
                  onChangeText={setName}
                  autoFocus
                />
              </View>
            )}

            {step === 1 && (
              <View>
                <Text style={styles.eyebrow}>À propos de toi</Text>
                <Text style={styles.question}>Quel est ton genre et âge ?</Text>
                <View style={styles.rowChoices}>
                  {(['male', 'female', 'other'] as const).map((g) => (
                    <Pressable
                      key={g}
                      testID={`onboarding-gender-${g}`}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setGender(g);
                      }}
                      style={[styles.choiceChip, gender === g && styles.choiceChipActive]}
                    >
                      <Text style={[styles.choiceText, gender === g && styles.choiceTextActive]}>
                        {g === 'male' ? 'Homme' : g === 'female' ? 'Femme' : 'Autre'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  testID="onboarding-age-input"
                  style={[styles.input, { marginTop: 16 }]}
                  placeholder="Âge (années)"
                  placeholderTextColor="rgba(255,255,255,0.5)"
                  keyboardType="number-pad"
                  value={age}
                  onChangeText={setAge}
                />
              </View>
            )}

            {step === 2 && (
              <View>
                <Text style={styles.eyebrow}>Ta morphologie</Text>
                <Text style={styles.question}>Taille et poids</Text>
                <TextInput
                  testID="onboarding-height-input"
                  style={styles.input}
                  placeholder="Taille (cm)"
                  placeholderTextColor="rgba(255,255,255,0.5)"
                  keyboardType="decimal-pad"
                  value={height}
                  onChangeText={setHeight}
                />
                <TextInput
                  testID="onboarding-weight-input"
                  style={[styles.input, { marginTop: 12 }]}
                  placeholder="Poids (kg)"
                  placeholderTextColor="rgba(255,255,255,0.5)"
                  keyboardType="decimal-pad"
                  value={weight}
                  onChangeText={setWeight}
                />
              </View>
            )}

            {step === 3 && (
              <View>
                <Text style={styles.eyebrow}>Niveau d'activité</Text>
                <Text style={styles.question}>Quelle est ton activité physique ?</Text>
                {[
                  { k: 'sedentary', l: 'Sédentaire', d: 'Peu ou pas d\'exercice' },
                  { k: 'light', l: 'Léger', d: '1-3 séances / semaine' },
                  { k: 'moderate', l: 'Modéré', d: '3-5 séances / semaine' },
                  { k: 'active', l: 'Actif', d: '6-7 séances / semaine' },
                  { k: 'very_active', l: 'Très actif', d: 'Sport intense quotidien' },
                ].map((a) => (
                  <Pressable
                    key={a.k}
                    testID={`onboarding-activity-${a.k}`}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setActivity(a.k);
                    }}
                    style={[styles.card, activity === a.k && styles.cardActive]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>{a.l}</Text>
                      <Text style={styles.cardDesc}>{a.d}</Text>
                    </View>
                    {activity === a.k && (
                      <Ionicons name="checkmark-circle" size={22} color={COLORS.brand} />
                    )}
                  </Pressable>
                ))}
              </View>
            )}

            {step === 4 && (
              <View>
                <Text style={styles.eyebrow}>Ton objectif</Text>
                <Text style={styles.question}>Que veux-tu accomplir ?</Text>
                {[
                  { k: 'lose', l: 'Perdre du poids', d: '-500 kcal / jour', i: 'trending-down' },
                  { k: 'maintain', l: 'Maintenir', d: 'Rester en forme', i: 'remove-outline' },
                  { k: 'gain', l: 'Prendre du muscle', d: '+400 kcal / jour', i: 'trending-up' },
                ].map((g) => (
                  <Pressable
                    key={g.k}
                    testID={`onboarding-goal-${g.k}`}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setGoal(g.k as any);
                    }}
                    style={[styles.card, goal === g.k && styles.cardActive]}
                  >
                    <Ionicons name={g.i as any} size={22} color="#fff" style={{ marginRight: 12 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>{g.l}</Text>
                      <Text style={styles.cardDesc}>{g.d}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}

            {step === 5 && (
              <View>
                <Text style={styles.eyebrow}>Presque prêt</Text>
                <Text style={styles.question}>Ton plan personnalisé</Text>
                <Text style={styles.summary}>
                  Bonjour {name} 👋{'\n\n'}
                  Nous allons calculer tes besoins caloriques et macronutriments basés sur ton profil
                  ({age} ans, {height}cm, {weight}kg). Ton IA nutrition va t'aider à atteindre ton
                  objectif de{' '}
                  {goal === 'lose' ? 'perdre du poids' : goal === 'gain' ? 'prendre du muscle' : 'maintenir ta forme'}.
                </Text>
              </View>
            )}
            </FadeInUp>
          </ScrollView>

          <View style={styles.footer}>
            <BouncyPressable
              testID="onboarding-continue-button"
              onPress={step === 5 ? finish : next}
              disabled={!canProceed() || loading}
              hapticStyle="medium"
              style={[styles.cta, (!canProceed() || loading) && styles.ctaDisabled]}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Text style={styles.ctaText}>
                    {step === 5 ? "C'est parti" : 'Continuer'}
                  </Text>
                  <Ionicons name={step === 5 ? 'sparkles' : 'arrow-forward'} size={18} color="#fff" style={{ marginLeft: 6 }} />
                </>
              )}
            </BouncyPressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  progressWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 8,
    gap: 12,
  },
  progressBar: {
    flex: 1,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: COLORS.brand, borderRadius: 2 },
  content: { padding: 24, paddingTop: 32, flexGrow: 1 },
  eyebrow: { color: COLORS.brand, fontSize: 14, fontWeight: '600', marginBottom: 8, letterSpacing: 0.5 },
  question: { color: '#fff', fontSize: 32, fontWeight: '700', marginBottom: 32, lineHeight: 38 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 12,
    padding: 16,
    color: '#fff',
    fontSize: 18,
  },
  rowChoices: { flexDirection: 'row', gap: 8 },
  choiceChip: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
  },
  choiceChipActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  choiceText: { color: '#fff', fontWeight: '600' },
  choiceTextActive: { color: '#fff' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    marginBottom: 10,
  },
  cardActive: { borderColor: COLORS.brand, backgroundColor: 'rgba(107,142,107,0.2)' },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cardDesc: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginTop: 2 },
  summary: { color: 'rgba(255,255,255,0.9)', fontSize: 16, lineHeight: 24 },
  footer: { padding: 24, paddingTop: 12 },
  cta: {
    backgroundColor: COLORS.brandPrimary,
    borderRadius: 999,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
