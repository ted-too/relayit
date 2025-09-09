import { redirect } from "next/navigation";

export default function Home() {
	throw redirect("/auth/sign-in");
}
