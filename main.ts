// Gunakan Deno.serve() versi baru tanpa menentukan port
// Aman untuk Deno Deploy

const ROBOFLOW_API_KEY = "rf_LgFcfZpNrOWgO2T1ZJF6S2lymp73"; // ganti API Key Roboflow
const ROBOFLOW_MODEL = "jentik-nyamuk-zoa3r";           
const ROBOFLOW_VERSION = "1";                      
const FIREBASE_URL = "https://siling-ai-default-rtdb.asia-southeast1.firebasedatabase.app/";

Deno.serve(async (req) => {
  const { pathname } = new URL(req.url);

  if (req.method === "POST" && pathname === "/api/detect") {
    try {
      const { imageUrl } = await req.json();

      if (!imageUrl) {
        return new Response(JSON.stringify({ error: "Missing imageUrl" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // kirim ke roboflow
      const detectUrl = `https://detect.roboflow.com/${ROBOFLOW_MODEL}/${ROBOFLOW_VERSION}?api_key=${ROBOFLOW_API_KEY}&image=${encodeURIComponent(imageUrl)}`;
      const roboflowRes = await fetch(detectUrl);
      const roboflowData = await roboflowRes.json();

      // simpan hasil ke Firebase RTDB
      await fetch(`${FIREBASE_URL}/detections.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl,
          detection: roboflowData,
          timestamp: Date.now(),
        }),
      });

      return new Response(JSON.stringify({ success: true, roboflowData }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // untuk akses GET (tes API)
  return new Response(
    JSON.stringify({
      message: "✅ ESP32 Detection API Active",
      usage: "POST /api/detect dengan body { imageUrl: 'https://...' }",
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
