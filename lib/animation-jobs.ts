import { head, put } from "@vercel/blob";

export type AnimationJobStatus =
  | "queued"
  | "rendering"
  | "completed"
  | "failed";

export interface AnimationJob {
  id: string;
  query: string;
  pythonCode: string;
  status: AnimationJobStatus;
  createdAt: string;
  updatedAt: string;
  videoUrl?: string;
  error?: string;
}

const JOB_PREFIX = "manim-jobs";

function getJobPath(id: string) {
  return `${JOB_PREFIX}/${id}.json`;
}

export async function saveAnimationJob(job: AnimationJob) {
  const pathname = getJobPath(job.id);
  await put(pathname, JSON.stringify(job), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export async function getAnimationJob(id: string): Promise<AnimationJob | null> {
  try {
    const metadata = await head(getJobPath(id));
    const response = await fetch(metadata.url, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as AnimationJob;
  } catch {
    return null;
  }
}

export async function updateAnimationJob(
  id: string,
  updates: Partial<Omit<AnimationJob, "id" | "createdAt">>,
): Promise<AnimationJob | null> {
  const current = await getAnimationJob(id);
  if (!current) return null;

  const next: AnimationJob = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  await saveAnimationJob(next);
  return next;
}
