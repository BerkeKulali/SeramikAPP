import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Satışlar bölümünü (sayfa + API) basit HTTP Basic Auth ile korur.
 * Kullanıcı adı / şifre Vercel ortam değişkenlerinden okunur:
 *   SALES_AUTH_USER, SALES_AUTH_PASSWORD
 * Değişkenler tanımlı değilse, güvenli tarafta kalıp erişimi kapatırız.
 */
export function proxy(request: NextRequest) {
  const expectedUser = process.env.SALES_AUTH_USER;
  const expectedPass = process.env.SALES_AUTH_PASSWORD;

  if (!expectedUser || !expectedPass) {
    return new NextResponse(
      "Satış paneli için SALES_AUTH_USER ve SALES_AUTH_PASSWORD ortam değişkenleri tanımlanmalı.",
      { status: 500 },
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const [scheme, encoded] = authHeader.split(" ");

  if (scheme === "Basic" && encoded) {
    try {
      const decoded = atob(encoded);
      const sep = decoded.indexOf(":");
      const user = sep >= 0 ? decoded.slice(0, sep) : decoded;
      const pass = sep >= 0 ? decoded.slice(sep + 1) : "";
      if (user === expectedUser && pass === expectedPass) {
        return NextResponse.next();
      }
    } catch {
      // Bozuk header — 401 ile devam et.
    }
  }

  return new NextResponse("Bu bölüme erişim için giriş yapmalısınız.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Satislar", charset="UTF-8"',
    },
  });
}

export const config = {
  matcher: ["/sales/:path*", "/api/sales/:path*"],
};
