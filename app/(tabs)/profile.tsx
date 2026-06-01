import { View, Text } from 'react-native';
import { Colors } from '../../constants/theme';

export default function ProfileScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: Colors.textPrimary }}>Profile</Text>
    </View>
  );
}