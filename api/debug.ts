export default function handler(req: any, res: any) {
  res.status(200).json({ ok: true, node: process.version, env: process.env.NODE_ENV });
}
