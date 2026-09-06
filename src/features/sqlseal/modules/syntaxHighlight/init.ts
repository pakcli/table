import { ViewPlugin } from "@codemirror/view";
import { Plugin } from "obsidian";

export const syntaxHighlightInit = (
	plugin: Plugin,
	viewPluginGenerator: () => ViewPlugin<unknown>,
) => {
	return () => {
		// FIXME: settings here.
		plugin.registerEditorExtension([viewPluginGenerator()]);
	};
};
