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
})(Register || (Register = {}));
;
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
export function stringify(i) {
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
export function disassemble(_mem, _pc) {
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
disassemble({}, 0);
//# sourceMappingURL=z80dis.js.map