#!/usr/bin/env npx tsx

/**
 * Upload downloaded PDFs to Supabase Storage
 *
 * Reads PDFs from the manuals/ directory and uploads them to Supabase Storage,
 * updating the vehicle_manuals table with the storage path
 */

import { createClient } from '@supabase/supabase-js';
import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jxpbnnmefwtazfvoxvge.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const MANUALS_DIR = process.env.MANUALS_DIR || './manuals';
const BUCKET_NAME = 'vehicle-manuals';

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_KEY environment variable is required');
  process.exit(1);
}

/**
 * Parse filename to extract vehicle info
 * Format: {year}-{make}-{model}[-{variant}].pdf
 */
function parseFilename(filename: string): { year: number; make: string; model: string; variant?: string } | null {
  const match = filename.match(/^(\d{4})-([^-]+)-(.+)\.pdf$/i);
  if (!match) return null;

  const [, yearStr, make, rest] = match;
  const year = parseInt(yearStr);

  // Check for common variants at the end
  const variants = ['sedan', 'coupe', 'hatchback', 'hybrid', 'convertible', 'wagon', 'lightning'];
  let model = rest;
  let variant: string | undefined;

  for (const v of variants) {
    if (rest.toLowerCase().endsWith(`-${v}`)) {
      model = rest.slice(0, -(v.length + 1));
      variant = v;
      break;
    }
  }

  return {
    year,
    make: make.replace(/-/g, ' '),
    model: model.replace(/-/g, ' '),
    variant
  };
}

async function main() {
  console.log('📤 Uploading PDFs to Supabase Storage...\n');

  // Connect to Supabase
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY!, {
    auth: { persistSession: false }
  });

  // Ensure bucket exists
  const { data: buckets } = await supabase.storage.listBuckets();
  const bucketExists = buckets?.some(b => b.name === BUCKET_NAME);

  if (!bucketExists) {
    console.log(`📦 Creating storage bucket: ${BUCKET_NAME}`);
    const { error } = await supabase.storage.createBucket(BUCKET_NAME, {
      public: true,
      fileSizeLimit: 100 * 1024 * 1024 // 100MB max
    });
    if (error) {
      console.error('❌ Failed to create bucket:', error);
      process.exit(1);
    }
  }

  // List PDF files
  let files: string[];
  try {
    files = (await readdir(MANUALS_DIR)).filter(f => f.endsWith('.pdf'));
  } catch {
    console.error(`❌ Failed to read directory: ${MANUALS_DIR}`);
    console.error('   Make sure you have downloaded PDFs first with: npm run scrape:download');
    process.exit(1);
  }

  if (files.length === 0) {
    console.log('📭 No PDF files found to upload');
    return;
  }

  console.log(`📂 Found ${files.length} PDF files to upload\n`);

  let uploaded = 0;
  let skipped = 0;
  let errors = 0;

  for (const filename of files) {
    const parsed = parseFilename(filename);
    if (!parsed) {
      console.log(`⚠️  Skipping ${filename} - couldn't parse filename`);
      skipped++;
      continue;
    }

    const filePath = join(MANUALS_DIR, filename);
    const fileInfo = await stat(filePath);
    const storagePath = `${parsed.year}/${parsed.make.toLowerCase().replace(/ /g, '-')}/${filename}`;

    console.log(`📤 Uploading ${filename} (${(fileInfo.size / 1024 / 1024).toFixed(1)}MB)...`);

    try {
      // Read file
      const fileBuffer = await readFile(filePath);

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(storagePath, fileBuffer, {
          contentType: 'application/pdf',
          upsert: true
        });

      if (uploadError) {
        console.error(`   ❌ Upload failed:`, uploadError.message);
        errors++;
        continue;
      }

      // Update database record
      const { error: dbError } = await supabase
        .from('vehicle_manuals')
        .update({
          pdf_storage_path: storagePath,
          status: 'uploaded',
          pdf_size_bytes: fileInfo.size
        })
        .eq('year', parsed.year)
        .ilike('make', parsed.make)
        .ilike('model', `%${parsed.model}%`)
        .eq('variant', parsed.variant || null);

      if (dbError) {
        console.warn(`   ⚠️  Uploaded but failed to update DB:`, dbError.message);
      }

      console.log(`   ✅ Uploaded to ${storagePath}`);
      uploaded++;

    } catch (error) {
      console.error(`   ❌ Error:`, error);
      errors++;
    }
  }

  console.log('\n📊 UPLOAD SUMMARY');
  console.log('=================');
  console.log(`✅ Uploaded: ${uploaded}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`❌ Errors: ${errors}`);

  if (uploaded > 0) {
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}`;
    console.log(`\n🔗 Public base URL: ${publicUrl}`);
  }
}

main().catch(console.error);
