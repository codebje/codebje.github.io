import * as Parser from './z80/parser.js';
import * as Expr from './z80/expr.js';
import { Compiler } from './compiler.js';
/* An entry point for executing some code */
class Execution {
    org;
    display;
    constructor(org, pre) {
        this.org = org;
        this.display = $('<pre class="console">CONSOLE OUTPUT:\n</pre>').insertAfter(pre);
    }
    print(s) {
        this.display.text(this.display.text() + s);
    }
}
;
class Runner {
    z80;
    zmem;
    display;
    constructor(code, execution) {
        this.z80 = new Z80(this);
        this.zmem = code.slice();
        this.display = execution.display;
        this.z80.reset();
        let state = this.z80.getState();
        state.pc = execution.org;
        this.z80.setState(state);
    }
    cycle(limit) {
        let cycles = 0;
        let state = this.z80.getState();
        while (!state.halted && cycles < limit) {
            cycles = cycles + this.z80.run_instruction();
            state = this.z80.getState();
            //this.display.text(this.display.text() + '@' + hex16(state.pc) + ', cycles=' + cycles + '\n');
        }
        return {
            halted: state.halted,
            cycles: cycles,
        };
    }
    dumpf(f) {
        return [
            f.S ? 'S' : 's',
            f.Z ? 'Z' : 'z',
            '-',
            f.H ? 'H' : 'h',
            '-',
            f.P ? 'P' : 'p',
            f.N ? 'N' : 'n',
            f.C ? 'C' : 'c',
        ].join('');
    }
    report(log) {
        let state = this.z80.getState();
        let reg1 = 'A=' + hex8(state.a)
            + ' F=' + this.dumpf(state.flags)
            + ' BC=' + hex8(state.b) + hex8(state.c)
            + ' DE=' + hex8(state.d) + hex8(state.e)
            + '\n';
        log.print(reg1);
        let reg2 = 'HL=' + hex8(state.h) + hex8(state.l)
            + ' IX=' + hex16(state.ix)
            + ' IY=' + hex16(state.iy)
            + ' SP=' + hex16(state.sp)
            + '\n';
        log.print(reg2);
    }
    mem_read(address) {
        return this.zmem[address];
    }
    mem_write(address, val) {
        this.zmem[address] = val;
    }
    io_read(_port) {
        return 0xff;
    }
    io_write(port, val) {
        if ((port & 0xff) == 1) {
            this.display.text(this.display.text() + String.fromCharCode(val));
        }
    }
}
class RunZ80 {
    code; /* Compiled code/data */
    runs;
    constructor() {
        this.code = new Uint8Array(65536);
        this.runs = [];
        // make these available for the js console
        window.parser = Parser;
        window.expr = Expr;
        this.compile();
    }
    decorate(span, text) {
        let inner = $('<span class="opcodes bn"></span>');
        inner.text(text);
        $(span).append(inner);
        return inner;
    }
    print_bytes(bytes) {
        if (bytes.length > 6) {
            return Array.from(bytes.slice(0, 5), hex8).join(' ') + '...';
        }
        else {
            let padding = '   '.repeat(6 - bytes.length);
            return Array.from(bytes, hex8).join(' ') + padding;
        }
    }
    format_asm(asm) {
        let addr = hex16(asm.org) + ': ';
        let bytes = this.print_bytes(asm.bytes);
        return addr + bytes;
    }
    compile() {
        let compiler = new Compiler(this.code);
        let runs = [];
        let line = 1;
        let assemblies = [];
        // Iterate over each block of code
        $('pre.sourceCode.z80').each((_i, pre) => {
            // If the block is marked up as runnable save the location
            if ($(pre).hasClass('run')) {
                runs.push(new Execution(compiler.org, $(pre)));
            }
            // Iterate over each line of source
            $(pre).find('code > span').each((_i, span) => {
                let code = $(span).text();
                try {
                    let result = compiler.compile(Parser.parse(code, { line: line++, source: span }) ?? []);
                    let note = this.decorate(span, '');
                    assemblies.push(...result.map(r => { return { note: note, ...r }; }));
                }
                catch (e) {
                    console.log(code, e);
                    // TODO: should do something ... more ... here
                }
            });
        });
        compiler.finalise();
        for (let assembly of assemblies) {
            assembly.note.text(this.format_asm(assembly));
        }
        // execute each run block
        this.runs = runs;
        this.run_more();
    }
    run_one(run) {
        let runner = new Runner(this.code, run);
        let frame_count = 0;
        let total_cycles = 0;
        let frame = () => {
            if (++frame_count > 1000) {
                let pc = runner.z80.getState().pc;
                run.print('\n!!! Run limit elapsed, halting execution (PC=' + hex16(pc) + ')\n');
                runner.report(run);
                this.run_more();
            }
            else {
                let result = runner.cycle(10000);
                total_cycles += result.cycles;
                if (result.halted) {
                    let pc = runner.z80.getState().pc;
                    run.print('\n*** HALT encountered at ' + hex16(pc) + ' after ' + total_cycles + ' cycles\n');
                    runner.report(run);
                    this.run_more();
                }
                else {
                    requestAnimationFrame(frame);
                }
            }
        };
        requestAnimationFrame(frame);
    }
    run_more() {
        let run = this.runs.shift();
        if (run !== undefined) {
            this.run_one(run);
        }
    }
}
;
function hex8(v) {
    let result = '00' + Number(v).toString(16);
    return result.substring(result.length - 2);
}
function hex16(v) {
    let result = '0000' + Number(v).toString(16);
    return result.substring(result.length - 4);
}
;
new RunZ80();
//# sourceMappingURL=z80run.js.map