// main.ts
const ROBOFLOW_API_KEY = "tE41bmQTqJ8zKAmXErjA"; // ganti API key kamu
const ROBOFLOW_MODEL = "jentik-nyamuk-zoa3r";               // nama model kamu
const ROBOFLOW_VERSION = "1";
const FIREBASE_URL = "https://siling-ai-default-rtdb.asia-southeast1.firebasedatabase.app/detections.json";

// === Server utama ===
Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Endpoint utama (test)
  if (req.method === "GET" && url.pathname === "/") {
    return new Response(
      JSON.stringify({ message: "✅ Deno Deploy aktif!", usage: "POST /api/detect" }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // Endpoint deteksi dari ESP32
  if (req.method === "POST" && url.pathname === "/api/detect") {
    try {
      const { imageUrl } = await req.json();
      if (!imageUrl)
        return new Response(JSON.stringify({ error: "imageUrl kosong" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });

      // === Kirim ke Roboflow ===
      const detectUrl = `https://detect.roboflow.com/${ROBOFLOW_MODEL}/${ROBOFLOW_VERSION}?api_key=${ROBOFLOW_API_KEY}&image=${encodeURIComponent(imageUrl)}`;
      const roboflowRes = await fetch(detectUrl);
      const roboflowData = await roboflowRes.json();

      // === Kirim hasil ke Firebase ===
       // === Kirim hasil ke Firebase ===
      await fetch(FIREBASE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl,
          detection: roboflowData,
          timestamp: Date.now(),
        }),
      });


      return new Response(
        JSON.stringify({ success: true, roboflowData }),
        { headers: { "Content-Type": "application/json" } }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // Endpoint selain itu
  return new Response("404 Not Found", { status: 404 });
});
