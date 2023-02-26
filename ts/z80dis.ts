export interface Memory {
    read(): number;
}

export enum Register {
    A, B, C, D, E, H, L,
    BC, DE, HL, IX, IY, SP,
    AF, I, R, AF_
};

export enum Condition {
    NZ, Z, NC, C, PO, PE, P, M
};

// operands:
//   a condition
//   a direct Register
//   an immediate value
//   an indirect register - incl. IN (C)
//   an indirect immediate, eg LD A, (nn)
//   an indexed register, eg LD A, (IX+d)
export type OperandKind = "condition" | "direct" | "immediate" | "indirect" | "memory" | "indexed";

export interface OperandK<K extends OperandKind> {
    kind: K;
}
export interface DirectOperand extends OperandK<"direct"> {
    reg: Register;
}
export interface ImmediateOperand extends OperandK<"immediate"> {
    val: number;
}
export interface IndirectOperand extends OperandK<"indirect"> {
    reg: Register;
}
export interface MemoryOperand extends OperandK<"memory"> {
    loc: number;
}
export interface IndexedOperand extends OperandK<"indexed"> {
    index: Register.IX | Register.IY;
    offset: number;
}
export interface ConditionOperand extends OperandK<"condition"> {
    condition: Condition;
}

export type Operand = ConditionOperand | DirectOperand | ImmediateOperand | IndirectOperand | MemoryOperand | IndexedOperand;

export interface Instruction {
    opcode: string;
    operands: Operand[];
    bytes: number[];
    undocumented: boolean;
}

export interface Invalid {
    bytes: number[];
    invalid: true;
}

export function isInvalid(i: Instruction | Invalid): i is Invalid {
    return (i as Invalid).invalid;
}

export function isInstruction(i: Instruction | Invalid): i is Instruction {
    return (i as Instruction).opcode !== undefined;
}

function immediate(val: number): ImmediateOperand {
    return { val: val, kind: "immediate" };
}

function direct(reg: Register): DirectOperand {
    return { reg: reg, kind: "direct" };
}

function indirect(reg: Register): IndirectOperand {
    return { reg: reg, kind: "indirect" };
}

function memory(loc: number): MemoryOperand {
    return { loc: loc, kind: "memory" };
}

function indexed(reg: Register.IX | Register.IY, disp: number): IndexedOperand {
    return { index: reg, offset: disp, kind: "indexed" };
}

function condition(cc: Condition): ConditionOperand {
    return { condition: cc, kind: "condition" };
}

function regname(reg: Register): string {
    if (reg === Register.AF_) {
        return "af'";
    } else {
        return Register[reg].toLowerCase();
    }
}

export function stringify(i: Instruction | Invalid): string {
    if (isInvalid(i)) {
        console.log(i);
        return "??";
    } else {
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

function bu(s: string) {
    return '<span class="bu">' + s + '</span>';
}

function at(s: string) {
    return '<span class="at">' + s + '</span>';
}

function bn(s: string) {
    return '<span class="bn">' + s + '</span>';
}

export function syntaxify(i: Instruction | Invalid): string {
    if (isInvalid(i)) {
        console.log(i);
        return "??";
    } else {
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

const RR = [ Register.BC, Register.DE, Register.HL, Register.SP ];
const R = [ direct(Register.B),
            direct(Register.C),
            direct(Register.D),
            direct(Register.E),
            direct(Register.H),
            direct(Register.L),
            indirect(Register.HL),
            direct(Register.A) ];

class Buffer {
    mem: Memory;
    bytes: number[];
    org: number;

    constructor(mem: Memory, org: number) {
        this.mem = mem;
        this.org = org;
        this.bytes = [];
    }

    next(): number {
        let b = this.mem.read();
        this.bytes.push(b);
        return b;
    }

    first(): number {
        return this.bytes[0] ?? 0;
    }

    prev(): number {
        return this.bytes.at(-1) ?? 0;
    }
}

interface Disassembler {
    (buf: Buffer, opcode: number): Operand;
}

/* Decode an R register in bits 5:3 */
function r(_buf: Buffer, opcode: number): Operand {
    return R[(opcode >> 3) & 7];
}

/* Decode an R register in bits 2:0 */
function r_(_buf: Buffer, opcode:  number): Operand {
    return R[opcode & 7];
}

/* Decode an RR register in bits 5:4 */
function rr(_buf: Buffer, opcode: number): Operand {
    return direct(RR[(opcode >> 4) & 3]);
}

/* Decode a stack RR register in bits 5:4 */
function rr_(_buf: Buffer, opcode: number): Operand {
    return direct([Register.BC, Register.DE, Register.HL, Register.AF][(opcode >> 4) & 3]);
}

/* Decode an immediate byte */
function n(buf: Buffer, _opcode: number): Operand {
    return immediate(buf.next());
}

/* Decode an immediate memory address */
function imm_n(buf: Buffer, _opcode: number): Operand {
    return memory(buf.next());
}

/* Decode an immediate word */
function nn(buf: Buffer, _opcode: number): Operand {
    return immediate(buf.next() + (buf.next() << 8));
}

/* Decode an immediate memory address */
function inn(buf: Buffer, _opcode: number): Operand {
    return memory(buf.next() + (buf.next() << 8));
}

/* Decode a signed 8-bit displacement */
function d(buf: Buffer, _opcode: number): Operand {
    let d = new Int8Array([buf.next()])[0];
    return immediate((buf.org + d + 2) & 0xffff);
}

/* Decode a condition code in bits 4:3 */
function cc(_buf: Buffer, opcode: number): Operand {
    return condition((opcode >> 3) & 3);
}

/* Decode a RST target */
function rst(_buf: Buffer, opcode: number): Operand {
    return immediate(opcode & 0x38);
}

/* Decode an indexed register displacement */
function ix_d(buf: Buffer, _opcode: number): Operand {
    let d = new Int8Array([buf.next()])[0];
    return indexed(Register.IX, d);
}
function iy_d(buf: Buffer, _opcode: number): Operand {
    let d = new Int8Array([buf.next()])[0];
    return indexed(Register.IY, d);
}

interface Resolver {
    (buf: Buffer): Instruction | Invalid;
}

type DecodeOperand = Disassembler | Operand;

type OpcodeTable = {
    mask: number;
    match: number;
    opcode: Resolver | string;
    operands: DecodeOperand[];
    undoc: boolean;
}

function opcode(mask: number, match: number, opcode: Resolver | string, operands: DecodeOperand[], undoc: boolean = false): OpcodeTable {
    return { mask: mask, match: match, opcode: opcode, operands: operands, undoc: undoc };
}

function invalid(mask: number, match: number): OpcodeTable {
    return { mask: mask, match: match, opcode: (buf) => { return { bytes: buf.bytes, invalid: true } }, operands: [], undoc: false };
}

function resolve(buf: Buffer, table: OpcodeTable[]): Instruction | Invalid {
    let b = buf.next();

    for (let entry of table) {
        if ((b & entry.mask) === entry.match) {
            if (typeof entry.opcode === 'function') {
                return entry.opcode(buf);
            } else {
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
                }
            }
        }
    }
    return { bytes: buf.bytes, invalid: true };
}

const base_opcodes: OpcodeTable[] = [
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
const dd_opcodes: OpcodeTable[] = [
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
    invalid(0xff, 0x76), // ld (ix+d), (ix+d)
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
const fd_opcodes: OpcodeTable[] = [
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
    invalid(0xff, 0x76), // ld (iy+d), (iy+d)
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

function resolve_dd(buf: Buffer): Instruction | Invalid {
    return resolve(buf, dd_opcodes);
}

function resolve_fd(buf: Buffer): Instruction | Invalid {
    return resolve(buf, fd_opcodes);
}

function resolve_cb(buf: Buffer): Instruction | Invalid {
    let b = buf.next();

    // Everything has an 8-bit register argument
    let reg = r_(buf, b);

    if (b < 0x40) {
        return {
            opcode: ["rlc", "rrc", "rl", "rr", "sla", "sra", "sll", "srl"][b >> 3],
            operands: [reg],
            bytes: buf.bytes,
            undocumented: (b >> 3) == 0x30,
        }
    } else {
        let bit = (b >> 3) & 7;
        return {
            opcode: ["bit", "res", "set"][(b >> 6) - 1],
            operands: [immediate(bit), reg],
            bytes: buf.bytes,
            undocumented: false
        }
    }

}

export function disassemble(mem: Memory, pc: number): Instruction | Invalid {
    let buf = new Buffer(mem, pc);

    return resolve(buf, base_opcodes);
}

