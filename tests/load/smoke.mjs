import { setTimeout as delay } from "node:timers/promises";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:8787";
const bookInput = process.env.BOOK_INPUT ?? "https://fanqienovel.com/page/7541439172410625086";
const bookId = process.env.BOOK_ID ?? "7541439172410625086";
const smokeIp = process.env.SMOKE_IP ?? `127.0.2.${Math.floor(Math.random() * 200) + 1}`;

await assertHealthAsync(`${baseUrl}/healthz`);
await assertHealthAsync(`${baseUrl}/readyz`);

const libraryResponse = await fetch(`${baseUrl}/api/library?page=1&pageSize=5`, {
    headers: {
        "x-forwarded-for": smokeIp
    }
});
assertOk(libraryResponse, "library");

const libraryBody = await libraryResponse.json();
console.log(JSON.stringify({
    libraryCount: libraryBody.items?.length ?? 0
}, null, 2));

const jobResponse = await fetch(`${baseUrl}/api/jobs/download`, {
    body: JSON.stringify({
        input: bookInput
    }),
    headers: {
        "content-type": "application/json",
        "x-forwarded-for": smokeIp
    },
    method: "POST"
});

assertOk(jobResponse, "download");
const job = await jobResponse.json();

if (!job?.id)
{
    throw new Error("Không tạo được job tải");
}

console.log(JSON.stringify({
    jobId: job.id,
    bookId
}, null, 2));

const completedJob = await waitForJobAsync(baseUrl, job.id);
const fileResponse = await fetch(`${baseUrl}/api/jobs/${job.id}/file?kind=original&format=txt`);
assertOk(fileResponse, "download-file");

console.log(JSON.stringify({
    finalStatus: completedJob.status,
    fileLength: Number(fileResponse.headers.get("content-length") ?? 0)
}, null, 2));

async function waitForJobAsync(base, jobId)
{
    for (let attempt = 0; attempt < 60; attempt += 1)
    {
        const response = await fetch(`${base}/api/jobs/${jobId}`, {
            headers: {
                "x-forwarded-for": smokeIp
            }
        });
        assertOk(response, "job-status");
        const job = await response.json();

        if (["completed", "failed", "canceled"].includes(job.status))
        {
            return job;
        }

        await delay(1000);
    }

    throw new Error("Job không hoàn tất trong thời gian chờ");
}

async function assertHealthAsync(url)
{
    const response = await fetch(url, {
        headers: {
            "x-forwarded-for": smokeIp
        }
    });
    assertOk(response, url);
}

function assertOk(response, label)
{
    if (!response.ok)
    {
        throw new Error(`${label} thất bại: HTTP ${response.status}`);
    }
}
