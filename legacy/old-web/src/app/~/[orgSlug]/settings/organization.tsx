import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@repo/old-ui/components/shadcn/card";
import { CreateOrganizationForm } from "@/components/shared/forms/create-org";
import type { Organization } from "@/lib/auth-client";

export function OrganizationSettings({
	organization,
}: {
	organization: Organization;
}) {
	return (
		<Card className="max-w-none">
			<CardHeader>
				<CardTitle
					className="text-2xl leading-none tracking-tight"
					id="organization"
				>
					Organization
				</CardTitle>
				<CardDescription className="text-sm">
					Manage your project settings
				</CardDescription>
			</CardHeader>
			<CardContent>
				{/* FIXME: This is ugly, but it works. The layout on this page should be improved. */}
				<CreateOrganizationForm initialData={organization} />
			</CardContent>
		</Card>
	);
}
