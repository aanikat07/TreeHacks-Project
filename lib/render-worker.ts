interface EnqueueRenderJobInput {
  jobId: string;
  pythonCode: string;
  callbackUrl: string;
}

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function summarizeWorkerError(status: number, body: string) {
  const compact = body.replace(/\s+/g, " ").trim();
  const lower = compact.toLowerCase();
  const workerUrl = process.env.RENDER_WORKER_URL;

  if (
    status === 503 &&
    lower.includes("service suspended") &&
    lower.includes("suspended by its owner")
  ) {
    return `Render worker service is suspended at ${workerUrl}. Unsuspend/redeploy it or update RENDER_WORKER_URL to a running worker.`;
  }

  if (/<\/?[a-z][\s\S]*>/i.test(compact)) {
    return `Worker enqueue failed (${status}): Received HTML error page from worker URL ${workerUrl}.`;
  }

  const truncated = compact.slice(0, 300);
  return `Worker enqueue failed (${status}): ${truncated || "Unknown error"}`;
}

export async function enqueueRenderJob({
  jobId,
  pythonCode,
  callbackUrl,
}: EnqueueRenderJobInput) {
  const workerUrl = getRequiredEnv("RENDER_WORKER_URL");
  const workerSecret = getRequiredEnv("RENDER_WORKER_SECRET");

  const response = await fetch(`${workerUrl.replace(/\/$/, "")}/render`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${workerSecret}`,
    },
    body: JSON.stringify({
      jobId,
      pythonCode,
      callbackUrl,
      callbackSecret: getRequiredEnv("RENDER_CALLBACK_SECRET"),
      blobToken: getRequiredEnv("BLOB_READ_WRITE_TOKEN"),
      blobStoreName: "manim-store",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(summarizeWorkerError(response.status, errorText));
  }
}
