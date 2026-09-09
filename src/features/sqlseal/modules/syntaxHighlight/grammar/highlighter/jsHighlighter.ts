import * as esprima from 'esprima';
import * as estraverse from 'estraverse';

interface Decorator {
    type: 'keyword' | 'identifier' | 'string' | 'string-escape' | 'string-interpolation' |
    'number' | 'comment' | 'function' | 'operator' | 'punctuation' | 'regex' | 'error';
    start: number;
    end: number;
}

function getRange(item: unknown): [number, number] | null {
    if (!item || typeof item !== 'object') return null;
    const rawRange = (item as { range?: unknown }).range;
    if (Array.isArray(rawRange) && rawRange.length >= 2) {
        const start: unknown = rawRange[0];
        const end: unknown = rawRange[1];
        if (typeof start === 'number' && typeof end === 'number') {
            return [start, end];
        }
    }
    return null;
}

/**
 * Highlights JavaScript syntax using Esprima and estraverse
 * @param source - The JavaScript source code to highlight
 * @returns Array of decorator objects for syntax highlighting
 */
function highlightJavaScript(source: string): Decorator[] {
    const decorators: Decorator[] = [];

    // Keywords in JavaScript
    const keywords = new Set([
        'var', 'let', 'const', 'if', 'else', 'switch', 'case', 'default', 'for', 'while', 'do',
        'break', 'continue', 'return', 'function', 'class', 'extends', 'new', 'this', 'super',
        'import', 'export', 'from', 'as', 'async', 'await', 'try', 'catch', 'finally', 'throw',
        'typeof', 'instanceof', 'in', 'of', 'void', 'delete', 'yield', 'static', 'get', 'set',
        'true', 'false', 'null', 'undefined', 'NaN', 'Infinity'
    ]);

    // Helper function to add a decorator
    function addDecorator(type: Decorator['type'], start: number, end: number): void {
        if (start >= 0 && end > start && end <= source.length) {
            decorators.push({ type, start, end });
        }
    }

    function addRangeDecorator(type: Decorator['type'], item: unknown): void {
        const range = getRange(item);
        if (range) {
            addDecorator(type, range[0], range[1]);
        }
    }

    try {
        // Parse the source code with location information and comment handling
        const ast = esprima.parseScript(source, {
            loc: true,
            range: true,
            comment: true,
            tokens: true,
            jsx: true
        });

        // Process comments (they're separate from the AST in Esprima)
        if (ast.comments) {
            for (const comment of ast.comments) {
                addRangeDecorator('comment', comment);
            }
        }

        // Process tokens for basic syntax elements
        if (ast.tokens) {
            for (const token of ast.tokens) {
                const tokenRange = getRange(token);
                if (!tokenRange) continue;
                const [start, end] = tokenRange;

                switch (token.type) {
                    case 'Keyword':
                        addDecorator('keyword', start, end);
                        break;
                    case 'Identifier':
                        // We'll handle function identifiers separately
                        addDecorator('identifier', start, end);
                        break;
                    case 'Punctuator':
                        if (['+', '-', '*', '/', '%', '=', '>', '<', '!', '&', '|', '^', '~', '?', ':'].includes(token.value) ||
                            (token.value.length > 1 && /^[+\-*/%=><!^&|?:]+$/.test(token.value))) {
                            addDecorator('operator', start, end);
                        } else {
                            addDecorator('punctuation', start, end);
                        }
                        break;
                    case 'String': {
                        // String literals include the quotes
                        addDecorator('string', start, end);

                        // Highlight string content differently if needed
                        const stringContent = source.substring(start + 1, end - 1);

                        // Look for escape sequences within the string
                        const escapeRegex = /\\./g;
                        let escapeMatch: RegExpExecArray | null = null;
                        while ((escapeMatch = escapeRegex.exec(stringContent)) !== null) {
                            const escapeStart = start + 1 + escapeMatch.index;
                            const escapeEnd = escapeStart + escapeMatch[0].length;
                            // Add specific decorator for escape sequences
                            addDecorator('string-escape', escapeStart, escapeEnd);
                        }
                        break;
                    }
                    case 'Numeric':
                        addDecorator('number', start, end);
                        break;
                    case 'RegularExpression':
                        addDecorator('regex', start, end);
                        break;
                    case 'Boolean':
                    case 'Null':
                        addDecorator('keyword', start, end);
                        break;
                    case 'Template': {
                        addDecorator('string', start, end);
                        break;
                    }
                }
            }
        }

        // Use estraverse to traverse the AST and identify more complex patterns
        estraverse.traverse(ast, {
            enter: function (rawNode: unknown) {
                if (!rawNode || typeof rawNode !== 'object') return;
                const node = rawNode as Record<string, unknown>;
                const nodeType = typeof node.type === 'string' ? node.type : '';
                switch (nodeType) {
                    case 'FunctionDeclaration':
                        // Function name
                        if (node.id) {
                            addRangeDecorator('function', node.id);
                        }
                        break;

                    case 'MethodDefinition':
                        // Method name in classes
                        if (node.key) {
                            addRangeDecorator('function', node.key);
                        }
                        break;

                    case 'Property':
                        // Methods in object literals
                        if (node.method && node.key) {
                            addRangeDecorator('function', node.key);
                        }
                        break;

                    case 'VariableDeclarator':
                        // Find arrow functions and function expressions assigned to variables
                        if (node.init && typeof node.init === 'object') {
                            const initObj = node.init as Record<string, unknown>;
                            if (initObj.type === 'ArrowFunctionExpression' || initObj.type === 'FunctionExpression') {
                                addRangeDecorator('function', node.id);
                            }
                        }
                        break;

                    case 'CallExpression':
                        // Highlight function calls
                        if (node.callee && typeof node.callee === 'object') {
                            const calleeObj = node.callee as Record<string, unknown>;
                            if (calleeObj.type === 'Identifier') {
                                const name = typeof calleeObj.name === 'string' ? calleeObj.name : '';
                                if (!keywords.has(name)) {
                                    addRangeDecorator('function', calleeObj);
                                }
                            } else if (calleeObj.type === 'MemberExpression' && calleeObj.property && typeof calleeObj.property === 'object') {
                                const propObj = calleeObj.property as Record<string, unknown>;
                                if (propObj.type === 'Identifier') {
                                    addRangeDecorator('function', propObj);
                                }
                            }
                        }
                        break;

                    case 'ClassDeclaration':
                        // Class name
                        if (node.id) {
                            addRangeDecorator('identifier', node.id);
                        }
                        break;

                    case 'ImportDeclaration':
                        // Import specifiers
                        if (Array.isArray(node.specifiers)) {
                            for (const specifier of node.specifiers) {
                                if (specifier && typeof specifier === 'object') {
                                    const s = specifier as Record<string, unknown>;
                                    if (s.local) {
                                        addRangeDecorator('identifier', s.local);
                                    }
                                    if (s.imported) {
                                        addRangeDecorator('identifier', s.imported);
                                    }
                                }
                            }
                        }
                        break;

                    case 'ExportNamedDeclaration':
                    case 'ExportDefaultDeclaration':
                        // Handle export names
                        if (node.declaration && typeof node.declaration === 'object') {
                            const decl = node.declaration as Record<string, unknown>;
                            if (decl.id) {
                                addRangeDecorator('identifier', decl.id);
                            }
                        }
                        if (Array.isArray(node.specifiers)) {
                            for (const specifier of node.specifiers) {
                                if (specifier && typeof specifier === 'object') {
                                    const s = specifier as Record<string, unknown>;
                                    if (s.local) {
                                        addRangeDecorator('identifier', s.local);
                                    }
                                    if (s.exported) {
                                        addRangeDecorator('identifier', s.exported);
                                    }
                                }
                            }
                        }
                        break;

                    case 'TemplateLiteral':
                        // Handle template literals and their expressions
                        if (Array.isArray(node.quasis)) {
                            for (const quasi of node.quasis) {
                                addRangeDecorator('string', quasi);
                            }
                        }

                        // Handle template expressions ${...}
                        if (Array.isArray(node.expressions)) {
                            for (const expr of node.expressions) {
                                const exprRange = getRange(expr);
                                if (exprRange) {
                                    const exprStart = exprRange[0] - 2; // For the ${ part
                                    if (exprStart >= 0 && source.substring(exprStart, exprStart + 2) === '${') {
                                        addDecorator('string-interpolation', exprStart, exprStart + 2);
                                        const closingBrace = exprRange[1]; // The end range should be right after the expression
                                        if (closingBrace < source.length && source[closingBrace] === '}') {
                                            addDecorator('string-interpolation', closingBrace, closingBrace + 1);
                                        }
                                    }
                                }
                            }
                        }
                        break;
                }
            }
        });

        // Sort decorators by start position
        return decorators.sort((a, b) => a.start - b.start);
    } catch (error) {
        // If parsing fails, return an error decorator
        console.error('Parsing error:', error);
        return [{ type: 'error', start: 0, end: source.length }];
    }
}

// Helper function to apply highlighting to HTML
function applyHighlighting(source: string, decorators: Decorator[]): string {
    let html = '';
    let lastIndex = 0;

    // First, resolve overlapping decorators by sorting and removing overlaps
    // We prioritize more specific types (like string-escape) over more general types (like string)
    const resolvedDecorators = resolveOverlappingDecorators(decorators);

    for (const decorator of resolvedDecorators) {
        // Add any text before this decorator
        html += escapeHtml(source.substring(lastIndex, decorator.start));

        // Add the decorated text
        const content = escapeHtml(source.substring(decorator.start, decorator.end));
        html += `<span class="js-${decorator.type}">${content}</span>`;

        lastIndex = decorator.end;
    }

    // Add any remaining text
    html += escapeHtml(source.substring(lastIndex));

    return html;
}

// Helper function to resolve overlapping decorators
function resolveOverlappingDecorators(decorators: Decorator[]): Decorator[] {
    // First, sort by start position and then by length (shortest first)
    const sorted = [...decorators].sort((a, b) => {
        if (a.start !== b.start) return a.start - b.start;
        return (a.end - a.start) - (b.end - b.start);
    });

    // Then resolve overlaps by splitting overlapping decorators
    const result: Decorator[] = [];
    let lastEnd = 0;

    for (const decorator of sorted) {
        // Skip if this decorator is completely contained in the previous one
        if (decorator.start >= lastEnd) {
            result.push(decorator);
            lastEnd = decorator.end;
        } else if (decorator.end > lastEnd) {
            // Partial overlap - only add the non-overlapping part
            if (decorator.start < lastEnd && decorator.end > lastEnd) {
                result.push({
                    type: decorator.type,
                    start: lastEnd,
                    end: decorator.end
                });
                lastEnd = decorator.end;
            }
        }
        // Completely contained - skip it
    }

    return result;
}

// Helper function to escape HTML special characters
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export { highlightJavaScript, applyHighlighting };

// Usage example:
// import { highlightJavaScript, applyHighlighting } from './esprima-js-highlighter';
// 
// const source = `
// // This is a comment
// function calculateTotal(items) {
//   return items
//     .map(item => item.price * item.quantity)
//     .reduce((total, value) => total + value, 0);
// }
// 
// class ShoppingCart {
//   constructor() {
//     this.items = [];
//   }
//   
//   addItem(item) {
//     this.items.push(item);
//   }
//   
//   get total() {
//     return calculateTotal(this.items);
//   }
// }
// 
// export default ShoppingCart;
// `;
// 
// const decorators = highlightJavaScript(source);
// const html = applyHighlighting(source, decorators);
// document.getElementById('code-display').innerHTML = html;