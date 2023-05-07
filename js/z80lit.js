
///////////////////////////////////////////////////////////////////////////////
// The below functions assemble all Z80 code blocks on the page, and show the
// resulting opcodes to the right of the code.

let zmem = new Uint8Array(65536);
let core = {
    display: undefined,
    mem_read: (address) => zmem[address],
    mem_write: (address, value) => zmem[address] = value,
    io_read: (port) => 0xff,
    io_write: (port, value) => {
        if ((port & 0xff) === 1) {
            let c = String.fromCharCode(value);
            if (core.display !== undefined) {
                core.display.text(core.display.text() + c)
            } else {
                $(".console code").each((_, vt) => {
                    $(vt).text($(vt).text() + c)
                });
            }
        } else {
            console.log('OUT to port ' + port);
        }
    },
};
let z80 = new Z80(core);

let program = [];
let symtab = {};

let reset = function() {
    for (let node of program) {
        if (node.bytes !== undefined) {
            for (let i = 0; i < node.bytes.length; i++) {
                zmem[node.org + i] = node.bytes[i];
            }
        }
    }
    z80.reset();
}

let mkemulator = function() {
    let zmem = new Uint8Array(65536);
    let core = {
        display: undefined,
        mem_read: (address) => zmem[address],
        mem_write: (address, value) => zmem[address] = value,
        io_read: (port) => 0xff,
        io_write: (port, value) => {
            if ((port & 0xff) === 1) {
                let c = String.fromCharCode(value);
                if (core.display !== undefined) {
                    core.display.text(core.display.text() + c)
                } else {
                    $(".console code").each((_, vt) => {
                        $(vt).text($(vt).text() + c)
                    });
                }
            } else {
                console.log('OUT to port ' + port);
            }
        },
    };
    let z80 = new Z80(core);
    for (let node of program) {
        if (node.bytes !== undefined) {
            for (let i = 0; i < node.bytes.length; i++) {
                zmem[node.org + i] = node.bytes[i];
            }
        }
    }
    z80.reset();
    return {
        cpu: z80,
        mem: zmem,
        core: core,
    };
};

let compiled = new Promise((compileDone) => {
    $(() => import('./z80/parser.js').then(z80parse => { import('./z80/expr.js').then(z80expr => {
        let error = function(node, msg) {
            let span = $('<span class="opcodes er"></span>');
            span.text(msg);
            node.elem.append(span);
        };

        let hex8 = function(v) {
            let result = '00' + Number(v).toString(16);
            return result.substring(result.length - 2);
        };

        let hex16 = function(v) {
            let result = '0000' + Number(v).toString(16);
            return result.substring(result.length - 4);
        };

        let annotate = function(node, label) {
            let span = $('<span class="opcodes bn"></span>');
            span.text(label);
            // don't replace an existing entry: it's probably an error message
            if (node.elem.find('.opcodes').length === 0) {
                node.elem.append(span);
            }
        }

        let opcodes = function(node, bytes) {
            let addr = hex8(node.org >> 8) + hex8(node.org) + ': ';
            if (bytes.length > 6) {
                annotate(node, addr + bytes.slice(0, 5).map(hex8).join(' ') + '...');
            } else {
                let padding = '   '.repeat(6 - bytes.length);
                annotate(node, addr + bytes.map(hex8).join(' ') + padding);
            }
        };

        let lookup = function(label, env) {
            let value = undefined;
            for (let tab of env) {
                if (tab.hasOwnProperty(label)) {
                    value = tab[label];
                }
            }
            return value;
        };

        let resolve = function(expr, org, env) {
            let vars = {};
            for (let tab of env) {
                for (let entry of Object.entries(tab)) {
                    vars[entry[0]] = entry[1].value;
                }
            }
            vars['$'] = org;
            return z80expr.parse(expr, { variables: vars });
        };

        let line = 1;
        let execs = [];
        let runs = [];
        $('pre.sourceCode.z80').each((i, pre) => {
            let exec = $(pre).hasClass('execute');
            let run = $(pre).hasClass('run');
            $(pre).find('code > span').each((i, elem) => {
                const code = $(elem).text();
                try {
                    const result = z80parse.parse(code, { line: line++ });
                    if (result !== null) {
                        if (exec) execs.push(result[0]);
                        if (run) runs.push([result[0], pre]);
                        exec = run = false;
                        program.push(...(result.map(item => { item.elem = $(elem); item.source = code; return item; })));
                    }
                } catch (e) {
                    // check for ASSERT
                    error({ elem: $(elem) }, 'syntax error');
                    console.log(e.toString(), code);
                }
            });
        });

        // extract macros
        let macros = {};
        let macro = undefined;
        for (let node of program) {
            if (node.macrodef !== undefined) {
                if (macro !== undefined) {
                    error(node, 'nested macro');
                    break;
                }

                if (macros[node.macrodef] !== undefined) {
                    error(node, 'redefined macro');
                    break;
                }

                macro = {
                    name: node.macrodef,
                    params: node.params ?? [],
                    body: [],
                }
                macros[node.macrodef] = macro;
            } else if (node.endmacro === true) {
                if (macro === undefined) {
                    error(node, 'not in macro');
                    break;
                }
                macro = undefined;
            } else if (macro !== undefined) {
                macro.body.push({...node});
                node.trim = true;
            }
        }
        program = program.filter(node => node.trim === undefined);

        // expand macros
        program = program.flatMap(node => {
            if (node.macrocall !== undefined) {
                if (macros.hasOwnProperty(node.macrocall)) {
                    let macro = macros[node.macrocall];

                    // check params and args
                    let params = macro.params ?? [];
                    let args = node.args ?? [];
                    if (params.length !== args.length) {
                        error(node, 'bad macro args');
                        return [];
                    }

                    let locals = {};
                    for (let i in params) {
                        if (locals.hasOwnProperty(params[i])) {
                            error(node, 'duplicate arg');
                            return [];
                        }
                        if (params[i] in locals) {
                            error(node, 'reserved arg');
                            return [];
                        }
                    }

                    // TODO: locals and symbol table entries are different

                    // replace the macro call with the macro body
                    // include parameter definitions where given
                    // copy the element from the macrocall node
                    //   ... which will only show opcode bytes for the first instruction in the body
                    //   but fixing that would involve mucking about a bit
                    return [node] + macro.body.map(item => {

                        let expanded = {
                            env: locals,
                            ... item,
                            elem: node.elem
                        };

                        // make a copy of the bytes
                        if (item.bytes !== undefined) {
                            expanded.bytes = [...item.bytes];
                        }

                        return expanded;
                    });
                } else {
                    error(node, 'syntax error');
                    return [];
                }
            } else {
                return [node];
            }
        });

        // resolve symbols
        let org = 0;
        let unresolved = new Set();
        let table = symtab;
        let blocks = [];
        for (let node of program) {
            if (node.block === true) {
                blocks.push(table);
                table = node.symtab = {};
            } else if (node.endblock === true) {
                if (blocks.length === 0) {
                    error(node, 'no block');
                    return;
                }
                table = blocks.pop();
            } else if (node.equ !== undefined) {
                table[node.label] = {
                    org: org,
                    node: node,
                    value: node.equ,
                };
                if (node.equ.expression !== undefined) {
                    unresolved.add(table[node.label]);
                }
            } else if (node.label !== undefined) {
                if (table.hasOwnProperty(node.label)) {
                    error(node, 'redefined');
                } else if (node.label in table) {
                    error(node, 'reserved');
                } else {
                    table[node.label] = {
                        org: org,
                        node: node,
                        value: org,
                    };
                }
            }

            if (node.org !== undefined) {
                org = node.org;
            } else {
                node.org = org;
                org += node.bytes?.length ?? 0;
                org += node.defs ?? 0;
            }
            for (let sym of Object.entries((node.env ?? {}))) {
                if (sym.value.expression !== undefined) {
                    unresolved.add(sym);
                }
            }
            node.env = [...blocks, table, ...(node.env === undefined ? [] : [node.env])];
        }

        while (unresolved.size > 0) {
            let resolved = false;
            for (let symbol of unresolved) {
                let resolvable = true;
                for (let l of symbol.value.vars) {
                    let v = lookup(l, symbol.node.env);
                    // this works for just a simple label, but not for stacked environments
                    if (unresolved.has(v)) {
                        resolvable = false;
                    }
                }
                if (resolvable) {
                    unresolved.delete(symbol);
                    try {
                        symbol.value = resolve(symbol.value.expression, symbol.org, symbol.node.env);
                        let msg = '= ' + symbol.value + ' ($' + symbol.value.toString(16) + ')';
                        annotate(symbol.node, msg + ' '.repeat(23 - msg.length));
                    } catch (e) {
                        symbol.value = 0;
                        error(symbol.node, 'error');
                        console.log('Unresolvable', symbol, e.toString());
                    }
                    // An error is a resolution of sorts
                    resolved = true;
                }
            }
            if (!resolved) {
                for (let sym of unresolved) {
                    let symbol = symtab[sym];
                    error(symbol.node, 'circular definition');
                }
            }
        }

        // update references
        for (let node of program) {
            if (node.bytes !== undefined) {
                for (let i = 0; i < node.bytes.length; i++) {
                    const b = node.bytes[i];
                    if (b && b.expression !== undefined) {
                        let val = 0;
                        try {
                            val = resolve(b.expression, node.org, node.env);
                        } catch (e) {
                            error(node, 'error');
                            console.log('Unresolvable', b, e.toString());
                        }
                        node.bytes[i] = val & 0xff;
                        if (node.bytes[i+1] === null) {     // past end of array will be undefined, not null
                            node.bytes[i+1] = (val >> 8) & 0xff;
                        }
                    } else if (b && b.relative !== undefined) {
                        let target = b.relative;
                        if (target.expression !== undefined) {
                            target = resolve(target.expression, node.org, node.env);
                        }
                        let disp = target - (node.org + 2);
                        if (disp < -128 || disp > 127) {
                            error(node, disp + ' out of range');
                            node.bytes[i] = 0;
                        } else {
                            node.bytes[i] = disp & 0xff;
                        }
                    }
                }
                opcodes(node, node.bytes);
            } else if (node.defs !== undefined) {
                let note = hex16(node.org) + ': ' + hex16(node.defs) + ' bytes       ';
                annotate(node, note);
            }
        }

        // map assertions to PC
        let asserts = [];
        let disasm = [];
        for (let node of program) {
            if (node.source !== undefined) {
                disasm[node.org] = node.source;
            }
            if (node.comment === undefined) continue;
            let assertions = node.comment.match(/\s*ASSERT\s+(.*)=(.*)$/);
            if (assertions) {
                try {
                    asserts[node.org] = {
                        'register': assertions[1],
                        'value': resolve(assertions[2], node.org, []),
                        node: node,
                    };
                } catch (e) {
                    error(node, 'bad expr');
                    console.log(assertions[1], assertions[2], e);
                }
            }
        }

        let register = function(state, reg) {
            switch (reg.toUpperCase()) {
                case 'A': return state.a;
                case 'B': return state.b;
                case 'C': return state.c;
                case 'D': return state.d;
                case 'E': return state.e;
                case 'H': return state.h;
                case 'L': return state.l;
                case 'BC': return (state.b << 8 | state.c);
                case 'DE': return (state.d << 8 | state.e);
                case 'HL': return (state.h << 8 | state.l);
                case 'IX': return state.ix;
                case 'IY': return state.iy;
                case 'PC': return state.pc;
                case 'SP': return state.sp;
                default:
                    throw ("unknown register " + reg);
            }
        }

        let mktrace = function(state) {
            let trace = 'A=' + hex8(state.a);
            trace += ' F=' + (state.flags.S ? 'S' : 's');
            trace += state.flags.Z ? 'Z-' : 'z-';
            trace += state.flags.H ? 'H-' : 'h-';
            trace += state.flags.P ? 'P' : 'p';
            trace += state.flags.N ? 'N' : 'n';
            trace += state.flags.C ? 'C' : 'c';
            trace += ' BC=' + hex8(state.b) + hex8(state.c);
            trace += ' DE=' + hex8(state.d) + hex8(state.e);
            trace += ' HL=' + hex8(state.h) + hex8(state.l);
            trace += ' IX=' + hex16(state.ix);
            trace += ' IY=' + hex16(state.iy);
            trace += ' SP=' + hex16(state.sp);
            return trace;
        };

        // let other code use compilation results
        compileDone({
            step: () => {
                z80.run_instruction();
            },
            trace: () => {
                let state = z80.getState();
                let trace = hex16(state.pc) + ': ' + disasm[state.pc] + '                                 ';
                trace = trace.substr(0, 40) + '; ' + mktrace(state);
                console.log(trace);
                return state;
            }
        });

        // execute blocks
        for (let exec of execs) {
            reset();
            let state = z80.getState();
            state.pc = exec.org;
            z80.setState(state);

            // execute instructions until HALT or 10000 cycles have passed
            let cycles = 0;
            do {
                let trace = hex16(state.pc) + ': ' + disasm[state.pc] + '                                 ';

                cycles += z80.run_instruction() + 1;
                state = z80.getState();

                // a proper trace needs a disassembler, this one will just work for code from the original source
                trace = trace.substr(0, 40) + '; ' + mktrace(state);
                //console.log(trace);

                if (!state.halted && asserts[state.pc] !== undefined) {
                    try {
                        let lhs = register(state, asserts[state.pc].register);
                        if (lhs === asserts[state.pc].value) {
                            annotate(asserts[state.pc].node, 'OK');
                        } else {
                            error(asserts[state.pc].node, hex16(lhs));
                            console.log('Assertion failed');
                        }
                    } catch (e) {
                        error(asserts[state.pc].node, asserts[state.pc].register + ' invalid');
                    }
                }
            } while (cycles < 10000 && !state.halted);

        }

        // run code blocks marked ".run" for 10,000 cycles per frame
        let runblocks = function() {
            if (runs.length > 0) {
                let run = runs.shift();
                core.display = $('<pre class="console">CONSOLE OUTPUT:\n</pre>').insertAfter(run[1]);
                reset();
                let state = z80.getState();
                state.pc = run[0].org;
                z80.setState(state);
                let frames = 0;
                let frame = function() {
                    if (++frames > 1000) {
                        console.log('Halting execution early after 1,000 frames');
                        requestAnimationFrame(runblocks);
                        return;
                    }

                    let cycles = 0;
                    let state = z80.getState();
                    do {
                        let trace = hex16(state.pc) + ': ' + disasm[state.pc] + '                                 ';

                        cycles += z80.run_instruction();
                        state = z80.getState();

                        // a proper trace needs a disassembler, this one will just work for code from the original source
                        trace = trace.substr(0, 40) + '; ' + mktrace(state);
                        //console.log(trace);
                    } while (!state.halted && cycles < 10000);

                    if (state.halted) {
                        console.log('Block run terminated: ' + mktrace(z80.getState()));
                        requestAnimationFrame(runblocks);
                    } else {
                        requestAnimationFrame(frame);
                    }
                };

                frame();
            } else {
                core.display = undefined;
            }
        };

        runblocks();
    })}));
});
