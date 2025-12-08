#!/usr/bin/env npx tsx

import 'dotenv/config';

/**
 * Reorganize storage files into folder structure:
 * vehicle_manuals/{make}/{model}/{year}[-variant].pdf
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://jxpbnnmefwtazfvoxvge.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET_NAME = 'vehicle_manuals';

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_KEY required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

function toSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function reorganizeStorage() {
  console.log('🗂️  Reorganizing storage files...\n');

  // Get all manuals from database
  const { data: manuals, error } = await supabase
    .from('vehicle_manuals')
    .select('id, year, make, model, variant, pdf_storage_path')
    .not('pdf_storage_path', 'is', null);

  if (error) {
    console.error('Error fetching manuals:', error);
    return;
  }

  console.log(`Found ${manuals.length} manuals to reorganize\n`);

  for (const manual of manuals) {
    const oldPath = manual.pdf_storage_path;

    // Build new path: {make}/{model}/{year}-{make}-{model}[-variant].pdf
    const makeSlug = toSlug(manual.make);
    const modelSlug = toSlug(manual.model);
    const variantSuffix = manual.variant ? `-${toSlug(manual.variant)}` : '';
    const filename = `${manual.year}-${makeSlug}-${modelSlug}${variantSuffix}.pdf`;
    const newPath = `${makeSlug}/${modelSlug}/${filename}`;

    if (oldPath === newPath) {
      console.log(`⏭️  ${manual.year} ${manual.make} ${manual.model}: already organized`);
      continue;
    }

    console.log(`📁 Moving: ${oldPath} → ${newPath}`);

    // Copy to new location
    const { error: copyError } = await supabase.storage
      .from(BUCKET_NAME)
      .copy(oldPath, newPath);

    if (copyError) {
      // If file already exists at new path, just update the DB
      if (copyError.message.includes('already exists')) {
        console.log(`   ℹ️  File already exists at new path`);
      } else {
        console.error(`   ❌ Copy failed: ${copyError.message}`);
        continue;
      }
    }

    // Update database with new path
    const { error: updateError } = await supabase
      .from('vehicle_manuals')
      .update({ pdf_storage_path: newPath })
      .eq('id', manual.id);

    if (updateError) {
      console.error(`   ❌ DB update failed: ${updateError.message}`);
      continue;
    }

    // Delete old file
    const { error: deleteError } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([oldPath]);

    if (deleteError) {
      console.warn(`   ⚠️  Could not delete old file: ${deleteError.message}`);
    }

    console.log(`   ✅ Done`);
  }

  console.log('\n✅ Reorganization complete!');
  console.log(`\nNew structure: ${BUCKET_NAME}/{make}/{model}/{year}.pdf`);
}

reorganizeStorage();
