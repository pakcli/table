import * as ohm from 'ohm-js';
import { Flag } from './renderer/rendererRegistry';

export interface ViewDefinition {
    name: string,
    singleLine: boolean,
    argument: string
}

const viewName = (view: ViewDefinition) => `caseInsensitive<"${view.name}">`



export const SQLSealLangDefinition = (views: ViewDefinition[], flags: readonly Flag[] = [], enableErrors: boolean = false) => {
    const viewsDefinitions = views
        .map(view => view.singleLine ?
            `#(${viewName(view)} ${view.argument})`
            : `${viewName(view)} ${view.argument}`)
        .join(' | ')


    const flagsDefinitions = flags.map(flag => {
        return `caseInsensitive<"${flag.name}"> -- ${flag.key}`
    }).join(' \n| ')



    return String.raw`
        SQLSealLang {
            Grammar =                  (TableExpression | ViewExpression | FlagExpression | blank ${enableErrors ? '| errorLine' : ''})* SelectStmt*
            SelectStmt =               selectKeyword any+
            FlagExpression =           caseInsensitive<"REFRESH">                                               -- refresh
            |                          caseInsensitive<"NO REFRESH">                                            -- norefresh
            |                          caseInsensitive<"EXPLAIN">                                               -- explain
            ${flags.length ? '| ExtraFlags -- extraFlags' : ''}
            TableExpression =          tableKeyword identifier "=" TableDefinition          
            TableDefinition =          fileOpening TableFileExpressionArgs tableDefinitionClosing      -- file
            |                          tableOpening NonemptyListOf<listElement, ","> tableDefinitionClosing      -- mdtable
            TableFileExpressionArgs =  filename ("," NonemptyListOf<listElement, ",">)?
            identifier =               (alnum | "_")+
            filename  =                ~("\"") (alnum | "." | "-" | space | "_" | "/" | "\\" | "$" | "[" | "]" | "\"")+ ~("\"") -- unquoted
            |                          "\"" (alnum | "." | "-" | space | "_" | "/" | "\\" | "$" | "[" | "]" | ",")+ "\"" -- quoted
            fileOpening =              caseInsensitive<"file(">
            tableOpening =             caseInsensitive<"table(">
            tableDefinitionClosing =   ")"
            errorLine =                (~(nl|selectKeyword) any)* nl
   
            listElement =              "\"" (~"\"" any)+ "\""                                                   -- quoted
            |                          (~ ("," | ")") any)+                                                     -- unquoted

            ViewExpression =           ${viewsDefinitions}
            ExtraFlags =               ${flagsDefinitions}
            anyObject =                "{"  (~selectKeyword any)*
            handlebarsTemplate =       (~selectKeyword any)*
            javascriptTemplate =       (~selectKeyword any)*
            selectKeyword =            (caseInsensitive<"WITH"> | caseInsensitive<"SELECT">) &(space | nl | end)
            tableKeyword =             caseInsensitive<"TABLE">
            nl =                       "\n"
            character =                (alnum | "." | "-" | space | "_")
            viewClassNames =           restLine
            restLine =                 " " (~nl character)* nl
            blank = space* nl
            comment =                  "/*" (~"*/" any)* "*/" -- multiline
            |                          #("--" (~nl any)*) nl  -- singleline
            space += comment
        }
`
}

interface SemanticNode extends ohm.Node {
    toObject(): unknown;
    asIteration(): ohm.IterationNode & { children: SemanticNode[] };
}

const generateSemantic = (grammar: ohm.Grammar) => {
    const s = grammar.createSemantics()

    const operations: ohm.ActionDict<unknown> = {
        Grammar: (entries: ohm.Node, selectStatement?: ohm.Node) => {
            const res = {
                flags: {} as Record<string, unknown>,
                renderer: {
                    name: 'GRID',
                    options: ''
                },
                tables: [] as TableDefinition[],
                query: ''
            }
            if (entries.children.length) {
                entries.children.forEach((c: ohm.Node) => {
                    const node = c as unknown as SemanticNode;
                    switch (c.ctorName) {
                        case 'TableExpression':
                            res.tables.push(node.toObject() as TableDefinition)
                            break;
                        case 'ViewExpression':
                            res.renderer = node.toObject() as { name: string; options: string }
                            break
                        case 'FlagExpression':
                            res.flags = { ...res.flags, ...(node.toObject() as Record<string, unknown>) }
                            break
                    }
                })
            }
            if (selectStatement) {
                res.query = selectStatement.sourceString
            }

            return res
       },
       TableExpression: (_table: ohm.Node, identifier: ohm.Node, _eq: ohm.Node, tableDef: ohm.Node) => {
            const tableNode = tableDef as unknown as SemanticNode;
            return {
                tableAlias: identifier.sourceString,
                ...(tableNode.toObject() as Record<string, unknown>)
            }
       },
       TableDefinition_file: (_file: ohm.Node, args: ohm.Node, _close: ohm.Node) => {
            const argsNode = args as unknown as SemanticNode;
            return {
                arguments: argsNode.toObject(),
                type: 'file'
            }
       },
       TableFileExpressionArgs: (filename: ohm.Node, _sep: ohm.Node, rest: ohm.Node) => {
            let remaining: string[] = []
            if (rest.children.length > 0) {
                const iter = (rest.children[0] as unknown as SemanticNode).asIteration();
                remaining = iter.children.map((c) => c.sourceString.trim())
            }
            return [filename.sourceString.trim(), ...remaining]
       },
       TableDefinition_mdtable: (_file: ohm.Node, args: ohm.Node, _close: ohm.Node) => {
            const iter = (args as unknown as SemanticNode).asIteration();
            return {
                arguments: iter.children.map((c) => c.sourceString.trim()),
                type: 'table'
            }
       },
       FlagExpression_refresh: (_v: ohm.Node) => {
            return { refresh: true }
       },
       FlagExpression_norefresh: (_v: ohm.Node) => {
            return { refresh: false }
       },
       FlagExpression_explain: (_v: ohm.Node) => {
            return { explain: true }
       },
       ViewExpression: (view: ohm.Node, options: ohm.Node) => {
            return {
                type: view.sourceString.trim().toUpperCase(),
                options: (options.sourceString ?? '').trim()
            }
       },
       listElement_quoted: (_q: ohm.Node, value: ohm.Node, _q2: ohm.Node) => value.sourceString,
       listElement_unquoted: (v: ohm.Node) => v.sourceString,
       filename: (v: ohm.Node) => {
            const f = v.sourceString
            if (f.length >= 2 && f[0] === '"' && f[f.length - 1] === '"') {
                return f.substring(1, f.length - 1)
            }
            return v.sourceString.trim()
       },
       _terminal(this: ohm.TerminalNode) {
            return this.sourceString
       }
    }
    const extraFlagsRule = grammar.rules['ExtraFlags'];
    if (extraFlagsRule && typeof extraFlagsRule === 'object' && 'body' in extraFlagsRule) {
        const body = (extraFlagsRule as { body?: { ruleName?: string } }).body;
        if (body?.ruleName) {
            operations['ExtraFlags'] = (flag: ohm.Node) => {
                const key = flag.ctorName.substring('ExtraFlags_'.length)
                return { [key]: true }
            }
        }
    }

    s.addOperation<unknown>('toObject', operations)

    return s
}

export interface TableDefinition {
    type: string,
    tableAlias: string,
    arguments: string[]
}

export interface ParserResult {
    flags: {
        explain: boolean,
        refresh: boolean
    },
    renderer: {
        type: string,
        options: string
    },
    query: string,
    tables: Array<TableDefinition>
}

export const parse = (query: string, views: ViewDefinition[], flags: readonly Flag[] = []) => {
    const grammar = ohm.grammar(SQLSealLangDefinition(views, flags))
    const match = grammar.match(query)
    if (match.succeeded()) {
        // Converting
        const s = generateSemantic(grammar)(match) as unknown as { toObject(): Partial<ParserResult> };
        return s.toObject()
    } else {
        const errMessage = 'message' in match && typeof (match as { message?: unknown }).message === 'string'
            ? (match as { message: string }).message
            : 'Unknown parsing error';
        throw new Error(errMessage)
    }
}


export const parseWithDefaults = (query: string, views: ViewDefinition[], defaultvalues: ParserResult, flags: readonly Flag[] = []): ParserResult => {
    const parsed = parse(query, views, flags)
    return {
        flags: { ...defaultvalues.flags, ...parsed.flags },
        query: parsed.query || defaultvalues.query,
        renderer: { ...defaultvalues.renderer, ...parsed.renderer },
        tables: parsed.tables ?? []
    } satisfies ParserResult
}