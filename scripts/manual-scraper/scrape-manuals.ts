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

// Top 100 most popular vehicles (based on US market data and our database coverage)
const TOP_100_VEHICLES = [
  // Trucks
  { make: 'Ford', model: 'F-150' },
  { make: 'Chevrolet', model: 'Silverado 1500' },
  { make: 'RAM', model: '1500' },
  { make: 'GMC', model: 'Sierra 1500' },
  { make: 'Toyota', model: 'Tacoma' },
  { make: 'Ford', model: 'F-250' },
  { make: 'Ford', model: 'F-350' },
  { make: 'Chevrolet', model: 'Colorado' },
  { make: 'Ford', model: 'Ranger' },
  { make: 'Nissan', model: 'Titan' },

  // SUVs - Compact
  { make: 'Toyota', model: 'RAV4' },
  { make: 'Honda', model: 'CR-V' },
  { make: 'Nissan', model: 'Rogue' },
  { make: 'Ford', model: 'Escape' },
  { make: 'Chevrolet', model: 'Equinox' },
  { make: 'Jeep', model: 'Grand Cherokee' },
  { make: 'Jeep', model: 'Wrangler' },
  { make: 'Jeep', model: 'Cherokee' },
  { make: 'Mazda', model: 'CX-5' },
  { make: 'Subaru', model: 'Outback' },
  { make: 'Subaru', model: 'Forester' },
  { make: 'Hyundai', model: 'Tucson' },
  { make: 'Kia', model: 'Sportage' },
  { make: 'GMC', model: 'Terrain' },
  { make: 'Volkswagen', model: 'Tiguan' },

  // SUVs - Mid/Full Size
  { make: 'Ford', model: 'Explorer' },
  { make: 'Chevrolet', model: 'Tahoe' },
  { make: 'Chevrolet', model: 'Traverse' },
  { make: 'Toyota', model: 'Highlander' },
  { make: 'Toyota', model: '4Runner' },
  { make: 'Honda', model: 'Pilot' },
  { make: 'GMC', model: 'Yukon' },
  { make: 'Ford', model: 'Expedition' },
  { make: 'Chevrolet', model: 'Suburban' },
  { make: 'Dodge', model: 'Durango' },
  { make: 'Nissan', model: 'Pathfinder' },
  { make: 'Hyundai', model: 'Santa Fe' },
  { make: 'Kia', model: 'Sorento' },
  { make: 'Mazda', model: 'CX-9' },
  { make: 'Subaru', model: 'Ascent' },

  // Sedans
  { make: 'Toyota', model: 'Camry' },
  { make: 'Honda', model: 'Civic' },
  { make: 'Honda', model: 'Accord' },
  { make: 'Toyota', model: 'Corolla' },
  { make: 'Nissan', model: 'Altima' },
  { make: 'Hyundai', model: 'Sonata' },
  { make: 'Hyundai', model: 'Elantra' },
  { make: 'Kia', model: 'Optima' },
  { make: 'Kia', model: 'K5' },
  { make: 'Mazda', model: 'Mazda3' },
  { make: 'Mazda', model: 'Mazda6' },
  { make: 'Subaru', model: 'Impreza' },
  { make: 'Subaru', model: 'Legacy' },
  { make: 'Volkswagen', model: 'Jetta' },
  { make: 'Volkswagen', model: 'Passat' },
  { make: 'Nissan', model: 'Sentra' },
  { make: 'Nissan', model: 'Maxima' },
  { make: 'Ford', model: 'Fusion' },
  { make: 'Chevrolet', model: 'Malibu' },
  { make: 'Chevrolet', model: 'Cruze' },

  // Luxury
  { make: 'BMW', model: '3 Series' },
  { make: 'BMW', model: '5 Series' },
  { make: 'BMW', model: 'X3' },
  { make: 'BMW', model: 'X5' },
  { make: 'Mercedes-Benz', model: 'C-Class' },
  { make: 'Mercedes-Benz', model: 'E-Class' },
  { make: 'Mercedes-Benz', model: 'GLC' },
  { make: 'Mercedes-Benz', model: 'GLE' },
  { make: 'Audi', model: 'A4' },
  { make: 'Audi', model: 'Q5' },
  { make: 'Lexus', model: 'RX' },
  { make: 'Lexus', model: 'ES' },
  { make: 'Lexus', model: 'NX' },
  { make: 'Acura', model: 'MDX' },
  { make: 'Acura', model: 'RDX' },
  { make: 'Infiniti', model: 'QX60' },
  { make: 'Cadillac', model: 'Escalade' },
  { make: 'Lincoln', model: 'Navigator' },
  { make: 'Volvo', model: 'XC90' },
  { make: 'Volvo', model: 'XC60' },

  // Minivans
  { make: 'Honda', model: 'Odyssey' },
  { make: 'Toyota', model: 'Sienna' },
  { make: 'Chrysler', model: 'Pacifica' },
  { make: 'Dodge', model: 'Grand Caravan' },
  { make: 'Kia', model: 'Carnival' },

  // Sports/Muscle
  { make: 'Ford', model: 'Mustang' },
  { make: 'Chevrolet', model: 'Camaro' },
  { make: 'Dodge', model: 'Challenger' },
  { make: 'Dodge', model: 'Charger' },
  { make: 'Chevrolet', model: 'Corvette' },

  // Electric/Hybrid
  { make: 'Tesla', model: 'Model 3' },
  { make: 'Tesla', model: 'Model Y' },
  { make: 'Tesla', model: 'Model S' },
  { make: 'Tesla', model: 'Model X' },
  { make: 'Toyota', model: 'Prius' },
  { make: 'Chevrolet', model: 'Bolt' },
  { make: 'Ford', model: 'Mach-E' },
  { make: 'Hyundai', model: 'Ioniq' },

  // Compact Cars
  { make: 'Honda', model: 'Fit' },
  { make: 'Toyota', model: 'Yaris' },
  { make: 'Kia', model: 'Soul' },
  { make: 'Hyundai', model: 'Kona' },
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

    result.manuals.push({
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
    });

    const mismatchWarning = yearMismatch ? ` ⚠️ PDF is from ${pdfYear}` : '';
    console.log(`   ✅ ${listing.year}: ${pdfFilename} (${fileSize ? `${(fileSize / 1024 / 1024).toFixed(1)}MB` : 'unknown size'})${mismatchWarning}`);
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
  const downloadMode = args.includes('--download');
  const syncMode = args.includes('--sync');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : TOP_100_VEHICLES.length;
  const makeArg = args.find(a => a.startsWith('--make='));
  const filterMake = makeArg ? makeArg.split('=')[1] : null;

  let vehicles = TOP_100_VEHICLES.slice(0, limit);
  if (filterMake) {
    vehicles = vehicles.filter(v => v.make.toLowerCase() === filterMake.toLowerCase());
  }

  console.log(`📊 Processing ${vehicles.length} vehicles`);
  console.log(`📅 Years: ${MIN_YEAR} - ${MAX_YEAR}`);
  console.log(`⏱️  Delay between requests: ${DELAY_BETWEEN_REQUESTS}ms`);
  if (downloadMode) {
    console.log(`📥 Download mode enabled - saving to ${DOWNLOAD_DIR}`);
  }
  if (syncMode) {
    console.log(`🔄 Sync mode enabled - will save to database`);
  }

  // Scrape each vehicle
  for (const vehicle of vehicles) {
    const result = await scrapeVehicle(vehicle.make, vehicle.model);
    allResults.push(result);
    allManuals.push(...result.manuals);

    // Add delay between vehicles
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

  // Download and upload PDFs if requested
  if (downloadMode && allManuals.length > 0) {
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;
    const shouldUpload = !!serviceKey;

    console.log('\n📥 Starting PDF downloads...');
    if (shouldUpload) {
      console.log('📤 Will upload to Supabase Storage');
    }
    await fs.mkdir(DOWNLOAD_DIR, { recursive: true });

    // Initialize Supabase client for uploads
    let supabase: any = null;
    if (shouldUpload) {
      const { createClient } = await import('@supabase/supabase-js');
      supabase = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } });
    }

    let downloaded = 0;
    let uploaded = 0;
    for (const manual of allManuals) {
      // Local filename for download
      const filename = `${manual.year}-${toUrlSlug(manual.make)}-${toUrlSlug(manual.model)}${manual.variant ? '-' + manual.variant : ''}.pdf`;
      const outputPath = `${DOWNLOAD_DIR}/${filename}`;

      // Storage path: {make}/{model}/{year}-{make}-{model}[-variant].pdf
      const storagePath = `${toUrlSlug(manual.make)}/${toUrlSlug(manual.model)}/${filename}`;

      console.log(`   Downloading ${filename}...`);
      const success = await downloadPdf(manual.pdfUrl, outputPath);
      if (success) {
        downloaded++;
        console.log(`   ✅ Downloaded (${downloaded}/${allManuals.length})`);

        // Upload to Supabase Storage
        if (shouldUpload && supabase) {
          try {
            const fileBuffer = await fs.readFile(outputPath);
            const { error: uploadError } = await supabase.storage
              .from('vehicle_manuals')
              .upload(storagePath, fileBuffer, {
                contentType: 'application/pdf',
                upsert: true
              });

            if (uploadError) {
              console.error(`   ⚠️  Upload failed: ${uploadError.message}`);
            } else {
              uploaded++;
              // Store the storage path in the manual object for sync
              (manual as any).storagePath = storagePath;
              console.log(`   📤 Uploaded to ${storagePath}`);
            }
          } catch (err) {
            console.error(`   ⚠️  Upload error:`, err);
          }
        }
      }

      await delay(DELAY_BETWEEN_REQUESTS);
    }

    console.log(`\n✅ Downloaded ${downloaded}/${allManuals.length} PDFs to ${DOWNLOAD_DIR}`);
    if (shouldUpload) {
      console.log(`📤 Uploaded ${uploaded}/${downloaded} to Supabase Storage`);
    }
  }

  // Sync to database if requested
  if (syncMode && allManuals.length > 0) {
    const { syncToDatabase } = await import('./sync-manuals.js');
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;
    if (!serviceKey) {
      console.error('\n❌ SUPABASE_SERVICE_KEY required for --sync mode');
      console.error('   Set it with: export SUPABASE_SERVICE_KEY="your-service-role-key"');
    } else {
      console.log('\n');
      const { inserted, errors } = await syncToDatabase(outputData, serviceKey);
      console.log(`\n✅ Synced ${inserted} manuals to database (${errors} errors)`);

      const mismatches = allManuals.filter(m => m.yearMismatch).length;
      if (mismatches > 0) {
        console.log(`⚠️  ${mismatches} manuals have year mismatches (placeholder PDFs)`);
      }
    }
  }
}

// Run the scraper
main().catch(console.error);
