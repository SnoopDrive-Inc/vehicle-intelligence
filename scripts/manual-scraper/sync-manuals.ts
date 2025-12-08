#!/usr/bin/env npx tsx

import 'dotenv/config';

/**
 * Sync scraped manuals to Supabase database
 *
 * Reads the scraped results JSON and inserts/updates records in the vehicle_manuals table
 */

import { createClient } from '@supabase/supabase-js';
import { readFile } from 'fs/promises';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jxpbnnmefwtazfvoxvge.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_KEY environment variable is required');
  console.error('   Set it with: export SUPABASE_SERVICE_KEY="your-service-role-key"');
  process.exit(1);
}

interface ManualInfo {
  year: number;
  make: string;
  model: string;
  variant?: string;
  manualUrl: string;
  pdfUrl: string;
  mid: string;
  fileSize?: number;
  pdfYear?: number;
  yearMismatch?: boolean;
  storagePath?: string; // Set after upload to Supabase Storage
}

interface ScrapeResults {
  scrapedAt: string;
  vehiclesProcessed: number;
  manualsFound: number;
  totalSizeBytes: number;
  manuals: ManualInfo[];
}

export async function syncToDatabase(results: ScrapeResults, serviceKey?: string): Promise<{ inserted: number; errors: number }> {
  const key = serviceKey || SUPABASE_SERVICE_KEY;
  if (!key) {
    throw new Error('SUPABASE_SERVICE_KEY is required');
  }

  console.log('🔄 Syncing manuals to Supabase database...\n');
  console.log(`📊 Found ${results.manualsFound} manuals from ${results.vehiclesProcessed} vehicles`);

  const supabase = createClient(SUPABASE_URL, key, {
    auth: { persistSession: false }
  });

  let inserted = 0;
  let errors = 0;

  for (const manual of results.manuals) {
    const record = {
      year: manual.year,
      make: manual.make,
      model: manual.model,
      variant: manual.variant || null,
      source_url: manual.manualUrl,
      source_mid: manual.mid,
      pdf_url: manual.pdfUrl,
      pdf_size_bytes: manual.fileSize || null,
      pdf_year: manual.pdfYear || null,
      year_mismatch: manual.yearMismatch || false,
      pdf_storage_path: manual.storagePath || null,
      status: manual.storagePath ? 'uploaded' : 'discovered',
      last_verified_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from('vehicle_manuals')
      .upsert(record, {
        onConflict: 'year,make,model,variant',
        ignoreDuplicates: false
      });

    if (error) {
      console.error(`❌ Error: ${manual.year} ${manual.make} ${manual.model}: ${error.message}`);
      errors++;
    } else {
      const mismatchNote = manual.yearMismatch ? ` ⚠️ mismatch (PDF: ${manual.pdfYear})` : '';
      console.log(`✅ ${manual.year} ${manual.make} ${manual.model}${manual.variant ? ` (${manual.variant})` : ''}${mismatchNote}`);
      inserted++;
    }
  }

  return { inserted, errors };
}

async function main() {
  // Read scraped results
  const resultsPath = process.argv[2] || 'manual-scrape-results.json';

  let results: ScrapeResults;
  try {
    const data = await readFile(resultsPath, 'utf-8');
    results = JSON.parse(data);
  } catch (error) {
    console.error(`❌ Failed to read ${resultsPath}:`, error);
    console.error('   Run "npm run scrape" first to generate results');
    process.exit(1);
  }

  console.log(`📅 Scraped at: ${results.scrapedAt}\n`);

  const { inserted, errors } = await syncToDatabase(results);

  console.log('\n📊 SYNC SUMMARY');
  console.log('===============');
  console.log(`✅ Synced: ${inserted}`);
  console.log(`❌ Errors: ${errors}`);

  const mismatches = results.manuals.filter(m => m.yearMismatch).length;
  if (mismatches > 0) {
    console.log(`⚠️  Year mismatches: ${mismatches}`);
  }
}

// Only run main if this file is executed directly (not imported)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch(console.error);
}
