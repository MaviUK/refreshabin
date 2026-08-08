import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const baseCors = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function allowedOrigins() {
  return new Set([
    Deno.env.get("SITE_URL"),
    ...(Deno.env.get("CORS_ALLOWED_ORIGINS") ?? "").split(","),
  ].map((value) => value?.trim().replace(/\/$/, "")).filter(Boolean) as string[]);
}

function cors(req: Request) {
  const origin = req.headers.get("Origin")?.replace(/\/$/, "");
  return origin && allowedOrigins().has(origin) ? { ...baseCors, "Access-Control-Allow-Origin": origin } : baseCors;
}

function json(req: Request, body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), ...extra, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

const menuSchema = {
  type: "object", additionalProperties: false,
  required: ["restaurant_name", "currency", "categories", "modifier_groups", "warnings"],
  properties: {
    restaurant_name: { type: ["string", "null"] }, currency: { type: "string", enum: ["GBP"] },
    categories: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "description", "items"], properties: {
      name: { type: "string" }, description: { type: ["string", "null"] },
      items: { type: "array", items: { type: "object", additionalProperties: false,
        required: ["name", "description", "price_pence", "is_vegetarian", "is_vegan", "confidence", "notes"], properties: {
          name: { type: "string" }, description: { type: ["string", "null"] }, price_pence: { type: ["integer", "null"], minimum: 0 },
          is_vegetarian: { type: "boolean" }, is_vegan: { type: "boolean" }, confidence: { type: "number", minimum: 0, maximum: 1 }, notes: { type: ["string", "null"] },
        } }, },
    } } },
    modifier_groups: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["name", "description", "selection_type", "minimum_selections", "maximum_selections", "options", "applies_to_item_names"], properties: {
        name: { type: "string" }, description: { type: ["string", "null"] }, selection_type: { type: "string", enum: ["single", "multiple"] },
        minimum_selections: { type: "integer", minimum: 0 }, maximum_selections: { type: ["integer", "null"], minimum: 1 },
        options: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "price_pence"], properties: { name: { type: "string" }, price_pence: { type: "integer", minimum: 0 } } } },
        applies_to_item_names: { type: "array", items: { type: "string" } },
      } } },
    warnings: { type: "array", items: { type: "string" } },
  },
};

async function consumeLimit(admin: ReturnType<typeof createClient>, subject: string, windowSeconds: number, maxRequests: number) {
  const { data, error } = await admin.rpc("consume_edge_function_rate_limit", {
    p_function_name: "scan-menu-import", p_subject_key: subject,
    p_window_seconds: windowSeconds, p_max_requests: maxRequests,
  });
  if (error) throw new Error("Rate-limit service unavailable");
  return data as { allowed: boolean; retry_after_seconds: number };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    const origin = req.headers.get("Origin")?.replace(/\/$/, "");
    if (origin && !allowedOrigins().has(origin)) return json(req, { error: "Origin not allowed" }, 403);
    return new Response("ok", { headers: cors(req) });
  }
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  const origin = req.headers.get("Origin")?.replace(/\/$/, "");
  if (origin && !allowedOrigins().has(origin)) return json(req, { error: "Origin not allowed" }, 403);
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > 8192) return json(req, { error: "Request body is too large" }, 413);

  let importId: string | null = null;
  let admin: ReturnType<typeof createClient> | null = null;
  try {
    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!openAiKey) return json(req, { error: "AI menu scanning is not configured." }, 503);
    if (!supabaseUrl || !anonKey || !serviceRoleKey) return json(req, { error: "Menu scanning is temporarily unavailable." }, 503);

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
    admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json(req, { error: "Your session has expired. Please sign in again." }, 401);

    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > 8192) return json(req, { error: "Request body is too large" }, 413);
    let body: { import_id?: unknown; section_name?: unknown; scan_instructions?: unknown };
    try { body = JSON.parse(rawBody); } catch { return json(req, { error: "Invalid request body." }, 400); }
    importId = typeof body.import_id === "string" ? body.import_id.trim() : null;
    if (!importId || !/^[0-9a-f-]{36}$/i.test(importId)) return json(req, { error: "A valid import_id is required." }, 400);
    const requestedSectionName = typeof body.section_name === "string" ? body.section_name.trim() : "";
    const requestedInstructions = typeof body.scan_instructions === "string" ? body.scan_instructions.trim() : "";
    if (requestedSectionName.length > 120) return json(req, { error: "Section name is too long." }, 400);
    if (requestedInstructions.length > 1500) return json(req, { error: "Scan instructions must be 1,500 characters or fewer." }, 400);

    const userLimit = await consumeLimit(admin, `user:${userData.user.id}`, 86400, 20);
    if (!userLimit.allowed) return json(req, { error: "Daily menu scan limit reached. Try again later." }, 429, { "Retry-After": String(userLimit.retry_after_seconds) });

    const { data: menuImport, error: importError } = await admin.from("menu_imports")
      .select("id, restaurant_id, uploaded_by, file_name, file_path, mime_type, status, confidence_notes")
      .eq("id", importId).single();
    if (importError || !menuImport) return json(req, { error: "Menu upload not found." }, 404);
    if (!allowedMimeTypes.has(menuImport.mime_type)) return json(req, { error: "Only PDF, JPEG, PNG and WebP menu files are supported." }, 400);

    const { data: membership } = await admin.from("restaurant_members").select("restaurant_id")
      .eq("restaurant_id", menuImport.restaurant_id).eq("user_id", userData.user.id).maybeSingle();
    if (!membership) return json(req, { error: "You do not have access to this restaurant." }, 403);
    if (menuImport.status === "processing") return json(req, { error: "This menu is already being scanned." }, 409);

    for (const [subject, windowSeconds, maxRequests] of [
      [`restaurant:${menuImport.restaurant_id}`, 86400, 50], [`import:${importId}`, 600, 3],
    ] as const) {
      const limit = await consumeLimit(admin, subject, windowSeconds, maxRequests);
      if (!limit.allowed) return json(req, { error: "Menu scan limit reached. Try again later." }, 429, { "Retry-After": String(limit.retry_after_seconds) });
    }

    const { error: lockError } = await admin.from("menu_imports").update({ status: "processing", error_message: null, updated_at: new Date().toISOString() })
      .eq("id", importId).neq("status", "processing");
    if (lockError) throw new Error("Unable to start menu scan");

    const savedNotes = menuImport.confidence_notes && typeof menuImport.confidence_notes === "object" && !Array.isArray(menuImport.confidence_notes)
      ? menuImport.confidence_notes as Record<string, unknown> : {};
    const sectionName = requestedSectionName || (typeof savedNotes.section_name === "string" ? savedNotes.section_name.slice(0, 120) : "Menu section");
    const scanInstructions = requestedInstructions || (typeof savedNotes.scan_instructions === "string" ? savedNotes.scan_instructions.slice(0, 1500) : "");

    const { data: file, error: downloadError } = await admin.storage.from("restaurant-menu-uploads").download(menuImport.file_path);
    if (downloadError || !file) throw new Error("The uploaded menu could not be downloaded");
    if (file.size < 1 || file.size > 15 * 1024 * 1024) throw new Error("The uploaded menu must be between 1 byte and 15 MB");
    if (file.type && !allowedMimeTypes.has(file.type)) throw new Error("The stored file type does not match a supported menu format");

    const dataUrl = `data:${menuImport.mime_type};base64,${toBase64(new Uint8Array(await file.arrayBuffer()))}`;
    const fileContent = menuImport.mime_type === "application/pdf"
      ? { type: "input_file", filename: menuImport.file_name, file_data: dataUrl }
      : { type: "input_image", image_url: dataUrl, detail: "high" };
    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", headers: { Authorization: `Bearer ${openAiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4.1-mini", temperature: 0, input: [{ role: "user", content: [fileContent, {
        type: "input_text", text: `Extract only the restaurant menu section named "${sectionName}" into structured data. Return exactly one category named "${sectionName}". Preserve readable item wording, descriptions and GBP prices; do not invent missing information. Convert explicit choices into reusable modifier groups and put uncertainty in warnings.${scanInstructions ? ` Restaurant instructions: ${scanInstructions}` : ""}`,
      }] }], text: { format: { type: "json_schema", name: "restaurant_menu", strict: true, schema: menuSchema } } }),
    });
    const aiData = await aiResponse.json();
    if (!aiResponse.ok) { console.error("OpenAI menu scan error", { status: aiResponse.status, importId }); throw new Error("The AI service could not scan this menu"); }
    const outputText = aiData?.output_text || aiData?.output?.flatMap((item: any) => item?.content || []).find((item: any) => item?.type === "output_text")?.text;
    if (!outputText) throw new Error("The AI service returned no menu data");
    const extracted = JSON.parse(outputText);
    const reviewNotes = [
      ...(Array.isArray(extracted.warnings) ? extracted.warnings : []),
      ...((extracted.categories || []).flatMap((category: any) => (category.items || []).filter((item: any) => item.price_pence === null || Number(item.confidence) < 0.8 || item.notes)
        .map((item: any) => ({ category: category.name, item: item.name, confidence: item.confidence, note: item.notes || (item.price_pence === null ? "Price needs review" : "Low confidence extraction") })))),
    ];
    const { error: updateError } = await admin.from("menu_imports").update({ status: "review", extracted_menu: extracted,
      confidence_notes: { ...savedNotes, section_name: sectionName, scan_instructions: scanInstructions, section_confirmed: false, menu_complete: false,
        warnings: reviewNotes.map((note) => typeof note === "string" ? note : note.note), review_notes: reviewNotes },
      error_message: null, updated_at: new Date().toISOString(), }).eq("id", importId);
    if (updateError) throw new Error("Unable to save extracted menu data");
    return json(req, { import_id: importId, status: "review", menu: extracted, confidence_notes: reviewNotes });
  } catch (error) {
    console.error("Menu scan failed", { importId, error });
    if (admin && importId) await admin.from("menu_imports").update({ status: "failed", error_message: "Menu scan failed. Please retry or contact support.", updated_at: new Date().toISOString() }).eq("id", importId);
    return json(req, { error: "The menu could not be scanned. Please retry shortly." }, 500);
  }
});
