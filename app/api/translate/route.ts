import { NextRequest, NextResponse } from "next/server";

const MAX_TEXT_LENGTH = 1800;
const MAX_BODY_LENGTH = 8192;
const LANGUAGE_CODE = /^[a-z]{2,3}(-[A-Z]{2})?$/;

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_LENGTH) {
    return NextResponse.json({ error: "Translation request is too large." }, { status: 413, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_LENGTH) {
      return NextResponse.json({ error: "Translation request is too large." }, { status: 413, headers: { "Cache-Control": "no-store" } });
    }

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return NextResponse.json({ error: "Invalid translation request." }, { status: 400, headers: { "Cache-Control": "no-store" } });
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid translation request." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const source = typeof body?.source === "string" ? body.source : "";
    const target = typeof body?.target === "string" ? body.target : "";

    if (!text) {
      return NextResponse.json({ error: "Say or enter something to translate." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }

    if (text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json({ error: "Translation is limited to 1,800 characters at a time." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }

    if (!LANGUAGE_CODE.test(source) || !LANGUAGE_CODE.test(target)) {
      return NextResponse.json({ error: "Unsupported language code." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }

    if (source === target) {
      return NextResponse.json({ translatedText: text, provider: "identity" }, { headers: { "Cache-Control": "no-store" } });
    }

    const sourceBase = source.split("-")[0];
    const targetBase = target.split("-")[0];
    const url = new URL("https://api.mymemory.translated.net/get");
    url.searchParams.set("q", text);
    url.searchParams.set("langpair", sourceBase + "|" + targetBase);

    const controller = new AbortController();
    const timeout = setTimeout(function () { controller.abort(); }, 10000);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "LingoSwap/1.0" },
        cache: "no-store"
      });

      if (!response.ok) {
        return NextResponse.json({ error: "Translation provider is temporarily unavailable." }, { status: 502, headers: { "Cache-Control": "no-store" } });
      }

      const data = await response.json();
      const translated = data?.responseData?.translatedText;

      if (data?.responseStatus !== 200 || typeof translated !== "string" || !translated.trim()) {
        return NextResponse.json({ error: "No translation was returned. Try again shortly." }, { status: 502, headers: { "Cache-Control": "no-store" } });
      }

      return NextResponse.json({
        translatedText: translated.trim(),
        provider: "MyMemory"
      }, { headers: { "Cache-Control": "no-store" } });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    const providerFailure = error instanceof TypeError || error instanceof SyntaxError;
    const message = timedOut
      ? "Translation timed out. Try again."
      : providerFailure
        ? "Translation provider is temporarily unavailable."
        : "Translation failed. Try again.";

    const status = timedOut ? 504 : providerFailure ? 502 : 500;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
