/**
 * A room photo must be a file we uploaded to our own Supabase Storage (public bucket),
 * so the booking page never shows an arbitrary external image. null clears the photo.
 */
export function roomPhotoUrlError(value: unknown, supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !supabaseUrl) return "照片網址不正確";
  const prefix = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/`;
  return value.startsWith(prefix) && !value.includes("..") ? null : "照片必須由後台上傳";
}
