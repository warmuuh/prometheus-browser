var charts = {};

const sendBodyToFormatter = (storedData) => {
  // Check if it is a Prometheus plain text response
  // This is quite a basic assumption, as the browser cannot access the
  // 'version' part of the content type to verify.
  if (document.contentType !== 'text/plain') {
    port.disconnect()
    return
  }

  // Check if the current page's paths matches one of our whitelist
  if (!storedData.paths.some(path => document.location.pathname.match(path))) {
    port.disconnect()
    return
  }

  // Check if plain text wrapped in <pre> element exists and doesn't exceed
  // MAX_BODY_SIZE_BYTES
  const pre = document.body.querySelector('pre')
  const rawBody = pre && pre.innerText

  if (!rawBody) {
    port.disconnect()
    return
  }

  // Insert HTML content
  $('<input id="search" />').appendTo("body");
  $('<input type="checkbox" id="subscribe" checked /><label for="subscribe">auto-update</label>').appendTo("body");
  $("#subscribe").change(function(){
    port.postMessage({
      name: 'PROMETHEUS_METRICS_SUBSCRIBE',
      payload: { subscriptionStatus:  this.checked }
    })
  })
  $('<div id="splitpane" style="display: flex" />').appendTo("body");
  $('<div id="jstreewrap" style="min-width: 800px"><div id="jstree_demo_div"/></div>').appendTo("#splitpane");
  $('<div id="graphs" style="width: 100%"/>').appendTo("#splitpane");

  // Post the contents of the PRE
  port.postMessage({
    name: 'PROMETHEUS_METRICS_RAW_BODY',
    payload: { body: rawBody, url: document.location.href }
  })
}


const renderFormattedHTML = (html) => {

  console.log("received data");


  var to = false;
  $('#search').keyup(function () {
    if (to) { clearTimeout(to); }
    to = setTimeout(function () {
      var v = $('#search').val();
      $('#jstree_demo_div').jstree(true).search(v);
    }, 250);
  })


  console.log(html);
  $('#jstree_demo_div').jstree({
    "state": { "key": "demo2" },
    "plugins": ["state", "search", "contextmenu", "grid"],
    "search": {
      show_only_matches: true,
      show_only_matches_children: true
    },
    "grid": {
      columns: [
        {width: 700, header: "Metric"},
        {width: 200, header: "Value", value: "value"}
      ]
    },
    "contextmenu": {
      items: function(clickedNode) {
        // console.log(clickedNode);
        if (!clickedNode.data || clickedNode.data.type !== "metric") {
          return {};
        };

        return {
          "add" : {
            label: "add to Graph",
            action: function(node) {
              console.log(clickedNode);
              port.postMessage({
                name: 'PROMETHEUS_METRICS_SUBSCRIBE_METRIC',
                payload: { metric:  clickedNode.text, url: document.location.href }
              })
            }
          },
          "remove" : {
            label: "remove from Graph",
            action: function(node) {
              console.log(clickedNode);
              port.postMessage({
                name: 'PROMETHEUS_METRICS_UNSUBSCRIBE_METRIC',
                payload: { metric:  clickedNode.text, url: document.location.href }
              })
            }
          }
        };
      }
    },
    "core": {
      "data": html
    }
  });

  // const promformatContent = document.createElement('pre')
  // promformatContent.id = 'promformat'
  // document.body.appendChild(promformatContent)
  // promformatContent.innerHTML = html;
  $('#jstree_demo_div').on("select_node.jstree", function (e, data) {
    console.log(data);
  });
}

const port = chrome.runtime.connect({ name: 'promformat' })

// Add listener to receive response from background when ready
port.onMessage.addListener(msg => {
  if (msg.name === 'PROMETHEUS_METRICS_FORMATTED_BODY') {
    const pre = document.body.querySelector('pre')
    if (pre) {
      pre.parentNode.removeChild(pre);
    }
    renderFormattedHTML(msg.payload)
  }

  if (msg.name === 'PROMETHEUS_METRICS_DEBUG') {
    console.log(msg.payload);

    msg.payload.forEach(series => {
      if (!charts[series.name]) {
        charts[series.name] = addGraph(series.name);
      }
      const chart = charts[series.name];

      series.metrics.forEach(metric => {
        let dataset = chart.data.datasets.find(ds => ds.label === metric.name);
        if (!dataset) {
          dataset = {
            label: metric.name,
            data: []
          };
          chart.data.datasets.push(dataset);
        }

        dataset.data = metric.data;
        chart.config.options.scales.xAxes[0].ticks.max = metric.data[metric.data.length - 1].x;
      });
      chart.update();
    })
  }

})


document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get({ paths: [] }, sendBodyToFormatter)
})

function addGraph(graphId) {
  const graph = $(`<canvas width="400" height="200" style="max-height: 200px"/>`)
    .attr("id", graphId)
    .appendTo("#graphs");

  return new Chart(graph, {
    type: 'line',
    options: {
      maintainAspectRatio: false,
      scales: {
        xAxes: [{
          type: 'time',
          ticks: {
            min: Date.now(),
            max: Date.now() + 1000
          },
          time: {
            unit: 'second'
          }
        }]
      }
    },
    data: {
      labels: 'test',
      datasets: []
    }
  });
}
