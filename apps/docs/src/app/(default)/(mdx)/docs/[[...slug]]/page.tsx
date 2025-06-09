import {
	BasePage,
	internalGenerateMetadata,
	internalGenerateStaticParams,
} from "@/app/(default)/(mdx)/base-page";

const generateMetadata = internalGenerateMetadata({ baseUrl: "docs" });
const generateStaticParams = internalGenerateStaticParams({ baseUrl: "docs" });

export { generateMetadata, generateStaticParams };

export const revalidate = false;
export const dynamic = "force-static";
export const dynamicParams = false;

export default BasePage({ baseUrl: "docs" });
