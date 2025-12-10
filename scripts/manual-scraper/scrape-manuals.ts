#!/usr/bin/env npx tsx

import 'dotenv/config';

/**
 * Manual Directory Scraper for CarIntel
 *
 * Scrapes owner's manuals from manual-directory.com and downloads PDFs from gimmemanuals.com
 *
 * Flow:
 * 1. Get vehicle list from Supabase (top 100 by trim count, 2000+)
 * 2. For each vehicle, check manual-directory.com for available manuals
 * 3. Extract the manual ID (mid) from each year's manual page
 * 4. Use the mid to get the PDF URL from gimmemanuals.com
 * 5. Download PDF and store metadata in Supabase
 */

import { createClient } from '@supabase/supabase-js';

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jxpbnnmefwtazfvoxvge.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || './manuals';
const CONCURRENT_DOWNLOADS = parseInt(process.env.CONCURRENT_DOWNLOADS || '3');
const DELAY_BETWEEN_REQUESTS = parseInt(process.env.DELAY_MS || '1000');

// Model name mapping from our database names to manual-directory.com URL slugs
// Format: { "database_make|database_model": { make: "url_make", model: "url_model" } }
const MODEL_URL_MAPPING: Record<string, { make: string; model: string }> = {
  // Trucks with different naming
  'chevrolet|silverado 1500': { make: 'chevrolet', model: 'silverado' },
  'chevrolet|silverado 2500': { make: 'chevrolet', model: 'silverado' },
  'chevrolet|silverado 3500': { make: 'chevrolet', model: 'silverado' },
  'gmc|sierra 1500': { make: 'gmc', model: 'sierra' },
  'gmc|sierra 2500': { make: 'gmc', model: 'sierra' },
  'gmc|sierra 3500': { make: 'gmc', model: 'sierra' },
  'ram|1500': { make: 'dodge', model: 'ram' },
  'ram|2500': { make: 'dodge', model: 'ram' },
  'ram|3500': { make: 'dodge', model: 'ram' },
  // SUVs
  'chevrolet|suburban 1500': { make: 'chevrolet', model: 'suburban' },
  'chevrolet|suburban 2500': { make: 'chevrolet', model: 'suburban' },
  // Luxury with numbers
  'bmw|3 series': { make: 'bmw', model: '3-series' },
  'bmw|5 series': { make: 'bmw', model: '5-series' },
  'mercedes-benz|c-class': { make: 'mercedes', model: 'c-class' },
  'mercedes-benz|e-class': { make: 'mercedes', model: 'e-class' },
  'mercedes-benz|glc': { make: 'mercedes', model: 'glc' },
  'mercedes-benz|gle': { make: 'mercedes', model: 'gle' },
};

// All manufacturers from manual-directory.com in order
const ALL_MANUFACTURERS = [
  'Acura', 'Alfa Romeo', 'Audi', 'BMW', 'Buick', 'Cadillac', 'Chevrolet',
  'Chrysler', 'Dodge', 'Fiat', 'Ford', 'GMC', 'Honda', 'Hyundai', 'Infiniti',
  'Jaguar', 'Jeep', 'Kia', 'Land Rover', 'Lexus', 'Lincoln', 'Maserati',
  'Mazda', 'Mercedes', 'Mercury', 'Mini', 'Mitsubishi', 'Nissan', 'Polestar',
  'Pontiac', 'Porsche', 'Rivian', 'Saab', 'Smart', 'Subaru', 'Suzuki',
  'Tesla', 'Toyota', 'Volkswagen', 'Volvo'
];

// Legacy list for --legacy mode
const TOP_100_VEHICLES = [
  { make: 'Ford', model: 'F-150' },
  { make: 'Chevrolet', model: 'Silverado' },
  { make: 'Toyota', model: 'Camry' },
  { make: 'Honda', model: 'Civic' },
  { make: 'Toyota', model: 'RAV4' },
];

// Years to scrape (2000 and newer)
const MIN_YEAR = 2000;
const MAX_YEAR = 2025;

interface ManualInfo {
  year: number;
  make: string;
  model: string;
  variant?: string;
  manualUrl: string;
  pdfUrl: string;
  mid: string;
  fileSize?: number;
  pdfYear?: number; // Actual year from PDF filename
  yearMismatch?: boolean; // True if PDF year doesn't match listed year
}

interface ScrapeResult {
  vehicle: { make: string; model: string };
  manuals: ManualInfo[];
  errors: string[];
}

/**
 * Convert make/model to URL slug format
 */
function toUrlSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Delay execution
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with retry and error handling
 */
async function fetchWithRetry(url: string, retries = 3): Promise<string | null> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        }
      });

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.text();
    } catch (error) {
      if (i === retries - 1) {
        console.error(`Failed to fetch ${url}:`, error);
        return null;
      }
      await delay(1000 * (i + 1));
    }
  }
  return null;
}

/**
 * Get URL-friendly make/model for manual-directory.com
 */
function getUrlMakeModel(make: string, model: string): { makeSlug: string; modelSlug: string } {
  const key = `${make.toLowerCase()}|${model.toLowerCase()}`;
  const mapping = MODEL_URL_MAPPING[key];

  if (mapping) {
    return {
      makeSlug: toUrlSlug(mapping.make),
      modelSlug: toUrlSlug(mapping.model)
    };
  }

  return {
    makeSlug: toUrlSlug(make),
    modelSlug: toUrlSlug(model)
  };
}

/**
 * Get all models for a manufacturer from manual-directory.com
 */
async function getModelsForMake(make: string): Promise<string[]> {
  const makeSlug = toUrlSlug(make);
  const url = `https://manual-directory.com/cars/${makeSlug}/`;

  const html = await fetchWithRetry(url);
  if (!html) return [];

  const models: string[] = [];

  // Match model links like: href="https://manual-directory.com/cars/ford/f-150/"
  const linkRegex = new RegExp(`href="https://manual-directory\\.com/cars/${makeSlug}/([^/"]+)/"`, 'g');
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    const modelSlug = match[1];
    // Convert slug back to display name (e.g., "f-150" -> "F-150")
    const modelName = modelSlug.split('-').map(word =>
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join('-');

    if (!models.includes(modelName)) {
      models.push(modelName);
    }
  }

  return models;
}

/**
 * Extract manual IDs from model listing page
 */
async function getManualListingsForModel(make: string, model: string): Promise<Array<{ year: number; slug: string; variant?: string }>> {
  const { makeSlug, modelSlug } = getUrlMakeModel(make, model);
  const url = `https://manual-directory.com/cars/${makeSlug}/${modelSlug}/`;

  const html = await fetchWithRetry(url);
  if (!html) return [];

  const manuals: Array<{ year: number; slug: string; variant?: string }> = [];

  // Match manual links like: href="https://manual-directory.com/manual/2024-ford-f-150-owners-manual/"
  const linkRegex = /href="https:\/\/manual-directory\.com\/manual\/(\d{4})-([^/]+)-owners-manual\/"/g;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    const year = parseInt(match[1]);
    const slug = match[2];

    if (year >= MIN_YEAR && year <= MAX_YEAR) {
      // Check if this is a variant (like sedan, coupe, hatchback)
      const expectedBase = `${makeSlug}-${modelSlug}`;
      let variant: string | undefined;

      if (slug.startsWith(expectedBase) && slug.length > expectedBase.length) {
        variant = slug.slice(expectedBase.length + 1);
      }

      // Avoid duplicates
      const existing = manuals.find(m => m.year === year && m.slug === slug);
      if (!existing) {
        manuals.push({ year, slug, variant });
      }
    }
  }

  return manuals.sort((a, b) => b.year - a.year);
}

/**
 * Extract manual ID (mid) from individual manual page
 */
async function getManualId(manualSlug: string): Promise<string | null> {
  const url = `https://manual-directory.com/manual/${manualSlug}/`;
  const html = await fetchWithRetry(url);
  if (!html) return null;

  // Look for: <input type="hidden" name="mid" value="30407" />
  const midMatch = html.match(/name="mid"\s+value="(\d+)"/);
  return midMatch ? midMatch[1] : null;
}

/**
 * Get PDF URL from manual ID
 */
async function getPdfUrl(mid: string): Promise<string | null> {
  const url = `https://manual-directory.com/view-manual-pdf/?mid=${mid}`;
  const html = await fetchWithRetry(url);
  if (!html) return null;

  // Look for gimmemanuals PDF URL in the viewer
  const pdfMatch = html.match(/gimmemanuals\.com[^"]+\.pdf/);
  if (pdfMatch) {
    // URL decode if needed
    let pdfUrl = decodeURIComponent(pdfMatch[0]);
    if (!pdfUrl.startsWith('http')) {
      pdfUrl = 'https://' + pdfUrl;
    }
    return pdfUrl;
  }

  return null;
}

/**
 * Get PDF file size without downloading
 */
async function getPdfFileSize(pdfUrl: string): Promise<number | null> {
  try {
    const response = await fetch(pdfUrl, { method: 'HEAD' });
    if (!response.ok) return null;

    const contentLength = response.headers.get('content-length');
    return contentLength ? parseInt(contentLength) : null;
  } catch {
    return null;
  }
}

// Global Supabase client for immediate uploads
let supabaseClient: any = null;
let downloadModeEnabled = false;
let syncModeEnabled = false;

async function initSupabase() {
  if (!supabaseClient && process.env.SUPABASE_SERVICE_KEY) {
    const { createClient } = await import('@supabase/supabase-js');
    supabaseClient = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false }
    });
  }
  return supabaseClient;
}

/**
 * Download, upload, and sync a single manual immediately
 */
async function processManualImmediately(manual: ManualInfo): Promise<boolean> {
  const fs = await import('fs/promises');
  await fs.mkdir(DOWNLOAD_DIR, { recursive: true });

  const filename = `${manual.year}-${toUrlSlug(manual.make)}-${toUrlSlug(manual.model)}${manual.variant ? '-' + toUrlSlug(manual.variant) : ''}.pdf`;
  const outputPath = `${DOWNLOAD_DIR}/${filename}`;
  const storagePath = `${toUrlSlug(manual.make)}/${toUrlSlug(manual.model)}/${filename}`;

  // Download
  const downloaded = await downloadPdf(manual.pdfUrl, outputPath);
  if (!downloaded) {
    console.log(`      ❌ Download failed`);
    return false;
  }

  // Upload to Supabase Storage
  const supabase = await initSupabase();
  if (supabase) {
    try {
      const fileBuffer = await fs.readFile(outputPath);
      const { error: uploadError } = await supabase.storage
        .from('vehicle_manuals')
        .upload(storagePath, fileBuffer, {
          contentType: 'application/pdf',
          upsert: true
        });

      if (uploadError) {
        console.log(`      ⚠️ Upload failed: ${uploadError.message}`);
      } else {
        (manual as any).storagePath = storagePath;
        console.log(`      📤 Uploaded`);
      }
    } catch (err: any) {
      console.log(`      ⚠️ Upload error: ${err.message}`);
    }

    // Sync to database
    if (syncModeEnabled) {
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
        pdf_storage_path: (manual as any).storagePath || null,
        status: (manual as any).storagePath ? 'uploaded' : 'discovered',
        last_verified_at: new Date().toISOString()
      };

      const { error: dbError } = await supabase
        .from('vehicle_manuals')
        .upsert(record, {
          onConflict: 'year,make,model,variant',
          ignoreDuplicates: false
        });

      if (dbError) {
        console.log(`      ⚠️ DB sync failed: ${dbError.message}`);
      } else {
        console.log(`      💾 Synced to DB`);
      }
    }
  }

  return true;
}

/**
 * Scrape manuals for a single vehicle
 */
async function scrapeVehicle(make: string, model: string): Promise<ScrapeResult> {
  const result: ScrapeResult = {
    vehicle: { make, model },
    manuals: [],
    errors: []
  };

  console.log(`\n📚 Scraping ${make} ${model}...`);

  // Get all manual listings for this model
  const listings = await getManualListingsForModel(make, model);

  if (listings.length === 0) {
    result.errors.push(`No manuals found for ${make} ${model}`);
    console.log(`   ❌ No manuals found`);
    return result;
  }

  console.log(`   📋 Found ${listings.length} manual listings`);

  // Process each listing
  for (const listing of listings) {
    await delay(DELAY_BETWEEN_REQUESTS);

    const slug = `${listing.year}-${listing.slug}-owners-manual`;
    console.log(`   🔍 Processing ${listing.year}${listing.variant ? ` (${listing.variant})` : ''}...`);

    // Get manual ID
    const mid = await getManualId(slug);
    if (!mid) {
      result.errors.push(`Could not get manual ID for ${slug}`);
      continue;
    }

    await delay(DELAY_BETWEEN_REQUESTS);

    // Get PDF URL
    const pdfUrl = await getPdfUrl(mid);
    if (!pdfUrl) {
      result.errors.push(`Could not get PDF URL for mid=${mid}`);
      continue;
    }

    // Get file size
    const fileSize = await getPdfFileSize(pdfUrl);

    // Extract year from PDF filename to detect mismatches
    // Look for years 2000-2030 at the start of filename or after common prefixes
    const pdfFilename = pdfUrl.split('/').pop() || '';
    const pdfYearMatch = pdfFilename.match(/(?:^|[-_])?(20[0-3]\d)(?:[-_]|$)/);
    const pdfYear = pdfYearMatch ? parseInt(pdfYearMatch[1]) : undefined;
    const yearMismatch = pdfYear !== undefined && pdfYear !== listing.year;

    const manual: ManualInfo = {
      year: listing.year,
      make,
      model,
      variant: listing.variant,
      manualUrl: `https://manual-directory.com/manual/${slug}/`,
      pdfUrl,
      mid,
      fileSize: fileSize || undefined,
      pdfYear,
      yearMismatch
    };

    result.manuals.push(manual);

    const mismatchWarning = yearMismatch ? ` ⚠️ PDF is from ${pdfYear}` : '';
    console.log(`      ✅ Found: ${pdfFilename} (${fileSize ? `${(fileSize / 1024 / 1024).toFixed(1)}MB` : '?'})${mismatchWarning}`);

    // Immediately download, upload, and sync if in download mode
    if (downloadModeEnabled) {
      await processManualImmediately(manual);
    }
  }

  return result;
}

/**
 * Download a PDF file
 */
async function downloadPdf(pdfUrl: string, outputPath: string): Promise<boolean> {
  try {
    const response = await fetch(pdfUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const buffer = await response.arrayBuffer();
    const fs = await import('fs/promises');
    await fs.writeFile(outputPath, Buffer.from(buffer));
    return true;
  } catch (error) {
    console.error(`Failed to download ${pdfUrl}:`, error);
    return false;
  }
}

/**
 * Main scraping function
 */
async function main() {
  console.log('🚗 CarIntel Manual Directory Scraper');
  console.log('=====================================\n');

  const allResults: ScrapeResult[] = [];
  const allManuals: ManualInfo[] = [];

  // Parse command line args
  const args = process.argv.slice(2);
  downloadModeEnabled = args.includes('--download');
  syncModeEnabled = args.includes('--sync');
  const makeArg = args.find(a => a.startsWith('--make='));
  const filterMake = makeArg ? makeArg.split('=')[1] : null;
  const skipMakesArg = args.find(a => a.startsWith('--skip-makes='));
  const skipMakes = skipMakesArg ? skipMakesArg.split('=')[1].split(',').map(m => m.toLowerCase()) : [];

  console.log(`📅 Years: ${MIN_YEAR} - ${MAX_YEAR}`);
  console.log(`⏱️  Delay between requests: ${DELAY_BETWEEN_REQUESTS}ms`);
  if (downloadModeEnabled) {
    console.log(`📥 Download mode enabled - immediate upload to Supabase`);
  }
  if (syncModeEnabled) {
    console.log(`🔄 Sync mode enabled - immediate database sync`);
  }

  // Determine which manufacturers to process
  let manufacturers = filterMake ? [filterMake] : ALL_MANUFACTURERS;
  if (skipMakes.length > 0) {
    manufacturers = manufacturers.filter(m => !skipMakes.includes(m.toLowerCase()));
  }

  console.log(`\n🏭 Processing ${manufacturers.length} manufacturers\n`);

  // Process each manufacturer
  for (const make of manufacturers) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🏭 ${make.toUpperCase()}`);
    console.log('='.repeat(50));

    // Get all models for this manufacturer
    const models = await getModelsForMake(make);
    if (models.length === 0) {
      console.log(`   ❌ No models found for ${make}`);
      continue;
    }

    console.log(`   📋 Found ${models.length} models: ${models.slice(0, 5).join(', ')}${models.length > 5 ? '...' : ''}`);

    // Scrape each model
    for (const model of models) {
      const result = await scrapeVehicle(make, model);
      allResults.push(result);
      allManuals.push(...result.manuals);

      // Add delay between models
      await delay(DELAY_BETWEEN_REQUESTS);
    }

    // Add delay between manufacturers
    await delay(DELAY_BETWEEN_REQUESTS * 2);
  }

  // Summary
  console.log('\n\n📊 SUMMARY');
  console.log('==========');
  console.log(`Total vehicles processed: ${allResults.length}`);
  console.log(`Total manuals found: ${allManuals.length}`);

  const totalSize = allManuals.reduce((sum, m) => sum + (m.fileSize || 0), 0);
  console.log(`Total PDF size: ${(totalSize / 1024 / 1024 / 1024).toFixed(2)} GB`);

  const errors = allResults.flatMap(r => r.errors);
  if (errors.length > 0) {
    console.log(`\n⚠️  Errors encountered: ${errors.length}`);
    errors.slice(0, 10).forEach(e => console.log(`   - ${e}`));
    if (errors.length > 10) {
      console.log(`   ... and ${errors.length - 10} more`);
    }
  }

  // Output JSON results
  const outputData = {
    scrapedAt: new Date().toISOString(),
    vehiclesProcessed: allResults.length,
    manualsFound: allManuals.length,
    totalSizeBytes: totalSize,
    manuals: allManuals
  };

  const fs = await import('fs/promises');
  await fs.writeFile('manual-scrape-results.json', JSON.stringify(outputData, null, 2));
  console.log('\n💾 Results saved to manual-scrape-results.json');

  // Count uploads and syncs
  const uploaded = allManuals.filter(m => (m as any).storagePath).length;
  if (downloadModeEnabled) {
    console.log(`\n📤 Uploaded ${uploaded}/${allManuals.length} PDFs to Supabase Storage`);
  }
  if (syncModeEnabled) {
    console.log(`💾 Synced ${uploaded} manuals to database`);
  }

  const mismatches = allManuals.filter(m => m.yearMismatch).length;
  if (mismatches > 0) {
    console.log(`⚠️  ${mismatches} manuals have year mismatches (placeholder PDFs)`);
  }
}

// Run the scraper
main().catch(console.error);
