import { currentUser, hasUsers } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (!(await hasUsers())) redirect("/setup");
  if (await currentUser()) redirect("/");
  return <LoginForm />;
}
