export interface Memory {
    mem_read: (addr: number) => number;
    mem_write: (addr: number, val: number) => void;
}

export enum Register {
    A, B, C, D, E, H, L,
    BC, DE, HL, IX, IY, SP,
    AF, I, R
};

// operands:
//   a direct Register
//   an immediate value
//   an indirect register - incl. IN (C)
//   an indirect immediate, eg LD A, (nn)
//   an indexed register, eg LD A, (IX+d)
export type OperandKind = "direct" | "immediate" | "indirect" | "memory" | "indexed";

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
export type Operand = DirectOperand | ImmediateOperand | IndirectOperand | MemoryOperand | IndexedOperand;

export interface Instruction {
    opcode: string;
    operands: Operand[];
    bytes: number[];
    undocumented: boolean;
    invalid: boolean;
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

export function stringify(i: Instruction): string {
    let result = i.opcode;
    let operands = i.operands.map(op => {
        switch (op.kind) {
            case "direct": return Register[op.reg];
            case "indirect": return "(" + Register[op.reg] + ")";
            case "immediate": return op.val;
            case "memory": return "(" + op.loc + ")";
            case "indexed": return "(" + Register[op.index] + (op.offset >= 0 ? "+" : "") + op.offset + ")";
        }
    }).join(", ");

    return [result, operands].join("\t");
}

export function disassemble(_mem: Memory, _pc: number): Instruction {
    let inst = {
        opcode: "nop",
        operands: [immediate(4), direct(Register.SP), indirect(Register.SP), indexed(Register.IX, -4), memory(0)],
        bytes: [],
        undocumented: false,
        invalid: true,
    };
    console.log(stringify(inst));

    return inst;
}

disassemble({} as any as Memory, 0);
