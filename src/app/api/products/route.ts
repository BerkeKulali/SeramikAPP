import { NextResponse } from "next/server";
import products from "@/src/data/products.json";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return NextResponse.json(products, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

