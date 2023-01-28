export interface Location {
    line: number;
    column: number;
    source: any;
}
export interface Expression {
    expression: string;
    vars: string[];
    location: Location;
}
export interface Relative {
    relative: Expression | number | string;
}

type StatementType = "org" | "phase" | "endphase" | "align" | "include" | "incbin" | "macrocall"
                       | "block" | "endblock" | "bytes" | "comment" | "macrodef" | "endmacro" | "equ"
                       | "defs" | "defw" | "defb" | "label" | "if" | "else" | "endif";

export interface Result<T extends StatementType> {
    type: T;
    location: Location;
}

export interface Org extends Result<"org"> {
    org: string | number | Expression;
}
export interface Phase extends Result<"phase"> {
    phase: string | number | Expression;
}
export interface EndPhase extends Result<"endphase"> {
}
export interface Align extends Result<"align"> {
    align: string | number | Expression;
    fill: string | number | Expression;
    maximum: string | number | Expression;
}
export interface Include extends Result<"include"> {
    include: string;
    included?: true;
}
export interface Incbin extends Result<"incbin"> {
    incbin: string;
    included?: true;
}
export interface MacroCall extends Result<"macrocall"> {
    macrocall: string;
    args: (string | number | Expression)[];
    params: string[];
    expanded: boolean;
}
export interface Block extends Result<"block"> {
}
export interface EndBlock extends Result<"endblock"> {
}
export interface Comment extends Result<"comment"> {
    comment: string;
}
export interface MacroDef extends Result<"macrodef"> {
    macrodef: string;
    params: string[];
}
export interface EndMacro extends Result<"endmacro"> {
}
export interface Equ extends Result<"equ"> {
    label: string;
    equ: Expression;
}
export interface Defs extends Result<"defs"> {
    defs: Expression;
}
export interface Emitted<T extends StatementType> extends Result<T> {
    bytes: (Expression | Relative | number | null)[];
    references: boolean;
    undoc: boolean;
}
export interface Bytes extends Emitted<"bytes"> {
}
export interface Defw extends Emitted<"defw"> {
    bytes: (Expression | number)[];
    undoc: false;
}
export interface Defb extends Emitted<"defb"> {
    bytes: (Expression | number)[];
    undoc: false;
}
export interface Label extends Result<"label"> {
    label: string;
    public: boolean;
}
export interface If extends Result<"if"> {
    if: number | string | Expression;
}
export interface Else extends Result<"else"> {
}
export interface EndIf extends Result<"endif"> {
}

export type AnyResult = Org | Phase | Align | Include | Incbin | MacroCall | Block | EndBlock | Bytes | Comment
                      | MacroDef | EndMacro | Equ | Defs | Defb | Defw | Label | EndPhase | If | EndIf | Else;

export interface Options {
    line?: number;
    source?: any;
}

export function parse(code: string, options?: Options): AnyResult[];
