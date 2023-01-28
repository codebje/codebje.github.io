import { Scope } from './scope.js';
function isRelative(v) {
    return v?.relative !== undefined;
}
function isExpression(v) {
    return v?.expression !== undefined;
}
function isWordExpression(v) {
    return v?.size === 2;
}
export class Compiler {
    org;
    phase;
    output;
    scope;
    globals;
    constructor(output) {
        this.org = this.phase = 0;
        this.globals = this.scope = new Scope();
        this.output = output;
        // reset memory to noise
        crypto.getRandomValues(this.output);
    }
    compile(source) {
        return source.flatMap(stmt => {
            switch (stmt.type) {
                case "comment": return [];
                case "org":
                    this.compile_org(stmt);
                    return [];
                case "phase":
                    this.compile_phase(stmt);
                    return [];
                case "endphase":
                    this.compile_endphase(stmt);
                    return [];
                case "align":
                    this.compile_align(stmt);
                    return [];
                case "block":
                    this.compile_block(stmt);
                    return [];
                case "endblock":
                    this.compile_endblock(stmt);
                    return [];
                case "bytes":
                case "defb": return this.compile_bytes(stmt, 1);
                case "defw": return this.compile_bytes(stmt, 2);
                case "label":
                    this.compile_label(stmt);
                    return [];
                default:
                    throw "unknown statement type " + stmt.type;
            }
        });
    }
    // finalise compilation, checking for any remaining undefined symbols, unclosed blocks/macros, etc
    finalise() {
        // TODO
    }
    compile_org(stmt) {
        let val = this.scope.resolve(stmt.org, () => { });
        if (typeof val === "number") {
            this.org = this.phase = val;
        }
        else {
            throw "org value MUST be resolvable in first pass";
        }
    }
    compile_phase(stmt) {
        let val = this.scope.resolve(stmt.phase, () => { });
        if (typeof val === "number") {
            // setting phase while already phased just sets a new logical address
            this.phase = val;
        }
        else {
            throw "phase value MUST be resolvable in first pass";
        }
    }
    compile_endphase(_stmt) {
        // endphase/phase are not matching pairs, and endphase on its own is legal
        this.phase = this.org;
    }
    compile_align(stmt) {
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
    compile_block(_stmt) {
        this.scope = new Scope(this.scope);
    }
    compile_endblock(_stmt) {
        // forward references found in this scope get moved to the parent scope
        if (this.scope.outer === undefined) {
            throw ".endblock without matching .block";
        }
        else {
            this.scope.defer_unresolved();
            this.scope = this.scope.outer;
        }
    }
    resolve_relative(assembly, idx, base) {
        return (resolved) => {
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
    resolve_byte(assembly, idx) {
        return (resolved) => {
            if (typeof resolved === "string") {
                let bytes = new TextEncoder().encode(resolved);
                if (bytes.length !== 1) {
                    throw "overflow converting string to number";
                }
                assembly.bytes[idx] = bytes[0];
            }
            else {
                if (resolved < -128 || resolved > 255) {
                    throw "byte expression out of range: " + resolved;
                }
                assembly.bytes[idx] = resolved;
            }
        };
    }
    resolve_word(assembly, idx) {
        return (resolved) => {
            if (typeof resolved === "string") {
                let bytes = new TextEncoder().encode(resolved);
                if (bytes.length !== 1 && bytes.length !== 2) {
                    throw "overflow converting string to number";
                }
                assembly.bytes[idx] = bytes[0];
                assembly.bytes[idx + 1] = bytes[0] ?? 0;
            }
            else {
                if (resolved < -32768 || resolved > 65535) {
                    throw "word expression out of range: " + resolved;
                }
                assembly.bytes[idx] = resolved & 0xff;
                assembly.bytes[idx + 1] = resolved >> 8;
            }
        };
    }
    // Invoked for bytes, defb, and defw
    compile_bytes(stmt, sizing) {
        // coalesce [<expr>, null] pairs into WordExpressions
        let bytes = [];
        for (let i = 0; i < stmt.bytes.length; i++) {
            let byte = stmt.bytes[i];
            if (isExpression(byte) && stmt.bytes[i + 1] === null) {
                bytes.push({ size: 2, ...byte });
                i = i + 1;
            }
            else if (byte === null) {
                console.log(stmt.bytes, bytes, i, byte);
                throw "unexpected null byte";
            }
            else {
                bytes.push(byte);
            }
        }
        // take a pass through the bytes resolving expressions and expanding strings
        bytes = bytes.flatMap(byte => {
            // If an expression is resolvable now, do so
            if (isExpression(byte)) {
                let value = this.scope.resolve_immediate(byte);
                if (typeof value === "string") {
                    let utf8 = [...new TextEncoder().encode(value)];
                    if (utf8.length % sizing != 0) {
                        utf8.push(...Array(sizing - utf8.length % sizing).fill(0));
                    }
                    return utf8;
                }
                else if (typeof value === "number") {
                    let orig = value;
                    let bytes = [value & 0xff];
                    if (isWordExpression(byte)) {
                        value = value >> 8;
                        bytes.push(value & 0xff);
                    }
                    else {
                        for (let i = 1; i < sizing; i++) {
                            value = value >> 8;
                            bytes.push(value & 0xff);
                        }
                    }
                    if (value > 255) {
                        throw "numeric overflow: value " + orig + " too large";
                    }
                    return bytes;
                }
                else {
                    return [byte, 0];
                }
            }
            return [byte];
        });
        let assembly = {
            bytes: this.output.subarray(this.org, this.org + bytes.length),
            org: this.org
        };
        for (let idx = 0; idx < bytes.length; idx++) {
            let byte = bytes[idx];
            if (typeof byte === "number") {
                assembly.bytes[idx] = byte;
            }
            else if (isRelative(byte)) {
                // A Relative expression should turn into a 16-bit value with -128...127 of phase
                // Relative bytes are always relative to the address immediately after the byte
                this.scope.resolve(byte.relative, this.resolve_relative(assembly, idx, this.phase + idx + 1));
            }
            else {
                if (bytes[idx + 1] === null) {
                    this.scope.resolve(byte, this.resolve_word(assembly, idx++));
                }
                else {
                    this.scope.resolve(byte, this.resolve_byte(assembly, idx));
                }
            }
        }
        this.org += assembly.bytes.length;
        this.phase += assembly.bytes.length;
        return [assembly];
    }
    compile_label(stmt) {
        // add the label to the appropriate scope
        if (stmt.public) {
            // prevent redefinition
            if (this.globals.symbols.has(stmt.label)) {
                throw "redefined label " + stmt.label;
            }
            this.globals.set(stmt.label, this.phase);
        }
        else {
            // prevent redefinition
            if (this.scope.symbols.has(stmt.label)) {
                throw "redefined label " + stmt.label;
            }
            this.scope.set(stmt.label, this.phase);
        }
    }
}
//# sourceMappingURL=compiler.js.map