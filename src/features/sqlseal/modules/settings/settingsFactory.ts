
import { Settings } from "./Settings";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const settingsFactory = async (plugin: any) => {
	// Access the shared plugin.settings object directly
	const obj = new Settings(plugin.settings);

	obj.onChange(async (settings) => {
		// Update plugin.settings and save
		plugin.settings = {
			...plugin.settings,
			...settings,
		};
		await plugin.saveSettings();
	});

	return obj;
};
