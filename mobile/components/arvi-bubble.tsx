import { Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, {
  Rect,
  Circle,
  Path,
  Line,
  Defs,
  LinearGradient as SvgLinearGradient,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { router } from 'expo-router';
import { CUSTOMER_COLOR, AGENT_COLOR } from '../lib/colors';

// Floating action button that opens the ARVI chatbot. Self-contained —
// screens just drop <ArviBubble /> in, no props needed.
export function ArviBubble() {
  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => router.push('/arvi-chat')}
        style={({ pressed }) => [styles.circle, pressed && styles.pressed]}
      >
        <LinearGradient
          colors={[CUSTOMER_COLOR, AGENT_COLOR]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <Svg width={30} height={30} viewBox="0 0 40 40">
            <Rect x={6} y={10} width={28} height={22} rx={9} fill="#ffffff" />
            <Circle cx={16} cy={20} r={3} fill="#1877F2" />
            <Circle cx={24} cy={20} r={3} fill="#1877F2" />
            <Path d="M 13 26 Q 20 32 27 26" stroke="#1877F2" strokeWidth={2.5} fill="none" strokeLinecap="round" />
            <Line x1={20} y1={10} x2={20} y2={4} stroke="#ffffff" strokeWidth={2.5} strokeLinecap="round" />
            <Circle cx={20} cy={4} r={3} fill="#ffffff" />
          </Svg>
        </LinearGradient>
      </Pressable>
      <Svg width={80} height={16} style={styles.label}>
        <Defs>
          <SvgLinearGradient id="labelGrad" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={CUSTOMER_COLOR} />
            <Stop offset="1" stopColor={AGENT_COLOR} />
          </SvgLinearGradient>
        </Defs>
        <SvgText x="50%" y="12" textAnchor="middle" fontSize="11" fontWeight="600" fill="url(#labelGrad)">
          Ask ARVI
        </SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    alignItems: 'center',
  },
  circle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  pressed: { opacity: 0.85 },
  gradient: {
    flex: 1,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    marginTop: 4,
  },
});
