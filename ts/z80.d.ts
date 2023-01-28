declare interface Core {
    mem_read: (addr: number) => number;
    mem_write: (addr: number, val: number) => void;
    io_read: (port: number) => number;
    io_write: (port: number, val: number) => void;
}

declare interface Flags {
    S: number;
    Z: number;
    H: number;
    N: number;
    P: number;
    C: number;
    X: number;
    Y: number;
}

declare interface State {
    a: number;
    a_prime: number;
    b: number;
    b_prime: number;
    c: number;
    c_prime: number;
    d: number;
    d_prime: number;
    e: number;
    e_prime: number;
    h: number;
    h_prime: number;
    l: number;
    l_prime: number;
    ix: number;
    iy: number;
    pc: number;
    sp: number;
    flags: Flags;
    flags_prime: Flags;
    halted: boolean;
    i: number;
    r: number;
    iff1: number;
    iff2: number;
    imode: number;
    do_delayed_di: boolean;
    do_delayed_ei: boolean;
}

declare class Z80 {
    constructor(core: Core);

    getState: () => State;
    setState: (state: State) => void;
    reset: () => void;
    run_instruction: () => number;
    interrupt: (non_maskable: boolean, data: number) => void;
}
