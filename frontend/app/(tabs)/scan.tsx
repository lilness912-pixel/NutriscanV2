import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ActivityIndicator,
  ScrollView,
  Alert,
  TextInput,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import { api, COLORS } from '@/src/lib/api';
import { storage } from '@/src/lib/storage';
import { BouncyPressable, FadeInUp } from '@/src/components/motion';

type ScanResult = {
  name: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  portion: string;
  confidence: number;
  ingredients: string[];
};

function ScanReticle() {
  const y = useSharedValue(0);
  const pulse = useSharedValue(0);

  useEffect(() => {
    y.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.quad) }), -1, true);
    pulse.value = withRepeat(withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [y, pulse]);

  const lineStyle = useAnimatedStyle(() => ({
    top: `${interpolate(y.value, [0, 1], [10, 90])}%`,
    opacity: interpolate(y.value, [0, 0.1, 0.9, 1], [0, 1, 1, 0]),
  }));

  const frameStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.6, 1]),
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View style={[styles.reticleFrame, frameStyle]}>
        <View style={[styles.corner, styles.cornerTL]} />
        <View style={[styles.corner, styles.cornerTR]} />
        <View style={[styles.corner, styles.cornerBL]} />
        <View style={[styles.corner, styles.cornerBR]} />
      </Animated.View>
      <Animated.View style={[styles.scanLine, lineStyle]}>
        <LinearGradient
          colors={['transparent', 'rgba(107,142,107,0.9)', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.scanLineGrad}
        />
      </Animated.View>
    </View>
  );
}

export default function ScanScreen() {
  const router = useRouter();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [category, setCategory] = useState<'breakfast' | 'lunch' | 'dinner' | 'snack'>('lunch');
  const [saving, setSaving] = useState(false);

  const pickFrom = async (source: 'camera' | 'library') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission requise', "Autorise l'accès à l'appareil photo.");
        return;
      }
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission requise', "Autorise l'accès à la galerie.");
        return;
      }
    }
    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'] as any,
      quality: 0.6,
      base64: true,
      allowsEditing: false,
    };
    const res = source === 'camera'
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    setImageUri(asset.uri);
    setImageBase64(asset.base64 || null);
    setResult(null);
    // Auto-analyze right away
    setTimeout(() => analyze(asset.base64 || null), 300);
  };

  const analyze = async (b64?: string | null) => {
    const payload = b64 || imageBase64;
    if (!payload) return;
    const uid = await storage.getUserId();
    if (!uid) return;
    setAnalyzing(true);
    try {
      const r: ScanResult = await api.scanMeal(uid, payload);
      setResult(r);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const h = new Date().getHours();
      setCategory(h < 11 ? 'breakfast' : h < 15 ? 'lunch' : h < 20 ? 'dinner' : 'snack');
    } catch (e: any) {
      Alert.alert('Erreur', "L'IA n'a pas pu analyser cette photo. Réessaie.");
      console.error(e);
    } finally {
      setAnalyzing(false);
    }
  };

  const updateField = (k: keyof ScanResult, v: string) => {
    if (!result) return;
    if (k === 'name' || k === 'portion') setResult({ ...result, [k]: v });
    else setResult({ ...result, [k]: parseFloat(v) || 0 } as any);
  };

  const save = async () => {
    if (!result) return;
    const uid = await storage.getUserId();
    if (!uid) return;
    setSaving(true);
    try {
      await api.createMeal({
        user_id: uid, name: result.name, calories: Math.round(result.calories),
        protein_g: result.protein_g, carbs_g: result.carbs_g, fat_g: result.fat_g,
        portion: result.portion, category, image_base64: imageBase64,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResult(null);
      setImageUri(null);
      setImageBase64(null);
      router.push('/(tabs)');
    } catch (_) {
      Alert.alert('Erreur', "Impossible d'enregistrer le repas.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} testID="scan-screen">
      <FadeInUp delay={0}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>✨ IA Nutrition</Text>
          <Text style={styles.title}>Scanner un repas</Text>
          <Text style={styles.subtitle}>Une photo, et l'IA fait le reste</Text>
        </View>
      </FadeInUp>

      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 140 }}>
        <FadeInUp delay={100}>
          <View style={styles.previewBox}>
            {imageUri ? (
              <>
                <Image source={{ uri: imageUri }} style={styles.preview} contentFit="cover" transition={200} />
                {analyzing && (
                  <>
                    <View style={styles.analyzingOverlay} pointerEvents="none">
                      <LinearGradient colors={['rgba(0,0,0,0.3)', 'rgba(0,0,0,0.5)']} style={StyleSheet.absoluteFill} />
                    </View>
                    <ScanReticle />
                    <View style={styles.analyzingBadge}>
                      <ActivityIndicator color="#fff" size="small" />
                      <Text style={styles.analyzingText}>Analyse par l'IA…</Text>
                    </View>
                  </>
                )}
              </>
            ) : (
              <LinearGradient
                colors={[COLORS.brandSecondary, COLORS.surface2]}
                style={StyleSheet.absoluteFill}
              />
            )}
            {!imageUri && (
              <View style={styles.placeholder}>
                <View style={styles.placeholderIcon}>
                  <Ionicons name="fast-food" size={40} color={COLORS.brandPrimary} />
                </View>
                <Text style={styles.placeholderTitle}>Prêt à scanner</Text>
                <Text style={styles.placeholderText}>
                  Prends une photo nette de ton assiette{'\n'}pour un résultat précis
                </Text>
              </View>
            )}
          </View>
        </FadeInUp>

        <FadeInUp delay={160}>
          <View style={styles.actionsRow}>
            <BouncyPressable
              testID="scan-camera-button"
              onPress={() => pickFrom('camera')}
              hapticStyle="medium"
              style={[styles.actionBtn, styles.actionPrimary]}
            >
              <Ionicons name="camera" size={22} color="#fff" />
              <Text style={styles.actionTextLight}>Caméra</Text>
            </BouncyPressable>
            <BouncyPressable
              testID="scan-library-button"
              onPress={() => pickFrom('library')}
              hapticStyle="light"
              style={[styles.actionBtn, styles.actionSecondary]}
            >
              <Ionicons name="images" size={22} color={COLORS.brandPrimary} />
              <Text style={styles.actionTextDark}>Galerie</Text>
            </BouncyPressable>
          </View>
        </FadeInUp>

        <FadeInUp delay={220}>
          <View style={styles.tipCard}>
            <Text style={styles.tipTitle}>💡 Astuce</Text>
            <Text style={styles.tipText}>
              Cadre bien ton plat de dessus avec une bonne lumière naturelle pour une meilleure précision.
            </Text>
          </View>
        </FadeInUp>
      </ScrollView>

      {/* Result bottom sheet */}
      <Modal visible={!!result} transparent animationType="slide" onRequestClose={() => setResult(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.sheet} testID="scan-result-sheet">
            <View style={styles.sheetHandle} />
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
              <View style={styles.confidenceHead}>
                <View style={styles.confidencePill}>
                  <Ionicons name="sparkles" size={14} color={COLORS.brandPrimary} />
                  <Text style={styles.confidenceText}>
                    Confiance IA {result ? Math.round(result.confidence * 100) : 0}%
                  </Text>
                </View>
              </View>

              <Text style={styles.detected}>Détecté</Text>
              <TextInput
                testID="result-name-input"
                style={styles.detectedInput}
                value={result?.name}
                onChangeText={(v) => updateField('name', v)}
              />

              <Text style={styles.sheetLabel}>Portion</Text>
              <TextInput
                testID="result-portion-input"
                style={styles.sheetInput}
                value={result?.portion}
                onChangeText={(v) => updateField('portion', v)}
              />

              <View style={styles.macroGrid}>
                <MacroField label="Calories" value={result?.calories || 0} unit="kcal" onChange={(v) => updateField('calories', v)} testID="result-calories" accent={COLORS.brandPrimary} />
                <MacroField label="Protéines" value={result?.protein_g || 0} unit="g" onChange={(v) => updateField('protein_g', v)} testID="result-protein" accent={COLORS.protein} />
                <MacroField label="Glucides" value={result?.carbs_g || 0} unit="g" onChange={(v) => updateField('carbs_g', v)} testID="result-carbs" accent={COLORS.carbs} />
                <MacroField label="Lipides" value={result?.fat_g || 0} unit="g" onChange={(v) => updateField('fat_g', v)} testID="result-fat" accent={COLORS.fat} />
              </View>

              {result && result.ingredients?.length > 0 && (
                <>
                  <Text style={styles.sheetLabel}>Ingrédients détectés</Text>
                  <View style={styles.ingredientsWrap}>
                    {result.ingredients.map((ing, i) => (
                      <View key={i} style={styles.ingredientChip}>
                        <Text style={styles.ingredientText}>{ing}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}

              <Text style={styles.sheetLabel}>Catégorie</Text>
              <View style={styles.catRow}>
                {(['breakfast', 'lunch', 'dinner', 'snack'] as const).map((c) => (
                  <BouncyPressable
                    key={c}
                    testID={`result-cat-${c}`}
                    onPress={() => setCategory(c)}
                    hapticStyle="selection"
                    style={[styles.catChip, category === c && styles.catChipActive]}
                  >
                    <Text style={[styles.catChipText, category === c && styles.catChipTextActive]}>
                      {c === 'breakfast' ? 'P.déj' : c === 'lunch' ? 'Déj' : c === 'dinner' ? 'Dîner' : 'Snack'}
                    </Text>
                  </BouncyPressable>
                ))}
              </View>

              <View style={{ flexDirection: 'row', gap: 12, marginTop: 24 }}>
                <BouncyPressable
                  onPress={() => setResult(null)}
                  hapticStyle="selection"
                  style={[styles.sheetBtn, { backgroundColor: COLORS.brandTertiary }]}
                  testID="result-cancel"
                >
                  <Text style={{ color: COLORS.brandPrimary, fontWeight: '600' }}>Annuler</Text>
                </BouncyPressable>
                <BouncyPressable
                  onPress={save}
                  disabled={saving}
                  hapticStyle="medium"
                  style={[styles.sheetBtn, { backgroundColor: COLORS.brandPrimary, flex: 2 }]}
                  testID="result-save"
                >
                  {saving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle" size={20} color="#fff" />
                      <Text style={{ color: '#fff', fontWeight: '700', marginLeft: 6 }}>Ajouter au journal</Text>
                    </>
                  )}
                </BouncyPressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function MacroField({ label, value, unit, onChange, testID, accent }: {
  label: string; value: number; unit: string; onChange: (v: string) => void; testID: string; accent: string;
}) {
  return (
    <View style={styles.macroFieldBox}>
      <View style={styles.macroFieldHead}>
        <View style={[styles.macroFieldDot, { backgroundColor: accent }]} />
        <Text style={styles.macroFieldLabel}>{label}</Text>
      </View>
      <View style={styles.macroFieldRow}>
        <TextInput
          testID={testID}
          style={styles.macroFieldInput}
          value={String(Math.round(value))}
          onChangeText={onChange}
          keyboardType="numeric"
        />
        <Text style={styles.macroFieldUnit}>{unit}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },
  header: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 8 },
  eyebrow: { fontSize: 12, color: COLORS.brandPrimary, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  title: { fontSize: 30, fontWeight: '800', color: COLORS.text, letterSpacing: -0.5, marginTop: 4 },
  subtitle: { fontSize: 14, color: COLORS.textMuted, marginTop: 4 },

  previewBox: {
    aspectRatio: 1, borderRadius: 24, overflow: 'hidden', backgroundColor: COLORS.brandTertiary, marginBottom: 20,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } },
      android: { elevation: 3 },
    }),
  },
  preview: { width: '100%', height: '100%' },
  placeholder: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  placeholderIcon: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 2 },
    }),
  },
  placeholderTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginTop: 4 },
  placeholderText: { color: COLORS.textMuted, textAlign: 'center', fontSize: 13, lineHeight: 18 },

  analyzingOverlay: { ...StyleSheet.absoluteFillObject },
  analyzingBadge: {
    position: 'absolute', bottom: 20, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999,
  },
  analyzingText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  reticleFrame: {
    position: 'absolute', top: '10%', left: '10%', right: '10%', bottom: '10%',
  },
  corner: { position: 'absolute', width: 24, height: 24, borderColor: '#fff' },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 8 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 8 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 8 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 8 },
  scanLine: { position: 'absolute', left: '10%', right: '10%', height: 3 },
  scanLineGrad: { flex: 1, borderRadius: 2 },

  actionsRow: { flexDirection: 'row', gap: 12 },
  actionBtn: {
    flex: 1, height: 56, borderRadius: 16, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  actionPrimary: {
    backgroundColor: COLORS.brandPrimary,
    ...Platform.select({
      ios: { shadowColor: COLORS.brandPrimary, shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
      android: { elevation: 3 },
    }),
  },
  actionSecondary: { backgroundColor: COLORS.brandTertiary },
  actionTextLight: { color: '#fff', fontWeight: '700', fontSize: 15 },
  actionTextDark: { color: COLORS.brandPrimary, fontWeight: '700', fontSize: 15 },

  tipCard: {
    marginTop: 16, backgroundColor: COLORS.surface2, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: COLORS.border,
  },
  tipTitle: { fontSize: 13, fontWeight: '700', color: COLORS.text, marginBottom: 4 },
  tipText: { fontSize: 13, color: COLORS.textMuted, lineHeight: 18 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: COLORS.surface2, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '92%' },
  sheetHandle: { width: 44, height: 5, backgroundColor: COLORS.border, borderRadius: 3, alignSelf: 'center', marginTop: 10 },

  confidenceHead: { alignItems: 'flex-start', marginBottom: 8 },
  confidencePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.brandSecondary,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
  },
  confidenceText: { fontSize: 12, color: COLORS.brandPrimary, fontWeight: '700' },

  detected: { fontSize: 11, color: COLORS.textMuted, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 12 },
  detectedInput: {
    fontSize: 26, fontWeight: '800', color: COLORS.text, padding: 0, marginTop: 4, letterSpacing: -0.5,
  },

  sheetLabel: { fontSize: 12, fontWeight: '700', color: COLORS.textMuted, marginTop: 20, marginBottom: 8, letterSpacing: 0.4, textTransform: 'uppercase' },
  sheetInput: {
    backgroundColor: COLORS.surface3, borderRadius: 12, padding: 14, fontSize: 15, color: COLORS.text,
  },

  macroGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  macroFieldBox: {
    flexBasis: '48%', flexGrow: 1, backgroundColor: COLORS.surface3, borderRadius: 14, padding: 14,
  },
  macroFieldHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  macroFieldDot: { width: 8, height: 8, borderRadius: 4 },
  macroFieldLabel: { fontSize: 12, color: COLORS.textMuted, fontWeight: '600' },
  macroFieldRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  macroFieldInput: {
    fontSize: 24, fontWeight: '800', color: COLORS.text, flex: 1, padding: 0, fontVariant: ['tabular-nums'], letterSpacing: -0.5,
  },
  macroFieldUnit: { fontSize: 12, color: COLORS.textMuted, fontWeight: '700' },

  ingredientsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  ingredientChip: {
    backgroundColor: COLORS.brandTertiary, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
  },
  ingredientText: { fontSize: 12, color: COLORS.brandPrimary, fontWeight: '600' },

  catRow: { flexDirection: 'row', gap: 8 },
  catChip: {
    flex: 1, paddingVertical: 12, borderRadius: 999, backgroundColor: COLORS.surface3, alignItems: 'center',
  },
  catChipActive: { backgroundColor: COLORS.brandPrimary },
  catChipText: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary },
  catChipTextActive: { color: '#fff' },

  sheetBtn: {
    flex: 1, height: 56, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexDirection: 'row',
  },
});
