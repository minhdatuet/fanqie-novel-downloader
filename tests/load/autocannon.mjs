import autocannon from "autocannon";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:8787";
const durationSeconds = Number.parseInt(process.env.LOAD_DURATION_SECONDS ?? "15", 10);
const overallRate = Number.parseInt(process.env.OVERALL_RATE ?? "5", 10);
let connectionIndex = 0;

const instance = autocannon({
    connections: 30,
    duration: Number.isFinite(durationSeconds) ? durationSeconds : 15,
    requests: [
        {
            method: "GET",
            path: "/healthz"
        },
        {
            method: "GET",
            path: "/api/library?page=1&pageSize=10"
        }
    ],
    setupClient(client)
    {
        const ip = `127.0.3.${(connectionIndex++ % 200) + 1}`;
        client.setHeaders({
            "x-forwarded-for": ip
        });
    },
    overallRate: Number.isFinite(overallRate) && overallRate > 0 ? overallRate : 5,
    url: baseUrl
});

autocannon.track(instance, {
    renderProgressBar: true
});

await new Promise((resolve, reject) =>
{
    instance.on("done", (result) =>
    {
        console.log(JSON.stringify({
            errors: result.errors,
            non2xx: result.non2xx,
            status2xx: result["2xx"],
            status3xx: result["3xx"],
            status4xx: result["4xx"],
            status5xx: result["5xx"],
            p50: result.latency.p50,
            p95: result.latency.p95,
            requests: result.requests.average,
            throughput: result.throughput.average
        }, null, 2));
        resolve(undefined);
    });

    instance.on("error", reject);
});
