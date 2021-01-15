let tsdb = new TSDB();
let subscriptionActive = true;

Object.defineProperty(String.prototype, 'hashCode', {
    value: function () {
        var hash = 0, i, chr;
        for (i = 0; i < this.length; i++) {
            chr = this.charCodeAt(i);
            hash = ((hash << 5) - hash) + chr;
            hash |= 0; // Convert to 32bit integer
        }
        return hash;
    }
});

const defaultPaths = [
    '^/metrics',
    '^/federate',
    '^/probe',
    '^/prometheus',
    '^/actuator/prometheus'
]

let intervalId = null;
let subscribedMetrics = [
]

let labelDictionary = {};

function updateTsdb(prometheusMetrics) {
    const now = Date.now();

    prometheusMetrics.forEach(meter => {
        meter.metrics.forEach(metric => {
            labelDictionary[meter.name] = metric.labels ? Object.keys(metric.labels) : [];
            tsdb.series(meter.name).insert({
                ...metric.labels,
                value: metric.value
            }, now)
        });
    });
}

function mapPrometheusMeterToJsTreeNode(meter) {
    return {
        text: meter.name,
        data: {
            type: "metric"
        },
        children: meter.metrics.map(metric => {
            var name = "";
            if (metric.labels) {
                for (const [key, value] of Object.entries(metric.labels)) {
                    name += `${key}->${value} `
                }
            }
            return {
                text: name,
                data: {
                    type: "value",
                    value: metric.value
                }
            }
        })
    };
}

const formatPrometheusMetrics = (body) => {
    const prometheusMetrics = parsePrometheusTextFormat(body);
    updateTsdb(prometheusMetrics);

    return prometheusMetrics.map(mapPrometheusMeterToJsTreeNode)
        .sort((a, b) => {
            if (a.text < b.text) return -1;
            if (a.text > b.text) return 1;
            return 0;
        });
};

function hashOfLabels(pt, labels) {
    return labels.map(l => pt[l]).join().hashCode();
}
function metricNameWithLabels(metricName, pt, labels) {
    return metricName + " [" + labels.map(l => l + "=" + pt[l]).join(", ") + "]";
}
function getSubscribedMetrics() {
    return subscribedMetrics.map(metricName => {
        const query = tsdb.series(metricName).query({
            metrics: {
                data: TSDB.map(pt => {
                    return { ...pt.toObject(), x: pt.data.time, y: pt.data.value }
                })
            }
        });

        var groups = _.groupBy(query[0].results.data, pt => hashOfLabels(pt, labelDictionary[metricName]))
        var datasets = [];
        for (const groupId in groups) {
            datasets.push({
                name: metricNameWithLabels(metricName, groups[groupId][0], labelDictionary[metricName]),
                data: groups[groupId]
            })
        }
        return {
            name: metricName,
            metrics: datasets
        };
    })

}


// Listen for requests from content pages wanting to set up a port
chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'promformat') {
        console.error(`[Prometheus Formatter] unknown port name "${port.name}". Aborting.`)
        return
    }

    port.onMessage.addListener(msg => {
        if (msg.name === "PROMETHEUS_METRICS_SUBSCRIBE_METRIC") {
            subscribedMetrics.push(msg.payload.metric)
        }
        if (msg.name === "PROMETHEUS_METRICS_SUBSCRIBE") {
            subscriptionActive = msg.payload.subscriptionStatus;
        }
        if (msg.name === "PROMETHEUS_METRICS_UNSUBSCRIBE_METRIC") {
            subscribedMetrics = subscribedMetrics.filter(m => m !== msg.payload.metric)
            if (subscribedMetrics.length == 0 && intervalId) {
                clearInterval(intervalId);
                intervalId = null;
            }

        }

        if (msg.name === 'PROMETHEUS_METRICS_RAW_BODY') {

            // Post the HTML string back to the content script
            port.postMessage({
                name: 'PROMETHEUS_METRICS_FORMATTED_BODY',
                payload: formatPrometheusMetrics(msg.payload.body)
            })

            port.onDisconnect.addListener(() => {
                console.log("disconnected");
                clearInterval(intervalId);
                intervalId = null;
                labelDictionary = {};
                tsdb.destroy();
                subscribedMetrics = [];
            });
        }



        if (!intervalId && subscribedMetrics.length > 0) {
            intervalId = setInterval(function () {
                if (subscriptionActive){
                    $.ajax({ url: msg.payload.url })
                        .done(function (data) {
                            const prometheusMetrics = parsePrometheusTextFormat(data);
                            updateTsdb(prometheusMetrics);
                            const subscribedMetrics = getSubscribedMetrics();
                            // console.log( "received data:", data );
                            // Post the HTML string back to the content script
                            console.log("ping", subscribedMetrics);
                            port.postMessage({
                                name: 'PROMETHEUS_METRICS_DEBUG',
                                payload: subscribedMetrics
                            })
                        });
                }
            }, 1000)
        }



    })
})


// Set default paths on extension installation and update
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.sync.get({ paths: [] }, storedData => {
        if (!storedData.paths.length) {
            chrome.storage.sync.set({ paths: defaultPaths })
        }
    })
})