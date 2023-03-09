import * as Parser from './z80/parser.js';
import * as Expr from './z80/expr.js';

import { Compiler, Assembly } from './compiler.js';
import { Unresolved } from './scope.js';
import * as Disasm from './z80dis.js';

/* Implements a one-pass assembler.
 *
 * Assembly source statements are processed in order and bytes are emitted into the Z80 emulator memory. Forward
 * references are permitted and will be fixed up as the references are resolved.
 *
 */

/* Information about the assembled instructions output by one span */
type Compiled = {
    note: JQuery;
    assemblies: Assembly[];
};

type Dump = {
    from: number,
    count: number
};

function regs(z80: Z80): string {
    let state = z80.getState();

    let flags = [
        state.flags.S ? 'S' : 's',
        state.flags.Z ? 'Z' : 'z',
        '-',
        state.flags.H ? 'H' : 'h',
        '-',
        state.flags.P ? 'P' : 'p',
        state.flags.N ? 'N' : 'n',
        state.flags.C ? 'C' : 'c',
    ].join('')

    return 'A=' + hex8(state.a)
        + ' F=' + flags
        + ' BC=' + hex8(state.b) + hex8(state.c)
        + ' DE=' + hex8(state.d) + hex8(state.e)
        + ' HL=' + hex8(state.h) + hex8(state.l)
        + ' IX=' + hex16(state.ix)
        + ' IY=' + hex16(state.iy)
        + ' SP=' + hex16(state.sp)
        + ' PC=' + hex16(state.pc);
}

/* An entry point for executing some code */
class Execution {
    org: number;
    display: JQuery;
    trace: boolean;
    dumps: Dump[];

    constructor(org: number, pre: JQuery, trace: boolean, dumps: Dump[]) {
        this.org = org;
        this.trace = trace;
        this.dumps = dumps;
        let outer = $('<pre class="console"></pre>').insertAfter(pre);
        this.display = $('<code>CONSOLE OUTPUT:\n</code>').appendTo(outer);
    }

    completed(z80: Z80, zmem: Uint8Array): void {
        this.print(regs(z80) + '\n');
        for (let dump of this.dumps) {
            this.print('\n');
            for (let i = 0; i < dump.count; i += 16) {
                this.print(hex16(dump.from + i) + ': ');
                let row = Math.min(16, dump.count - i);
                for (let j = 0; j < row; j++) {
                    this.print(hex8(zmem[dump.from + i + j]) + ' ');
                }
                this.print('   '.repeat(16 - row) + '  ');
                for (let j = 0; j < row; j++) {
                    let c = zmem[dump.from + i + j];
                    if (c < 32 || c > 126) {
                        this.print('.');
                    } else {
                        this.print(String.fromCharCode(c));
                    }
                }
                this.print('\n');
            }
        }
    }

    print(s: string) {
        this.append($('<span></span>').text(s));
    }

    append(stuff: JQuery) {
        this.display.append(stuff);
    }
};

type RunResult = {
    halted: boolean;
    cycles: number;
};

class Memory {
    pc: number;
    mem: Uint8Array;

    constructor(pc: number, mem: Uint8Array) {
        this.pc = pc;
        this.mem = mem;
    }

    read(): number {
        return this.mem[this.pc++];
    }
}

class Runner implements Core {
    z80: Z80;
    zmem: Uint8Array;
    execution: Execution;

    constructor(code: Uint8Array, execution: Execution) {
        this.z80 = new Z80(this);
        this.zmem = code.slice();
        this.execution = execution;

        this.z80.reset();
        let state = this.z80.getState();
        state.pc = execution.org;
        this.z80.setState(state);
    }

    cycle(limit: number): RunResult {
        let cycles = 0;
        let state = this.z80.getState();

        while (!state.halted && cycles < limit) {
            if (this.execution.trace) {
                let pc = this.z80.getState().pc;
                let mem = new Memory(pc, this.zmem);
                let dis = Disasm.disassemble(mem, pc);
                cycles = cycles + this.z80.run_instruction();
                this.trace(dis, state);
            } else {
                cycles = cycles + this.z80.run_instruction();
            }
            state = this.z80.getState();
        }

        return {
            halted: state.halted,
            cycles: cycles,
        };
    }

    mem_read(address: number): number {
        return this.zmem[address];
    }

    mem_write(address: number, val: number): void {
        this.zmem[address] = val;
    }

    io_read(_port: number): number {
        return 0xff;
    }

    io_write(port: number, val: number): void {
        if ((port & 0xff) == 1) {
            this.execution.print(String.fromCharCode(val));
        }
    }

    trace(dis: Disasm.Instruction | Disasm.Invalid, last: State): void {
        let pc = hex16(last.pc);
        let bytes = print_bytes(new Uint8Array(dis.bytes));
        let instr = $('<span>' + Disasm.syntaxify(dis) + '</span>');
        let changed = this.diff_state(last, this.z80.getState(), dis.bytes.length);

        let ilen = instr.text().length;

        let trace = $('<span>' + pc + ': ' + bytes + '</span>' + instr.html() + ' '.repeat(22 - ilen)
                      + '<span class="co">; ' + changed + '</span>'
                      + '<span>\n</span>');

        this.execution.append(trace);
    }

    diff_state(then: State, now: State, len: number): string {
        let result = []

        if (then.a !== now.a) result.push('A ← ' + hex8(now.a));

        if (then.b !== now.b || then.c !== now.c) result.push('BC ← ' + hex8(now.b) + hex8(now.c));
        if (then.d !== now.d || then.e !== now.e) result.push('DE ← ' + hex8(now.d) + hex8(now.e));
        if (then.h !== now.h || then.l !== now.l) result.push('HL ← ' + hex8(now.h) + hex8(now.l));
        if (then.ix !== now.ix) result.push('IX ← ' + hex16(now.ix));
        if (then.iy !== now.iy) result.push('IY ← ' + hex16(now.iy));
        if (then.sp !== now.sp) result.push('SP ← ' + hex16(now.sp));

        if (then.flags.S !== now.flags.S
            || then.flags.Z !== now.flags.Z
            || then.flags.H !== now.flags.H
            || then.flags.P !== now.flags.P
            || then.flags.N !== now.flags.N
            || then.flags.C !== now.flags.C) {
            result.push('F ← ' + [
                now.flags.S ? 'S' : 's',
                now.flags.Z ? 'Z' : 'z',
                '-',
                now.flags.H ? 'H' : 'h',
                '-',
                now.flags.P ? 'P' : 'p',
                now.flags.N ? 'N' : 'n',
                now.flags.C ? 'C' : 'c',
            ].join(''));
        }

        if (then.pc + len !== now.pc) {
            result.push('PC ← ' + hex16(now.pc));
        }

        return result.join(", ");

    }

}

class RunZ80 {
    code: Uint8Array;           /* Compiled code/data */
    runs: Execution[];

    constructor() {
        this.code = new Uint8Array(65536);
        this.runs = [];

        // make these available for the js console
        (window as any).parser = Parser;
        (window as any).expr = Expr;
        (window as any).dis = Disasm;

        this.compile();
    }

    decorate(span: Element, text: string): JQuery {
        let inner = $(span).find('span.opcodes');
        if (inner.length === 0) {
            inner = $('<span class="opcodes bn"></span>');
            $(span).append(inner);
        }
        inner.text(text);
        return inner;
    }

    format_assemblies(assemblies: Assembly[]): string {
        let org = assemblies[0]?.org;
        if (org !== undefined) {
            let addr = hex16(org) + ': ';
            let bytes = [] as number[];
            for (let assembly of assemblies) {
                if (assembly.org === org) {
                    bytes.push(...assembly.bytes);
                    org += assembly.bytes.length;
                } else {
                    break;
                }
            }
            return addr + print_bytes(new Uint8Array(bytes));
        } else {
            return '';
        }
    }

    async compile(): Promise<void> {
        let compiler = new Compiler(this.code);
        let runs: Execution[] = [];
        let line = 1;

        let spans: Compiled[] = [];

        // Iterate over each block of code
        for (let pre of $('pre.sourceCode.z80')) {

            // If the block is marked up as runnable save the location
            if ($(pre).hasClass('run')) {
                let trace = $(pre).hasClass('trace');
                let dumps = ($(pre).attr('class') ?? "").split(/\s+/)
                    .filter(s => s.startsWith('dump_'))
                    .map(s => s.split(/_/))
                    .flatMap(parts => {
                        let [_, start, end] = parts;

                        let startN = compiler.scope.resolve_immediate({
                            expression: start,
                            vars: [start],
                            location: { line: 0, column: 0, source: $(pre) }
                        });

                        let endN: number | string | Unresolved = Number(end);
                        if (isNaN(endN)) {
                            endN = compiler.scope.resolve_immediate({
                                expression: end,
                                vars: [end],
                                location: { line: 0, column: 0, source: $(pre) }
                            });
                            if (typeof endN === "number" && typeof startN === "number") {
                                endN = endN - startN;
                            }
                        }

                        if (typeof startN === "number" && typeof endN === "number") {
                            return [{from: startN, count: endN}];
                        } else {
                            console.log('!!! Cannot dump memory: start/end are not resolvable\n');
                            return [];
                        }
                    });
                let exec = new Execution(compiler.org, $(pre), trace, dumps);
                runs.push(exec);
            }

            // Iterate over each line of source
            for (let span of $(pre).find('code > span')) {
                let code = $(span).text();
                try {
                    let result = await compiler.compile(Parser.parse(code, { line: line++, source: span }) ?? []);
                    spans.push({
                        note: this.decorate(span, ''),
                        assemblies: result,
                    });
                } catch (e) {
                    console.log(code, e);
                    // TODO: should do something ... more ... here
                }

            };

        };

        compiler.finalise();

        for (let span of spans) {
            span.note.text(this.format_assemblies(span.assemblies));
        }

        // execute each run block
        this.runs = runs;

        this.run_more();
    }

    run_one(run: Execution): void {
        let runner = new Runner(this.code, run);
        let frame_count = 0;
        let total_cycles = 0;

        let frame = () => {
            if (++frame_count > 1000) {
                let pc = runner.z80.getState().pc;
                run.print('\n!!! Run limit elapsed, halting execution (PC=' + hex16(pc) + ')\n');
                run.completed(runner.z80, runner.zmem);
                this.run_more();
            } else {
                let result = runner.cycle(10000);
                total_cycles += result.cycles;
                if (result.halted) {
                    let pc = runner.z80.getState().pc;
                    run.print('\n*** HALT encountered at ' + hex16(pc) + ' after ' + total_cycles + ' cycles\n');
                    run.completed(runner.z80, runner.zmem);
                    this.run_more();
                } else {
                    requestAnimationFrame(frame);
                }
            }

        };
        requestAnimationFrame(frame);
    }

    run_more(): void {
        let run = this.runs.shift();
        if (run !== undefined) {
            this.run_one(run);
        }
    }

};

function hex8(v: number): string {
    let result = '00' + Number(v).toString(16);
    return result.substring(result.length - 2);
}

function hex16(v: number): string {
    let result = '0000' + Number(v).toString(16);
    return result.substring(result.length - 4);
};

function print_bytes(bytes: Uint8Array): string {
    if (bytes.length > 6) {
        return Array.from(bytes.slice(0, 5), hex8).join(' ') + '...';
    } else {
        let padding = '   '.repeat(6 - bytes.length);
        return Array.from(bytes, hex8).join(' ') + padding;
    }
}

new RunZ80();
