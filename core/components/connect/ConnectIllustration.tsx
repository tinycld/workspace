import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import Svg, { Circle, Defs, G, Line, Path, Pattern, Rect, Text as SvgText } from 'react-native-svg'

interface ConnectIllustrationProps {
    height?: number
}

export function ConnectIllustration({ height = 130 }: ConnectIllustrationProps) {
    const fg = useThemeColor('foreground')
    const bg = useThemeColor('background')
    const accent = useThemeColor('primary')
    const surface = useThemeColor('surface')
    const dotPattern = `${fg}55`
    const accentSoft = `${accent}33`

    return (
        <Svg viewBox="0 0 320 130" width="100%" height={height} preserveAspectRatio="xMidYMid meet">
            <Defs>
                <Pattern id="connect-dots" width="6" height="6" patternUnits="userSpaceOnUse">
                    <Circle cx="3" cy="3" r="0.6" fill={dotPattern} />
                </Pattern>
            </Defs>

            <G transform="translate(20,30)">
                <Rect x="0" y="0" width="60" height="80" rx="9" fill={fg} />
                <Rect x="4" y="4" width="52" height="68" rx="5" fill={bg} />
                <Rect x="10" y="12" width="40" height="3" rx="1.5" fill={fg} opacity={0.7} />
                <Rect x="10" y="20" width="28" height="2" rx="1" fill={fg} opacity={0.3} />
                <Rect x="10" y="26" width="34" height="2" rx="1" fill={fg} opacity={0.3} />
                <Rect x="10" y="38" width="40" height="14" rx="3" fill={accentSoft} />
                <Rect x="10" y="56" width="20" height="2" rx="1" fill={fg} opacity={0.3} />
                <Rect x="34" y="56" width="14" height="2" rx="1" fill={fg} opacity={0.3} />
            </G>

            <Path
                d="M 95 70 Q 145 50 195 70"
                stroke={fg}
                strokeWidth="1.2"
                strokeDasharray="3 4"
                fill="none"
                opacity={0.5}
            />
            <Circle cx="145" cy="55" r="3.5" fill={accent} />

            <G transform="translate(195,28)">
                <Rect
                    x="0"
                    y="0"
                    width="100"
                    height="84"
                    rx="8"
                    fill={surface}
                    stroke={fg}
                    strokeWidth="1.4"
                />
                <Line x1="0" y1="22" x2="100" y2="22" stroke={fg} strokeWidth="0.8" opacity={0.4} />
                <Line x1="0" y1="44" x2="100" y2="44" stroke={fg} strokeWidth="0.8" opacity={0.4} />
                <Line x1="0" y1="64" x2="100" y2="64" stroke={fg} strokeWidth="0.8" opacity={0.4} />
                <Circle cx="9" cy="11" r="2" fill={accent} />
                <Circle cx="9" cy="33" r="2" fill={accent} opacity={0.6} />
                <Circle cx="9" cy="54" r="2" fill={accent} />
                <Circle cx="9" cy="74" r="2" fill={accent} opacity={0.4} />
                <Rect x="20" y="8" width="65" height="6" rx="1" fill="url(#connect-dots)" />
                <Rect x="20" y="30" width="65" height="6" rx="1" fill="url(#connect-dots)" />
                <Rect x="20" y="51" width="65" height="6" rx="1" fill="url(#connect-dots)" />
                <Rect x="20" y="71" width="65" height="6" rx="1" fill="url(#connect-dots)" />
            </G>

            <SvgText
                x="245"
                y="124"
                fontFamily="Georgia"
                fontStyle="italic"
                fontSize="11"
                fill={accent}
                textAnchor="middle"
            >
                your server
            </SvgText>
            <Path
                d="M 222 122 Q 230 118 240 120"
                stroke={accent}
                strokeWidth="1"
                fill="none"
                strokeLinecap="round"
            />
        </Svg>
    )
}
