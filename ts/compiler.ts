import { Align, Org, Phase, EndPhase, Block, EndBlock, Emitted, StatementType, Expression, Relative, AnyResult,
        Label, }
    from './z80/parser.js';
import { Scope, RefUpdater } from './scope.js';

function isRelative(v: null | string | number | Expression | Relative): v is Relative {
    return (v as Relative)?.relative !== undefined;
}

function isExpression(v: null | string | number | Expression | Relative): v is Expression {
    return (v as Expression)?.expression !== undefined;
}

function isWordExpression(v: null | string | number | Expression | WordExpression | Relative): v is WordExpression {
    return (v as WordExpression)?.size === 2;
}

// A fragment of assembled bytes
export type Assembly = {
    bytes: Uint8Array;          // the assembled bytes
    org: number;                // where they belong in memory
};

type WordExpression = Expression & {
    size: 2;
}

export class Compiler {
    org: number;
    phase: number;
    output: Uint8Array;
    scope: Scope;
    globals: Scope;

    constructor(output: Uint8Array) {
        this.org = this.phase = 0;
        this.globals = this.scope = new Scope();
        this.output = output;

        // reset memory to noise
        crypto.getRandomValues(this.output);
    }

    compile(source: AnyResult[]): Assembly[] {
        return source.flatMap(stmt => {
            switch (stmt.type) {
                case "comment": return [];
                case "org": this.compile_org(stmt); return [];
                case "phase": this.compile_phase(stmt); return [];
                case "endphase": this.compile_endphase(stmt); return [];
                case "align": this.compile_align(stmt); return [];
                case "block": this.compile_block(stmt); return [];
                case "endblock": this.compile_endblock(stmt); return [];
                case "bytes":
                case "defb": return this.compile_bytes(stmt, 1);
                case "defw": return this.compile_bytes(stmt, 2);
                case "label": this.compile_label(stmt); return [];
                default:
                    throw "unknown statement type " + stmt.type;
            }
        });
    }

    // finalise compilation, checking for any remaining undefined symbols, unclosed blocks/macros, etc
    finalise(): void {
        // TODO
    }

    private compile_org(stmt: Org): void {
        let val = this.scope.resolve(stmt.org, () => {});
        if (typeof val === "number") {
            this.org = this.phase = val;
        } else {
            throw "org value MUST be resolvable in first pass";
        }
    }

    private compile_phase(stmt: Phase): void {
        let val = this.scope.resolve(stmt.phase, () => {});
        if (typeof val === "number") {
            // setting phase while already phased just sets a new logical address
            this.phase = val;
        } else {
            throw "phase value MUST be resolvable in first pass";
        }
    }

    private compile_endphase(_stmt: EndPhase): void {
        // endphase/phase are not matching pairs, and endphase on its own is legal
        this.phase = this.org;
    }

    private compile_align(stmt: Align): void {
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
    }

    // compile_include(stmt: Include): void {}
    // compile_incbin(stmt: Include): void {}
    // compile_macrocall(stmt: Include): void {}

    private compile_block(_stmt: Block): void {
        this.scope = new Scope(this.scope);
    }

    private compile_endblock(_stmt: EndBlock): void {
        // forward references found in this scope get moved to the parent scope
        if (this.scope.outer === undefined) {
            throw ".endblock without matching .block";
        } else {
            this.scope.defer_unresolved();
            this.scope = this.scope.outer;
        }
    }

    private resolve_relative(assembly: Assembly, idx: number, base: number): RefUpdater {
        return (resolved: number | string) => {
            let val = resolved;
            if (typeof val === "string") {
                // TODO: utf8 convert first
                if (val.length !== 1) {
                    throw "invalid relative jump destination";
                }
                val = val.charCodeAt(0);
            }
            let gap = val - base;
            if (gap > 127 || gap < -128) {
                throw "relative jump out of range";
            }
            assembly.bytes[idx] = gap;
        };
    }

    private resolve_byte(assembly: Assembly, idx: number): RefUpdater {
        return (resolved: number | string) => {
            if (typeof resolved === "string") {
                let bytes = new TextEncoder().encode(resolved);
                if (bytes.length !== 1) {
                    throw "overflow converting string to number";
                }
                assembly.bytes[idx] = bytes[0];
            } else {
                if (resolved < -128 || resolved > 255) {
                    throw "byte expression out of range: " + resolved;
                }
                assembly.bytes[idx] = resolved;
            }
        }
    }

    private resolve_word(assembly: Assembly, idx: number): RefUpdater {
        return (resolved: number | string) => {
            if (typeof resolved === "string") {
                let bytes = new TextEncoder().encode(resolved);
                if (bytes.length !== 1 && bytes.length !== 2) {
                    throw "overflow converting string to number";
                }
                assembly.bytes[idx] = bytes[0];
                assembly.bytes[idx+1] = bytes[0] ?? 0;
            } else {
                if (resolved < -32768 || resolved > 65535) {
                    throw "word expression out of range: " + resolved;
                }
                assembly.bytes[idx] = resolved & 0xff;
                assembly.bytes[idx+1] = resolved >> 8;
            }
        }
    }

    // Invoked for bytes, defb, and defw
    private compile_bytes<T extends StatementType>(stmt: Emitted<T>, sizing: number): Assembly[] {
        // coalesce [<expr>, null] pairs into WordExpressions
        let bytes: (string | number | WordExpression | Expression | Relative)[] = [];
        for (let i = 0; i < stmt.bytes.length; i++) {
            let byte = stmt.bytes[i];
            if (isExpression(byte) && stmt.bytes[i+1] === null) {
                bytes.push({size: 2, ... byte});
                i = i + 1;
            } else if (byte === null) {
                console.log(stmt.bytes, bytes, i, byte);
                throw "unexpected null byte";
            } else {
                bytes.push(byte);
            }
        }

        // take a pass through the bytes resolving expressions and expanding strings
        bytes = bytes.flatMap(byte => {
            // If an expression is resolvable now, do so
            if (isExpression(byte)) {
                let value = this.scope.resolve_immediate(byte);
                if (typeof value === "string") {
                    let utf8 = [ ... new TextEncoder().encode(value) ];
                    if (utf8.length % sizing != 0) {
                        utf8.push(...Array(sizing - utf8.length % sizing).fill(0));
                    }
                    return utf8;
                } else if (typeof value === "number") {
                    let orig = value;
                    let bytes = [value & 0xff];
                    if (isWordExpression(byte)) {
                        value = value >> 8;
                        bytes.push(value & 0xff);
                    } else {
                        for (let i = 1; i < sizing; i++) {
                            value = value >> 8;
                            bytes.push(value & 0xff);
                        }
                    }
                    if (value > 255) {
                        throw "numeric overflow: value " + orig + " too large";
                    }
                    return bytes;
                } else {
                    return [byte, 0] as (string | number | WordExpression | Expression | Relative)[];
                }
            }

            return [byte];
        });

        let assembly = {
            bytes: this.output.subarray(this.org, this.org + bytes.length),
            org: this.org
        };

        for (let idx = 0; idx < bytes.length; idx++) {
            let byte: string | number | WordExpression | Expression | Relative = bytes[idx];

            if (typeof byte === "number") {
                assembly.bytes[idx] = byte;
            } else if (isRelative(byte)) {
                // A Relative expression should turn into a 16-bit value with -128...127 of phase
                // Relative bytes are always relative to the address immediately after the byte
                this.scope.resolve((byte as Relative).relative,
                    this.resolve_relative(assembly, idx, this.phase + idx + 1));
            } else {
                if (bytes[idx+1] === null) {
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

    private compile_label(stmt: Label) {
        // add the label to the appropriate scope
        if (stmt.public) {
            // prevent redefinition
            if (this.globals.symbols.has(stmt.label)) {
                throw "redefined label " + stmt.label;
            }
            this.globals.set(stmt.label, this.phase);
        } else {
            // prevent redefinition
            if (this.scope.symbols.has(stmt.label)) {
                throw "redefined label " + stmt.label;
            }
            this.scope.set(stmt.label, this.phase);
        }
    }

    /*
                            case "macrodef":
                                throw "fit";
                            case "endmacro":
                                throw "fit";
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
                            case "defs": {
                                let val = scope.resolve(stmt.defs, () => {});
                                if (typeof val === "number") {
                                    output.fill(0, org, org + val);
                                    phase += val;
                                    org += val;
                                } else {
                                    throw "defs value MUST be resolvable in first pass";
                                }
                                break;
                            }
                            case "label":
                                // prevent redefinition
                                if (scope.symbols.has(stmt.label)) {
                                    throw "fit";
                                }
                                // add the label to the appropriate scope
                                if (stmt.public) {
                                    globals.set(stmt.label, phase);
                                } else {
                                    scope.set(stmt.label, phase);
                                }
                                break;
                            case "if":
                            case "else":
                            case "endif":
                                throw "fit";
                        }
*/
}
