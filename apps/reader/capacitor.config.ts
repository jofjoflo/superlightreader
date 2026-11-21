import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
	appId: 'com.superlight.reader',
	appName: 'SuperLight Reader',
	webDir: 'build',
	backgroundColor: '#0a0c12',
	loggingBehavior: 'none',
	server: {
		androidScheme: 'https',
		cleartext: false
	},
	android: {
		allowMixedContent: false,
		webContentsDebuggingEnabled: false,
		loggingBehavior: 'none'
	}
};

export default config;
