import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type InviteResponse = {
  invite_id: string;
  token: string;
  role: string;
  email: string;
  display_name: string | null;
  expires_at: string;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** ينشئ رابط دعوة، ويرسله عبر Resend عند توفر المفتاح، أو يعيده للنسخ اليدوي. */
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const appUrl = Deno.env.get("QAYD_APP_URL") ?? "https://qayd.app";
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("INVITE_FROM_EMAIL");

  if (!supabaseUrl || !supabaseAnonKey) return json({ error: "server_not_configured" }, 500);

  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "authentication_required" }, 401);

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) return json({ error: "authentication_required" }, 401);

  let body: { office_id?: string; email?: string; role?: string; display_name?: string; expires_hours?: number };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  if (!body.office_id || !email || !body.role) return json({ error: "office_id_email_and_role_required" }, 400);

  const { data, error } = await client.rpc("create_email_invite", {
    p_office_id: body.office_id,
    p_contact: email,
    p_role: body.role,
    p_display_name: body.display_name ?? null,
    p_expires_hours: body.expires_hours ?? 168,
  });
  if (error) return json({ error: error.message }, 400);

  const invite = data as InviteResponse;
  const inviteUrl = `${appUrl.replace(/\/$/, "")}/join?token=${encodeURIComponent(invite.token)}`;
  const result: Record<string, unknown> = {
    invite_id: invite.invite_id,
    invite_url: inviteUrl,
    expires_at: invite.expires_at,
    role: invite.role,
    delivery: "manual",
  };

  if (resendApiKey && fromEmail) {
    const resend = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromEmail,
        to: [email],
        subject: "دعوة للانضمام إلى مكتب قيد",
        text: `تمت دعوتك للانضمام إلى مكتب قيد بدور ${invite.role}. افتح الرابط التالي لإكمال إنشاء الحساب:\n\n${inviteUrl}\n\nالرابط صالح حتى ${invite.expires_at}.`,
      }),
    });
    if (resend.ok) result.delivery = "email";
    else result.delivery_warning = "invite_created_but_email_failed_copy_the_link";
  }

  return json(result);
});
