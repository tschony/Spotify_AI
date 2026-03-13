import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let browserClient: SupabaseClient | undefined;
let serverClient: SupabaseClient | undefined;
let serviceRoleClient: SupabaseClient | undefined;

function getRequiredServiceRoleKey() {
  if (!supabaseServiceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }

  return supabaseServiceRoleKey;
}

export function getSupabaseBrowserClient() {
  if (!browserClient) {
    browserClient = createClient(supabaseUrl, supabaseAnonKey);
  }

  return browserClient;
}

export function getSupabaseServerClient() {
  if (!serverClient) {
    serverClient = createClient(supabaseUrl, getRequiredServiceRoleKey(), {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return serverClient;
}

export function getSupabaseServiceRoleClient() {
  if (!serviceRoleClient) {
    serviceRoleClient = createClient(
      supabaseUrl,
      getRequiredServiceRoleKey(),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
  }

  return serviceRoleClient;
}

export function getSupabaseClient() {
  return typeof window === "undefined"
    ? getSupabaseServerClient()
    : getSupabaseBrowserClient();
}
