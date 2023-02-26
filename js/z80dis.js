export var Register;
(function (Register) {
    Register[Register["A"] = 0] = "A";
    Register[Register["B"] = 1] = "B";
    Register[Register["C"] = 2] = "C";
    Register[Register["D"] = 3] = "D";
    Register[Register["E"] = 4] = "E";
    Register[Register["H"] = 5] = "H";
    Register[Register["L"] = 6] = "L";
    Register[Register["BC"] = 7] = "BC";
    Register[Register["DE"] = 8] = "DE";
    Register[Register["HL"] = 9] = "HL";
    Register[Register["IX"] = 10] = "IX";
    Register[Register["IY"] = 11] = "IY";
    Register[Register["SP"] = 12] = "SP";
    Register[Register["AF"] = 13] = "AF";
    Register[Register["I"] = 14] = "I";
    Register[Register["R"] = 15] = "R";
    Register[Register["AF_"] = 16] = "AF_";
})(Register || (Register = {}));
;
export var Condition;
(function (Condition) {
    Condition[Condition["NZ"] = 0] = "NZ";
    Condition[Condition["Z"] = 1] = "Z";
    Condition[Condition["NC"] = 2] = "NC";
    Condition[Condition["C"] = 3] = "C";
    Condition[Condition["PO"] = 4] = "PO";
    Condition[Condition["PE"] = 5] = "PE";
    Condition[Condition["P"] = 6] = "P";
    Condition[Condition["M"] = 7] = "M";
})(Condition || (Condition = {}));
;
export function isInvalid(i) {
    return i.invalid;
}
export function isInstruction(i) {
    return i.opcode !== undefined;
}
function immediate(val) {
    return { val: val, kind: "immediate" };
}
function direct(reg) {
    return { reg: reg, kind: "direct" };
}
function indirect(reg) {
    return { reg: reg, kind: "indirect" };
}
function memory(loc) {
    return { loc: loc, kind: "memory" };
}
function indexed(reg, disp) {
    return { index: reg, offset: disp, kind: "indexed" };
}
function condition(cc) {
    return { condition: cc, kind: "condition" };
}
function regname(reg) {
    if (reg === Register.AF_) {
        return "af'";
    }
    else {
        return Register[reg].toLowerCase();
    }
}
export function stringify(i) {
    if (isInvalid(i)) {
        console.log(i);
        return "??";
    }
    else {
        let operands = i.operands.map(op => {
            switch (op.kind) {
                case "condition": return Condition[op.condition].toLowerCase();
                case "direct": return regname(op.reg);
                case "indirect": return "(" + regname(op.reg) + ")";
                case "immediate": return '$' + op.val.toString(16);
                case "memory": return "($" + op.loc.toString(16) + ")";
                case "indexed": return "(" + regname(op.index) + (op.offset >= 0 ? "+" : "") + op.offset + ")";
            }
        }).join(", ");
        return [i.opcode, operands].join(" ".repeat(8 - i.opcode.length));
    }
}
function bu(s) {
    return '<span class="bu">' + s + '</span>';
}
function at(s) {
    return '<span class="at">' + s + '</span>';
}
function bn(s) {
    return '<span class="bn">' + s + '</span>';
}
export function syntaxify(i) {
    if (isInvalid(i)) {
        console.log(i);
        return "??";
    }
    else {
        let operands = i.operands.map(op => {
            switch (op.kind) {
                case "condition": return Condition[op.condition].toLowerCase();
                case "direct": return at(regname(op.reg));
                case "indirect": return "(" + at(regname(op.reg)) + ")";
                case "immediate": return bn('$' + op.val.toString(16));
                case "memory": return "(" + bn('$' + op.loc.toString(16)) + ")";
                case "indexed": return '(' + at(regname(op.index)) + (op.offset >= 0 ? "+" : "-") + bn('' + Math.abs(op.offset)) + ')';
            }
        }).join(", ");
        return [bu(i.opcode), operands].join(" ".repeat(8 - i.opcode.length));
    }
}
/* Based heavily on GNU binutils' Z80 disassembler */
const RR = [Register.BC, Register.DE, Register.HL, Register.SP];
const R = [direct(Register.B),
    direct(Register.C),
    direct(Register.D),
    direct(Register.E),
    direct(Register.H),
    direct(Register.L),
    indirect(Register.HL),
    direct(Register.A)];
class Buffer {
    mem;
    bytes;
    org;
    constructor(mem, org) {
        this.mem = mem;
        this.org = org;
        this.bytes = [];
    }
    next() {
        let b = this.mem.read();
        this.bytes.push(b);
        return b;
    }
    first() {
        return this.bytes[0] ?? 0;
    }
    prev() {
        return this.bytes.at(-1) ?? 0;
    }
}
/* Decode an R register in bits 5:3 */
function r(_buf, opcode) {
    return R[(opcode >> 3) & 7];
}
/* Decode an R register in bits 2:0 */
function r_(_buf, opcode) {
    return R[opcode & 7];
}
/* Decode an RR register in bits 5:4 */
function rr(_buf, opcode) {
    return direct(RR[(opcode >> 4) & 3]);
}
/* Decode a stack RR register in bits 5:4 */
function rr_(_buf, opcode) {
    return direct([Register.BC, Register.DE, Register.HL, Register.AF][(opcode >> 4) & 3]);
}
/* Decode an immediate byte */
function n(buf, _opcode) {
    return immediate(buf.next());
}
/* Decode an immediate memory address */
function imm_n(buf, _opcode) {
    return memory(buf.next());
}
/* Decode an immediate word */
function nn(buf, _opcode) {
    return immediate(buf.next() + (buf.next() << 8));
}
/* Decode an immediate memory address */
function inn(buf, _opcode) {
    return memory(buf.next() + (buf.next() << 8));
}
/* Decode a signed 8-bit displacement */
function d(buf, _opcode) {
    let d = new Int8Array([buf.next()])[0];
    return immediate((buf.org + d + 2) & 0xffff);
}
/* Decode a condition code in bits 4:3 */
function cc(_buf, opcode) {
    return condition((opcode >> 3) & 3);
}
/* Decode a RST target */
function rst(_buf, opcode) {
    return immediate(opcode & 0x38);
}
/* Decode an indexed register displacement */
function ix_d(buf, _opcode) {
    let d = new Int8Array([buf.next()])[0];
    return indexed(Register.IX, d);
}
function iy_d(buf, _opcode) {
    let d = new Int8Array([buf.next()])[0];
    return indexed(Register.IY, d);
}
function opcode(mask, match, opcode, operands, undoc = false) {
    return { mask: mask, match: match, opcode: opcode, operands: operands, undoc: undoc };
}
function invalid(mask, match) {
    return { mask: mask, match: match, opcode: (buf) => { return { bytes: buf.bytes, invalid: true }; }, operands: [], undoc: false };
}
function resolve(buf, table) {
    let b = buf.next();
    for (let entry of table) {
        if ((b & entry.mask) === entry.match) {
            if (typeof entry.opcode === 'function') {
                return entry.opcode(buf);
            }
            else {
                return {
                    opcode: entry.opcode,
                    operands: entry.operands.map(operand => {
                        if (typeof operand === 'function') {
                            operand = operand(buf, b);
                        }
                        return operand;
                    }),
                    bytes: buf.bytes,
                    undocumented: entry.undoc
                };
            }
        }
    }
    return { bytes: buf.bytes, invalid: true };
}
const base_opcodes = [
    opcode(0xff, 0x00, "nop", []),
    opcode(0xcf, 0x01, "ld", [rr, nn]),
    opcode(0xff, 0x02, "ld", [indirect(Register.BC), direct(Register.A)]),
    opcode(0xcf, 0x03, "inc", [rr]),
    opcode(0xc7, 0x04, "inc", [r]),
    opcode(0xc7, 0x05, "dec", [r]),
    opcode(0xc7, 0x06, "ld", [r, n]),
    opcode(0xff, 0x07, "rlca", []),
    opcode(0xff, 0x08, "ex", [direct(Register.AF), direct(Register.AF_)]),
    opcode(0xcf, 0x09, "add", [direct(Register.HL), rr]),
    opcode(0xff, 0x0a, "ld", [direct(Register.A), indirect(Register.BC)]),
    opcode(0xcf, 0x0b, "dec", [rr]),
    opcode(0xff, 0x0f, "rrca", []),
    opcode(0xff, 0x10, "djnz", [d]),
    opcode(0xff, 0x12, "ld", [indirect(Register.DE), direct(Register.A)]),
    opcode(0xff, 0x17, "rca", []),
    opcode(0xff, 0x18, "jr", [d]),
    opcode(0xff, 0x1a, "ld", [direct(Register.A), indirect(Register.DE)]),
    opcode(0xff, 0x1f, "rra", []),
    opcode(0xe7, 0x20, "jr", [cc, d]),
    opcode(0xff, 0x22, "ld", [inn, direct(Register.HL)]),
    opcode(0xff, 0x27, "daa", []),
    opcode(0xff, 0x2a, "ld", [direct(Register.HL), inn]),
    opcode(0xff, 0x2f, "cpl", []),
    opcode(0xff, 0x32, "ld", [inn, direct(Register.A)]),
    opcode(0xff, 0x37, "scf", []),
    opcode(0xff, 0x3a, "ld", [direct(Register.A), inn]),
    opcode(0xff, 0x3f, "ccf", []),
    opcode(0xff, 0x76, "halt", []),
    // eZ80 prefixes at 40, 49, 52, 4B for sis, lis, sil, lil, override ld r, r_
    opcode(0xc0, 0x40, "ld", [r, r_]),
    opcode(0xf8, 0x80, "add", [direct(Register.A), r_]),
    opcode(0xf8, 0x88, "adc", [direct(Register.A), r_]),
    opcode(0xf8, 0x90, "sub", [r_]),
    opcode(0xf8, 0x98, "sbc", [direct(Register.A), r_]),
    opcode(0xf8, 0xa0, "and", [r_]),
    opcode(0xf8, 0xa8, "xor", [r_]),
    opcode(0xf8, 0xb0, "or", [r_]),
    opcode(0xf8, 0xb8, "cp", [r_]),
    opcode(0xc7, 0xc0, "ret", [cc]),
    opcode(0xcf, 0xc1, "pop", [rr_]),
    opcode(0xc7, 0xc2, "jp", [cc, nn]),
    opcode(0xff, 0xc3, "jp", [nn]),
    opcode(0xc7, 0xc4, "call", [cc, nn]),
    opcode(0xcf, 0xc5, "push", [rr_]),
    opcode(0xff, 0xc6, "add", [direct(Register.A), n]),
    opcode(0xc7, 0xc7, "rst", [rst]),
    opcode(0xff, 0xc9, "ret", []),
    opcode(0xff, 0xcb, resolve_cb, []),
    opcode(0xff, 0xcd, "call", [nn]),
    opcode(0xff, 0xce, "adc", [direct(Register.A), n]),
    opcode(0xff, 0xd3, "out", [imm_n, direct(Register.A)]),
    opcode(0xff, 0xd6, "sub", [n]),
    opcode(0xff, 0xd9, "exx", []),
    opcode(0xff, 0xdb, "in", [direct(Register.A), imm_n]),
    opcode(0xff, 0xdd, resolve_dd, []),
    // 0xdd prefix: IX
    opcode(0xff, 0xde, "sbc", [direct(Register.A), n]),
    opcode(0xff, 0xe3, "ex", [indirect(Register.SP), direct(Register.HL)]),
    opcode(0xff, 0xe6, "and", [n]),
    opcode(0xff, 0xe9, "jp", [indirect(Register.HL)]),
    opcode(0xff, 0xeb, "ex", [direct(Register.DE), direct(Register.HL)]),
    // 0xed prefix
    opcode(0xff, 0xee, "xor", [n]),
    opcode(0xff, 0xf3, "di", []),
    opcode(0xff, 0xf6, "or", [n]),
    opcode(0xff, 0xf9, "ld", [direct(Register.SP), direct(Register.HL)]),
    opcode(0xff, 0xfb, "ei", []),
    opcode(0xff, 0xfd, resolve_fd, []),
    opcode(0xff, 0xfe, "cp", [n]),
];
/* TODO: undocumented opcodes */
const dd_opcodes = [
    opcode(0xff, 0x21, "ld", [direct(Register.IX), nn]),
    opcode(0xff, 0x22, "ld", [inn, direct(Register.IX)]),
    opcode(0xff, 0x23, "inc", [direct(Register.IX)]),
    opcode(0xff, 0x2a, "ld", [direct(Register.IX), inn]),
    opcode(0xff, 0x2b, "inc", [direct(Register.IX)]),
    opcode(0xff, 0x29, "add", [direct(Register.IX), direct(Register.IX)]),
    opcode(0xcf, 0x09, "add", [direct(Register.IX), rr]),
    opcode(0xff, 0x34, "inc", [ix_d]),
    opcode(0xff, 0x35, "dec", [ix_d]),
    opcode(0xff, 0x36, "ld", [ix_d, n]),
    invalid(0xff, 0x76),
    opcode(0xc7, 0x46, "ld", [r, ix_d]),
    opcode(0xf8, 0x70, "ld", [ix_d, r]),
    opcode(0xff, 0x86, "add", [direct(Register.A), ix_d]),
    opcode(0xff, 0x8e, "adc", [direct(Register.A), ix_d]),
    opcode(0xff, 0x96, "sub", [ix_d]),
    opcode(0xff, 0x9e, "sbc", [direct(Register.A), ix_d]),
    opcode(0xff, 0xa6, "and", [ix_d]),
    opcode(0xff, 0xae, "xor", [ix_d]),
    opcode(0xff, 0xb6, "or", [ix_d]),
    opcode(0xff, 0xbe, "cp", [ix_d]),
    opcode(0xff, 0xe1, "pop", [direct(Register.IX)]),
    opcode(0xff, 0xe3, "ex", [indirect(Register.SP), direct(Register.IX)]),
    opcode(0xff, 0xe5, "push", [direct(Register.IX)]),
    opcode(0xff, 0xe9, "jp", [indirect(Register.IX)]),
    opcode(0xff, 0xf9, "ld", [direct(Register.SP), direct(Register.IX)]),
];
/* TODO: undocumented opcodes */
const fd_opcodes = [
    opcode(0xff, 0x21, "ld", [direct(Register.IY), nn]),
    opcode(0xff, 0x22, "ld", [inn, direct(Register.IY)]),
    opcode(0xff, 0x23, "inc", [direct(Register.IY)]),
    opcode(0xff, 0x2a, "ld", [direct(Register.IY), inn]),
    opcode(0xff, 0x2b, "inc", [direct(Register.IY)]),
    opcode(0xff, 0x29, "add", [direct(Register.IY), direct(Register.IY)]),
    opcode(0xcf, 0x09, "add", [direct(Register.IY), rr]),
    opcode(0xff, 0x34, "inc", [iy_d]),
    opcode(0xff, 0x35, "dec", [iy_d]),
    opcode(0xff, 0x36, "ld", [iy_d, n]),
    invalid(0xff, 0x76),
    opcode(0xc7, 0x46, "ld", [r, iy_d]),
    opcode(0xf8, 0x70, "ld", [iy_d, r]),
    opcode(0xff, 0x86, "add", [direct(Register.A), iy_d]),
    opcode(0xff, 0x8e, "adc", [direct(Register.A), iy_d]),
    opcode(0xff, 0x96, "sub", [iy_d]),
    opcode(0xff, 0x9e, "sbc", [direct(Register.A), iy_d]),
    opcode(0xff, 0xa6, "and", [iy_d]),
    opcode(0xff, 0xae, "xor", [iy_d]),
    opcode(0xff, 0xb6, "or", [iy_d]),
    opcode(0xff, 0xbe, "cp", [iy_d]),
    opcode(0xff, 0xe1, "pop", [direct(Register.IY)]),
    opcode(0xff, 0xe3, "ex", [indirect(Register.SP), direct(Register.IY)]),
    opcode(0xff, 0xe5, "push", [direct(Register.IY)]),
    opcode(0xff, 0xe9, "jp", [indirect(Register.IY)]),
    opcode(0xff, 0xf9, "ld", [direct(Register.SP), direct(Register.IY)]),
];
function resolve_dd(buf) {
    return resolve(buf, dd_opcodes);
}
function resolve_fd(buf) {
    return resolve(buf, fd_opcodes);
}
function resolve_cb(buf) {
    let b = buf.next();
    // Everything has an 8-bit register argument
    let reg = r_(buf, b);
    if (b < 0x40) {
        return {
            opcode: ["rlc", "rrc", "rl", "rr", "sla", "sra", "sll", "srl"][b >> 3],
            operands: [reg],
            bytes: buf.bytes,
            undocumented: (b >> 3) == 0x30,
        };
    }
    else {
        let bit = (b >> 3) & 7;
        return {
            opcode: ["bit", "res", "set"][(b >> 6) - 1],
            operands: [immediate(bit), reg],
            bytes: buf.bytes,
            undocumented: false
        };
    }
}
export function disassemble(mem, pc) {
    let buf = new Buffer(mem, pc);
    return resolve(buf, base_opcodes);
}
//# sourceMappingURL=z80dis.js.map