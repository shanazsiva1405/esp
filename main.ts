//////////////////////////////////////////////////////////
// CONFIG
//////////////////////////////////////////////////////////
const ROBOFLOW_API_KEY = "kgm9BwsfeNyUBPwSijfg";
const ROBOFLOW_MODEL = "deteksi_jenttik-an9y5";
const ROBOFLOW_VERSION = "1";

const FIREBASE_URL =
  "https://siling-ai-default-rtdb.asia-southeast1.firebasedatabase.app/detections.json";

const CLOUDINARY_CLOUD = "dnm25bwiu";
const CLOUDINARY_UPLOAD_PRESET = "unsigned_preset";


//////////////////////////////////////////////////////////
// GET JSON FROM ROBOFLOW
//////////////////////////////////////////////////////////
async function getPredictionJSON(imageUrl: string) {
  const detectUrl =
    `https://detect.roboflow.com/${ROBOFLOW_MODEL}/${ROBOFLOW_VERSION}` +
    `?api_key=${ROBOFLOW_API_KEY}` +
    `&image=${encodeURIComponent(imageUrl)}`;

  const res = await fetch(detectUrl);
  const txt = await res.text();

  if (!res.ok) throw new Error("Gagal mengambil JSON dari Roboflow: " + txt);

  return JSON.parse(txt);
}


//////////////////////////////////////////////////////////
// GENERATE CLOUDINARY ANNOTATED URL
//////////////////////////////////////////////////////////
function generateCloudinaryAnnotatedUrl(
  originalUrl: string,
  predictions: any[],
) {
  let overlays: string[] = [];

  for (const p of predictions) {
    const x = Math.round(p.x - p.width / 2);
    const y = Math.round(p.y - p.height / 2);

    // 1) DRAW RECTANGLE BOX
    overlays.push(
      `e_draw:rectangle,co_rgb:00FF00,w_${p.width},h_${p.height},x_${x},y_${y}`,
    );

    // 2) DRAW CONFIDENCE LABEL
    const conf = Math.round(p.confidence * 100) + "%";

    overlays.push(
      `l_text:Arial_30_bold:${conf},co_rgb:00FF00,g_north_west,x_${x},y_${y - 10}`,
    );
  }

  const transformation = overlays.join("/");

  // Gunakan Cloudinary fetch URL
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/image/fetch/${transformation}/${encodeURIComponent(originalUrl)}`;
}


//////////////////////////////////////////////////////////
// SAVE TO FIREBASE
//////////////////////////////////////////////////////////
async function saveToFirebase(data: any) {
  await fetch(FIREBASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}


//////////////////////////////////////////////////////////
// SERVER
//////////////////////////////////////////////////////////
Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Root
  if (req.method === "GET" && url.pathname === "/") {
    return new Response(
      JSON.stringify({ status: "OK", message: "Deno Deploy Running" }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  // Main detection API
  if (req.method === "POST" && url.pathname === "/api/detect") {
    try {
      const body = JSON.parse(await req.text());
      const { imageUrl } = body;

      if (!imageUrl) {
        return new Response(
          JSON.stringify({ error: "imageUrl tidak ditemukan" }),
          { status: 400 },
        );
      }

      // 1) Ambil JSON prediksi
      const predictionJson = await getPredictionJSON(imageUrl);
      const predictions = predictionJson.predictions ?? [];

      // 2) Hitung jumlah jentik
      const jumlahJentik = predictions.length;

      // 3) Generate Cloudinary annotated URL
      const annotatedUrl = generateCloudinaryAnnotatedUrl(imageUrl, predictions);

      // 4) Simpan ke Firebase
      const dataToSave = {
        originalImageUrl: imageUrl,
        annotatedImageUrl: annotatedUrl,
        predictions,
        jumlahJentik,
        timestamp: Date.now(),
      };

      await saveToFirebase(dataToSave);

      // 5) Response
      return new Response(JSON.stringify({
        success: true,
        ...dataToSave,
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
