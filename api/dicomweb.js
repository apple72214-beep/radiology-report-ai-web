/* DICOMweb CORS relay for Radiology report AI (Vercel serverless, free tier, no card).
   Usage: GET /api/dicomweb?url=<encoded DICOMweb endpoint>  (Accept forwarded).
   Hospital PACS/Orthanc instances usually lack CORS headers; the browser calls this
   same-origin relay which fetches server-side and returns bytes with permissive CORS. */
export default async function handler(req, res) {
  const u = new URL(req.url, "https://x");
  const target = u.searchParams.get("url");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (!target || !/^https?:\/\//i.test(target)) {
    res.status(400).json({ error: "url query parameter with http(s) target required" });
    return;
  }
  try {
    const r = await fetch(target, {
      headers: { Accept: req.headers.accept || "application/dicom+json, application/json, multipart/related, application/octet-stream" },
      redirect: "follow",
    });
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", r.headers.get("content-type") || "application/octet-stream");
    res.status(r.status).send(buf);
  } catch (e) {
    res.status(502).json({ error: "relay fetch failed: " + (e && e.message ? e.message : e) });
  }
}
