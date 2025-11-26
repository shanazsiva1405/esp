///////////////////////////////////////////////////////////////
// CONFIG
///////////////////////////////////////////////////////////////
const ROBOFLOW_API_KEY = "kgm9BwsfeNyUBPwSijfg";
const ROBOFLOW_MODEL = "deteksi_jenttik-an9y5";
const ROBOFLOW_VERSION = "1";

const FIREBASE_URL =
  "https://siling-ai-default-rtdb.asia-southeast1.firebasedatabase.app/detections.json";

const CLOUDINARY_CLOUD = "dnm25bwiu";


///////////////////////////////////////////////////////////////
// GET ROBOFLOW JSON PREDICTIONS
///////////////////////////////////////////////////////////////
async function getPredictionJSON(imageUrl: string): Promise<any> {
  const detectUrl =
    `https://detect.roboflow.com/${ROBOFLOW_MODEL}/${ROBOFLOW_VERSION}` +
    `?api_key=${ROBOFLOW_API_KEY}` +
    `&image=${encodeURIComponent(imageUrl)}`;

  const res = await fetch(detectUrl);
  const txt = await res.text();

  if (!res.ok) throw new Error("Gagal mengambil JSON dari Roboflow: " + txt);

  return JSON.parse(txt);
}


///////////////////////////////////////////////////////////////
// GENERATE CLOUDINARY ANNOTATED URL
///////////////////////////////////////////////////////////////
function generateCloudinaryAnnotatedUrl(originalUrl: string, predictions: any[]) {
  const parts: string[] = [];

  for (const p of predictions) {
    let x = Math.round(p.x - p.width / 2);
    let y = Math.round(p.y - p.height / 2);

    // Cloudinary tidak boleh menerima koordinat negatif
    if (x < 0) x = 0;
    if (y < 0) y = 0;

    // RECTANGLE
    parts.push(
      `e_draw:rectangle,co_rgb:00FF00,w_${p.width},h_${p.height},x_${x},y_${y}`,
    );

    // CONFIDENCE TEXT (harus encode %)
    const confText = encodeURIComponent(`${Math.round(p.confidence * 100)}%`);

    parts.push(
      `l_text:Arial_30_bold:${confText},co_rgb:00FF00,g_north_west,x_${x},y_${y - 10}`,
    );
  }

  // gabungkan dengan slash
  const transformation = parts.join("/");

  // Buat Cloudinary fetch URL final
  const cloudinaryUrl =
    `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/image/fetch/${transformation}/${encodeURIComponent(originalUrl)}`;

  return cloudinaryUrl;
}


///////////////////////////////////////////////////////////////
// SAVE TO FIREBASE
///////////////////////////////////////////////////////////////
async function saveToFirebase(data: any) {
  await fetch(FIREBASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}


///////////////////////////////////////////////////////////////
// SERVER
///////////////////////////////////////////////////////////////
Deno.serve(async (req) => {
  const url = new URL(req.url);

  // ROOT
  if (req.method === "GET" && url.pathname === "/") {
    return new Response(
      JSON.stringify({ status: "OK", message: "Deno Server Running" }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  // API /api/detect
  if (req.method === "POST" && url.pathname === "/api/detect") {
    try {
      const body = JSON.parse(await req.text());
      const { imageUrl } = body;

      if (!imageUrl) {
        return new Response(JSON.stringify({ error: "imageUrl diperlukan" }), {
          status: 400,
        });
      }

      console.log("📥 Received:", imageUrl);

      // 1) Fetch prediction JSON
      const prediction = await getPredictionJSON(imageUrl);
      const predictions = prediction.predictions ?? [];

      // 2) Hitung jentik otomatis
      const jumlahJentik = predictions.length;

      // 3) Generate annotated Cloudinary URL
      const annotatedUrl = generateCloudinaryAnnotatedUrl(imageUrl, predictions);

      // 4) Save to Firebase
      const savedData = {
        originalImageUrl: imageUrl,
        annotatedImageUrl: annotatedUrl,
        predictions,
        jumlahJentik,
        timestamp: Date.now(),
      };

      await saveToFirebase(savedData);

      // 5) Return response
      return new Response(JSON.stringify({
        success: true,
        ...savedData,
      }), { headers: { "Content-Type": "application/json" } });

    } catch (err) {
      console.error("🔥 ERROR:", err);
      return new Response(
        JSON.stringify({ error: String(err) }),
        { status: 500 },
      );
    }
  }

  return new Response("Not Found", { status: 404 });
});
