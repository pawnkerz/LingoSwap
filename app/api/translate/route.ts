import { NextRequest, NextResponse } from "next/server";

const MAX_TEXT_LENGTH = 1800;
const LANGUAGE_CODE = /^[a-z]{2,3}(-[A-Z]{2})?$/;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const source = typeof body?.source === "string" ? body.source : "";
    const target = typeof body?.target === "string" ? body.target : "";

    if (!text) {
      return NextResponse.json({ error: "Say or enter something to translate." }, { status: 400 });
    }

    if (text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json({ error: "Translation is limited to 1,800 characters at a time." }, { status: 400 });
    }

    if (!LANGUAGE_CODE.test(source) || !LANGUAGE_CODE.test(target)) {
      return NextResponse.json({ error: "Unsupported language code." }, { status: 400 });
    }

    if (source === target) {
      return NextResponse.json({ translatedText: text, provider: "identity" });
    }

    const sourceBase = source.split("-")[0];
    const targetBase = target.split("-")[0];
    const url = new URL("https://api.mymemory.translated.net/get");
    url.searchParams.set("q", text);
    url.searchParams.set("langpair", sourceBase + "|" + targetBase);

    const controller = new AbortController();
    const timeout = setTimeout(function () { controller.abort(); }, 10000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "LingoSwap/1.0" },
      cache: "no-store"
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return NextResponse.json({ error: "Translation provider is temporarily unavailable." }, { status: 502 });
    }

    const data = await response.json();
    const translated = data?.responseData?.translatedText;

    if (typeof translated !== "string" || !translated.trim()) {
      return NextResponse.json({ error: "No translation was returned." }, { status: 502 });
    }

    return NextResponse.json({
      translatedText: translated.trim(),
      provider: "MyMemory"
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Translation timed out. Try again."
        : "Translation failed. Try again.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
