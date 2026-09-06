import { Plugin } from "obsidian";
import {
	PluginRegister,
	SQLSealRegisterApi,
} from "./pluginApi/sqlSealApi";
import { RendererRegistry } from "../editor/renderer/rendererRegistry";
import { SqlocalDatabaseProxy } from "../database/sqlocal/sqlocalDatabaseProxy";
import { ModernCellParser } from "../syntaxHighlight/cellParser/ModernCellParser";

const SQLSEAL_API_KEY = "___sqlSeal";
const SQLSEAL_QUEUED_PLUGINS = "___sqlSeal_queue";

export const apiInit = (
	plugin: Plugin,
	cellParser: ModernCellParser,
	rendererRegistry: RendererRegistry,
	db: SqlocalDatabaseProxy,
) => {
	return () => {
		const api = new SQLSealRegisterApi(
			plugin,
			cellParser,
			rendererRegistry,
			db,
		);
		(window as unknown)[SQLSEAL_API_KEY] = api;
		plugin.register(() => {
			delete (window as unknown)[SQLSEAL_API_KEY];
		});

		const queuedPlugins = (window as unknown)[SQLSEAL_QUEUED_PLUGINS] as
			| PluginRegister[]
			| undefined;
		if (!queuedPlugins) {
			return;
		}

		queuedPlugins.forEach((pl) => {
			api.registerForPluginNew(pl);
		});

		(window as unknown)[SQLSEAL_QUEUED_PLUGINS] = [];
	};
};
