$(function() {
    let steps = [
        {
            sel: ".MREQ,.RAM,.ROM,.ISA",
            title: '/RESET held low',
            desc: "During power-up, /RESET is held low while the CPU initialises. The flip-flop's state is indeterminate."
        },
        {
            sel: ".RESET,.MREQ,.U1Q,.A19a,.RAM,.ROM,.ISA",
            title: "/RESET goes high",
            desc: "When /RESET rises, the flip-flop latches in a HIGH value. The OR gate output goes HIGH."
        },
        {
            sel: ".RESET,.U1Q,.A19a,.RAM,.ISA",
            title: "Opcode fetch",
            desc: "The CPU fetches the first opcode from $0000. /MREQ goes active, and ROM is selected."
        },
        {
            sel: ".RESET,.U1Qx,.A19,.A19x,.A19a,.RAM,.ISA",
            title: "High memory is accessed",
            desc: "The MMU maps ROM in, and the boot code jumps to it. A19 goes high, resetting the flip-flop."
        },
        {
            sel: ".RESET,.U1Qx,.ROM,.ISA",
            title: "Low memory is accessed",
            desc: "Further accesses between $00000 and $7FFFF now activate RAM."
        }
    ];

    var step = 0;

    let SVG = 'http://www.w3.org/2000/svg';

    var tspan = t => {
        var s = document.createElementNS(SVG, 'tspan');
        s.appendChild(document.createTextNode(t));
        return s;
    };

    var mkSpans = t => {
        var spans = [];
        // split on /PIN
        t.split(/(?=\/[A-Z]+)/).forEach(tt => {
            console.log(tt);
            if (tt.startsWith('/')) {
                var [pin, ...text] = tt.split(/(?=\s)/);
                console.log(pin, text);
                var pspan = tspan(pin.substring(1));
                pspan.setAttribute('text-decoration', 'overline');
                spans.push(pspan);
                text.forEach(str => spans.push(tspan(str)));
            } else {
                spans.push(tspan(tt));
            }
        });
        return spans;
    };

    var set = nextStep => {
        if (nextStep < 0 || nextStep >= steps.length) return;
        $(steps[step].sel).removeClass("HIGH");
        step = nextStep;
        $(steps[step].sel).addClass("HIGH");
        $("#title").empty();
        $("#title").append(mkSpans(steps[step].title));
        $("#desc").empty();
        $("#desc").append(mkSpans(steps[step].desc));
        $("#back").toggleClass("active", step > 0);
        $("#next").toggleClass("active", step < steps.length - 1);
    };

    set(0);

    $("#back,#next").on("mousedown", e => $(e.target).addClass("click"));
    $("#back,#next").on("mouseup", e => $(e.target).removeClass("click"));
    $("#back,#next").on("mouseout", e => $(e.target).removeClass("click"));
    $("#back").click(e => { set(step - 1); });
    $("#next").click(e => { set(step + 1); });

});
