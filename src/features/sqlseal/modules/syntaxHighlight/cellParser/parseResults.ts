import { ModernCellParser } from "./ModernCellParser";

let uniqueIdCounter = 0;
const uniqueId = (prefix = "") => `${prefix}${++uniqueIdCounter}`;

type OnSerialisation = (el: HTMLElement) => unknown;

export class ParseResults {

    functions: ((parentEl: HTMLElement) => void)[] = []

    constructor(
        private readonly cellParser: ModernCellParser,
        private readonly serialise?: OnSerialisation
    ) { }

    parse(data: Record<string, unknown>[], columns: string[]) {
        this.functions = []
        return data.map(d => {
            const res: Record<string, unknown> = {}
            for (const col of columns) {
                const rawVal = d[col];
                const data = this.cellParser.prepare(rawVal !== undefined && rawVal !== null ? String(rawVal) : "")
                if (data instanceof Element) {
                    if (this.serialise) {
                        res[col] = this.serialise(data)
                    } else {
                        res[col] = data
                    }
                } else if (typeof data === 'string') {
                    res[col] = data
                } else if (typeof data === 'number') {
                    res[col] = data.toString()
                } else if (!data) {
                    res[col] = ''
                } else {
                    if (!this.serialise) {
                        res[col] = data.element
                        this.functions.push((_parentEl) => {
                            if (data.onRunCallback) {
                                data.onRunCallback(data.element)
                            }
                        })
                    } else {
                        const id = uniqueId('sqlseal__')
                        data.element.id = id
                        res[col] = this.serialise(data.element)
                        this.functions.push((parentEl: HTMLElement) => {
                            const resultingElement = parentEl.querySelector<HTMLElement>('#' + id)
                            if (!resultingElement) {
                                return
                            }
                            if (data.onRunCallback) {
                                data.onRunCallback(resultingElement)
                            }
                        })
                    }
                    
                }
            }
            return res
        })
    }

    renderAsString(data: Record<string, unknown>[], columns: string[]) {
        return data.map(d => {
            const res: Record<string, string> = {}
            for (const col of columns) {
                const rawVal = d[col];
                res[col] = this.cellParser.renderAsString(rawVal !== undefined && rawVal !== null ? String(rawVal) : "")
            }
            return res
        })
    }

    initialise(parentEl: HTMLElement) {
        this.functions.forEach(fn => fn(parentEl))
    }
}