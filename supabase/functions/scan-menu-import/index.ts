import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

const menuSchema = {
  type: "object",
  additionalProperties: false,
  required: ["restaurant_name", "currency", "categories", "modifier_groups", "warnings"],
  properties: {
    restaurant_name: { type: ["string", "null"] },
    currency: { type: "string", enum: ["GBP"] },
    categories: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "description", "items"],
        properties: {
          name: { type: "string" },
          description: { type: ["string", "null"] },
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "description", "price_pence", "is_vegetarian", "is_vegan", "confidence", "notes"],
              properties: {
                name: { type: "string" },
                description: { type: ["string", "null"] },
                price_pence: { type: ["integer", "null"], minimum: 0 },
                is_vegetarian: { type: "boolean" },
                is_vegan: { type: "boolean" },
                confidence: { type: "number", minimum: 0, maximum: 1 },
                notes: { type: ["string", "null"] },
              },
            },
          },
        },
      },
    },
    modifier_groups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "description", "selection_type", "minimum_selections", "maximum_selections", "options", "applies_to_item_names"],
        properties: {
          name: { type: "string" },
          description: { type: ["string", "null"] },
          selection_type: { type: "string", enum: ["single", "multiple"] },
          minimum_selections: { type: "integer", minimum: 0 },
          maximum_selections: { type: ["integer", "null"], minimum: 1 },
          options: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "price_pence"],
              properties: {
                name: { type: "string" },
                price_pence: { type: "integer", minimum: 0 },
              },
            },
          },
          applies_to_item_names: { type: "array", items: { type: "string" } },
        },
      },
    },
    warnings: {
      type: "array",
      items: { type: "string" },
    },
  },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let importId: string | null = null;
  let admin: ReturnType<typeof createClient> | null = null;

  try {
    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!openAiKey) return json({ error: "AI menu scanning is not configured." }, 503);
    if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: "Supabase configuration is missing." }, 500);

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "Your session has expired. Please sign in again." }, 401);

    const body = await req.json();
    importId = typeof body?.import_id === "string" ? body.import_id : null;
    if (!importId) return json({ error: "import_id is required." }, 400);

    const requestedSectionName = typeof body?.section_name === "string" ? body.section_name.trim() : "";
    const requestedInstructions = typeof body?.scan_instructions === "string" ? body.scan_instructions.trim() : "";

    const { data: menuImport, error: importError } = await admin
      .from("menu_imports")
      .select("id, restaurant_id, uploaded_by, file_name, file_path, mime_type, status, confidence_notes")
      .eq("id", importId)
      .single();

    if (importError || !menuImport) return json({ error: "Menu upload not found." }, 404);

    const { data: membership } = await admin
      .from("restaurant_members")
      .select("restaurant_id")
      .eq("restaurant_id", menuImport.restaurant_id)
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (!membership) return json({ error: "You do not have access to this restaurant." }, 403);
    if (menuImport.status === "processing") return json({ error: "This menu is already being scanned." }, 409);

    await admin.from("menu_imports").update({
      status: "processing",
      error_message: null,
      updated_at: new Date().toISOString(),
    }).eq("id", importId);

    const savedNotes = menuImport.confidence_notes && typeof menuImport.confidence_notes === "object" && !Array.isArray(menuImport.confidence_notes)
      ? menuImport.confidence_notes as Record<string, unknown>
      : {};
    const sectionName = requestedSectionName || (typeof savedNotes.section_name === "string" ? savedNotes.section_name : "Menu section");
    const scanInstructions = requestedInstructions || (typeof savedNotes.scan_instructions === "string" ? savedNotes.scan_instructions : "");

    const { data: file, error: downloadError } = await admin.storage
      .from("restaurant-menu-uploads")
      .download(menuImport.file_path);

    if (downloadError || !file) throw new Error(downloadError?.message || "The uploaded menu could not be downloaded.");
    if (file.size > 15 * 1024 * 1024) throw new Error("The uploaded menu is larger than 15 MB.");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const dataUrl = `data:${menuImport.mime_type};base64,${toBase64(bytes)}`;
    const fileContent = menuImport.mime_type === "application/pdf"
      ? { type: "input_file", filename: menuImport.file_name, file_data: dataUrl }
      : { type: "input_image", image_url: dataUrl, detail: "high" };

    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0,
        input: [{
          role: "user",
          content: [
            fileContent,
            {
              type: "input_text",
              text: `Extract only the restaurant menu section named "${sectionName}" into structured data. Return exactly one category named "${sectionName}". Ignore products that clearly belong to other sections. Preserve item wording, descriptions, and prices exactly where readable. Convert GBP prices to integer pence. Do not invent missing prices or descriptions. Use null when uncertain or absent. Identify vegetarian or vegan items only when explicitly indicated or unambiguous. Convert choices described by the restaurant (such as meat, size, heat, rice, toppings or upgrades) into reusable modifier_groups instead of adding them to descriptions. Use single with minimum 1 and maximum 1 for a required choose-one choice. Put the exact extracted item names in applies_to_item_names; use every item in this section when the instruction says all dishes. Extra charges belong in option price_pence. Do not invent choices. Put ambiguity, unreadable text, meal-deal complexity, and anything requiring human review in warnings and item notes.${scanInstructions ? ` Follow these restaurant-provided instructions for this section: ${scanInstructions}` : ""}`,
            },
          ],
        }],
        text: {
          format: {
            type: "json_schema",
            name: "restaurant_menu",
            strict: true,
            schema: menuSchema,
          },
        },
      }),
    });

    const aiData = await aiResponse.json();
    if (!aiResponse.ok) {
      console.error("OpenAI menu scan error", aiData);
      throw new Error(aiData?.error?.message || "The AI service could not scan this menu.");
    }

    const outputText = aiData?.output_text
      || aiData?.output?.flatMap((item: any) => item?.content || []).find((item: any) => item?.type === "output_text")?.text;
    if (!outputText) throw new Error("The AI service returned no menu data.");

    const extracted = JSON.parse(outputText);
    const reviewNotes = [
      ...(Array.isArray(extracted.warnings) ? extracted.warnings : []),
      ...((extracted.categories || []).flatMap((category: any) =>
        (category.items || [])
          .filter((item: any) => item.price_pence === null || Number(item.confidence) < 0.8 || item.notes)
          .map((item: any) => ({
            category: category.name,
            item: item.name,
            confidence: item.confidence,
            note: item.notes || (item.price_pence === null ? "Price needs review" : "Low confidence extraction"),
          })),
      )),
    ];

    const { error: updateError } = await admin.from("menu_imports").update({
      status: "review",
      extracted_menu: extracted,
      confidence_notes: {
        ...savedNotes,
        section_name: sectionName,
        scan_instructions: scanInstructions,
        section_confirmed: false,
        menu_complete: false,
        warnings: reviewNotes.map((note) => typeof note === "string" ? note : note.note),
        review_notes: reviewNotes,
      },
      error_message: null,
      updated_at: new Date().toISOString(),
    }).eq("id", importId);

    if (updateError) throw new Error(updateError.message);

    return json({
      import_id: importId,
      status: "review",
      menu: extracted,
      confidence_notes: reviewNotes,
    });
  } catch (error) {
    console.error(error);
    if (admin && importId) {
      await admin.from("menu_imports").update({
        status: "failed",
        error_message: error instanceof Error ? error.message : "Unexpected menu scanning error.",
        updated_at: new Date().toISOString(),
      }).eq("id", importId);
    }
    return json({ error: error instanceof Error ? error.message : "Unexpected menu scanning error." }, 500);
  }
});
