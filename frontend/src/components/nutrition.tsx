import { useEffect } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  interpolate,
  Easing,
} from 'react-native-reanimated';
import { COLORS } from '@/src/lib/api';

/** Progress ring animated 0 -> target on mount using rotation trick */
export function AnimatedProgressRing({
  size = 190,
  stroke = 16,
  progress,
  color = COLORS.brandPrimary,
  bg = COLORS.brandTertiary,
  duration = 1200,
  children,
}: {
  size?: number;
  stroke?: number;
  progress: number; // 0..1+
  color?: string;
  bg?: string;
  duration?: number;
  children?: React.ReactNode;
}) {
  const p = Math.max(0, Math.min(1, progress));
  const shared = useSharedValue(0);

  useEffect(() => {
    shared.value = 0;
    shared.value = withTiming(p, {
      duration,
      easing: Easing.out(Easing.cubic),
    });
  }, [p, duration, shared]);

  const firstHalfStyle = useAnimatedStyle(() => {
    const angle = shared.value * 360;
    const rot = Math.min(180, angle);
    return { transform: [{ rotate: `${-45 + rot}deg` }] };
  });

  const secondHalfStyle = useAnimatedStyle(() => {
    const angle = shared.value * 360;
    const opacity = angle > 180 ? 1 : 0;
    const rot = angle > 180 ? angle - 180 : 0;
    return { transform: [{ rotate: `${135 + rot}deg` }], opacity };
  });

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: stroke,
          borderColor: bg,
        }}
      />
      {/* First 180deg */}
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            position: 'absolute',
            left: size / 2,
            width: size / 2,
            height: size,
            overflow: 'hidden',
          }}
        >
          <Animated.View
            style={[
              {
                width: size,
                height: size,
                borderRadius: size / 2,
                borderWidth: stroke,
                borderColor: 'transparent',
                borderTopColor: color,
                borderRightColor: color,
                position: 'absolute',
                left: -size / 2,
              },
              firstHalfStyle,
            ]}
          />
        </View>
      </View>
      {/* Second 180deg */}
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            position: 'absolute',
            right: size / 2,
            width: size / 2,
            height: size,
            overflow: 'hidden',
          }}
        >
          <Animated.View
            style={[
              {
                width: size,
                height: size,
                borderRadius: size / 2,
                borderWidth: stroke,
                borderColor: 'transparent',
                borderTopColor: color,
                borderRightColor: color,
                position: 'absolute',
                right: -size / 2,
              },
              secondHalfStyle,
            ]}
          />
        </View>
      </View>
      <View style={{ alignItems: 'center', justifyContent: 'center' }}>{children}</View>
    </View>
  );
}

/** Animated macro bar that fills on mount */
export function AnimatedMacroBar({
  label,
  value,
  target,
  color,
  delay = 0,
}: {
  label: string;
  value: number;
  target: number;
  color: string;
  delay?: number;
}) {
  const pct = Math.min(1, target > 0 ? value / target : 0);
  const shared = useSharedValue(0);

  useEffect(() => {
    shared.value = 0;
    shared.value = withDelay(delay, withTiming(pct, { duration: 900, easing: Easing.out(Easing.cubic) }));
  }, [pct, delay, shared]);

  const style = useAnimatedStyle(() => ({
    width: `${interpolate(shared.value, [0, 1], [0, 100])}%`,
  }));

  return (
    <View style={styles.macroWrap}>
      <View style={styles.macroHead}>
        <Text style={styles.macroLabel}>{label}</Text>
        <Text style={styles.macroVal}>
          <Text style={{ color: COLORS.text, fontVariant: ['tabular-nums'] }}>
            {Math.round(value)}
          </Text>
          <Text style={{ color: COLORS.textMuted }}> / {Math.round(target)}g</Text>
        </Text>
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { backgroundColor: color }, style]} />
      </View>
    </View>
  );
}

// intentionally re-declare Text/StyleSheet local
const styles = StyleSheet.create({
  macroWrap: { marginBottom: 12 },
  macroHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  macroLabel: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary },
  macroVal: { fontSize: 13, fontWeight: '600' },
  track: { height: 8, backgroundColor: COLORS.brandTertiary, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
});
