import { NextResponse } from "next/server";
import { postForecastService } from "@/app/lib/forecastService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const data = await postForecastService("/forecast/lstm-demand", body);
    return NextResponse.json(data, { status: 200 });
  } catch (error: any) {
    console.error("POST /api/forecasting/lstm error", error);
    return NextResponse.json({ error: error?.message || "LSTM forecast failed" }, { status: 500 });
  }
}
