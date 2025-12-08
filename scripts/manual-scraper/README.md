# Manual Directory Scraper

Scrapes owner's manuals from [manual-directory.com](https://manual-directory.com) for the CarIntel vehicle intelligence platform.

## How It Works

1. **Discovery**: Scrapes manual-directory.com to find available manuals for each vehicle
2. **Extraction**: Extracts the internal manual ID (mid) from each manual page
3. **PDF Resolution**: Uses the mid to get the actual PDF URL from gimmemanuals.com
4. **Storage**: Optionally downloads PDFs and uploads them to Supabase Storage

## URL Pattern

```
Vehicle listing: https://manual-directory.com/cars/{make}/{model}/
Manual page:     https://manual-directory.com/manual/{year}-{make}-{model}-owners-manual/
PDF viewer:      https://manual-directory.com/view-manual-pdf/?mid={mid}
Actual PDF:      https://gimmemanuals.com/owners/{year}/{month}/{filename}.pdf
```

## Quick Start

```bash
# Install dependencies
npm install

# Test with 5 vehicles
npm run scrape:test

# Scrape all top 100 vehicles (metadata only)
npm run scrape

# Scrape and download PDFs
npm run scrape:download

# Sync results to Supabase database
export SUPABASE_SERVICE_KEY="your-service-role-key"
npm run sync

# Upload downloaded PDFs to Supabase Storage
npm run upload
```

## Command Line Options

```bash
# Limit number of vehicles
npx tsx scrape-manuals.ts --limit=10

# Filter by make
npx tsx scrape-manuals.ts --make=Honda

# Enable PDF downloads
npx tsx scrape-manuals.ts --download

# Combine options
npx tsx scrape-manuals.ts --make=Toyota --limit=5 --download
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SUPABASE_URL` | CarIntel production URL | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Required | Supabase service role key (for writes) |
| `DOWNLOAD_DIR` | `./manuals` | Directory for downloaded PDFs |
| `DELAY_MS` | `1000` | Delay between requests (ms) |
| `CONCURRENT_DOWNLOADS` | `3` | Max concurrent downloads |

## Output Files

- `manual-scrape-results.json` - Scraped metadata for all manuals found
- `manuals/` - Downloaded PDF files (when using `--download`)

## Database Schema

The `vehicle_manuals` table stores:

```sql
CREATE TABLE vehicle_manuals (
    id UUID PRIMARY KEY,
    year INTEGER,
    make TEXT,
    model TEXT,
    variant TEXT,  -- sedan, coupe, hybrid, etc.
    source_url TEXT,
    source_mid TEXT,
    pdf_url TEXT,
    pdf_size_bytes BIGINT,
    pdf_storage_path TEXT,  -- Supabase Storage path
    status TEXT,  -- discovered, downloading, uploaded, failed
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
);
```

## Top 100 Vehicles

The scraper targets the most popular vehicles in the US market:

- **Trucks**: F-150, Silverado, RAM 1500, Sierra, Tacoma, etc.
- **SUVs**: RAV4, CR-V, Rogue, Escape, Grand Cherokee, etc.
- **Sedans**: Camry, Civic, Accord, Corolla, Altima, etc.
- **Luxury**: BMW 3/5 Series, Mercedes C/E Class, Lexus RX, etc.
- **Electric**: Tesla Model 3/Y/S/X, Prius, Bolt, etc.

## Cost Considerations

- **Free**: Scraping metadata and PDF URLs costs nothing
- **Storage**: ~35MB average per PDF × 100 vehicles × 25 years = ~87.5 GB
- **Bandwidth**: PDF downloads from gimmemanuals.com are free (CDN)
- **Supabase Storage**: $0.021/GB for Pro plan, ~$1.84/month for all manuals

## Rate Limiting

The scraper includes built-in rate limiting:
- 1 second delay between requests by default
- 2 second delay between vehicles
- Automatic retry with exponential backoff

## Legal Considerations

- PDFs are publicly accessible and free to download
- The scraper respects robots.txt and rate limits
- Content is used for educational/reference purposes
- Always check terms of service before large-scale scraping
