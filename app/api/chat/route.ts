import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { type NextRequest, NextResponse } from "next/server";
import {
  saveAnimationJob,
  updateAnimationJob,
} from "../../../lib/animation-jobs";
import { enqueueRenderJob } from "../../../lib/render-worker";
import { applyRateLimit } from "../../../lib/security/rate-limit";
import {
  type RagChunk,
  retrieveRagContext,
} from "../../../lib/session/retrieve";
import { canUseSupabaseAdmin } from "../../../lib/supabase/server";
import { whiteboardImageToText } from "../../../lib/whiteboard/vision";

const client = new Anthropic();

interface DesmosExpression {
  id: string;
  latex: string;
}

interface DesmosAction {
  type: "add" | "remove" | "set";
  id?: string;
  latex?: string;
}

type AppMode = "graph" | "animation";

interface ChatRequestBody {
  query: string;
  currentExpressions?: DesmosExpression[];
  dimension?: "2d" | "3d";
  mode?: AppMode;
  lessonId?: string;
  whiteboardImageBase64?: string;
}

function buildGraphSystemPrompt(dimension: "2d" | "3d") {
  const modeContext =
    dimension === "3d"
      ? `The calculator is in 3D mode (Desmos Calculator3D). Use 3D-compatible expressions:
- Surfaces: z = f(x, y), e.g. "z = x^2 + y^2"
- Parametric surfaces: use parameters u, v
- 3D curves: parametric with parameter t
- Spheres: "x^2 + y^2 + z^2 = r^2"
- Do NOT use 2D-only forms like "y = f(x)" unless the user explicitly asks for a 2D cross-section.`
      : `The calculator is in 2D mode (Desmos GraphingCalculator). Use 2D expressions:
- Functions: "y = f(x)", e.g. "y = x^2"
- Implicit: "x^2 + y^2 = 9"
- Parametric: use parameter t
- Inequalities: "y > x"
- Do NOT use 3D forms like "z = f(x, y)".`;

  return `You are a math assistant that helps users interact with a Desmos graphing calculator.

You can add, remove, and modify expressions on the graph using the provided tools.

${modeContext}

Rules:
- Use Desmos-compatible LaTeX syntax (e.g. \\frac{}{}, \\sqrt{}, \\sin, \\cos, etc.)
- When the user asks to add something new, call desmos_add_expression DIRECTLY. Do NOT call desmos_get_expressions first for add-only requests.
- When the user asks to remove or change something, ALWAYS call desmos_get_expressions FIRST to see what is currently on the graph, then use the appropriate tool.
- You may call multiple tools in sequence to accomplish the user's request.
- After using tools, provide a very concise one-sentence explanation of what was graphed or changed (e.g. "Added y = x^2, a standard parabola.").
- If the user asks a question instead of requesting a graph action, respond concisely without using tools.`;
}

function buildAnimationSystemPrompt() {
  return `You are a Manim Community Edition code generator. Generate a single, complete Python script that renders correctly.

Critical Requirements:
- Output ONLY executable Python code—no markdown fences, quotes, or commentary
- Follow the official Manim Community docs: https://docs.manim.community/en/stable/
- Include all necessary imports: from manim import *
- Define exactly one Scene subclass with a construct() method

Animation Quality:
- Create a clear visual sequence where each transformation is distinct and purposeful
- Space objects to avoid visual clutter—ensure adequate margins between elements
- Use smooth transitions between animation stages (use Wait() when needed for pacing)
- Apply visual hierarchy: emphasize key concepts through size, color, or position
- Coordinate timing so objects don't animate simultaneously unless intentional

Technical Standards:
- Test that all method calls and class names match current Manim Community API
- Use proper coordinate positioning to keep all objects within frame
- Include appropriate run_time parameters for natural pacing
- Clean up objects with FadeOut or remove() when no longer needed

Output only the complete, working Python script.`;
}

function buildAnimationSummaryPrompt() {
  return `You are a mathematical narrator creating scripts for animated educational videos. Write conversational narration that builds intuition step-by-step, synchronized with the animation timing.

Core Principles:
- Explain WHY concepts work through visual intuition, not formal definitions
- Use everyday language and relatable analogies
- Maintain an enthusiastic but calm, thoughtful tone
- Let visuals do the heavy lifting—don't over-describe what's already visible

Script Requirements:
- Parse the provided Manim Python code to calculate animation duration
- Craft narration that fits within the animation length. Do not exceed the duration significantly.
- Align each sentence with a distinct visual transformation or element
- Reference on-screen elements directly: "notice this point...", "as this rotates..."
- Use short sentences during dynamic visuals, longer ones during static moments
- Do not include the # (hash) symbol or any code comments

Structure:
1. Build the concept alongside the animation
2. Conclude with the key insight or "aha" moment

Output the narration script only—no timestamps or stage directions.`;
}

function extractTextFromResponse(response: Anthropic.Message) {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function sanitizePythonCode(raw: string) {
  let cleaned = raw.trim();

  // Handle fenced markdown output: ```python ... ```
  const fenced = cleaned.match(/^```(?:python)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) {
    cleaned = fenced[1].trim();
  }

  // Fallback: strip fence markers if they appear on separate lines.
  cleaned = cleaned
    .replace(/^```(?:python)?\s*$/gim, "")
    .replace(/^```\s*$/gim, "")
    .trim();

  // If the whole payload is wrapped in triple quotes, unwrap once.
  const tripleSingleQuoted = cleaned.match(/^'''[\r\n]?([\s\S]*?)[\r\n]?'''$/);
  if (tripleSingleQuoted?.[1]) {
    cleaned = tripleSingleQuoted[1].trim();
  }
  const tripleDoubleQuoted = cleaned.match(/^"""[\r\n]?([\s\S]*?)[\r\n]?"""$/);
  if (tripleDoubleQuoted?.[1]) {
    cleaned = tripleDoubleQuoted[1].trim();
  }

  // Remove accidental leading "python" label line.
  cleaned = cleaned.replace(/^python\s*\n/i, "");

  // Normalize smart quotes that sometimes appear in LLM output.
  cleaned = cleaned.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim();

  const manimImportIndex = cleaned.search(
    /(?:^|\n)(?:from\s+manim\s+import|import\s+manim\b)/i,
  );
  if (manimImportIndex >= 0) {
    cleaned = cleaned.slice(manimImportIndex).trim();
  }

  return cleaned;
}

function isLikelyValidManimScript(code: string) {
  const hasImport = /(?:^|\n)(?:from\s+manim\s+import|import\s+manim\b)/i.test(
    code,
  );
  const hasSceneClass =
    /class\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*Scene[^)]*\)\s*:/.test(code);
  const hasConstruct = /def\s+construct\s*\(\s*self\s*\)\s*:/.test(code);
  return hasImport && hasSceneClass && hasConstruct;
}

const tools: Anthropic.Tool[] = [
  {
    name: "desmos_add_expression",
    description:
      "Add a new expression to the Desmos graph. Use this to plot new equations, functions, points, or inequalities.",
    input_schema: {
      type: "object",
      properties: {
        latex: {
          type: "string",
          description:
            'The LaTeX expression to add (e.g. "y = x^2", "y = \\\\sin(x)").',
        },
      },
      required: ["latex"],
    },
  },
  {
    name: "desmos_get_expressions",
    description:
      "Get all expressions currently on the Desmos graph. Returns an array of objects with id and latex fields. Call this FIRST when you need to see what is currently plotted before modifying or removing expressions.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "desmos_remove_expression",
    description:
      "Remove an expression from the Desmos graph by its ID. You must call desmos_get_expressions first to find the correct ID.",
    input_schema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The ID of the expression to remove.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "desmos_set_expression",
    description:
      "Modify an existing expression on the Desmos graph. Updates the LaTeX of the expression with the given ID. You must call desmos_get_expressions first to find the correct ID.",
    input_schema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The ID of the expression to modify.",
        },
        latex: {
          type: "string",
          description: "The new LaTeX expression to set.",
        },
      },
      required: ["id", "latex"],
    },
  },
];

const MAX_ITERATIONS = 10;
const MAX_QUERY_LENGTH = 4000;
const MAX_WHITEBOARD_DATA_URL_LENGTH = 5_000_000;

async function handleGraphRequest(
  query: string,
  currentExpressions: DesmosExpression[],
  dimension: "2d" | "3d",
) {
  const actions: DesmosAction[] = [];
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: query }];
  let localExpressions: DesmosExpression[] = [...currentExpressions];
  let nextTempId = 1000;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: buildGraphSystemPrompt(dimension),
      messages,
      tools,
    });

    if (response.stop_reason !== "tool_use") {
      return { actions, message: extractTextFromResponse(response) };
    }

    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolCall of toolUseBlocks) {
      const input = toolCall.input as Record<string, string>;

      switch (toolCall.name) {
        case "desmos_get_expressions": {
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: JSON.stringify(localExpressions),
          });
          break;
        }
        case "desmos_add_expression": {
          const tempId = `temp-${nextTempId++}`;
          actions.push({ type: "add", id: tempId, latex: input.latex });
          localExpressions.push({ id: tempId, latex: input.latex });
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: JSON.stringify({ success: true, id: tempId }),
          });
          break;
        }
        case "desmos_remove_expression": {
          actions.push({ type: "remove", id: input.id });
          localExpressions = localExpressions.filter((e) => e.id !== input.id);
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: JSON.stringify({ success: true }),
          });
          break;
        }
        case "desmos_set_expression": {
          actions.push({ type: "set", id: input.id, latex: input.latex });
          localExpressions = localExpressions.map((e) =>
            e.id === input.id ? { ...e, latex: input.latex } : e,
          );
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: JSON.stringify({ success: true }),
          });
          break;
        }
        default: {
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: `Unknown tool: ${toolCall.name}`,
            is_error: true,
          });
        }
      }
    }

    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: toolResults });
  }

  return { actions, message: "Completed (reached maximum iterations)." };
}

function getCallbackUrl(request: NextRequest) {
  const configured = process.env.RENDER_CALLBACK_URL;
  if (configured) {
    return configured;
  }

  const url = new URL(request.url);
  return `${url.origin}/api/animation/callback`;
}

async function buildRagAnimationRequest(input: {
  query: string;
  lessonId?: string;
  whiteboardImageBase64?: string;
}) {
  const studentQuestion = input.query.trim();
  if (!studentQuestion) {
    throw new Error("No question provided.");
  }

  const canUseOpenAi = Boolean(process.env.OPENAI_API_KEY);
  const whiteboardText = canUseOpenAi
    ? await whiteboardImageToText(input.whiteboardImageBase64)
    : "";
  const lessonId = input.lessonId?.trim() || "default";

  let retrievedChunks: Awaited<ReturnType<typeof retrieveRagContext>> = [];
  if (canUseOpenAi && canUseSupabaseAdmin()) {
    try {
      retrievedChunks = await retrieveRagContext({
        lessonId,
        query: `${studentQuestion}\n\nWhiteboard:\n${whiteboardText || "NONE"}`,
        topK: 6,
      });
    } catch {
      retrievedChunks = [];
    }
  }

  const compactContext = (chunks: RagChunk[], maxChars = 2200) => {
    if (chunks.length === 0) return "NONE";
    const parts = chunks.slice(0, 5).map((chunk, index) => {
      const source = chunk.source_name ?? "Lecture";
      const location =
        chunk.page != null
          ? `page ${chunk.page}`
          : chunk.chunk_index != null
            ? `chunk ${chunk.chunk_index}`
            : "";
      return `[${index + 1}] ${source}${location ? ` (${location})` : ""}\n${chunk.content}`;
    });
    const joined = parts.join("\n\n");
    return joined.length > maxChars
      ? `${joined.slice(0, maxChars)}...`
      : joined;
  };

  const claudePrompt = `
STUDENT QUESTION:
${studentQuestion}

WHITEBOARD EXTRACT:
${whiteboardText?.trim() ? whiteboardText.trim() : "NONE"}

RETRIEVED LECTURE CONTEXT:
${compactContext(retrievedChunks)}

TASK:
Use the student question as the primary objective and ground explanations in the retrieved lecture context when available.
Make the scene no longer than 20 seconds.
Write one complete Manim Community Edition Python script that is accurate, concise, and executable.
`.trim();

  return { claudePrompt, studentQuestion };
}

async function handleAnimationRequest(
  body: ChatRequestBody,
  request: NextRequest,
) {
  const { claudePrompt, studentQuestion } = await buildRagAnimationRequest({
    query: body.query,
    lessonId: body.lessonId,
    whiteboardImageBase64: body.whiteboardImageBase64,
  });

  const generateCode = async (userContent: string) => {
    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 4096,
      system: buildAnimationSystemPrompt(),
      messages: [{ role: "user", content: userContent }],
    });
    return sanitizePythonCode(extractTextFromResponse(response));
  };

  let pythonCode = await generateCode(claudePrompt);
  if (!pythonCode || !isLikelyValidManimScript(pythonCode)) {
    const repairPrompt = `${claudePrompt}

IMPORTANT FIX:
The previous output was not a valid single-file Manim CE script. Return corrected Python code only.
- Must include a manim import
- Must define exactly one class that inherits from a *Scene class (Scene, ThreeDScene, MovingCameraScene, etc.)
- Must include def construct(self):
- Must run without markdown fences or commentary`;
    pythonCode = await generateCode(repairPrompt);
  }

  if (!pythonCode || !isLikelyValidManimScript(pythonCode)) {
    return {
      actions: [],
      message: "Could not generate valid animation code. Please try again.",
    };
  }

  let animationSummary = "Generated animation and queued render job.";
  try {
    const summaryResponse = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 220,
      system: buildAnimationSummaryPrompt(),
      messages: [
        {
          role: "user",
          content: `User request:\n${studentQuestion}\n\nGenerated Manim code:\n${pythonCode}`,
        },
      ],
    });
    const summaryText = extractTextFromResponse(summaryResponse);
    if (summaryText) {
      animationSummary = summaryText;
    }
  } catch {
    // Keep default summary when summary generation fails.
  }

  const now = new Date().toISOString();
  const jobId = randomUUID();

  await saveAnimationJob({
    id: jobId,
    query: studentQuestion,
    pythonCode,
    status: "queued",
    createdAt: now,
    updatedAt: now,
  });

  try {
    await enqueueRenderJob({
      jobId,
      pythonCode,
      callbackUrl: getCallbackUrl(request),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Worker enqueue failed";
    await updateAnimationJob(jobId, { status: "failed", error: message });
    return {
      actions: [],
      message: animationSummary,
      animation: {
        jobId,
        status: "failed",
      },
    };
  }

  return {
    actions: [],
    message: animationSummary,
    animation: {
      jobId,
      status: "queued",
    },
  };
}

export async function POST(request: NextRequest) {
  const rateLimit = applyRateLimit(request, "api:chat", {
    windowMs: 60_000,
    maxRequests: 30,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  const body = (await request.json()) as ChatRequestBody;
  const {
    query,
    currentExpressions = [],
    dimension = "3d",
    mode = "graph",
  } = body;

  if (!query || typeof query !== "string") {
    return NextResponse.json({ error: "Missing query" }, { status: 400 });
  }
  if (query.trim().length > MAX_QUERY_LENGTH) {
    return NextResponse.json(
      { error: `Query too long. Maximum is ${MAX_QUERY_LENGTH} characters.` },
      { status: 400 },
    );
  }
  if (
    typeof body.whiteboardImageBase64 === "string" &&
    body.whiteboardImageBase64.length > MAX_WHITEBOARD_DATA_URL_LENGTH
  ) {
    return NextResponse.json(
      { error: "Whiteboard image payload is too large." },
      { status: 413 },
    );
  }

  if (mode !== "graph" && mode !== "animation") {
    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  }

  if (mode === "animation") {
    const result = await handleAnimationRequest(body, request);
    return NextResponse.json(result);
  }

  const result = await handleGraphRequest(query, currentExpressions, dimension);
  return NextResponse.json(result);
}
