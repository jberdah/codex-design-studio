import { NextResponse } from "next/server";
import { activeProjectId } from "@/server/paths";
import { readVisualAssetFile } from "@/server/visual-assets";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ file: string }> }) {
  try {
    const { file } = await context.params;
    const match = /^(gav_[a-f0-9-]{36})\.(png|jpg|webp)$/i.exec(file);
    if (!match) return NextResponse.json({ error: "Invalid visual asset file id." }, { status: 400 });
    const { version, bytes } = await readVisualAssetFile(activeProjectId(request), match[1]);
    const mediaType = version.output.actualEncoding === "jpeg" ? "image/jpeg" : `image/${version.output.actualEncoding}`;
    return new NextResponse(bytes, { headers: { "content-type": mediaType, "content-length": String(bytes.byteLength), "cache-control": "private, immutable, max-age=31536000", etag: `"${version.contentHash}"` } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Visual asset not found." }, { status: 404 }); }
}
