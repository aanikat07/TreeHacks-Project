import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

const client = new Anthropic();

interface DesmosExpression {
  id: string;
  latex: string;
}

interface DesmosAction {
  type: 'add' | 'remove' | 'set';
  id?: string;
  latex?: string;
}

function buildSystemPrompt(dimension: '2d' | '3d') {
  const modeContext = dimension === '3d'
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

const tools: Anthropic.Tool[] = [
  {
    name: 'desmos_add_expression',
    description:
      'Add a new expression to the Desmos graph. Use this to plot new equations, functions, points, or inequalities.',
    input_schema: {
      type: 'object',
      properties: {
        latex: {
          type: 'string',
          description: 'The LaTeX expression to add (e.g. "y = x^2", "y = \\\\sin(x)").',
        },
      },
      required: ['latex'],
    },
  },
  {
    name: 'desmos_get_expressions',
    description:
      'Get all expressions currently on the Desmos graph. Returns an array of objects with id and latex fields. Call this FIRST when you need to see what is currently plotted before modifying or removing expressions.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'desmos_remove_expression',
    description:
      'Remove an expression from the Desmos graph by its ID. You must call desmos_get_expressions first to find the correct ID.',
    input_schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ID of the expression to remove.',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'desmos_set_expression',
    description:
      'Modify an existing expression on the Desmos graph. Updates the LaTeX of the expression with the given ID. You must call desmos_get_expressions first to find the correct ID.',
    input_schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ID of the expression to modify.',
        },
        latex: {
          type: 'string',
          description: 'The new LaTeX expression to set.',
        },
      },
      required: ['id', 'latex'],
    },
  },
];

const MAX_ITERATIONS = 10;

export async function POST(request: NextRequest) {
  const { query, currentExpressions = [], dimension = '3d' }: { query: string; currentExpressions: DesmosExpression[]; dimension: '2d' | '3d' } =
    await request.json();

  if (!query || typeof query !== 'string') {
    return NextResponse.json({ error: 'Missing query' }, { status: 400 });
  }

  const actions: DesmosAction[] = [];
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: query }];
  let localExpressions: DesmosExpression[] = [...currentExpressions];
  let nextTempId = 1000;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: buildSystemPrompt(dimension),
      messages,
      tools,
    });

    if (response.stop_reason !== 'tool_use') {
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((b) => b.text)
        .join('');
      return NextResponse.json({ actions, message: text });
    }

    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolCall of toolUseBlocks) {
      const input = toolCall.input as Record<string, string>;

      switch (toolCall.name) {
        case 'desmos_get_expressions': {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: JSON.stringify(localExpressions),
          });
          break;
        }
        case 'desmos_add_expression': {
          const tempId = `temp-${nextTempId++}`;
          actions.push({ type: 'add', id: tempId, latex: input.latex });
          localExpressions.push({ id: tempId, latex: input.latex });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: JSON.stringify({ success: true, id: tempId }),
          });
          break;
        }
        case 'desmos_remove_expression': {
          actions.push({ type: 'remove', id: input.id });
          localExpressions = localExpressions.filter((e) => e.id !== input.id);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: JSON.stringify({ success: true }),
          });
          break;
        }
        case 'desmos_set_expression': {
          actions.push({ type: 'set', id: input.id, latex: input.latex });
          localExpressions = localExpressions.map((e) =>
            e.id === input.id ? { ...e, latex: input.latex } : e
          );
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: JSON.stringify({ success: true }),
          });
          break;
        }
        default: {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: `Unknown tool: ${toolCall.name}`,
            is_error: true,
          });
        }
      }
    }

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });
  }

  return NextResponse.json({ actions, message: 'Completed (reached maximum iterations).' });
}
