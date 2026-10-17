"use server";

import { createFirstUser, signOut } from "@/lib/auth";
import { required } from "@/lib/db";
import { redirect } from "next/navigation";

export async function setupAction(formData: FormData) {
  try {
    const name = required(formData, "name");
    const email = required(formData, "email");
    const password = String(formData.get("password") ?? "");
    await createFirstUser(name, email, password);
  } catch (error) {
    redirect(`/setup?error=${encodeURIComponent(error instanceof Error ? error.message : "Setup failed")}`);
  }
  redirect("/");
}

export async function logoutAction() {
  await signOut();
  redirect("/login");
}
