import { Align, Org, Phase, EndPhase, Block, EndBlock, Bytes, Expression, Relative, AnyResult, Label,
         Defw, Defb, Defs, Include, MacroDef, MacroCall, Equ, parse }
    from './z80/parser.js';
import { Scope, Value, RefUpdater } from './scope.js';

function isRelative(v: null | string | number | Expression | Relative): v is Relative {
    return (v as Relative)?.relative !== undefined;
}

function isExpression(v: null | string | number | Expression | Relative): v is Expression {
    return (v as Expression)?.expression !== undefined;
}

// A fragment of assembled bytes
export type Assembly = {
    bytes: Uint8Array;          // the assembled bytes
    org: number;                // where they belong in memory
};

type Macro = {
    params: string[];
    body: AnyResult[];
};

export class Compiler {
    org: number;
    phase: number;
    output: Uint8Array;
    scope: Scope;
    globals: Scope;
    macros: Map<String, Macro>
    macro: Macro | undefined;

    constructor(output: Uint8Array) {
        this.org = this.phase = 0;
        this.globals = this.scope = new Scope();
        this.output = output;
        this.macros = new Map();

        // reset memory to noise
        crypto.getRandomValues(this.output);
    }

    async compile_statement(stmt: AnyResult): Promise<Assembly[]> {
        switch (stmt.type) {
            case "comment": return [];
            case "org": return this.compile_org(stmt);
            case "phase": return this.compile_phase(stmt);
            case "endphase": return this.compile_endphase(stmt);
            case "align": return this.compile_align(stmt);
            case "block": return this.compile_block(stmt);
            case "endblock": return this.compile_endblock(stmt);
            case "bytes": return this.compile_bytes(stmt);
            case "defb": return this.compile_defx(stmt);
            case "defw": return this.compile_defx(stmt);
            case "defs": return this.compile_defs(stmt);
            case "label": return this.compile_label(stmt);
            case "include": return this.compile_include(stmt);
            case "macrodef": return this.compile_macrodef(stmt);
            case "macrocall": return this.compile_macrocall(stmt);
            case "equ": return this.compile_equ(stmt);
            default:
                throw "unknown statement type " + stmt.type;
        }
    }

    async compile_macro(macro: Macro, stmt: AnyResult): Promise<Assembly[]> {
        switch (stmt.type) {
            case "comment": return [];
            case "org":
            case "phase":
            case "endphase":
            case "align":
            case "block":
            case "endblock":
            case "bytes":
            case "defb":
            case "defw":
            case "defs":
            case "label":
                macro.body.push(stmt);
                return [];
            case "macrocall": return this.compile_macrocall(stmt);
            case "macrodef":
                throw "nested macros are not supported"
            case "endmacro":
                this.macro = undefined;
                return [];
            default:
                throw "unknown statement type " + stmt.type;
        }
    }

    async compile(source: AnyResult[]): Promise<Assembly[]> {
        let promises = await Promise.all(source.flatMap(stmt => {
            if (this.macro === undefined) {
                return this.compile_statement(stmt);
            } else {
                return this.compile_macro(this.macro, stmt);
            }
        }));

        return promises.flat();
    }

    // finalise compilation, checking for any remaining undefined symbols, unclosed blocks/macros, etc
    finalise(): void {
        this.scope.report_unresolved();
        // TODO
    }

    private as_byte(val: number | string): number {
        if (typeof val === "string") {
            let bytes = new TextEncoder().encode(val);
            if (bytes.length !== 1) {
                throw "overflow converting string to number";
            }
            val = bytes[0];
        }

        if (val < -128 || val > 255) {
            throw "byte expression out of range: " + val;
        }

        return val;
    }

    private as_word(val: number | string): number {
        if (typeof val === "string") {
            let bytes = new TextEncoder().encode(val);
            if (bytes.length !== 1 && bytes.length !== 2) {
                throw "overflow converting string to number";
            }
            val = bytes[0] + (bytes[1] ?? 0) << 8;
        }
        if (val < -32768 || val > 65535) {
            throw "word expression out of range: " + val;
        }

        return val;
    }

    private async compile_org(stmt: Org): Promise<Assembly[]> {
        let val = this.scope.resolve(stmt.org, () => {});
        if (typeof val === "number") {
            this.org = this.phase = val;
        } else {
            throw "org value MUST be resolvable in first pass";
        }

        return [];
    }

    private async compile_phase(stmt: Phase): Promise<Assembly[]> {
        let val = this.scope.resolve(stmt.phase, () => {});
        if (typeof val === "number") {
            // setting phase while already phased just sets a new logical address
            this.phase = val;
        } else {
            throw "phase value MUST be resolvable in first pass";
        }

        return [];
    }

    private async compile_endphase(_stmt: EndPhase): Promise<Assembly[]> {
        // endphase/phase are not matching pairs, and endphase on its own is legal
        this.phase = this.org;

        return [];
    }

    private async compile_align(stmt: Align): Promise<Assembly[]> {
        // align works against the logical address but will add offset to phyiscal as well
        let align = this.scope.resolve_immediate(stmt.align);
        let fill = this.scope.resolve_immediate(stmt.fill);
        let max = this.scope.resolve_immediate(stmt.maximum);

        if (typeof align !== "number" || typeof fill !== "number" || typeof max !== "number") {
            throw "align MUST be resolvable in first pass";
        }

        let offset = align - (this.phase % align);
        if (offset !== align && offset < max) {
            this.output.fill(fill, this.org, this.org + offset);
            this.phase += offset;
            this.org += offset;
        }

        return [];
    }

    private async compile_block(_stmt: Block): Promise<Assembly[]> {
        this.scope = new Scope(this.scope);

        return [];
    }

    private async compile_endblock(_stmt: EndBlock): Promise<Assembly[]> {
        // forward references found in this scope get moved to the parent scope
        if (this.scope.outer === undefined) {
            throw ".endblock without matching .block";
        } else {
            this.scope.defer_unresolved();
            this.scope = this.scope.outer;
        }

        return [];
    }

    private resolve_relative(assembly: Assembly, idx: number, base: number): RefUpdater {
        return (resolved: number | string) => {
            let val = this.as_word(resolved);
            let gap = val - base;
            if (gap > 127 || gap < -128) {
                throw "relative jump out of range";
            }
            assembly.bytes[idx] = gap;
        };
    }

    private resolve_byte(assembly: Assembly, idx: number): RefUpdater {
        return (resolved: number | string) => {
            assembly.bytes[idx] = this.as_byte(resolved);
        }
    }

    private resolve_word(assembly: Assembly, idx: number): RefUpdater {
        return (resolved: number | string) => {
            resolved = this.as_word(resolved);
            assembly.bytes[idx] = resolved & 0xff;
            assembly.bytes[idx+1] = resolved >> 8;
        }
    }

    private async compile_defx(stmt: Defw | Defb): Promise<Assembly[]> {
        // Byte or word sized constants?
        let sizing = stmt.type === "defb" ? 1 : 2;

        // take a pass through the bytes resolving expressions and expanding strings
        let bytes = stmt.bytes.filter(byte => byte !== null).flatMap(byte => {
            // If an expression is resolvable now, do so
            if (isExpression(byte)) {
                let value = this.scope.resolve_immediate(byte);
                if (typeof value === "string") {
                    let utf8 = [ ... new TextEncoder().encode(value) ];
                    if (utf8.length % sizing != 0) {
                        utf8.push(0);
                    }
                    return utf8;
                } else if (typeof value === "number") {
                    if (sizing == 1) {
                        if (value > 255 || value < -128) {
                            throw "numeric overflow: value " + value + " from '" + byte.expression + "' out of range";
                        }
                        return [value & 0xff];
                    } else {
                        if (value > 65535 || value < -32768) {
                            throw "numeric overflow: value " + value + " from '" + byte.expression + "' out of range";
                        }
                        return [value & 0xff, (value >> 8) & 0xff];
                    }
                } else {
                    // an unresolved expression, one or two bytes for defb or defw, respectively
                    return [byte, 0].slice(0, sizing);
                }
            } else {
                return [byte];
            }
        });

        let assembly = {
            bytes: this.output.subarray(this.org, this.org + bytes.length),
            org: this.org
        };

        assembly.bytes.set(bytes.map((byte, idx) => {
            if (isExpression(byte)) {
                if (sizing == 1) {
                    this.scope.resolve(byte, this.resolve_byte(assembly, idx));
                } else {
                    this.scope.resolve(byte, this.resolve_word(assembly, idx));
                }
                return 0;
            } else {
                return byte;
            }
        }));

        this.org += assembly.bytes.length;
        this.phase += assembly.bytes.length;

        return [assembly];
    }

    private async compile_bytes(stmt: Bytes): Promise<Assembly[]> {
        let assembly = {
            bytes: this.output.subarray(this.org, this.org + stmt.bytes.length),
            org: this.org
        };

        for (let idx = 0; idx < stmt.bytes.length; idx++) {
            let byte = stmt.bytes[idx];

            if (byte === null) {
                throw "unexpected null byte at " + stmt.location;
            }

            if (typeof byte === "number") {
                assembly.bytes[idx] = byte;
            } else if (isRelative(byte)) {
                // A Relative expression should turn into a 16-bit value with -128...127 of phase
                // Relative bytes are always relative to the address immediately after the byte
                this.scope.resolve((byte as Relative).relative,
                    this.resolve_relative(assembly, idx, this.phase + idx + 1));
            } else {
                if (stmt.bytes[idx+1] === null) {
                    this.scope.resolve(byte, this.resolve_word(assembly, idx++));
                } else {
                    this.scope.resolve(byte, this.resolve_byte(assembly, idx));
                }
            }

        }

        this.org += assembly.bytes.length;
        this.phase += assembly.bytes.length;

        return [assembly];
    }

    private async compile_defs(stmt: Defs): Promise<Assembly[]> {
        let val = this.scope.resolve_immediate(stmt.defs);
        if (typeof val !== "string" && typeof val !== "number") {
            throw "defs size must be resolvable in one pass";
        }

        val = this.as_word(val);

        if (val + this.org > 65535) {
            throw "defs overflows remaining memory";
        }

        let assembly = {
            bytes: this.output.subarray(this.org, this.org + val),
            org: this.org
        };

        if (stmt.init !== null) {
            this.scope.resolve(stmt.init, fill => {
                assembly.bytes.fill(this.as_byte(fill));
            })
        } else {
            assembly.bytes.fill(0);
        }

        this.org += val;
        this.phase += val;

        return [assembly];
    }

    private async compile_label(stmt: Label): Promise<Assembly[]> {
        // add the label to the appropriate scope
        if (stmt.public) {
            // prevent redefinition
            if (this.globals.has(stmt.label)) {
                throw "redefined label " + stmt.label;
            }
            this.globals.set(stmt.label, this.phase);
        } else {
            // prevent redefinition
            if (this.scope.has(stmt.label)) {
                throw "redefined label " + stmt.label;
            }
            this.scope.set(stmt.label, this.phase);
        }

        return [];
    }

    private async compile_include(stmt: Include): Promise<Assembly[]> {
        const resource = await fetch('../z80/' + stmt.include);

        if (!resource.ok) {
            throw "failed to include " + stmt.include;
        }

        const source = await resource.text()

        const stmts = parse(source, { line: 0, source: stmt });

        return this.compile(stmts);
    }

    private async compile_macrodef(stmt: MacroDef): Promise<Assembly[]> {
        this.macro = {
            params: stmt.params,
            body: [],
        };
        this.macros.set(stmt.macrodef, this.macro);
        return [];
    }

    private async compile_macrocall(stmt: MacroCall): Promise<Assembly[]> {
        let macro = this.macros.get(stmt.macrocall);
        if (macro !== undefined) {
            if (stmt.args?.length !== macro.params?.length) {
                throw "invalid number of args for macro call";
            }

            let args = new Map<string, Value>();
            for (let i = 0; i < macro.params?.length ?? 0; i++) {
                args.set(macro.params[i], stmt.args[i]);
            }

            this.scope.push_overlay(args);
            let asm = this.compile(macro.body);
            this.scope.pop_overlay();
            return asm;
        } else {
            throw("undefined macro: " + stmt.macrocall);
        }
    }

    private async compile_equ(stmt: Equ): Promise<Assembly[]> {
        let val = this.scope.resolve_immediate(stmt.equ);
        if (typeof val !== "number") {
            throw "defs size must be resolvable in one pass";
        }

        if (this.scope.has(stmt.label)) {
            throw "redefined label " + stmt.label;
        }
        this.scope.set(stmt.label, val);

        return [];
    }

    /*
                            case "equ": {
                                // prevent redefinition
                                if (scope.symbols.has(stmt.label)) {
                                    throw "fit";
                                }
                                // try to resolve the bastard
                                console.log("equ", stmt);
                                // add the equate to the current scope
                                //let resolved = scope.set(stmt.label, stmt.equ);
                                break;
                            }
                        }
*/
}
