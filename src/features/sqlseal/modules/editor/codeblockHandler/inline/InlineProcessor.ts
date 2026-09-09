import { OmnibusRegistrator } from "@hypersphere/omnibus";
import { App, MarkdownRenderChild } from "obsidian";
import { transformQuery } from "../../sql/sqlTransformer";
import { SqlocalDatabaseProxy } from "../../../database/sqlocal/sqlocalDatabaseProxy";
import { Sync } from "../../../sync/sync/sync";
import { registerObservers } from "../../../../utils/registerObservers";
import { displayError } from "../../../../utils/ui";
import { Settings } from "../../../settings/Settings";

function toErrorMessage(e: unknown): string {
    if (e instanceof Error) return e.message;
    if (typeof e === 'string') return e;
    return 'Unknown error';
}

export class InlineProcessor extends MarkdownRenderChild {
    private registrator: OmnibusRegistrator;

    constructor(
        private el: HTMLElement,
        private query: string,
        private sourcePath: string,
        private db: SqlocalDatabaseProxy,
        private settings: Settings,
        private app: App,
        private sync: Sync
    ) {
        super(el);
        this.registrator = this.sync.getRegistrator();
    }

    onload() {
        void this.init();
    }

    private async init() {
        try {
            await this.render();
        } catch (e) {
            displayError(this.el, toErrorMessage(e));
        }
    }

    onunload() {
        this.registrator.offAll();
    }

    async render() {
        try {
            const registeredTablesForContext = await this.sync.getTablesMappingForContext(this.sourcePath);
            const transformedQuery = transformQuery(this.query, registeredTablesForContext, {
                disableTagAutoDetection: this.settings.get('disableTagAutoDetection')
            });

            // FIXME: settings here instead of plugin
            if (this.settings.get('enableDynamicUpdates')) {
                registerObservers({
                    bus: this.registrator,
                    tables: transformedQuery.mappedTables,
                    callback: () => {
                        void this.render();
                    },
                    fileName: this.sourcePath
                });
            }

            const file = this.app.vault.getFileByPath(this.sourcePath);
            if (!file) {
                return;
            }

            const fileCache = this.app.metadataCache.getFileCache(file);
            
            // TODO: unify this between codeblock and inline handlers
            const variables = {
                ...(fileCache?.frontmatter ?? {}),
                path: file.path,
                fileName: file.name,
                basename: file.basename,
                parent: file.parent?.path,
                extension: file.extension,
            };

            const queryRes = await this.db.select(
                transformedQuery.sql,
                variables
            );
            const data = queryRes?.data ?? [];
            const columns = queryRes?.columns ?? [];

            this.el.empty();
            const firstRow = data[0];
            const firstCol = columns[0];
            const rawVal = (firstRow && firstCol) ? firstRow[firstCol] : '';
            const value = (typeof rawVal === 'string' || typeof rawVal === 'number' || typeof rawVal === 'boolean')
                ? String(rawVal)
                : (rawVal ? JSON.stringify(rawVal) : '');
            this.el.createSpan({ text: value });

        } catch (e) {
            displayError(this.el, toErrorMessage(e));
        }
    }
}