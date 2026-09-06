export class Logger {
    constructor(verbose: boolean) {
        if (verbose) {
            this.console = console
        } else {
            this.console = {
                log: () => { },
                error: () => { },
                warn: () => { },
                debug: () => { },
                trace: () => { }
            }
        }
    }

    private console: Pick<typeof console, 'log' | 'error' | 'warn' | 'debug' | 'trace'>

    log(...args: unknown[]) {
        this.console.log(...args)
    }

    error(...args: unknown[]) {
        this.console.error(...args)
    }

    warn(...args: unknown[]) {
        this.console.warn(...args)
    }

    debug(...args: unknown[]) {
        this.console.debug(...args)
    }

    trace(...args: unknown[]) {
        this.console.trace(...args)
    }
}