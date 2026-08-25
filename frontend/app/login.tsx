import { useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/lib/auth';
import { COLORS } from '@/src/lib/api';
import { BouncyPressable, FadeInUp } from '@/src/components/motion';

const HERO = 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?crop=entropy&cs=srgb&fm=jpg&w=1200&q=85';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);

  const handleGoogle = async () => {
    setBusy(true);
    try {
      await signIn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root} testID="login-screen">
      <Image source={HERO} style={StyleSheet.absoluteFill as any} contentFit="cover" />
      <LinearGradient
        colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0.75)', 'rgba(10,10,10,0.95)']}
        style={StyleSheet.absoluteFill}
      />

      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.content}>
          <FadeInUp delay={0}>
            <View style={styles.logoRow}>
              <View style={styles.logoWrap}>
                <Ionicons name="nutrition" size={28} color={COLORS.brandPrimary} />
              </View>
              <Text style={styles.brand}>Nutriscan</Text>
            </View>
          </FadeInUp>

          <View style={{ flex: 1 }} />

          <FadeInUp delay={80}>
            <Text style={styles.eyebrow}>SUIVI NUTRITIONNEL IA</Text>
            <Text style={styles.title}>Prends une photo,{'\n'}suis ta forme</Text>
            <Text style={styles.subtitle}>
              Notre IA analyse tes repas, adapte ton plan à la semaine et te guide vers tes objectifs.
            </Text>
          </FadeInUp>

          <FadeInUp delay={160}>
            <View style={styles.bulletList}>
              <Bullet icon="scan" text="Scan photo instantané" />
              <Bullet icon="restaurant" text="Plan repas hebdo de saison" />
              <Bullet icon="lock-closed" text="Tes données restent privées" />
            </View>
          </FadeInUp>

          <FadeInUp delay={220}>
            <BouncyPressable
              testID="login-google-button"
              onPress={handleGoogle}
              disabled={busy}
              hapticStyle="medium"
              style={[styles.googleBtn, busy && { opacity: 0.6 }]}
            >
              {busy ? (
                <ActivityIndicator color={COLORS.text} />
              ) : (
                <>
                  <View style={styles.gIcon}>
                    <Text style={styles.gIconText}>G</Text>
                  </View>
                  <Text style={styles.googleText}>Continuer avec Google</Text>
                </>
              )}
            </BouncyPressable>
            <Text style={styles.legal}>
              En continuant tu acceptes que Nutriscan stocke ton profil et tes repas de façon sécurisée.
            </Text>
          </FadeInUp>
        </View>
      </SafeAreaView>
    </View>
  );
}

function Bullet({ icon, text }: { icon: any; text: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot}>
        <Ionicons name={icon} size={14} color="#fff" />
      </View>
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  content: { flex: 1, paddingHorizontal: 24, paddingBottom: 24 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8 },
  logoWrap: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  brand: { color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },

  eyebrow: { color: COLORS.brand, fontSize: 12, fontWeight: '700', letterSpacing: 0.8, marginBottom: 8 },
  title: { color: '#fff', fontSize: 40, fontWeight: '800', lineHeight: 44, letterSpacing: -0.8 },
  subtitle: { color: 'rgba(255,255,255,0.8)', fontSize: 15, marginTop: 12, lineHeight: 22 },

  bulletList: { marginTop: 32, gap: 12 },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bulletDot: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  bulletText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  googleBtn: {
    marginTop: 36, backgroundColor: '#fff', borderRadius: 999,
    height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
      android: { elevation: 4 },
    }),
  },
  gIcon: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: '#4285F4',
    alignItems: 'center', justifyContent: 'center',
  },
  gIconText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  googleText: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  legal: { color: 'rgba(255,255,255,0.55)', fontSize: 11, textAlign: 'center', marginTop: 16, lineHeight: 16 },
});
