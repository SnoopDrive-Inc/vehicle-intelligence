import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface AuthResult {
  isValid: boolean;
  apiKeyId?: string;
  organizationId?: string;
  orgName?: string;
  tierId?: string;
  rateLimit?: number;
  monthlyLimit?: number;
  error?: string;
  errorCode?: string;
}

// Simple in-memory rate limiter (per-worker, resets on cold start)
// For production, use Redis/Upstash
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

export async function authenticateRequest(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get('Authorization');

  if (!authHeader) {
    return { isValid: false, error: 'Missing Authorization header', errorCode: 'missing_auth' };
  }

  const match = authHeader.match(/^Bearer\s+(ci_(?:live|test)_[a-zA-Z0-9]+)$/);
  if (!match) {
    return { isValid: false, error: 'Invalid API key format', errorCode: 'invalid_format' };
  }

  const apiKey = match[1];

  // Hash the key to look it up
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const keyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  // Create Supabase client with service role for validation
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  // Validate the key using our stored function
  const { data: validationResult, error } = await supabase
    .rpc('validate_api_key', { p_key_hash: keyHash });

  if (error) {
    console.error('API key validation error:', error);
    return { isValid: false, error: 'Internal validation error', errorCode: 'internal_error' };
  }

  if (!validationResult || validationResult.length === 0) {
    return { isValid: false, error: 'Invalid API key', errorCode: 'invalid_key' };
  }

  const result = validationResult[0];

  if (!result.is_valid) {
    const errorMessages: Record<string, string> = {
      'invalid_key': 'Invalid API key',
      'key_disabled': 'API key has been disabled',
      'key_expired': 'API key has expired',
      'subscription_inactive': 'Subscription is not active',
      'quota_exceeded': 'Monthly quota exceeded. Please upgrade your plan.',
    };
    return {
      isValid: false,
      error: errorMessages[result.rejection_reason] || 'Authentication failed',
      errorCode: result.rejection_reason
    };
  }

  return {
    isValid: true,
    apiKeyId: result.api_key_id,
    organizationId: result.organization_id,
    orgName: result.org_name,
    tierId: result.tier_id,
    rateLimit: result.rate_limit,
    monthlyLimit: result.monthly_limit,
  };
}

export function checkRateLimit(organizationId: string, limit: number): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const windowMs = 60000; // 1 minute window
  const key = organizationId;

  const current = rateLimitMap.get(key);

  if (!current || (now - current.windowStart) > windowMs) {
    // New window
    rateLimitMap.set(key, { count: 1, windowStart: now });
    return { allowed: true };
  }

  if (current.count >= limit) {
    const retryAfter = Math.ceil((windowMs - (now - current.windowStart)) / 1000);
    return { allowed: false, retryAfter };
  }

  current.count++;
  return { allowed: true };
}

export async function logUsage(
  supabase: any,
  params: {
    apiKeyId: string;
    organizationId: string;
    endpoint: string;
    method: string;
    source: string;
    requestParams?: Record<string, any>;
    responseStatus: number;
    latencyMs: number;
    ipAddress?: string;
    userAgent?: string;
  }
): Promise<void> {
  try {
    // Log detailed usage
    await supabase.from('usage_logs').insert({
      api_key_id: params.apiKeyId,
      organization_id: params.organizationId,
      endpoint: params.endpoint,
      method: params.method,
      source: params.source,
      request_params: params.requestParams,
      response_status: params.responseStatus,
      tokens_used: 1,
      latency_ms: params.latencyMs,
      ip_address: params.ipAddress,
      user_agent: params.userAgent,
    });

    // Increment daily aggregate
    await supabase.rpc('increment_daily_usage', {
      p_org_id: params.organizationId,
      p_date: new Date().toISOString().split('T')[0],
      p_source: params.source,
      p_endpoint: params.endpoint,
      p_requests: 1,
      p_tokens: 1,
    });
  } catch (error) {
    console.error('Failed to log usage:', error);
    // Don't fail the request if logging fails
  }
}
