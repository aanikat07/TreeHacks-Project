import { type NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { updateAnimationJob } from "../../../../lib/animation-jobs";

interface CallbackBody {
  jobId?: string;
  status?: "rendering" | "completed" | "failed";
  videoUrl?: string;
  videoBase64?: string;
  error?: string;
}

function isAuthorized(request: NextRequest) {
  const expected = process.env.RENDER_CALLBACK_SECRET;
  if (!expected) return true;

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  return token === expected;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as CallbackBody;
  if (!body.jobId || !body.status) {
    return NextResponse.json({ error: "Missing jobId or status" }, { status: 400 });
  }

  let completedVideoUrl = body.videoUrl;
  if (body.status === "completed" && !completedVideoUrl && body.videoBase64) {
    const binary = Buffer.from(body.videoBase64, "base64");
    const uploaded = await put(`manim-renders/${body.jobId}.mp4`, binary, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "video/mp4",
    });
    completedVideoUrl = uploaded.url;
  }

  const updates =
    body.status === "completed"
      ? {
          status: "completed" as const,
          videoUrl: completedVideoUrl,
          error: undefined,
        }
      : body.status === "failed"
        ? {
            status: "failed" as const,
            error: body.error || "Render failed",
          }
        : { status: "rendering" as const };

  const updated = await updateAnimationJob(body.jobId, updates);
  if (!updated) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
