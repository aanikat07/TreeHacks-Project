export async function POST(req) {
  const sdpOffer = await req.text();
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return new Response("Missing OPENAI_API_KEY", { status: 500 });
  }

  const form = new FormData();
  form.append("sdp", sdpOffer);
  form.append(
    "session",
    JSON.stringify({
      type: "realtime",
      model: "gpt-realtime",
      audio: { output: { voice: "marin" } }
    })
  );

  const r = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!r.ok) {
    const errText = await r.text();
    return new Response(`OpenAI error: ${r.status} ${errText}`, { status: 500 });
  }

  return new Response(await r.text(), {
    status: 200,
    headers: { "Content-Type": "application/sdp" },
  });
}
