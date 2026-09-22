import { useColorScheme } from 'react-native';
import { Svg, Path, Circle } from 'react-native-svg';

// Renders the approved app icon mark (see mobile/assets/source/gend-mark.svg)
// as a scalable inline SVG, so it can be dropped into headers at any size
// instead of shipping a raster asset per use.
export function GendLogo({ size = 64 }: { size?: number }) {
  const isDark = useColorScheme() === 'dark';
  const lineColor = isDark ? '#2a3442' : '#d5d5d5';
  const innerDotColor = isDark ? '#0f1720' : '#ffffff';

  return (
    <Svg viewBox="0 0 104 104" width={size} height={size}>
      <Path d="M 22 82 C 40 42 58 26 78 22" stroke={lineColor} strokeWidth={5} fill="none" strokeLinecap="round" strokeDasharray="2 13" />
      <Circle cx={22} cy={82} r={12} fill="#1877F2" />
      <Path d="M 78 8 C 87 8 94 15 94 24 C 94 34 78 50 78 50 C 78 50 62 34 62 24 C 62 15 69 8 78 8 Z" fill="#D97757" />
      <Circle cx={78} cy={23} r={6} fill={innerDotColor} />
    </Svg>
  );
}
