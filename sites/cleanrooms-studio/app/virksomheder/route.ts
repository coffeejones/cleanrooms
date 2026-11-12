export function GET() {
  return new Response(null, { status:303, headers:{ Location:'/' } });
}
