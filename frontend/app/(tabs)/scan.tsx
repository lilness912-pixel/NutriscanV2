import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  ActivityIndicator,
  ScrollView,
  Alert,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { api, COLORS } from '@/src/lib/api';
import { storage } from '@/src/lib/storage';

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
        Alert.alert('Permission requise', 'Autorise l\'accès à l\'appareil photo.');
        return;
      }
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission requise', 'Autorise l\'accès à la galerie.');
        return;
      }
    }
    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'] as any,
      quality: 0.6,
      base64: true,
      allowsEditing: false,
    };
    const res =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    setImageUri(asset.uri);
    setImageBase64(asset.base64 || null);
    setResult(null);
  };

  const analyze = async () => {
    if (!imageBase64) return;
    const uid = await storage.getUserId();
    if (!uid) return;
    setAnalyzing(true);
    try {
      const r: ScanResult = await api.scanMeal(uid, imageBase64);
      setResult(r);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const h = new Date().getHours();
      setCategory(h < 11 ? 'breakfast' : h < 15 ? 'lunch' : h < 20 ? 'dinner' : 'snack');
    } catch (e: any) {
      Alert.alert('Erreur', 'L\'IA n\'a pas pu analyser cette photo. Réessaie.');
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
        user_id: uid,
        name: result.name,
        calories: Math.round(result.calories),
        protein_g: result.protein_g,
        carbs_g: result.carbs_g,
        fat_g: result.fat_g,
        portion: result.portion,
        category,
        image_base64: imageBase64,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResult(null);
      setImageUri(null);
      setImageBase64(null);
      router.push('/(tabs)');
    } catch (e) {
      Alert.alert('Erreur', 'Impossible d\'enregistrer le repas.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} testID="scan-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Scanner un repas</Text>
        <Text style={styles.subtitle}>Prends une photo, notre IA analyse tout</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
        <View style={styles.previewBox}>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.preview} contentFit="cover" />
          ) : (
            <View style={styles.placeholder}>
              <Ionicons name="fast-food-outline" size={64} color={COLORS.brand} />
              <Text style={styles.placeholderText}>
                Aucune photo{'\n'}Utilise les boutons ci-dessous
              </Text>
            </View>
          )}
        </View>

        <View style={styles.actionsRow}>
          <Pressable
            testID="scan-camera-button"
            onPress={() => pickFrom('camera')}
            style={[styles.actionBtn, styles.actionPrimary]}
          >
            <Ionicons name="camera" size={22} color="#fff" />
            <Text style={styles.actionTextLight}>Caméra</Text>
          </Pressable>
          <Pressable
            testID="scan-library-button"
            onPress={() => pickFrom('library')}
            style={[styles.actionBtn, styles.actionSecondary]}
          >
            <Ionicons name="images" size={22} color={COLORS.brandPrimary} />
            <Text style={styles.actionTextDark}>Galerie</Text>
          </Pressable>
        </View>

        {imageBase64 && !result && (
          <Pressable
            testID="scan-analyze-button"
            onPress={analyze}
            disabled={analyzing}
            style={styles.analyzeBtn}
          >
            {analyzing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="sparkles" size={20} color="#fff" />
                <Text style={styles.actionTextLight}>Analyser avec l'IA</Text>
              </>
            )}
          </Pressable>
        )}
      </ScrollView>

      {/* Result bottom sheet */}
      <Modal visible={!!result} transparent animationType="slide" onRequestClose={() => setResult(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.sheet} testID="scan-result-sheet">
            <View style={styles.sheetHandle} />
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
              <View style={styles.confidenceRow}>
                <Ionicons name="checkmark-circle" size={18} color={COLORS.success} />
                <Text style={styles.confidenceText}>
                  Confiance IA {result ? Math.round(result.confidence * 100) : 0}%
                </Text>
              </View>

              <Text style={styles.sheetLabel}>Nom du plat</Text>
              <TextInput
                testID="result-name-input"
                style={styles.sheetInput}
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
                <MacroField label="Calories" value={result?.calories || 0} unit="kcal" onChange={(v) => updateField('calories', v)} testID="result-calories" />
                <MacroField label="Protéines" value={result?.protein_g || 0} unit="g" onChange={(v) => updateField('protein_g', v)} testID="result-protein" />
                <MacroField label="Glucides" value={result?.carbs_g || 0} unit="g" onChange={(v) => updateField('carbs_g', v)} testID="result-carbs" />
                <MacroField label="Lipides" value={result?.fat_g || 0} unit="g" onChange={(v) => updateField('fat_g', v)} testID="result-fat" />
              </View>

              <Text style={styles.sheetLabel}>Catégorie</Text>
              <View style={styles.catRow}>
                {(['breakfast', 'lunch', 'dinner', 'snack'] as const).map((c) => (
                  <Pressable
                    key={c}
                    testID={`result-cat-${c}`}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setCategory(c);
                    }}
                    style={[styles.catChip, category === c && styles.catChipActive]}
                  >
                    <Text style={[styles.catChipText, category === c && styles.catChipTextActive]}>
                      {c === 'breakfast' ? 'P.déj' : c === 'lunch' ? 'Déj' : c === 'dinner' ? 'Dîner' : 'Snack'}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
                <Pressable
                  onPress={() => setResult(null)}
                  style={[styles.sheetBtn, { backgroundColor: COLORS.brandTertiary }]}
                  testID="result-cancel"
                >
                  <Text style={{ color: COLORS.brandPrimary, fontWeight: '600' }}>Annuler</Text>
                </Pressable>
                <Pressable
                  onPress={save}
                  disabled={saving}
                  style={[styles.sheetBtn, { backgroundColor: COLORS.brandPrimary, flex: 2 }]}
                  testID="result-save"
                >
                  {saving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={{ color: '#fff', fontWeight: '700' }}>Ajouter au journal</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function MacroField({
  label,
  value,
  unit,
  onChange,
  testID,
}: {
  label: string;
  value: number;
  unit: string;
  onChange: (v: string) => void;
  testID: string;
}) {
  return (
    <View style={styles.macroFieldBox}>
      <Text style={styles.macroFieldLabel}>{label}</Text>
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
  title: { fontSize: 26, fontWeight: '700', color: COLORS.text },
  subtitle: { fontSize: 14, color: COLORS.textMuted, marginTop: 4 },
  previewBox: {
    aspectRatio: 1,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: COLORS.brandTertiary,
    marginBottom: 20,
  },
  preview: { width: '100%', height: '100%' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  placeholderText: { color: COLORS.textMuted, textAlign: 'center', fontSize: 14 },
  actionsRow: { flexDirection: 'row', gap: 12 },
  actionBtn: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionPrimary: { backgroundColor: COLORS.brandPrimary },
  actionSecondary: { backgroundColor: COLORS.brandTertiary },
  actionTextLight: { color: '#fff', fontWeight: '600', fontSize: 15 },
  actionTextDark: { color: COLORS.brandPrimary, fontWeight: '600', fontSize: 15 },
  analyzeBtn: {
    marginTop: 16,
    backgroundColor: COLORS.text,
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.surface2,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
  },
  sheetHandle: {
    width: 44,
    height: 5,
    backgroundColor: COLORS.border,
    borderRadius: 3,
    alignSelf: 'center',
    marginTop: 10,
  },
  confidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  confidenceText: { fontSize: 13, color: COLORS.success, fontWeight: '600' },
  sheetLabel: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary, marginTop: 12, marginBottom: 6 },
  sheetInput: {
    backgroundColor: COLORS.surface3,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: COLORS.text,
  },
  macroGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  macroFieldBox: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: COLORS.surface3,
    borderRadius: 12,
    padding: 12,
  },
  macroFieldLabel: { fontSize: 12, color: COLORS.textMuted, marginBottom: 4 },
  macroFieldRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  macroFieldInput: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    flex: 1,
    padding: 0,
    fontVariant: ['tabular-nums'],
  },
  macroFieldUnit: { fontSize: 12, color: COLORS.textMuted, fontWeight: '600' },
  catRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  catChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: COLORS.surface3,
    alignItems: 'center',
  },
  catChipActive: { backgroundColor: COLORS.brandPrimary },
  catChipText: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary },
  catChipTextActive: { color: '#fff' },
  sheetBtn: {
    flex: 1,
    height: 52,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
