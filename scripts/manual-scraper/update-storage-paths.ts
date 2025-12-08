#!/usr/bin/env npx tsx

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://jxpbnnmefwtazfvoxvge.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_KEY required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

async function updateStoragePaths() {
  // Get all Ford F-150 manuals
  const { data: manuals, error } = await supabase
    .from('vehicle_manuals')
    .select('id, year, make, model, variant')
    .eq('make', 'Ford')
    .eq('model', 'F-150');

  if (error) {
    console.error('Error fetching manuals:', error);
    return;
  }

  console.log(`Updating ${manuals.length} manuals with storage paths...\n`);

  for (const manual of manuals) {
    // Build the storage path to match what we uploaded
    const variantSuffix = manual.variant ? '-' + manual.variant : '';
    const filename = `${manual.year}-ford-f-150${variantSuffix}.pdf`;
    const storagePath = `manuals/${filename}`;

    const { error: updateError } = await supabase
      .from('vehicle_manuals')
      .update({
        pdf_storage_path: storagePath,
        status: 'uploaded'
      })
      .eq('id', manual.id);

    if (updateError) {
      console.error(`❌ ${manual.year}: ${updateError.message}`);
    } else {
      console.log(`✅ ${manual.year} ${manual.variant || ''}: ${storagePath}`);
    }
  }

  console.log('\n✅ Done! Storage paths updated.');
}

updateStoragePaths();
