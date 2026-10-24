export const config = {
  runtime: "edge",
};

export default function handler(req: Request) {
  return new Response(JSON.stringify({ ok: true, runtime: "edge" }), {
    headers: { "Content-Type": "application/json" },
  });
}
