import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.supremacywarroom.app',
  appName: 'Supremacy War Room',
  webDir: 'dist',
  android: {
    path: 'android',
  },
  server: {
    androidScheme: 'https',
  },
}

export default config
