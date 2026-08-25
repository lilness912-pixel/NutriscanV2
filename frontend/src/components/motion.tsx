import { forwardRef, useEffect } from 'react';
import { Pressable, PressableProps, ViewStyle, StyleProp } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

const AnimatedPressableBase = Animated.createAnimatedComponent(Pressable);

type Props = PressableProps & {
  hapticStyle?: 'light' | 'medium' | 'selection' | 'none';
  scaleTo?: number;
  style?: StyleProp<ViewStyle>;
};

/** Pressable that scales down on press and fires haptic feedback */
export const BouncyPressable = forwardRef<any, Props>(function BouncyPressable(
  { hapticStyle = 'light', scaleTo = 0.96, style, onPressIn, onPressOut, onPress, ...rest },
  ref
) {
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressableBase
      ref={ref}
      onPressIn={(e) => {
        scale.value = withSpring(scaleTo, { damping: 15, stiffness: 400 });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, { damping: 15, stiffness: 400 });
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (hapticStyle === 'selection') Haptics.selectionAsync();
        else if (hapticStyle === 'medium')
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        else if (hapticStyle === 'light')
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.(e);
      }}
      style={[animStyle, style as any]}
      {...rest}
    />
  );
});

/** Fade + slide-up entrance animation wrapper */
export function FadeInUp({
  children,
  delay = 0,
  style,
  distance = 16,
  duration = 500,
}: {
  children: React.ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
  distance?: number;
  duration?: number;
}) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(distance);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration, easing: Easing.out(Easing.cubic) }));
    translateY.value = withDelay(delay, withTiming(0, { duration, easing: Easing.out(Easing.cubic) }));
  }, [delay, duration, opacity, translateY]);

  const anim = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}
