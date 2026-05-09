import { NextResponse } from "next/server";
import products from "@/src/data/products.json";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  console.log("[api/products] count:", Array.isArray(products) ? products.length : "not-array");
  return NextResponse.json(products, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

