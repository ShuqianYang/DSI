import { NextResponse } from 'next/server';
import { loadProjectSkillCatalog } from '../../../lib/skillCatalog.server';
import type { SkillCatalogResponse } from '../../../types/skillCatalog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const items = await loadProjectSkillCatalog();
    const response: SkillCatalogResponse = {
      items,
      total: items.length,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error loading skill catalog:', error);
    return NextResponse.json(
      { error: 'Failed to load skill catalog', details: String(error) },
      { status: 500 },
    );
  }
}
