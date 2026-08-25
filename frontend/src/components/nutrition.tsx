import { View, Text, StyleSheet } from 'react-native';
import { COLORS } from '@/src/lib/api';

type Props = {
  size?: number;
  stroke?: number;
  progress: number; // 0-1
  color?: string;
  bg?: string;
  children?: React.ReactNode;
};

// SVG-free ring using nested Views + rotation trick.
// For MVP we use a simple half-circle overlay approach.
export function ProgressRing({
  size = 180,
  stroke = 14,
  progress,
  color = COLORS.brandPrimary,
  bg = COLORS.brandTertiary,
  children,
}: Props) {
  const clamped = Math.max(0, Math.min(1, progress));
  const angle = clamped * 360;

  const halfRotation = Math.min(180, angle);
  const secondRotation = angle > 180 ? angle - 180 : 0;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Background ring */}
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
      {/* First half (0-180deg) */}
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
          <View
            style={{
              width: size,
              height: size,
              borderRadius: size / 2,
              borderWidth: stroke,
              borderColor: 'transparent',
              borderTopColor: color,
              borderRightColor: color,
              position: 'absolute',
              left: -size / 2,
              transform: [{ rotate: `${-45 + halfRotation}deg` }],
            }}
          />
        </View>
      </View>
      {/* Second half (180-360deg) */}
      {angle > 180 && (
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
            <View
              style={{
                width: size,
                height: size,
                borderRadius: size / 2,
                borderWidth: stroke,
                borderColor: 'transparent',
                borderTopColor: color,
                borderRightColor: color,
                position: 'absolute',
                right: -size / 2,
                transform: [{ rotate: `${135 + secondRotation}deg` }],
              }}
            />
          </View>
        </View>
      )}
      <View style={{ alignItems: 'center', justifyContent: 'center' }}>{children}</View>
    </View>
  );
}

export function MacroBar({
  label,
  value,
  target,
  color,
}: {
  label: string;
  value: number;
  target: number;
  color: string;
}) {
  const pct = Math.min(1, target > 0 ? value / target : 0);
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
        <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  macroWrap: { marginBottom: 12 },
  macroHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  macroLabel: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary },
  macroVal: { fontSize: 13, fontWeight: '600' },
  track: { height: 8, backgroundColor: COLORS.brandTertiary, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
});
