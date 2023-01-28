import * as Parser from './z80/parser.js';
import * as Expr from './z80/expr.js';

export interface RefUpdater {
    (arg0: number | string): void;
}

export type Value = string | number | Parser.Expression;

export type Unresolved = {
    expr: string,
    unknown: Set<string>;
    known: { [id: string]: number | string };
}

type ToResolve = Unresolved & {
    target: RefUpdater;
}

export type Resolved = {
    target: RefUpdater;
    value: number | string;
}

export class Scope {
    outer?: Scope;
    symbols: Map<string, Value>;
    waiting: Map<string, ToResolve[]>;

    constructor(outer?: Scope) {
        this.outer = outer;
        this.symbols = new Map();
        this.waiting = new Map();
    }

    has(symbol: string): boolean {
        return this.symbols.has(symbol);
    }

    lookup(symbol: string): Value | undefined {
        return this.symbols.get(symbol) ?? this.outer?.lookup(symbol);
    }

    lookup_resolved(symbol: string): number | string | undefined {
        let val = this.lookup(symbol);
        return (typeof val === "number" || typeof val === "string") ? val : undefined;
    }

    resolve_immediate(expr: Value): string | number | Unresolved {
        switch (typeof expr) {
            case "string":
            case "number":
                return expr;
            default: {
                let vars: { [id: string]: number | string } = {};
                let unknown: Set<string> = new Set();
                for (let v of expr.vars) {
                    let val = this.lookup_resolved(v);
                    if (val === undefined) {
                        unknown.add(v);
                    } else {
                        vars[v] = val;
                    }
                }
                if (unknown.size > 0) {
                    return { expr: expr.expression, unknown: unknown, known: vars };
                } else {
                    return Expr.parse(expr.expression, { variables: vars });
                }
            }
        }
    }

    // return value indicates if the expression was immediately resolvable
    resolve(expr: Value, into: RefUpdater): boolean {
        let result = this.resolve_immediate(expr);
        if (typeof result === "string" || typeof result === "number") {
            into(result);
            return true;
        } else {
            this.wait_for({ target: into, ... result });
            return false;
        }
    }

    private wait_for(unresolved: ToResolve): void {
        for (let k of unresolved.unknown) {
            if (!this.waiting.has(k)) {
                this.waiting.set(k, []);
            }
            this.waiting.get(k)?.push(unresolved);
        }
    }

    set(symbol: string, value: number): Resolved[]  {
        this.symbols.set(symbol, value);

        let resolved: Resolved[] = [];
        if (this.waiting.has(symbol)) {
            for (let unresolved of this.waiting.get(symbol) ?? []) {
                unresolved.known[symbol] = value;
                unresolved.unknown.delete(symbol);
                if (unresolved.unknown.size == 0) {
                    let result = Expr.parse(unresolved.expr, { variables: unresolved.known });
                    resolved.push({
                        target: unresolved.target,
                        value: result
                    });
                }
            }
            this.waiting.delete(symbol);
        }

        resolved.forEach(ref => ref.target(ref.value));
        return resolved;
    }

    // moves all unresolved symbols to parent scope, if any
    defer_unresolved(): void {
        if (this.outer !== undefined) {
            this.waiting.forEach((value, key) => {
                if (!this.outer?.waiting.has(key)) {
                    this.outer?.waiting.set(key, []);
                }
                this.outer?.waiting.get(key)?.push(...value);
            });

            // flush everything
            this.waiting = new Map();
        }
    }
}
