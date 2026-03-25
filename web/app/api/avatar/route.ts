import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const formData = await request.formData();
  const photo = formData.get("photo") as File;

  if (!photo) {
    return NextResponse.json(
      { error: "No photo provided" },
      { status: 400 }
    );
  }

  const email = session.user?.email;
  if (!email) {
    return NextResponse.json(
      { error: "No email in session" },
      { status: 400 }
    );
  }

  // Upload to Supabase Storage
  const buffer = Buffer.from(await photo.arrayBuffer());
  const filePath = `${email}/avatar.jpg`;

  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(filePath, buffer, {
      contentType: photo.type || "image/jpeg",
      upsert: true,
    });

  if (uploadError) {
    console.error("[avatar] Upload error:", uploadError);
    return NextResponse.json(
      { error: "Failed to upload avatar" },
      { status: 500 }
    );
  }

  // Get public URL
  const { data: urlData } = supabase.storage
    .from("avatars")
    .getPublicUrl(filePath);

  const avatarUrl = urlData.publicUrl;

  // Update user record
  await supabase
    .from("users")
    .update({ avatar_url: avatarUrl })
    .eq("email", email);

  return NextResponse.json({
    avatarUrl,
    message: "Profile photo uploaded successfully",
  });
}
