var R = 10e3;

function redraw() {
    var cvs = document.getElementById('canvas');
    var ctx = cvs.getContext('2d');

    var width = cvs.clientWidth;
    if (cvs.width != width) {
        cvs.width = width;
    }

    var marginLeft = 70;
    var marginRight = 10;

    var volts = (R, C, t) => 5 * (1 - Math.exp(-t/(R*C)));

    var xscale = d3.scaleLinear()
        .domain([marginLeft + 10, 600])
        .range([0, 10000e-9]);
    var tscale = d3.scaleLinear()
        .domain([0, xscale(width - marginRight)])
        .range([marginLeft + 10, width - marginRight])

    var yscale = d3.scaleLinear()
        .domain([0, 5])
        .range([cvs.height - 50, 10])
        .clamp(true);

    var C = 25e-12;

    ctx.clearRect(0, 0, cvs.width, cvs.height);

    // Voltage lines and labels
    ctx.strokeStyle = 'grey';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (var v = 0; v <= 5; v++) {
        ctx.moveTo(marginLeft, yscale(v));
        ctx.lineTo(cvs.width - marginRight, yscale(v));
    }

    // time axis
    for (var tick = 0; tick < xscale(width - marginRight)*1e6; tick++) {
        var x = tscale(tick*1e-6);
        ctx.moveTo(x, yscale(5) - 5);
        ctx.lineTo(x, yscale(0) + 15);
    }
    ctx.stroke();

    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1.0;
    ctx.textAlign = 'end';
    ctx.textBaseline = 'middle';
    for (var v = 0; v <= 5; v++) {
        ctx.strokeText(v, marginLeft - 5, yscale(v));
    }
    ctx.strokeText('V', marginLeft - 20, yscale(2.5));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (var tick = 0; tick < xscale(width - marginRight)*1e6; tick++) {
        var x = tscale(tick*1e-6);
        ctx.strokeText(tick.toFixed(0), x, yscale(0) + 17);
    }
    ctx.strokeText('time (μS)', (width - marginRight - marginLeft) / 2 + marginLeft, yscale(0) + 30);

    ctx.lineWidth = 0.5;
    ctx.strokeStyle = 'red';
    ctx.lineDashOffset = 15;
    ctx.textAlign = 'end';
    ctx.textBaseline = 'middle';
    ctx.beginPath();
    ctx.moveTo(marginLeft, yscale(2.3));
    ctx.lineTo(cvs.width - marginRight, yscale(2.3));
    ctx.stroke();
    ctx.strokeText('VIH', marginLeft - 5, yscale(2.3));

    ctx.strokeStyle = 'black';
    ctx.lineDashOffset = 0;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(marginLeft, yscale(volts(R, C, xscale(marginLeft))));
    for (var x = marginLeft+1; x < cvs.width - marginRight; x++) {
        var yV = 0;
        var t = xscale(x)*1e6;
        if (t < 0.0) {
            yV = 0;
        } else if (Math.floor(t) % 2 == 0) {
            yV = volts(R, C, (t - Math.floor(t)) * 1e-6);
        } else {
            yV = 0;
        }
        ctx.lineTo(x, yscale(yV));
    }
    ctx.stroke();

    console.log(R);
}

function controls() {
    var cvs = document.getElementById('canvas');
    var ohms = [3.3e3, 4.7e3, 6.8e3, 10e3, 22e3, 33e3, 47e3];
    var div = d3.select(document.createElement('div'));
    var fmt = d3.format('.2s');
    var sel = div
        .text('Resistance: ')
        .style('text-align', 'center')
        .style('font-size', '80%')
        .append('select')
        .on('change', () => { R = ohms[sel.property('selectedIndex')]; redraw(); });
    var opts = sel.selectAll('option').data(ohms);
    opts.enter()
        .append('option')
        .attr('value', d => d)
        .text(d => fmt(d) + 'Ω');
    sel.property('selectedIndex', ohms.indexOf(R))

    cvs.insertAdjacentElement('afterend', div.node());
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
