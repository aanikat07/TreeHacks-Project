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
    throw new Error(
      `Worker enqueue failed (${response.status}): ${errorText || "Unknown error"}`,
    );
  }
}
