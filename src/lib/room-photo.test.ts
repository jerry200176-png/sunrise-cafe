import { describe, expect, it } from "vitest";
import { roomPhotoUrlError } from "./room-photo";

const SUPABASE = "https://abcd.supabase.co";

describe("roomPhotoUrlError", () => {
  it("accepts our own uploaded photos and clearing the photo", () => {
    expect(roomPhotoUrlError(`${SUPABASE}/storage/v1/object/public/menu-photos/b1/x.jpg`, SUPABASE)).toBeNull();
    expect(roomPhotoUrlError(null, SUPABASE)).toBeNull();
    expect(roomPhotoUrlError(undefined, SUPABASE)).toBeNull();
  });

  it("rejects external links, other projects and path tricks", () => {
    expect(roomPhotoUrlError("https://evil.example/x.jpg", SUPABASE)).toMatch(/後台上傳/);
    expect(roomPhotoUrlError("https://other.supabase.co/storage/v1/object/public/x.jpg", SUPABASE)).toMatch(/後台上傳/);
    expect(roomPhotoUrlError(`${SUPABASE}/storage/v1/object/public/../../auth`, SUPABASE)).toMatch(/後台上傳/);
    expect(roomPhotoUrlError(123, SUPABASE)).toMatch(/不正確/);
  });
});
