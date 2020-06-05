var R = 2.2e3;
var C = 5e-12;
var V = 3.3;
var Vih = 2;
var time = 50.5e-9;
var ticks = 2.5e-9;
var units = 'ns';
var scale = 1e-9;

function redraw() {
    var cvs = document.getElementById('canvas');
    var ctx = cvs.getContext('2d');

    var width = cvs.clientWidth;
    if (cvs.width != width) {
        cvs.width = width;
    }

    var marginLeft = 70;
    var marginRight = 10;

    console.log('C = ' + C);
    var volts = t => V * (1 - Math.exp(-t/(R*C)));
    var until = v => -Math.log((V - v)/V) * R * C;

    // xscale maps pixels to time (and vice versa)
    var xscale = d3.scaleLinear()
        .domain([marginLeft + 10, width - marginRight])
        .range([0, time]);

    var yscale = d3.scaleLinear()
        .domain([0, V])
        .range([cvs.height - 50, 10])
        .clamp(true);

    ctx.clearRect(0, 0, cvs.width, cvs.height);

    // Voltage lines and labels
    ctx.strokeStyle = 'grey';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (var v = 0; v <= V; v++) {
        ctx.moveTo(marginLeft, yscale(v));
        ctx.lineTo(cvs.width - marginRight, yscale(v));
    }
    ctx.moveTo(marginLeft, yscale(V));
    ctx.lineTo(cvs.width - marginRight, yscale(V));

    // time axis
    for (var tick = 0; tick < xscale(width - marginRight)/ticks; tick++) {
        var x = xscale.invert(tick*ticks);
        ctx.moveTo(x, yscale(V) - 5);
        ctx.lineTo(x, yscale(0) + 15);
    }
    ctx.stroke();

    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1.0;
    ctx.textAlign = 'end';
    ctx.textBaseline = 'middle';
    for (var v = 0; v <= V; v++) {
        ctx.strokeText(v, marginLeft - 5, yscale(v));
    }
    ctx.strokeText(V, marginLeft - 5, yscale(V));
    ctx.strokeText('V', marginLeft - 20, yscale(V/2));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (var tick = 0; tick < xscale(width - marginRight); tick += ticks) {
        var x = xscale.invert(tick);
        ctx.strokeText((tick / scale).toFixed(1), x, yscale(0) + 17);
    }
    ctx.strokeText('time (' + units + ')', (width - marginRight - marginLeft) / 2 + marginLeft, yscale(0) + 30);

    // High voltage, low voltage, crossing times
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = 'red';
    ctx.lineDashOffset = 15;
    ctx.beginPath();
    ctx.moveTo(marginLeft, yscale(Vih));
    ctx.lineTo(cvs.width - marginRight, yscale(Vih));
    ctx.stroke();

    var Vih_x = xscale.invert(until(Vih));
    if (Vih_x < width - marginRight) {
        var fmt = d3.format('.3s');
        ctx.moveTo(Vih_x, yscale(V) - 5);
        ctx.lineTo(Vih_x, yscale(0) + 15);
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeText(fmt(until(Vih)) + 's', Vih_x, yscale(0)+40);
    }
    ctx.textAlign = 'end';
    ctx.textBaseline = 'middle';
    ctx.strokeText('Vih', marginLeft - 20, yscale(Vih));

    ctx.strokeStyle = 'black';
    ctx.lineDashOffset = 0;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(marginLeft, yscale(volts(xscale(marginLeft))));
    for (var x = marginLeft+1; x < cvs.width - marginRight; x++) {
        var yV = 0;
        var t = xscale(x);
        if (t < 0.0) {
            yV = 0;
        } else if (Math.floor(t) % 2 == 0) {
            yV = volts(t);
        } else {
            yV = 0;
        }
        ctx.lineTo(x, yscale(yV));
    }
    ctx.stroke();
}

function mkselect(label, opts, def, fmt, onchange) {
    var span = document.createElement('span');
    var sel = d3.select(span)
        .text(label)
        .style('margin' ,'0 1em')
        .append('select')
        .on('change', () => { var i = sel.property('selectedIndex'); onchange(opts[i]); });
    var opt = sel.selectAll('option').data(opts);
    opt.enter()
        .append('option')
        .attr('value', d => d)
        .text(fmt);
    sel.property('selectedIndex', opts.indexOf(def))
    return span;
}

function controls() {
    var cvs = document.getElementById('canvas');
    var ohms = [330, 1e3, 2.2e3, 3.3e3, 4.7e3, 6.8e3, 10e3];
    var caps = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
    var div = document.createElement('div');
    d3.select(div).style('text-align', 'center')
                  .style('margin', '0 0 1em 0')
                  .style('font-size', '80%');
    var fmt = d3.format('.2s');
    div.appendChild(mkselect('Resistance: ', ohms, R, d => fmt(d) + 'Ω',
        (d) => { R = d; redraw(); }));
    div.appendChild(mkselect('Capacitance: ', caps, C*1e12, d => d + 'pF',
        (d) => { console.log(d); C = d*1e-12; redraw(); }));

    cvs.insertAdjacentElement('afterend', div);
}

function resized() {
    var cvs = document.getElementById('canvas');
    if (cvs.clientWidth != cvs.width) {
        if (resized.tid !== undefied)
            clearTimeout(resized.tid);
        resized.tid = setTimeout(redraw, 50);
    }
}

window.addEventListener('resize', resized, false);

redraw();
controls();
