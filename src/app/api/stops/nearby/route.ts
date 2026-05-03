import { NextRequest, NextResponse } from 'next/server';

const G2 = process.env.G2_BASE_URL ?? 'http://localhost:8000';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const qs = searchParams.toString();
  try {
    const res = await fetch(`${G2}/api/v1/stops/nearby?${qs}`, { cache: 'no-store' });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Failed to reach backend' }, { status: 502 });
  }
}
