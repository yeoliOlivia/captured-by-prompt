import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from './theme';

export function Button({ label, onPress, disabled = false, secondary = false, icon, busy = false, style }: {
  label: string; onPress: () => void; disabled?: boolean; secondary?: boolean; busy?: boolean;
  icon?: React.ComponentProps<typeof Ionicons>['name']; style?: ViewStyle;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, busy }} onPress={onPress} disabled={disabled || busy}
    style={({ pressed }) => [styles.button, secondary && styles.secondary, (disabled || busy) && { opacity: 0.5 }, pressed && { opacity: 0.75 }, style]}>
    {busy ? <ActivityIndicator color={secondary ? colors.ink : 'white'} /> : icon ? <Ionicons name={icon} size={18} color={secondary ? colors.ink : 'white'} /> : null}
    <Text style={[styles.buttonText, secondary && { color: colors.ink }]}>{label}</Text>
  </Pressable>;
}
export function Notice({ text }: { text: string }) {
  return <View accessibilityLiveRegion="polite" style={styles.notice}><Ionicons name="information-circle-outline" size={19} color={colors.green} /><Text style={styles.noticeText}>{text}</Text></View>;
}
export const styles = StyleSheet.create({
  button: { minHeight: 48, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 16, backgroundColor: colors.green, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 9 },
  secondary: { backgroundColor: colors.light },
  buttonText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  notice: { backgroundColor: colors.light, borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  noticeText: { color: colors.green, flex: 1, fontSize: 13, lineHeight: 20 },
  label: { fontSize: 11, letterSpacing: 1.8, fontWeight: '700', color: colors.muted, textTransform: 'uppercase' },
  body: { fontSize: 15, lineHeight: 23, color: colors.muted },
  input: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 15, fontSize: 15, color: colors.ink },
});
