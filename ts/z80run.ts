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

    constructor(org: number, pre: JQuery) {
        this.org = org;
        let outer = $('<pre class="console"></pre>').insertAfter(pre);
        this.display = $('<code>CONSOLE OUTPUT:\n</code>').appendTo(outer);
    }

    completed(z80: Z80, _zmem: Uint8Array): void {
        this.print(regs(z80) + '\n');
    }

    print(s: string) {
        this.append($('<span></span>').text(s));
    }

    append(stuff: JQuery) {
        this.display.append(stuff);
    }
};

class DumpExecution extends Execution {
    dump: { from: number, count: number };

    constructor(org: number, pre: JQuery, from: number, count: number) {
        super(org, pre);
        this.dump = { from: from, count: count };
    }

    completed(z80: Z80, zmem: Uint8Array): void {
        super.completed(z80, zmem);
        this.print('\n');
        for (let i = 0; i <= this.dump.count; i += 16) {
            this.print(hex16(this.dump.from + i) + ': ');
            let row = Math.min(16, this.dump.count - i);
            for (let j = 0; j < row; j++) {
                this.print(hex8(zmem[this.dump.from + i + j]) + ' ');
            }
            this.print('   '.repeat(16 - row) + '  ');
            for (let j = 0; j < row; j++) {
                let c = zmem[this.dump.from + i + j];
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
            //this.trace();
            cycles = cycles + this.z80.run_instruction();
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

    trace(): void {
        let pc = this.z80.getState().pc;
        let mem = new Memory(pc, this.zmem);
        let dis = Disasm.disassemble(mem, pc);
        let trace = $('<span class="co">' + regs(this.z80) + '\n</span>' +
                      '<span>' + print_bytes(new Uint8Array(dis.bytes)) + '</span> ' + Disasm.syntaxify(dis) +
                      '<span>\n</span>');

        //console.log(trace);
        this.execution.append(trace);
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
                let dump = $(pre).attr('class')?.split(/\s+/).filter(s => s.startsWith('dump_'))[0];
                if (dump !== undefined) {
                    let [_, start, end] = dump.split(/_/);

                    let startN = compiler.scope.resolve_immediate({
                        expression: start,
                        vars: [start],
                        location: { line: 0, column: 0, source: $(pre) }
                    });

                    // dump_<symbol>_<int> dumps from <symbol> for <int> bytes
                    // dump_<symbolA>_<symbolB> dumps from <sybolA> to <symbolB>

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
                        runs.push(new DumpExecution(compiler.org, $(pre), startN, endN));
                    } else {
                        let exec = new Execution(compiler.org, $(pre));
                        exec.print('!!! Cannot dump memory: start/end are not resolvable\n');
                        runs.push(exec);
                    }
                } else {
                    runs.push(new Execution(compiler.org, $(pre)));
                }
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
            if (++frame_count > 10) {
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
