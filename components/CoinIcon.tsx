import { memo } from 'react'
import { View, StyleSheet } from 'react-native'

const SIZES = {
  sm: 16,
  md: 20,
} as const

type CoinIconSize = keyof typeof SIZES

export const CoinIcon = memo(function CoinIcon({ size = 'md' }: { size?: CoinIconSize }) {
  const d = SIZES[size]
  const r = d / 2
  const ringD = Math.round(d * 0.58)
  const ringR = Math.round(ringD / 2)
  return (
    <View style={[styles.outer, { width: d, height: d, borderRadius: r }]}>
      <View style={[styles.ring, { width: ringD, height: ringD, borderRadius: ringR }]} />
    </View>
  )
})

const styles = StyleSheet.create({
  outer: {
    backgroundColor: '#E8A520',
    borderWidth: 2,
    borderColor: '#7A5200',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    borderWidth: 2,
    borderColor: 'rgba(80, 40, 0, 0.30)',
  },
})
