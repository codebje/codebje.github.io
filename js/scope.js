import * as Expr from './z80/expr.js';
export class Scope {
    outer;
    symbols;
    waiting;
    constructor(outer) {
        this.outer = outer;
        this.symbols = new Map();
        this.waiting = new Map();
    }
    has(symbol) {
        return this.symbols.has(symbol);
    }
    lookup(symbol) {
        return this.symbols.get(symbol) ?? this.outer?.lookup(symbol);
    }
    lookup_resolved(symbol) {
        let val = this.lookup(symbol);
        return (typeof val === "number" || typeof val === "string") ? val : undefined;
    }
    resolve_immediate(expr) {
        switch (typeof expr) {
            case "string":
            case "number":
                return expr;
            default: {
                let vars = {};
                let unknown = new Set();
                for (let v of expr.vars) {
                    let val = this.lookup_resolved(v);
                    if (val === undefined) {
                        unknown.add(v);
                    }
                    else {
                        vars[v] = val;
                    }
                }
                if (unknown.size > 0) {
                    return { expr: expr.expression, unknown: unknown, known: vars };
                }
                else {
                    return Expr.parse(expr.expression, { variables: vars });
                }
            }
        }
    }
    // return value indicates if the expression was immediately resolvable
    resolve(expr, into) {
        let result = this.resolve_immediate(expr);
        if (typeof result === "string" || typeof result === "number") {
            into(result);
            return true;
        }
        else {
            this.wait_for({ target: into, ...result });
            return false;
        }
    }
    wait_for(unresolved) {
        for (let k of unresolved.unknown) {
            if (!this.waiting.has(k)) {
                this.waiting.set(k, []);
            }
            this.waiting.get(k)?.push(unresolved);
        }
    }
    set(symbol, value) {
        this.symbols.set(symbol, value);
        let resolved = [];
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
    defer_unresolved() {
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
    // report any remaining unresolved references
    report_unresolved() {
        if (this.waiting.size !== 0) {
            console.log(this.waiting.keys());
            throw "Unresolved symbol(s)";
        }
    }
}
//# sourceMappingURL=scope.js.map