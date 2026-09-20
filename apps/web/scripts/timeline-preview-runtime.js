// Browser-side hover card for the standalone chronology preview.
// The samples array is injected just above by the generator.
(function () {
  var wrap = document.getElementById("wrap");
  var card = document.getElementById("card");
  var chart = document.getElementById("chart");

  function clock(s) {
    var t = Math.max(0, Math.round(s));
    var m = Math.floor(t / 60);
    var r = t % 60;
    return m + ":" + (r < 10 ? "0" : "") + r;
  }

  function nearest(seconds) {
    var best = samples[0];
    var dist = Math.abs(samples[0].t - seconds);
    for (var i = 1; i < samples.length; i++) {
      var d = Math.abs(samples[i].t - seconds);
      if (d < dist) {
        dist = d;
        best = samples[i];
      }
    }
    return best;
  }

  function render(sample) {
    var html = '<div class="head"><span class="time">' + clock(sample.t) + '</span></div>';
    html += '<div class="levels">';
    sample.rows.forEach(function (row) {
      var level = row.level === null ? "\u2014" : String(row.level);
      html += '<div class="row"><span class="dot" style="background:' + row.color + '"></span><span class="name" style="color:' + row.color + '">' + row.label + '</span><span class="level">' + level + '</span></div>';
    });
    html += '</div>';
    if (sample.leadLabel) {
      var color = sample.leader === null ? null : sample.rows[sample.leader].color;
      html += '<div class="lead" style="color:' + (color || "var(--muted)") + ';border-color:' + (color || "var(--border)") + '">' + sample.leadLabel + '</div>';
    }
    if (sample.structures.length || sample.deaths) {
      html += '<div class="events">';
      sample.structures.forEach(function (event) {
        html += '<div class="row"><span class="sq" style="background:' + event.color + '"></span><span class="name">' + event.label + ' détruit</span><span class="side">' + event.side + '</span></div>';
      });
      if (sample.deaths) {
        html += '<p class="muted">' + sample.deaths + ' mort(s) à cet instant</p>';
      }
      html += '</div>';
    }
    card.innerHTML = html;
  }

  function place(clientX, clientY) {
    var rect = wrap.getBoundingClientRect();
    var x = clientX - rect.left;
    var y = clientY - rect.top;
    card.style.left = x + "px";
    card.style.top = y + "px";
    card.style.transform =
      "translate(" +
      (x > rect.width / 2 ? "calc(-100% - 14px)" : "14px") +
      ", " +
      (y > rect.height / 2 ? "calc(-100% - 14px)" : "14px") +
      ")";
  }

  function secondsAt(clientX) {
    var rect = chart.getBoundingClientRect();
    var ratio = ((clientX - rect.left) / rect.width) * 800;
    return Math.min(1320, Math.max(0, ((ratio - 132) / 660) * 1320));
  }

  wrap.addEventListener("mousemove", function (event) {
    render(nearest(secondsAt(event.clientX)));
    place(event.clientX, event.clientY);
    card.style.opacity = "1";
  });
  wrap.addEventListener("mouseleave", function () {
    card.style.opacity = "0";
  });

  var rect = chart.getBoundingClientRect();
  render(nearest(600));
  place(rect.left + 132 + (600 / 1320) * 660, rect.top + 78);
  card.style.opacity = "1";
})();
