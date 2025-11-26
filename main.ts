///////////////////////////////////////////////////////////////
// CONFIG
///////////////////////////////////////////////////////////////
const ROBOFLOW_API_KEY = "kgm9BwsfeNyUBPwSijfg";
const ROBOFLOW_MODEL = "deteksi_jenttik-an9y5";
const ROBOFLOW_VERSION = "1";

const FIREBASE_URL =
  "https://siling-ai-default-rtdb.asia-southeast1.firebasedatabase.app/detections.json";

const CLOUDINARY_CLOUD = "dnm25bwiu";
const CLOUDINARY_UPLOAD_PRESET = "unsigned_preset";


///////////////////////////////////////////////////////////////
// Fetch JSON prediction from Roboflow
///////////////////////////////////////////////////////////////
async function getPredictionJSON(imageUrl: string) {
  const detectUrl =
    `https://detect.roboflow.com/${ROBOFLOW_MODEL}/${ROBOFLOW_VERSION}` +
    `?api_key=${ROBOFLOW_API_KEY}` +
    `&image=${encodeURIComponent(imageUrl)}`;

  const res = await fetch(detectUrl);
  const txt = await res.text();

  if (!res.ok) throw new Error("Roboflow JSON error: " + txt);

  return JSON.parse(txt);
}


///////////////////////////////////////////////////////////////
// Upload original ESP32 image to Cloudinary
///////////////////////////////////////////////////////////////
async function uploadOriginalToCloudinary(imageUrl: string): Promise<string> {
  const res = await fetch(imageUrl);
  const blob = await res.blob();

  const form = new FormData();
  form.append("file", blob, "source.jpg");
  form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

  const uploadRes = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`,
    { method: "POST", body: form },
  );

  const json = await uploadRes.json();

  if (!uploadRes.ok) {
    throw new Error("Upload original error: " + JSON.stringify(json));
  }

  return json.public_id;
}


///////////////////////////////////////////////////////////////
// Generate Cloudinary annotated overlay URL
///////////////////////////////////////////////////////////////
function buildAnnotatedTransformation(publicId: string, predictions: any[]) {
  const parts: string[] = [];

  for (const p of predictions) {
    // hitung kiri atas bbox
    let x = Math.round(p.x - p.width / 2);
    let y = Math.round(p.y - p.height / 2);

    if (x < 0) x = 0;
    if (y < 0) y = 0;

    // Box
    parts.push(
      `e_draw:rectangle,co_rgb:00FF00,w_${p.width},h_${p.height},x_${x},y_${y}`,
    );

    // Confidence text (encode %)
    const conf = encodeURIComponent(`${Math.round(p.confidence * 100)}%`);

    parts.push(
      `l_text:Arial_30_bold:${conf},co_rgb:00FF00,g_north_west,x_${x},y_${y - 10}`,
    );
  }

  const transform = parts.join("/");

  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD}` +
    `/image/upload/${transform}/${publicId}.jpg`;
}


///////////////////////////////////////////////////////////////
// Save to Firebase
///////////////////////////////////////////////////////////////
async function saveToFirebase(data: any) {
  await fetch(FIREBASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}


///////////////////////////////////////////////////////////////
// SERVER ROUTES
///////////////////////////////////////////////////////////////
Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Root test route
  if (req.method === "GET" && url.pathname === "/") {
    return new Response(
      JSON.stringify({ status: "OK", msg: "Deno Deploy Running" }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  // Main detection route
  if (req.method === "POST" && url.pathname === "/api/detect") {
    try {
      const body = JSON.parse(await req.text());
      const { imageUrl } = body;

      if (!imageUrl) {
        return new Response(
          JSON.stringify({ error: "imageUrl diperlukan" }),
          { status: 400 },
        );
      }

      console.log("📥 ESP32 image URL received:", imageUrl);

      // 1) Get prediction JSON from Roboflow
      const prediction = await getPredictionJSON(imageUrl);
      const predictions = prediction.predictions ?? [];

      // 2) Count detected larva
      const jumlahJentik = predictions.length;

      // 3) Upload original image to Cloudinary
      const publicId = await uploadOriginalToCloudinary(imageUrl);

      // 4) Build annotated overlay URL
      const annotatedUrl = buildAnnotatedTransformation(publicId, predictions);

      // 5) Save to Firebase
      const data = {
        originalImageUrl: imageUrl,
        annotatedImageUrl: annotatedUrl,
        predictions,
        jumlahJentik,
        timestamp: Date.now(),
      };

      await saveToFirebase(data);

      // 6) Return success response
      return new Response(JSON.stringify({
        success: true,
        ...data,
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
