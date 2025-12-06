import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleCors, corsHeaders } from '../_shared/cors.ts';
import { authenticateRequest, checkRateLimit, logUsage } from '../_shared/auth.ts';
import {
  successResponse,
  errorResponse,
  notFoundResponse,
  unauthorizedResponse,
  rateLimitResponse,
  internalErrorResponse,
} from '../_shared/response.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

Deno.serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();
  const url = new URL(req.url);
  const pathParts = url.pathname.split('/').filter(Boolean);
  // Path: /vehicles/... -> pathParts = ['vehicles', ...]
  const source = req.headers.get('X-Client-Source') || 'api';

  // Authenticate
  const auth = await authenticateRequest(req);
  if (!auth.isValid) {
    return unauthorizedResponse(auth.error || 'Unauthorized');
  }

  // Rate limit check
  const rateLimitCheck = checkRateLimit(auth.organizationId!, auth.rateLimit!);
  if (!rateLimitCheck.allowed) {
    return rateLimitResponse(rateLimitCheck.retryAfter!);
  }

  let response: Response;
  let endpoint = url.pathname;

  try {
    // Route handling
    // GET /vehicles/lookup?year=X&make=X&model=X&trim=X
    // GET /vehicles/specs?year=X&make=X&model=X
    // GET /vehicles/:id/specs
    // GET /vehicles/:id/warranty
    // GET /vehicles/:id/market-value?condition=X
    // GET /vehicles/:id/maintenance?current_mileage=X
    // GET /makes
    // GET /makes/:make/models?year=X
    // GET /makes/:make/models/:model/trims?year=X

    // The function is called at /functions/v1/vehicles/...
    // pathParts[0] = 'vehicles', pathParts[1] = subpath
    // We also support /functions/v1/vehicles/makes/... for convenience

    if (req.method !== 'GET') {
      response = errorResponse('method_not_allowed', 'Only GET requests are supported', 405);
    } else if (pathParts[0] === 'vehicles') {
      if (pathParts[1] === 'vin' && pathParts[2]) {
        // /vehicles/vin/:vin - Decode VIN and return all Car Intel data
        response = await handleVinLookup(pathParts[2], url);
        endpoint = '/vehicles/vin/:vin';
      } else if (pathParts[1] === 'decode' && pathParts[2]) {
        // /vehicles/decode/:vin - Just decode the VIN (NHTSA data only)
        response = await handleVinDecode(pathParts[2]);
        endpoint = '/vehicles/decode/:vin';
      } else if (pathParts[1] === 'lookup') {
        response = await handleLookup(url);
        endpoint = '/vehicles/lookup';
      } else if (pathParts[1] === 'specs' && !pathParts[2]) {
        response = await handleSpecsSearch(url);
        endpoint = '/vehicles/specs';
      } else if (pathParts[1] === 'makes') {
        // /vehicles/makes -> list all makes
        // /vehicles/makes/:make/models -> list models for make
        // /vehicles/makes/:make/models/:model/trims -> list trims
        if (!pathParts[2]) {
          response = await handleMakes(url);
          endpoint = '/makes';
        } else if (pathParts[3] === 'models' && !pathParts[4]) {
          response = await handleModels(pathParts[2], url);
          endpoint = '/makes/:make/models';
        } else if (pathParts[3] === 'models' && pathParts[5] === 'trims') {
          response = await handleTrims(pathParts[2], pathParts[4], url);
          endpoint = '/makes/:make/models/:model/trims';
        } else {
          response = notFoundResponse('Unknown makes endpoint');
        }
      } else if (pathParts[2] === 'specs') {
        response = await handleSpecsById(pathParts[1]);
        endpoint = '/vehicles/:id/specs';
      } else if (pathParts[2] === 'warranty') {
        response = await handleWarranty(pathParts[1]);
        endpoint = '/vehicles/:id/warranty';
      } else if (pathParts[2] === 'market-value') {
        response = await handleMarketValue(pathParts[1], url);
        endpoint = '/vehicles/:id/market-value';
      } else if (pathParts[2] === 'maintenance') {
        response = await handleMaintenance(pathParts[1], url);
        endpoint = '/vehicles/:id/maintenance';
      } else {
        response = notFoundResponse('Unknown endpoint');
      }
    } else {
      response = notFoundResponse('Unknown endpoint');
    }
  } catch (error) {
    console.error('Request error:', error);
    response = internalErrorResponse();
  }

  // Log usage
  const latencyMs = Date.now() - startTime;
  await logUsage(supabase, {
    apiKeyId: auth.apiKeyId!,
    organizationId: auth.organizationId!,
    endpoint,
    method: req.method,
    source,
    requestParams: Object.fromEntries(url.searchParams),
    responseStatus: response.status,
    latencyMs,
    ipAddress: req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For')?.split(',')[0],
    userAgent: req.headers.get('User-Agent') || undefined,
  });

  return response;
});

// ============================================
// NHTSA VIN DECODER
// ============================================

interface NHTSAResult {
  Variable: string;
  Value: string | null;
  VariableId: number;
  ValueId: string;
}

interface NHTSAResponse {
  Count: number;
  Message: string;
  Results: NHTSAResult[];
}

interface DecodedVin {
  vin: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  body_type: string | null;
  vehicle_type: string | null;
  doors: number | null;
  engine: {
    cylinders: number | null;
    displacement: string | null;
    horsepower: number | null;
    fuel_type: string | null;
  };
  drivetrain: string | null;
  transmission: string | null;
  manufacturer: string | null;
  plant_country: string | null;
  plant_city: string | null;
  error_code: string | null;
  error_text: string | null;
}

async function decodeVinWithNHTSA(vin: string): Promise<DecodedVin> {
  const response = await fetch(
    `https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${vin}?format=json`
  );

  if (!response.ok) {
    throw new Error(`NHTSA API error: ${response.status}`);
  }

  const data: NHTSAResponse = await response.json();

  // Helper to get value by variable name
  const getValue = (variableName: string): string | null => {
    const result = data.Results.find(r => r.Variable === variableName);
    return result?.Value || null;
  };

  const getNumericValue = (variableName: string): number | null => {
    const val = getValue(variableName);
    if (!val) return null;
    const num = parseInt(val);
    return isNaN(num) ? null : num;
  };

  return {
    vin,
    year: getNumericValue('Model Year'),
    make: getValue('Make'),
    model: getValue('Model'),
    trim: getValue('Trim'),
    body_type: getValue('Body Class'),
    vehicle_type: getValue('Vehicle Type'),
    doors: getNumericValue('Doors'),
    engine: {
      cylinders: getNumericValue('Engine Number of Cylinders'),
      displacement: getValue('Displacement (L)'),
      horsepower: getNumericValue('Engine Brake (hp) From'),
      fuel_type: getValue('Fuel Type - Primary'),
    },
    drivetrain: getValue('Drive Type'),
    transmission: getValue('Transmission Style'),
    manufacturer: getValue('Manufacturer Name'),
    plant_country: getValue('Plant Country'),
    plant_city: getValue('Plant City'),
    error_code: getValue('Error Code'),
    error_text: getValue('Error Text'),
  };
}

// ============================================
// HANDLER FUNCTIONS
// ============================================

async function handleVinDecode(vin: string): Promise<Response> {
  // Validate VIN format (17 characters, alphanumeric excluding I, O, Q)
  if (!vin || vin.length !== 17) {
    return errorResponse('invalid_vin', 'VIN must be exactly 17 characters');
  }

  const vinUpper = vin.toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vinUpper)) {
    return errorResponse('invalid_vin', 'VIN contains invalid characters');
  }

  try {
    const decoded = await decodeVinWithNHTSA(vinUpper);

    // Check for NHTSA errors (error code 0 means success)
    if (decoded.error_code && decoded.error_code !== '0') {
      // Still return the data, but include the error info
      return successResponse({
        ...decoded,
        warning: decoded.error_text,
      });
    }

    return successResponse(decoded);
  } catch (error) {
    console.error('VIN decode error:', error);
    return internalErrorResponse();
  }
}

async function handleVinLookup(vin: string, url: URL): Promise<Response> {
  // Validate VIN format
  if (!vin || vin.length !== 17) {
    return errorResponse('invalid_vin', 'VIN must be exactly 17 characters');
  }

  const vinUpper = vin.toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vinUpper)) {
    return errorResponse('invalid_vin', 'VIN contains invalid characters');
  }

  try {
    // Decode VIN first
    const decoded = await decodeVinWithNHTSA(vinUpper);

    if (!decoded.year || !decoded.make || !decoded.model) {
      return errorResponse('decode_failed', 'Could not decode vehicle information from VIN');
    }

    // Normalize model name for database lookup
    const modelPattern = decoded.model.replace(/-/g, '%');

    // Fetch specs from our database
    // First try with trim, then fall back to without trim
    let specs = null;

    if (decoded.trim) {
      // Clean up trim - NHTSA often returns "EX-L/EX-L Navi" style, take first part
      const trimParts = decoded.trim.split('/');
      const primaryTrim = trimParts[0].trim();

      const { data: specsWithTrim } = await supabase
        .from('vehicle_specs')
        .select('*')
        .ilike('make', decoded.make)
        .ilike('model', modelPattern)
        .eq('year', decoded.year)
        .ilike('trim', `${primaryTrim}%`)
        .limit(1)
        .single();

      specs = specsWithTrim;
    }

    // If no trim match, try without trim
    if (!specs) {
      const { data: specsWithoutTrim } = await supabase
        .from('vehicle_specs')
        .select('*')
        .ilike('make', decoded.make)
        .ilike('model', modelPattern)
        .eq('year', decoded.year)
        .limit(1)
        .single();

      specs = specsWithoutTrim;
    }

    // Fetch warranty if we have specs
    let warranties: any[] = [];
    if (specs) {
      const { data: warrantyData } = await supabase
        .from('vehicle_warranties')
        .select('*')
        .eq('vehicle_spec_id', specs.id);
      warranties = warrantyData || [];
    }

    // Clean up trim for queries
    let primaryTrim: string | null = null;
    if (decoded.trim) {
      const trimParts = decoded.trim.split('/');
      primaryTrim = trimParts[0].trim();
    }

    // Fetch market values - try with trim first, then without
    let marketValues: any[] = [];
    if (primaryTrim) {
      const { data: marketWithTrim } = await supabase
        .from('vehicle_market_values')
        .select('*')
        .ilike('make', decoded.make)
        .ilike('model', modelPattern)
        .eq('year', decoded.year)
        .ilike('trim', `${primaryTrim}%`);
      marketValues = marketWithTrim || [];
    }

    if (marketValues.length === 0) {
      const { data: marketWithoutTrim } = await supabase
        .from('vehicle_market_values')
        .select('*')
        .ilike('make', decoded.make)
        .ilike('model', modelPattern)
        .eq('year', decoded.year)
        .limit(20);
      marketValues = marketWithoutTrim || [];
    }

    // Fetch maintenance schedules - try with trim first, then without
    let maintenance: any[] = [];
    if (primaryTrim) {
      const { data: maintenanceWithTrim } = await supabase
        .from('vehicle_maintenance_schedules')
        .select('*')
        .ilike('make', decoded.make)
        .ilike('model', modelPattern)
        .eq('year', decoded.year)
        .ilike('trim', `${primaryTrim}%`)
        .order('mileage', { ascending: true })
        .limit(50);
      maintenance = maintenanceWithTrim || [];
    }

    if (maintenance.length === 0) {
      const { data: maintenanceWithoutTrim } = await supabase
        .from('vehicle_maintenance_schedules')
        .select('*')
        .ilike('make', decoded.make)
        .ilike('model', modelPattern)
        .eq('year', decoded.year)
        .order('mileage', { ascending: true })
        .limit(50);
      maintenance = maintenanceWithoutTrim || [];
    }

    return successResponse({
      vin_info: decoded,
      specs: specs || null,
      warranty: warranties || [],
      market_values: formatMarketValues(marketValues || []),
      maintenance: maintenance || [],
    });
  } catch (error) {
    console.error('VIN lookup error:', error);
    return internalErrorResponse();
  }
}

async function handleLookup(url: URL): Promise<Response> {
  const year = url.searchParams.get('year');
  const make = url.searchParams.get('make');
  const model = url.searchParams.get('model');
  const trim = url.searchParams.get('trim');

  if (!year || !make || !model) {
    return errorResponse('missing_params', 'year, make, and model are required');
  }

  const yearInt = parseInt(year);
  if (isNaN(yearInt)) {
    return errorResponse('invalid_params', 'year must be a number');
  }

  // Normalize model name - handle variations like "CR-V" vs "CR V"
  const modelPattern = model.replace(/-/g, '%');

  // Fetch specs
  let specsQuery = supabase
    .from('vehicle_specs')
    .select('*')
    .ilike('make', make)
    .ilike('model', modelPattern)
    .eq('year', yearInt);

  if (trim) {
    specsQuery = specsQuery.ilike('trim', `${trim}%`);
  }

  const { data: specs, error: specsError } = await specsQuery.limit(1).single();

  if (specsError && specsError.code !== 'PGRST116') {
    console.error('Specs query error:', specsError);
    return internalErrorResponse();
  }

  // Fetch warranty - join through vehicle_specs
  let warranties: any[] = [];
  if (specs) {
    const { data: warrantyData } = await supabase
      .from('vehicle_warranties')
      .select('*')
      .eq('vehicle_spec_id', specs.id);
    warranties = warrantyData || [];
  }

  // Fetch market values
  let marketQuery = supabase
    .from('vehicle_market_values')
    .select('*')
    .ilike('make', make)
    .ilike('model', modelPattern)
    .eq('year', yearInt);

  if (trim) {
    marketQuery = marketQuery.ilike('trim', `${trim}%`);
  }

  const { data: marketValues } = await marketQuery;

  // Fetch maintenance schedules
  let maintenanceQuery = supabase
    .from('vehicle_maintenance_schedules')
    .select('*')
    .ilike('make', make)
    .ilike('model', modelPattern)
    .eq('year', yearInt)
    .order('mileage', { ascending: true });

  if (trim) {
    maintenanceQuery = maintenanceQuery.ilike('trim', `${trim}%`);
  }

  const { data: maintenance } = await maintenanceQuery.limit(50);

  if (!specs && !warranties?.length && !marketValues?.length && !maintenance?.length) {
    return notFoundResponse('No vehicle data found for the specified year, make, model');
  }

  return successResponse({
    specs: specs || null,
    warranty: warranties || [],
    market_values: formatMarketValues(marketValues || []),
    maintenance: maintenance || [],
  });
}

async function handleSpecsSearch(url: URL): Promise<Response> {
  const year = url.searchParams.get('year');
  const make = url.searchParams.get('make');
  const model = url.searchParams.get('model');
  const trim = url.searchParams.get('trim');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);

  let query = supabase.from('vehicle_specs').select('*');

  if (year) query = query.eq('year', parseInt(year));
  if (make) query = query.ilike('make', make);
  if (model) query = query.ilike('model', model);
  if (trim) query = query.ilike('trim', trim);

  const { data, error } = await query.limit(limit);

  if (error) {
    console.error('Specs search error:', error);
    return internalErrorResponse();
  }

  return successResponse(data || []);
}

async function handleSpecsById(id: string): Promise<Response> {
  const { data, error } = await supabase
    .from('vehicle_specs')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return notFoundResponse('Vehicle not found');
    }
    console.error('Specs by ID error:', error);
    return internalErrorResponse();
  }

  return successResponse(data);
}

async function handleWarranty(vehicleId: string): Promise<Response> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(vehicleId);

  if (!isUuid) {
    return errorResponse('invalid_params', 'Vehicle ID must be a valid UUID');
  }

  // Warranties are linked by vehicle_spec_id
  const { data: warranties, error } = await supabase
    .from('vehicle_warranties')
    .select('*')
    .eq('vehicle_spec_id', vehicleId);

  if (error) {
    console.error('Warranty query error:', error);
    return internalErrorResponse();
  }

  if (!warranties || warranties.length === 0) {
    return notFoundResponse('No warranty information found for this vehicle');
  }

  return successResponse(warranties);
}

async function handleMarketValue(vehicleId: string, url: URL): Promise<Response> {
  const condition = url.searchParams.get('condition');
  const mileage = url.searchParams.get('mileage');

  // Get vehicle specs first
  const { data: specs } = await supabase
    .from('vehicle_specs')
    .select('year, make, model, trim')
    .eq('id', vehicleId)
    .single();

  if (!specs) {
    return notFoundResponse('Vehicle not found');
  }

  let query = supabase
    .from('vehicle_market_values')
    .select('*')
    .eq('year', specs.year)
    .ilike('make', specs.make)
    .ilike('model', specs.model);

  if (specs.trim) {
    query = query.ilike('trim', specs.trim);
  }

  if (condition) {
    query = query.eq('condition', condition);
  }

  const { data: values, error } = await query;

  if (error) {
    console.error('Market value query error:', error);
    return internalErrorResponse();
  }

  // Format response with optional mileage adjustment
  const result = formatMarketValues(values || []);

  // Apply simple mileage adjustment if provided (rough estimate: -$0.10/mile over 12k/year average)
  if (mileage && specs.year) {
    const mileageInt = parseInt(mileage);
    const vehicleAge = new Date().getFullYear() - specs.year;
    const expectedMileage = vehicleAge * 12000;
    const mileageDiff = mileageInt - expectedMileage;
    const adjustment = Math.round(mileageDiff * -0.10 * 100); // cents

    for (const conditionKey of Object.keys(result)) {
      const conditionData = result[conditionKey];
      if (conditionData.trade_in_cents) conditionData.trade_in_cents += adjustment;
      if (conditionData.private_party_cents) conditionData.private_party_cents += adjustment;
      if (conditionData.dealer_retail_cents) conditionData.dealer_retail_cents += adjustment;
    }
  }

  return successResponse(result);
}

async function handleMaintenance(vehicleId: string, url: URL): Promise<Response> {
  const currentMileage = url.searchParams.get('current_mileage');

  // Get vehicle specs first
  const { data: specs } = await supabase
    .from('vehicle_specs')
    .select('year, make, model, trim')
    .eq('id', vehicleId)
    .single();

  if (!specs) {
    return notFoundResponse('Vehicle not found');
  }

  let query = supabase
    .from('vehicle_maintenance_schedules')
    .select('*')
    .eq('year', specs.year)
    .ilike('make', specs.make)
    .ilike('model', specs.model)
    .order('mileage', { ascending: true });

  // Use partial match for trim since maintenance data has full trim+style
  if (specs.trim) {
    query = query.ilike('trim', `${specs.trim}%`);
  }

  // If current_mileage provided, only show upcoming maintenance
  if (currentMileage) {
    query = query.gte('mileage', parseInt(currentMileage));
  }

  const { data: schedules, error } = await query.limit(50);

  if (error) {
    console.error('Maintenance query error:', error);
    return internalErrorResponse();
  }

  return successResponse(schedules || []);
}

async function handleMakes(url: URL): Promise<Response> {
  const year = url.searchParams.get('year');

  let query = supabase
    .from('vehicle_specs')
    .select('make');

  if (year) {
    query = query.eq('year', parseInt(year));
  }

  const { data, error } = await query;

  if (error) {
    console.error('Makes query error:', error);
    return internalErrorResponse();
  }

  // Get unique makes
  const makes = [...new Set((data || []).map(d => d.make))].sort();
  return successResponse(makes);
}

async function handleModels(make: string, url: URL): Promise<Response> {
  const year = url.searchParams.get('year');

  let query = supabase
    .from('vehicle_specs')
    .select('model')
    .ilike('make', make);

  if (year) {
    query = query.eq('year', parseInt(year));
  }

  const { data, error } = await query;

  if (error) {
    console.error('Models query error:', error);
    return internalErrorResponse();
  }

  const models = [...new Set((data || []).map(d => d.model))].sort();
  return successResponse(models);
}

async function handleTrims(make: string, model: string, url: URL): Promise<Response> {
  const year = url.searchParams.get('year');

  let query = supabase
    .from('vehicle_specs')
    .select('trim')
    .ilike('make', make)
    .ilike('model', model);

  if (year) {
    query = query.eq('year', parseInt(year));
  }

  const { data, error } = await query;

  if (error) {
    console.error('Trims query error:', error);
    return internalErrorResponse();
  }

  const trims = [...new Set((data || []).filter(d => d.trim).map(d => d.trim))].sort();
  return successResponse(trims);
}

// ============================================
// HELPERS
// ============================================

function formatMarketValues(values: any[]): Record<string, any> {
  const result: Record<string, any> = {};
  for (const v of values) {
    result[v.condition] = {
      condition: v.condition,
      trade_in_cents: v.trade_in_cents,
      private_party_cents: v.private_party_cents,
      dealer_retail_cents: v.dealer_retail_cents,
    };
  }
  return result;
}
