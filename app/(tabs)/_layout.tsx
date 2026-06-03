import { Tabs } from 'expo-router';
import { Colors, Fonts } from '../../constants/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from 'react-native';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
          height: 60 + insets.bottom,
          paddingTop: 8,
          paddingBottom: 8 + insets.bottom,
        },
        tabBarActiveTintColor: Colors.gold,
        tabBarInactiveTintColor: Colors.textSecondary,
        tabBarLabelStyle: {
          fontFamily: Fonts.display,
          fontSize: 10,
          letterSpacing: 1,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'ERAS',
          tabBarIcon: ({ color, focused }) => (
            <Text style={{ fontSize: 18, color, opacity: focused ? 1 : 0.5 }}>⚔</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="shop"
        options={{
          title: 'SHOP',
          tabBarIcon: ({ color, focused }) => (
            <Text style={{ fontSize: 18, color, opacity: focused ? 1 : 0.5 }}>🪙</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'PROFILE',
          tabBarIcon: ({ color, focused }) => (
            <Text style={{ fontSize: 18, color, opacity: focused ? 1 : 0.5 }}>◈</Text>
          ),
        }}
      />
    </Tabs>
  );
}