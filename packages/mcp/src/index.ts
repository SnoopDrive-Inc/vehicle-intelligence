#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Configuration
const API_BASE_URL = process.env.CARINTEL_API_URL || "https://api.carintel.io/v1";
const API_KEY = process.env.CARINTEL_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || "https://api.carintel.io";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!API_KEY) {
  console.error("Error: CARINTEL_API_KEY environment variable is required");
  process.exit(1);
}

// Supabase REST helper for manual content
async function supabaseRequest<T>(
  table: string,
  query: string,
  single = false
): Promise<T> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "apikey": SUPABASE_ANON_KEY || API_KEY || "",
  };
  if (single) {
    headers["Accept"] = "application/vnd.pgrst.object+json";
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Supabase request failed: ${response.status} - ${errorData}`);
  }

  return response.json() as Promise<T>;
}

// API client helper
async function apiRequest<T>(endpoint: string, params?: Record<string, string | number | undefined>): Promise<T> {
  // Ensure base URL ends with / and endpoint doesn't start with /
  const baseUrl = API_BASE_URL.endsWith("/") ? API_BASE_URL : API_BASE_URL + "/";
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
  const url = new URL(cleanEndpoint, baseUrl);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });
  }

  const response = await fetch(url.toString(), {
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "X-Client-Source": "mcp"
    }
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: { message: response.statusText } })) as { error?: { message?: string } };
    throw new Error(errorData.error?.message || `API request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

// Create MCP server
const server = new McpServer({
  name: "carintel",
  version: "0.1.0"
});

// Tool: lookup_vehicle
server.tool(
  "lookup_vehicle",
  "Look up complete vehicle information by year, make, model, and optional trim. Returns specs, warranty, market values, and maintenance schedule.",
  {
    year: z.number().int().min(1900).max(2030).describe("Vehicle model year"),
    make: z.string().describe("Vehicle manufacturer (e.g., Toyota, Honda, Ford)"),
    model: z.string().describe("Vehicle model name (e.g., Camry, Accord, F-150)"),
    trim: z.string().optional().describe("Vehicle trim level (e.g., XLE, Sport, Limited)")
  },
  async ({ year, make, model, trim }) => {
    try {
      const data = await apiRequest<any>("/lookup", { year, make, model, trim });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error looking up vehicle: ${error instanceof Error ? error.message : "Unknown error"}`
          }
        ],
        isError: true
      };
    }
  }
);

// Tool: decode_vin
server.tool(
  "decode_vin",
  "Decode a VIN (Vehicle Identification Number) to get vehicle information. Returns decoded VIN data plus matching specs, warranty, market values, and maintenance from Car Intel database.",
  {
    vin: z.string().length(17).describe("17-character Vehicle Identification Number")
  },
  async ({ vin }) => {
    try {
      const data = await apiRequest<any>(`/vin/${vin}`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error decoding VIN: ${error instanceof Error ? error.message : "Unknown error"}`
          }
        ],
        isError: true
      };
    }
  }
);

// Tool: get_vehicle_specs
server.tool(
  "get_vehicle_specs",
  "Get detailed specifications for a vehicle including engine, transmission, dimensions, fuel economy, and features.",
  {
    year: z.number().int().min(1900).max(2030).describe("Vehicle model year"),
    make: z.string().describe("Vehicle manufacturer"),
    model: z.string().describe("Vehicle model name"),
    trim: z.string().optional().describe("Vehicle trim level")
  },
  async ({ year, make, model, trim }) => {
    try {
      // Use lookup endpoint and extract specs
      const data = await apiRequest<any>("/lookup", { year, make, model, trim });
      const specs = data.data?.specs;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ data: specs, meta: data.meta }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting specs: ${error instanceof Error ? error.message : "Unknown error"}`
          }
        ],
        isError: true
      };
    }
  }
);

// Tool: get_market_value
server.tool(
  "get_market_value",
  "Get market value estimates for a vehicle based on condition. Returns trade-in, private party, and dealer retail values.",
  {
    year: z.number().int().min(1900).max(2030).describe("Vehicle model year"),
    make: z.string().describe("Vehicle manufacturer"),
    model: z.string().describe("Vehicle model name"),
    trim: z.string().optional().describe("Vehicle trim level"),
    condition: z.enum(["Outstanding", "Clean", "Average", "Rough"]).optional().describe("Vehicle condition (defaults to all conditions)")
  },
  async ({ year, make, model, trim, condition }) => {
    try {
      // Use lookup endpoint and extract market values
      const data = await apiRequest<any>("/lookup", { year, make, model, trim });
      let marketValues = data.data?.market_values;

      // Filter by condition if specified
      if (condition && marketValues) {
        marketValues = { [condition]: marketValues[condition] };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ data: marketValues, meta: data.meta }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting market value: ${error instanceof Error ? error.message : "Unknown error"}`
          }
        ],
        isError: true
      };
    }
  }
);

// Tool: get_warranty_info
server.tool(
  "get_warranty_info",
  "Get warranty coverage information for a vehicle including basic, powertrain, corrosion, and roadside assistance coverage.",
  {
    year: z.number().int().min(1900).max(2030).describe("Vehicle model year"),
    make: z.string().describe("Vehicle manufacturer"),
    model: z.string().describe("Vehicle model name"),
    trim: z.string().optional().describe("Vehicle trim level")
  },
  async ({ year, make, model, trim }) => {
    try {
      // Use lookup endpoint and extract warranty
      const data = await apiRequest<any>("/lookup", { year, make, model, trim });
      const warranty = data.data?.warranty;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ data: warranty, meta: data.meta }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting warranty info: ${error instanceof Error ? error.message : "Unknown error"}`
          }
        ],
        isError: true
      };
    }
  }
);

// Tool: get_maintenance_schedule
server.tool(
  "get_maintenance_schedule",
  "Get maintenance schedule for a vehicle. Optionally filter by current mileage to show upcoming services.",
  {
    year: z.number().int().min(1900).max(2030).describe("Vehicle model year"),
    make: z.string().describe("Vehicle manufacturer"),
    model: z.string().describe("Vehicle model name"),
    trim: z.string().optional().describe("Vehicle trim level"),
    current_mileage: z.number().int().optional().describe("Current odometer reading to filter upcoming services")
  },
  async ({ year, make, model, trim, current_mileage }) => {
    try {
      // Use lookup endpoint and extract maintenance
      const data = await apiRequest<any>("/lookup", { year, make, model, trim });
      let maintenance = data.data?.maintenance;

      // Filter by current mileage if specified
      if (current_mileage && Array.isArray(maintenance)) {
        maintenance = maintenance.filter((item: any) => item.mileage >= current_mileage);
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ data: maintenance, meta: data.meta }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting maintenance schedule: ${error instanceof Error ? error.message : "Unknown error"}`
          }
        ],
        isError: true
      };
    }
  }
);

// Tool: list_makes
server.tool(
  "list_makes",
  "Get a list of all vehicle makes (manufacturers) available in the database.",
  {},
  async () => {
    try {
      const data = await apiRequest<any>("/makes");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error listing makes: ${error instanceof Error ? error.message : "Unknown error"}`
          }
        ],
        isError: true
      };
    }
  }
);

// Tool: list_models
server.tool(
  "list_models",
  "Get a list of all models for a specific make, optionally filtered by year.",
  {
    make: z.string().describe("Vehicle manufacturer"),
    year: z.number().int().min(1900).max(2030).optional().describe("Filter by model year")
  },
  async ({ make, year }) => {
    try {
      const data = await apiRequest<any>(`/makes/${encodeURIComponent(make)}/models`, { year });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error listing models: ${error instanceof Error ? error.message : "Unknown error"}`
          }
        ],
        isError: true
      };
    }
  }
);

// Tool: list_trims
server.tool(
  "list_trims",
  "Get a list of all trims for a specific make and model, optionally filtered by year.",
  {
    make: z.string().describe("Vehicle manufacturer"),
    model: z.string().describe("Vehicle model name"),
    year: z.number().int().min(1900).max(2030).optional().describe("Filter by model year")
  },
  async ({ make, model, year }) => {
    try {
      const data = await apiRequest<any>(`/makes/${encodeURIComponent(make)}/models/${encodeURIComponent(model)}/trims`, { year });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error listing trims: ${error instanceof Error ? error.message : "Unknown error"}`
          }
        ],
        isError: true
      };
    }
  }
);

// Tool: list_years
server.tool(
  "list_years",
  "Get a list of all years available for a specific make and optionally model.",
  {
    make: z.string().describe("Vehicle manufacturer"),
    model: z.string().optional().describe("Vehicle model name")
  },
  async ({ make, model }) => {
    try {
      const endpoint = model
        ? `/makes/${encodeURIComponent(make)}/models/${encodeURIComponent(model)}/years`
        : `/makes/${encodeURIComponent(make)}/years`;
      const data = await apiRequest<any>(endpoint);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error listing years: ${error instanceof Error ? error.message : "Unknown error"}`
          }
        ],
        isError: true
      };
    }
  }
);

// =============================================================================
// MANUAL CONTENT TOOLS
// =============================================================================

// Helper to find manual by vehicle
async function findManualId(year: number, make: string, model: string): Promise<string | null> {
  try {
    const query = `year=eq.${year}&make=ilike.${encodeURIComponent(make)}&model=ilike.%25${encodeURIComponent(model)}%25&select=id&limit=1`;
    const manuals = await supabaseRequest<Array<{ id: string }>>("vehicle_manuals", query);
    return manuals.length > 0 ? manuals[0].id : null;
  } catch {
    return null;
  }
}

// Tool: get_manual_content
server.tool(
  "get_manual_content",
  "Get the full owner's manual content for a vehicle in markdown format. Use this for comprehensive vehicle documentation. Returns structured content with table of contents.",
  {
    year: z.number().int().min(1990).max(2030).describe("Vehicle model year"),
    make: z.string().describe("Vehicle manufacturer (e.g., Toyota, Honda, Ford)"),
    model: z.string().describe("Vehicle model name (e.g., Camry, Accord, F-150)"),
    max_tokens: z.number().int().optional().describe("Maximum tokens to return (default: 8000). Use lower values for faster responses.")
  },
  async ({ year, make, model, max_tokens }) => {
    try {
      const manualId = await findManualId(year, make, model);
      if (!manualId) {
        return {
          content: [{ type: "text", text: `No manual found for ${year} ${make} ${model}` }],
          isError: true
        };
      }

      // Get full content
      const query = `manual_id=eq.${manualId}&select=content_markdown,table_of_contents,total_token_count,total_pages`;
      const content = await supabaseRequest<Array<{
        content_markdown: string;
        table_of_contents: any;
        total_token_count: number;
        total_pages: number;
      }>>("manual_content", query);

      if (content.length === 0) {
        return {
          content: [{ type: "text", text: `Manual found but content not yet extracted for ${year} ${make} ${model}` }],
          isError: true
        };
      }

      const manual = content[0];
      const tokenLimit = max_tokens || 8000;

      // Truncate if needed
      let markdown = manual.content_markdown;
      if (manual.total_token_count > tokenLimit) {
        const charLimit = tokenLimit * 4; // Approximate
        markdown = markdown.substring(0, charLimit) + "\n\n... [Content truncated. Use search_manual for specific topics]";
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            vehicle: `${year} ${make} ${model}`,
            total_pages: manual.total_pages,
            total_tokens: manual.total_token_count,
            table_of_contents: manual.table_of_contents,
            content: markdown
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error getting manual: ${error instanceof Error ? error.message : "Unknown error"}` }],
        isError: true
      };
    }
  }
);

// Tool: search_manual
server.tool(
  "search_manual",
  "Search within a vehicle's owner's manual for specific topics like 'tire pressure', 'oil change', 'warning lights', etc. Returns relevant sections with content.",
  {
    year: z.number().int().min(1990).max(2030).describe("Vehicle model year"),
    make: z.string().describe("Vehicle manufacturer"),
    model: z.string().describe("Vehicle model name"),
    query: z.string().describe("Search query (e.g., 'tire pressure', 'oil change', 'brake warning')"),
    max_sections: z.number().int().optional().describe("Maximum sections to return (default: 5)")
  },
  async ({ year, make, model, query, max_sections }) => {
    try {
      const manualId = await findManualId(year, make, model);
      if (!manualId) {
        return {
          content: [{ type: "text", text: `No manual found for ${year} ${make} ${model}` }],
          isError: true
        };
      }

      const limit = max_sections || 5;
      // Use full-text search with PostgREST
      const searchQuery = `manual_id=eq.${manualId}&or=(section_title.ilike.%25${encodeURIComponent(query)}%25,content_plain.ilike.%25${encodeURIComponent(query)}%25,keywords.cs.{${encodeURIComponent(query.toLowerCase())}})&select=section_path,section_title,content_markdown,token_count&limit=${limit}`;

      const sections = await supabaseRequest<Array<{
        section_path: string;
        section_title: string;
        content_markdown: string;
        token_count: number;
      }>>("manual_sections", searchQuery);

      if (sections.length === 0) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              vehicle: `${year} ${make} ${model}`,
              query,
              message: "No matching sections found. Try different search terms.",
              suggestions: ["Try broader terms", "Check spelling", "Use common automotive terms"]
            }, null, 2)
          }]
        };
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            vehicle: `${year} ${make} ${model}`,
            query,
            sections_found: sections.length,
            results: sections.map(s => ({
              path: s.section_path,
              title: s.section_title,
              tokens: s.token_count,
              content: s.content_markdown
            }))
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error searching manual: ${error instanceof Error ? error.message : "Unknown error"}` }],
        isError: true
      };
    }
  }
);

// Tool: get_manual_toc
server.tool(
  "get_manual_toc",
  "Get the table of contents for a vehicle's owner's manual. Use this to understand what topics are covered before retrieving specific sections.",
  {
    year: z.number().int().min(1990).max(2030).describe("Vehicle model year"),
    make: z.string().describe("Vehicle manufacturer"),
    model: z.string().describe("Vehicle model name")
  },
  async ({ year, make, model }) => {
    try {
      const manualId = await findManualId(year, make, model);
      if (!manualId) {
        return {
          content: [{ type: "text", text: `No manual found for ${year} ${make} ${model}` }],
          isError: true
        };
      }

      // Get sections overview
      const query = `manual_id=eq.${manualId}&select=section_path,section_title,depth,token_count&order=section_path`;
      const sections = await supabaseRequest<Array<{
        section_path: string;
        section_title: string;
        depth: number;
        token_count: number;
      }>>("manual_sections", query);

      if (sections.length === 0) {
        return {
          content: [{ type: "text", text: `Manual found but no sections extracted yet for ${year} ${make} ${model}` }],
          isError: true
        };
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            vehicle: `${year} ${make} ${model}`,
            total_sections: sections.length,
            total_tokens: sections.reduce((sum, s) => sum + (s.token_count || 0), 0),
            sections: sections.map(s => ({
              path: s.section_path,
              title: s.section_title,
              depth: s.depth,
              tokens: s.token_count
            }))
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error getting TOC: ${error instanceof Error ? error.message : "Unknown error"}` }],
        isError: true
      };
    }
  }
);

// Tool: get_manual_section
server.tool(
  "get_manual_section",
  "Get a specific section from a vehicle's owner's manual by section path. Use get_manual_toc first to find available section paths.",
  {
    year: z.number().int().min(1990).max(2030).describe("Vehicle model year"),
    make: z.string().describe("Vehicle manufacturer"),
    model: z.string().describe("Vehicle model name"),
    section_path: z.string().describe("Section path from table of contents (e.g., '1', '1.2', '3.1.4')")
  },
  async ({ year, make, model, section_path }) => {
    try {
      const manualId = await findManualId(year, make, model);
      if (!manualId) {
        return {
          content: [{ type: "text", text: `No manual found for ${year} ${make} ${model}` }],
          isError: true
        };
      }

      const query = `manual_id=eq.${manualId}&section_path=eq.${encodeURIComponent(section_path)}&select=section_path,section_title,content_markdown,token_count,page_start,page_end`;
      const sections = await supabaseRequest<Array<{
        section_path: string;
        section_title: string;
        content_markdown: string;
        token_count: number;
        page_start: number | null;
        page_end: number | null;
      }>>("manual_sections", query);

      if (sections.length === 0) {
        return {
          content: [{ type: "text", text: `Section '${section_path}' not found. Use get_manual_toc to see available sections.` }],
          isError: true
        };
      }

      const section = sections[0];
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            vehicle: `${year} ${make} ${model}`,
            section: {
              path: section.section_path,
              title: section.section_title,
              tokens: section.token_count,
              pages: section.page_start ? `${section.page_start}-${section.page_end}` : null,
              content: section.content_markdown
            }
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error getting section: ${error instanceof Error ? error.message : "Unknown error"}` }],
        isError: true
      };
    }
  }
);

// Tool: list_available_manuals
server.tool(
  "list_available_manuals",
  "List all owner's manuals available in the database, optionally filtered by make or year. Use this to check what manuals are available before requesting content.",
  {
    make: z.string().optional().describe("Filter by manufacturer (e.g., Toyota, Ford)"),
    year: z.number().int().optional().describe("Filter by model year"),
    limit: z.number().int().optional().describe("Maximum results (default: 50)")
  },
  async ({ make, year, limit }) => {
    try {
      const maxResults = limit || 50;
      let query = `select=year,make,model,variant,content_status&order=year.desc,make,model&limit=${maxResults}`;

      if (make) {
        query += `&make=ilike.${encodeURIComponent(make)}`;
      }
      if (year) {
        query += `&year=eq.${year}`;
      }
      // Only show manuals with extracted content
      query += `&content_status=eq.extracted`;

      const manuals = await supabaseRequest<Array<{
        year: number;
        make: string;
        model: string;
        variant: string | null;
        content_status: string;
      }>>("vehicle_manuals", query);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            total: manuals.length,
            manuals: manuals.map(m => ({
              year: m.year,
              make: m.make,
              model: m.model,
              variant: m.variant,
              status: m.content_status
            }))
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error listing manuals: ${error instanceof Error ? error.message : "Unknown error"}` }],
        isError: true
      };
    }
  }
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Car Intel MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
